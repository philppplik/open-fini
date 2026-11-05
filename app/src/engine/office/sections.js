// Semantic structure of a word-processing document (pure, no DOM): sections by heading, finding a section by its
// heading text, replacing a section's body while keeping the heading and the body style, moving sections to
// restructure the outline, tables as text rows, an outline → slides plan, and an accessibility check. Used by the
// Vibe tools in vibe/tools/office-semantic.js; covered by tests/office/sections.test.js.
import { headingLevel, paraText, para, resolveStyle } from "./model.js";

const clean = (s) => String(s ?? "").replace(/￼/g, "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/^[\d.)\s]+/, "").replace(/[.:]+$/, "");

/** Every heading's section: `{ index, level, text, end }`; `end` is exclusive and stops at the next heading of the
 *  same or a higher level, so a section includes its subsections. */
export function sections(doc) {
  const heads = [];
  doc.blocks.forEach((b, i) => {
    const level = headingLevel(doc, b);
    if (level) heads.push({ index: i, level, text: clean(paraText(b)) });
  });
  return heads.map((h, k) => {
    const next = heads.slice(k + 1).find((x) => x.level <= h.level);
    return { ...h, end: next ? next.index : doc.blocks.length };
  });
}

/** The section whose heading matches `query` (exact, then ignoring case/numbering, then contains). Throws a helpful
 *  error listing the headings when nothing or more than one section matches. `nth` (1-based) picks among duplicates. */
export function findSection(doc, query, { nth } = {}) {
  const all = sections(doc);
  if (!all.length) throw new Error("The document has no headings. Apply heading styles first (office_set_style Heading1/Heading2) or address blocks by index.");
  if (Number.isInteger(query)) {
    const s = all.find((x) => x.index === query);
    if (!s) throw new Error(`Block ${query} is not a heading. Headings: ${all.map((x) => `${x.index} “${x.text}”`).join(", ")}.`);
    return s;
  }
  const q = norm(query);
  let hits = all.filter((s) => s.text === clean(query));
  if (!hits.length) hits = all.filter((s) => norm(s.text) === q);
  if (!hits.length && q) hits = all.filter((s) => norm(s.text).includes(q));
  if (!hits.length) throw new Error(`No heading matches “${query}”. Headings: ${all.map((s) => `“${s.text}”`).join(", ")}.`);
  if (nth) {
    if (!hits[nth - 1]) throw new Error(`Only ${hits.length} heading(s) match “${query}”.`);
    return hits[nth - 1];
  }
  if (hits.length > 1) throw new Error(`${hits.length} headings match “${query}” (${hits.map((s) => `${s.index} “${s.text}”`).join(", ")}). Pass the exact heading text or nth.`);
  return hits[0];
}

/** The style id most used by the body paragraphs of a section (not headings, not list items), or "Normal". */
export function bodyStyle(doc, sec) {
  const count = {};
  for (let i = sec.index + 1; i < sec.end; i++) {
    const b = doc.blocks[i];
    if (b.type === "paragraph" && !headingLevel(doc, b) && !b.list) count[b.style] = (count[b.style] || 0) + 1;
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || "Normal";
}

/**
 * Replaces the body of a section (everything after its heading, up to `end`) with `blocks`. With `keepSubsections`
 * only the text before the first subheading is replaced. Plain "Normal" paragraphs of the new content take the
 * section's previous body style and the direct paragraph properties (`props`: alignment, spacing, indents) of its
 * first body paragraph, so a rewrite keeps the look. Returns `{ doc, from, to }` (new block range of the body).
 */
export function replaceSectionBody(doc, sec, blocks, { keepSubsections = false } = {}) {
  let end = sec.end;
  if (keepSubsections) {
    const sub = sections(doc).find((s) => s.index > sec.index && s.index < sec.end);
    if (sub) end = sub.index;
  }
  const style = bodyStyle(doc, { ...sec, end });
  const first = doc.blocks.slice(sec.index + 1, end).find((b) => b.type === "paragraph" && !headingLevel(doc, b) && !b.list);
  const props = first?.props ? { props: first.props } : {};
  const add = blocks.map((b) => (b.type === "paragraph" && (b.style || "Normal") === "Normal" && !b.list ? { ...props, ...b, style } : b));
  const list = doc.blocks.slice();
  list.splice(sec.index + 1, end - sec.index - 1, ...add);
  if (list[list.length - 1]?.type !== "paragraph") list.push(para(""));
  return { doc: { ...doc, blocks: list }, from: sec.index + 1, to: sec.index + 1 + add.length };
}

/** Moves section `sec` (with its subsections) before or after section `target`. Returns the new document. */
export function moveSection(doc, sec, target, where = "after") {
  if (target.index >= sec.index && target.index < sec.end) throw new Error("A section cannot be moved into itself.");
  const chunk = doc.blocks.slice(sec.index, sec.end);
  const rest = [...doc.blocks.slice(0, sec.index), ...doc.blocks.slice(sec.end)];
  const shift = (i) => (i >= sec.end ? i - chunk.length : i);
  const at = where === "before" ? shift(target.index) : shift(target.end);
  rest.splice(at, 0, ...chunk);
  return { ...doc, blocks: rest };
}

/** Changes the heading level of a section and all its subsections by `delta` (promote −1, demote +1), within 1–6. */
export function shiftSectionLevel(doc, sec, delta) {
  const blocks = doc.blocks.map((b, i) => {
    if (i < sec.index || i >= sec.end) return b;
    const lvl = headingLevel(doc, b);
    if (!lvl) return b;
    const next = Math.max(1, Math.min(6, lvl + delta));
    return { ...b, style: `Heading${next}` };
  });
  return { ...doc, blocks };
}

/** A table block as rows of cell texts (merged cells repeat empty). */
export function tableRows(table) {
  return table.rows.map((r) => r.cells.map((c) => clean((c.blocks || []).map((b) => (b.type === "paragraph" ? paraText(b) : "")).join(" "))));
}

/** Tables of the document (top level) with their index, size, header flag and caption (the paragraph before). */
export function listTables(doc) {
  const out = [];
  doc.blocks.forEach((b, i) => {
    if (b.type !== "table") return;
    const prev = doc.blocks[i - 1];
    out.push({ index: i, rows: b.rows.length, columns: b.cols.length, header: !!b.rows[0]?.header, caption: prev?.type === "paragraph" && !prev.list ? clean(paraText(prev)).slice(0, 120) : "" });
  });
  return out;
}

/**
 * A slide plan from the outline: the title (Title style or first heading) becomes a title slide; every heading of
 * `level` or higher starts a slide whose bullets are its list items and the first sentence of each body paragraph
 * (at most `maxBullets`), with deeper headings as bullets. Tables are noted as "[table: n rows]".
 */
export function slidePlan(doc, { level = 2, maxBullets = 6 } = {}) {
  const slides = [];
  let cur = null;
  const titleBlock = doc.blocks.find((b) => b.type === "paragraph" && b.style === "Title");
  const subtitleBlock = doc.blocks.find((b) => b.type === "paragraph" && b.style === "Subtitle");
  if (titleBlock) slides.push({ layout: "title", title: clean(paraText(titleBlock)), subtitle: subtitleBlock ? clean(paraText(subtitleBlock)) : "", bullets: [] });
  const push = (text) => {
    if (cur && text && cur.bullets.length < maxBullets) cur.bullets.push(text.length > 120 ? `${text.slice(0, 117).trimEnd()}…` : text);
  };
  for (const b of doc.blocks) {
    if (b.type === "table") {
      push(`[table: ${b.rows.length} rows]`);
      continue;
    }
    if (b.type !== "paragraph" || b.style === "Title" || b.style === "Subtitle") continue;
    const lvl = headingLevel(doc, b);
    const text = clean(paraText(b));
    if (lvl && lvl <= level) {
      cur = { layout: "title-content", title: text, bullets: [] };
      slides.push(cur);
    } else if (lvl) push(text);
    else if (b.list) push(text);
    else if (text) push((text.match(/^.+?[.!?](\s|$)/)?.[0] || text).trim());
  }
  for (const s of slides) if (s.layout === "title-content" && !s.bullets.length) s.layout = "section";
  return slides;
}

/** Accessibility findings: heading order, empty headings, images without alt text, tables without a header row,
 *  vague link text, missing title, very long paragraphs and low text contrast on white. */
export function accessibilityCheck(doc) {
  const issues = [];
  const add = (index, rule, message) => issues.push({ index, rule, message });
  if (!clean(doc.meta?.title) && !doc.blocks.some((b) => b.type === "paragraph" && b.style === "Title")) add(null, "title", "The document has no title (set a Title paragraph or the document title).");
  let prev = 0;
  doc.blocks.forEach((b, i) => {
    if (b.type === "table") {
      if (!b.rows[0]?.header) add(i, "table-header", "Table without a header row: screen readers cannot name the columns.");
      return;
    }
    if (b.type !== "paragraph") return;
    const lvl = headingLevel(doc, b);
    const text = clean(paraText(b));
    if (lvl) {
      if (!text) add(i, "empty-heading", "Empty heading.");
      if (prev && lvl > prev + 1) add(i, "heading-order", `Heading level jumps from ${prev} to ${lvl} (“${text.slice(0, 60)}”).`);
      prev = lvl;
    } else if (text.length > 1200) add(i, "long-paragraph", "Very long paragraph (over 1200 characters): consider splitting it.");
    for (const r of b.runs || []) {
      if (r.type === "image" && !clean(r.alt)) add(i, "image-alt", "Image without alternative text.");
      if (r.link && /^(click here|here|link|more|read more|this)$/i.test(clean(r.text))) add(i, "link-text", `Vague link text “${clean(r.text)}”: describe the target.`);
      if (r.text && r.color && contrast(r.color, "#ffffff") < 4.5) add(i, "contrast", `Text color ${r.color} has a contrast below 4.5:1 on white.`);
    }
    if (!lvl && b.style && b.style !== "Normal") {
      const st = resolveStyle(doc, b.style);
      if (st.run?.color && contrast(st.run.color, "#ffffff") < 4.5) add(i, "contrast", `Style ${b.style} uses ${st.run.color}, contrast below 4.5:1 on white.`);
    }
  });
  return { ok: !issues.length, count: issues.length, issues: issues.slice(0, 200) };
}

function lum(hex) {
  const v = [1, 3, 5].map((k) => parseInt(String(hex).slice(k, k + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
/** WCAG contrast ratio of two #rrggbb colors (NaN-safe: invalid colors count as passing). */
export function contrast(a, b) {
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return 21;
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
