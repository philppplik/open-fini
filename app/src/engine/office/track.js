// Tracked changes of the word processor (docs/office-studio.md ▸ Design and review). Pure module (no DOM) on top of
// model.js; design.js re-exports it for the editor, the design UI, the codecs and the Vibe tools.
//
// A change is stored where it happened, with the author's name:
//   run  ins / del           inserted or deleted text (deleted text stays visible, struck through)
//   run  fmt { author, old } a format change; `old` holds the formatting before it
//   para pchg { author, style, props?, list? }   a paragraph change; the paragraph properties before it
//   para pins / pdel         the paragraph mark was inserted (a split) or deleted (a join)
// revisions() lists them in reading order, resolveRevisions() accepts or rejects them, trackDiff() turns any edit
// (a Vibe tool, a formatting command) into tracked changes by comparing the documents before and after.
import * as M from "./model.js";

/** The author name of edits made by the assistant. */
export const VIBE_AUTHOR = "Vibe (AI)";

/** Splits runs at [a, b) and maps the runs inside with fn(run) → run | null (null removes it). */
function mapRange(runs, a, b, fn) {
  const out = [];
  let pos = 0;
  for (const r of runs) {
    const len = M.runLength(r);
    const s = Math.max(a, pos);
    const e = Math.min(b, pos + len);
    if (e <= s) out.push(r);
    else if (!M.isText(r)) {
      const n = fn(r);
      if (n) out.push(n);
    } else {
      if (s > pos) out.push({ ...r, text: r.text.slice(0, s - pos) });
      const n = fn({ ...r, text: r.text.slice(s - pos, e - pos) });
      if (n) out.push(n);
      if (e < pos + len) out.push({ ...r, text: r.text.slice(e - pos) });
    }
    pos += len;
  }
  return M.mergeRuns(out);
}

const fmtOf = (r) => {
  const o = {};
  for (const k of M.FORMAT_KEYS) if (r[k] !== undefined) o[k] = r[k];
  return o;
};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const without = (o, ...keys) => {
  const c = { ...o };
  for (const k of keys) delete c[k];
  return c;
};

/** Marks deleted text: own insertions go, other text gets `del` (objects other than text are removed). */
const deleteMark = (author, dropObjects = false) => (r) => (r.ins === author ? null : M.isText(r) ? (r.del ? r : { ...without(r, "fmt"), del: author }) : dropObjects ? null : r);

/**
 * A tracked deletion of [from, to): text is marked `del` (it stays visible, struck through) except text the same
 * author inserted while tracking, which is removed. Objects (images, fields) are marked only when they are text.
 * Returns { doc, pos } where pos is the caret after a backward delete (from).
 */
export function trackDelete(doc, from, to, author) {
  [from, to] = M.comparePos(from, to) <= 0 ? [from, to] : [to, from];
  const next = M.mapParagraphs(doc, from, to, (p, path) => {
    const a = M.samePath(path, from.path) ? from.offset : 0;
    const b = M.samePath(path, to.path) ? to.offset : Infinity;
    return { ...p, runs: mapRange(p.runs, a, b, deleteMark(author)) };
  });
  // the caret stays at `from`; own insertions removed before it do not shift it
  return { doc: next, pos: from };
}

/** Length of the text in [a, b) that trackDelete removes outright (own insertions), to place the caret after a forward delete. */
export function removedLength(p, a, b, author) {
  let n = 0;
  let pos = 0;
  for (const r of p.runs) {
    const len = M.runLength(r);
    const s = Math.max(a, pos);
    const e = Math.min(b, pos + len);
    if (e > s && r.ins === author) n += e - s;
    pos += len;
  }
  return n;
}

/** Enter while tracking: the first half's paragraph mark is new (`pins`); the old mark stays with the second half. */
export function trackSplit(doc, pos, author) {
  const before = M.containerBlocks(doc, pos.path).length;
  const r = M.splitParagraph(doc, pos);
  const list = M.containerBlocks(r.doc, pos.path);
  if (list.length === before) return r;
  const i = pos.path[pos.path.length - 1];
  const { pins, pdel, ...a } = list[i];
  const b = { ...list[i + 1], ...(pins ? { pins } : {}), ...(pdel ? { pdel } : {}) };
  return { doc: M.updateContainer(r.doc, pos.path, (l) => [...l.slice(0, i), { ...a, pins: author }, b, ...l.slice(i + 2)]), pos: r.pos };
}

/**
 * Backspace at the start (`forward` false) or Delete at the end (`forward` true) of a paragraph while tracking: the
 * paragraph mark between the two paragraphs is marked deleted (`pdel`) instead of joining them; a mark the same author
 * inserted is really removed. Returns { doc, pos } or null when the edit is not a plain join (lists, tables, objects).
 */
export function trackJoin(doc, path, author, forward = false) {
  const list = M.containerBlocks(doc, path);
  const i = path[path.length - 1] - (forward ? 0 : 1);
  const p = list?.[i];
  const q = list?.[i + 1];
  if (!p || !q || p.type !== "paragraph" || q.type !== "paragraph" || (!forward && q.list)) return null;
  const at = path.slice(0, -1).concat(i);
  const end = { path: at, offset: M.paraLength(p) };
  if (p.pins === author) {
    const r = joinNext(doc, at);
    return { doc: r, pos: end };
  }
  return { doc: p.pdel ? doc : M.setBlock(doc, at, { ...p, pdel: author }), pos: forward ? { path: path.slice(0, -1).concat(i + 1), offset: 0 } : end };
}

/** Joins the paragraph after `path` into it; the joined paragraph keeps the second paragraph's mark (pins / pdel). */
function joinNext(doc, path) {
  const list = M.containerBlocks(doc, path);
  const i = path[path.length - 1];
  const p = list[i];
  const q = list[i + 1];
  if (!q || q.type !== "paragraph") return M.setBlock(doc, path, without(p, "pins", "pdel"));
  const merged = { ...without(p, "pins", "pdel"), runs: M.mergeRuns([...p.runs, ...q.runs]), ...(q.pins ? { pins: q.pins } : {}), ...(q.pdel ? { pdel: q.pdel } : {}) };
  return M.updateContainer(doc, path, (l) => [...l.slice(0, i), merged, ...l.slice(i + 2)]);
}

const KIND_ORDER = ["ins", "del", "format"];

/** Every tracked change in reading order: { id, kind: "ins"|"del"|"format"|"paragraph"|"split"|"join", author, path, from, to, text }. */
export function revisions(doc) {
  const out = [];
  for (const { path, para } of M.paragraphs(doc)) {
    let pos = 0;
    for (const r of para.runs) {
      const len = M.runLength(r);
      for (const kind of KIND_ORDER) {
        const author = kind === "format" ? r.fmt?.author : r[kind];
        if (!author) continue;
        const last = out[out.length - 1];
        if (last && last.kind === kind && last.author === author && M.samePath(last.path, path) && last.to === pos) {
          last.to = pos + len;
          last.text += M.runChar(r);
        } else out.push({ kind, author, path, from: pos, to: pos + len, text: M.runChar(r) });
      }
      pos += len;
    }
    const all = M.paraText(para);
    if (para.pchg) out.push({ kind: "paragraph", author: para.pchg.author, path, from: 0, to: pos, text: all });
    if (para.pins) out.push({ kind: "split", author: para.pins, path, from: pos, to: pos, text: all.slice(-40) });
    if (para.pdel) out.push({ kind: "join", author: para.pdel, path, from: pos, to: pos, text: all.slice(-40) });
  }
  return out.map((r, i) => ({ id: i + 1, ...r, text: r.text.replace(/￼/g, "").slice(0, 300) }));
}

/**
 * Accepts or rejects tracked changes. Filters: `author`, `kind`, `ids` (from revisions()), or a range { from, to }
 * (positions) the change must overlap. Returns { doc, count }.
 */
export function resolveRevisions(doc, { accept = true, author, kind, ids, from, to } = {}) {
  const list = revisions(doc).filter((r) => (!author || r.author === author) && (!kind || r.kind === kind) && (!ids || ids.includes(r.id)) && (!from || (M.comparePos({ path: r.path, offset: r.to }, from) >= 0 && M.comparePos({ path: r.path, offset: r.from }, to || from) <= 0)));
  // later changes first so earlier paths and offsets stay valid (joins only touch the paragraph and the next one)
  for (const r of list.slice().reverse()) {
    const p = M.getBlock(doc, r.path);
    if (!p) continue;
    if (r.kind === "paragraph") {
      const { author: _a, ...old } = p.pchg || {};
      doc = M.setBlock(doc, r.path, accept ? without(p, "pchg") : { ...without(p, "pchg", "props", "list"), ...old });
    } else if (r.kind === "split" || r.kind === "join") {
      // accepting a join or rejecting a split removes the paragraph mark
      const join = (r.kind === "join") === accept;
      doc = join ? joinNext(doc, r.path) : M.setBlock(doc, r.path, without(p, r.kind === "split" ? "pins" : "pdel"));
    } else if (r.kind === "format") {
      const runs = mapRange(p.runs, r.from, r.to, (x) => (!x.fmt ? x : accept ? without(x, "fmt") : { ...without(x, "fmt", ...M.FORMAT_KEYS), ...x.fmt.old }));
      doc = M.setBlock(doc, r.path, { ...p, runs });
    } else {
      const runs = mapRange(p.runs, r.from, r.to, (x) => {
        if (!x[r.kind]) return x;
        const drop = (r.kind === "ins") !== accept; // reject an insertion or accept a deletion: the text goes
        return drop ? null : without(x, r.kind);
      });
      doc = M.setBlock(doc, r.path, { ...p, runs });
    }
  }
  return { doc, count: list.length };
}

export const acceptAll = (doc) => resolveRevisions(doc, { accept: true }).doc;

// ------------------------------------------------------------------------------------------------ diff to revisions

/** Format changes between runs of equal text: pieces whose formatting differs get `fmt` with the old formatting. */
function fmtDiff(oldRuns, newRuns, author) {
  const cuts = new Set([0]);
  let pos = 0;
  for (const r of oldRuns) cuts.add((pos += M.runLength(r)));
  pos = 0;
  for (const r of newRuns) cuts.add((pos += M.runLength(r)));
  const at = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < at.length; k++) {
    const piece = M.sliceRuns(newRuns, at[k], at[k + 1])[0];
    if (!piece) continue;
    if (!M.isText(piece)) {
      out.push(piece);
      continue;
    }
    const old = M.sliceRuns(oldRuns, at[k], at[k + 1])[0];
    const base = piece.fmt ? piece.fmt.old : old && M.isText(old) ? fmtOf(old) : fmtOf(piece);
    if (same(base, fmtOf(piece)) || piece.ins) out.push(without(piece, "fmt"));
    else out.push({ ...piece, fmt: { author: piece.fmt?.author || author, old: base } });
  }
  return M.mergeRuns(out);
}

/** Paragraph properties: a change against the original (kept in `pchg` once recorded) is recorded or cleared. */
function paraDiff(a, b, author) {
  const base = b.pchg || a.pchg || { style: a.style, ...(a.props ? { props: a.props } : {}), ...(a.list ? { list: a.list } : {}) };
  const { author: who, ...orig } = base;
  const out = without(b, "pchg");
  if (!b.pins && a.pins) out.pins = a.pins;
  if (!b.pdel && a.pdel) out.pdel = a.pdel;
  if (orig.style === b.style && same(orig.props, b.props) && same(orig.list, b.list)) return out;
  return { ...out, pchg: { author: who || author, ...orig } };
}

/** A paragraph edited in place: common start and end stay, the old middle is deleted, the new middle inserted. */
function textDiff(a, b, author) {
  const ta = M.paraText(a);
  const tb = M.paraText(b);
  let s = 0;
  while (s < ta.length && s < tb.length && ta[s] === tb[s]) s++;
  let e = 0;
  while (e < ta.length - s && e < tb.length - s && ta[ta.length - 1 - e] === tb[tb.length - 1 - e]) e++;
  const head = fmtDiff(M.sliceRuns(a.runs, 0, s), M.sliceRuns(b.runs, 0, s), author);
  const gone = M.sliceRuns(a.runs, s, ta.length - e).map(deleteMark(author, true)).filter(Boolean);
  const added = M.sliceRuns(b.runs, s, tb.length - e).map((r) => (M.isText(r) ? { ...without(r, "del", "fmt"), ins: author } : r));
  const tail = fmtDiff(M.sliceRuns(a.runs, ta.length - e, Infinity), M.sliceRuns(b.runs, tb.length - e, Infinity), author);
  return paraDiff(a, { ...b, runs: M.mergeRuns([...head, ...gone, ...added, ...tail]) }, author);
}

/** Format and paragraph changes of a paragraph whose text did not change. */
const sameText = (a, b, author) => paraDiff(a, { ...b, runs: fmtDiff(a.runs, b.runs, author) }, author);

/** Format and paragraph changes inside a table of the same shape and text (cell paragraphs compared in place). */
function tableDiff(a, b, author) {
  if (a.rows.length !== b.rows.length) return b;
  return {
    ...b,
    rows: b.rows.map((row, r) => ({
      ...row,
      cells: row.cells.map((cell, c) => {
        const old = a.rows[r]?.cells[c];
        if (!old || old === cell || old.blocks.length !== cell.blocks.length) return cell;
        return { ...cell, blocks: cell.blocks.map((p, k) => (old.blocks[k] === p || M.paraText(old.blocks[k]) !== M.paraText(p) ? p : sameText(old.blocks[k], p, author))) };
      }),
    })),
  };
}

const insertedPara = (b, author) => ({ ...without(b, "pchg"), runs: b.runs.map((r) => (M.isText(r) ? { ...without(r, "del", "fmt"), ins: author } : r)), pins: author });
function deletedPara(a, author) {
  const runs = a.runs.map(deleteMark(author, true)).filter(Boolean);
  // a paragraph the same author inserted disappears completely
  if (a.pins === author && !runs.length) return null;
  return { ...a, runs, pdel: author };
}

const blockKey = (b) => (b.type === "paragraph" ? `p\u0001${M.paraText(b)}` : `${b.type}\u0001${JSON.stringify(b.type === "table" ? b.rows.map((r) => r.cells.map((c) => c.blocks.map(M.paraText))) : b)}`);

/** Pairs equal blocks of two lists (longest common subsequence on the changed middle). → [[i, j] | [i, -1] | [-1, j]] */
function align(A, B) {
  const ka = A.map(blockKey);
  const kb = B.map(blockKey);
  let s = 0;
  while (s < A.length && s < B.length && (A[s] === B[s] || ka[s] === kb[s])) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && (A[A.length - 1 - e] === B[B.length - 1 - e] || ka[A.length - 1 - e] === kb[B.length - 1 - e])) e++;
  const out = [];
  for (let k = 0; k < s; k++) out.push([k, k]);
  const n = A.length - s - e;
  const m = B.length - s - e;
  if (n * m > 4e6) {
    // too large to align: compare position by position
    for (let k = 0; k < Math.max(n, m); k++) out.push([k < n ? s + k : -1, k < m ? s + k : -1]);
  } else {
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = ka[s + i] === kb[s + j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && ka[s + i] === kb[s + j]) out.push([s + i++, s + j++]);
      else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) out.push([-1, s + j++]);
      else out.push([s + i++, -1]);
    }
  }
  for (let k = 0; k < e; k++) out.push([A.length - e + k, B.length - e + k]);
  return out;
}

/**
 * Turns the change from `prev` to `next` into tracked changes by `author` (used for Vibe edits and formatting
 * commands while Track changes is on). Top-level paragraphs are aligned by text: unchanged text keeps its place and
 * gets format and paragraph changes, an edited paragraph gets a deletion and an insertion, removed paragraphs stay as
 * deleted text, new ones are marked inserted. Tables, breaks and other blocks are taken as they are (not tracked).
 */
export function trackDiff(prev, next, author) {
  if (!prev || !next || prev === next || prev.blocks === next.blocks) return next;
  const A = prev.blocks;
  const B = next.blocks;
  const out = [];
  const pairs = align(A, B);
  for (let k = 0; k < pairs.length; k++) {
    const [i, j] = pairs[k];
    if (i >= 0 && j >= 0) {
      const a = A[i];
      const b = B[j];
      out.push(a === b ? b : a.type === "paragraph" ? sameText(a, b, author) : a.type === "table" && b.type === "table" ? tableDiff(a, b, author) : b);
      continue;
    }
    // a gap: removed blocks (i) and added blocks (j) between two matches; edited paragraphs pair up in order
    const gone = [];
    const added = [];
    for (; k < pairs.length && (pairs[k][0] < 0 || pairs[k][1] < 0); k++) (pairs[k][0] >= 0 ? gone : added).push(pairs[k][0] >= 0 ? A[pairs[k][0]] : B[pairs[k][1]]);
    k--;
    const ga = gone.filter((b) => b.type === "paragraph");
    let g = 0;
    for (const b of added) {
      if (b.type !== "paragraph") out.push(b);
      else if (g < ga.length) out.push(textDiff(ga[g++], b, author));
      else out.push(insertedPara(b, author));
    }
    for (; g < ga.length; g++) {
      const d = deletedPara(ga[g], author);
      if (d) out.push(d);
    }
  }
  if (out[out.length - 1]?.type !== "paragraph") out.push(M.para(""));
  return { ...next, blocks: out };
}
