// "Edit together" (beta) for text: a Replicated Growable Array (RGA, Roh et al. 2011) with Lamport timestamps.
// Pure (no DOM). Used for Code studio files (and one-file text documents). Decision record: docs/adr/0011.
//
// Every character ever inserted is an item { id: [lamport, site], ch, del } in one array (deleted characters stay as
// tombstones). An insert names its ORIGIN (the character it was typed after, or null for the start); it is placed right
// after the origin, skipping every following item with a greater id. Because a character's lamport is always greater
// than its origin's, everything that was inserted "inside" a greater sibling also has a greater id, so the rule skips
// whole subtrees and every replica ends with the same order no matter in which order the inserts arrived. Deletes only
// set `del` (idempotent). Inserts never conflict with deletes: concurrent typing inside text someone else deletes
// survives, so no text is lost silently.
//
// Ops (wire format; the site is the authenticated sender, never part of the op):
//   { o:"ins", a: [lamport, site] | null, l, t }   t = text; character i gets id [l + i, sender], origin of i>0 is i-1
//   { o:"del", r: [[lamport, site, count], ...] }  ranges of ids [l..l+count-1] of one site
//
// Public API
//   class TextCRDT(site)  .text() .length .insert(pos, text) → op .remove(pos, len) → op
//                         .apply(op, site) → { changes:[{from,to,insert}], pending:boolean }
//                         .toJSON() static fromJSON(json, site) static fromText(text, site)
//   textDiff(oldText, newText) → { from, to, insert } | null    (one replace from the common prefix/suffix)
//   validateTextOp(op) → cleaned op | throws
export const TEXT_LIMITS = Object.freeze({ insertChars: 64 * 1024, deleteRanges: 4096, docChars: 2 * 1024 * 1024, pending: 20000, maxLamport: 2 ** 48 });

const keyOf = (l, s) => `${l}@${s}`;
const greater = (a, b) => a.l > b.l || (a.l === b.l && a.s > b.s);

export class TextCRDT {
  constructor(site = "") {
    this.site = site;
    this.lamport = 0;
    /** @type {{l:number, s:string, ch:string, del:boolean}[]} */
    this.items = [];
    this.byId = new Map();
    this.pending = []; // inserts whose origin has not arrived yet
    this.pendingDel = new Set(); // deletes of ids that have not arrived yet
    this.visible = 0;
  }

  static fromText(text, site = "") {
    const t = new TextCRDT(site);
    const chars = String(text ?? "");
    for (let i = 0; i < chars.length; i++) {
      const it = { l: i + 1, s: "", ch: chars[i], del: false };
      t.items.push(it);
      t.byId.set(keyOf(it.l, it.s), it);
    }
    t.lamport = chars.length;
    t.visible = chars.length;
    return t;
  }

  get length() {
    return this.visible;
  }

  text() {
    let s = "";
    for (const it of this.items) if (!it.del) s += it.ch;
    return s;
  }

  #indexOfVisible(pos) {
    // array index of the visible character at `pos` (or items.length when pos === length)
    let n = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].del) continue;
      if (n === pos) return i;
      n++;
    }
    return this.items.length;
  }

  #visibleBefore(index) {
    let n = 0;
    for (let i = 0; i < index; i++) if (!this.items[i].del) n++;
    return n;
  }

  /** Local insert of `text` at visible position `pos`. Applies it and returns the op to send. */
  insert(pos, text) {
    if (!text) return null;
    let origin = null;
    if (pos > 0) {
      const idx = this.#indexOfVisible(pos - 1);
      const it = this.items[idx];
      origin = [it.l, it.s];
    }
    const op = { o: "ins", a: origin, l: this.lamport + 1, t: text };
    this.apply(op, this.site);
    return op;
  }

  /** Local delete of `len` visible characters at `pos`. Applies it and returns the op to send. */
  remove(pos, len) {
    if (len <= 0) return null;
    const ids = [];
    let n = 0;
    for (const it of this.items) {
      if (it.del) continue;
      if (n >= pos && n < pos + len) ids.push(it);
      n++;
      if (n >= pos + len) break;
    }
    const r = [];
    for (const it of ids) {
      const last = r[r.length - 1];
      if (last && last[1] === it.s && last[0] + last[2] === it.l) last[2]++;
      else r.push([it.l, it.s, 1]);
    }
    const op = { o: "del", r };
    this.apply(op, this.site);
    return op;
  }

  /**
   * Applies an op written by `site` (also local ops). Returns the visible changes, in order, each relative to the
   * text after the previous one: [{ from, to, insert }].
   */
  apply(op, site) {
    const changes = [];
    if (op.o === "ins") {
      if (op.a && !this.byId.has(keyOf(op.a[0], op.a[1]))) {
        if (this.pending.length >= TEXT_LIMITS.pending) throw new Error("too many out-of-order edits");
        this.pending.push({ op, site });
        return { changes, pending: true };
      }
      this.#insert(op, site, changes);
      this.#drainPending(changes);
    } else if (op.o === "del") {
      const targets = new Set();
      for (const [l, s, count] of op.r) {
        for (let k = 0; k < count; k++) {
          const it = this.byId.get(keyOf(l + k, s));
          if (!it) this.pendingDel.add(keyOf(l + k, s));
          else if (!it.del) targets.add(it);
        }
      }
      if (targets.size) {
        // one pass in document order; positions are relative to the text after the previous change
        let pos = 0;
        for (const it of this.items) {
          if (it.del) continue;
          if (!targets.has(it)) {
            pos++;
            continue;
          }
          it.del = true;
          this.visible--;
          const last = changes[changes.length - 1];
          if (last && last.from === pos) last.to++;
          else changes.push({ from: pos, to: pos + 1, insert: "" });
        }
      }
    }
    return { changes, pending: false };
  }

  #insert(op, site, changes) {
    if (op.l + op.t.length > this.lamport) this.lamport = op.l + op.t.length - 1;
    let idx = -1;
    if (op.a) {
      const o = this.byId.get(keyOf(op.a[0], op.a[1]));
      if (op.l <= o.l) throw new Error("an insert must be newer than its origin");
      idx = this.items.indexOf(o);
    }
    let fresh = true;
    for (let i = 0; i < op.t.length && fresh; i++) if (this.byId.has(keyOf(op.l + i, site))) fresh = false;
    if (fresh) {
      // fast path: the whole run lands in one place (nothing can sit between characters of a brand-new run)
      let j = idx + 1;
      const first = { l: op.l, s: site };
      while (j < this.items.length && greater(this.items[j], first)) j++;
      const run = [];
      let shown = "";
      for (let i = 0; i < op.t.length; i++) {
        const it = { l: op.l + i, s: site, ch: op.t[i], del: false };
        const k = keyOf(it.l, site);
        this.byId.set(k, it);
        if (this.pendingDel.delete(k)) it.del = true;
        else shown += it.ch;
        run.push(it);
      }
      const at = this.#visibleBefore(j);
      this.items = run.length > 1000 ? this.items.slice(0, j).concat(run, this.items.slice(j)) : (this.items.splice(j, 0, ...run), this.items);
      this.visible += shown.length;
      if (shown) changes.push({ from: at, to: at, insert: shown });
      return;
    }
    let from = -1;
    let inserted = "";
    for (let i = 0; i < op.t.length; i++) {
      const it = { l: op.l + i, s: site, ch: op.t[i], del: false };
      const k = keyOf(it.l, it.s);
      if (this.byId.has(k)) {
        idx = this.items.indexOf(this.byId.get(k)); // duplicate delivery: already integrated
        continue;
      }
      let j = idx + 1;
      while (j < this.items.length && greater(this.items[j], it)) j++;
      this.items.splice(j, 0, it);
      this.byId.set(k, it);
      idx = j;
      if (this.pendingDel.delete(k)) {
        it.del = true;
        continue;
      }
      this.visible++;
      const at = this.#visibleBefore(j);
      if (from >= 0 && at === from + inserted.length) inserted += it.ch;
      else {
        if (inserted) changes.push({ from, to: from, insert: inserted });
        from = at;
        inserted = it.ch;
      }
    }
    if (inserted) changes.push({ from, to: from, insert: inserted });
  }

  #drainPending(changes) {
    let progress = true;
    while (progress && this.pending.length) {
      progress = false;
      for (let i = 0; i < this.pending.length; i++) {
        const { op, site } = this.pending[i];
        if (!this.byId.has(keyOf(op.a[0], op.a[1]))) continue;
        this.pending.splice(i, 1);
        this.#insert(op, site, changes);
        progress = true;
        break;
      }
    }
  }

  /** Compact state: runs of consecutive ids of one site with the same deleted flag. */
  toJSON() {
    const runs = [];
    let cur = null;
    for (const it of this.items) {
      if (cur && cur[1] === it.s && cur[0] + cur[2].length === it.l && cur[3] === (it.del ? 1 : 0)) cur[2] += it.ch;
      else runs.push((cur = [it.l, it.s, it.ch, it.del ? 1 : 0]));
    }
    return { v: 1, l: this.lamport, r: runs };
  }

  static fromJSON(json, site = "") {
    if (!json || json.v !== 1 || !Array.isArray(json.r) || !Number.isInteger(json.l) || json.l < 0 || json.l > TEXT_LIMITS.maxLamport) throw new Error("invalid text state");
    const t = new TextCRDT(site);
    t.lamport = json.l;
    let total = 0;
    for (const run of json.r) {
      if (!Array.isArray(run) || run.length !== 4) throw new Error("invalid text run");
      const [l, s, text, del] = run;
      if (!Number.isInteger(l) || l < 1 || l > TEXT_LIMITS.maxLamport || typeof s !== "string" || !SITE_RE.test(s) || typeof text !== "string" || (del !== 0 && del !== 1)) throw new Error("invalid text run");
      total += text.length;
      if (total > TEXT_LIMITS.docChars * 4) throw new Error("text state too large");
      for (let i = 0; i < text.length; i++) {
        const it = { l: l + i, s, ch: text[i], del: !!del };
        const k = keyOf(it.l, s);
        if (t.byId.has(k)) throw new Error("duplicate character id");
        t.items.push(it);
        t.byId.set(k, it);
        if (!del) t.visible++;
      }
    }
    return t;
  }
}

/** The single replace that turns `a` into `b` (common prefix and suffix kept), or null when equal. */
export function textDiff(a, b) {
  if (a === b) return null;
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { from: p, to: a.length - s, insert: b.slice(p, b.length - s) };
}

const SITE_RE = /^(?:[A-Za-z0-9_-]{22}|)$/;
const bad = (m) => {
  throw new Error(m);
};
const lam = (v) => (Number.isInteger(v) && v >= 1 && v <= TEXT_LIMITS.maxLamport ? v : bad("clock is invalid"));
const site = (v) => (typeof v === "string" && SITE_RE.test(v) ? v : bad("site is invalid"));

/** Validates one text op received from another member. */
export function validateTextOp(op) {
  if (!op || typeof op !== "object" || Array.isArray(op)) bad("op must be an object");
  if (op.o === "ins") {
    for (const k of Object.keys(op)) if (!["o", "a", "l", "t"].includes(k)) bad(`op field ${k} is not allowed`);
    if (typeof op.t !== "string" || !op.t.length || op.t.length > TEXT_LIMITS.insertChars) bad("insert text is invalid");
    const a = op.a === null ? null : Array.isArray(op.a) && op.a.length === 2 ? [lam(op.a[0]), site(op.a[1])] : bad("origin is invalid");
    return { o: "ins", a, l: lam(op.l), t: op.t };
  }
  if (op.o === "del") {
    for (const k of Object.keys(op)) if (!["o", "r"].includes(k)) bad(`op field ${k} is not allowed`);
    if (!Array.isArray(op.r) || !op.r.length || op.r.length > TEXT_LIMITS.deleteRanges) bad("delete ranges are invalid");
    return { o: "del", r: op.r.map((x) => (Array.isArray(x) && x.length === 3 && Number.isInteger(x[2]) && x[2] >= 1 && x[2] <= TEXT_LIMITS.insertChars ? [lam(x[0]), site(x[1]), x[2]] : bad("delete range is invalid"))) };
  }
  return bad("unknown op");
}
