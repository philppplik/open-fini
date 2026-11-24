// The pure layout solver of the Proto model (docs/concepts/proto-studio.md §4.4; ADR 0034 decision 4). Pure: no DOM.
//
// It computes the boxes the browser would give the CSS that css.js emits, for the places without a browser: the CLI's
// SVG render and lint, and headless MCP. It is never used to draw the canvas (the browser lays that out), so its
// results are labeled `approximate: true`. It implements:
//   * flex: single and multi-line, grow with min/max freezing, gaps, justify-content, align-items/-self (start,
//     center, end, stretch, baseline for text), align-content; fill layers flex from a zero basis, fixed and hug layers
//     never shrink (css.js emits exactly that, so CSS automatic minimum sizes never apply);
//   * grid: explicit and implicit tracks with px, fr, auto and minmax(), auto-placement (row or column flow, sparse or
//     dense), spans, auto-track stretching, gaps, justify/align-items and -self;
//   * absolute layers with constraints (left, right, left and right, center, scale; the same for top and bottom);
//   * text: runs with their own fonts, greedy line breaking at spaces (`pre-wrap`) or none (`pre`, auto width),
//     line heights from the style, `maxLines`. Widths come from a measurer (default: engine/layout/measurers.js ▸
//     approxMeasurer, Adobe base-14 metrics), the same seam core/fonts.js uses (`setTextMeasurer`), so a host with
//     real fonts passes its own.
// Rotation does not affect layout (as in CSS); boxes are unrotated and carry `rot`.
//
// Public API
//   layout(root, opts?) → { approximate: true, root, boxes: Map<key, Box> }
//       root   a resolved node (resolve.js); boxes of hidden layers are omitted
//       Box    { x, y, w, h, px, py, rot, lines? }   x, y in the root's coordinate space (the root sits at its own x and
//              y, or at 0, 0 with `origin: true`); px, py relative to the parent's border box;
//              lines (text) [{ x, y, w, h, baseline, segs: [{ text, x, w, run }] }] relative to the text box
//   layoutNode(model, id, opts?)  resolves the node (resolve.js) and lays it out; opts also go to the resolver
//
// Options
//   measurer     { measure(font, text), metrics(font) } (font = { family, size, weight, style })
//   viewport     { w, h } that fill and relative sizes of the root refer to (else they hug their content)
//   origin       true: the root at 0, 0
//   designSize   as css.js (constraints)
import { approxMeasurer } from "../layout/measurers.js";
import { boxModel, textStyleOf } from "./css.js";
import { field } from "./schema.js";
import { createResolver } from "./resolve.js";

const INF = Infinity;
const EPS = 1e-6;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const numOr = (v, d) => (finite(v) ? v : d);
const sum = (a) => a.reduce((s, x) => s + x, 0);

/** Clamps a size by a sizing's min and max (min wins, as in CSS). */
const clampBy = (s, v) => Math.max(s.min ?? 0, Math.min(s.max ?? INF, v));

class Solver {
  constructor(opts) {
    this.measurer = opts.measurer || approxMeasurer;
    this.opts = opts;
    this.boxes = new Map();
    this.parents = new Map();
    this.bms = new Map();
    this.memoH = new Map();
    this.memoW = new Map();
    this.text = new Map();
  }

  // --------------------------------------------------------------------------------------------- tree helpers

  index(r, parent) {
    this.parents.set(r.key, parent);
    for (const c of r.children) this.index(c, r);
  }
  bm(r) {
    let b = this.bms.get(r.key);
    if (!b) this.bms.set(r.key, (b = boxModel(r, this.parents.get(r.key) || null, this.opts)));
    return b;
  }
  shown(r) {
    return field(r.node, "visible") !== false;
  }
  flowKids(r) {
    return r.children.filter((c) => this.shown(c) && this.bm(c).pos === "flow");
  }
  absKids(r) {
    return r.children.filter((c) => this.shown(c) && this.bm(c).pos === "abs");
  }
  box(key) {
    let b = this.boxes.get(key);
    if (!b) this.boxes.set(key, (b = { x: 0, y: 0, w: 0, h: 0, px: 0, py: 0, rot: 0 }));
    return b;
  }
  edges(r) {
    const b = this.bm(r);
    return {
      l: b.border[3] + b.pad[3],
      r: b.border[1] + b.pad[1],
      t: b.border[0] + b.pad[0],
      b: b.border[2] + b.pad[2],
    };
  }

  // --------------------------------------------------------------------------------------------- text

  fontOf(base, s) {
    const st = { ...base, ...(isObj(s) ? s : {}) };
    return { family: String(st.font || "Inter"), size: Math.max(0.5, numOr(st.size, 16)), weight: numOr(st.weight, 400), style: st.italic ? "italic" : "normal" };
  }

  /** Line height in px of a style; `inherited` is the parent's computed value for runs without their own. */
  lineHeight(lh, font, inherited) {
    if (lh === undefined) return inherited;
    if (isObj(lh) && finite(lh.pct)) return { px: (lh.pct / 100) * font.size };
    if (isObj(lh) && finite(lh.px)) return { px: lh.px };
    return { normal: true };
  }
  lhPx(lh, font) {
    if (lh.px !== undefined) return lh.px;
    const m = this.measurer.metrics(font);
    return m.ascent + m.descent + (m.lineGap || 0);
  }

  /** Tokens of a text layer: [{ kind: "word"|"space"|"break", text, w, run, lh, font }] (cached per node). */
  tokens(r) {
    let t = this.text.get(r.key);
    if (t) return t;
    const base = textStyleOf(r.node);
    const baseFont = this.fontOf(base);
    const baseLh = this.lineHeight(base.lineHeight ?? { pct: 150 }, baseFont, { normal: true });
    const strut = { font: baseFont, lh: this.lhPx(baseLh, baseFont) };
    const runs = Array.isArray(r.node.text?.runs) ? r.node.text.runs : [];
    const tokens = [];
    let atWordStart = true;
    runs.forEach((run, ri) => {
      const s = isObj(run?.s) ? run.s : {};
      const font = this.fontOf(base, s);
      const lh = this.lhPx(this.lineHeight(s.lineHeight, font, baseLh), font);
      const tracking = numOr(s.tracking ?? base.tracking, 0);
      const kase = s.case ?? base.case;
      let str = typeof run?.t === "string" ? run.t : run?.t == null ? "" : String(run.t);
      if (kase === "upper") str = str.toUpperCase();
      else if (kase === "lower") str = str.toLowerCase();
      for (const part of str.split(/(\n| +)/)) {
        if (!part) continue;
        let text = part;
        if (kase === "title" && /\S/.test(part)) {
          text = atWordStart ? part.charAt(0).toUpperCase() + part.slice(1) : part;
        }
        const kind = part === "\n" ? "break" : /^ +$/.test(part) ? "space" : "word";
        atWordStart = kind !== "word";
        const w = kind === "break" ? 0 : this.measurer.measure(font, text) + tracking * [...text].length;
        tokens.push({ kind, text, w, run: ri, lh, font });
      }
    });
    t = { tokens, strut, align: base.align || "left", maxLines: finite(r.node.text?.maxLines) ? Math.max(1, Math.round(r.node.text.maxLines)) : null, wrap: (r.node.text?.autoSize || "width") !== "width" };
    this.text.set(r.key, t);
    return t;
  }

  /** Breaks a text layer into lines for an available width. */
  lines(r, avail) {
    const { tokens, strut, wrap } = this.tokens(r);
    const lines = [];
    let cur = null;
    const open = () => (cur = { segs: [], content: 0, trailing: 0, lh: strut.lh, fonts: [strut.font] });
    const close = () => {
      lines.push(cur);
      cur = null;
    };
    const add = (tok, text = tok.text, w = tok.w) => {
      const x = cur.content + cur.trailing;
      cur.segs.push({ text, x, w, run: tok.run });
      if (tok.kind === "space") cur.trailing += w;
      else (cur.content = x + w), (cur.trailing = 0);
      cur.lh = Math.max(cur.lh, tok.lh);
      cur.fonts.push(tok.font);
    };
    if (!tokens.length) return { lines: [], strut };
    open();
    for (const tok of tokens) {
      if (tok.kind === "break") {
        close();
        open();
        continue;
      }
      if (tok.kind === "space" || !wrap) {
        add(tok);
        continue;
      }
      if (cur.content > 0 && cur.content + cur.trailing + tok.w > avail + EPS) {
        close();
        open();
      }
      if (cur.content === 0 && cur.trailing === 0 && tok.w > avail + EPS && [...tok.text].length > 1) {
        // overflow-wrap: break-word breaks a word that does not fit on a line of its own
        const chars = [...tok.text];
        const track = (tok.w - this.measurer.measure(tok.font, tok.text)) / chars.length;
        const width = (str) => this.measurer.measure(tok.font, str) + track * [...str].length;
        let piece = "";
        for (const ch of chars) {
          if (piece && width(piece + ch) > avail + EPS) {
            add(tok, piece, width(piece));
            close();
            open();
            piece = ch;
          } else piece += ch;
        }
        if (piece) add(tok, piece, width(piece));
        continue;
      }
      add(tok);
    }
    // a trailing line break does not open an empty last line
    if (cur.segs.length || !lines.length) close();
    else cur = null;
    return { lines, strut };
  }

  /** Max-content and min-content widths of a text layer. */
  textWidths(r) {
    const { tokens, wrap } = this.tokens(r);
    const { lines } = this.lines(r, INF);
    const max = lines.length ? Math.max(...lines.map((l) => l.content)) : 0;
    const min = wrap ? Math.max(0, ...tokens.filter((t) => t.kind === "word").map((t) => t.w)) : max;
    return { max, min };
  }

  layoutText(r, w) {
    const t = this.tokens(r);
    const { lines, strut } = this.lines(r, t.wrap ? w : INF);
    let y = 0;
    const out = [];
    const shown = t.maxLines ? lines.slice(0, t.maxLines) : lines;
    for (const l of shown) {
      const m = this.measurer.metrics(strut.font);
      const baseline = y + (l.lh - (m.ascent + m.descent)) / 2 + m.ascent;
      const free = w - l.content;
      const x = t.align === "center" ? free / 2 : t.align === "right" ? free : 0;
      out.push({ x, y, w: l.content, h: l.lh, baseline, segs: l.segs.filter((s) => s.text.trim() || s.x < l.content) });
      y += l.lh;
    }
    return { lines: out, height: y };
  }

  // --------------------------------------------------------------------------------------------- intrinsic sizes

  /** Max-content border-box width contribution. */
  maxW(r) {
    const s = this.bm(r).w;
    if (s.mode === "fixed") return clampBy(s, s.value);
    return clampBy(s, this.contentW(r, "max"));
  }
  /** Min-content border-box width contribution. */
  minW(r) {
    const s = this.bm(r).w;
    if (s.mode === "fixed") return clampBy(s, s.value);
    return clampBy(s, this.contentW(r, "min"));
  }
  /** fit-content width for an available width. */
  fitW(r, avail) {
    const s = this.bm(r).w;
    const max = this.contentW(r, "max");
    const v = finite(avail) ? Math.min(max, Math.max(this.contentW(r, "min"), avail)) : max;
    return clampBy(s, v);
  }
  contentW(r, kind) {
    const k = `${r.key}|${kind}`;
    if (this.memoW.has(k)) return this.memoW.get(k);
    const e = this.edges(r);
    let v = e.l + e.r;
    if (r.type === "text") v += this.textWidths(r)[kind];
    else {
      const L = this.bm(r).layout;
      const kids = this.flowKids(r);
      const c = (x) => (kind === "max" ? this.maxW(x) : this.minW(x));
      if (L.type === "flex" && kids.length) {
        if (L.dir === "row" && (kind === "max" || !L.wrap)) v += sum(kids.map(c)) + L.gap * (kids.length - 1);
        else v += Math.max(...kids.map(c));
      } else if (L.type === "grid" && kids.length) {
        const g = this.gridColumns(r, null, kind);
        v += sum(g.sizes) + L.gap * Math.max(0, g.sizes.length - 1);
      }
    }
    this.memoW.set(k, v);
    return v;
  }
  /** Content-based border-box height for a border-box width (lays the node out; memoized). */
  contentH(r, w) {
    const k = `${r.key}|${w}`;
    if (this.memoH.has(k)) return this.memoH.get(k);
    const h = this.place(r, w, null);
    this.memoH.set(k, h);
    return h;
  }

  // --------------------------------------------------------------------------------------------- placement

  /** Lays out `r` at border-box width `w` and height `h` (null: from content); returns the height. */
  place(r, w, h) {
    const b = this.bm(r);
    const e = this.edges(r);
    let H = h;
    if (r.type === "text") {
      const t = this.layoutText(r, w);
      if (H === null) H = clampBy(b.h, t.height);
      const box = this.box(r.key);
      box.lines = t.lines;
    } else if (b.layout.type === "flex" && this.isContainer(r)) H = this.flex(r, w, H);
    else if (b.layout.type === "grid" && this.isContainer(r)) H = this.grid(r, w, H);
    else if (H === null) H = clampBy(b.h, e.t + e.b);
    const box = this.box(r.key);
    box.w = w;
    box.h = H;
    box.rot = numOr(field(r.node, "rot"), 0);
    for (const c of this.absKids(r)) this.placeAbs(c, r, w, H);
    for (const c of r.children) if (!this.shown(c)) this.hide(c);
    return H;
  }
  isContainer(r) {
    return ["frame", "component", "componentSet", "instance", "slot"].includes(r.type);
  }
  hide(r) {
    this.boxes.delete(r.key);
    for (const c of r.children) this.hide(c);
  }
  setPos(r, px, py) {
    const b = this.box(r.key);
    b.px = px;
    b.py = py;
  }

  placeAbs(r, parent, W, H) {
    const b = this.bm(r);
    const pb = this.bm(parent).border;
    const pw = W - pb[1] - pb[3];
    const ph = H - pb[0] - pb[2];
    const size = (pl, s, inner, fit) => {
      if (pl.mode === "both") return clampBy(s, inner - pl.start - pl.end);
      if (pl.mode === "scale") return clampBy(s, (inner * pl.size) / 100);
      if (s.mode === "fixed") return clampBy(s, s.value);
      if (s.mode === "rel") return clampBy(s, (inner * s.value) / 100);
      if (s.mode === "fill") return clampBy(s, inner);
      return fit(pl.mode === "start" ? inner - pl.start : pl.mode === "end" ? inner - pl.end : pl.mode === "center" ? inner / 2 - pl.offset : inner);
    };
    const at = (pl, inner, sz) => (pl.mode === "start" || pl.mode === "both" ? pl.start : pl.mode === "end" ? inner - pl.end - sz : pl.mode === "center" ? inner / 2 + pl.offset : (inner * pl.start) / 100);
    const w = size(b.place.x, b.w, pw, (avail) => this.fitW(r, avail));
    let h = size(b.place.y, b.h, ph, () => null);
    if (h === null) h = this.contentH(r, w);
    const x = at(b.place.x, pw, w);
    const y = at(b.place.y, ph, h);
    this.place(r, w, h);
    this.setPos(r, pb[3] + x, pb[0] + y);
  }

  // --------------------------------------------------------------------------------------------- flex

  flex(r, W, Hin) {
    const b = this.bm(r);
    const L = b.layout;
    const e = this.edges(r);
    const row = L.dir === "row";
    const cw = Math.max(0, W - e.l - e.r);
    let H = Hin;
    let ch = H === null ? null : Math.max(0, H - e.t - e.b);
    const items = this.flowKids(r).map((k) => ({ r: k, b: this.bm(k) }));
    const n = items.length;
    for (const it of items) {
      const k = it.r;
      if (row) {
        const s = it.b.w;
        it.flexible = s.mode === "fill";
        it.base = s.mode === "fixed" ? s.value : s.mode === "hug" ? this.fitW(k, cw) : s.mode === "rel" ? (cw * s.value) / 100 : 0;
        it.ms = s;
        it.hyp = clampBy(s, it.base);
      } else {
        const cs = it.b.w;
        it.crossW = cs.mode === "fixed" ? clampBy(cs, cs.value) : cs.mode === "hug" ? this.fitW(k, cw) : cs.mode === "rel" ? clampBy(cs, (cw * cs.value) / 100) : clampBy(cs, cw);
        const s = it.b.h;
        it.flexible = s.mode === "fill";
        it.ms = s;
        it.base = s.mode === "fixed" ? s.value : s.mode === "hug" ? this.contentH(k, it.crossW) : s.mode === "rel" ? (ch !== null ? (ch * s.value) / 100 : this.contentH(k, it.crossW)) : 0;
        it.hyp = clampBy(s, it.base);
        it.contrib = it.flexible ? clampBy(s, this.contentH(k, it.crossW)) : it.hyp;
      }
    }
    // the main size of an auto-height column comes from the items' contributions
    if (!row && H === null) {
      H = clampBy(b.h, sum(items.map((it) => it.contrib)) + L.gap * Math.max(0, n - 1) + e.t + e.b);
      ch = Math.max(0, H - e.t - e.b);
    }
    const mainAvail = row ? cw : ch;
    // lines
    const lines = [];
    if (L.wrap && n) {
      let cur = [];
      let used = 0;
      for (const it of items) {
        const add = (cur.length ? L.gap : 0) + it.hyp;
        if (cur.length && used + add > mainAvail + EPS) {
          lines.push(cur);
          cur = [];
          used = 0;
        }
        used += (cur.length ? L.gap : 0) + it.hyp;
        cur.push(it);
      }
      if (cur.length) lines.push(cur);
    } else if (n) lines.push(items);
    for (const line of lines) this.resolveFlexible(line, mainAvail - L.gap * (line.length - 1));
    // cross sizes
    const single = !L.wrap;
    for (const line of lines) {
      for (const it of line) {
        const k = it.r;
        if (row) {
          const s = it.b.h;
          it.stretch = s.mode === "fill";
          it.cross = s.mode === "fixed" ? clampBy(s, s.value) : s.mode === "rel" && ch !== null ? clampBy(s, (ch * s.value) / 100) : clampBy(s, this.contentH(k, it.main));
        } else {
          it.stretch = it.b.w.mode === "fill";
          it.cross = it.crossW;
        }
      }
      line.cross = Math.max(0, ...line.map((it) => it.cross));
      if (row && L.align === "baseline") {
        for (const it of line) it.baseline = it.stretch ? null : this.baselineOf(it.r, it.main, it.cross);
        const bl = line.filter((it) => it.baseline !== null);
        if (bl.length) {
          line.maxBase = Math.max(...bl.map((it) => it.baseline));
          line.cross = Math.max(line.cross, ...bl.map((it) => line.maxBase - it.baseline + it.cross));
        }
      }
    }
    if (row && H === null) {
      H = clampBy(b.h, sum(lines.map((l) => l.cross)) + L.rowGap * Math.max(0, lines.length - 1) + e.t + e.b);
      ch = Math.max(0, H - e.t - e.b);
    }
    const crossInner = row ? ch : cw;
    if (single && lines.length) lines[0].cross = crossInner;
    // align-content
    let crossStart = 0;
    let between = L.rowGap;
    if (!single && lines.length) {
      const free = crossInner - sum(lines.map((l) => l.cross)) - L.rowGap * (lines.length - 1);
      const ac = L.alignContent;
      if (ac === "stretch" && free > 0) for (const l of lines) l.cross += free / lines.length;
      else if (ac === "center") crossStart = free / 2;
      else if (ac === "end") crossStart = free;
      else if (ac === "space-between" && free > 0 && lines.length > 1) between += free / (lines.length - 1);
      else if (ac === "space-around") free > 0 ? ((between += free / lines.length), (crossStart = free / lines.length / 2)) : (crossStart = free / 2);
      else if (ac === "space-evenly") free > 0 ? ((between += free / (lines.length + 1)), (crossStart = free / (lines.length + 1))) : (crossStart = free / 2);
      else if (ac === "space-between" && free < 0) crossStart = 0;
    }
    // positions
    let cpos = crossStart;
    for (const line of lines) {
      const used = sum(line.map((it) => it.main)) + L.gap * (line.length - 1);
      const free = mainAvail - used;
      let start = 0;
      let gap = L.gap;
      const m = line.length;
      if (L.justify === "center") start = free / 2;
      else if (L.justify === "end") start = free;
      else if (L.justify === "space-between") gap += free > 0 && m > 1 ? free / (m - 1) : 0;
      else if (L.justify === "space-around") free > 0 ? ((gap += free / m), (start = free / m / 2)) : (start = free / 2);
      else if (L.justify === "space-evenly") free > 0 ? ((gap += free / (m + 1)), (start = free / (m + 1))) : (start = free / 2);
      let mpos = start;
      for (const it of line) {
        let cross = it.cross;
        let off = 0;
        if (it.stretch) {
          cross = clampBy(row ? it.b.h : it.b.w, line.cross);
        } else {
          const a = L.align === "stretch" ? "start" : L.align;
          if (a === "center") off = (line.cross - cross) / 2;
          else if (a === "end") off = line.cross - cross;
          else if (a === "baseline" && row && it.baseline !== null && line.maxBase !== undefined) off = line.maxBase - it.baseline;
        }
        if (row) {
          this.place(it.r, it.main, cross);
          this.setPos(it.r, e.l + mpos, e.t + cpos + off);
        } else {
          this.place(it.r, cross, it.main);
          this.setPos(it.r, e.l + cpos + off, e.t + mpos);
        }
        mpos += it.main + gap;
      }
      cpos += line.cross + between;
    }
    return H;
  }

  /** CSS "resolve the flexible lengths" for one line; fill items have flex 1 1 0, the others are frozen. */
  resolveFlexible(line, avail) {
    for (const it of line) {
      it.frozen = !it.flexible;
      it.main = it.frozen ? it.hyp : 0;
    }
    const growing = sum(line.map((it) => it.hyp)) < avail;
    if (!growing) {
      for (const it of line) if (it.flexible) it.main = clampBy(it.ms, 0);
      return;
    }
    for (let guard = 0; guard < line.length + 2; guard++) {
      const open = line.filter((it) => !it.frozen);
      if (!open.length) break;
      const free = avail - sum(line.map((it) => (it.frozen ? it.main : it.base)));
      let total = 0;
      for (const it of open) {
        const target = it.base + Math.max(0, free) / open.length;
        it.main = clampBy(it.ms, target);
        it.violation = it.main - target;
        total += it.violation;
      }
      if (Math.abs(total) < EPS) {
        for (const it of open) it.frozen = true;
        break;
      }
      for (const it of open) if ((total > 0 && it.violation > 0) || (total < 0 && it.violation < 0)) it.frozen = true;
    }
  }

  /** First baseline of a laid-out layer (from its top edge), for baseline alignment. */
  baselineOf(r, w, h) {
    if (r.type === "text") {
      const t = this.layoutText(r, w);
      return t.lines.length ? t.lines[0].baseline : h;
    }
    const kids = this.flowKids(r);
    if (kids.length && this.isContainer(r)) {
      this.place(r, w, h);
      const k = kids[0];
      const kb = this.boxes.get(k.key);
      if (kb) return kb.py + this.baselineOf(k, kb.w, kb.h);
    }
    return h;
  }

  // --------------------------------------------------------------------------------------------- grid

  /** Places grid items: [{ r, col, row, colSpan, rowSpan }] and the track counts. */
  gridPlacement(r) {
    const G = this.bm(r).layout.grid;
    const items = this.flowKids(r).map((k) => {
      const c = isObj(k.node.cell) ? k.node.cell : {};
      const int = (v) => (finite(v) && v >= 1 ? Math.round(v) - 1 : null);
      return { r: k, col: int(c.col), row: int(c.row), colSpan: finite(c.colSpan) && c.colSpan > 1 ? Math.round(c.colSpan) : 1, rowSpan: finite(c.rowSpan) && c.rowSpan > 1 ? Math.round(c.rowSpan) : 1 };
    });
    const byRow = G.autoFlow !== "column";
    // work in (major, minor) coordinates: rows and columns for row flow
    const [maj, min, majS, minS] = byRow ? ["row", "col", "rowSpan", "colSpan"] : ["col", "row", "colSpan", "rowSpan"];
    const minorCount0 = byRow ? G.cols.length : G.rows.length || 1;
    const used = new Set();
    const fits = (a, b, sa, sb) => {
      for (let i = a; i < a + sa; i++) for (let j = b; j < b + sb; j++) if (used.has(`${i},${j}`)) return false;
      return true;
    };
    const mark = (it) => {
      for (let i = it[maj]; i < it[maj] + it[majS]; i++) for (let j = it[min]; j < it[min] + it[minS]; j++) used.add(`${i},${j}`);
    };
    for (const it of items) if (it[maj] !== null && it[min] !== null) mark(it);
    let minorCount = Math.max(minorCount0, ...items.map((it) => (it[min] !== null ? it[min] + it[minS] : it[minS])));
    // items with a definite major position only
    const rowCursor = new Map();
    for (const it of items) {
      if (it[maj] === null || it[min] !== null) continue;
      let c = G.dense ? 0 : rowCursor.get(it[maj]) || 0;
      while (!fits(it[maj], c, it[majS], it[minS])) c++;
      it[min] = c;
      minorCount = Math.max(minorCount, c + it[minS]);
      rowCursor.set(it[maj], c + it[minS]);
      mark(it);
    }
    let cm = 0;
    let cn = 0;
    for (const it of items) {
      if (it[maj] !== null) continue;
      if (G.dense) (cm = 0), (cn = 0);
      if (it[min] !== null) {
        if (it[min] < cn) cm++;
        cn = it[min];
        while (!fits(cm, cn, it[majS], it[minS])) cm++;
        it[maj] = cm;
      } else {
        for (;;) {
          let placed = false;
          for (let c = cn; c + it[minS] <= Math.max(minorCount, it[minS]); c++) {
            if (fits(cm, c, it[majS], it[minS])) {
              it[min] = c;
              it[maj] = cm;
              placed = true;
              break;
            }
          }
          if (placed) break;
          cm++;
          cn = 0;
        }
      }
      cn = it[min] + it[minS];
      mark(it);
    }
    const majorCount = Math.max(byRow ? G.rows.length : G.cols.length, ...items.map((it) => it[maj] + it[majS]), 0);
    return { items, cols: byRow ? minorCount : majorCount, rows: byRow ? majorCount : minorCount };
  }

  /**
   * CSS grid track sizing on one axis.
   * @param {object[]} defs  explicit tracks (missing ones are implicit `auto`)
   * @param {number} count
   * @param {{ start: number, span: number, min: number, max: number }[]} items  contributions
   * @param {number|null} avail  inner size, null when indefinite
   * @param {number} gap
   * @param {string} content  content distribution ("start" or "space-…": no auto-track stretching)
   */
  tracks(defs, count, items, avail, gap, content = "normal") {
    const parse = (t) => {
      const fn = (x, isMin) => {
        if (finite(x)) return { px: x };
        if (!isObj(x)) return { auto: true };
        if (finite(x.px)) return { px: x.px };
        if (finite(x.fr)) return isMin ? { auto: true } : { fr: Math.max(0, x.fr) };
        return { auto: true };
      };
      if (isObj(t) && Array.isArray(t.minmax) && t.minmax.length === 2) return { min: fn(t.minmax[0], true), max: fn(t.minmax[1], false) };
      if (isObj(t) && finite(t.fr)) return { min: { auto: true }, max: { fr: Math.max(0, t.fr) } };
      if (isObj(t) && finite(t.px)) return { min: { px: t.px }, max: { px: t.px } };
      return { min: { auto: true }, max: { auto: true } };
    };
    const T = [];
    for (let i = 0; i < count; i++) {
      const p = parse(defs[i]);
      const base = p.min.px ?? 0;
      T.push({ ...p, base, limit: p.max.px !== undefined ? Math.max(p.max.px, base) : p.max.auto ? -1 : base });
    }
    const flex = (t) => t.max.fr !== undefined;
    // single-span items
    for (const it of items.filter((x) => x.span === 1)) {
      const t = T[it.start];
      if (!t) continue;
      if (t.min.auto) t.base = Math.max(t.base, it.min);
      if (t.max.auto) t.limit = Math.max(t.limit, it.max);
    }
    // spanning items (not crossing flexible tracks): distribute what is missing equally
    for (const it of items.filter((x) => x.span > 1).sort((a, b) => a.span - b.span)) {
      const ts = T.slice(it.start, it.start + it.span);
      if (ts.some(flex)) continue;
      const g = gap * (it.span - 1);
      const auto = ts.filter((t) => t.min.auto);
      const needBase = it.min - sum(ts.map((t) => t.base)) - g;
      if (needBase > 0 && auto.length) for (const t of auto) t.base += needBase / auto.length;
      const autoMax = ts.filter((t) => t.max.auto);
      const needLimit = it.max - sum(ts.map((t) => (t.limit < 0 ? t.base : t.limit))) - g;
      if (needLimit > 0 && autoMax.length) for (const t of autoMax) t.limit = Math.max(t.limit < 0 ? t.base : t.limit, t.base) + needLimit / autoMax.length;
    }
    // items crossing flexible tracks: their minimum contributions raise the bases of auto-minimum flexible tracks
    for (const it of items) {
      const ts = T.slice(it.start, it.start + it.span).filter(flex);
      if (!ts.length) continue;
      const all = T.slice(it.start, it.start + it.span);
      const need = it.min - sum(all.map((t) => t.base)) - gap * (it.span - 1);
      const autos = ts.filter((t) => t.min.auto);
      if (need > 0 && autos.length) for (const t of autos) t.base += need / autos.length;
    }
    for (const t of T) {
      if (t.limit < 0) t.limit = t.base;
      if (t.limit < t.base) t.limit = t.base;
    }
    const gaps = gap * Math.max(0, count - 1);
    // maximize tracks
    const growable = T.filter((t) => !flex(t));
    if (avail === null) for (const t of growable) t.base = t.limit;
    else {
      for (let guard = 0; guard < count + 2; guard++) {
        const free = avail - gaps - sum(T.map((t) => t.base));
        const open = growable.filter((t) => t.base < t.limit - EPS);
        if (free <= EPS || !open.length) break;
        const share = free / open.length;
        for (const t of open) t.base = Math.min(t.limit, t.base + share);
      }
    }
    // flexible tracks
    const flexT = T.filter(flex);
    if (flexT.length) {
      let fr;
      if (avail !== null) {
        let active = flexT.slice();
        for (let guard = 0; guard < flexT.length + 2; guard++) {
          const left = avail - gaps - sum(T.filter((t) => !active.includes(t)).map((t) => t.base));
          const fs = Math.max(1, sum(active.map((t) => t.max.fr)));
          fr = Math.max(0, left) / fs;
          const inflexible = active.filter((t) => t.base > fr * t.max.fr + EPS);
          if (!inflexible.length) break;
          active = active.filter((t) => !inflexible.includes(t));
          if (!active.length) break;
        }
      } else {
        fr = 0;
        for (const t of flexT) fr = Math.max(fr, t.max.fr > 1 ? t.base / t.max.fr : t.base);
        for (const it of items) {
          const ts = T.slice(it.start, it.start + it.span);
          const fts = ts.filter(flex);
          if (!fts.length) continue;
          const fixed = sum(ts.filter((t) => !flex(t)).map((t) => t.base)) + gap * (it.span - 1);
          const fs = Math.max(1, sum(fts.map((t) => t.max.fr)));
          fr = Math.max(fr, (it.max - fixed) / fs);
        }
      }
      for (const t of flexT) t.base = Math.max(t.base, fr * t.max.fr);
    }
    // stretch auto tracks
    if (avail !== null && (content === "normal" || content === "stretch")) {
      const free = avail - gaps - sum(T.map((t) => t.base));
      const autos = T.filter((t) => t.max.auto);
      if (free > EPS && autos.length) for (const t of autos) t.base += free / autos.length;
    }
    return T.map((t) => t.base);
  }

  gridColumns(r, avail, kind = "max") {
    const L = this.bm(r).layout;
    const P = this.gridPlacement(r);
    const items = P.items.map((it) => {
      const s = it.r && this.bm(it.r).w;
      const fixed = s.mode === "fixed";
      return { start: it.col, span: it.colSpan, min: fixed ? this.maxW(it.r) : 0, max: kind === "max" ? this.maxW(it.r) : this.minW(it.r) };
    });
    const content = L.justify.startsWith("space-") ? L.justify : "normal";
    return { P, sizes: this.tracks(L.grid.cols, P.cols, items, avail, L.gap, content) };
  }

  grid(r, W, Hin) {
    const b = this.bm(r);
    const L = b.layout;
    const e = this.edges(r);
    const cw = Math.max(0, W - e.l - e.r);
    let H = Hin;
    const { P, sizes: cols } = this.gridColumns(r, cw);
    const offsets = (sizes, avail, gap, content) => {
      const total = sum(sizes) + gap * Math.max(0, sizes.length - 1);
      const free = avail === null ? 0 : avail - total;
      let start = 0;
      let g = gap;
      const m = sizes.length;
      if (free > 0 && m) {
        if (content === "center") start = free / 2;
        else if (content === "end") start = free;
        else if (content === "space-between" && m > 1) g += free / (m - 1);
        else if (content === "space-around") (g += free / m), (start = free / m / 2);
        else if (content === "space-evenly") (g += free / (m + 1)), (start = free / (m + 1));
      }
      const out = [];
      let p = start;
      for (const s of sizes) out.push(p), (p += s + g);
      return { at: out, gap: g };
    };
    const colContent = L.justify.startsWith("space-") ? L.justify : "normal";
    const colOff = offsets(cols, cw, L.gap, colContent);
    const span = (sizes, off, start, n) => off.at[start + n - 1] + sizes[start + n - 1] - off.at[start];
    const items = P.items.map((it) => {
      const s = this.bm(it.r).w;
      const area = span(cols, colOff, it.col, it.colSpan);
      const w = s.mode === "fill" ? clampBy(s, area) : s.mode === "fixed" ? clampBy(s, s.value) : s.mode === "rel" ? clampBy(s, (area * s.value) / 100) : this.fitW(it.r, area);
      return { ...it, area, w };
    });
    const rowItems = items.map((it) => {
      const s = this.bm(it.r).h;
      const fixed = s.mode === "fixed";
      const content = fixed ? clampBy(s, s.value) : clampBy(s, this.contentH(it.r, it.w));
      return { start: it.row, span: it.rowSpan, min: fixed ? content : 0, max: content };
    });
    const ch0 = H === null ? null : Math.max(0, H - e.t - e.b);
    const rowContent = L.alignContent && L.alignContent !== "start" ? L.alignContent : "normal";
    const rows = this.tracks(L.grid.rows, P.rows, rowItems, ch0, L.rowGap, rowContent === "stretch" ? "normal" : rowContent);
    if (H === null) H = clampBy(b.h, sum(rows) + L.rowGap * Math.max(0, rows.length - 1) + e.t + e.b);
    const ch = Math.max(0, H - e.t - e.b);
    const rowOff = offsets(rows, ch, L.rowGap, rowContent);
    for (const it of items) {
      const k = it.r;
      const cell = isObj(k.node.cell) ? k.node.cell : {};
      const sw = this.bm(k).w;
      const sh = this.bm(k).h;
      const areaH = span(rows, rowOff, it.row, it.rowSpan);
      let jx = cell.justifySelf && cell.justifySelf !== "auto" ? cell.justifySelf : L.justify === "center" || L.justify === "end" ? L.justify : "start";
      let ay = cell.alignSelf && cell.alignSelf !== "auto" ? cell.alignSelf : L.align === "stretch" ? "start" : L.align === "baseline" ? "start" : L.align;
      const w = it.w;
      let h;
      if (sh.mode === "fill" || (ay === "stretch" && sh.mode === "hug")) h = clampBy(sh, areaH), (ay = "start");
      else if (sh.mode === "fixed") h = clampBy(sh, sh.value);
      else if (sh.mode === "rel") h = clampBy(sh, (areaH * sh.value) / 100);
      else h = clampBy(sh, this.contentH(k, w));
      if (sw.mode === "fill") jx = "start";
      const dx = jx === "center" ? (it.area - w) / 2 : jx === "end" ? it.area - w : 0;
      const dy = ay === "center" ? (areaH - h) / 2 : ay === "end" ? areaH - h : 0;
      this.place(k, w, h);
      this.setPos(k, e.l + colOff.at[it.col] + dx, e.t + rowOff.at[it.row] + dy);
    }
    return H;
  }

  // --------------------------------------------------------------------------------------------- root

  root(r) {
    const b = this.bm(r);
    const vp = this.opts.viewport;
    const s = b.w;
    let w;
    if (s.mode === "fixed") w = clampBy(s, s.value);
    else if (s.mode === "fill" && vp) w = clampBy(s, vp.w);
    else if (s.mode === "rel" && vp) w = clampBy(s, (vp.w * s.value) / 100);
    else w = this.fitW(r, INF);
    const sh = b.h;
    let h = null;
    if (sh.mode === "fixed") h = clampBy(sh, sh.value);
    else if (sh.mode === "fill" && vp) h = clampBy(sh, vp.h);
    else if (sh.mode === "rel" && vp) h = clampBy(sh, (vp.h * sh.value) / 100);
    this.place(r, w, h);
    const origin = this.opts.origin === true;
    this.setPos(r, origin ? 0 : numOr(field(r.node, "x"), 0), origin ? 0 : numOr(field(r.node, "y"), 0));
  }

  absolute(r, ox, oy) {
    const b = this.boxes.get(r.key);
    if (!b) return;
    b.x = ox + b.px;
    b.y = oy + b.py;
    for (const c of r.children) this.absolute(c, b.x, b.y);
  }
}

/**
 * Lays out a resolved tree.
 * @param {object} root a resolved node (resolve.js)
 * @param {{ measurer?: object, viewport?: { w: number, h: number }, origin?: boolean, designSize?: Function }} [opts]
 */
export function layout(root, opts = {}) {
  const S = new Solver(opts);
  const boxes = new Map();
  if (root && field(root.node, "visible") !== false) {
    S.index(root, null);
    S.root(root);
    S.absolute(root, 0, 0);
    // stable pre-order output
    const visit = (r) => {
      const b = S.boxes.get(r.key);
      if (!b) return;
      boxes.set(r.key, b);
      for (const c of r.children) visit(c);
    };
    visit(root);
  }
  return { approximate: true, root: root?.key ?? null, boxes };
}

/** Resolves a node of a model and lays it out (options go to the resolver and the solver). */
export function layoutNode(model, id, opts = {}) {
  const root = createResolver(model, opts).tree(id);
  return layout(root, opts);
}
