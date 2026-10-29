// PowerPoint (.pptx / .ppsx / .potx) reader and writer for the Presentation app. Pure (no DOM); uses the Office
// engine's hardened ZIP access and tolerant XML parser. Best effort by design (docs/office-slides.md ▸ Fidelity):
// slides, text boxes and placeholders (with layout/master position inheritance), basic shapes, pictures, tables,
// solid backgrounds and picture backgrounds, speaker notes, fade/push transitions, hidden slides and the theme's colors
// and fonts are read; per-run formatting is reduced to one style per text box; charts, SmartArt, media, animations and
// comments are dropped. Everything simplified or dropped is listed in the import report.
//
// Public API
//   readPptx(bytes, { report }) → deck (normalized model, model.js)
//   writePptx(deck, { title }) → Uint8Array
import { readZip, writeZip, text as zipText } from "../../engine/office/zip.js";
import { parseXml, child, children, find, findAll, attr, esc, escAttr } from "../../engine/office/xml.js";
import { sniffImage, imageSize } from "../../engine/office/media.js";
import { normalizeDeck, layoutOf, newId } from "./model.js";

const EMU = 9525; // per px
const px = (v) => Math.round((Number(v) || 0) / EMU);

// ---------------------------------------------------------------- colors

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToHex([h, s, l]) {
  const f = (p, q, t) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const c = s === 0 ? [l, l, l] : [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)];
  return `#${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
}
function applyMods(hex, el) {
  let hsl = null;
  for (const m of children(el)) {
    const v = Number(attr(m, "val")) / 100000;
    if (!Number.isFinite(v)) continue;
    hsl ||= hexToHsl(hex);
    if (m.local === "lumMod") hsl[2] *= v;
    else if (m.local === "lumOff") hsl[2] += v;
    else if (m.local === "tint") hsl[2] = hsl[2] + (1 - hsl[2]) * (1 - v);
    else if (m.local === "shade") hsl[2] *= v;
  }
  return hsl ? hslToHex([hsl[0], hsl[1], Math.max(0, Math.min(1, hsl[2]))]) : hex;
}
const SCHEME_ALIAS = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
const PRESET = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", gray: "#808080" };

/** Color of a fill-like element (solidFill, a:fgClr, fillRef …) using the theme's scheme. */
function colorIn(el, scheme) {
  if (!el) return null;
  for (const c of children(el)) {
    let hex = null;
    if (c.local === "srgbClr") hex = `#${String(attr(c, "val") || "").toLowerCase()}`;
    else if (c.local === "sysClr") hex = `#${String(attr(c, "lastClr") || "000000").toLowerCase()}`;
    else if (c.local === "schemeClr") hex = scheme[SCHEME_ALIAS[attr(c, "val")] || attr(c, "val")] || null;
    else if (c.local === "prstClr") hex = PRESET[attr(c, "val")] || null;
    if (hex && /^#[0-9a-f]{6}$/.test(hex)) return applyMods(hex, c);
  }
  return null;
}

// ---------------------------------------------------------------- package helpers

const dirOf = (p) => p.slice(0, p.lastIndexOf("/"));
function resolvePath(base, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = dirOf(base).split("/");
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const PH_ROLE = { title: "title", ctrTitle: "title", subTitle: "subtitle", body: "body", obj: "body" };
const LAYOUT_TYPE = { title: "title", obj: "title-content", tx: "title-content", secHead: "section", twoObj: "two-content", twoTxTwoObj: "two-content", titleOnly: "title-only", blank: "blank" };
const PRST = { rect: "rect", roundRect: "roundRect", ellipse: "ellipse", triangle: "triangle", diamond: "diamond", rightArrow: "arrow", line: "line", straightConnector1: "line" };

/**
 * Reads a PowerPoint package into a normalized deck.
 * @param {Uint8Array} bytes
 * @param {{ report?: import("../../core/import-report.js").ImportReport }} [o]
 */
export function readPptx(bytes, { report } = {}) {
  if (bytes?.[0] === 0xd0 && bytes[1] === 0xcf) throw new Error("This is a PowerPoint 97-2003 file (.ppt). Save it as .pptx in PowerPoint, Impress or Google Slides first.");
  const { entries, problems, ok } = readZip(bytes);
  if (!ok) throw new Error(problems[problems.length - 1] || "The file is not a PowerPoint package.");
  report?.warnings(problems);
  const cache = new Map();
  const xml = (p) => {
    if (!cache.has(p)) {
      const s = zipText(entries, p);
      cache.set(p, s ? parseXml(s) : null);
    }
    return cache.get(p);
  };
  const rels = (p) => {
    const doc = xml(`${dirOf(p)}/_rels/${p.slice(p.lastIndexOf("/") + 1)}.rels`);
    const out = {};
    for (const r of findAll(doc, "Relationship")) if (attr(r, "TargetMode") !== "External") out[attr(r, "Id")] = { type: String(attr(r, "Type") || ""), path: resolvePath(p, String(attr(r, "Target") || "")) };
    return out;
  };
  const relOfType = (p, suffix) => Object.values(rels(p)).find((r) => r.type.endsWith(suffix))?.path || null;

  const presPath = "ppt/presentation.xml";
  const pres = xml(presPath);
  if (!pres) throw new Error("The package has no ppt/presentation.xml: it is not a PowerPoint presentation.");
  const presRels = rels(presPath);
  const sz = find(pres, "sldSz");
  const size = { w: px(attr(sz, "cx") || 9144000), h: px(attr(sz, "cy") || 5143500) };

  // theme: colors and fonts
  const firstMaster = Object.values(presRels).find((r) => r.type.endsWith("/slideMaster"))?.path;
  const themePath = (firstMaster && relOfType(firstMaster, "/theme")) || Object.values(presRels).find((r) => r.type.endsWith("/theme"))?.path || "ppt/theme/theme1.xml";
  const themeDoc = xml(themePath);
  const scheme = {};
  for (const c of children(find(themeDoc, "clrScheme"))) scheme[c.local] = colorIn({ children: c.children }, {});
  const fontOf = (n) => attr(child(find(themeDoc, n), "latin"), "typeface") || null;
  const theme = { id: "office", name: attr(themeDoc && find(themeDoc, "theme"), "name") || "Imported", text: scheme.dk1, bg: scheme.lt1, accent: scheme.accent1, accent2: scheme.accent2, heading: fontOf("majorFont"), body: fontOf("minorFont") };

  // media
  const media = {};
  const mediaByPath = new Map();
  const mediaFor = (path) => {
    if (mediaByPath.has(path)) return mediaByPath.get(path);
    const b = entries[path];
    const mime = b && sniffImage(b, path);
    let id = null;
    if (mime) {
      id = newId("m");
      const s = imageSize(b, mime) || {};
      media[id] = { id, mime, name: path.split("/").pop(), w: s.w || 0, h: s.h || 0, bytes: b };
    } else report?.dropped("Pictures in formats OpenFini cannot show (EMF, WMF, TIFF) were left out.");
    mediaByPath.set(path, id);
    return id;
  };

  // masters and layouts: placeholder boxes, default text sizes, backgrounds
  const phInfo = new Map(); // part path → { byType, byIdx, sizes, bg, layoutType }
  const info = (p) => {
    if (!p) return null;
    if (phInfo.has(p)) return phInfo.get(p);
    const doc = xml(p);
    const out = { byType: {}, byIdx: {}, sizes: {}, bg: null, type: attr(doc?.children.find((c) => typeof c !== "string"), "type") || null };
    phInfo.set(p, out);
    for (const sp of findAll(find(doc, "spTree"), "sp")) {
      const ph = find(child(sp, "nvSpPr"), "ph");
      const xf = find(child(sp, "spPr"), "xfrm");
      if (!ph || !xf) continue;
      const box = xfrmBox(xf);
      const t = attr(ph, "type") || "body";
      out.byType[t] ||= box;
      if (attr(ph, "idx") != null) out.byIdx[attr(ph, "idx")] ||= box;
    }
    const ts = find(doc, "txStyles");
    for (const [k, n] of [["title", "titleStyle"], ["body", "bodyStyle"], ["other", "otherStyle"]]) {
      const v = attr(find(find(child(ts, n), "lvl1pPr"), "defRPr"), "sz");
      if (v) out.sizes[k] = Number(v) / 100;
    }
    out.bg = backgroundOf(doc, p);
    return out;
  };
  const backgroundOf = (doc, part) => {
    const bg = find(doc, "bg");
    if (!bg) return null;
    const pr = child(bg, "bgPr");
    if (pr) {
      const c = colorIn(child(pr, "solidFill"), scheme) || colorIn(find(child(pr, "gradFill"), "gs"), scheme);
      if (c) return { color: c };
      const blip = find(child(pr, "blipFill"), "blip");
      const rid = attr(blip, "r:embed");
      const target = rid && rels(part)[rid];
      if (target) {
        const id = mediaFor(target.path);
        return id ? { media: id } : null;
      }
    }
    const ref = child(bg, "bgRef");
    const c = colorIn(ref, scheme);
    return c ? { color: c } : null;
  };

  const slides = [];
  const sldIds = children(find(pres, "sldIdLst"), "sldId");
  let mixed = false;
  for (const sid of sldIds) {
    const path = presRels[attr(sid, "r:id")]?.path;
    const doc = path && xml(path);
    if (!doc) continue;
    const layoutPath = relOfType(path, "/slideLayout");
    const masterPath = layoutPath && relOfType(layoutPath, "/slideMaster");
    const L = info(layoutPath) || { byType: {}, byIdx: {}, sizes: {} };
    const Mst = info(masterPath) || { byType: {}, byIdx: {}, sizes: {} };
    const ctx = { scheme, rels: rels(path), mediaFor, report, L, Mst, onMixed: () => (mixed = true), bodies: 0 };
    const elements = readTree(find(doc, "spTree"), ctx, null);
    const root = doc.children.find((c) => typeof c !== "string");
    // notes
    let notes = "";
    const notesPath = relOfType(path, "/notesSlide");
    if (notesPath) {
      for (const sp of findAll(find(xml(notesPath), "spTree"), "sp")) {
        const ph = find(child(sp, "nvSpPr"), "ph");
        if (ph && attr(ph, "type") === "body") notes = readText(child(sp, "txBody"), ctx).text;
      }
    }
    // transition
    const tr = find(doc, "transition");
    let transition = { type: "none", duration: 0.5 };
    if (tr) {
      const kind = children(tr).map((c) => c.local)[0];
      const spd = { slow: 1, med: 0.75, fast: 0.5 }[attr(tr, "spd")] || 0.5;
      const dur = Number(attr(tr, "dur")) / 1000;
      transition = { type: kind === "fade" || kind === "dissolve" ? "fade" : kind ? "slide" : "none", duration: Number.isFinite(dur) && dur > 0 ? dur : spd };
      if (kind && !["fade", "push", "wipe", "cover", "pull", "split", "dissolve"].includes(kind)) report?.flattened("Some slide transitions became a simple slide-in.");
    }
    if (findAll(doc, "timing").length) report?.dropped("Animations were left out (slide transitions are kept).");
    const bg = backgroundOf(doc, path) || L.bg || Mst.bg;
    slides.push({ id: newId("s"), layout: LAYOUT_TYPE[L.type] || (elements.some((e) => e.ph === "body") ? "title-content" : elements.some((e) => e.ph === "title") ? "title-only" : "blank"), background: bg, elements, notes, transition, ...(attr(root, "show") === "0" ? { hidden: true } : {}) });
  }
  if (mixed) report?.flattened("Mixed text formatting inside a text box was reduced to one style per box.");
  if (Object.keys(entries).some((k) => k.startsWith("ppt/comments/") || k.startsWith("ppt/comments"))) report?.dropped("PowerPoint comments were left out.");
  const core = xml("docProps/core.xml");
  const deck = normalizeDeck({ size, theme, meta: { title: (find(core, "title") && textOfEl(find(core, "title"))) || "" }, slides, media });
  report?.kept(`${deck.slides.length} slides with text, shapes, pictures, tables, backgrounds and speaker notes`);
  return deck;
}

const textOfEl = (el) => el.children.filter((c) => typeof c === "string").join("");

function xfrmBox(xf) {
  const off = child(xf, "off");
  const ext = child(xf, "ext");
  return { x: px(attr(off, "x")), y: px(attr(off, "y")), w: px(attr(ext, "cx")), h: px(attr(ext, "cy")), rot: (Number(attr(xf, "rot")) || 0) / 60000, flipH: attr(xf, "flipH") === "1", flipV: attr(xf, "flipV") === "1" };
}

/** Reads a p:spTree / p:grpSp. `map` transforms child boxes of a group into slide space. */
function readTree(tree, ctx, map) {
  const out = [];
  if (!tree) return out;
  const place = (box) => (map ? map(box) : box);
  for (const n of children(tree)) {
    try {
      if (n.local === "sp" || n.local === "cxnSp") {
        const e = readShape(n, ctx, place);
        if (e) out.push(e);
      } else if (n.local === "pic") {
        const xf = find(child(n, "spPr"), "xfrm");
        const rid = attr(find(child(n, "blipFill"), "blip"), "r:embed");
        const target = rid && ctx.rels[rid];
        const id = target && ctx.mediaFor(target.path);
        if (id && xf) out.push({ type: "image", media: id, ...place(xfrmBox(xf)) });
        if (find(child(n, "blipFill"), "srcRect")) ctx.report?.flattened("Picture cropping was not kept (pictures show uncropped).");
        if (find(n, "videoFile") || find(n, "audioFile")) ctx.report?.dropped("Audio and video were left out (their poster pictures are kept).");
      } else if (n.local === "graphicFrame") {
        const tbl = find(n, "tbl");
        const xf = child(n, "xfrm");
        if (tbl && xf) {
          const rows = children(tbl, "tr").map((tr) => children(tr, "tc").map((tc) => readText(child(tc, "txBody"), ctx).text));
          const first = find(tbl, "rPr");
          out.push({ type: "table", rows, ...place(xfrmBox(xf)), style: { size: Number(attr(first, "sz")) / 100 || 14 }, header: attr(find(tbl, "tblPr"), "firstRow") !== "0" });
        } else ctx.report?.dropped("Charts, SmartArt and embedded objects were left out.");
      } else if (n.local === "grpSp") {
        const xf = find(child(n, "grpSpPr"), "xfrm");
        const off = child(xf, "off"), ext = child(xf, "ext"), chOff = child(xf, "chOff"), chExt = child(xf, "chExt");
        const sx = px(attr(chExt, "cx")) ? px(attr(ext, "cx")) / px(attr(chExt, "cx")) : 1;
        const sy = px(attr(chExt, "cy")) ? px(attr(ext, "cy")) / px(attr(chExt, "cy")) : 1;
        const inner = (b) => place({ ...b, x: px(attr(off, "x")) + (b.x - px(attr(chOff, "x"))) * sx, y: px(attr(off, "y")) + (b.y - px(attr(chOff, "y"))) * sy, w: b.w * sx, h: b.h * sy });
        out.push(...readTree(n, ctx, inner));
        ctx.report?.flattened("Grouped objects were ungrouped.");
      } else if (n.local === "AlternateContent") {
        const pick = child(n, "Fallback") || child(n, "Choice");
        out.push(...readTree(pick, ctx, map));
      }
    } catch {
      ctx.report?.dropped("An object that could not be read was left out.");
    }
  }
  return out;
}

function readShape(sp, ctx, place) {
  const nv = child(sp, "nvSpPr") || child(sp, "nvCxnSpPr");
  const ph = find(nv, "ph");
  const spPr = child(sp, "spPr");
  const xf = find(spPr, "xfrm");
  let role = null;
  let box = xf ? xfrmBox(xf) : null;
  if (ph) {
    const t = attr(ph, "type") || "body";
    if (["dt", "ftr", "sldNum", "hdr", "sldImg"].includes(t) && !find(sp, "t")) return null;
    role = PH_ROLE[t] || null;
    if (role === "body" && ctx.bodies++ === 1) role = "body2";
    const idx = attr(ph, "idx");
    box ||= (idx != null && (ctx.L.byIdx[idx] || ctx.Mst.byIdx[idx])) || ctx.L.byType[t] || ctx.Mst.byType[t] || ctx.L.byType[t === "ctrTitle" ? "title" : t] || ctx.Mst.byType[t === "ctrTitle" ? "title" : t === "subTitle" ? "body" : t] || null;
  }
  if (!box) return null;
  const geom = child(spPr, "prstGeom");
  const prst = attr(geom, "prst") || (child(spPr, "custGeom") ? "cust" : "rect");
  const shape = PRST[prst] || "rect";
  if (!PRST[prst]) ctx.report?.flattened("Shapes without a simple equivalent (custom outlines, callouts, stars …) became rectangles.");
  const style = child(sp, "style");
  const fillEl = child(spPr, "solidFill") || find(child(spPr, "gradFill"), "gs");
  if (child(spPr, "gradFill")) ctx.report?.flattened("Gradient fills became solid colors.");
  const fill = child(spPr, "noFill") ? null : colorIn(fillEl, ctx.scheme) || (style && !ph ? colorIn(child(style, "fillRef"), ctx.scheme) : null);
  const ln = child(spPr, "ln");
  const stroke = ln && child(ln, "noFill") ? null : colorIn(child(ln, "solidFill"), ctx.scheme) || (style ? colorIn(child(style, "lnRef"), ctx.scheme) : null);
  const strokeWidth = ln && attr(ln, "w") ? Math.max(0.5, Number(attr(ln, "w")) / EMU) : stroke ? 1 : 0;
  const tx = readText(child(sp, "txBody"), ctx, role);
  const isText = !!ph || attr(find(nv, "cNvSpPr"), "txBox") === "1" || (shape === "rect" && !fill && !stroke);
  return { type: isText && shape === "rect" ? "text" : "shape", shape, ...(role ? { ph: role } : {}), ...place(box), fill, stroke, strokeWidth: stroke ? strokeWidth : 0, text: tx.text, style: tx.style };
}

const ALIGN = { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" };
const ANCHOR = { t: "top", ctr: "middle", b: "bottom" };

function readText(body, ctx, role = null) {
  if (!body) return { text: "", style: {} };
  const bodyPr = child(body, "bodyPr");
  const scale = Number(attr(child(bodyPr, "normAutofit"), "fontScale")) / 100000 || 1;
  const paras = [];
  let style = null;
  let bullets = role === "body" || role === "body2";
  let algn = null;
  const sig = new Set();
  for (const p of children(body, "p")) {
    const pPr = child(p, "pPr");
    if (algn === null && attr(pPr, "algn")) algn = attr(pPr, "algn");
    if (child(pPr, "buChar") || child(pPr, "buAutoNum")) bullets = true;
    if (child(pPr, "buNone") && paras.length === 0) bullets = false;
    if (Number(attr(pPr, "lvl")) > 0) ctx.report?.flattened("Indented list levels were flattened to one level.");
    let s = "";
    for (const r of children(p)) {
      if (r.local === "r" || r.local === "fld") {
        const rPr = child(r, "rPr");
        const t = child(r, "t");
        s += t ? t.children.filter((c) => typeof c === "string").join("") : "";
        if (rPr) sig.add([attr(rPr, "sz"), attr(rPr, "b"), attr(rPr, "i"), colorIn(child(rPr, "solidFill"), ctx.scheme)].join("|"));
        if (!style && rPr) style = rPr;
      } else if (r.local === "br") s += "\n";
    }
    if (!style) style = child(pPr, "defRPr") || child(p, "endParaRPr");
    paras.push(s);
  }
  if (sig.size > 1) ctx.onMixed?.();
  const inherited = role === "title" ? ctx.Mst?.sizes.title : role ? ctx.Mst?.sizes.body : ctx.Mst?.sizes.other;
  const sz = Number(attr(style, "sz")) / 100 || inherited || (role === "title" ? 40 : role ? 22 : 18);
  return {
    text: paras.join("\n"),
    style: {
      size: Math.round(sz * scale * 2) / 2,
      bold: attr(style, "b") === "1",
      italic: attr(style, "i") === "1",
      underline: !!attr(style, "u") && attr(style, "u") !== "none",
      color: colorIn(child(style, "solidFill"), ctx.scheme),
      font: attr(child(style, "latin"), "typeface")?.startsWith("+") ? null : attr(child(style, "latin"), "typeface") || null,
      align: ALIGN[algn] || (role === "title" && ctx.L?.type === "title" ? "center" : "left"),
      valign: ANCHOR[attr(bodyPr, "anchor")] || (role === "title" ? "middle" : "top"),
      bullets,
    },
  };
}

// ---------------------------------------------------------------- writer

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument.presentationml";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const emu = (v) => Math.round((Number(v) || 0) * EMU);
const hex = (c) => String(c || "#000000").slice(1).toUpperCase();
const MEDIA_EXT = { "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp" };
const LAYOUT_XML_TYPE = { title: "title", "title-content": "obj", section: "secHead", "two-content": "twoObj", "title-only": "titleOnly", blank: "blank" };
const PRST_OUT = { rect: "rect", roundRect: "roundRect", ellipse: "ellipse", triangle: "triangle", diamond: "diamond", arrow: "rightArrow", line: "line" };

const relsXml = (list) => `${HEAD}<Relationships xmlns="${PKG}">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${escAttr(target)}"/>`).join("")}</Relationships>`;

function themeXml(t) {
  const c = (n, v) => `<a:${n}><a:srgbClr val="${hex(v)}"/></a:${n}>`;
  return `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${escAttr(t.name || "OpenFini")}"><a:themeElements><a:clrScheme name="${escAttr(t.name || "OpenFini")}">${c("dk1", t.text)}${c("lt1", t.bg)}${c("dk2", t.text)}${c("lt2", t.bg)}${c("accent1", t.accent)}${c("accent2", t.accent2)}${c("accent3", "#a5a5a5")}${c("accent4", "#ffc000")}${c("accent5", "#5b9bd5")}${c("accent6", "#70ad47")}${c("hlink", t.accent)}${c("folHlink", t.accent2)}</a:clrScheme><a:fontScheme name="OpenFini"><a:majorFont><a:latin typeface="${escAttr(t.heading)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${escAttr(t.body)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="OpenFini"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const xfrm = (e, tag = "a:xfrm") => `<${tag}${e.rot ? ` rot="${Math.round(e.rot * 60000)}"` : ""}${e.flipH ? ' flipH="1"' : ""}${e.flipV ? ' flipV="1"' : ""}><a:off x="${emu(e.x)}" y="${emu(e.y)}"/><a:ext cx="${emu(e.w)}" cy="${emu(e.h)}"/></${tag}>`;

function runProps(st, tag = "a:rPr") {
  return `<${tag} lang="en-US" sz="${Math.round(st.size * 100)}"${st.bold ? ' b="1"' : ""}${st.italic ? ' i="1"' : ""}${st.underline ? ' u="sng"' : ""} dirty="0">${st.color ? `<a:solidFill><a:srgbClr val="${hex(st.color)}"/></a:solidFill>` : ""}${st.font ? `<a:latin typeface="${escAttr(st.font)}"/>` : ""}</${tag}>`;
}
const ALGN_OUT = { left: "l", center: "ctr", right: "r", justify: "just" };
function txBody(text, st, tag = "p:txBody") {
  const paras = String(text ?? "").split("\n");
  const bu = st.bullets ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : "<a:buNone/>";
  const ps = paras.map((t) => `<a:p><a:pPr algn="${ALGN_OUT[st.align] || "l"}"${st.bullets ? ' marL="342900" indent="-342900"' : ' marL="0" indent="0"'}>${bu}</a:pPr>${t ? `<a:r>${runProps(st)}<a:t>${esc(t)}</a:t></a:r>` : ""}${runProps(st, "a:endParaRPr")}</a:p>`).join("");
  return `<${tag}><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${{ top: "t", middle: "ctr", bottom: "b" }[st.valign] || "t"}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${ps}</${tag}>`;
}

function shapeXml(e, n, relFor) {
  const name = escAttr(`${e.ph ? e.ph : e.type} ${n}`);
  if (e.type === "image") {
    const rid = relFor(e.media);
    if (!rid) return "";
    return `<p:pic><p:nvPicPr><p:cNvPr id="${n}" name="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(e)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }
  if (e.type === "table") {
    const cols = e.rows[0].length;
    const cw = Math.round(emu(e.w) / cols);
    const rh = Math.round(emu(e.h) / e.rows.length);
    const ln = (side) => `<a:${side} w="9525"><a:solidFill><a:srgbClr val="${hex(e.stroke)}"/></a:solidFill></a:${side}>`;
    const cell = (t) => `<a:tc>${txBody(t, { ...e.style, bullets: false }, "a:txBody")}<a:tcPr>${ln("lnL")}${ln("lnR")}${ln("lnT")}${ln("lnB")}${e.fill ? `<a:solidFill><a:srgbClr val="${hex(e.fill)}"/></a:solidFill>` : ""}</a:tcPr></a:tc>`;
    return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${n}" name="${name}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm(e, "p:xfrm")}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr${e.header ? ' firstRow="1"' : ""} bandRow="1"/><a:tblGrid>${`<a:gridCol w="${cw}"/>`.repeat(cols)}</a:tblGrid>${e.rows.map((r) => `<a:tr h="${rh}">${r.map(cell).join("")}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  }
  const ph = e.ph ? `<p:ph${e.ph === "title" ? ' type="title"' : e.ph === "subtitle" ? ' type="subTitle" idx="1"' : ` idx="${e.ph === "body2" ? 2 : 1}"`}/>` : "";
  const prst = e.type === "shape" ? PRST_OUT[e.shape] || "rect" : "rect";
  const fill = e.fill ? `<a:solidFill><a:srgbClr val="${hex(e.fill)}"/></a:solidFill>` : "<a:noFill/>";
  const line = e.stroke && e.strokeWidth ? `<a:ln w="${emu(e.strokeWidth)}"><a:solidFill><a:srgbClr val="${hex(e.stroke)}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="${name}"/><p:cNvSpPr${e.type === "text" && !e.ph ? ' txBox="1"' : ""}/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${xfrm(e)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr>${txBody(e.text, e.style)}</p:sp>`;
}

/** Writes a deck as a PowerPoint package (.pptx). */
export function writePptx(deck, { title = "" } = {}) {
  const files = [];
  const ct = [];
  const usedLayouts = LAYOUT_XML_TYPE;
  const layoutIds = Object.keys(usedLayouts);
  const mediaPath = {};
  let mi = 0;
  for (const [id, m] of Object.entries(deck.media || {})) if (m.bytes && MEDIA_EXT[m.mime]) mediaPath[id] = `media/image${++mi}.${MEDIA_EXT[m.mime]}`;

  // master, layouts, theme
  const t = deck.theme;
  const sizes = `<p:titleStyle><a:lvl1pPr><a:defRPr sz="4000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle>`;
  files.push(["ppt/slideMasters/slideMaster1.xml", `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(t.bg)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst>${layoutIds.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldLayoutIdLst><p:txStyles>${sizes}</p:txStyles></p:sldMaster>`]);
  files.push(["ppt/slideMasters/_rels/slideMaster1.xml.rels", relsXml([...layoutIds.map((_, i) => [`rId${i + 1}`, "slideLayout", `../slideLayouts/slideLayout${i + 1}.xml`]), [`rId${layoutIds.length + 1}`, "theme", "../theme/theme1.xml"]])]);
  ct.push(["/ppt/slideMasters/slideMaster1.xml", `${CT}.slideMaster+xml`]);
  layoutIds.forEach((id, i) => {
    const phs = layoutOf(id).ph.map(([role, fx, fy, fw, fh], k) => shapeXml({ type: "text", ph: role, x: fx * deck.size.w, y: fy * deck.size.h, w: fw * deck.size.w, h: fh * deck.size.h, text: "", style: { size: role === "title" ? 40 : 22, align: "left", valign: role === "title" ? "middle" : "top", bullets: role.startsWith("body") } }, k + 2, () => null)).join("");
    files.push([`ppt/slideLayouts/slideLayout${i + 1}.xml`, `${HEAD}<p:sldLayout ${NS} type="${usedLayouts[id]}" preserve="1"><p:cSld name="${escAttr(layoutOf(id).name)}"><p:spTree>${GRP}${phs}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`]);
    files.push([`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, relsXml([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]])]);
    ct.push([`/ppt/slideLayouts/slideLayout${i + 1}.xml`, `${CT}.slideLayout+xml`]);
  });
  files.push(["ppt/theme/theme1.xml", themeXml(t)], ["ppt/theme/theme2.xml", themeXml(t)]);
  ct.push(["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"], ["/ppt/theme/theme2.xml", "application/vnd.openxmlformats-officedocument.theme+xml"]);
  // notes master (PowerPoint requires one when slides have notes)
  files.push(["ppt/notesMasters/notesMaster1.xml", `${HEAD}<p:notesMaster ${NS}><p:cSld><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:notesMaster>`]);
  files.push(["ppt/notesMasters/_rels/notesMaster1.xml.rels", relsXml([["rId1", "theme", "../theme/theme2.xml"]])]);
  ct.push(["/ppt/notesMasters/notesMaster1.xml", `${CT}.notesMaster+xml`]);

  // slides
  deck.slides.forEach((s, i) => {
    const n = i + 1;
    const rel = [["rId1", "slideLayout", `../slideLayouts/slideLayout${layoutIds.indexOf(s.layout) + 1 || 2}.xml`]];
    const relFor = (mediaId) => {
      if (!mediaPath[mediaId]) return null;
      const found = rel.find((r) => r[2] === `../${mediaPath[mediaId]}`);
      if (found) return found[0];
      const id = `rId${rel.length + 2}`;
      rel.push([id, "image", `../${mediaPath[mediaId]}`]);
      return id;
    };
    let bg = "";
    if (s.background?.color) bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(s.background.color)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
    else if (s.background?.media && relFor(s.background.media)) bg = `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${relFor(s.background.media)}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`;
    const shapes = s.elements.map((e, k) => shapeXml(e, k + 2, relFor)).join("");
    const tr = s.transition.type === "fade" ? `<p:transition spd="med"><p:fade/></p:transition>` : s.transition.type === "slide" ? `<p:transition spd="med"><p:push dir="l"/></p:transition>` : "";
    files.push([`ppt/slides/slide${n}.xml`, `${HEAD}<p:sld ${NS}${s.hidden ? ' show="0"' : ""}><p:cSld>${bg}<p:spTree>${GRP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${tr}</p:sld>`]);
    if (s.notes) {
      rel.push([`rId${rel.length + 2}`, "notesSlide", `../notesSlides/notesSlide${n}.xml`]);
      files.push([`ppt/notesSlides/notesSlide${n}.xml`, `${HEAD}<p:notes ${NS}><p:cSld><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>${txBody(s.notes, { size: 12, align: "left", valign: "top" })}</p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`]);
      files.push([`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, relsXml([["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"], ["rId2", "slide", `../slides/slide${n}.xml`]])]);
      ct.push([`/ppt/notesSlides/notesSlide${n}.xml`, `${CT}.notesSlide+xml`]);
    }
    files.push([`ppt/slides/_rels/slide${n}.xml.rels`, relsXml(rel)]);
    ct.push([`/ppt/slides/slide${n}.xml`, `${CT}.slide+xml`]);
  });
  for (const [id, p] of Object.entries(mediaPath)) files.push([`ppt/${p}`, deck.media[id].bytes]);

  const nS = deck.slides.length;
  const presRels = [["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "theme", "theme/theme1.xml"], ["rId3", "notesMaster", "notesMasters/notesMaster1.xml"], ["rId4", "presProps", "presProps.xml"], ["rId5", "viewProps", "viewProps.xml"], ["rId6", "tableStyles", "tableStyles.xml"], ...deck.slides.map((_, i) => [`rId${i + 7}`, "slide", `slides/slide${i + 1}.xml`])];
  files.push(["ppt/presentation.xml", `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst><p:sldIdLst>${deck.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 7}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${emu(deck.size.w)}" cy="${emu(deck.size.h)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`]);
  files.push(["ppt/_rels/presentation.xml.rels", relsXml(presRels)]);
  files.push(["ppt/presProps.xml", `${HEAD}<p:presentationPr ${NS}/>`], ["ppt/viewProps.xml", `${HEAD}<p:viewPr ${NS}/>`], ["ppt/tableStyles.xml", `${HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`]);
  ct.push(["/ppt/presentation.xml", `${CT}.presentation.main+xml`], ["/ppt/presProps.xml", `${CT}.presProps+xml`], ["/ppt/viewProps.xml", `${CT}.viewProps+xml`], ["/ppt/tableStyles.xml", `${CT}.tableStyles+xml`]);
  const docTitle = deck.meta?.title || title || "";
  files.push(["docProps/core.xml", `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(docTitle)}</dc:title><dc:creator>OpenFini</dc:creator></cp:coreProperties>`]);
  files.push(["docProps/app.xml", `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OpenFini</Application><Slides>${nS}</Slides></Properties>`]);
  ct.push(["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"], ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"]);
  const rootRels = `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const defaults = `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="webp" ContentType="image/webp"/>`;
  const types = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults}${ct.map(([p, c]) => `<Override PartName="${p}" ContentType="${c}"/>`).join("")}</Types>`;
  return writeZip([["[Content_Types].xml", types], ["_rels/.rels", rootRels], ...files.map(([p, d]) => [p, d])]);
}

