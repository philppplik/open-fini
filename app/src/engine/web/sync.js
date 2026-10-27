// Source <-> preview sync helpers of the Code studio (pure, no DOM): which source lines belong to an element, the
// breadcrumb path of an element, which CSS rule is under the caret and which rules plausibly apply to an element.
//
// Public API
//   crumbsOf(el)                       -> [{ id, tag, label }] from the root element down to `el` (label: "section.hero#top")
//   openTagLines(source, el)           -> { from, to } offsets covering the whole lines of the element's start tag
//   cssRuleAt(parsedCss, offset)       -> the innermost style rule containing the offset, or null
//   matchableSelector(selector)        -> a selector for querySelectorAll without states/pseudo-elements, or null
//   rulesForElement(files, el)         -> [{ file, selector, start, end, media }] rules whose last compound selector
//                                         matches the element's tag, id and classes (a static approximation: no
//                                         combinators or attribute selectors are evaluated; the preview does the exact match)
// Invariants: offsets index the source text the tree was parsed from; nothing here throws on odd input.
import { classList, getAttr } from "./html.js";
import { splitSelectorList, flattenRules, mediaOf } from "./css.js";

/** Breadcrumb entries from the outermost element to `el`. */
export function crumbsOf(el) {
  const out = [];
  for (let e = el; e; e = e.parent) {
    const id = getAttr(e, "id");
    const cls = classList(e).slice(0, 2).join(".");
    out.push({ id: e.id, tag: e.tag, label: e.tag + (cls ? "." + cls : "") + (id ? "#" + id : "") });
  }
  return out.reverse();
}

/** Offsets of the full lines (first column to the line end) that hold the start tag of `el`. */
export function openTagLines(source, el) {
  const s = String(source ?? "");
  const a = s.lastIndexOf("\n", Math.max(0, el.open.start) - 1) + 1;
  let b = s.indexOf("\n", Math.max(el.open.start, el.open.end - 1));
  if (b < 0) b = s.length;
  return { from: a, to: b };
}

/** Innermost style rule whose text range contains `offset`. */
export function cssRuleAt(parsed, offset) {
  let best = null;
  for (const r of flattenRules(parsed)) if (offset >= r.start && offset <= r.end && (!best || r.start >= best.start)) best = r;
  return best;
}

const STATE = /:(hover|focus|focus-visible|focus-within|active|visited|target|checked|disabled|enabled)\b/gi;
const PSEUDO_EL = /::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\b/gi;

/** Selector usable with querySelectorAll: states and pseudo-elements are removed, nesting selectors give null. */
export function matchableSelector(selector) {
  const s = String(selector ?? "").trim();
  if (!s || s.includes("&") || s.startsWith("@") || s.length > 400) return null;
  const parts = splitSelectorList(s)
    .map((p) => p.replace(PSEUDO_EL, "").replace(STATE, "").trim())
    .filter((p) => p && !/[>+~\s]$/.test(p));
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

/** Last compound of a complex selector ("nav .a > li.x" -> "li.x"). */
function lastCompound(sel) {
  const m = /([^\s>+~]+)\s*$/.exec(sel.trim());
  return m ? m[1] : "";
}

function compoundMatches(compound, tag, id, classes) {
  const c = compound.replace(PSEUDO_EL, "").replace(STATE, "").replace(/:(not|is|where|has)\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").replace(/:[a-z-]+(\([^)]*\))?/gi, "");
  if (c === "*") return true;
  if (c === "") return false;
  const t = /^[a-z][a-z0-9-]*/i.exec(c);
  if (t && t[0].toLowerCase() !== tag) return false;
  const ids = [...c.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
  if (ids.some((x) => x !== id)) return false;
  const cls = [...c.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  return cls.every((x) => classes.includes(x));
}

/** @param {{ file: string, parsed: object }[]} files parsed stylesheets in cascade order */
export function rulesForElement(files, el) {
  const tag = el.tag.toLowerCase();
  const id = getAttr(el, "id") || "";
  const classes = classList(el);
  const out = [];
  for (const { file, parsed } of files) {
    for (const r of flattenRules(parsed)) {
      if (r.selector.includes("&")) continue;
      const hit = splitSelectorList(r.selector).some((part) => compoundMatches(lastCompound(part), tag, id, classes));
      if (hit) out.push({ file, selector: r.selector.replace(/\s+/g, " ").trim(), start: r.start, end: r.end, media: mediaOf(r) || null });
    }
  }
  return out;
}
