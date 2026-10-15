// Source-preserving edits for HTML and CSS. Every function returns a list of minimal text changes against the
// exact source; untouched text stays byte-identical. See docs/web-engine.md.
import {
  parseHtml, findAttr, classList, contentRange, escapeAttr, escapeText, decodeEntities, isVoidTag, isRawTextTag, childElements, isInside,
  BOOLEAN_ATTRS, findByTag,
} from "./html.js";
import {
  flattenRules, normalizeSelector, normalizeMedia, mediaOf, parseMediaQuery, parseDeclarationList, scanClassTokens, cssEscapeIdent,
  parseCss, containerOf,
} from "./css.js";

/**
 * @typedef {{ from: number, to: number, insert: string }} Change
 * @typedef {import('./html.js').ParsedHtml} ParsedHtml
 * @typedef {import('./html.js').ElementNode} ElementNode
 * @typedef {import('./css.js').ParsedCss} ParsedCss
 * @typedef {import('./css.js').StyleRule} StyleRule
 * @typedef {import('./css.js').CssRule} CssRule
 * @typedef {import('./css.js').Decl} Decl
 */

// ------------------------------------------------------------------------------------------------ core

function sortChanges(changes) {
  return changes
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.from - b.c.from || a.c.to - b.c.to || a.i - b.i)
    .map((x) => x.c);
}

/**
 * Applies non-overlapping changes (against the original source, in any order). Inserts at the same offset keep list order.
 * Throws when changes overlap or lie outside the source.
 * @param {string} source
 * @param {Change[]} changes
 * @returns {string}
 */
export function applyChanges(source, changes) {
  if (!changes || !changes.length) return source;
  const sorted = sortChanges(changes);
  const parts = [];
  let pos = 0;
  for (const c of sorted) {
    if (!(c.from <= c.to) || c.from < 0 || c.to > source.length || typeof c.insert !== "string") {
      throw new Error(`Invalid change ${c.from}..${c.to}`);
    }
    if (c.from < pos) throw new Error(`Overlapping changes at offset ${c.from}`);
    parts.push(source.slice(pos, c.from), c.insert);
    pos = c.to;
  }
  parts.push(source.slice(pos));
  return parts.join("");
}

/**
 * Where an offset of the old source ends up after the changes. Offsets inside replaced text map to the start of the
 * replacement (bias 'left') or to its end ('right'); a pure insertion exactly at the offset goes before ('left') or after it.
 * @param {number} offset
 * @param {Change[]} changes
 * @param {'left'|'right'} [bias]
 * @returns {number}
 */
export function mapOffset(offset, changes, bias = "left") {
  let delta = 0;
  for (const c of sortChanges(changes || [])) {
    const del = c.to - c.from;
    const ins = c.insert.length;
    if (c.to < offset || (c.to === offset && del > 0)) {
      delta += ins - del;
      continue;
    }
    if (c.from > offset) break;
    if (del === 0) {
      if (c.from === offset && bias === "right") delta += ins;
      continue;
    }
    if (c.from === offset) break;
    return c.from + delta + (bias === "right" ? ins : 0);
  }
  return offset + delta;
}

/**
 * Indentation used by the source: '\t', two spaces or four spaces (default two spaces).
 * @param {string} source
 * @returns {string}
 */
export function detectIndent(source) {
  const s = String(source ?? "");
  let tabs = 0;
  let spaces = 0;
  const diffs = new Map();
  let prev = 0;
  let pos = 0;
  let lines = 0;
  while (pos < s.length && lines < 4000) {
    let e = s.indexOf("\n", pos);
    if (e < 0) e = s.length;
    lines++;
    let k = pos;
    while (k < e && (s[k] === " " || s[k] === "\t")) k++;
    if (k < e && s[k] !== "\r") {
      if (s[pos] === "\t") tabs++;
      else if (k > pos) {
        spaces++;
        const w = k - pos;
        const d = Math.abs(w - prev);
        if (d > 0 && d <= 8) diffs.set(d, (diffs.get(d) || 0) + 1);
      }
      prev = s[pos] === "\t" ? 0 : k - pos;
    }
    pos = e + 1;
  }
  if (tabs > spaces) return "\t";
  let best = 2;
  let bestCount = 0;
  for (const [d, n] of diffs) {
    if (n > bestCount || (n === bestCount && d < best)) {
      best = d;
      bestCount = n;
    }
  }
  return best <= 2 ? "  " : "    ";
}

const detectEol = (s) => {
  const i = s.indexOf("\n");
  return i > 0 && s[i - 1] === "\r" ? "\r\n" : "\n";
};
const isHSpace = (c) => c === " " || c === "\t";
const lineStartOf = (s, i) => (i <= 0 ? 0 : s.lastIndexOf("\n", i - 1) + 1);
const lineEndOf = (s, i) => {
  const k = s.indexOf("\n", i);
  return k < 0 ? s.length : k;
};
const indentOfLine = (s, i) => {
  const ls = lineStartOf(s, i);
  let k = ls;
  while (k < s.length && isHSpace(s[k])) k++;
  return s.slice(ls, k);
};
/** True when [from, to) holds only spaces, tabs and carriage returns. */
function onlyBlank(s, from, to) {
  for (let i = from; i < to; i++) {
    const c = s[i];
    if (c !== " " && c !== "\t" && c !== "\r") return false;
  }
  return true;
}
/** The element starts its line and nothing but blanks follows it on its last line. */
const ownLine = (s, start, end) => onlyBlank(s, lineStartOf(s, start), start) && onlyBlank(s, end, lineEndOf(s, end));
const firstOnLine = (s, start) => onlyBlank(s, lineStartOf(s, start), start);

/** Range to delete so an element/rule/declaration disappears together with the line it occupied. */
function removalRange(s, start, end) {
  if (ownLine(s, start, end)) {
    const e = lineEndOf(s, end);
    return { from: lineStartOf(s, start), to: e < s.length ? e + 1 : s.length };
  }
  let to = end;
  if (firstOnLine(s, start)) while (to < s.length && isHSpace(s[to])) to++;
  return { from: start, to };
}

/** Merges overlapping or touching deletion ranges. */
function mergeRanges(ranges) {
  const sorted = ranges.slice().sort((a, b) => a.from - b.from || a.to - b.to);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ from: r.from, to: r.to });
  }
  return out.map((r) => ({ from: r.from, to: r.to, insert: "" }));
}

// ------------------------------------------------------------------------------------------------ HTML edits

const getEl = (parsed, id) => {
  const el = parsed.elements[id];
  if (!el) throw new Error(`Unknown element id ${id}`);
  return el;
};

/** End of an element without the whitespace that belongs to the next sibling (implied end tags). */
function effEnd(s, el) {
  if (el.close || el.void || el.selfClosing) return el.end;
  let e = el.end;
  while (e > el.open.end && /\s/.test(s[e - 1])) e--;
  return e;
}

const rawTagLen = (s, el) => {
  let p = el.open.start + 1;
  while (p < s.length && !/[\s/>]/.test(s[p])) p++;
  return p - el.open.start - 1;
};

const VALID_TAG = /^[A-Za-z][A-Za-z0-9_:.-]*$/;
const VALID_ATTR = /^[^\s"'<>/=\u0000]+$/;

/** Range of an attribute including the whitespace before it. */
function attrRemoval(s, el, attr) {
  const floor = el.open.start + 1 + rawTagLen(s, el);
  const next = s[attr.end];
  // glued to the next token (`class="a"id=b`): keep the whitespace in front so the tokens stay apart
  if (next !== undefined && !/[\s>/]/.test(next)) return { from: attr.start, to: attr.end, insert: "" };
  let from = attr.start;
  while (from > floor && /\s/.test(s[from - 1])) from--;
  return { from, to: attr.end, insert: "" };
}

/**
 * Sets, adds or removes an attribute. `value` is plain text (not entity-encoded); null removes it.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @param {string} name
 * @param {string|null} value
 * @returns {Change[]}
 */
export function setAttribute(parsed, id, name, value) {
  const el = getEl(parsed, id);
  const s = parsed.source;
  if (typeof name !== "string" || !VALID_ATTR.test(name)) throw new Error(`Invalid attribute name "${name}"`);
  const nm = name.toLowerCase();
  const attr = findAttr(el, nm);
  if (value === null || value === undefined) return attr ? [attrRemoval(s, el, attr)] : [];
  const val = String(value);
  const bare = BOOLEAN_ATTRS.has(nm) && val === "";
  if (attr) {
    const rawName = s.slice(attr.start, attr.start + attr.name.length);
    if (attr.value === null) {
      if (val === "") return [];
      return [{ from: attr.end, to: attr.end, insert: `="${escapeAttr(val)}"` }];
    }
    if (decodeEntities(attr.value) === val) return [];
    if (bare) return [{ from: attr.start, to: attr.end, insert: rawName }];
    if (attr.unterminated) return [{ from: attr.start, to: attr.end, insert: `${rawName}="${escapeAttr(val)}"` }];
    if (attr.quote === '"' || attr.quote === "'") return [{ from: attr.valueStart, to: attr.valueEnd, insert: escapeAttr(val, attr.quote) }];
    if (/^[^\s"'=<>`]+$/.test(val)) return [{ from: attr.valueStart, to: attr.valueEnd, insert: escapeAttr(val) }];
    return [{ from: attr.start, to: attr.end, insert: `${rawName}="${escapeAttr(val)}"` }];
  }
  const last = el.attrs[el.attrs.length - 1];
  const q = last && last.quote === "'" ? "'" : '"';
  const text = bare ? name : `${name}=${q}${escapeAttr(val, q)}${q}`;
  const pos = last ? last.end : el.open.start + 1 + rawTagLen(s, el);
  let sep = " ";
  if (last && s.slice(el.open.start, last.start).includes("\n") && onlyBlank(s, lineStartOf(s, last.start), last.start)) {
    sep = detectEol(s) + indentOfLine(s, last.start);
  }
  return [{ from: pos, to: pos, insert: sep + text }];
}

/**
 * Replaces the class list. Removes the attribute when empty. Whitespace-only differences are not changes.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @param {string[]} classes
 * @returns {Change[]}
 */
export function setClasses(parsed, id, classes) {
  const el = getEl(parsed, id);
  const seen = new Set();
  const list = [];
  for (const c of classes || []) {
    for (const t of String(c).split(/\s+/)) {
      if (t && !seen.has(t)) {
        seen.add(t);
        list.push(t);
      }
    }
  }
  const cur = classList(el);
  if (cur.length === list.length && cur.every((c, i) => c === list[i])) return [];
  if (!list.length) return setAttribute(parsed, id, "class", null);
  return setAttribute(parsed, id, "class", list.join(" "));
}

/**
 * Merges declarations into style="...", keeping order and other declarations. null removes; the attribute is removed when empty.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @param {Record<string, string|null>} props
 * @returns {Change[]}
 */
export function setInlineStyle(parsed, id, props) {
  const el = getEl(parsed, id);
  const attr = findAttr(el, "style");
  const oldText = attr && attr.value !== null ? decodeEntities(attr.value) : "";
  const decls = parseDeclarationList(oldText);
  const ch = declChanges(oldText, { start: 0, end: oldText.length }, decls, normalizeProps(props), { inline: true, indent: "", unit: "", eol: "\n" });
  const newText = applyChanges(oldText, ch);
  if (newText === oldText) return [];
  if (newText.trim() === "") return attr ? setAttribute(parsed, id, "style", null) : [];
  return setAttribute(parsed, id, "style", newText.trim());
}

/**
 * Renames the start and end tag.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @param {string} newTag
 * @returns {Change[]}
 */
export function setTag(parsed, id, newTag) {
  const el = getEl(parsed, id);
  const s = parsed.source;
  if (typeof newTag !== "string" || !VALID_TAG.test(newTag)) throw new Error(`Invalid tag name "${newTag}"`);
  if (newTag.toLowerCase() === el.tag) return [];
  if (isVoidTag(newTag) !== el.void) throw new Error(`Cannot change <${el.tag}> to <${newTag}>: void and non-void elements are not interchangeable`);
  const changes = [{ from: el.open.start + 1, to: el.open.start + 1 + rawTagLen(s, el), insert: newTag }];
  if (el.close) changes.push({ from: el.close.start + 2, to: el.close.start + 2 + el.tag.length, insert: newTag });
  guardStructure(parsed, changes, `change <${el.tag}> to <${newTag}>`);
  return changes;
}

/**
 * Structure-changing edits must not turn valid markup into invalid markup (for example a <section> inside a <p>, or a
 * <li> inside a link inside another <li>, which the HTML parser would split). The result is parsed and the edit is
 * refused when it would add errors.
 */
function guardStructure(parsed, changes, what) {
  if (!changes.length) return;
  const count = (list) => list.filter((d) => d.severity === "error").length;
  const after = parseHtml(applyChanges(parsed.source, changes));
  if (count(after.errors) > count(parsed.errors)) throw new Error(`Cannot ${what}: the result would contain invalid HTML`);
}

function contentOf(s, el) {
  if (el.void || el.selfClosing) throw new Error(`<${el.tag}> cannot have content`);
  const r = contentRange(el);
  return el.close ? r : { start: r.start, end: Math.max(r.start, effEnd(s, el)) };
}

/**
 * Replaces the content of an element with escaped text.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @param {string} text
 * @returns {Change[]}
 */
export function setText(parsed, id, text) {
  const el = getEl(parsed, id);
  const s = parsed.source;
  const r = contentOf(s, el);
  const insert = el.tag === "script" || el.tag === "style" ? String(text) : escapeText(String(text));
  if (s.slice(r.start, r.end) === insert) return [];
  return [{ from: r.start, to: r.end, insert }];
}

/**
 * Replaces the content of an element with raw HTML.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @param {string} html
 * @returns {Change[]}
 */
export function setInnerHtml(parsed, id, html) {
  const el = getEl(parsed, id);
  const s = parsed.source;
  const r = contentOf(s, el);
  const insert = String(html);
  if (s.slice(r.start, r.end) === insert) return [];
  return [{ from: r.start, to: r.end, insert }];
}

/** Elements that hold running text: children are inserted inline instead of on new lines. */
const TEXT_FLOW = new Set([
  "a", "abbr", "b", "bdi", "bdo", "button", "cite", "code", "em", "i", "kbd", "label", "mark", "q", "s", "samp", "small", "span", "strong",
  "sub", "sup", "time", "u", "var", "p", "li", "td", "th", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "figcaption", "summary", "caption",
  "legend", "option", "pre", "title", "textarea", "script", "style",
]);

/** Elements whose start tag closes an open <p>. */
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
  "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul",
]);

/** Formats an HTML fragment for insertion: trims it and re-indents every line after the first. */
function layoutFragment(html, indent, eol) {
  const lines = String(html).replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (!lines.length) return "";
  lines[0] = lines[0].trimStart();
  lines[lines.length - 1] = lines[lines.length - 1].trimEnd();
  if (/<(pre|textarea)\b/i.test(html)) return lines.join("\n").replace(/\n/g, eol);
  let min = Infinity;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    min = Math.min(min, /^[ \t]*/.exec(lines[i])[0].length);
  }
  if (!Number.isFinite(min)) min = 0;
  for (let i = 1; i < lines.length; i++) lines[i] = lines[i].trim() === "" ? "" : indent + lines[i].slice(min).trimEnd();
  return lines.join(eol);
}

/** Container used by `parentId === null`: <body>, else <html>, else the document. */
function rootContainer(parsed) {
  return findByTag(parsed, "body") || findByTag(parsed, "html") || null;
}

/**
 * Computes the single change that inserts `html` as child number `index` of a container.
 * Returns the change and the offset of the fragment inside `insert`.
 */
function planInsertion(parsed, container, index, html, exclude) {
  const plan = planInsertionAt(parsed, container, index, html, exclude);
  if (plan) {
    const at = plan.change.from;
    for (const d of parsed.errors) {
      if (d.code === "html/unterminated-tag" && at > d.start && at <= d.end) throw new Error("Cannot insert here: an unterminated tag runs to this position");
    }
  }
  return plan;
}

function planInsertionAt(parsed, container, index, html, exclude) {
  const s = parsed.source;
  const eol = detectEol(s);
  const unit = detectIndent(s);
  if (container && (container.void || container.selfClosing)) throw new Error(`Cannot insert into <${container.tag}>`);
  if (container && isRawTextTag(container.tag)) throw new Error(`Cannot insert elements into <${container.tag}>`);
  if (container && container.tag === "p") {
    // a block element ends the paragraph in HTML, so it can never be a child of <p>
    for (const top of parseHtml(html).children) {
      if (top.type === "element" && BLOCK_TAGS.has(top.tag)) throw new Error(`Cannot insert <${top.tag}> into <p>: block elements are not allowed inside a paragraph`);
    }
  }
  const kids = (container ? childElements(container) : childElements(parsed)).filter((k) => k !== exclude);
  const idx = Math.max(0, Math.min(kids.length, Math.floor(Number.isFinite(index) ? index : kids.length)));
  const baseIndent = container ? indentOfLine(s, container.start) : "";

  if (kids.length) {
    if (idx < kids.length) {
      const anchor = kids[idx];
      const ind = indentOfLine(s, anchor.start);
      const frag = layoutFragment(html, ind, eol);
      if (!frag) return null;
      if (firstOnLine(s, anchor.start)) {
        const from = lineStartOf(s, anchor.start);
        return { change: { from, to: from, insert: ind + frag + eol }, offset: ind.length };
      }
      return { change: { from: anchor.start, to: anchor.start, insert: frag }, offset: 0 };
    }
    const anchor = kids[kids.length - 1];
    const end = effEnd(s, anchor);
    const ind = indentOfLine(s, anchor.start);
    const frag = layoutFragment(html, ind, eol);
    if (!frag) return null;
    if (ownLine(s, anchor.start, end)) return { change: { from: end, to: end, insert: eol + ind + frag }, offset: eol.length + ind.length };
    return { change: { from: end, to: end, insert: frag }, offset: 0 };
  }

  const start = container ? container.open.end : 0;
  const end = container ? (container.close ? container.close.start : Math.max(start, effEnd(s, container))) : s.length;
  const inner = s.slice(start, end);
  const childIndent = baseIndent + (container ? unit : "");
  if (inner.trim() === "") {
    if (container && TEXT_FLOW.has(container.tag) && !inner.includes("\n")) {
      const frag = layoutFragment(html, baseIndent, eol);
      if (!frag) return null;
      return { change: { from: start, to: end, insert: frag }, offset: 0 };
    }
    const frag = layoutFragment(html, childIndent, eol);
    if (!frag) return null;
    if (!container) return { change: { from: 0, to: s.length, insert: frag + eol }, offset: 0 };
    return { change: { from: start, to: end, insert: eol + childIndent + frag + eol + baseIndent }, offset: eol.length + childIndent.length };
  }
  const frag = layoutFragment(html, baseIndent, eol);
  if (!frag) return null;
  if (!container) return { change: { from: end, to: end, insert: eol + frag }, offset: eol.length };
  return { change: { from: end, to: end, insert: frag }, offset: 0 };
}

/**
 * Inserts an HTML fragment as child number `index` (counting element children) of a parent.
 * parentId null = the top level of <body> (or of <html>, or of the document).
 * `at` is the offset of the fragment in the NEW source.
 * @param {ParsedHtml} parsed
 * @param {number|null} parentId
 * @param {number} index
 * @param {string} html
 * @returns {{ changes: Change[], at: number }}
 */
export function insertHtml(parsed, parentId, index, html) {
  const container = parentId === null || parentId === undefined ? rootContainer(parsed) : getEl(parsed, parentId);
  const plan = planInsertion(parsed, container, index, html, null);
  if (!plan) return { changes: [], at: container ? container.open.end : 0 };
  guardStructure(parsed, [plan.change], "insert the HTML here");
  return { changes: [plan.change], at: plan.change.from + plan.offset };
}

/**
 * Deletes an element together with the line it occupied.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @returns {Change[]}
 */
export function deleteElement(parsed, id) {
  const el = getEl(parsed, id);
  const r = removalRange(parsed.source, el.start, effEnd(parsed.source, el));
  return [{ from: r.from, to: r.to, insert: "" }];
}

/**
 * Exact source text of an element (without the whitespace that belongs to the next sibling).
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @returns {string}
 */
export function elementSource(parsed, id) {
  const el = getEl(parsed, id);
  return parsed.source.slice(el.start, effEnd(parsed.source, el));
}

/**
 * Inserts a copy after the element. `id` attributes inside the copy are removed to avoid duplicate ids.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @returns {{ changes: Change[], at: number }}
 */
export function duplicateElement(parsed, id) {
  const el = getEl(parsed, id);
  const s = parsed.source;
  const end = effEnd(s, el);
  const removals = [];
  for (let k = el.id; k < parsed.elements.length && parsed.elements[k].start < end; k++) {
    const idAttr = findAttr(parsed.elements[k], "id");
    if (idAttr) removals.push(attrRemoval(s, parsed.elements[k], idAttr));
  }
  let copy = "";
  let pos = el.start;
  for (const r of removals.sort((a, b) => a.from - b.from)) {
    copy += s.slice(pos, r.from);
    pos = r.to;
  }
  copy += s.slice(pos, end);
  const eol = detectEol(s);
  if (ownLine(s, el.start, end)) {
    const prefix = eol + indentOfLine(s, el.start);
    return { changes: [{ from: end, to: end, insert: prefix + copy }], at: end + prefix.length };
  }
  return { changes: [{ from: end, to: end, insert: copy }], at: end };
}

/** Re-indents the lines after the first one: strips `from`, adds `to`. */
function reindent(text, from, to) {
  if (/<(pre|textarea)\b/i.test(text)) return text;
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    const lead = /^[ \t]*/.exec(l)[0];
    let k = 0;
    while (k < lead.length && k < from.length && lead[k] === from[k]) k++;
    lines[i] = to + l.slice(k);
  }
  return lines.join("\n");
}

/**
 * Moves an element to another parent/index. `index` counts the new parent's element children after the element is removed.
 * Throws when the new parent is the element itself or one of its descendants.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @param {number|null} newParentId
 * @param {number} index
 * @returns {{ changes: Change[], at: number }}
 */
export function moveElement(parsed, id, newParentId, index) {
  const el = getEl(parsed, id);
  const s = parsed.source;
  const container = newParentId === null || newParentId === undefined ? rootContainer(parsed) : getEl(parsed, newParentId);
  if (container && isInside(container, el)) throw new Error("An element cannot be moved into itself or one of its descendants");
  if (container === el.parent) {
    const total = (container ? childElements(container) : childElements(parsed)).length - 1;
    const idx = Math.max(0, Math.min(total, Math.floor(Number.isFinite(index) ? index : total)));
    if (idx === el.index) return { changes: [], at: el.start };
  }
  const end = effEnd(s, el);
  const frag = reindent(s.slice(el.start, end), indentOfLine(s, el.start), "");
  const plan = planInsertion(parsed, container, index, frag, el);
  if (!plan) return { changes: [], at: el.start };
  const del = deleteElement(parsed, id)[0];
  const ins = plan.change;
  if (ins.from > del.from && ins.from < del.to) throw new Error("Cannot move the element to that position");
  const at = ins.from + plan.offset - (ins.from >= del.to ? del.to - del.from : 0);
  guardStructure(parsed, [del, ins], "move the element there");
  return { changes: [del, ins], at };
}

/**
 * Wraps an element in a new element.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @returns {{ changes: Change[], at: number }}
 */
export function wrapElement(parsed, id, tag, attrs = {}) {
  const el = getEl(parsed, id);
  const s = parsed.source;
  if (typeof tag !== "string" || !VALID_TAG.test(tag)) throw new Error(`Invalid tag name "${tag}"`);
  let attrText = "";
  for (const [k, v] of Object.entries(attrs || {})) {
    if (!VALID_ATTR.test(k)) throw new Error(`Invalid attribute name "${k}"`);
    attrText += ` ${k}="${escapeAttr(String(v))}"`;
  }
  const end = effEnd(s, el);
  const text = s.slice(el.start, end);
  const open = `<${tag}${attrText}>`;
  const close = `</${tag}>`;
  let insert;
  if (ownLine(s, el.start, end)) {
    const eol = detectEol(s);
    const indent = indentOfLine(s, el.start);
    const unit = detectIndent(s);
    insert = open + eol + indent + unit + reindent(text, "", unit) + eol + indent + close;
  } else insert = open + text + close;
  guardStructure(parsed, [{ from: el.start, to: end, insert }], `wrap the element in <${tag}>`);
  return { changes: [{ from: el.start, to: end, insert }], at: el.start };
}

/**
 * Replaces an element by its children (de-indented). Void elements are deleted.
 * @param {ParsedHtml} parsed
 * @param {number} id
 * @returns {Change[]}
 */
export function unwrapElement(parsed, id) {
  const el = getEl(parsed, id);
  const s = parsed.source;
  if (el.void || el.selfClosing) return deleteElement(parsed, id);
  const cr = contentOf(s, el);
  const inner = s.slice(cr.start, cr.end);
  if (inner.trim() === "") return deleteElement(parsed, id);
  const end = el.close ? el.close.end : effEnd(s, el);
  const block = firstOnLine(s, el.start) && /^[ \t]*\r?\n/.test(inner) && /\n[ \t]*$/.test(inner) && !/<(pre|textarea)\b/i.test(inner) && onlyBlank(s, end, lineEndOf(s, end));
  if (!block) {
    const ch = [{ from: el.start, to: end, insert: inner }];
    guardStructure(parsed, ch, "unwrap the element");
    return ch;
  }
  const indent = indentOfLine(s, el.start);
  const lines = inner.split("\n");
  lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const firstContent = lines.find((l) => l.trim() !== "") || "";
  const ci = /^[ \t]*/.exec(firstContent)[0];
  const remove = ci.startsWith(indent) ? ci.length - indent.length : 0;
  const out = lines.map((l, i) => {
    if (i === 0) return l.trimStart();
    const lead = /^[ \t]*/.exec(l)[0].length;
    return l.slice(Math.min(remove, lead));
  });
  const ch = [{ from: el.start, to: end, insert: out.join("\n").replace(/\r$/, "") }];
  guardStructure(parsed, ch, "unwrap the element");
  return ch;
}

// ------------------------------------------------------------------------------------------------ declaration editing

/** @typedef {{ key: string, remove: boolean, value: string, important: boolean|undefined }} PropEdit */

/**
 * @param {Record<string, string | { value: string, important?: boolean } | null | undefined>} props
 * @returns {PropEdit[]}
 */
function normalizeProps(props) {
  /** @type {Map<string, PropEdit>} */
  const map = new Map();
  for (const [k, spec] of Object.entries(props || {})) {
    const key = k.startsWith("--") ? k : k.trim().toLowerCase();
    if (!key) continue;
    let value = "";
    let important;
    if (spec && typeof spec === "object") {
      value = String(spec.value ?? "");
      important = spec.important === undefined ? undefined : !!spec.important;
    } else if (spec !== null && spec !== undefined) value = String(spec);
    value = value.trim().replace(/;+\s*$/, "").trim();
    map.set(key, { key, remove: value === "", value, important });
  }
  return [...map.values()];
}

const declText = (key, value, important) => `${key}: ${value}${important ? " !important" : ""};`;

/**
 * Changes that apply `edits` to the declarations of one block. `src` is the full text the offsets refer to
 * (a stylesheet for rules, the attribute text for inline styles).
 * @param {string} src
 * @param {{ start: number, end: number }} block
 * @param {Decl[]} decls
 * @param {PropEdit[]} edits
 * @param {{ inline?: boolean, indent: string, unit: string, eol: string, nestedStart?: number }} ctx
 * @returns {Change[]}
 */
function declChanges(src, block, decls, edits, ctx) {
  const changes = [];
  const removed = new Set();
  const appends = [];
  for (const e of edits) {
    const same = decls.filter((d) => d.prop === e.key);
    if (e.remove) {
      for (const d of same) removed.add(d);
      continue;
    }
    const target = same[same.length - 1];
    if (!target) {
      appends.push(e);
      continue;
    }
    const hasSemi = src[target.end - 1] === ";";
    const rawEnd = hasSemi ? target.end - 1 : target.end;
    const wantImportant = e.important === undefined ? target.important : e.important;
    if (target.valueStart === target.valueEnd && src[target.valueStart - 1] === ":") {
      changes.push({ from: target.valueStart, to: Math.max(target.valueStart, rawEnd), insert: ` ${e.value}${wantImportant ? " !important" : ""}` });
      continue;
    }
    if (e.value !== target.value) changes.push({ from: target.valueStart, to: target.valueEnd, insert: e.value });
    if (wantImportant !== target.important) changes.push({ from: target.valueEnd, to: rawEnd, insert: wantImportant ? " !important" : "" });
  }
  const remaining = decls.filter((d) => !removed.has(d));

  if (!remaining.length && removed.size && appends.length) {
    const first = decls[0];
    const last = decls[decls.length - 1];
    const lines = appends.map((e) => declText(e.key, e.value, e.important));
    const joiner = ctx.inline || !src.slice(block.start, block.end).includes("\n") ? " " : ctx.eol + ctx.indent + ctx.unit;
    return [{ from: first.start, to: last.end, insert: lines.join(joiner) }];
  }

  const removals = [];
  for (const d of removed) {
    if (ctx.inline) {
      let to = d.end;
      while (to < src.length && isHSpace(src[to])) to++;
      let from = d.start;
      if (to >= src.length) while (from > block.start && isHSpace(src[from - 1])) from--;
      removals.push({ from, to });
      continue;
    }
    if (ownLine(src, d.start, d.end)) {
      const e = lineEndOf(src, d.end);
      removals.push({ from: lineStartOf(src, d.start), to: e < src.length ? e + 1 : src.length });
      continue;
    }
    let from = d.start;
    let to = d.end;
    let t = to;
    while (t < block.end && isHSpace(src[t])) t++;
    if (t < block.end && src[t] !== "\n" && src[t] !== "\r") to = t;
    else while (from > block.start && isHSpace(src[from - 1])) from--;
    removals.push({ from, to });
  }
  changes.push(...mergeRanges(removals));

  if (appends.length) {
    const items = appends.map((e) => declText(e.key, e.value, e.important));
    const region = src.slice(block.start, block.end);
    const multiline = !ctx.inline && region.includes("\n");
    let declIndent = ctx.indent + ctx.unit;
    for (const d of remaining) {
      if (firstOnLine(src, d.start)) {
        declIndent = indentOfLine(src, d.start);
        break;
      }
    }
    if (remaining.length) {
      const anchor = remaining[remaining.length - 1];
      const hasSemi = src[anchor.end - 1] === ";";
      let pos = anchor.end;
      if (multiline) {
        // keep a trailing comment on the anchor's line with the anchor
        let k = pos;
        while (k < block.end && isHSpace(src[k])) k++;
        if (src.startsWith("/*", k)) {
          const e = src.indexOf("*/", k + 2);
          if (e >= 0 && e + 2 <= block.end && !src.slice(k, e).includes("\n")) pos = e + 2;
        }
      }
      if (ctx.inline) {
        changes.push({ from: pos, to: pos, insert: hasSemi ? " " + items.join(" ") : "; " + items.join(" ").replace(/;$/, "") });
      } else if (multiline) {
        const tail = items.map((t) => ctx.eol + declIndent + t).join("");
        if (!hasSemi && pos !== anchor.end) {
          changes.push({ from: anchor.end, to: anchor.end, insert: ";" }, { from: pos, to: pos, insert: tail });
        } else changes.push({ from: pos, to: pos, insert: (hasSemi ? "" : ";") + tail });
      } else {
        changes.push({ from: pos, to: pos, insert: (hasSemi ? "" : ";") + items.map((t) => " " + t).join("") });
      }
    } else if (ctx.inline) {
      changes.push({ from: block.start, to: block.end, insert: items.join(" ") });
    } else if (ctx.nestedStart !== undefined) {
      const ls = lineStartOf(src, ctx.nestedStart);
      const ind = indentOfLine(src, ctx.nestedStart);
      if (firstOnLine(src, ctx.nestedStart)) changes.push({ from: ls, to: ls, insert: items.map((t) => ind + t + ctx.eol).join("") });
      else changes.push({ from: ctx.nestedStart, to: ctx.nestedStart, insert: items.join(" ") + " " });
    } else if (region.trim() === "") {
      changes.push({ from: block.start, to: block.end, insert: items.map((t) => ctx.eol + declIndent + t).join("") + ctx.eol + ctx.indent });
    } else {
      changes.push({ from: block.end, to: block.end, insert: items.map((t) => ctx.eol + declIndent + t).join("") + ctx.eol + ctx.indent });
    }
  }
  return changes;
}

// ------------------------------------------------------------------------------------------------ CSS edits

/**
 * @typedef {{ selector: string, media?: string|null }} RuleTarget
 */

const normMedia = (m) => (m === null || m === undefined || String(m).trim() === "" ? null : normalizeMedia(m));

/**
 * All style rules matching a target, in document order. Top-level targets (media null) match only rules that are not
 * inside any at-rule; media targets match rules whose innermost enclosing @media has the same normalized prelude.
 * @param {ParsedCss} parsed
 * @param {RuleTarget} target
 * @returns {StyleRule[]}
 */
export function findRules(parsed, target) {
  const sel = normalizeSelector(target.selector);
  const media = normMedia(target.media);
  return flattenRules(parsed).filter((r) => {
    if (r.outer) return false;
    if (normalizeSelector(r.selector) !== sel) return false;
    return media === null ? r.parent === null : mediaOf(r) === media;
  });
}

/**
 * The style rule for a (selector, media) target; the last one when the stylesheet defines it more than once.
 * @param {ParsedCss} parsed
 * @param {RuleTarget} target
 * @returns {StyleRule|null}
 */
export function findRule(parsed, target) {
  const all = findRules(parsed, target);
  return all.length ? all[all.length - 1] : null;
}

/**
 * Declarations of a target (all matching rules merged, later declarations win).
 * @param {ParsedCss} parsed
 * @param {RuleTarget} target
 * @returns {Record<string, Decl>}
 */
export function getDeclarations(parsed, target) {
  const out = {};
  for (const r of findRules(parsed, target)) for (const d of r.decls) out[d.prop] = d;
  return out;
}

const ruleCtx = (src, rule) => ({ indent: indentOfLine(src, rule.start), unit: detectIndent(src), eol: detectEol(src) });

/** Removes rule nodes; an at-rule left without content is removed with them. */
function removeNodes(parsed, nodes) {
  const src = parsed.source;
  const set = new Set(nodes);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of [...set]) {
      const p = n.parent;
      if (p && !set.has(p) && p.block && p.decls.length === 0 && p.rules.length > 0 && p.rules.every((r) => set.has(r))) {
        set.add(p);
        grew = true;
      }
    }
  }
  const top = [...set].filter((n) => {
    for (let p = containerOf(n); p; p = containerOf(p)) if (set.has(p)) return false;
    return true;
  });
  const ranges = top.map((n) => {
    let { from, to } = removalRange(src, n.start, n.end);
    if (ownLine(src, n.start, n.end)) {
      // swallow one adjacent blank line so no double gaps remain
      const nextEnd = lineEndOf(src, to);
      if (to < src.length && onlyBlank(src, to, nextEnd)) to = nextEnd < src.length ? nextEnd + 1 : src.length;
      else if (from > 0) {
        const prevStart = lineStartOf(src, from - 1);
        let k = to;
        while (k < src.length && /\s/.test(src[k])) k++;
        if (onlyBlank(src, prevStart, from - 1) && (k >= src.length || src[k] === "}")) from = prevStart;
      }
    }
    return { from, to };
  });
  return mergeRanges(ranges);
}

/** @param {string} src */
function tailNewlines(src) {
  let n = 0;
  for (let i = src.length - 1; i >= 0; i--) {
    const c = src[i];
    if (c === "\n") n++;
    else if (c !== " " && c !== "\t" && c !== "\r") break;
  }
  return n;
}

/** Canonical text for a parsed rule (used when copying rules between stylesheets). */
function serializeRule(rule, base, unit, eol) {
  const lines = [];
  if (rule.type === "style") lines.push(`${base}${rule.selector} {`);
  else if (!rule.block) return `${base}@${rule.name}${rule.prelude ? " " + rule.prelude : ""};`;
  else lines.push(`${base}@${rule.name}${rule.prelude ? " " + rule.prelude : ""} {`);
  for (const d of rule.decls) lines.push(`${base}${unit}${d.prop}: ${d.value}${d.important ? " !important" : ""};`);
  rule.rules.forEach((r, i) => {
    if (i > 0 || rule.decls.length) lines.push("");
    lines.push(serializeRule(r, base + unit, unit, eol));
  });
  lines.push(`${base}}`);
  return lines.join(eol);
}

function ruleWithDecls(selector, decls, base, unit, eol) {
  return [`${base}${selector} {`, ...decls.map((d) => `${base}${unit}${declText(d.key ?? d.prop, d.value, d.important)}`), `${base}}`].join(eol);
}

/** True for width-based media queries ((min|max)-width, in px); other queries such as print or prefers-reduced-motion do not count. */
const isWidthQuery = (prelude) => {
  const q = parseMediaQuery(prelude);
  return q.minWidth !== null || q.maxWidth !== null;
};

const mediaKind = (prelude) => {
  const q = parseMediaQuery(prelude);
  if (q.other) return { kind: "other" };
  if (q.maxWidth !== null && q.minWidth === null) return { kind: "max", v: q.maxWidth };
  if (q.minWidth !== null && q.maxWidth === null) return { kind: "min", v: q.minWidth };
  return { kind: "other" };
};

/**
 * Inserts rules. Each piece is { selector, media, decls: [{ key|prop, value, important }] } or { raw: string-builder, media }.
 * Pieces for the same place are merged into one change.
 * @param {ParsedCss} parsed
 * @param {{ selector?: string, media?: string|null, decls?: any[], serialize?: (base: string, unit: string, eol: string) => string }[]} pieces
 * @returns {Change[]}
 */
function insertRulePieces(parsed, pieces) {
  const src = parsed.source;
  const unit = detectIndent(src);
  const eol = detectEol(src);
  const topBlocks = parsed.rules.filter((r) => r.type === "at" && r.name === "media" && r.block);
  /** @type {Map<string, { kind: string, node: any, texts: { text: string, rank: number }[] }>} */
  const groups = new Map();
  const group = (key, kind, node) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { kind, node, texts: [] }));
    return g;
  };
  const textFor = (p, base) => (p.serialize ? p.serialize(base, unit, eol) : ruleWithDecls(p.selector.trim(), p.decls, base, unit, eol));

  // new media blocks, grouped by their normalized prelude
  /** @type {Map<string, { prelude: string, pieces: any[] }>} */
  const newBlocks = new Map();
  for (const p of pieces) {
    const media = normMedia(p.media);
    if (media === null) {
      // desktop-first cascade: a new un-queried style rule must precede every width-based @media block, otherwise it
      // would override the declarations of those blocks (same specificity, later wins)
      const before = p.selector ? topBlocks.find((b) => isWidthQuery(b.prelude)) || null : null;
      if (before && firstOnLine(src, before.start)) group(`before:${before.start}`, "before", before).texts.push({ text: textFor(p, ""), rank: 0 });
      else group("end", "end", null).texts.push({ text: textFor(p, ""), rank: 0 });
      continue;
    }
    const existing = [...topBlocks].reverse().find((b) => normalizeMedia(b.prelude) === media);
    if (existing) {
      const last = existing.rules[existing.rules.length - 1];
      const base = last ? indentOfLine(src, last.start) : indentOfLine(src, existing.start) + unit;
      group(`inside:${existing.start}`, "inside", existing).texts.push({ text: textFor(p, base), rank: 0 });
      continue;
    }
    let nb = newBlocks.get(media);
    if (!nb) newBlocks.set(media, (nb = { prelude: String(p.media).trim().replace(/\s+/g, " "), pieces: [] }));
    nb.pieces.push(p);
  }
  for (const [media, nb] of newBlocks) {
    const k = mediaKind(media);
    let successor = null;
    if (k.kind === "max") {
      successor = topBlocks.find((b) => {
        const bk = mediaKind(b.prelude);
        return (bk.kind === "max" && bk.v < k.v) || bk.kind === "min";
      });
    } else if (k.kind === "min") {
      successor = topBlocks.find((b) => {
        const bk = mediaKind(b.prelude);
        return bk.kind === "min" && bk.v > k.v;
      });
    }
    const text = [`@media ${nb.prelude} {`, nb.pieces.map((p) => textFor(p, unit)).join(eol + eol), "}"].join(eol);
    const rank = k.kind === "max" ? 1000000 - k.v : k.kind === "min" ? 2000000 + k.v : 3000000;
    if (successor && firstOnLine(src, successor.start)) group(`before:${successor.start}`, "before", successor).texts.push({ text, rank });
    else group("end", "end", null).texts.push({ text, rank });
  }

  const changes = [];
  for (const g of groups.values()) {
    g.texts.sort((a, b) => a.rank - b.rank);
    const body = g.texts.map((t) => t.text).join(eol + eol);
    if (g.kind === "end") {
      if (src.trim() === "") changes.push({ from: 0, to: src.length, insert: body + eol });
      else {
        const need = Math.max(0, 2 - tailNewlines(src));
        changes.push({ from: src.length, to: src.length, insert: eol.repeat(need) + body + eol });
      }
    } else if (g.kind === "before") {
      const at = lineStartOf(src, g.node.start);
      changes.push({ from: at, to: at, insert: body + eol + eol });
    } else {
      const node = g.node;
      const last = node.rules[node.rules.length - 1];
      if (last) changes.push({ from: last.end, to: last.end, insert: eol + eol + body });
      else {
        const b = node.block;
        const base = indentOfLine(src, node.start);
        changes.push({ from: b.start, to: b.end, insert: eol + body + eol + base });
      }
    }
  }
  return changes;
}

/**
 * Sets, adds or removes declarations of a (selector, media) target. Creates the rule (and the @media block) when missing,
 * and removes rules and media blocks that end up empty. `null` or '' removes a property.
 * @param {ParsedCss} parsed
 * @param {RuleTarget} target
 * @param {Record<string, string | { value: string, important?: boolean } | null>} props
 * @returns {Change[]}
 */
export function setDeclarations(parsed, target, props) {
  const src = parsed.source;
  const edits = normalizeProps(props);
  if (!edits.length) return [];
  const matches = findRules(parsed, target);
  if (!matches.length) {
    const sets = edits.filter((e) => !e.remove);
    if (!sets.length) return [];
    return insertRulePieces(parsed, [{ selector: String(target.selector).trim(), media: target.media ?? null, decls: sets }]);
  }
  /** @type {Map<StyleRule, PropEdit[]>} */
  const perRule = new Map();
  const add = (rule, e) => {
    if (!perRule.has(rule)) perRule.set(rule, []);
    perRule.get(rule).push(e);
  };
  for (const e of edits) {
    if (e.remove) {
      for (const r of matches) if (r.decls.some((d) => d.prop === e.key)) add(r, e);
      continue;
    }
    let owner = null;
    for (const r of matches) if (r.decls.some((d) => d.prop === e.key)) owner = r;
    add(owner || matches[matches.length - 1], e);
  }
  const changes = [];
  const emptied = [];
  for (const [rule, list] of perRule) {
    const removeKeys = new Set(list.filter((e) => e.remove).map((e) => e.key));
    const appended = list.filter((e) => !e.remove && !rule.decls.some((d) => d.prop === e.key));
    const remaining = rule.decls.filter((d) => !removeKeys.has(d.prop));
    if (removeKeys.size && !remaining.length && !appended.length && !rule.rules.length) {
      emptied.push(rule);
      continue;
    }
    const ctx = { ...ruleCtx(src, rule), nestedStart: rule.rules.length && !rule.decls.length ? rule.rules[0].start : undefined };
    changes.push(...declChanges(src, rule.block, rule.decls, list, ctx));
  }
  if (emptied.length) changes.push(...removeNodes(parsed, emptied));
  return changes;
}

/**
 * Deletes every rule that matches the target (and a media block that becomes empty).
 * @param {ParsedCss} parsed
 * @param {RuleTarget} target
 * @returns {Change[]}
 */
export function deleteRule(parsed, target) {
  const matches = findRules(parsed, target);
  return matches.length ? removeNodes(parsed, matches) : [];
}

/**
 * Replaces a selector (exact normalized match, every media context).
 * @param {ParsedCss} parsed
 * @param {string} from
 * @param {string} to
 * @returns {Change[]}
 */
export function renameSelector(parsed, from, to) {
  const src = parsed.source;
  const key = normalizeSelector(from);
  const text = String(to).trim();
  const out = [];
  for (const r of flattenRules(parsed)) {
    if (normalizeSelector(r.selector) !== key) continue;
    if (src.slice(r.selectorStart, r.selectorEnd) === text) continue;
    out.push({ from: r.selectorStart, to: r.selectorEnd, insert: text });
  }
  return out;
}

/**
 * Renames a class in every selector that contains it as a whole class token.
 * @param {ParsedCss} parsed
 * @param {string} fromClass
 * @param {string} toClass
 * @returns {Change[]}
 */
export function renameClass(parsed, fromClass, toClass) {
  const from = String(fromClass).replace(/^\./, "");
  const to = String(toClass).replace(/^\./, "");
  if (!from || !to || from === to) return [];
  const src = parsed.source;
  const insert = cssEscapeIdent(to);
  const out = [];
  for (const r of flattenRules(parsed)) {
    const text = src.slice(r.selectorStart, r.selectorEnd);
    for (const t of scanClassTokens(text)) {
      if (t.name === from) out.push({ from: r.selectorStart + t.start, to: r.selectorStart + t.end, insert });
    }
  }
  return out;
}

/**
 * Adds only those rules of `cssText` whose (selector, media) pair does not exist in `source`.
 * Other at-rules (@keyframes, @font-face ...) are added when an identical one is absent.
 * @param {string} source
 * @param {string} cssText
 * @returns {Change[]}
 */
export function appendRulesIfMissing(source, cssText) {
  const parsed = parseCss(source);
  const snippet = parseCss(cssText);
  const have = new Set();
  for (const r of flattenRules(parsed)) {
    if (r.outer) continue;
    const media = r.parent === null ? "" : mediaOf(r);
    if (media !== null) have.add(`${normalizeSelector(r.selector)}|${media}`);
  }
  const haveAt = new Set();
  for (const r of parsed.rules) if (r.type === "at" && r.name !== "media") haveAt.add(atKey(r));
  const pieces = [];
  const unit = detectIndent(source);
  const eol = detectEol(source);
  for (const r of snippet.rules) {
    if (r.type === "style") {
      if (!have.has(`${normalizeSelector(r.selector)}|`)) {
        have.add(`${normalizeSelector(r.selector)}|`);
        pieces.push({ selector: r.selector, media: null, serialize: (base, u, e) => serializeRule(r, base, u, e) });
      }
    } else if (r.name === "media" && r.block) {
      const media = normalizeMedia(r.prelude);
      for (const c of r.rules) {
        if (c.type !== "style") continue;
        const key = `${normalizeSelector(c.selector)}|${media}`;
        if (have.has(key)) continue;
        have.add(key);
        pieces.push({ selector: c.selector, media: r.prelude, serialize: (base, u, e) => serializeRule(c, base, u, e) });
      }
    } else if (!haveAt.has(atKey(r))) {
      haveAt.add(atKey(r));
      pieces.push({ selector: null, media: null, serialize: (base, u, e) => serializeRule(r, base, u, e) });
    }
  }
  void unit;
  void eol;
  return pieces.length ? insertRulePieces(parsed, pieces) : [];
}

function atKey(r) {
  return `@${r.name} ${normalizeMedia(r.prelude)} ${r.decls.map((d) => `${d.prop}:${d.value}`).join(";")}`;
}
