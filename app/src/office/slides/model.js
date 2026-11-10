// Presentation app model (Office Suite kind "slides"): plain JSON, immutable values, pure operations. No DOM; unit
// tested in tests/office/slides.test.js. User guide and format notes: docs/office-slides.md.
//
//   Deck    = { version: 1, size: { w, h } (px, 96 per inch), theme: Theme, meta: { title }, slides: Slide[],
//               media: { <id>: { id, mime, name, w, h, bytes } }, master: Master, layouts: { <layout id>: Ph[] } }
//   Master  = { elements: Element[] (drawn behind every slide's own elements), footer: { text, date, number (bool),
//               skipTitle (bool: no footer on "title" layout slides) } }
//   Ph      = [role, fx, fy, fw, fh]: a layout's placeholder box as fractions of the slide; `layouts` holds only the
//               layouts the user edited (the rest come from LAYOUTS)
//   Slide   = { id, ord (fractional key), layout, background: null | { color } | { media }, elements: Element[],
//               notes: string, transition: { type: "none"|"fade"|"slide", duration: s }, hidden?: true,
//               hideMaster?: true (no master graphics; the footer stays) }
//   Element = { id, z (fractional key), type: "text"|"shape"|"image"|"table"|"chart", x, y, w, h, rot (degrees), ph?,
//               text?: string ("\n" separates paragraphs), style?: TextStyle, spans?: Span[], levels?: number[]
//               (list level 0-8 per paragraph; missing = 0),
//               shape?: "rect"|"roundRect"|"ellipse"|"triangle"|"diamond"|"arrow"|"line", fill?, stroke?, strokeWidth?,
//               media? (image), rows?: string[][] (table), flipH?, flipV?,
//               chart? (engine/layout/chart-data.js definition with a data snapshot), source?: { doc, sheet, range } }
//   TextStyle = { font?, size (pt), color?, bold?, italic?, underline?, align: "left"|"center"|"right"|"justify",
//               valign: "top"|"middle"|"bottom", bullets? }
//   Span    = { start, end (UTF-16 offsets into `text`), bold?, italic?, underline?, color?, font?, size? (pt) }: mixed
//               formatting inside one text box; a span value overrides the element's TextStyle for those characters
//   Footer  = { text, date (fixed text), autoDate (bool: today's date, formatted when shown), dateFormat: "short" |
//               "long" | "full", number, skipTitle }; footer boxes carry `field: "date" | "slidenum"` for the writers
// The master and each layout are edited like slides through pseudo slide ids ("@master", "@layout:<id>"): slideById
// and updateSlide accept them, so every element operation below works on them too.
// Element order in `elements` is the z-order (back to front); `z` and `ord` mirror the array order as fractional keys
// so concurrent moves in "Edit together" merge (collab/fractional.js). Colors are "#rrggbb" or null; a null text color
// or font means "from the theme".
import { keyBetween, isKey } from "../../collab/fractional.js";
import { normalizeChart } from "../../engine/layout/chart-data.js";
import { localeTag } from "../../i18n/index.js";

export const SLIDES_VERSION = 1;
export const SIZES = { "16:9": { w: 960, h: 540 }, "4:3": { w: 960, h: 720 }, "16:10": { w: 960, h: 600 } };
export const PT = 4 / 3; // px per point

export const THEMES = [
  { id: "office", name: "Clean", bg: "#ffffff", text: "#1f2937", accent: "#2563eb", accent2: "#f59e0b", heading: "Calibri", body: "Calibri" },
  { id: "midnight", name: "Midnight", bg: "#0f172a", text: "#e2e8f0", accent: "#38bdf8", accent2: "#f472b6", heading: "Segoe UI", body: "Segoe UI" },
  { id: "paper", name: "Paper", bg: "#fbf7ef", text: "#3b3226", accent: "#b45309", accent2: "#15803d", heading: "Georgia", body: "Georgia" },
  { id: "ocean", name: "Ocean", bg: "#ecfeff", text: "#083344", accent: "#0e7490", accent2: "#f97316", heading: "Verdana", body: "Verdana" },
  { id: "bold", name: "Bold", bg: "#111111", text: "#fafafa", accent: "#facc15", accent2: "#ef4444", heading: "Arial", body: "Arial" },
  { id: "aurora", name: "Aurora", bg: "#0b1220", text: "#e5e7eb", accent: "#a78bfa", accent2: "#34d399", heading: "Trebuchet MS", body: "Segoe UI" },
  { id: "slate", name: "Slate", bg: "#f8fafc", text: "#0f172a", accent: "#334155", accent2: "#0ea5e9", heading: "Segoe UI", body: "Segoe UI" },
  { id: "sunrise", name: "Sunrise", bg: "#fff7ed", text: "#431407", accent: "#ea580c", accent2: "#be123c", heading: "Georgia", body: "Verdana" },
  { id: "forest", name: "Forest", bg: "#f0fdf4", text: "#14532d", accent: "#15803d", accent2: "#a16207", heading: "Georgia", body: "Calibri" },
];

/** Layouts: placeholder boxes as fractions of the slide (x, y, w, h). */
export const LAYOUTS = [
  { id: "title", name: "Title slide", ph: [["title", 0.08, 0.3, 0.84, 0.22], ["subtitle", 0.12, 0.56, 0.76, 0.14]] },
  { id: "title-content", name: "Title and content", ph: [["title", 0.06, 0.06, 0.88, 0.16], ["body", 0.06, 0.26, 0.88, 0.66]] },
  { id: "section", name: "Section header", ph: [["title", 0.08, 0.38, 0.84, 0.2], ["subtitle", 0.08, 0.6, 0.84, 0.1]] },
  { id: "two-content", name: "Two content", ph: [["title", 0.06, 0.06, 0.88, 0.16], ["body", 0.06, 0.26, 0.43, 0.66], ["body2", 0.51, 0.26, 0.43, 0.66]] },
  { id: "title-only", name: "Title only", ph: [["title", 0.06, 0.06, 0.88, 0.16]] },
  { id: "blank", name: "Blank", ph: [] },
];
export const SHAPES = ["rect", "roundRect", "ellipse", "triangle", "diamond", "arrow", "line"];
export const PH_ROLES = ["title", "subtitle", "body", "body2"];
export const CHART_KINDS = ["column", "bar", "line", "area", "pie", "donut", "stacked-column", "scatter"];
export const MASTER_ID = "@master";
export const LAYOUT_PREFIX = "@layout:";
export const SPAN_KEYS = ["bold", "italic", "underline", "color", "font", "size"];
export const MAX_LEVEL = 8;
export const DATE_FORMATS = ["short", "long", "full"];
export const TRANSITIONS = ["none", "fade", "slide"];

const PH_STYLE = {
  title: { size: 40, bold: true, align: "left", valign: "middle" },
  subtitle: { size: 22, align: "left", valign: "top" },
  body: { size: 22, align: "left", valign: "top", bullets: true },
  body2: { size: 22, align: "left", valign: "top", bullets: true },
};
const PH_HINT = { title: "Click to add title", subtitle: "Click to add subtitle", body: "Click to add text", body2: "Click to add text" };
export const placeholderHint = (ph) => PH_HINT[ph] || "";

let seq = 0;
/** A short id that is unique enough across collaborators (random part plus a session counter). */
export const newId = (p = "e") => `${p}${Math.random().toString(36).slice(2, 7)}${(seq++).toString(36)}`;

export const theme = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
export const layoutOf = (id) => LAYOUTS.find((l) => l.id === id) || LAYOUTS[1];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const color = (v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

// ---------------------------------------------------------------- ordering keys

/** Gives every item a strictly increasing fractional key in `field`, keeping the keys that are already in order. */
export function fixOrder(list, field) {
  let prev = null;
  let changed = false;
  const out = list.map((it, i) => {
    const ok = (k) => isKey(k) && (prev === null || k > prev);
    let next = null;
    for (let j = i + 1; j < list.length; j++) if (ok(list[j][field])) {
      next = list[j][field];
      break;
    }
    let k = it[field];
    if (!ok(k) || (next !== null && k >= next)) {
      k = keyBetween(prev, next);
      changed = true;
      it = { ...it, [field]: k };
    }
    prev = k;
    return it;
  });
  return changed ? out : list;
}

// ---------------------------------------------------------------- normalizing

function normStyle(s = {}, ph) {
  const base = PH_STYLE[ph] || { size: 18, align: "left", valign: "top" };
  return {
    font: typeof s.font === "string" && s.font ? s.font.slice(0, 80) : null,
    size: clamp(num(s.size, base.size), 4, 400),
    color: color(s.color),
    bold: !!(s.bold ?? base.bold),
    italic: !!s.italic,
    underline: !!s.underline,
    align: ["left", "center", "right", "justify"].includes(s.align) ? s.align : base.align,
    valign: ["top", "middle", "bottom"].includes(s.valign) ? s.valign : base.valign,
    bullets: !!(s.bullets ?? base.bullets),
  };
}

export function normElement(e) {
  const type = ["text", "shape", "image", "table", "chart"].includes(e?.type) ? e.type : "text";
  const out = { id: typeof e?.id === "string" && e.id ? e.id.slice(0, 64) : newId(), z: e?.z, type, x: num(e?.x), y: num(e?.y), w: Math.max(1, num(e?.w, 200)), h: Math.max(type === "shape" && e?.shape === "line" ? 0 : 1, num(e?.h, 80)), rot: num(e?.rot) % 360 };
  if (e?.ph) out.ph = String(e.ph).slice(0, 16);
  if (e?.flipH) out.flipH = true;
  if (e?.flipV) out.flipV = true;
  if (type === "text" || type === "shape") {
    out.text = typeof e.text === "string" ? e.text : "";
    out.style = normStyle(e.style, out.ph);
    out.fill = color(e.fill);
    out.stroke = color(e.stroke);
    out.strokeWidth = clamp(num(e.strokeWidth, type === "shape" ? 2 : 0), 0, 100);
    const spans = normSpans(e.spans, out.text.length);
    if (spans.length) out.spans = spans;
    const levels = normLevels(e.levels, out.text);
    if (levels.length) out.levels = levels;
  }
  if (type === "shape") out.shape = SHAPES.includes(e.shape) ? e.shape : "rect";
  if (type === "image") out.media = String(e.media || "");
  if (type === "table") {
    const rows = Array.isArray(e.rows) && e.rows.length ? e.rows : [[""]];
    const cols = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
    out.rows = rows.slice(0, 200).map((r) => Array.from({ length: Math.min(cols, 50) }, (_, c) => String((Array.isArray(r) ? r[c] : "") ?? "")));
    out.style = normStyle(e.style);
    out.header = e.header !== false;
    out.fill = color(e.fill);
    out.stroke = color(e.stroke) || "#9ca3af";
  }
  if (type === "chart") {
    out.chart = normalizeChart(e.chart);
    const src = e.source;
    if (src && typeof src === "object" && src.range) out.source = { doc: String(src.doc || "").slice(0, 200), sheet: String(src.sheet || "").slice(0, 100), range: String(src.range).slice(0, 40) };
  }
  return out;
}

export function normSlide(s) {
  const bg = s?.background;
  return {
    id: typeof s?.id === "string" && s.id ? s.id.slice(0, 64) : newId("s"),
    ord: s?.ord,
    layout: layoutOf(s?.layout).id,
    background: bg && color(bg.color) ? { color: color(bg.color) } : bg?.media ? { media: String(bg.media) } : null,
    elements: fixOrder((Array.isArray(s?.elements) ? s.elements : []).map(normElement), "z"),
    notes: typeof s?.notes === "string" ? s.notes : "",
    transition: { type: TRANSITIONS.includes(s?.transition?.type) ? s.transition.type : "none", duration: clamp(num(s?.transition?.duration, 0.5), 0.1, 5) },
    ...(s?.hidden ? { hidden: true } : {}),
    ...(s?.hideMaster ? { hideMaster: true } : {}),
  };
}

/** Master graphics and footer settings (normalizeDeck). Master elements never are placeholders. */
export function normMaster(m = {}) {
  const f = m?.footer || {};
  return {
    elements: fixOrder((Array.isArray(m?.elements) ? m.elements : []).slice(0, 100).map((e) => {
      const { ph, ...rest } = normElement({ ...e, ph: undefined });
      return rest;
    }), "z"),
    footer: { text: typeof f.text === "string" ? f.text.slice(0, 300) : "", date: typeof f.date === "string" ? f.date.slice(0, 80) : "", autoDate: !!f.autoDate, dateFormat: DATE_FORMATS.includes(f.dateFormat) ? f.dateFormat : "long", number: !!f.number, skipTitle: f.skipTitle !== false },
  };
}

/** Edited layouts: only known layout ids and roles, boxes clamped to the slide. */
export function normLayouts(l = {}) {
  const out = {};
  for (const [id, ph] of Object.entries(l || {})) {
    if (!LAYOUTS.some((x) => x.id === id) || !Array.isArray(ph)) continue;
    const seen = new Set();
    out[id] = ph.filter((p) => Array.isArray(p) && PH_ROLES.includes(p[0]) && !seen.has(p[0]) && seen.add(p[0])).map(([role, ...b]) => {
      const [x, y, w, h] = [0, 1, 2, 3].map((i) => clamp(num(b[i]), 0, 1));
      return [role, round4(x), round4(y), round4(clamp(w, 0.01, Math.max(0.01, 1 - x))), round4(clamp(h, 0.01, Math.max(0.01, 1 - y)))];
    });
  }
  return out;
}
const round4 = (v) => Math.round(v * 10000) / 10000;

/** Validates and completes a model from disk, an import, Vibe or a collaborator. */
export function normalizeDeck(m = {}) {
  const t = theme(m.theme?.id);
  const th = { ...t, ...pick(m.theme, ["name", "heading", "body"]), ...Object.fromEntries(["bg", "text", "accent", "accent2"].map((k) => [k, color(m.theme?.[k]) || t[k]])) };
  const media = {};
  for (const [id, x] of Object.entries(m.media || {})) if (x && (x.bytes || x.data)) media[id] = { ...x, id };
  return {
    version: SLIDES_VERSION,
    size: { w: clamp(num(m.size?.w, 960), 100, 10000), h: clamp(num(m.size?.h, 540), 100, 10000) },
    theme: th,
    meta: { title: String(m.meta?.title || "") },
    slides: fixOrder((Array.isArray(m.slides) && m.slides.length ? m.slides : [{ layout: "blank" }]).map(normSlide), "ord"),
    media,
    master: normMaster(m.master),
    layouts: normLayouts(m.layouts),
  };
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => typeof o?.[k] === "string" && o[k]).map((k) => [k, o[k]]));

// ---------------------------------------------------------------- creating

/** Placeholder boxes of a layout: the deck's edited version (deck.layouts) or the built-in one. */
export const layoutPh = (deck, layoutId) => deck?.layouts?.[layoutOf(layoutId).id] || layoutOf(layoutId).ph;

/** Placeholder elements of a layout for a slide size (`deck` supplies edited layouts). */
export function layoutElements(layoutId, size, text = {}, deck = null) {
  return layoutPh(deck, layoutId).map(([ph, fx, fy, fw, fh]) => normElement({ type: "text", ph, x: Math.round(fx * size.w), y: Math.round(fy * size.h), w: Math.round(fw * size.w), h: Math.round(fh * size.h), text: text[ph] || "" }));
}

export function makeSlide(deck, layout = "title-content", text = {}) {
  return normSlide({ layout, elements: layoutElements(layout, deck.size, text, deck) });
}

const TEMPLATE_SLIDES = {
  blank: () => [["title", { title: "", subtitle: "" }]],
  pitch: () => [
    ["title", { title: "Company name", subtitle: "One sentence that says what you do" }],
    ["title-content", { title: "The problem", body: "Who has it\nHow they solve it today\nWhy that is not good enough" }],
    ["title-content", { title: "Our solution", body: "What it is\nHow it works\nWhy now" }],
    ["two-content", { title: "Market", body: "Total market\nServiceable market\nFirst customers", body2: "Trends\nCompetitors\nOur edge" }],
    ["title-content", { title: "Business model", body: "Pricing\nSales channels\nUnit economics" }],
    ["title-content", { title: "Traction", body: "Customers and revenue\nGrowth per month\nMilestones" }],
    ["two-content", { title: "Team", body: "Founder: role and background\nFounder: role and background", body2: "Advisors\nKey hires" }],
    ["section", { title: "The ask", subtitle: "Amount, use of funds and next milestones" }],
  ],
  report: () => [
    ["title", { title: "Quarterly report", subtitle: "Team or department · Date" }],
    ["title-content", { title: "Summary", body: "Key result one\nKey result two\nKey result three" }],
    ["section", { title: "Results", subtitle: "What we achieved" }],
    ["title-content", { title: "Highlights", body: "Highlight\nHighlight\nHighlight" }],
    ["title-only", { title: "Numbers" }],
    ["title-content", { title: "Next steps", body: "Priority\nOwner and date\nRisks" }],
  ],
  lesson: () => [
    ["title", { title: "Lesson title", subtitle: "Course · Unit · Date" }],
    ["title-content", { title: "Learning goals", body: "By the end you can…\nYou will practice…\nYou will know why…" }],
    ["section", { title: "Warm-up", subtitle: "A question to start with" }],
    ["two-content", { title: "Key idea", body: "Definition\nExample", body2: "Common mistake\nHow to avoid it" }],
    ["title-content", { title: "Practice", body: "Task one\nTask two\nTask three" }],
    ["title-content", { title: "Summary", body: "What we learned\nHomework\nNext lesson" }],
  ],
  project: () => [
    ["title", { title: "Project update", subtitle: "Project name · Status date" }],
    ["title-content", { title: "Status at a glance", body: "Scope: on track\nSchedule: at risk\nBudget: on track" }],
    ["two-content", { title: "Done and next", body: "Done this period\nDone this period", body2: "Next period\nNext period" }],
    ["title-only", { title: "Numbers" }],
    ["title-content", { title: "Risks and decisions", body: "Risk, owner and mitigation\nDecision needed by date" }],
  ],
  roadmap: () => [
    ["title", { title: "Product roadmap", subtitle: "Where we are going and when" }],
    ["title-only", { title: "Timeline" }],
    ["two-content", { title: "Now and next", body: "Now: what ships this quarter\nNow: what we are fixing", body2: "Next: what we start after\nLater: ideas we are testing" }],
    ["title-content", { title: "What we will not do", body: "Out of scope\nWhy\nWhen we revisit it" }],
    ["section", { title: "Questions", subtitle: "Feedback and next review date" }],
  ],
  portfolio: () => [
    ["title", { title: "Your name", subtitle: "Designer · Portfolio 2026" }],
    ["two-content", { title: "About me", body: "What I do\nWho I work with", body2: "Tools\nAwards and clients" }],
    ["title-content", { title: "Project one", body: "The brief\nWhat I did\nThe result in one number" }],
    ["title-content", { title: "Project two", body: "The brief\nWhat I did\nThe result in one number" }],
    ["section", { title: "Let's work together", subtitle: "email@example.com · website" }],
  ],
};

/** The roadmap timeline: an accent line with four milestone dots and labels. */
function timeline(deck) {
  const t = deck.theme;
  const y = 270;
  const out = [normElement({ type: "shape", shape: "rect", x: 80, y: y - 3, w: 800, h: 6, fill: t.accent, strokeWidth: 0 })];
  ["Q1", "Q2", "Q3", "Q4"].forEach((q, i) => {
    const x = 120 + i * 220;
    out.push(normElement({ type: "shape", shape: "ellipse", x: x - 14, y: y - 14, w: 28, h: 28, fill: i % 2 ? t.accent2 : t.accent, strokeWidth: 0 }));
    out.push(normElement({ type: "text", x: x - 90, y: y + 24, w: 180, h: 90, text: `${q}\nMilestone`, style: { size: 16, align: "center" }, spans: [{ start: 0, end: 2, bold: true }] }));
  });
  return out;
}

/**
 * Designed templates: theme plus master graphics and footer. Master elements are plain elements in slide px for a
 * 960 px wide slide (scaled by the slide height where noted).
 */
export const DESIGNS = {
  pitch: { theme: "midnight", master: (W, H, t) => [{ type: "shape", shape: "rect", x: 0, y: 0, w: 14, h: H, fill: t.accent, strokeWidth: 0 }, { type: "shape", shape: "rect", x: W - 120, y: H - 6, w: 120, h: 6, fill: t.accent2, strokeWidth: 0 }], footer: { number: true } },
  report: { theme: "slate", master: (W, H, t) => [{ type: "shape", shape: "rect", x: 0, y: H - 8, w: W, h: 8, fill: t.accent2, strokeWidth: 0 }], footer: { number: true, text: "Quarterly report" } },
  lesson: { theme: "sunrise", master: (W, H, t) => [{ type: "shape", shape: "ellipse", x: W - 90, y: -60, w: 150, h: 150, fill: t.accent2, strokeWidth: 0 }, { type: "shape", shape: "ellipse", x: W - 150, y: -30, w: 90, h: 90, fill: t.accent, strokeWidth: 0 }], footer: { number: true } },
  project: { theme: "aurora", master: (W, H, t) => [{ type: "shape", shape: "rect", x: 0, y: 0, w: W, h: 6, fill: t.accent, strokeWidth: 0 }, { type: "shape", shape: "rect", x: 0, y: 6, w: Math.round(W / 3), h: 3, fill: t.accent2, strokeWidth: 0 }], footer: { number: true, text: "Project update" } },
  roadmap: { theme: "forest", master: (W, H, t) => [{ type: "shape", shape: "rect", x: 0, y: H - 40, w: W, h: 40, fill: t.accent, strokeWidth: 0 }], footer: { number: true } },
  portfolio: { theme: "paper", master: (W, H, t) => [{ type: "shape", shape: "rect", x: 24, y: 24, w: W - 48, h: H - 48, fill: null, stroke: t.accent, strokeWidth: 1.5 }], footer: { number: true, skipTitle: true } },
};
export const TEMPLATES = Object.keys(TEMPLATE_SLIDES);

/** Master graphics and footer of a design for a deck (keeps the deck's theme colors). */
export function designMaster(deck, designId) {
  const d = DESIGNS[designId];
  if (!d) return normMaster({ footer: deck.master?.footer });
  return normMaster({ elements: d.master(deck.size.w, deck.size.h, deck.theme), footer: { ...d.footer } });
}

/** Applies a design (theme, master graphics, footer) to a deck; slide content stays. */
export function applyDesign(deck, designId) {
  const d = DESIGNS[designId];
  if (!d) throw new Error(`Unknown design "${designId}". Designs: ${Object.keys(DESIGNS).join(", ")}.`);
  const themed = applyTheme(deck, d.theme);
  return { ...themed, master: designMaster(themed, designId) };
}

/** A new deck from a template id (TEMPLATES: "blank", "pitch", "report", "lesson", "project"). */
export function createDeck({ template = "blank", title = "", ratio = "16:9", themeId } = {}) {
  const size = SIZES[ratio] || SIZES["16:9"];
  const th = themeId || DESIGNS[template]?.theme || "office";
  let deck = normalizeDeck({ size, theme: { id: th }, meta: { title }, slides: [] });
  if (DESIGNS[template]) deck = { ...deck, master: designMaster(deck, template) };
  const list = (TEMPLATE_SLIDES[template] || TEMPLATE_SLIDES.blank)();
  let slides = list.map(([layout, text]) => makeSlide(deck, layout, text));
  if (template === "roadmap") {
    const i = slides.findIndex((s) => s.layout === "title-only");
    if (i >= 0) slides[i] = { ...slides[i], elements: fixOrder([...slides[i].elements, ...timeline(deck)], "z") };
  }
  if (template === "report" || template === "project") {
    const i = slides.findIndex((s) => s.layout === "title-only");
    if (i >= 0) {
      const extra = template === "report"
        ? normElement({ type: "table", x: 58, y: 150, w: 844, h: 220, rows: [["Metric", "Target", "Actual"], ["Revenue", "", ""], ["Customers", "", ""], ["Satisfaction", "", ""]], style: { size: 18 } })
        : normElement({ type: "chart", x: 58, y: 130, w: 844, h: 340, chart: { type: "column", title: "Planned vs. actual", data: { categories: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "Planned", values: [10, 20, 30, 40] }, { name: "Actual", values: [12, 18, 27, 0] }] } } });
      slides[i] = { ...slides[i], elements: fixOrder([...slides[i].elements, extra], "z") };
    }
  }
  slides = fixOrder(slides, "ord");
  return { ...deck, slides };
}

// ---------------------------------------------------------------- operations (all return a new deck)

export const slideIndex = (deck, id) => deck.slides.findIndex((s) => s.id === id);
export const isPseudo = (id) => typeof id === "string" && id.startsWith("@");
export const slideById = (deck, id) => (isPseudo(id) ? pseudoSlide(deck, id) : deck.slides.find((s) => s.id === id) || null);

const PSEUDO = { ord: "a0", background: null, notes: "", transition: { type: "none", duration: 0.5 } };
/** The master ("@master") or a layout ("@layout:<id>") as an editable slide; null for anything else. */
export function pseudoSlide(deck, id) {
  if (id === MASTER_ID) return { ...PSEUDO, id, layout: "blank", elements: deck.master?.elements || [] };
  const lid = id.slice(LAYOUT_PREFIX.length);
  if (!id.startsWith(LAYOUT_PREFIX) || !LAYOUTS.some((l) => l.id === lid)) return null;
  return { ...PSEUDO, id, layout: lid, elements: fixOrder(layoutElements(lid, deck.size, {}, deck).map((e) => ({ ...e, id: `ph-${e.ph}` })), "z") };
}

/** Writes an edited pseudo slide back: master elements, or a layout's boxes (re-applied to the slides using it). */
function writePseudo(deck, id, elements) {
  if (id === MASTER_ID) return { ...deck, master: normMaster({ ...deck.master, elements }) };
  const lid = id.slice(LAYOUT_PREFIX.length);
  const { w, h } = deck.size;
  const ph = elements.filter((e) => e.ph).map((e) => [e.ph, e.x / w, e.y / h, e.w / w, e.h / h]);
  let next = { ...deck, layouts: normLayouts({ ...deck.layouts, [lid]: ph }) };
  for (const s of next.slides) if (s.layout === lid) next = applyLayout(next, s.id, lid);
  return next;
}

/** Resets an edited layout to the built-in boxes (slides using it follow). */
export function resetLayout(deck, layoutId) {
  const { [layoutId]: _, ...rest } = deck.layouts || {};
  let next = { ...deck, layouts: rest };
  for (const s of next.slides) if (s.layout === layoutId) next = applyLayout(next, s.id, layoutId);
  return next;
}
const withSlides = (deck, slides) => ({ ...deck, slides: fixOrder(slides, "ord") });

export function insertSlide(deck, slide, index = deck.slides.length) {
  const slides = deck.slides.slice();
  slides.splice(clamp(index, 0, slides.length), 0, { ...normSlide(slide), ord: undefined });
  return withSlides(deck, slides);
}

export function addSlide(deck, { layout = "title-content", after = null, text = {} } = {}) {
  const s = makeSlide(deck, layout, text);
  const i = after ? slideIndex(deck, after) + 1 : deck.slides.length;
  return { deck: insertSlide(deck, s, i || deck.slides.length), id: s.id };
}

export function deleteSlides(deck, ids) {
  const set = new Set(ids);
  const slides = deck.slides.filter((s) => !set.has(s.id));
  return slides.length ? withSlides(deck, slides) : withSlides(deck, [makeSlide(deck, "blank")]);
}

export function duplicateSlide(deck, id) {
  const i = slideIndex(deck, id);
  if (i < 0) return { deck, id: null };
  const s = deck.slides[i];
  const copy = { ...s, id: newId("s"), ord: undefined, elements: s.elements.map((e) => ({ ...e, id: newId() })) };
  return { deck: insertSlide(deck, copy, i + 1), id: copy.id };
}

/** Moves slides (in their current order) so the first lands at `to` (index in the list without them). */
export function moveSlides(deck, ids, to) {
  const set = new Set(ids);
  const moving = deck.slides.filter((s) => set.has(s.id)).map((s) => ({ ...s, ord: undefined }));
  const rest = deck.slides.filter((s) => !set.has(s.id));
  rest.splice(clamp(to, 0, rest.length), 0, ...moving);
  return withSlides(deck, rest);
}

export function updateSlide(deck, id, patch) {
  if (isPseudo(id)) {
    const s = pseudoSlide(deck, id);
    if (!s) return deck;
    const p = typeof patch === "function" ? patch(s) : patch;
    return p.elements ? writePseudo(deck, id, fixOrder(p.elements.map(normElement), "z")) : deck;
  }
  return { ...deck, slides: deck.slides.map((s) => (s.id === id ? normSlide({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }) : s)) };
}

const mapElements = (deck, slideId, fn) => updateSlide(deck, slideId, (s) => ({ elements: fixOrder(fn(s.elements), "z") }));

export function addElement(deck, slideId, el) {
  const e = normElement({ ...el, z: undefined });
  return { deck: mapElements(deck, slideId, (els) => [...els, e]), id: e.id };
}

/** Patches elements; `patch` is an object (style is merged) or a function (element) → patch. */
export function updateElements(deck, slideId, ids, patch) {
  const set = new Set(ids);
  return mapElements(deck, slideId, (els) =>
    els.map((e) => {
      if (!set.has(e.id)) return e;
      const p = typeof patch === "function" ? patch(e) : patch;
      let spans = p.spans !== undefined ? p.spans : e.spans;
      // new text: formatting follows the characters; whole-box formatting replaces the same keys inside the box
      if (p.spans === undefined && typeof p.text === "string" && e.spans) spans = remapSpans(e.spans, e.text, p.text);
      if (p.spans === undefined && p.style && spans) spans = clearSpanKeys(spans, Object.keys(p.style));
      // list levels follow their paragraphs
      const levels = p.levels !== undefined ? p.levels : typeof p.text === "string" && e.levels ? remapLevels(e.levels, e.text, p.text) : e.levels;
      return normElement({ ...e, ...p, spans, levels, style: p.style ? { ...e.style, ...p.style } : e.style });
    }),
  );
}

export function deleteElements(deck, slideId, ids) {
  const set = new Set(ids);
  return mapElements(deck, slideId, (els) => els.filter((e) => !set.has(e.id)));
}

export function duplicateElements(deck, slideId, ids, offset = 16) {
  const s = slideById(deck, slideId);
  const copies = s.elements.filter((e) => ids.includes(e.id)).map((e) => ({ ...e, id: newId(), z: undefined, x: e.x + offset, y: e.y + offset }));
  return { deck: mapElements(deck, slideId, (els) => [...els, ...copies]), ids: copies.map((c) => c.id) };
}

/** z-order: "front" | "back" | "forward" | "backward". */
export function arrange(deck, slideId, ids, how) {
  const set = new Set(ids);
  return mapElements(deck, slideId, (els) => {
    let list = els.map((e) => (set.has(e.id) ? { ...e, z: undefined } : e));
    const sel = list.filter((e) => set.has(e.id));
    const rest = list.filter((e) => !set.has(e.id));
    if (how === "front") return [...rest, ...sel];
    if (how === "back") return [...sel, ...rest];
    list = list.slice();
    const step = how === "forward" ? 1 : -1;
    const order = step > 0 ? [...list.keys()].reverse() : [...list.keys()];
    for (const i of order) {
      const j = i + step;
      if (set.has(list[i].id) && j >= 0 && j < list.length && !set.has(list[j].id)) [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  });
}

/** Aligns elements to each other (2+) or to the slide (1): left, center, right, top, middle, bottom. */
export function align(deck, slideId, ids, how) {
  const s = slideById(deck, slideId);
  const els = s.elements.filter((e) => ids.includes(e.id));
  if (!els.length) return deck;
  const box = els.length === 1 ? { x: 0, y: 0, w: deck.size.w, h: deck.size.h } : bounds(els);
  return updateElements(deck, slideId, ids, (e) => {
    switch (how) {
      case "left": return { x: box.x };
      case "center": return { x: Math.round(box.x + (box.w - e.w) / 2) };
      case "right": return { x: box.x + box.w - e.w };
      case "top": return { y: box.y };
      case "middle": return { y: Math.round(box.y + (box.h - e.h) / 2) };
      case "bottom": return { y: box.y + box.h - e.h };
      default: return {};
    }
  });
}

export function bounds(els) {
  const x = Math.min(...els.map((e) => e.x));
  const y = Math.min(...els.map((e) => e.y));
  return { x, y, w: Math.max(...els.map((e) => e.x + e.w)) - x, h: Math.max(...els.map((e) => e.y + e.h)) - y };
}

/** Applies a layout: placeholders move to the new boxes (text kept by role), others stay where they are. */
export function applyLayout(deck, slideId, layoutId) {
  const lay = layoutOf(layoutId);
  const phOf = layoutPh(deck, lay.id);
  return updateSlide(deck, slideId, (s) => {
    const fresh = layoutElements(lay.id, deck.size, {}, deck);
    const used = new Set();
    const elements = [];
    for (const e of s.elements) {
      if (!e.ph) {
        elements.push(e);
        continue;
      }
      const role = e.ph === "subtitle" && !phOf.some((p) => p[0] === "subtitle") ? "body" : e.ph === "body" && !phOf.some((p) => p[0] === "body") ? "subtitle" : e.ph;
      const target = fresh.find((f) => f.ph === role && !used.has(f));
      if (target) {
        used.add(target);
        elements.push({ ...e, ph: role, x: target.x, y: target.y, w: target.w, h: target.h, style: { ...e.style, bullets: target.style.bullets } });
      } else if (e.text.trim()) elements.push({ ...e, ph: undefined }); // keep the text as a normal text box
    }
    for (const f of fresh) if (!used.has(f)) elements.unshift(f);
    return { layout: lay.id, elements };
  });
}

export function applyTheme(deck, themeId, overrides = {}) {
  const t = theme(themeId);
  return normalizeDeck({ ...deck, theme: { ...t, ...overrides, id: t.id } });
}

export function addMedia(deck, { bytes, mime, name = "", w = 0, h = 0 }) {
  const id = newId("m");
  return { deck: { ...deck, media: { ...deck.media, [id]: { id, mime, name, w, h, bytes } } }, id };
}

/** Drops media no slide uses (before saving or exporting). */
export function pruneMedia(deck) {
  const used = new Set();
  for (const s of deck.slides) {
    if (s.background?.media) used.add(s.background.media);
    for (const e of s.elements) if (e.media) used.add(e.media);
  }
  for (const e of deck.master?.elements || []) if (e.media) used.add(e.media);
  const media = Object.fromEntries(Object.entries(deck.media || {}).filter(([id]) => used.has(id)));
  return Object.keys(media).length === Object.keys(deck.media || {}).length ? deck : { ...deck, media };
}

// ---------------------------------------------------------------- master, footers and slide numbers

/** Sets footer options ({ text, date, number, skipTitle }; missing keys stay). */
export function setFooter(deck, patch) {
  return { ...deck, master: normMaster({ ...deck.master, footer: { ...deck.master?.footer, ...patch } }) };
}

/**
 * Elements the master adds to a slide when it is drawn: master graphics (unless slide.hideMaster) and the footer
 * boxes (date left, text center, slide number right). They carry `master: true` and ids starting with "@", are
 * not part of the slide and cannot be selected. Pseudo slides show only the footer (the master) or the master
 * (layouts) for context.
 */
export function masterElements(deck, slide, now = new Date()) {
  const m = deck.master || normMaster();
  const { w: W, h: H } = deck.size;
  const out = [];
  if (slide.id !== MASTER_ID && !slide.hideMaster) for (const e of m.elements) out.push({ ...e, id: `@m-${e.id}`, master: true });
  const f = m.footer;
  if (isPseudo(slide.id) && slide.id !== MASTER_ID) return out;
  if (f.skipTitle && slide.layout === "title" && slide.id !== MASTER_ID) return out;
  const n = slide.id === MASTER_ID ? "#" : String(slideIndex(deck, slide.id) + 1);
  const y = Math.round(H - H * 0.075), h = Math.round(H * 0.06);
  const box = (id, text, x, w, align, extra = {}) => out.push({ ...normElement({ type: "text", id, x: Math.round(x), y, w: Math.round(w), h, text, style: { size: 12, align, valign: "middle" } }), id, master: true, ...extra });
  if (f.autoDate) box("@f-date", footerDate(f, now), W * 0.04, W * 0.24, "left", { field: "date", dateFormat: f.dateFormat || "long" });
  else if (f.date) box("@f-date", f.date, W * 0.04, W * 0.24, "left");
  if (f.text) box("@f-text", f.text, W * 0.3, W * 0.4, "center");
  if (f.number) box("@f-num", n, W * 0.76, W * 0.2, "right", { field: "slidenum" });
  return out;
}

/** Everything drawn for a slide, back to front: master elements, then the slide's own elements. */
export const renderElements = (deck, slide, now) => [...masterElements(deck, slide, now), ...slide.elements];

/** The footer's automatic date as text, in the app's language ("short" 11/10/2026, "long" November 10, 2026, "full" with the weekday). */
export function footerDate(footer, now = new Date(), locale = localeTag()) {
  const style = { short: "short", long: "long", full: "full" }[footer?.dateFormat] || "long";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: style }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

// ---------------------------------------------------------------- mixed formatting (spans)

const fmtKey = (f) => SPAN_KEYS.map((k) => (f[k] === undefined ? "" : String(f[k]))).join("|");
const fontName = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
const ptSize = (v) => (Number.isFinite(+v) && v !== null && v !== "" && +v > 0 ? clamp(Math.round(+v * 2) / 2, 4, 400) : null);
/** A span format value of key k, or null when invalid. */
const fmtValue = (k, v) => (k === "color" ? color(v) : k === "font" ? fontName(v) : k === "size" ? ptSize(v) : typeof v === "boolean" ? v : null);
const cleanFmt = (f) => {
  const o = {};
  for (const k of SPAN_KEYS) {
    const v = fmtValue(k, f?.[k]);
    if (v !== null) o[k] = v;
  }
  return o;
};

/** Per-character formatting array of length n (later spans win where they overlap). */
function charFormats(spans, n) {
  const a = new Array(n).fill(null);
  for (const s of Array.isArray(spans) ? spans : []) {
    const f = cleanFmt(s);
    if (!Object.keys(f).length) continue;
    const from = clamp(Math.floor(num(s.start)), 0, n), to = clamp(Math.floor(num(s.end)), 0, n);
    for (let i = from; i < to; i++) a[i] = a[i] ? { ...a[i], ...f } : f;
  }
  return a;
}

/** Per-character formats → sorted, merged spans. */
function compressFormats(a) {
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const f = a[i];
    if (!f || !Object.keys(f).length) continue;
    const last = out[out.length - 1];
    if (last && last.end === i && fmtKey(last) === fmtKey(f)) last.end = i + 1;
    else out.push({ start: i, end: i + 1, ...f });
  }
  return out;
}

/** Valid, sorted, non-overlapping spans for a text of length n. */
export const normSpans = (spans, n) => (Array.isArray(spans) && spans.length ? compressFormats(charFormats(spans.slice(0, 2000), n)) : []);

/** Formatting at one character (span values only; the element style applies where a key is missing). */
export const spanFormatAt = (e, i) => charFormats(e.spans, (e.text || "").length)[i] || {};

/**
 * Sets (true/false/color) or clears (null) formatting keys on the characters [start, end) of a text box.
 * Returns the new spans.
 */
export function formatSpans(e, start, end, patch) {
  const n = (e.text || "").length;
  const a = charFormats(e.spans, n);
  const from = clamp(Math.floor(num(start)), 0, n), to = clamp(Math.floor(num(end)), 0, n);
  for (let i = from; i < to; i++) {
    const f = { ...(a[i] || {}) };
    for (const k of SPAN_KEYS) if (k in patch) {
      if (patch[k] === null || patch[k] === undefined) delete f[k];
      else f[k] = ["color", "font", "size"].includes(k) ? fmtValue(k, patch[k]) : !!patch[k];
      if (f[k] === null) delete f[k];
    }
    a[i] = f;
  }
  return compressFormats(a);
}

/** Formats a character range of a text element (one deck operation). */
export function formatText(deck, slideId, elementId, start, end, patch) {
  const s = slideById(deck, slideId);
  const e = s?.elements.find((x) => x.id === elementId);
  if (!e || typeof e.text !== "string") return deck;
  return updateElements(deck, slideId, [elementId], { spans: formatSpans(e, start, end, patch) });
}

// ---------------------------------------------------------------- list levels

/** Valid levels for a text: one 0..8 integer per paragraph, trailing zeros dropped ([] = all level 0). */
export function normLevels(levels, text) {
  if (!Array.isArray(levels) || !levels.length) return [];
  const n = String(text || "").split("\n").length;
  const out = Array.from({ length: Math.min(n, levels.length) }, (_, i) => clamp(Math.round(num(levels[i])), 0, MAX_LEVEL));
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** The list level of every paragraph of an element (0 when not set). */
export const paragraphLevels = (e) => String(e.text || "").split("\n").map((_, i) => e.levels?.[i] || 0);

/** Paragraph index of a character offset. */
const paraAt = (text, offset) => text.slice(0, Math.max(0, offset)).split("\n").length - 1;

/** Moves levels along with an edit from oldText to newText (new paragraphs take the level of the one they split from). */
export function remapLevels(levels, oldText, newText) {
  if (!levels?.length) return levels;
  // line diff: unchanged lines keep their level; changed or split lines take the level of the first changed line,
  // inserted lines the level of the line before them (Enter at the end of a line)
  const A = oldText.split("\n"), B = newText.split("\n");
  const old = paragraphLevels({ text: oldText, levels });
  let i = 0;
  while (i < A.length && i < B.length && A[i] === B[i]) i++;
  let j = 0;
  while (j < A.length - i && j < B.length - i && A[A.length - 1 - j] === B[B.length - 1 - j]) j++;
  const changed = A.length - i - j;
  const fill = changed > 0 ? old[i] : old[Math.max(0, i - 1)];
  const mid = Array.from({ length: B.length - i - j }, () => fill);
  return normLevels([...old.slice(0, i), ...mid, ...old.slice(A.length - j)], newText);
}

/**
 * Changes the list level of the paragraphs touched by characters [start, end] of a text element: `delta` +1 / -1, or
 * `level` sets it. One deck operation.
 */
export function setLevels(deck, slideId, elementId, start, end, { delta = 0, level = null } = {}) {
  const s = slideById(deck, slideId);
  const e = s?.elements.find((x) => x.id === elementId);
  if (!e || typeof e.text !== "string") return deck;
  const lv = paragraphLevels(e);
  const a = paraAt(e.text, start), b = paraAt(e.text, Math.max(start, end));
  for (let i = a; i <= b && i < lv.length; i++) lv[i] = clamp(level === null ? lv[i] + delta : level, 0, MAX_LEVEL);
  return updateElements(deck, slideId, [elementId], { levels: lv });
}

/** Text with leading tabs per line → { text without them, levels } (Vibe and pasted outlines). */
export function textWithLevels(raw) {
  const lines = String(raw ?? "").split("\n");
  const levels = lines.map((l) => Math.min(MAX_LEVEL, /^\t*/.exec(l)[0].length));
  return { text: lines.map((l) => l.replace(/^\t+/, "")).join("\n"), levels: levels.some(Boolean) ? levels : [] };
}

/** Moves spans along with an edit from oldText to newText (typed characters take the format before them). */
export function remapSpans(spans, oldText, newText) {
  const a = charFormats(spans, oldText.length);
  let p = 0;
  while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) p++;
  let q = 0;
  while (q < oldText.length - p && q < newText.length - p && oldText[oldText.length - 1 - q] === newText[newText.length - 1 - q]) q++;
  const inserted = newText.length - p - q;
  const fill = p > 0 && newText[p] !== "\n" ? a[p - 1] : null;
  return compressFormats([...a.slice(0, p), ...new Array(inserted).fill(fill), ...a.slice(oldText.length - q)]);
}

/** Drops keys from every span (the whole box got that formatting). */
export function clearSpanKeys(spans, keys) {
  const drop = keys.filter((k) => SPAN_KEYS.includes(k));
  if (!drop.length || !spans?.length) return spans;
  return spans.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !drop.includes(k)))).filter((s) => SPAN_KEYS.some((k) => k in s));
}

/** Pieces of text[from, to) with their span formatting: [{ start, end, text, fmt }]. */
export function spanSegments(text, spans, from = 0, to = text.length) {
  if (!spans?.length) return to > from ? [{ start: from, end: to, text: text.slice(from, to), fmt: {} }] : [];
  const out = [];
  let i = from;
  for (const s of spans) {
    if (s.end <= from || s.start >= to) continue;
    const a = Math.max(s.start, from), b = Math.min(s.end, to);
    if (a > i) out.push({ start: i, end: a, text: text.slice(i, a), fmt: {} });
    const { start, end, ...fmt } = s;
    out.push({ start: a, end: b, text: text.slice(a, b), fmt });
    i = b;
  }
  if (i < to) out.push({ start: i, end: to, text: text.slice(i, to), fmt: {} });
  return out;
}

// ---------------------------------------------------------------- charts

/** Chart definition as drawn on a slide: theme fonts, text color and accent colors first in the palette. */
export function slideChart(deck, e) {
  const t = deck.theme;
  const dark = luma(t.bg) < 0.45;
  return { ...e.chart, options: { ...e.chart.options, fontFamily: t.body, textColor: t.text, theme: dark ? "dark" : "light", palette: e.chart.options.palette === "default" ? [t.accent, t.accent2, "#64748b", "#10b981", "#ef4444", "#8b5cf6"] : e.chart.options.palette, background: null } };
}
const luma = (hex) => {
  const v = parseInt(String(hex || "#ffffff").slice(1), 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
};

/** Replaces a chart element's data snapshot (refresh from its spreadsheet). */
export function setChartData(deck, slideId, elementId, chart) {
  return updateElements(deck, slideId, [elementId], (e) => ({ chart: { ...e.chart, ...chart, options: { ...e.chart.options, ...(chart.options || {}) } } }));
}

/** Chart data as table rows (header row: "", series names; one row per category) for PowerPoint/OpenDocument. */
export function chartRows(chart) {
  const fmt = (v) => (v == null ? "" : String(Math.round(v * 1e6) / 1e6));
  return [["", ...chart.data.series.map((s) => s.name)], ...chart.data.categories.map((c, i) => [c, ...chart.data.series.map((s) => fmt(s.values[i]))])];
}

/** Chart types the PowerPoint and OpenDocument writers keep as real charts (the others become tables of their data). */
export const NATIVE_CHARTS = ["column", "stacked-column", "percent-column", "bar", "stacked-bar", "line", "area", "stacked-area", "scatter", "pie", "donut", "radar"];

/**
 * The deck as the PowerPoint and OpenDocument writers see it: master graphics and footers become elements of each
 * slide (footer boxes keep their `field`), charts stay charts with the theme's look (`slideChart`) unless their type
 * has no native equivalent (big number, progress, sparkline), which become tables of their data. Pure; the editor
 * keeps the deck.
 */
export function exportDeck(deck, now = new Date()) {
  const slides = deck.slides.map((s) => ({
    ...s,
    elements: renderElements(deck, s, now).map((e) => {
      const { master, ...rest } = e;
      const out = master ? { ...rest, id: rest.id.replace(/^@/, "x") } : rest;
      if (out.type === "chart" && NATIVE_CHARTS.includes(out.chart.type)) return { ...out, chart: slideChart(deck, out) };
      if (out.type === "chart") {
        const { chart, source, ...base } = out;
        return { ...base, type: "table", rows: chartRows(chart), header: true, style: normStyle({ size: 14 }), fill: null, stroke: "#9ca3af" };
      }
      return out;
    }),
  }));
  return { ...deck, slides };
}

// ---------------------------------------------------------------- geometry (shared by the DOM, PDF and PNG renderers)

const K = 0.5523;
/** Outline of a shape in a w×h box as display-list path commands ([["M", x, y], ["L" …], ["C" …], ["Z"]]). */
export function shapePath(shape, w, h) {
  switch (shape) {
    case "ellipse": {
      const rx = w / 2, ry = h / 2;
      return [["M", w, ry], ["C", w, ry + ry * K, rx + rx * K, h, rx, h], ["C", rx - rx * K, h, 0, ry + ry * K, 0, ry], ["C", 0, ry - ry * K, rx - rx * K, 0, rx, 0], ["C", rx + rx * K, 0, w, ry - ry * K, w, ry], ["Z"]];
    }
    case "roundRect": {
      const r = Math.min(w, h) * 0.16667, c = r * (1 - K);
      return [["M", r, 0], ["L", w - r, 0], ["C", w - c, 0, w, c, w, r], ["L", w, h - r], ["C", w, h - c, w - c, h, w - r, h], ["L", r, h], ["C", c, h, 0, h - c, 0, h - r], ["L", 0, r], ["C", 0, c, c, 0, r, 0], ["Z"]];
    }
    case "triangle":
      return [["M", w / 2, 0], ["L", w, h], ["L", 0, h], ["Z"]];
    case "diamond":
      return [["M", w / 2, 0], ["L", w, h / 2], ["L", w / 2, h], ["L", 0, h / 2], ["Z"]];
    case "arrow": {
      const head = Math.min(w * 0.5, h);
      return [["M", 0, h * 0.25], ["L", w - head, h * 0.25], ["L", w - head, 0], ["L", w, h / 2], ["L", w - head, h], ["L", w - head, h * 0.75], ["L", 0, h * 0.75], ["Z"]];
    }
    case "line":
      return [["M", 0, 0], ["L", w, h]];
    default:
      return [["M", 0, 0], ["L", w, 0], ["L", w, h], ["L", 0, h], ["Z"]];
  }
}
export const pathToSvg = (d) => d.map(([c, ...a]) => c + a.map((v) => Math.round(v * 100) / 100).join(" ")).join("");

/** Effective text style: theme fonts and colors fill the gaps. */
export function textLook(deck, e) {
  const st = e.style || {};
  return { ...st, font: st.font || (e.ph === "title" ? deck.theme.heading : deck.theme.body), color: st.color || deck.theme.text };
}

// ---------------------------------------------------------------- reading

export const slideTitle = (s) => (s.elements.find((e) => e.ph === "title")?.text || s.elements.find((e) => e.text?.trim())?.text || "").split("\n")[0].trim();

/** Plain text of every text-bearing element (find/replace, search, Vibe). */
export function textItems(deck) {
  const out = [];
  for (const s of deck.slides) {
    for (const e of s.elements) {
      if (typeof e.text === "string" && e.text) out.push({ id: `${s.id}/${e.id}`, text: e.text });
      if (e.rows) e.rows.forEach((r, ri) => r.forEach((c, ci) => c && out.push({ id: `${s.id}/${e.id}/${ri}/${ci}`, text: c })));
    }
    if (s.notes) out.push({ id: `${s.id}/notes`, text: s.notes });
  }
  return out;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Model-only summary for Vibe (office_describe, slides_describe) and the system prompt. */
export function describeDeck(deck, { full = false, limit = 60 } = {}) {
  return {
    kind: "slides",
    title: deck.meta?.title || "",
    size: `${deck.size.w}x${deck.size.h}`,
    theme: deck.theme.id,
    footer: deck.master.footer,
    masterElements: deck.master.elements.length,
    ...(Object.keys(deck.layouts || {}).length ? { editedLayouts: Object.keys(deck.layouts) } : {}),
    slideCount: deck.slides.length,
    slides: deck.slides.slice(0, limit).map((s, i) => ({
      index: i + 1,
      id: s.id,
      layout: s.layout,
      title: slideTitle(s),
      ...(s.hidden ? { hidden: true } : {}),
      ...(s.transition.type !== "none" ? { transition: s.transition.type } : {}),
      ...(full
        ? {
            elements: s.elements.map((e) => ({ id: e.id, type: e.type, ...(e.ph ? { placeholder: e.ph } : {}), ...(e.shape ? { shape: e.shape } : {}), box: [Math.round(e.x), Math.round(e.y), Math.round(e.w), Math.round(e.h)], ...(e.rot ? { rot: e.rot } : {}), ...(e.text ? { text: clip(e.text, 200) } : {}), ...(e.rows ? { rows: e.rows.length, cols: e.rows[0].length } : {}), ...(e.spans ? { spans: e.spans.map((x) => ({ ...x, text: clip(e.text.slice(x.start, x.end), 40) })) } : {}), ...(e.levels ? { levels: e.levels } : {}), ...(e.chart ? { chart: { type: e.chart.type, title: e.chart.title, categories: e.chart.data.categories.length, series: e.chart.data.series.map((x) => x.name) }, ...(e.source ? { source: e.source } : {}) } : {}) })),
            notes: clip(s.notes, 300),
          }
        : { elements: s.elements.length, ...(s.notes ? { notes: clip(s.notes, 80) } : {}) }),
    })),
  };
}

// ---------------------------------------------------------------- collaboration records

const B64 = typeof Buffer !== "undefined" ? { enc: (b) => Buffer.from(b).toString("base64"), dec: (s) => new Uint8Array(Buffer.from(s, "base64")) } : { enc: (b) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join("")), dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };
export const MEDIA_RECORD_MAX = 45 * 1024; // bytes; larger images stay local (collaborators see a placeholder)

/** Flattens a deck into records: meta:deck, slide:<id>, obj:<slide>/<element>, media:<id>. */
export function deckRecords(deck) {
  const r = { "meta:deck": { size: deck.size, theme: deck.theme, title: deck.meta?.title || "", master: deck.master, layouts: deck.layouts } };
  for (const s of deck.slides) {
    const { elements, id, ...rest } = s;
    r[`slide:${id}`] = rest;
    for (const e of elements) r[`obj:${id}/${e.id}`] = e;
  }
  for (const [id, m] of Object.entries(deck.media || {})) r[`media:${id}`] = { mime: m.mime, name: m.name || "", w: m.w || 0, h: m.h || 0, ...(m.bytes && m.bytes.length <= MEDIA_RECORD_MAX ? { data: B64.enc(m.bytes) } : {}) };
  return r;
}

/** Applies record changes ({ key: value | null }) and returns the new deck. */
export function applyDeckRecords(deck, changes) {
  const recs = deckRecords(deck);
  const media = { ...deck.media };
  for (const [k, v] of Object.entries(changes)) {
    if (k.startsWith("media:")) {
      const id = k.slice(6);
      if (v === null) delete media[id];
      else if (v.data) media[id] = { id, mime: v.mime, name: v.name, w: v.w, h: v.h, bytes: B64.dec(v.data) };
      else if (!media[id]) media[id] = { id, mime: v.mime, name: v.name, w: v.w, h: v.h, bytes: null };
      continue;
    }
    if (v === null) delete recs[k];
    else recs[k] = v;
  }
  const meta = recs["meta:deck"] || {};
  const slides = [];
  const byId = new Map();
  for (const [k, v] of Object.entries(recs)) if (k.startsWith("slide:")) {
    const s = { ...v, id: k.slice(6), elements: [] };
    byId.set(s.id, s);
    slides.push(s);
  }
  for (const [k, v] of Object.entries(recs)) if (k.startsWith("obj:")) {
    const [sid, eid] = k.slice(4).split("/");
    byId.get(sid)?.elements.push({ ...v, id: eid });
  }
  const cmp = (f) => (a, b) => (String(a[f]) < String(b[f]) ? -1 : String(a[f]) > String(b[f]) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  slides.sort(cmp("ord"));
  for (const s of slides) s.elements.sort(cmp("z"));
  const out = normalizeDeck({ size: meta.size, theme: meta.theme, meta: { title: meta.title }, master: meta.master, layouts: meta.layouts, slides, media: {} });

  out.media = Object.fromEntries(Object.entries(media).filter(([, m]) => m));
  return out;
}
