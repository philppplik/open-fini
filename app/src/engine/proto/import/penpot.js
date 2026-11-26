// Penpot export (.penpot) → Proto (docs/concepts/proto-studio.md §11, task T8). Pure.
//
//   importPenpot(bytes, { model, name?, random?, pages?: "new" | "current" }) → { ops, roots, pages, report, size }
//
// Written from the published structure of Penpot's export format, version 3 (a ZIP with JSON and assets; Penpot's
// "Penpot file format" page of the technical guide), not from Penpot's code (Penpot is MPL-2.0; reading a format is
// not using code):
//   manifest.json                                   { type: "penpot/export-files", version, files: [{ id, name }] }
//   files/<file>.json                               the file (name, features)
//   files/<file>/pages/<page>.json                  { id, name, index, background? }
//   files/<file>/pages/<page>/<shape>.json          one shape (the page root is the frame 00000000-…)
//   files/<file>/components/<component>.json        { id, name, path, mainInstanceId, mainInstancePage }
//   files/<file>/media/<media>.json                 { id, name, width, height, mtype, mediaId }
//   files/<file>/tokens.json                        design tokens (sets, themes) → reported, import them with DTCG
//   objects/<storage>.json and objects/<storage>.<ext>   stored bytes (images)
// Keys are camelCase. Shapes: frame, group, rect, circle, path, text, image, bool, svg-raw with x, y, width, height
// (absolute page coordinates), rotation, fills (fillColor, fillOpacity, fillColorGradient, fillImage), strokes
// (strokeColor, strokeOpacity, strokeWidth, strokeAlignment inner|center|outer, strokeStyle), r1…r4, shadow, blur,
// opacity, blendMode, hidden, blocked, shapes (children), layout flex|grid with layoutFlexDir, layoutGap,
// layoutPadding, layoutJustifyContent, layoutAlignItems, layoutAlignContent, layoutWrapType, layoutGridColumns and
// layoutGridRows, children's layoutItemHSizing / layoutItemVSizing (fix, auto, fill) and layoutItemAbsolute, text
// `content` (root → paragraph-set → paragraph → text leaves with fontFamily, fontSize, fontWeight, fills…), path
// `content` (segments or SVG path data), and component main instances (`mainInstance`, `componentId`) and copies
// (`componentId` + `componentRoot`, children with `shapeRef`). The reader targets the format of Penpot 2.x; older
// exports (the v1 binary format) are refused with a message.
import { createBuilder, spec, ImportReport, safeUnzip, jsonEntry, hexA, cssColor, r2, num, cleanName, isObj, sniffImage, ImportError } from "./common.js";

const ROOT = "00000000-0000-0000-0000-000000000000";

/**
 * @param {Uint8Array} bytes
 * @param {{ model: object, name?: string, random?: () => number, pages?: "new"|"current", report?: ImportReport }} o
 */
export function importPenpot(bytes, { model, name = "Penpot", random, pages: pageMode = "new", report = null } = {}) {
  report ||= new ImportReport("Penpot", name);
  if (!(bytes?.[0] === 0x50 && bytes[1] === 0x4b)) throw new ImportError("This is not a Penpot export of the current format (a ZIP archive). Export the file again from Penpot 2 or newer.", "format");
  const entries = safeUnzip(bytes);
  const manifest = jsonEntry(entries, "manifest.json");
  if (!isObj(manifest) || (manifest.type && manifest.type !== "penpot/export-files")) throw new ImportError("This ZIP archive is not a Penpot export (manifest.json is missing).", "format");
  const b = createBuilder(model, { random, report });
  const stats = { pages: 0, boards: 0, components: 0, instances: 0, overrides: 0, text: 0, images: 0, layouts: 0, bool: 0, svgRaw: 0, missingMedia: 0 };
  const files = Array.isArray(manifest.files) && manifest.files.length ? manifest.files : Object.keys(entries).filter((k) => /^files\/[^/]+\.json$/.test(k)).map((k) => ({ id: k.slice(6, -5) }));
  const created = [];
  const roots = [];
  let offsetX = 0;
  let firstSize = null;
  const pendingRoots = [];

  for (const file of files) {
    const fid = String(file.id || "");
    const dir = `files/${fid}/`;
    const media = new Map();
    for (const k of Object.keys(entries)) {
      const m = new RegExp(`^${escapeRe(dir)}media/([^/]+)\\.json$`).exec(k);
      if (m) {
        const j = jsonEntry(entries, k);
        if (isObj(j)) media.set(String(j.id || m[1]), j);
      }
    }
    const storage = (sid) => {
      const meta = jsonEntry(entries, `objects/${sid}.json`);
      const key = Object.keys(entries).find((k) => k.startsWith(`objects/${sid}.`) && !k.endsWith(".json"));
      if (!key) return null;
      return { bytes: entries[key], mime: meta?.contentType || sniffImage(entries[key]) };
    };
    const mediaId = (ref) => {
      if (!ref) return null;
      const id = String(ref.id || ref.mediaId || ref);
      const m = media.get(id);
      const obj = storage(m?.mediaId || ref.mediaId || id);
      if (!obj) {
        stats.missingMedia++;
        return null;
      }
      const out = b.media({ bytes: obj.bytes, mime: obj.mime || m?.mtype || ref.mtype, name: m?.name || ref.name || "Image", w: m?.width ?? ref.width, h: m?.height ?? ref.height });
      if (out) stats.images++;
      return out;
    };
    const components = new Map(); // component id → component json
    for (const k of Object.keys(entries)) if (k.startsWith(`${dir}components/`) && k.endsWith(".json")) {
      const c = jsonEntry(entries, k);
      if (isObj(c) && c.id) components.set(String(c.id), c);
    }
    // pages
    const pages = [];
    for (const k of Object.keys(entries)) {
      const m = new RegExp(`^${escapeRe(dir)}pages/([^/]+)\\.json$`).exec(k);
      if (!m) continue;
      const p = jsonEntry(entries, k);
      if (!isObj(p)) continue;
      const shapes = new Map();
      const sdir = `${dir}pages/${m[1]}/`;
      for (const sk of Object.keys(entries)) {
        if (!sk.startsWith(sdir) || !sk.endsWith(".json")) continue;
        const sh = jsonEntry(entries, sk);
        if (isObj(sh) && sh.id) shapes.set(String(sh.id), sh);
      }
      if (isObj(p.objects)) for (const [id, sh] of Object.entries(p.objects)) if (isObj(sh)) shapes.set(String(sh.id || id), sh);
      pages.push({ id: String(p.id || m[1]), name: String(p.name || "Page"), index: num(p.index, pages.length), background: p.background || p.options?.background || null, shapes });
    }
    pages.sort((a, c) => a.index - c.index);
    if (!pages.length) throw new ImportError("The Penpot export has no pages that could be read.", "format");

    // main components: every shape that is a component's main instance becomes a Proto component
    const compNode = new Map(); // component id → proto id
    const mainShape = new Map(); // component id → shape id
    for (const pg of pages) for (const sh of pg.shapes.values()) if (sh.componentId && (sh.mainInstance === true || [...components.values()].some((c) => String(c.mainInstanceId) === String(sh.id)))) {
      compNode.set(String(sh.componentId), b.id("n"));
      mainShape.set(String(sh.componentId), String(sh.id));
    }
    const byShape = new Map(); // shape id → proto id (overrides of copies refer to main shapes through shapeRef)
    const specByShape = new Map();

    const kidsOf = (pg, sh) => (Array.isArray(sh.shapes) ? sh.shapes : []).map((id) => pg.shapes.get(String(id))).filter(Boolean);

    function fillsOf(list) {
      const out = [];
      for (const f of Array.isArray(list) ? list : []) {
        if (!isObj(f) || f.hidden) continue;
        const op = num(f.fillOpacity, 1);
        if (f.fillImage) {
          const m = mediaId(f.fillImage);
          if (m) out.push({ type: "image", media: m, fit: f.fillImage.keepAspectRatio === false ? "fill" : "cover", ...(op < 1 ? { opacity: r2(op) } : {}) });
        } else if (isObj(f.fillColorGradient)) {
          const g = f.fillColorGradient;
          const stops = (g.stops || []).map((s) => {
            const c = cssColor(s.color) || { hex: "#000000", alpha: 1 };
            return { at: Math.max(0, Math.min(1, num(s.offset))), color: hexA(c.hex, c.alpha * num(s.opacity, 1)) };
          });
          if (stops.length < 2) continue;
          if (g.type === "radial") out.push({ type: "radial", center: [r2(num(g.startX, 0.5)), r2(num(g.startY, 0.5))], stops, ...(op < 1 ? { opacity: r2(op) } : {}) });
          else {
            const angle = r2(((Math.atan2(num(g.endX) - num(g.startX), -(num(g.endY, 1) - num(g.startY))) * 180) / Math.PI + 360) % 360);
            out.push({ type: "linear", angle, stops, ...(op < 1 ? { opacity: r2(op) } : {}) });
          }
        } else if (f.fillColor) {
          const c = cssColor(f.fillColor);
          if (c) out.push({ type: "solid", color: c.hex, ...(op * c.alpha < 1 ? { opacity: r2(op * c.alpha) } : {}) });
        }
      }
      return out;
    }
    const strokesOf = (list) =>
      (Array.isArray(list) ? list : [])
        .filter((s) => isObj(s) && !s.hidden && s.strokeStyle !== "none" && num(s.strokeWidth, 1) > 0)
        .map((s) => {
          const c = cssColor(s.strokeColor || "#000000") || { hex: "#000000", alpha: 1 };
          const w = r2(num(s.strokeWidth, 1));
          return { color: hexA(c.hex, c.alpha * num(s.strokeOpacity, 1)), w, align: s.strokeAlignment === "inner" ? "inside" : s.strokeAlignment === "outer" ? "outside" : "center", ...(s.strokeStyle === "dashed" || s.strokeStyle === "dotted" ? { dash: [w * 2, w * 2] } : {}) };
        });
    const effectsOf = (sh) => {
      const fx = [];
      for (const s of Array.isArray(sh.shadow) ? sh.shadow : []) {
        if (!isObj(s) || s.hidden) continue;
        const c = cssColor(s.color?.color || "#000000") || { hex: "#000000", alpha: 1 };
        fx.push({ type: "shadow", x: r2(num(s.offsetX)), y: r2(num(s.offsetY)), blur: r2(Math.max(0, num(s.blur))), spread: r2(num(s.spread)), color: hexA(c.hex, c.alpha * num(s.color?.opacity, 1)), ...(s.style === "inner-shadow" ? { inset: true } : {}) });
      }
      if (isObj(sh.blur) && !sh.blur.hidden && num(sh.blur.value) > 0) fx.push({ type: "blur", radius: r2(num(sh.blur.value)) });
      return fx;
    };
    const radiusOf = (sh) => {
      const r = [sh.r1, sh.r2, sh.r3, sh.r4].map((x) => num(x, num(sh.rx, 0)));
      if (r.every((x) => x === r[0])) return r[0] > 0 ? r2(r[0]) : null;
      return r.map(r2);
    };
    const JUSTIFY = { start: "start", center: "center", end: "end", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly", stretch: "start" };
    const ALIGN = { start: "start", center: "center", end: "end", stretch: "stretch", baseline: "baseline" };
    const track = (t) => {
      const v = num(t?.value, 1);
      if (t?.type === "fixed") return { px: r2(v) };
      if (t?.type === "flex") return { fr: r2(v || 1) };
      if (t?.type === "percent") return { minmax: [0, { fr: r2(v / 100 || 1) }] };
      return { auto: true };
    };
    const layoutOf = (sh) => {
      const pad = isObj(sh.layoutPadding) ? [sh.layoutPadding.p1, sh.layoutPadding.p2, sh.layoutPadding.p3, sh.layoutPadding.p4].map((x) => r2(num(x))) : [0, 0, 0, 0];
      const gap = isObj(sh.layoutGap) ? sh.layoutGap : {};
      if (sh.layout === "flex") {
        stats.layouts++;
        const dir = String(sh.layoutFlexDir || "row");
        const row = dir.startsWith("row");
        const main = row ? num(gap.columnGap) : num(gap.rowGap);
        const cross = row ? num(gap.rowGap) : num(gap.columnGap);
        const wrap = sh.layoutWrapType === "wrap";
        return { type: "flex", dir: row ? "row" : "column", ...(wrap ? { wrap: true, rowGap: r2(cross) } : {}), gap: r2(main), pad, align: ALIGN[sh.layoutAlignItems] || "start", justify: JUSTIFY[sh.layoutJustifyContent] || "start", ...(dir.endsWith("reverse") ? { _reverse: true } : {}) };
      }
      if (sh.layout === "grid") {
        stats.layouts++;
        const cols = (Array.isArray(sh.layoutGridColumns) ? sh.layoutGridColumns : []).map(track);
        const rows = (Array.isArray(sh.layoutGridRows) ? sh.layoutGridRows : []).map(track);
        return { type: "grid", gap: r2(num(gap.columnGap)), rowGap: r2(num(gap.rowGap)), pad, align: ALIGN[sh.layoutAlignItems] || "start", justify: JUSTIFY[sh.layoutJustifyItems] || "start", grid: { cols: cols.length ? cols : [{ fr: 1 }], rows, autoFlow: sh.layoutGridDir === "column" ? "column" : "row" } };
      }
      return null;
    };
    const cellOf = (parent, sh) => {
      const cells = isObj(parent.layoutGridCells) ? Object.values(parent.layoutGridCells) : [];
      const c = cells.find((x) => Array.isArray(x?.shapes) && x.shapes.map(String).includes(String(sh.id)));
      if (!c || c.positionType === "auto") return null;
      return { col: Math.max(1, num(c.column, 1)), row: Math.max(1, num(c.row, 1)), ...(num(c.columnSpan, 1) > 1 ? { colSpan: num(c.columnSpan) } : {}), ...(num(c.rowSpan, 1) > 1 ? { rowSpan: num(c.rowSpan) } : {}) };
    };

    const textOf = (sh) => {
      const runs = [];
      const paras = [];
      const walk = (n, para) => {
        if (!isObj(n)) return;
        if (n.type === "paragraph") {
          paras.push(n);
          (n.children || []).forEach((c) => walk(c, n));
          return;
        }
        if (typeof n.text === "string" && !n.type) runs.push({ leaf: n, para });
        (n.children || []).forEach((c) => walk(c, para));
      };
      walk(sh.content, null);
      return { runs, paras };
    };
    const leafStyle = (l, para) => {
      const fill = Array.isArray(l.fills) && l.fills[0] ? l.fills[0] : { fillColor: l.fillColor, fillOpacity: l.fillOpacity };
      const c = cssColor(fill.fillColor || "#000000") || { hex: "#000000", alpha: 1 };
      const s = {
        font: String(l.fontFamily || para?.fontFamily || "Inter").replace(/^sourcesanspro$/i, "Source Sans Pro"),
        size: r2(Math.max(0.5, num(l.fontSize ?? para?.fontSize, 14))),
        weight: Math.max(1, Math.min(1000, num(l.fontWeight ?? para?.fontWeight, 400))),
        color: hexA(c.hex, c.alpha * num(fill.fillOpacity, 1)),
      };
      if (String(l.fontStyle || "").includes("italic")) s.italic = true;
      const deco = l.textDecoration || para?.textDecoration;
      if (deco === "underline") s.decoration = "underline";
      else if (deco === "line-through") s.decoration = "strike";
      const tt = l.textTransform || para?.textTransform;
      if (tt === "uppercase") s.case = "upper";
      else if (tt === "lowercase") s.case = "lower";
      else if (tt === "capitalize") s.case = "title";
      const ls = num(l.letterSpacing ?? para?.letterSpacing, 0);
      if (ls) s.tracking = r2(ls);
      return s;
    };

    const pathD = (content) => {
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) return "";
      const f = (v) => r2(num(v));
      return content
        .map((seg) => {
          const p = seg?.params || {};
          switch (seg?.command) {
            case "move-to":
              return `M${f(p.x)} ${f(p.y)}`;
            case "line-to":
              return `L${f(p.x)} ${f(p.y)}`;
            case "curve-to":
              return `C${f(p.c1x)} ${f(p.c1y)} ${f(p.c2x)} ${f(p.c2y)} ${f(p.x)} ${f(p.y)}`;
            case "close-path":
              return "Z";
            default:
              return "";
          }
        })
        .join("");
    };
    /** Path data relative to the shape's box (Penpot stores page coordinates). */
    const relD = (d, dx, dy) => d.replace(/(-?\d*\.?\d+(?:e[-+]?\d+)?)[\s,]+(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi, (m, x, y) => `${r2(num(x) - dx)} ${r2(num(y) - dy)}`);

    function shape(pg, sh, parent, parentLayout, depth) {
      if (depth > 60) return null;
      const t = String(sh.type || "");
      const px0 = parent ? num(parent.x) : 0;
      const py0 = parent ? num(parent.y) : 0;
      const flow = !!parentLayout && !sh.layoutItemAbsolute;
      const f = { name: cleanName(sh.name, "Layer") };
      if (sh.hidden) f.visible = false;
      if (sh.blocked) f.locked = true;
      if (num(sh.opacity, 1) < 1) f.opacity = r2(num(sh.opacity, 1));
      if (sh.blendMode && sh.blendMode !== "normal" && /^[a-z-]+$/.test(sh.blendMode)) f.blend = sh.blendMode;
      if (num(sh.rotation)) f.rot = r2(num(sh.rotation));
      const fx = effectsOf(sh);
      if (fx.length) f.effects = fx;
      const sz = (axis) => {
        const mode = flow ? (axis === "w" ? sh.layoutItemHSizing : sh.layoutItemVSizing) : null;
        if (mode === "fill") return { mode: "fill" };
        if (mode === "auto") return { mode: "hug" };
        return { mode: "fixed", value: r2(Math.max(0, num(axis === "w" ? sh.width : sh.height))) };
      };
      if (flow) {
        f.pos = "flow";
        if (parentLayout.type === "grid") {
          const cell = cellOf(parent, sh);
          if (cell) f.cell = cell;
        }
      } else if (parent) {
        f.pos = "abs";
        f.x = r2(num(sh.x) - px0);
        f.y = r2(num(sh.y) - py0);
      }
      let s;
      const isCopy = !!sh.componentId && !!sh.componentRoot && mainShape.get(String(sh.componentId)) !== String(sh.id);
      if (isCopy && compNode.has(String(sh.componentId))) {
        stats.instances++;
        s = spec(b, "instance", { ...f, of: compNode.get(String(sh.componentId)), w: sz("w"), h: sz("h") });
        s._copy = { pg, sh };
        copies.push(s);
      } else if (t === "frame" || t === "group" || t === "bool" || t === "svg-raw") {
        if (t === "bool") stats.bool++;
        if (t === "svg-raw") stats.svgRaw++;
        const L = t === "frame" ? layoutOf(sh) : null;
        let kids = kidsOf(pg, sh);
        if (L?._reverse) kids = kids.reverse();
        if (L) delete L._reverse;
        const children = kids.map((k) => shape(pg, k, sh, L, depth + 1)).filter(Boolean);
        const asComp = mainShape.get(String(sh.componentId)) === String(sh.id);
        const fields = { ...f, w: sz("w"), h: sz("h"), layout: L || { type: "none" }, fills: fillsOf(sh.fills), strokes: strokesOf(sh.strokes), clip: t === "frame" ? sh.showContent !== true : false };
        const r = radiusOf(sh);
        if (r !== null && t === "frame") fields.radius = r;
        if (asComp) {
          stats.components++;
          b.count();
          s = { type: "component", id: compNode.get(String(sh.componentId)), fields, children };
        } else s = spec(b, "frame", fields, children);
        if (t === "frame" && !parent) stats.boards++;
      } else if (t === "rect") {
        const r = radiusOf(sh);
        s = spec(b, "rect", { ...f, w: sz("w"), h: sz("h"), fills: fillsOf(sh.fills), strokes: strokesOf(sh.strokes), ...(r !== null ? { radius: r } : {}) });
      } else if (t === "circle") s = spec(b, "ellipse", { ...f, w: sz("w"), h: sz("h"), fills: fillsOf(sh.fills), strokes: strokesOf(sh.strokes) });
      else if (t === "path") {
        const d = relD(pathD(sh.content), num(sh.x, num(sh.selrect?.x)), num(sh.y, num(sh.selrect?.y)));
        const w = num(sh.width, num(sh.selrect?.width));
        const h = num(sh.height, num(sh.selrect?.height));
        if (!flow && parent) {
          f.x = r2(num(sh.x, num(sh.selrect?.x)) - px0);
          f.y = r2(num(sh.y, num(sh.selrect?.y)) - py0);
        }
        s = spec(b, "vector", { ...f, w: { mode: "fixed", value: r2(w) }, h: { mode: "fixed", value: r2(h) }, d, rule: "nonzero", fills: fillsOf(sh.fills), strokes: strokesOf(sh.strokes).map((x) => ({ ...x, align: "center" })) });
      } else if (t === "text") {
        stats.text++;
        const { runs, paras } = textOf(sh);
        const style0 = runs.length ? leafStyle(runs[0].leaf, runs[0].para) : { font: "Inter", size: 14, weight: 400, color: "#000000" };
        const para0 = paras[0] || {};
        const lh = num(para0.lineHeight ?? runs[0]?.leaf?.lineHeight, 1.2);
        const align = para0.textAlign === "center" ? "center" : para0.textAlign === "right" ? "right" : para0.textAlign === "justify" ? "justify" : "left";
        const out = [];
        let lastPara = null;
        for (const { leaf, para } of runs) {
          const st = leafStyle(leaf, para);
          const rs = {};
          for (const k of Object.keys(st)) if (JSON.stringify(st[k]) !== JSON.stringify(style0[k])) rs[k] = st[k];
          const prefix = lastPara && para !== lastPara ? "\n" : "";
          lastPara = para;
          out.push({ t: prefix + leaf.text, s: rs });
        }
        const grow = sh.growType === "auto-width" ? "width" : sh.growType === "auto-height" ? "height" : "fixed";
        s = spec(b, "text", { ...f, w: grow === "width" ? { mode: "hug" } : sz("w"), h: grow === "fixed" ? sz("h") : { mode: "hug" }, text: { runs: out.length ? out : [{ t: "", s: {} }], style: { tracking: 0, ...style0, lineHeight: { pct: r2(lh * 100) }, align }, autoSize: grow, maxLines: null } });
      } else if (t === "image") {
        const m = mediaId(sh.metadata);
        s = spec(b, "image", { ...f, w: sz("w"), h: sz("h"), fills: m ? [{ type: "image", media: m, fit: "fill" }] : [{ type: "solid", color: "#e4e4e7" }], alt: "" });
      } else {
        report.dropped(`Shapes of type “${t || "unknown"}” were not imported.`);
        return null;
      }
      byShape.set(String(sh.id), s.id);
      specByShape.set(String(sh.id), s);
      return s;
    }
    const copies = [];

    for (const pg of pages) {
      stats.pages++;
      const pageId = pageMode === "new" ? b.page(pg.name) : null;
      if (pageId) created.push(pageId);
      const root = pg.shapes.get(ROOT) || [...pg.shapes.values()].find((s) => s.type === "frame" && (s.parentId == null || String(s.parentId) === String(s.id)));
      const top = root ? kidsOf(pg, root) : [...pg.shapes.values()].filter((s) => !s.parentId || String(s.parentId) === ROOT);
      const minX = top.length ? Math.min(...top.map((s) => num(s.x))) : 0;
      for (const sh of top) {
        const s = shape(pg, sh, null, null, 0);
        if (!s) continue;
        s.fields.x = r2(pageMode === "new" ? num(sh.x) : num(sh.x) - minX + offsetX);
        s.fields.y = r2(num(sh.y));
        delete s.fields.pos;
        if (!firstSize && s.fields.w?.mode === "fixed") firstSize = { w: s.fields.w.value, h: s.fields.h.value };
        pendingRoots.push({ s, page: pageId, comp: s.type === "component" });
      }
      if (pageMode !== "new" && top.length) offsetX += Math.max(...top.map((s) => num(s.x) - minX + num(s.width))) + 200;
    }

    // copies of components: their shapes refer to the main's shapes (shapeRef); differences become overrides
    for (const inst of copies) {
      const { pg, sh } = inst._copy;
      delete inst._copy;
      const over = {};
      const walk = (copyShape, path) => {
        for (const k of kidsOf(pg, copyShape)) {
          const ref = k.shapeRef ? String(k.shapeRef) : null;
          const mainId = ref ? byShape.get(ref) : null;
          if (!mainId) continue;
          const mainSpec = specByShape.get(ref);
          const p = [...path, mainId];
          const diff = {};
          if (k.type === "text" && mainSpec?.type === "text") {
            const txt = textOf(k).runs.map((r) => r.leaf.text).join("");
            const mainTxt = mainSpec.fields.text.runs.map((r) => r.t).join("").replace(/\n/g, "");
            if (txt !== mainTxt) diff.text = { ...mainSpec.fields.text, runs: [{ t: txt, s: {} }] };
          }
          const fills = fillsOf(k.fills);
          if (mainSpec && mainSpec.type !== "text" && JSON.stringify(fills) !== JSON.stringify(mainSpec.fields.fills || [])) diff.fills = fills;
          if (!!k.hidden !== (mainSpec?.fields.visible === false)) diff.visible = !k.hidden;
          if (Object.keys(diff).length) {
            over[p.join("/")] = diff;
            stats.overrides++;
          }
          walk(k, mainSpec?.type === "instance" ? p : path);
        }
      };
      walk(sh, []);
      if (Object.keys(over).length) inst.fields.over = over;
    }
  }
  const ordered = [...pendingRoots.filter((x) => x.comp), ...pendingRoots.filter((x) => !x.comp)];
  for (const { s, page } of ordered) {
    b.add(s, { page });
    roots.push(s.id);
  }
  if (Object.keys(entries).some((k) => /tokens\.json$/.test(k))) report.note("The file's design tokens were not imported here; import tokens.json with Variables ▸ Import (DTCG) or `ofini proto tokens import`.");
  report.kept(`${stats.pages} page${stats.pages === 1 ? "" : "s"}${pageMode === "new" ? "" : " side by side on this page"} with ${stats.boards} board${stats.boards === 1 ? "" : "s"} as frames.`);
  if (stats.components) report.kept(`${stats.components} component${stats.components === 1 ? "" : "s"} and ${stats.instances} cop${stats.instances === 1 ? "y" : "ies"} as instances (${stats.overrides} override${stats.overrides === 1 ? "" : "s"}).`);
  if (stats.layouts) report.kept(`${stats.layouts} flex and grid layout${stats.layouts === 1 ? "" : "s"} as auto layout.`);
  if (stats.text) report.kept(`${stats.text} text layer${stats.text === 1 ? "" : "s"} with their styled runs.`);
  if (stats.images) report.kept(`${stats.images} image${stats.images === 1 ? "" : "s"}.`);
  if (stats.bool) report.flattened(`${stats.bool} boolean group${stats.bool === 1 ? "" : "s"} became plain groups of their shapes.`);
  if (stats.svgRaw) report.flattened(`${stats.svgRaw} raw SVG element${stats.svgRaw === 1 ? "" : "s"} became groups.`);
  if (stats.missingMedia) report.dropped(`${stats.missingMedia} image${stats.missingMedia === 1 ? "" : "s"} could not be found in the export.`);
  report.note("Interactions, flows, guides, exports settings and shared colors and typographies are not imported.");
  report.note("The reader follows the published structure of Penpot's export format (version 3, Penpot 2.x) and was verified with synthetic files.");
  return { ops: b.ops(), roots, pages: created, report, size: firstSize || { w: 0, h: 0 } };
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
