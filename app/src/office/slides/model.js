// Presentation app model (Office Suite kind "slides"): plain JSON, immutable values, pure operations. No DOM; unit
// tested in tests/office/slides.test.js. User guide and format notes: docs/office-slides.md.
//
//   Deck    = { version: 1, size: { w, h } (px, 96 per inch), theme: Theme, meta: { title }, slides: Slide[],
//               media: { <id>: { id, mime, name, w, h, bytes } } }
//   Slide   = { id, ord (fractional key), layout, background: null | { color } | { media }, elements: Element[],
//               notes: string, transition: { type: "none"|"fade"|"slide", duration: s }, hidden?: true }
//   Element = { id, z (fractional key), type: "text"|"shape"|"image"|"table", x, y, w, h, rot (degrees), ph?,
//               text?: string ("\n" separates paragraphs), style?: TextStyle,
//               shape?: "rect"|"roundRect"|"ellipse"|"triangle"|"diamond"|"arrow"|"line", fill?, stroke?, strokeWidth?,
//               media? (image), rows?: string[][] (table), flipH?, flipV? }
//   TextStyle = { font?, size (pt), color?, bold?, italic?, underline?, align: "left"|"center"|"right"|"justify",
//               valign: "top"|"middle"|"bottom", bullets? }
// Element order in `elements` is the z-order (back to front); `z` and `ord` mirror the array order as fractional keys
// so concurrent moves in "Edit together" merge (collab/fractional.js). Colors are "#rrggbb" or null; a null text color
// or font means "from the theme".
import { keyBetween, isKey } from "../../collab/fractional.js";

export const SLIDES_VERSION = 1;
export const SIZES = { "16:9": { w: 960, h: 540 }, "4:3": { w: 960, h: 720 }, "16:10": { w: 960, h: 600 } };
export const PT = 4 / 3; // px per point

export const THEMES = [
  { id: "office", name: "Clean", bg: "#ffffff", text: "#1f2937", accent: "#2563eb", accent2: "#f59e0b", heading: "Calibri", body: "Calibri" },
  { id: "midnight", name: "Midnight", bg: "#0f172a", text: "#e2e8f0", accent: "#38bdf8", accent2: "#f472b6", heading: "Segoe UI", body: "Segoe UI" },
  { id: "paper", name: "Paper", bg: "#fbf7ef", text: "#3b3226", accent: "#b45309", accent2: "#15803d", heading: "Georgia", body: "Georgia" },
  { id: "ocean", name: "Ocean", bg: "#ecfeff", text: "#083344", accent: "#0e7490", accent2: "#f97316", heading: "Verdana", body: "Verdana" },
  { id: "bold", name: "Bold", bg: "#111111", text: "#fafafa", accent: "#facc15", accent2: "#ef4444", heading: "Arial", body: "Arial" },
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
  const type = ["text", "shape", "image", "table"].includes(e?.type) ? e.type : "text";
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
  };
}

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
  };
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => typeof o?.[k] === "string" && o[k]).map((k) => [k, o[k]]));

// ---------------------------------------------------------------- creating

/** Placeholder elements of a layout for a slide size. */
export function layoutElements(layoutId, size, text = {}) {
  return layoutOf(layoutId).ph.map(([ph, fx, fy, fw, fh]) => normElement({ type: "text", ph, x: Math.round(fx * size.w), y: Math.round(fy * size.h), w: Math.round(fw * size.w), h: Math.round(fh * size.h), text: text[ph] || "" }));
}

export function makeSlide(deck, layout = "title-content", text = {}) {
  return normSlide({ layout, elements: layoutElements(layout, deck.size, text) });
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
};

/** A new deck from a template id ("blank", "pitch", "report"). */
export function createDeck({ template = "blank", title = "", ratio = "16:9", themeId } = {}) {
  const size = SIZES[ratio] || SIZES["16:9"];
  const th = themeId || (template === "pitch" ? "midnight" : template === "report" ? "office" : "office");
  const deck = normalizeDeck({ size, theme: { id: th }, meta: { title }, slides: [] });
  const list = (TEMPLATE_SLIDES[template] || TEMPLATE_SLIDES.blank)();
  let slides = list.map(([layout, text]) => makeSlide(deck, layout, text));
  if (template === "report") {
    const i = slides.findIndex((s) => s.layout === "title-only");
    if (i >= 0) {
      const tbl = normElement({ type: "table", x: 58, y: 150, w: 844, h: 220, rows: [["Metric", "Target", "Actual"], ["Revenue", "", ""], ["Customers", "", ""], ["Satisfaction", "", ""]], style: { size: 18 } });
      slides[i] = { ...slides[i], elements: fixOrder([...slides[i].elements, tbl], "z") };
    }
  }
  slides = fixOrder(slides, "ord");
  return { ...deck, slides };
}

// ---------------------------------------------------------------- operations (all return a new deck)

export const slideIndex = (deck, id) => deck.slides.findIndex((s) => s.id === id);
export const slideById = (deck, id) => deck.slides.find((s) => s.id === id) || null;
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
      return normElement({ ...e, ...p, style: p.style ? { ...e.style, ...p.style } : e.style });
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
  return updateSlide(deck, slideId, (s) => {
    const fresh = layoutElements(lay.id, deck.size);
    const used = new Set();
    const elements = [];
    for (const e of s.elements) {
      if (!e.ph) {
        elements.push(e);
        continue;
      }
      const role = e.ph === "subtitle" && !lay.ph.some((p) => p[0] === "subtitle") ? "body" : e.ph === "body" && !lay.ph.some((p) => p[0] === "body") ? "subtitle" : e.ph;
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
  const media = Object.fromEntries(Object.entries(deck.media || {}).filter(([id]) => used.has(id)));
  return Object.keys(media).length === Object.keys(deck.media || {}).length ? deck : { ...deck, media };
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
            elements: s.elements.map((e) => ({ id: e.id, type: e.type, ...(e.ph ? { placeholder: e.ph } : {}), ...(e.shape ? { shape: e.shape } : {}), box: [Math.round(e.x), Math.round(e.y), Math.round(e.w), Math.round(e.h)], ...(e.rot ? { rot: e.rot } : {}), ...(e.text ? { text: clip(e.text, 200) } : {}), ...(e.rows ? { rows: e.rows.length, cols: e.rows[0].length } : {}) })),
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
  const r = { "meta:deck": { size: deck.size, theme: deck.theme, title: deck.meta?.title || "" } };
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
  const out = normalizeDeck({ size: meta.size, theme: meta.theme, meta: { title: meta.title }, slides, media: {} });
  out.media = Object.fromEntries(Object.entries(media).filter(([, m]) => m));
  return out;
}
