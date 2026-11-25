// The static path of the HTML importer (docs/concepts/proto-studio.md §10.4, task T8): what the sandboxed preview
// reports in the app, computed here without a browser for the CLI and for Node. Pure.
//
//   staticProbe(html, { width, report }) → probe tree (the shape html.js ▸ mapProbe reads; boxes are absent)
//
// A simple cascade: the user agent defaults that matter for layout, <style> rules and style attributes, selectors
// made of tags, classes, ids, attributes, :root, :first-child, :last-child, :nth-child(n) and :not() with the
// descendant, child and sibling combinators, specificity and !important, inheritance of text properties, @media
// min-width / max-width against the chosen width, and `var()` with fallbacks. Shorthands are expanded (padding,
// margin, border, border-radius, gap, flex, grid-column, grid-row, background, inset, font). Unsupported selectors
// (states such as :hover, pseudo-elements) skip their rule and are counted in the report. Results are approximate.
import { parseHtml, decodeEntities, getAttr, classList } from "../../web/html.js";
import { parseCss, flattenRules, splitSelectorList, selectorSpecificity } from "../../web/css.js";
import { serializeElement } from "./sanitize.js";

const BLOCK = new Set(["html", "body", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "header", "footer", "main", "nav", "section", "article", "aside", "ul", "ol", "li", "form", "fieldset", "figure", "figcaption", "blockquote", "pre", "hr", "address", "details", "summary", "dl", "dt", "dd", "legend", "menu"]);
const HIDDEN = new Set(["head", "title", "style", "meta", "script", "template", "link", "noscript", "datalist", "option"]);
const INLINE_BLOCK = new Set(["img", "button", "input", "select", "textarea", "svg", "video", "canvas", "progress", "meter"]);
const INHERITED = ["color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "white-space", "visibility", "text-decoration-line"];
const HEAD = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67 };
const HEAD_MARGIN = { h1: 0.67, h2: 0.83, h3: 1, h4: 1.33, h5: 1.67, h6: 2.33 };

/** User agent declarations per tag (only what changes layout or text). */
function uaStyle(tag, fs) {
  const s = {};
  if (BLOCK.has(tag)) s.display = "block";
  else if (tag === "table") s.display = "table";
  else if (tag === "tr") s.display = "table-row";
  else if (tag === "td" || tag === "th") s.display = "table-cell";
  else if (tag === "thead" || tag === "tbody" || tag === "tfoot") s.display = "table-row-group";
  else if (INLINE_BLOCK.has(tag)) s.display = "inline-block";
  else s.display = "inline";
  if (tag === "li") s.display = "list-item";
  if (tag === "body") s["margin-top"] = s["margin-right"] = s["margin-bottom"] = s["margin-left"] = "8px";
  if (HEAD[tag]) {
    s["font-size"] = `${HEAD[tag]}em`;
    s["font-weight"] = "700";
    s["margin-top"] = s["margin-bottom"] = `${HEAD_MARGIN[tag]}em`;
  }
  if (tag === "p" || tag === "blockquote" || tag === "figure" || tag === "dl" || tag === "pre") s["margin-top"] = s["margin-bottom"] = "1em";
  if (tag === "ul" || tag === "ol" || tag === "menu") Object.assign(s, { "margin-top": "1em", "margin-bottom": "1em", "padding-left": "40px" });
  if (tag === "blockquote" || tag === "figure") s["margin-left"] = s["margin-right"] = "40px";
  if (tag === "b" || tag === "strong" || tag === "th") s["font-weight"] = "700";
  if (tag === "em" || tag === "i" || tag === "cite") s["font-style"] = "italic";
  if (tag === "code" || tag === "pre" || tag === "kbd" || tag === "samp") s["font-family"] = "monospace";
  if (tag === "pre") s["white-space"] = "pre";
  if (tag === "small") s["font-size"] = "0.83em";
  if (tag === "a") Object.assign(s, { color: "#0000ee", "text-decoration-line": "underline" });
  if (tag === "u") s["text-decoration-line"] = "underline";
  if (tag === "s" || tag === "del") s["text-decoration-line"] = "line-through";
  if (tag === "hr") Object.assign(s, { "margin-top": "8px", "margin-bottom": "8px", "border-top-width": "1px", "border-top-style": "solid", "border-top-color": "#808080" });
  if (tag === "button" || tag === "input" || tag === "select" || tag === "textarea") Object.assign(s, { "padding-top": "1px", "padding-bottom": "1px", "padding-left": "6px", "padding-right": "6px", "border-top-width": "1px", "border-right-width": "1px", "border-bottom-width": "1px", "border-left-width": "1px", "border-top-style": "solid", "border-right-style": "solid", "border-bottom-style": "solid", "border-left-style": "solid", "border-top-color": "#767676", "border-right-color": "#767676", "border-bottom-color": "#767676", "border-left-color": "#767676", "font-size": "13.33px" });
  if (tag === "button") s["background-color"] = "#efefef";
  void fs;
  return s;
}

// ------------------------------------------------------------------------------------------------ selectors

/** A compiled complex selector: [{ comb, simple: [test] }] right to left, or null when unsupported. */
function compile(sel) {
  const parts = [];
  let i = 0;
  const s = sel.trim();
  let comb = null;
  let cur = [];
  const n = s.length;
  const ident = () => {
    let j = i;
    while (j < n && /[A-Za-z0-9_\-\\ -￿]/.test(s[j])) j += s[j] === "\\" ? 2 : 1;
    const out = s.slice(i, j).replace(/\\(.)/g, "$1");
    i = j;
    return out;
  };
  while (i < n) {
    const ch = s[i];
    if (/\s/.test(ch) || ch === ">" || ch === "+" || ch === "~") {
      let c = " ";
      while (i < n && /[\s>+~]/.test(s[i])) {
        if (s[i] !== " " && !/\s/.test(s[i])) c = s[i];
        i++;
      }
      if (cur.length) {
        parts.push({ comb, simple: cur });
        cur = [];
      }
      comb = c;
      continue;
    }
    if (ch === "*") {
      i++;
      cur.push(() => true);
    } else if (ch === "#") {
      i++;
      const v = ident();
      cur.push((el) => getAttr(el, "id") === v);
    } else if (ch === ".") {
      i++;
      const v = ident();
      cur.push((el) => classList(el).includes(v));
    } else if (ch === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) return null;
      const m = /^\[\s*([\w-:]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?\s*\]$/.exec(s.slice(i, end + 1));
      i = end + 1;
      if (!m) return null;
      const [, name, op, a, b2, c] = m;
      const want = a ?? b2 ?? c ?? "";
      cur.push((el) => {
        const v = getAttr(el, name);
        if (v === null) return false;
        if (!op) return true;
        if (op === "=") return v === want;
        if (op === "~=") return v.split(/\s+/).includes(want);
        if (op === "^=") return v.startsWith(want);
        if (op === "$=") return v.endsWith(want);
        if (op === "*=") return v.includes(want);
        if (op === "|=") return v === want || v.startsWith(`${want}-`);
        return false;
      });
    } else if (ch === ":") {
      if (s[i + 1] === ":") return null;
      i++;
      const name = ident().toLowerCase();
      let arg = null;
      if (s[i] === "(") {
        let d = 0;
        const start = i + 1;
        for (; i < n; i++) {
          if (s[i] === "(") d++;
          else if (s[i] === ")" && --d === 0) break;
        }
        arg = s.slice(start, i);
        i++;
      }
      const sib = (el) => (el.parent ? el.parent.children : []).filter((c) => c.type === "element");
      if (name === "root") cur.push((el) => el.tag === "html" || !el.parent);
      else if (name === "first-child") cur.push((el) => sib(el)[0] === el);
      else if (name === "last-child") cur.push((el) => sib(el).at(-1) === el);
      else if (name === "only-child") cur.push((el) => sib(el).length === 1);
      else if (name === "nth-child" && arg !== null) {
        const t = arg.trim().toLowerCase();
        const m = t === "odd" ? [2, 1] : t === "even" ? [2, 0] : /^([+-]?\d*)n\s*([+-]\s*\d+)?$/.test(t) ? (() => {
          const mm = /^([+-]?\d*)n\s*([+-]\s*\d+)?$/.exec(t);
          return [mm[1] === "" || mm[1] === "+" ? 1 : mm[1] === "-" ? -1 : Number(mm[1]), mm[2] ? Number(mm[2].replace(/\s/g, "")) : 0];
        })() : /^\d+$/.test(t) ? [0, Number(t)] : null;
        if (!m) return null;
        cur.push((el) => {
          const k = sib(el).indexOf(el) + 1;
          return m[0] === 0 ? k === m[1] : (k - m[1]) / m[0] >= 0 && Number.isInteger((k - m[1]) / m[0]);
        });
      } else if (name === "not" && arg !== null) {
        const inner = splitSelectorList(arg).map(compile);
        if (inner.some((x) => !x || x.length !== 1)) return null;
        cur.push((el) => !inner.some((x) => x[0].simple.every((f) => f(el))));
      } else if (name === "is" || name === "where") {
        const inner = splitSelectorList(arg || "").map(compile);
        if (inner.some((x) => !x || x.length !== 1)) return null;
        cur.push((el) => inner.some((x) => x[0].simple.every((f) => f(el))));
      } else return null;
    } else if (/[A-Za-z]/.test(ch)) {
      const t = ident().toLowerCase();
      cur.push((el) => el.tag === t);
    } else return null;
  }
  if (cur.length) parts.push({ comb, simple: cur });
  if (!parts.length) return null;
  return parts.reverse();
}

function matches(parts, el) {
  const test = (k, e) => {
    if (!parts[k].simple.every((f) => f(e))) return false;
    if (k === parts.length - 1) return true;
    const comb = parts[k].comb;
    if (comb === ">") return !!e.parent && test(k + 1, e.parent);
    if (comb === " ") {
      for (let p = e.parent; p; p = p.parent) if (test(k + 1, p)) return true;
      return false;
    }
    const sibs = e.parent ? e.parent.children.filter((c) => c.type === "element") : [];
    const i = sibs.indexOf(e);
    if (comb === "+") return i > 0 && test(k + 1, sibs[i - 1]);
    if (comb === "~") return sibs.slice(0, Math.max(0, i)).some((s) => test(k + 1, s));
    return false;
  };
  return test(0, el);
}

// ------------------------------------------------------------------------------------------------ values

const SIDES = ["top", "right", "bottom", "left"];
function four(v) {
  const p = splitTop(v, " ");
  const [t, r = t, b = t, l = r] = p;
  return [t, r, b, l];
}
/** Splits at top-level separators (not inside parentheses or quotes). */
export function splitTop(v, sep = ",") {
  const out = [];
  let d = 0;
  let q = null;
  let cur = "";
  for (const ch of String(v)) {
    if (q) {
      if (ch === q) q = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === "(") d++;
    else if (ch === ")") d--;
    if (d === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const isLength = (v) => /^[-+]?(\d+\.?\d*|\.\d+)(px|em|rem|%|vw|vh|pt|ch|ex)?$/i.test(v) || /^calc\(/i.test(v) || v === "0";
const isColorish = (v) => /^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|color\()/i.test(v) || /^[a-z]+$/i.test(v);
const BORDER_STYLES = new Set(["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"]);

/** Expands the shorthands the mapper reads into longhands. */
function expand(prop, value, out) {
  const v = value.trim();
  const set = (k, x) => (out[k] = x);
  switch (prop) {
    case "padding":
    case "margin":
      four(v).forEach((x, i) => set(`${prop}-${SIDES[i]}`, x));
      return;
    case "inset":
      four(v).forEach((x, i) => set(SIDES[i], x));
      return;
    case "border-width":
    case "border-style":
    case "border-color": {
      const kind = prop.split("-")[1];
      four(v).forEach((x, i) => set(`border-${SIDES[i]}-${kind}`, x));
      return;
    }
    case "border":
    case "border-top":
    case "border-right":
    case "border-bottom":
    case "border-left":
    case "outline": {
      const parts = splitTop(v, " ");
      let w = "medium";
      let st = "none";
      let c = "currentcolor";
      for (const p of parts) {
        if (BORDER_STYLES.has(p.toLowerCase())) st = p.toLowerCase();
        else if (isLength(p) || /^(thin|medium|thick)$/i.test(p)) w = p;
        else c = p;
      }
      if (/^thin$/i.test(w)) w = "1px";
      if (/^medium$/i.test(w)) w = "3px";
      if (/^thick$/i.test(w)) w = "5px";
      if (prop === "outline") return void Object.assign(out, { "outline-width": w, "outline-style": st, "outline-color": c });
      const sides = prop === "border" ? SIDES : [prop.slice(7)];
      for (const sd of sides) Object.assign(out, { [`border-${sd}-width`]: w, [`border-${sd}-style`]: st, [`border-${sd}-color`]: c });
      return;
    }
    case "border-radius": {
      const [a] = v.split("/");
      const [tl, tr, br, bl] = (() => {
        const p = splitTop(a, " ");
        const [x, y = x, z = x, w = y] = p;
        return [x, y, z, w];
      })();
      Object.assign(out, { "border-top-left-radius": tl, "border-top-right-radius": tr, "border-bottom-right-radius": br, "border-bottom-left-radius": bl });
      return;
    }
    case "gap":
    case "grid-gap": {
      const [r, c = r] = splitTop(v, " ");
      Object.assign(out, { "row-gap": r, "column-gap": c });
      return;
    }
    case "flex": {
      const p = splitTop(v, " ");
      if (v === "none") return void Object.assign(out, { "flex-grow": "0", "flex-shrink": "0", "flex-basis": "auto" });
      if (v === "auto") return void Object.assign(out, { "flex-grow": "1", "flex-shrink": "1", "flex-basis": "auto" });
      if (p.length === 1 && /^[\d.]+$/.test(p[0])) return void Object.assign(out, { "flex-grow": p[0], "flex-shrink": "1", "flex-basis": "0%" });
      if (p.length === 1) return void Object.assign(out, { "flex-grow": "1", "flex-shrink": "1", "flex-basis": p[0] });
      if (p.length === 2) return void Object.assign(out, /^[\d.]+$/.test(p[1]) ? { "flex-grow": p[0], "flex-shrink": p[1], "flex-basis": "0%" } : { "flex-grow": p[0], "flex-shrink": "1", "flex-basis": p[1] });
      return void Object.assign(out, { "flex-grow": p[0], "flex-shrink": p[1], "flex-basis": p[2] });
    }
    case "flex-flow": {
      for (const p of splitTop(v, " ")) {
        if (/wrap/.test(p)) out["flex-wrap"] = p;
        else out["flex-direction"] = p;
      }
      return;
    }
    case "grid-column":
    case "grid-row": {
      const [a, b = "auto"] = v.split("/").map((x) => x.trim());
      out[`${prop}-start`] = a;
      out[`${prop}-end`] = v.includes("/") ? b : /^span/.test(a) ? "auto" : "auto";
      return;
    }
    case "place-items": {
      const [a, b = a] = splitTop(v, " ");
      Object.assign(out, { "align-items": a, "justify-items": b });
      return;
    }
    case "place-content": {
      const [a, b = a] = splitTop(v, " ");
      Object.assign(out, { "align-content": a, "justify-content": b });
      return;
    }
    case "background": {
      const layers = splitTop(v, ",");
      const images = [];
      let color = null;
      let size = null;
      layers.forEach((layer, i) => {
        const parts = splitTop(layer.replace(/\s*\/\s*/g, " / "), " ");
        for (let k = 0; k < parts.length; k++) {
          const p = parts[k];
          if (/^(linear|radial|conic|repeating-linear|repeating-radial)-gradient\(|^url\(/i.test(p)) images.push(p);
          else if (p === "/") size = parts[k + 1];
          else if (i === layers.length - 1 && isColorish(p) && !/^(no-repeat|repeat|repeat-x|repeat-y|center|top|bottom|left|right|fixed|scroll|local|cover|contain|auto|none|padding-box|border-box|content-box)$/i.test(p)) color = p;
        }
      });
      out["background-image"] = images.length ? images.join(", ") : "none";
      if (color) out["background-color"] = color;
      if (size) out["background-size"] = size;
      return;
    }
    case "font": {
      const m = /^(?:(italic|oblique|normal)\s+)?(?:(normal|small-caps)\s+)?(?:(bold|bolder|lighter|normal|\d{3})\s+)?([\d.]+(?:px|em|rem|%|pt))(?:\s*\/\s*([\d.]+(?:px|em|rem|%)?|normal))?\s+(.+)$/i.exec(v);
      if (!m) return;
      if (m[1]) out["font-style"] = m[1];
      if (m[3]) out["font-weight"] = m[3];
      out["font-size"] = m[4];
      if (m[5]) out["line-height"] = m[5];
      out["font-family"] = m[6];
      return;
    }
    case "text-decoration":
      out["text-decoration-line"] = /line-through/.test(v) ? "line-through" : /underline/.test(v) ? "underline" : "none";
      return;
    case "overflow": {
      const [x, y = x] = splitTop(v, " ");
      Object.assign(out, { "overflow-x": x, "overflow-y": y });
      return;
    }
    default:
      out[prop] = v;
  }
}

/** Resolves var() references against custom properties (with fallbacks; depth-limited). */
function resolveVars(v, vars, depth = 0) {
  if (!v.includes("var(") || depth > 8) return v;
  let out = "";
  let i = 0;
  while (i < v.length) {
    const k = v.indexOf("var(", i);
    if (k < 0) {
      out += v.slice(i);
      break;
    }
    out += v.slice(i, k);
    let d = 0;
    let j = k + 3;
    for (; j < v.length; j++) {
      if (v[j] === "(") d++;
      else if (v[j] === ")" && --d === 0) break;
    }
    const inner = v.slice(k + 4, j);
    const comma = splitTop(inner, ",");
    const name = comma[0]?.trim();
    const fb = inner.includes(",") ? inner.slice(inner.indexOf(",") + 1).trim() : "";
    out += resolveVars(vars[name] !== undefined ? vars[name] : fb, vars, depth + 1);
    i = j + 1;
  }
  return out;
}

/** px for a length; `pct` is the reference of % (null keeps percentages unresolved → NaN). */
export function toPx(v, fs, { pct = null, width = 1280, height = 800, rootFs = 16 } = {}) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "0") return 0;
  if (s.startsWith("calc(")) {
    const inner = s.slice(5, -1);
    const terms = inner.split(/\s+(?=[+-]\s)/);
    let sum = 0;
    for (const t of terms) {
      const m = /^([+-])?\s*(.+)$/.exec(t.trim());
      const val = toPx(m[2], fs, { pct, width, height, rootFs });
      if (!Number.isFinite(val)) return NaN;
      sum += m[1] === "-" ? -val : val;
    }
    return sum;
  }
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(px|em|rem|%|vw|vh|pt|pc|in|cm|mm|ch|ex)?$/.exec(s);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  switch (m[2] || "px") {
    case "px":
      return n;
    case "em":
      return n * fs;
    case "rem":
      return n * rootFs;
    case "%":
      return pct == null ? NaN : (n / 100) * pct;
    case "vw":
      return (n / 100) * width;
    case "vh":
      return (n / 100) * height;
    case "pt":
      return (n * 96) / 72;
    case "pc":
      return n * 16;
    case "in":
      return n * 96;
    case "cm":
      return (n * 96) / 2.54;
    case "mm":
      return (n * 96) / 25.4;
    case "ch":
    case "ex":
      return n * fs * 0.5;
  }
  return NaN;
}

const FONT_SIZES = { "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32, "xxx-large": 48 };
const LENGTH_PROPS = ["padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "column-gap", "row-gap", "letter-spacing", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius", "outline-width", "outline-offset", "left", "top", "right", "bottom", "min-width", "max-width", "min-height", "max-height"];

/**
 * @param {string} html sanitized HTML
 * @param {{ width?: number, report?: object }} [o]
 */
export function staticProbe(html, { width = 1280, height = 800, report = null } = {}) {
  const parsed = parseHtml(html);
  const all = parsed.elements;
  const css = [];
  for (const el of all) if (el.tag === "style") css.push(el.children.map((c) => c.text || "").join(""));
  const rules = [];
  let unsupported = 0;
  let order = 0;
  for (const r of flattenRules(parseCss(css.join("\n")))) {
    let ok = true;
    for (let p = r.parent; p; p = p.parent) {
      if (p.type !== "at") continue;
      const name = p.name.toLowerCase();
      if (name === "media") ok = ok && mediaMatches(p.prelude, width);
      else if (name !== "supports" && name !== "layer") ok = false;
    }
    if (!ok) continue;
    for (const sel of splitSelectorList(r.selector)) {
      const c = compile(sel);
      if (!c) {
        unsupported++;
        continue;
      }
      rules.push({ c, spec: selectorSpecificity(sel), order: order++, decls: r.decls });
    }
  }
  if (unsupported && report) report.note(`${unsupported} CSS selector${unsupported === 1 ? "" : "s"} with states or pseudo-elements (:hover, ::before …) or unsupported syntax were skipped.`);
  const weight = (r) => r.spec[0] * 1e6 + r.spec[1] * 1e3 + r.spec[2];

  const htmlEl = all.find((e) => e.tag === "html") || null;
  const body = all.find((e) => e.tag === "body") || null;
  let rootFs = 16;
  const docVars = {};

  function cascade(el, parentStyle, parentVars) {
    const declared = {};
    const important = {};
    const matched = rules.filter((r) => matches(r.c, el)).sort((a, b) => weight(a) - weight(b) || a.order - b.order);
    const vars = { ...parentVars };
    const apply = (prop, value, imp) => {
      const p = prop.toLowerCase();
      if (p.startsWith("--")) {
        vars[prop] = value.trim();
        return;
      }
      const tmp = {};
      expand(p, value, tmp);
      for (const [k, v] of Object.entries(tmp)) {
        if (important[k] && !imp) continue;
        declared[k] = v;
        if (imp) important[k] = true;
      }
    };
    const inline = decodeEntities(getAttr(el, "style") || "");
    const all = [...matched.flatMap((r) => r.decls), ...(inline ? parseCss(`x{${inline}}`).rules[0]?.decls || [] : [])];
    // custom properties first, so shorthands expand their resolved values
    for (const d of all) if (d.prop.startsWith("--")) vars[d.prop] = d.value.trim();
    for (const d of all) if (!d.prop.startsWith("--")) apply(d.prop, resolveVars(d.value, vars), d.important);
    return { declared, vars };
  }

  function computeEl(el, parentStyle, parentVars, parentWidth) {
    const { declared, vars } = cascade(el, parentStyle, parentVars);
    const ua = uaStyle(el.tag);
    const style = {};
    for (const k of INHERITED) if (parentStyle[k] !== undefined) style[k] = parentStyle[k];
    Object.assign(style, ua);
    for (const [k, v] of Object.entries(declared)) {
      if (v === "inherit") style[k] = parentStyle[k];
      else if (v === "initial" || v === "unset") delete style[k];
      else style[k] = v;
    }
    // font size first: em lengths below use it
    const pfs = parseFloat(parentStyle["font-size"]) || 16;
    let fs = pfs;
    const fsv = String(style["font-size"] ?? "").toLowerCase();
    if (fsv && fsv !== parentStyle["font-size"]) fs = FONT_SIZES[fsv] ?? (Number.isFinite(toPx(fsv, pfs, { pct: pfs, width, height, rootFs })) ? toPx(fsv, pfs, { pct: pfs, width, height, rootFs }) : pfs);
    style["font-size"] = `${fs}px`;
    if (el.tag === "html") rootFs = fs;
    const decl = {};
    for (const k of ["width", "height", "flex-basis", "grid-template-columns", "grid-template-rows", "min-width", "max-width", "min-height", "max-height"]) if (style[k] !== undefined) decl[k] = style[k];
    for (const k of LENGTH_PROPS) {
      if (style[k] === undefined) continue;
      const raw = String(style[k]).trim().toLowerCase();
      if (raw === "auto" || raw === "none" || raw === "normal") continue;
      const pct = /^(padding|margin)/.test(k) ? parentWidth : null;
      const px = toPx(raw, fs, { pct, width, height, rootFs });
      if (Number.isFinite(px)) style[k] = `${px}px`;
    }
    for (const k of ["width", "height"]) {
      const raw = String(style[k] ?? "").trim().toLowerCase();
      if (!raw) continue;
      const px = toPx(raw, fs, { pct: null, width, height, rootFs });
      if (Number.isFinite(px)) style[k] = `${px}px`;
    }
    const lh = String(style["line-height"] ?? "").trim();
    if (lh && lh !== "normal" && !/%$/.test(lh) && !/^[\d.]+$/.test(lh)) {
      const px = toPx(lh, fs, { pct: fs, width, height, rootFs });
      if (Number.isFinite(px)) style["line-height"] = `${px}px`;
    }
    const fw = String(style["font-weight"] ?? "400").toLowerCase();
    style["font-weight"] = fw === "bold" ? "700" : fw === "normal" ? "400" : fw === "bolder" ? String(Math.min(900, (parseFloat(parentStyle["font-weight"]) || 400) + 300)) : fw === "lighter" ? "300" : fw;
    for (const sd of SIDES) {
      const st = String(style[`border-${sd}-style`] || "none").toLowerCase();
      if (st === "none" || st === "hidden") style[`border-${sd}-width`] = "0px";
      if (style[`border-${sd}-color`] === "currentcolor" || style[`border-${sd}-color`] === undefined) style[`border-${sd}-color`] = style.color || "#000000";
    }
    if (style["outline-color"] === "currentcolor") style["outline-color"] = style.color || "#000000";
    const ownWidth = toPx(style.width, fs, { pct: parentWidth, width, height, rootFs });
    const contentWidth = Number.isFinite(ownWidth) ? ownWidth : parentWidth;
    const node = { tag: el.tag, attrs: {}, style, decl, kids: [] };
    for (const a of el.attrs) if (a.value !== null || a.name === "hidden") node.attrs[a.name] = a.value === null ? "" : decodeEntities(a.value);
    if ("hidden" in node.attrs) style.display = "none";
    if (el.tag === "html" || el === body) Object.assign(docVars, Object.fromEntries(Object.entries(vars).filter(([k]) => k.startsWith("--"))));
    if (el.tag === "svg") {
      node.svg = serializeElement(el);
      return node;
    }
    for (const c of el.children) {
      if (c.type === "text") {
        const text = decodeEntities(c.text);
        if (text) node.kids.push({ text });
      } else if (c.type === "element" && !HIDDEN.has(c.tag)) {
        if (c.tag === "br") node.kids.push({ text: "\n", br: true });
        else node.kids.push(computeEl(c, style, vars, contentWidth));
      }
    }
    if (el.tag === "textarea") node.attrs.value = node.kids.map((k) => k.text || "").join("");
    return node;
  }

  const base = { color: "#000000", "font-family": "Inter, sans-serif", "font-size": "16px", "font-weight": "400", "line-height": "normal", "font-style": "normal", "letter-spacing": "normal", "text-align": "start", "text-transform": "none", "white-space": "normal", "text-decoration-line": "none" };
  let rootNode;
  if (htmlEl) {
    const h = computeEl(htmlEl, base, {}, width);
    rootNode = findTag(h, "body") || { tag: "body", attrs: {}, style: { display: "block" }, decl: {}, kids: h.kids };
    rootNode.htmlStyle = h.style;
  } else if (body) rootNode = computeEl(body, base, {}, width);
  else {
    // a fragment: an implied body around the top-level nodes
    const fake = { type: "element", tag: "body", attrs: [], children: parsed.children, parent: null };
    for (const c of parsed.children) if (c.type === "element") c.parent = fake;
    rootNode = computeEl(fake, base, {}, width);
  }
  const titleEl = all.find((e) => e.tag === "title");
  rootNode.title = titleEl ? decodeEntities(titleEl.children.map((c) => c.text || "").join("")).trim() : "";
  rootNode.vars = docVars;
  rootNode.viewport = { w: width, h: height };
  return rootNode;
}

function findTag(n, tag) {
  if (n.tag === tag) return n;
  for (const k of n.kids || []) if (k.tag) {
    const f = findTag(k, tag);
    if (f) return f;
  }
  return null;
}

function mediaMatches(prelude, width) {
  const p = String(prelude || "").toLowerCase();
  if (/\bprint\b/.test(p) && !/\bscreen\b/.test(p)) return false;
  if (/prefers-color-scheme\s*:\s*dark/.test(p)) return false;
  let ok = true;
  p.replace(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)?\s*\)/g, (m, kind, n, u) => {
    const px = parseFloat(n) * (u === "em" || u === "rem" ? 16 : 1);
    if (kind === "min" && width < px) ok = false;
    if (kind === "max" && width > px) ok = false;
    return m;
  });
  return ok;
}
