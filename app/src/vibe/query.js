// Pure helpers behind the Vibe power tools (tools/power.js): layer queries, step references for run_plan, the
// compact scene-graph text format and result paging/projection. No DOM, no app: the tools turn nodes into plain
// "facts" objects first, so everything here is unit-testable.
//
// Facts: { id, type, name, x, y, w, h, fill, stroke, text, visible, locked, opacity, parentId, depth, childCount }
//
// Query (all optional, AND-combined):
//   { selector: 'rect[name^="Card"][w>100], text[text*="sale"]', type: "rect"|["rect","ellipse"], name: "Card*" (glob),
//     fill: "#3b82f6", text: "sale" (contains, case-insensitive), within: {x,y,w,h}, intersects: {x,y,w,h},
//     parent: "<group id>", visible: true, locked: false, minW, maxW, minH, maxH }
// Selector grammar: comma-separated alternatives of TYPE? followed by [attr OP value] filters, OP in
//   = (equals; globs with * ?), != , *= (contains), ^= (starts), $= (ends), > , >= , < , <= .

const r1 = (n) => Math.round(n * 10) / 10;

/** Glob (* and ?) to a case-insensitive RegExp. */
export function globToRegExp(glob) {
  const s = String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${s}$`, "i");
}

/** Parses a selector string into alternatives: [{ type?, filters:[{attr,op,value}] }]. Throws with a fix hint. */
export function parseSelector(sel) {
  const out = [];
  for (const part of splitTop(String(sel || ""))) {
    const p = part.trim();
    if (!p) continue;
    const m = /^([a-z*][a-z0-9-]*)?/i.exec(p);
    const type = m[1] && m[1] !== "*" ? m[1].toLowerCase() : undefined;
    let rest = p.slice(m[0].length);
    const filters = [];
    const re = /^\s*\[\s*([a-zA-Z]+)\s*(\*=|\^=|\$=|!=|>=|<=|=|>|<)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*))\s*\]/;
    while (rest.trim()) {
      const f = re.exec(rest);
      if (!f) throw new Error(`Cannot parse the selector near “${rest.trim().slice(0, 30)}”. Use e.g. rect[name^="Card"][w>100], text[text*="sale"].`);
      const raw = f[3] ?? f[4] ?? f[5] ?? "";
      filters.push({ attr: f[1], op: f[2], value: raw });
      rest = rest.slice(f[0].length);
    }
    out.push({ type, filters });
  }
  return out;
}

function splitTop(s) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

const norm = (v) => (v == null ? "" : String(v).toLowerCase());
function cmp(actual, op, value) {
  if (op === ">" || op === ">=" || op === "<" || op === "<=") {
    const a = Number(actual);
    const b = Number(value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;
  }
  const a = norm(actual);
  const b = norm(value);
  switch (op) {
    case "=":
      return /[*?]/.test(b) ? globToRegExp(b).test(a) : a === b;
    case "!=":
      return a !== b;
    case "*=":
      return a.includes(b);
    case "^=":
      return a.startsWith(b);
    case "$=":
      return a.endsWith(b);
    default:
      return false;
  }
}

const inside = (f, r) => f.w != null && f.x >= r.x && f.y >= r.y && f.x + f.w <= r.x + r.w && f.y + f.h <= r.y + r.h;
const overlaps = (f, r) => f.w != null && f.x < r.x + r.w && f.x + f.w > r.x && f.y < r.y + r.h && f.y + f.h > r.y;

/** Does one facts object match the query? */
export function matchFacts(f, q, compiled = compileQuery(q)) {
  const c = compiled;
  if (c.types && !c.types.has(f.type)) return false;
  if (c.name && !c.name.test(f.name || "")) return false;
  if (c.fill && norm(f.fill).slice(0, 7) !== c.fill) return false;
  if (c.text && !norm(f.text).includes(c.text)) return false;
  if (q.parent && f.parentId !== q.parent && !(f.ancestors || []).includes(q.parent)) return false;
  if (q.visible != null && (f.visible !== false) !== q.visible) return false;
  if (q.locked != null && !!f.locked !== q.locked) return false;
  if (q.within && !inside(f, q.within)) return false;
  if (q.intersects && !overlaps(f, q.intersects)) return false;
  for (const [k, op] of [["minW", ">="], ["maxW", "<="], ["minH", ">="], ["maxH", "<="]]) if (q[k] != null && !cmp(k.endsWith("W") ? f.w : f.h, op, q[k])) return false;
  if (c.selector) {
    const ok = c.selector.some((alt) => (!alt.type || alt.type === f.type) && alt.filters.every((x) => cmp(f[x.attr], x.op, x.value)));
    if (!ok) return false;
  }
  return true;
}

/** Pre-compiles a query (validates it once). */
export function compileQuery(q = {}) {
  const types = q.type ? new Set((Array.isArray(q.type) ? q.type : [q.type]).map((t) => String(t).toLowerCase())) : null;
  return {
    types,
    name: q.name ? globToRegExp(q.name) : null,
    fill: q.fill ? norm(q.fill).slice(0, 7) : null,
    text: q.text ? norm(q.text) : null,
    selector: q.selector ? parseSelector(q.selector) : null,
  };
}

/** Filters a facts list; returns ids (and facts when `withFacts`). */
export function queryFacts(facts, q) {
  const c = compileQuery(q);
  return facts.filter((f) => matchFacts(f, q, c));
}

// ------------------------------------------------------------------ paging and projection

/**
 * Applies offset/limit and an optional field projection to a list.
 * @returns {{items:any[], total:number, offset:number, limit:number, more:boolean}}
 */
export function page(list, { offset = 0, limit = 50, fields } = {}) {
  const total = list.length;
  const o = Math.max(0, offset | 0);
  const l = Math.max(1, Math.min(500, limit | 0 || 50));
  let items = list.slice(o, o + l);
  if (fields?.length) items = items.map((x) => Object.fromEntries(fields.filter((k) => k in x).map((k) => [k, x[k]])));
  return { items, total, offset: o, limit: l, more: o + l < total };
}

// ------------------------------------------------------------------ run_plan references

/** Reads `a.b[0].c` / `a.b.0.c` from an object. */
export function getPath(obj, path) {
  const keys = String(path).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const k of keys) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Replaces {"$ref": "step.path"} objects (and whole-string "$ref:step.path") inside `value` with earlier results.
 * `results` maps step ids (and "1", "2", ... 1-based indexes) to parsed results. Throws a helpful error for bad refs.
 */
export function resolveRefs(value, results) {
  const lookup = (ref) => {
    const s = String(ref);
    const dot = s.search(/[.[]/);
    const step = dot < 0 ? s : s.slice(0, dot);
    const rest = dot < 0 ? "" : s.slice(dot).replace(/^\./, "");
    if (!(step in results)) throw new Error(`$ref “${s}”: there is no earlier step “${step}”. Known steps: ${Object.keys(results).join(", ") || "none"}.`);
    const v = rest ? getPath(results[step], rest) : results[step];
    if (v === undefined) throw new Error(`$ref “${s}”: step “${step}” has no “${rest}”. Its result keys: ${Object.keys(results[step] || {}).join(", ") || "(not an object)"}.`);
    return v;
  };
  const walk = (v) => {
    if (typeof v === "string" && v.startsWith("$ref:")) return lookup(v.slice(5));
    if (Array.isArray(v)) return v.flatMap((x) => {
      const r = walk(x);
      // a ref to an array inside an array of ids splices in
      return x && typeof x === "object" && "$ref" in x && Array.isArray(r) ? r : [r];
    });
    if (v && typeof v === "object") {
      if (typeof v.$ref === "string" && Object.keys(v).length === 1) return lookup(v.$ref);
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value);
}

/** Parses a tool result into something refs can read (JSON text -> object; blocks -> their text). */
export function resultValue(r) {
  if (typeof r === "string") {
    try {
      return JSON.parse(r);
    } catch {
      return r;
    }
  }
  if (Array.isArray(r) && r.every((b) => b && (b.type === "text" || b.type === "image"))) return r.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return r;
}

// ------------------------------------------------------------------ compact scene graph

/**
 * Token-efficient scene text: one line per layer, two spaces of indent per depth.
 *   <id> <type> "<name>" <x>,<y> <w>x<h> [fill=#hex] [stroke=#hex/2] [text="…"] [hidden] [locked] [op=0.5] [+N children]
 * About 4-6x smaller than the list_layers JSON for the same tree.
 * @param {object[]} tree facts objects with optional `children` arrays
 * @param {{maxDepth?:number, maxLines?:number, textLen?:number}} [o]
 */
export function sceneText(tree, { maxDepth = 4, maxLines = 400, textLen = 40 } = {}) {
  const lines = [];
  let cut = 0;
  const visit = (f, d) => {
    if (lines.length >= maxLines) {
      cut++;
      return;
    }
    const parts = [`${"  ".repeat(d)}${f.id} ${f.type}`];
    if (f.name && f.name !== f.type) parts.push(JSON.stringify(f.name));
    if (f.w != null) parts.push(`${r1(f.x)},${r1(f.y)} ${r1(f.w)}x${r1(f.h)}`);
    if (f.fill) parts.push(`fill=${String(f.fill).replace(/\s+/g, "")}`);
    if (f.stroke) parts.push(`stroke=${String(f.stroke).replace(/\s+/g, "")}`);
    if (f.text) parts.push(`text=${JSON.stringify(f.text.length > textLen ? f.text.slice(0, textLen - 1) + "…" : f.text)}`);
    if (f.visible === false) parts.push("hidden");
    if (f.locked) parts.push("locked");
    if (f.opacity != null && f.opacity < 1) parts.push(`op=${r1(f.opacity)}`);
    const kids = f.children || [];
    if (kids.length && d >= maxDepth) parts.push(`+${kids.length} children`);
    lines.push(parts.join(" "));
    if (d < maxDepth) for (const c of kids) visit(c, d + 1);
  };
  for (const f of tree) visit(f, 0);
  if (cut) lines.push(`… ${cut} more layers (narrow with query_layers or a parent id)`);
  return lines.join("\n");
}

/** Equal-cell grid inside an area: returns [{x,y,w,h,row,col}] (row-major). */
export function gridCells({ x = 0, y = 0, w, h, columns = 1, rows, gap = 0, rowGap, colGap, count }) {
  const cols = Math.max(1, Math.round(columns));
  const n = count ?? cols * Math.max(1, rows || 1);
  const rws = Math.max(1, rows || Math.ceil(n / cols));
  const cg = colGap ?? gap;
  const rg = rowGap ?? gap;
  const cw = (w - cg * (cols - 1)) / cols;
  const ch = (h - rg * (rws - 1)) / rws;
  if (!(cw > 0) || !(ch > 0)) throw new Error(`The area ${w}x${h} is too small for ${cols} columns x ${rws} rows with gap ${gap}.`);
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    out.push({ x: x + col * (cw + cg), y: y + row * (ch + rg), w: cw, h: ch, row, col });
  }
  return out;
}

/** Positions for distributing boxes along an axis with equal gaps (keeps the outer two in place unless `gap` given). */
export function distribute(boxes, axis = "x", gap) {
  const k = axis === "x" ? "x" : "y";
  const s = axis === "x" ? "w" : "h";
  const sorted = boxes.map((b, i) => ({ ...b, i })).sort((a, b) => a[k] - b[k]);
  if (sorted.length < 2) return boxes.map((b) => b[k]);
  const total = sorted.reduce((n, b) => n + b[s], 0);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const g = gap ?? (last[k] + last[s] - first[k] - total) / (sorted.length - 1);
  const out = new Array(boxes.length);
  let pos = first[k];
  for (const b of sorted) {
    out[b.i] = pos;
    pos += b[s] + g;
  }
  return out;
}

/** Nearest names (for "did you mean" hints in errors). */
export function nearest(name, candidates, n = 3) {
  const d = (a, b) => {
    const m = a.length;
    const k = b.length;
    const row = Array.from({ length: k + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= k; j++) {
        const tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[k];
  };
  return [...candidates].map((c) => [c, d(String(name), String(c))]).sort((a, b) => a[1] - b[1]).slice(0, n).map((x) => x[0]);
}
