// Whiteboard file formats: Excalidraw (.excalidraw, JSON "type": "excalidraw", version 2) and tldraw (.tldraw, JSON
// "tldrawFileFormatVersion": 1 with a store snapshot). Clean-room readers and writers of the public JSON shapes;
// pure (no DOM), unit-tested in tests/office/board.test.js (round trips and hostile input).
//
// Public API
//   readExcalidraw(json, report?) → model          writeExcalidraw(model) → { json, notes }
//   readTldraw(json, report?) → model              writeTldraw(model) → { json, notes }
//   parseJson(bytes, limit?) → object               throws a readable error for non-JSON or oversized files
// `report` is a core/import-report.js ImportReport (kept / simplified / dropped); notes are the lossy parts of a write.
import { makeElement, normalizeBoard, addElements, emptyModel, newId, isId, LINEAR, INK, SHAPES, STICKY_COLORS, sortedPages, pageElements, unionBounds, toBase64, fromBase64, center, rotate } from "./model.js";
import { initialKey } from "../../collab/fractional.js";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ELEMENTS = 50000;

export function parseJson(bytes, limit = MAX_BYTES) {
  if (bytes.length > limit) throw new Error("The drawing is too large to open (more than 64 MB).");
  let text = new TextDecoder().decode(bytes).replace(/^﻿/, "");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON, so it is not a drawing this app can read.");
  } finally {
    text = null;
  }
}

const noop = { kept() {}, simplified() {}, dropped() {} };
const rep = (r) => ({ kept: (w, n) => r?.kept?.(w, n), simplified: (w, n) => r?.simplified?.(w, n), dropped: (w, n) => r?.dropped?.(w, n) });
const fin = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const color = (c, d = null) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c) ? c : c === "transparent" ? null : d);
const safeId = (id) => (isId(String(id || "")) ? String(id) : String(id || "").replace(/[^\w-]/g, "").slice(0, 60) || newId());

function dataUrlBytes(url) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(url || ""));
  if (!m) return null;
  try {
    return { mime: m[1], bytes: fromBase64(m[2].replace(/\s+/g, "")) };
  } catch {
    return null;
  }
}
const dataUrl = (md) => `data:${md.mime};base64,${toBase64(md.bytes)}`;

// ================================================================================================ Excalidraw

const EX_FONT_IN = { 1: "hand", 2: "sans", 3: "mono", 4: "hand", 5: "hand", 6: "sans", 7: "sans", 8: "mono", 9: "sans" };
const EX_FONT_OUT = { hand: 1, sans: 2, serif: 2, mono: 3 };
const EX_HEAD_IN = (h) => (!h ? "none" : /triangle/.test(h) ? "triangle" : /dot|circle|diamond/.test(h) ? "dot" : h === "bar" ? "bar" : "arrow");
const EX_HEAD_OUT = { none: null, arrow: "arrow", triangle: "triangle", dot: "dot", bar: "bar" };

/** Reads an Excalidraw scene into a board model (one page). */
export function readExcalidraw(json, report) {
  const r = rep(report || noop);
  if (!json || typeof json !== "object" || !Array.isArray(json.elements)) throw new Error("This is not an Excalidraw drawing (no elements list).");
  const list = json.elements.filter((e) => e && typeof e === "object" && !e.isDeleted).slice(0, MAX_ELEMENTS);
  const files = json.files && typeof json.files === "object" ? json.files : {};
  const model = emptyModel({ title: "" });
  model.background = color(json.appState?.viewBackgroundColor, "#ffffff") || "#ffffff";
  const media = {};
  const out = [];
  const labels = new Map(); // container id → text element
  const count = {};
  const inc = (k) => (count[k] = (count[k] || 0) + 1);
  for (const t of list) if (t.type === "text" && t.containerId) labels.set(String(t.containerId), t);
  list.forEach((e, i) => {
    const id = safeId(e.id);
    const base = {
      id,
      page: "p1",
      x: fin(e.x),
      y: fin(e.y),
      w: Math.abs(fin(e.width)),
      h: Math.abs(fin(e.height)),
      angle: fin(e.angle),
      z: initialKey(i, list.length),
      stroke: color(e.strokeColor, "#1e1e1e") || "#1e1e1e",
      fill: color(e.backgroundColor),
      fillStyle: e.fillStyle === "solid" ? "solid" : e.fillStyle === "cross-hatch" ? "cross" : "hachure",
      width: Math.max(0.5, fin(e.strokeWidth, 2)),
      dash: e.strokeStyle === "dashed" ? "dashed" : e.strokeStyle === "dotted" ? "dotted" : "solid",
      rough: Math.max(0, Math.min(2, fin(e.roughness, 1))),
      opacity: Math.max(0, Math.min(1, fin(e.opacity, 100) / 100)),
      seed: fin(e.seed, 1) | 0,
      ...(Array.isArray(e.groupIds) && e.groupIds.length ? { group: safeId(e.groupIds[e.groupIds.length - 1]) } : {}),
      ...(e.frameId ? { frame: safeId(e.frameId) } : {}),
      ...(e.locked ? { locked: true } : {}),
      ...(typeof e.link === "string" && e.link ? { link: e.link.slice(0, 2000) } : {}),
    };
    if (Array.isArray(e.groupIds) && e.groupIds.length > 1) inc("nested");
    if (e.fillStyle === "zigzag" || e.fillStyle === "dots") inc("fill");
    const label = labels.get(String(e.id));
    const labelProps = label ? { text: String(label.text ?? label.originalText ?? ""), fontSize: fin(label.fontSize, 20), font: EX_FONT_IN[label.fontFamily] || "hand", align: label.textAlign || "center" } : {};
    switch (e.type) {
      case "rectangle":
      case "ellipse":
      case "diamond": {
        const type = e.type === "rectangle" ? "rect" : e.type;
        out.push(makeElement(type, { ...base, ...labelProps, ...(type === "rect" && e.roundness ? { round: true } : {}) }));
        inc("shape");
        break;
      }
      case "line":
      case "arrow": {
        const pts = (Array.isArray(e.points) ? e.points : []).filter((p) => Array.isArray(p)).map((p) => [fin(p[0]), fin(p[1])]);
        if (pts.length < 2) return inc("empty");
        const el = makeElement(e.type, { ...base, ...labelProps, points: pts, heads: { start: EX_HEAD_IN(e.startArrowhead), end: e.type === "arrow" ? EX_HEAD_IN(e.endArrowhead === undefined ? "arrow" : e.endArrowhead) : EX_HEAD_IN(e.endArrowhead) }, start: e.startBinding?.elementId ? { id: safeId(e.startBinding.elementId) } : null, end: e.endBinding?.elementId ? { id: safeId(e.endBinding.elementId) } : null, ...(e.roundness && pts.length > 2 ? { curve: true } : {}) });
        out.push(el);
        if (e.elbowed) inc("elbow");
        inc("connector");
        break;
      }
      case "freedraw": {
        const pts = (Array.isArray(e.points) ? e.points : []).map((p, k) => [fin(p?.[0]), fin(p?.[1]), e.simulatePressure === false && Array.isArray(e.pressures) ? Math.max(0, Math.min(1, fin(e.pressures[k], 0.5))) : 0.5]);
        if (!pts.length) return inc("empty");
        out.push(makeElement("pen", { ...base, rough: 0, width: Math.max(1, base.width * 1.6), points: pts }));
        inc("ink");
        break;
      }
      case "text": {
        if (e.containerId && list.some((c) => String(c.id) === String(e.containerId) && c.type !== "text" && !c.isDeleted)) return; // became a label
        out.push(makeElement("text", { ...base, fill: null, text: String(e.text ?? e.originalText ?? ""), fontSize: fin(e.fontSize, 20), font: EX_FONT_IN[e.fontFamily] || "hand", align: ["left", "center", "right"].includes(e.textAlign) ? e.textAlign : "left" }));
        inc("text");
        break;
      }
      case "image": {
        const f = files[e.fileId];
        const data = f && dataUrlBytes(f.dataURL);
        const mid = data ? safeId(e.fileId) : null;
        if (data && !media[mid]) media[mid] = { id: mid, mime: f.mimeType || data.mime, name: "", bytes: data.bytes };
        if (!data) inc("missingImage");
        out.push(makeElement("image", { ...base, media: mid }));
        break;
      }
      case "frame":
      case "magicframe":
        out.push(makeElement("frame", { ...base, name: String(e.name || "Frame"), fill: null }));
        break;
      default:
        inc(`drop:${e.type}`);
    }
  });
  const m = normalizeBoard(addElements({ ...model, media }, out));
  if (count.shape) r.kept("Shapes", count.shape);
  if (count.connector) r.kept("Lines, arrows and their bindings", count.connector);
  if (count.text) r.kept("Text", count.text);
  if (count.ink) r.kept("Freehand drawings", count.ink);
  if (count.nested) r.simplified("Nested groups became single groups", count.nested);
  if (count.fill) r.simplified("Zigzag and dot fills became hatching", count.fill);
  if (count.elbow) r.simplified("Elbow arrows became straight segments", count.elbow);
  if (count.missingImage) r.dropped("Images without embedded data (shown as placeholders)", count.missingImage);
  for (const [k, n] of Object.entries(count)) if (k.startsWith("drop:")) r.dropped(`Unsupported elements (${k.slice(5)})`, n);
  return m;
}

/** Writes an Excalidraw scene. Every page becomes a frame; pages sit side by side. */
export function writeExcalidraw(model) {
  const notes = new Set();
  const elements = [];
  const files = {};
  const pages = sortedPages(model);
  let offset = 0;
  const now = Date.now();
  const common = (e, dx, extra = {}) => ({
    id: e.id,
    type: "rectangle",
    x: e.x + dx,
    y: e.y,
    width: e.w,
    height: e.h,
    angle: e.angle || 0,
    strokeColor: e.stroke || "#1e1e1e",
    backgroundColor: e.fill || "transparent",
    fillStyle: e.fillStyle === "cross" ? "cross-hatch" : e.fillStyle === "hachure" ? "hachure" : "solid",
    strokeWidth: e.width ?? 2,
    strokeStyle: e.dash || "solid",
    roughness: e.rough ?? 1,
    opacity: Math.round((e.opacity ?? 1) * 100),
    groupIds: e.group ? [e.group] : [],
    frameId: e.frame || null,
    roundness: null,
    seed: e.seed || 1,
    version: 1,
    versionNonce: (e.seed * 31) | 0,
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: e.link || null,
    locked: !!e.locked,
    ...extra,
  });
  const textEl = (id, e, dx, text, container, extra = {}) => ({
    ...common({ ...e, id, fill: null, rough: 0, group: e.group, angle: e.angle }, dx),
    type: "text",
    text,
    originalText: text,
    fontSize: e.fontSize || 20,
    fontFamily: EX_FONT_OUT[e.font] || 1,
    textAlign: e.align || "center",
    verticalAlign: container ? "middle" : "top",
    containerId: container,
    lineHeight: 1.25,
    autoResize: true,
    strokeColor: e.type === "sticky" ? "#1e1e1e" : e.stroke || "#1e1e1e",
    ...extra,
  });
  for (const p of pages) {
    const els = pageElements(model, p.id);
    const box = unionBounds(els) || { x: 0, y: 0, w: 800, h: 600 };
    const dx = pages.length > 1 ? offset - box.x + 40 : 0;
    const fid = pages.length > 1 ? `page-${p.id}` : null;
    if (fid) {
      elements.push({ ...common({ id: fid, x: box.x - 40, y: box.y - 40, w: box.w + 80, h: box.h + 80, stroke: "#bbb", width: 1, rough: 0 }, dx), type: "frame", name: p.name });
      offset += box.w + 200;
      notes.add("Pages became frames side by side (Excalidraw has one canvas).");
    }
    for (const e of els) {
      const frameId = e.frame || fid;
      const base = common(e, dx, { frameId });
      const bound = [];
      const labelId = `${e.id}-label`;
      if (SHAPES.includes(e.type)) {
        elements.push({ ...base, type: e.type === "rect" ? "rectangle" : e.type, roundness: e.round ? { type: 3 } : null, boundElements: bound });
      } else if (e.type === "sticky") {
        elements.push({ ...base, type: "rectangle", strokeColor: "transparent", fillStyle: "solid", boundElements: bound, roughness: 0 });
        notes.add("Sticky notes became filled rectangles with text.");
      } else if (LINEAR.includes(e.type)) {
        const heads = e.heads || {};
        elements.push({ ...base, type: e.type, points: e.points.map(([x, y]) => [x, y]), lastCommittedPoint: null, startBinding: e.start ? { elementId: e.start.id, focus: 0, gap: 6 } : null, endBinding: e.end ? { elementId: e.end.id, focus: 0, gap: 6 } : null, startArrowhead: EX_HEAD_OUT[heads.start || "none"], endArrowhead: EX_HEAD_OUT[heads.end || "none"], roundness: e.curve ? { type: 2 } : null, elbowed: false, boundElements: bound });
      } else if (INK.includes(e.type)) {
        elements.push({ ...base, type: "freedraw", strokeWidth: Math.max(1, (e.width || 2) / 1.6), points: e.points.map(([x, y]) => [x, y]), pressures: e.points.map((q) => q[2] ?? 0.5), simulatePressure: false, lastCommittedPoint: null, roughness: 0, ...(e.type === "highlighter" ? { opacity: 40, strokeWidth: e.width || 18 } : {}) });
        if (e.type === "highlighter") notes.add("Highlighter strokes became semi-transparent freehand lines.");
      } else if (e.type === "text") {
        elements.push(textEl(e.id, e, dx, e.text || "", null, { frameId, textAlign: e.align || "left", strokeColor: e.stroke || "#1e1e1e" }));
      } else if (e.type === "image") {
        const md = e.media && model.media?.[e.media];
        if (md?.bytes) files[e.media] = { mimeType: md.mime, id: e.media, dataURL: dataUrl(md), created: now };
        else notes.add("Images without data were left out.");
        if (md?.bytes) elements.push({ ...base, type: "image", fileId: e.media, status: "saved", scale: [1, 1], strokeColor: "transparent" });
      } else if (e.type === "frame") {
        elements.push({ ...base, type: "frame", name: e.name || "Frame", backgroundColor: "transparent" });
      }
      if (e.text && e.type !== "text") {
        bound.push({ id: labelId, type: "text" });
        if (LINEAR.includes(e.type)) {
          const pts = e.points;
          const mid = pts[Math.floor((pts.length - 1) / 2)];
          elements.push(textEl(labelId, { ...e, x: e.x + mid[0], y: e.y + mid[1] - 10, w: 80, h: 20, angle: 0 }, dx, e.text, e.id, { frameId }));
        } else elements.push(textEl(labelId, { ...e, x: e.x + 8, y: e.y + 8, w: e.w - 16, h: e.h - 16 }, dx, e.text, e.id, { frameId }));
      }
    }
  }
  // arrows register themselves on the shapes they connect (Excalidraw keeps both directions)
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const e of elements) {
    for (const b of [e.startBinding, e.endBinding]) {
      const t = b && byId.get(b.elementId);
      if (t) t.boundElements = [...(t.boundElements || []), { id: e.id, type: "arrow" }];
    }
  }
  for (const e of elements) if (Array.isArray(e.boundElements) && !e.boundElements.length) e.boundElements = null;
  const json = { type: "excalidraw", version: 2, source: "OpenFini", elements, appState: { viewBackgroundColor: model.background || "#ffffff", gridSize: null }, files };
  return { json, notes: [...notes] };
}

// ================================================================================================ tldraw

const TL_COLORS = { black: "#1d1d1d", grey: "#9fa8b2", "light-violet": "#e085f4", violet: "#ae3ec9", blue: "#4465e9", "light-blue": "#4ba1f1", yellow: "#f1ac4b", orange: "#e16919", green: "#099268", "light-green": "#4cb05e", "light-red": "#f87777", red: "#e03131", white: "#ffffff" };
const TL_NOTE = { black: "#fcfffe", grey: "#e8e8e8", "light-violet": "#f5d7fb", violet: "#e8d3f0", blue: "#dce1f8", "light-blue": "#ddedfa", yellow: "#fff3a0", orange: "#ffe0b2", green: "#c8f0d0", "light-green": "#dbf0e0", "light-red": "#ffd1dc", red: "#f4dadb", white: "#ffffff" };
const TL_SEMI = "#f5f5f5";
const TL_SIZE = { s: 2, m: 3.5, l: 5, xl: 10 };
const TL_FONT_SIZE = { s: 18, m: 24, l: 36, xl: 44 };
const TL_FONT_IN = { draw: "hand", sans: "sans", serif: "serif", mono: "mono" };

const rgb = (hex) => {
  const h = /^#([0-9a-f]{6})/i.exec(hex || "")?.[1] || "000000";
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
/** The tldraw palette color nearest to a hex color. */
export function nearestTlColor(hex, table = TL_COLORS) {
  const [r, g, b] = rgb(hex);
  let best = "black";
  let bd = Infinity;
  for (const [name, c] of Object.entries(table)) {
    const [r2, g2, b2] = rgb(c);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bd) [best, bd] = [name, d];
  }
  return best;
}
const nearestSize = (w, table = TL_SIZE) => Object.entries(table).reduce((best, [k, v]) => (Math.abs(v - w) < Math.abs(table[best] - w) ? k : best), "m");

/** Plain text of a tldraw `text` prop or a rich-text (TipTap JSON) document. */
function tlText(props) {
  if (typeof props?.text === "string") return props.text;
  const walk = (n) => (!n ? "" : typeof n.text === "string" ? n.text : Array.isArray(n.content) ? n.content.map(walk).join(n.type === "doc" ? "\n" : "") : "");
  return props?.richText ? walk(props.richText) : "";
}

/** Reads a .tldraw file (store snapshot; tldraw 2.x and 3.x records) into a board model. */
export function readTldraw(json, report) {
  const r = rep(report || noop);
  const records = Array.isArray(json?.records) ? json.records : json?.document?.store ? Object.values(json.document.store) : Array.isArray(json?.store) ? json.store : json?.store && typeof json.store === "object" ? Object.values(json.store) : null;
  if (!records) throw new Error("This is not a tldraw file (no records).");
  const byId = new Map();
  for (const rec of records.slice(0, MAX_ELEMENTS * 2)) if (rec && typeof rec.id === "string") byId.set(rec.id, rec);
  const pagesIn = [...byId.values()].filter((x) => x.typeName === "page").sort((a, b) => (String(a.index) < String(b.index) ? -1 : 1));
  if (!pagesIn.length) pagesIn.push({ id: "page:page", name: "Page 1" });
  const pageIds = new Map(pagesIn.map((p, i) => [p.id, safeId(p.id.replace(/^page:/, "p")) || `p${i + 1}`]));
  const model = { ...emptyModel(), pages: pagesIn.map((p, i) => ({ id: pageIds.get(p.id), name: String(p.name || `Page ${i + 1}`), z: initialKey(i, pagesIn.length), paper: "plain" })) };
  const shapes = [...byId.values()].filter((x) => x.typeName === "shape");
  const sid = (id) => safeId(String(id).replace(/^shape:/, ""));
  // absolute transform through parents (frames and groups)
  const absCache = new Map();
  const abs = (s) => {
    if (absCache.has(s.id)) return absCache.get(s.id);
    const parent = byId.get(s.parentId);
    let res;
    if (parent?.typeName === "shape") {
      const p = abs(parent);
      const [x, y] = rotate([p.x + fin(s.x), p.y + fin(s.y)], [p.x, p.y], p.rot);
      res = { x, y, rot: p.rot + fin(s.rotation), page: p.page };
    } else res = { x: fin(s.x), y: fin(s.y), rot: fin(s.rotation), page: pageIds.get(s.parentId) || model.pages[0].id };
    absCache.set(s.id, res);
    return res;
  };
  // z: page order of parents first, then the shape's index (fractional strings sort like ours)
  const zKey = (s) => {
    const parent = byId.get(s.parentId);
    return (parent?.typeName === "shape" ? `${zKey(parent)}~` : "") + String(s.index || "a0");
  };
  const ordered = [...shapes].sort((a, b) => (zKey(a) < zKey(b) ? -1 : zKey(a) > zKey(b) ? 1 : 0));
  const bindings = [...byId.values()].filter((x) => x.typeName === "binding" && x.type === "arrow");
  const media = {};
  const out = [];
  const count = {};
  const inc = (k) => (count[k] = (count[k] || 0) + 1);
  ordered.forEach((s, i) => {
    const p = s.props || {};
    const t = abs(s);
    const parent = byId.get(s.parentId);
    const groupOf = parent?.type === "group" ? sid(parent.id) : null;
    const frameOf = parent?.type === "frame" ? sid(parent.id) : null;
    const w = fin(p.w, 0);
    const h = fin(p.h, 0) + fin(p.growY, 0);
    // tldraw rotates about the top-left corner; ours turns about the center
    const c = rotate([t.x + w / 2, t.y + h / 2], [t.x, t.y], t.rot);
    const stroke = TL_COLORS[p.color] || "#1d1d1d";
    const base = { id: sid(s.id), page: t.page, x: c[0] - w / 2, y: c[1] - h / 2, w, h, angle: t.rot, z: initialKey(i, ordered.length), stroke, opacity: fin(s.opacity, 1), width: TL_SIZE[p.size] || 3.5, rough: p.dash === "draw" ? 1 : 0, dash: p.dash === "dashed" ? "dashed" : p.dash === "dotted" ? "dotted" : "solid", ...(groupOf ? { group: groupOf } : {}), ...(frameOf ? { frame: frameOf } : {}), ...(s.isLocked ? { locked: true } : {}) };
    const fill = p.fill === "solid" ? TL_NOTE[p.color] || "#ffffff" : p.fill === "semi" ? TL_SEMI : p.fill === "pattern" ? stroke : null;
    const fillStyle = p.fill === "pattern" ? "hachure" : "solid";
    const text = tlText(p);
    const textProps = { text, fontSize: TL_FONT_SIZE[p.size] || 24, font: TL_FONT_IN[p.font] || "hand", align: p.align === "start" || p.textAlign === "start" ? "left" : p.align === "end" || p.textAlign === "end" ? "right" : "center" };
    switch (s.type) {
      case "geo": {
        const geo = p.geo === "ellipse" || p.geo === "oval" ? "ellipse" : p.geo === "diamond" || p.geo === "rhombus" ? "diamond" : "rect";
        if (!["rectangle", "ellipse", "oval", "diamond", "rhombus"].includes(p.geo)) inc("geo");
        out.push(makeElement(geo, { ...base, fill, fillStyle, ...textProps, fontSize: Math.min(textProps.fontSize, 28) }));
        inc("shape");
        break;
      }
      case "note": {
        const size = Math.max(w || 200, 200);
        out.push(makeElement("sticky", { ...base, w: size, h: Math.max(size, h), fill: TL_NOTE[p.color] || STICKY_COLORS[0], ...textProps }));
        inc("note");
        break;
      }
      case "text": {
        out.push(makeElement("text", { ...base, w: w || 100, h: textProps.fontSize * 1.25 * Math.max(1, text.split("\n").length), ...textProps, align: textProps.align === "center" && !p.textAlign && !p.align ? "left" : textProps.align, fill: null }));
        inc("text");
        break;
      }
      case "draw":
      case "highlight": {
        const pts = [];
        for (const seg of Array.isArray(p.segments) ? p.segments : []) for (const q of Array.isArray(seg?.points) ? seg.points : []) pts.push([t.x + fin(q.x), t.y + fin(q.y), p.isPen ? Math.max(0, Math.min(1, fin(q.z, 0.5))) : 0.5]);
        if (!pts.length) return inc("empty");
        const rel = pts.map(([x, y, z]) => [x - t.x, y - t.y, z]);
        const type = s.type === "highlight" ? "highlighter" : "pen";
        out.push(makeElement(type, { ...base, x: t.x, y: t.y, angle: 0, points: rel, rough: 0, ...(type === "highlighter" ? { width: (TL_SIZE[p.size] || 3.5) * 4, stroke: TL_COLORS[p.color] || "#f1ac4b", opacity: 0.45 } : {}) }));
        if (t.rot) inc("rotInk");
        inc("ink");
        break;
      }
      case "arrow":
      case "line": {
        let pts;
        if (s.type === "arrow") pts = [[fin(p.start?.x), fin(p.start?.y)], [fin(p.end?.x), fin(p.end?.y)]];
        else {
          const raw = p.points && !Array.isArray(p.points) ? Object.values(p.points).sort((a, b) => (String(a.index) < String(b.index) ? -1 : 1)) : Array.isArray(p.points) ? p.points : p.handles ? Object.values(p.handles).sort((a, b) => (String(a.index) < String(b.index) ? -1 : 1)) : [];
          pts = raw.map((q) => [fin(q.x), fin(q.y)]);
        }
        if (pts.length < 2) return inc("empty");
        const absPts = pts.map((q) => rotate([t.x + q[0], t.y + q[1]], [t.x, t.y], t.rot));
        let start = null;
        let end = null;
        for (const b of bindings) {
          if (b.fromId !== s.id) continue;
          if (b.props?.terminal === "start") start = { id: sid(b.toId) };
          if (b.props?.terminal === "end") end = { id: sid(b.toId) };
        }
        if (p.start?.type === "binding" && p.start.boundShapeId) start = { id: sid(p.start.boundShapeId) };
        if (p.end?.type === "binding" && p.end.boundShapeId) end = { id: sid(p.end.boundShapeId) };
        const heads = s.type === "arrow" ? { start: p.arrowheadStart && p.arrowheadStart !== "none" ? EX_HEAD_IN(p.arrowheadStart) : "none", end: p.arrowheadEnd === "none" ? "none" : EX_HEAD_IN(p.arrowheadEnd || "arrow") } : { start: "none", end: "none" };
        out.push(makeElement(s.type, { ...base, x: 0, y: 0, angle: 0, points: absPts, heads, start, end, text, fontSize: 18, ...(p.bend ? {} : {}), ...(s.type === "line" && p.spline === "cubic" ? { curve: true } : {}) }));
        if (p.bend) inc("bend");
        inc("connector");
        break;
      }
      case "frame":
        out.push(makeElement("frame", { ...base, name: String(p.name || "Frame") }));
        inc("frame");
        break;
      case "image": {
        const asset = byId.get(p.assetId);
        const data = asset && dataUrlBytes(asset.props?.src);
        const mid = data ? sid(asset.id.replace(/^asset:/, "a")) : null;
        if (data && !media[mid]) media[mid] = { id: mid, mime: asset.props.mimeType || data.mime, name: String(asset.props.name || ""), bytes: data.bytes, w: fin(asset.props.w), h: fin(asset.props.h) };
        if (!data) inc("missingImage");
        out.push(makeElement("image", { ...base, media: mid }));
        break;
      }
      case "group":
        break; // members carry the group id
      default:
        inc(`drop:${s.type}`);
    }
  });
  const m = normalizeBoard(addElements({ ...model, media }, out));
  if (count.shape) r.kept("Shapes", count.shape);
  if (count.note) r.kept("Sticky notes", count.note);
  if (count.text) r.kept("Text", count.text);
  if (count.connector) r.kept("Arrows and lines", count.connector);
  if (count.ink) r.kept("Freehand drawings", count.ink);
  if (count.frame) r.kept("Frames", count.frame);
  if (pagesIn.length > 1) r.kept("Pages", pagesIn.length);
  if (count.geo) r.simplified("Shapes other than rectangles, ellipses and diamonds became rectangles", count.geo);
  if (count.bend) r.simplified("Curved arrows became straight", count.bend);
  if (count.rotInk) r.simplified("Rotation of freehand drawings", count.rotInk);
  if (count.missingImage) r.dropped("Images stored outside the file (shown as placeholders)", count.missingImage);
  for (const [k, n] of Object.entries(count)) if (k.startsWith("drop:")) r.dropped(`Unsupported shapes (${k.slice(5)})`, n);
  return m;
}

// fractional index keys tldraw accepts ("a1" … "aZ", "b10" …)
const D62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function tlIndex(i) {
  if (i < 61) return `a${D62[i + 1]}`;
  const n = i - 61 + 62;
  return `b${D62[Math.floor(n / 62) % 62]}${D62[n % 62]}`;
}

/** Schema of the records written below (tldraw 2.x); newer tldraw versions migrate it forward on open. */
const TL_SCHEMA = {
  schemaVersion: 2,
  sequences: {
    "com.tldraw.store": 4, "com.tldraw.asset": 1, "com.tldraw.camera": 1, "com.tldraw.document": 2, "com.tldraw.instance": 25, "com.tldraw.instance_page_state": 5, "com.tldraw.page": 1, "com.tldraw.instance_presence": 5, "com.tldraw.pointer": 1, "com.tldraw.shape": 4,
    "com.tldraw.asset.bookmark": 2, "com.tldraw.asset.image": 4, "com.tldraw.asset.video": 4, "com.tldraw.shape.group": 0, "com.tldraw.shape.text": 2, "com.tldraw.shape.bookmark": 2, "com.tldraw.shape.draw": 2, "com.tldraw.shape.geo": 9, "com.tldraw.shape.note": 7,
    "com.tldraw.shape.line": 5, "com.tldraw.shape.frame": 0, "com.tldraw.shape.arrow": 5, "com.tldraw.shape.highlight": 1, "com.tldraw.shape.embed": 4, "com.tldraw.shape.image": 3, "com.tldraw.shape.video": 2, "com.tldraw.binding.arrow": 0,
  },
};

/** Writes a .tldraw file (pages, shapes, embedded images, arrow bindings). */
export function writeTldraw(model) {
  const notes = new Set();
  const records = [{ id: "document:document", typeName: "document", gridSize: 10, name: model.title || "", meta: {} }];
  const pages = sortedPages(model);
  const shapeId = (id) => `shape:${id}`;
  pages.forEach((p, pi) => {
    const pid = `page:${p.id}`;
    records.push({ id: pid, typeName: "page", name: p.name, index: tlIndex(pi), meta: {} });
    const els = pageElements(model, p.id);
    const frames = new Map(els.filter((e) => e.type === "frame").map((e) => [e.id, e]));
    els.forEach((e, i) => {
      const frame = e.frame && frames.get(e.frame);
      // tldraw rotates about the top-left corner: move the origin so the center stays put
      const tl = rotate([e.x, e.y], center(e), e.angle || 0);
      const parentId = frame ? shapeId(frame.id) : pid;
      const fx = frame ? frame.x : 0;
      const fy = frame ? frame.y : 0;
      const color = nearestTlColor(e.stroke || "#1d1d1d");
      const size = nearestSize(e.width ?? 2);
      const dash = e.dash === "dashed" ? "dashed" : e.dash === "dotted" ? "dotted" : e.rough ? "draw" : "solid";
      const font = e.font === "hand" ? "draw" : ["sans", "serif", "mono"].includes(e.font) ? e.font : "draw";
      const shape = (type, props, extra = {}) => records.push({ id: shapeId(e.id), typeName: "shape", type, x: tl[0] - fx, y: tl[1] - fy, rotation: e.angle || 0, index: tlIndex(i), parentId, isLocked: !!e.locked, opacity: e.opacity ?? 1, props, meta: {}, ...extra });
      const fill = !e.fill ? "none" : e.fillStyle === "hachure" || e.fillStyle === "cross" ? "pattern" : "solid";
      const align = e.align === "left" ? "start" : e.align === "right" ? "end" : "middle";
      const textSize = nearestSize(e.fontSize || 24, TL_FONT_SIZE);
      if (e.group) notes.add("Groups were not written (tldraw groups are separate shapes).");
      switch (e.type) {
        case "rect":
        case "ellipse":
        case "diamond":
          shape("geo", { w: e.w, h: e.h, geo: e.type === "rect" ? "rectangle" : e.type, color, labelColor: "black", fill, dash, size, font, text: e.text || "", align, verticalAlign: "middle", growY: 0, url: "", scale: 1 });
          break;
        case "sticky":
          shape("note", { color: nearestTlColor(e.fill || "#fff3a0", TL_NOTE), size: textSize, font, fontSizeAdjustment: 0, align, verticalAlign: "middle", growY: 0, url: "", text: e.text || "", scale: 1 });
          if (Math.abs(e.w - 200) > 1 || Math.abs(e.h - 200) > 1) notes.add("Sticky notes have tldraw's fixed size.");
          break;
        case "text":
          shape("text", { color, size: textSize, font, textAlign: e.align === "right" ? "end" : e.align === "center" ? "middle" : "start", w: Math.max(8, e.w), text: e.text || "", scale: 1, autoSize: true });
          break;
        case "pen":
        case "highlighter": {
          const segments = [{ type: "free", points: e.points.map((q) => ({ x: q[0], y: q[1], z: q[2] ?? 0.5 })) }];
          if (e.type === "pen") shape("draw", { segments, color, fill: "none", dash: "draw", size, isComplete: true, isClosed: false, isPen: e.points.some((q) => q[2] !== undefined && q[2] !== 0.5), scale: 1 }, { x: e.x - fx, y: e.y - fy, rotation: 0 });
          else shape("highlight", { segments, color, size: nearestSize((e.width || 18) / 4), isComplete: true, isPen: false, scale: 1 }, { x: e.x - fx, y: e.y - fy, rotation: 0 });
          break;
        }
        case "line":
        case "arrow": {
          const pts = e.points;
          if (e.type === "arrow") {
            if (pts.length > 2) notes.add("Arrows with bends became straight arrows.");
            const a = pts[0];
            const b = pts[pts.length - 1];
            const head = (h) => (h === "none" || !h ? "none" : h === "triangle" ? "triangle" : h === "dot" ? "dot" : h === "bar" ? "bar" : "arrow");
            shape("arrow", { dash, size, fill: "none", color, labelColor: "black", bend: 0, start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, arrowheadStart: head(e.heads?.start), arrowheadEnd: head(e.heads?.end), text: e.text || "", labelPosition: 0.5, font, scale: 1 }, { x: e.x - fx, y: e.y - fy, rotation: 0 });
            for (const [terminal, b2] of [["start", e.start], ["end", e.end]]) {
              if (!b2 || !model.elements[b2.id]) continue;
              records.push({ id: `binding:${e.id}-${terminal}`, typeName: "binding", type: "arrow", fromId: shapeId(e.id), toId: shapeId(b2.id), props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }, meta: {} });
            }
          } else {
            const points = {};
            pts.forEach((q, k) => {
              const idx = tlIndex(k);
              points[idx] = { id: idx, index: idx, x: q[0], y: q[1] };
            });
            shape("line", { color, dash, size, spline: e.curve ? "cubic" : "line", points, scale: 1 }, { x: e.x - fx, y: e.y - fy, rotation: 0 });
            if (e.start || e.end) notes.add("Lines are not bound to shapes in tldraw (only arrows are).");
          }
          if (e.text && e.type === "line") notes.add("Labels on lines were left out.");
          break;
        }
        case "frame":
          shape("frame", { w: e.w, h: e.h, name: e.name || "Frame" });
          break;
        case "image": {
          const md = e.media && model.media?.[e.media];
          if (!md?.bytes) {
            notes.add("Images without data were left out.");
            break;
          }
          const aid = `asset:${e.media}`;
          if (!records.some((x) => x.id === aid)) records.push({ id: aid, typeName: "asset", type: "image", props: { name: md.name || "image", src: dataUrl(md), w: md.w || e.w, h: md.h || e.h, mimeType: md.mime, isAnimated: md.mime === "image/gif", fileSize: md.bytes.length }, meta: {} });
          shape("image", { w: e.w, h: e.h, playing: true, url: "", assetId: aid, crop: null });
          break;
        }
      }
      if (e.fill && SHAPES.includes(e.type) && nearestTlColor(e.fill, TL_NOTE) !== color) notes.add("Fill colors follow the stroke color in tldraw.");
    });
  });
  if (Object.values(model.elements).some((e) => e.stroke && !Object.values(TL_COLORS).includes(e.stroke))) notes.add("Colors snap to tldraw's palette.");
  return { json: { tldrawFileFormatVersion: 1, schema: TL_SCHEMA, records }, notes: [...notes] };
}
