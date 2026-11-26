// Tailwind CSS v4 output of the Proto code export (docs/concepts/proto-studio.md §10.1, task T7). Pure: no DOM.
//
//   twClasses(decls) → string[]       css.js declarations as Tailwind v4 utilities: the spacing scale where a value is
//                                      a multiple of 2 px (up to 384 px), named utilities for keywords, arbitrary values
//                                      (`w-[1280px]`, `bg-[color:var(--color-brand,#4f46e5)]`) and arbitrary properties
//                                      (`[background-image:…]`) for everything else, so every declaration survives
//   emitTailwind(ir, opts?) → { files, entry }   HTML pages with utility classes, styles.css (`@import "tailwindcss"`,
//                                      the variables as `@theme` tokens and custom properties) and the images
// Preflight sets `box-sizing: border-box` and removes element margins, so the classes need no reset.
import { tokensTailwind } from "../tokens.js";
import { escHtml } from "./util.js";
import { htmlMarkup, page, screenFiles, hrefOf, assetFiles, varsCss } from "./html.js";

/** An arbitrary value: spaces become underscores (Tailwind turns them back), double quotes single quotes. */
export const arb = (v) => String(v).replace(/\\/g, "\\\\").replace(/_/g, "\\_").replace(/"/g, "'").replace(/\s*,\s*/g, ",").replace(/\s+/g, "_");

const PX = /^(-?\d+(?:\.\d+)?)px$/;

/** A length on the spacing scale (`4`, `0.5`, `px`) or an arbitrary value (`[7px]`, `[length:var(--x,8px)]`). */
function scale(v, { max = 96, hint = "" } = {}) {
  const m = PX.exec(v);
  if (m) {
    const n = Math.abs(Number(m[1]));
    if (n === 0) return { neg: false, s: "0" };
    if (n === 1) return { neg: Number(m[1]) < 0, s: "px" };
    if (Number.isInteger(n / 2) && n / 4 <= max) return { neg: Number(m[1]) < 0, s: String(n / 4) };
    return { neg: false, s: `[${v}]` };
  }
  return { neg: false, s: `[${hint && /^(var|calc)\(/.test(v) ? `${hint}:` : ""}${arb(v)}]` };
}
const sized = (prefix, v, o) => {
  const { neg, s } = scale(v, o);
  return `${neg ? "-" : ""}${prefix}-${s}`;
};
const color = (prefix, v) => (/^#[0-9a-f]{3,8}$/i.test(v) ? `${prefix}-[${v}]` : `${prefix}-[color:${arb(v)}]`);
const prop = (p, v) => `[${p}:${arb(v)}]`;

const ALIGN = { "flex-start": "start", start: "start", center: "center", "flex-end": "end", end: "end", stretch: "stretch", baseline: "baseline" };
const JUSTIFY = { "flex-start": "start", start: "start", center: "center", "flex-end": "end", end: "end", "space-between": "between", "space-around": "around", "space-evenly": "evenly", stretch: "stretch" };
const WEIGHT = { 100: "thin", 200: "extralight", 300: "light", 400: "normal", 500: "medium", 600: "semibold", 700: "bold", 800: "extrabold", 900: "black" };
const SIZE_KEYWORD = { "fit-content": "fit", auto: "auto", "100%": "full", "min-content": "min", "max-content": "max" };

function one(p, v) {
  switch (p) {
    case "box-sizing":
      return v === "border-box" ? null : "box-content";
    case "display":
      return v === "none" ? "hidden" : v === "-webkit-box" ? prop(p, v) : v;
    case "position":
      return v;
    case "left":
    case "top":
    case "right":
    case "bottom":
      return sized(p, v, { max: 1000 });
    case "z-index":
      return `z-[${v}]`;
    case "width":
    case "height":
    case "min-width":
    case "max-width":
    case "min-height":
    case "max-height": {
      const pre = { width: "w", height: "h", "min-width": "min-w", "max-width": "max-w", "min-height": "min-h", "max-height": "max-h" }[p];
      if (SIZE_KEYWORD[v]) return `${pre}-${SIZE_KEYWORD[v]}`;
      if (v === "none") return `${pre}-none`;
      return sized(pre, v, { hint: "length" });
    }
    case "flex":
      return v === "0 0 auto" ? "flex-none" : v === "1 1 auto" ? "flex-auto" : `flex-[${arb(v)}]`;
    case "align-self":
      return ALIGN[v] ? `self-${ALIGN[v]}` : prop(p, v);
    case "justify-self":
      return ALIGN[v] ? `justify-self-${ALIGN[v]}` : prop(p, v);
    case "grid-column":
      return `col-[${arb(v)}]`;
    case "grid-row":
      return `row-[${arb(v)}]`;
    case "flex-direction":
      return v === "column" ? "flex-col" : v === "row" ? "flex-row" : prop(p, v);
    case "flex-wrap":
      return v === "wrap" ? "flex-wrap" : "flex-nowrap";
    case "column-gap":
      return sized("gap-x", v, { hint: "length" });
    case "row-gap":
      return sized("gap-y", v, { hint: "length" });
    case "align-items":
      return ALIGN[v] ? `items-${ALIGN[v]}` : prop(p, v);
    case "justify-content":
      return JUSTIFY[v] ? `justify-${JUSTIFY[v]}` : prop(p, v);
    case "align-content":
      return JUSTIFY[v] ? `content-${JUSTIFY[v]}` : prop(p, v);
    case "justify-items":
      return ALIGN[v] ? `justify-items-${ALIGN[v]}` : prop(p, v);
    case "grid-template-columns":
      return `grid-cols-[${arb(v)}]`;
    case "grid-template-rows":
      return `grid-rows-[${arb(v)}]`;
    case "grid-auto-flow":
      return { row: "grid-flow-row", column: "grid-flow-col", "row dense": "grid-flow-row-dense", "column dense": "grid-flow-col-dense" }[v] || prop(p, v);
    case "overflow":
    case "overflow-x":
    case "overflow-y":
      return `${p}-${v}`;
    case "opacity": {
      const n = Number(v);
      return Number.isFinite(n) && Number.isInteger(n * 100) ? `opacity-${n * 100}` : `opacity-[${arb(v)}]`;
    }
    case "mix-blend-mode":
      return `mix-blend-${v}`;
    case "transform": {
      const m = /^rotate\((-?[\d.]+)deg\)$/.exec(v);
      return m ? `${m[1].startsWith("-") ? "-" : ""}rotate-[${m[1].replace("-", "")}deg]` : prop(p, v);
    }
    case "background-color":
      return color("bg", v);
    case "border-width":
      return /\s/.test(v) ? prop(p, v) : PX.test(v) ? `border-[${v}]` : `border-[length:${arb(v)}]`;
    case "border-style":
      return `border-${v}`;
    case "border-color":
      return color("border", v);
    case "border-radius":
      return /\s/.test(v) ? prop(p, v) : PX.test(v) || /%$/.test(v) ? `rounded-[${v}]` : `rounded-[${arb(v)}]`;
    case "box-shadow":
      return `shadow-[${arb(v)}]`;
    case "font-size":
      return PX.test(v) ? `text-[${v}]` : `text-[length:${arb(v)}]`;
    case "font-weight":
      return WEIGHT[v] ? `font-${WEIGHT[v]}` : `font-[${arb(v)}]`;
    case "font-style":
      return v === "italic" ? "italic" : "not-italic";
    case "line-height":
      return `leading-[${arb(v)}]`;
    case "letter-spacing":
      return `tracking-[${arb(v)}]`;
    case "text-align":
      return `text-${v}`;
    case "text-transform":
      return v === "none" ? "normal-case" : v;
    case "text-decoration-line":
      return v === "none" ? "no-underline" : v;
    case "color":
      return color("text", v);
    case "white-space":
      return `whitespace-${v}`;
    case "object-fit":
      return `object-${v === "fill" ? "fill" : v}`;
    case "object-position":
      return `object-[${arb(v)}]`;
    default:
      return prop(p, v);
  }
}

/** Tailwind v4 utilities for css.js declarations (see the header), in declaration order. */
export function twClasses(decls) {
  const m = new Map(decls);
  const out = [];
  const clamp = m.has("-webkit-line-clamp");
  const sameGap = m.has("column-gap") && m.get("column-gap") === m.get("row-gap");
  let gapDone = false;
  for (const [p, v] of decls) {
    // line clamp: one utility for display, orientation, clamp and overflow
    if (clamp && ["-webkit-box-orient", "display", "overflow"].includes(p)) continue;
    if (p === "-webkit-line-clamp") {
      out.push(`line-clamp-${v}`);
      continue;
    }
    // equal gaps
    if (sameGap && (p === "column-gap" || p === "row-gap")) {
      if (!gapDone) out.push(sized("gap", v, { hint: "length" }));
      gapDone = true;
      continue;
    }
    // padding: p, px/py, or one per side
    if (p === "padding") {
      const parts = v.split(/\s+(?![^(]*\))/);
      const [t, r = t, b = t, l = r] = parts;
      if (t === r && r === b && b === l) out.push(sized("p", t, { hint: "length" }));
      else if (t === b && r === l) out.push(sized("py", t, { hint: "length" }), sized("px", r, { hint: "length" }));
      else out.push(sized("pt", t, { hint: "length" }), sized("pr", r, { hint: "length" }), sized("pb", b, { hint: "length" }), sized("pl", l, { hint: "length" }));
      continue;
    }
    const c = one(p, v);
    if (c) out.push(c);
  }
  return out;
}

/** The stylesheet a Tailwind export builds from: Tailwind, the variables as @theme tokens and custom properties. */
export function tailwindCss(ir, model) {
  return `/* Generated by OpenFini Proto. Build: npx @tailwindcss/cli -i styles.css -o dist.css */
@import "tailwindcss";
${ir.fonts.length ? `/* Fonts: ${ir.fonts.join(", ")} (load them in your page; the design does not embed fonts). */\n` : ""}
${tokensTailwind(model).trim()}

/* The design's variables as the classes use them (var(--…) with modes) */
${varsCss(ir)}
`.replace(/\n{3,}/g, "\n\n");
}

/** Media differences as max-width variants: max-[478px]:w-[390px]. */
export function mediaClasses(screen) {
  const extra = new Map();
  for (const m of screen.media) {
    for (const [a, b] of m.pairs) {
      const base = new Set(twClasses(a.decls));
      const alt = twClasses(b.decls);
      const add = alt.filter((c) => !base.has(c)).map((c) => `max-[${m.width}px]:${c}`);
      if (add.length) extra.set(a, [...(extra.get(a) || []), ...add]);
    }
  }
  return extra;
}

export function emitTailwind(ir, { title = "Design", model } = {}) {
  const files = screenFiles(ir);
  const out = [];
  for (const s of ir.screens) {
    const extra = mediaClasses(s);
    const o = {
      classOf: (n) => [...twClasses(n.decls), ...(extra.get(n) || [])].join(" "),
      runClass: (n, i) => (n.text.runs[i].decls.length ? twClasses(n.text.runs[i].decls).join(" ") : null),
      href: hrefOf(files),
    };
    out.push({ path: files.get(s.id), text: page(s.name, htmlMarkup(s.root, o, 1), { head: `  <link rel="stylesheet" href="dist.css">\n` }) });
  }
  if (ir.screens.length > 1) {
    const list = ir.screens.map((s) => `    <li><a href="${escHtml(files.get(s.id))}">${escHtml(s.name)}</a></li>`).join("\n");
    out.push({ path: "index.html", text: page(title, `  <ul>\n${list}\n  </ul>`, { head: `  <link rel="stylesheet" href="dist.css">\n` }) });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : 1));
  out.push({ path: "styles.css", text: tailwindCss(ir, model) });
  out.push(...assetFiles(ir));
  return { files: out, entry: "index.html" };
}
