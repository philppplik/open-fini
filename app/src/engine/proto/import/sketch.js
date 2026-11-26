// Sketch (.sketch) → Proto (docs/concepts/proto-studio.md §11, task T8). Pure. The archive is read by the existing
// reader (engine/formats/sketch.js, written from Sketch's public file format reference) with `symbols: true`.
//
//   importSketch(bytes, { model, name?, random?, pages?: "new" | "current" }) → { ops, roots, pages, report, size }
//
// Mapping: every Sketch page becomes a Proto page ("current": everything lands on the target page side by side);
// artboards become frames (background, clipping); symbol masters become components (on their page, usually
// "Symbols"), symbol instances become instances of them with overrides: text (`_stringValue`), nested symbol swaps
// (`_symbolID`, an empty value hides the layer) and images (`_image`) map to `over` entries keyed by the path of
// source layer ids, the way Proto stores overrides. Stacks (Sketch's flex groups) become flex auto layout with gap,
// padding, alignment, wrapping and the children's fixed, fit and fill sizing; Smart Layout groups become flex
// layouts whose gap is guessed from the positions. Groups become frames without layout, rectangles, ovals and paths
// their Proto counterparts (paths as vectors), text layers keep one run per attribute range, bitmaps and image
// fills become media, shadows, inner shadows, layer blur and background blur become effects. Shared styles, text
// styles, color variables, exportable slices, prototyping links and boolean operations are reported.
import { readSketch } from "../../formats/sketch.js";
import { createBuilder, spec, ImportReport, safeUnzip, hexA, r2, num, cleanName, sniffImage } from "./common.js";

const FONT_SUFFIX = /[-_ ]?(?:Bold|Italic|Regular|Medium|Light|Semibold|Black|Heavy|Thin|ExtraLight|UltraLight|ExtraBold|Oblique|Book|Roman)$/i;
/** "Inter-SemiBoldItalic" → "Inter": style words come off the end one at a time (a bounded loop, no nested repetition). */
function family(ps) {
  let s = String(ps || "Inter");
  for (let i = 0; i < 8; i++) {
    const next = s.replace(FONT_SUFFIX, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "Inter";
}
const weightOf = (ps) => (/black|heavy/i.test(ps) ? 900 : /extrabold|ultrabold/i.test(ps) ? 800 : /semibold|demibold/i.test(ps) ? 600 : /bold/i.test(ps) ? 700 : /medium/i.test(ps) ? 500 : /extralight|ultralight/i.test(ps) ? 200 : /thin/i.test(ps) ? 100 : /light/i.test(ps) ? 300 : 400);

/**
 * @param {Uint8Array} bytes
 * @param {{ model: object, name?: string, random?: () => number, pages?: "new"|"current", report?: ImportReport }} o
 */
export function importSketch(bytes, { model, name = "Sketch", random, pages: pageMode = "new", report = null } = {}) {
  report ||= new ImportReport("Sketch", name);
  const sk = readSketch(bytes, { symbols: true, unzip: (b) => safeUnzip(b) });
  report.warnings(sk.warnings);
  const b = createBuilder(model, { random, report });
  const stats = { artboards: 0, components: 0, instances: 0, overrides: 0, skippedOverrides: 0, missing: 0, stacks: 0, text: 0, images: 0 };

  // symbol masters first: their ids are known before any instance refers to them
  const comp = new Map(); // symbolID → component id
  const byLayer = new Map(); // Sketch object id → Proto id
  const specOf = new Map(); // Proto id → layer spec (override values need the master's text style)
  for (const pg of sk.pages) for (const ab of pg.artboards) if (ab.symbolID) comp.set(ab.symbolID, b.id("n"));

  const imageMedia = (ref) => {
    const bytes = sk.images[ref] || sk.images[`${ref}.png`] || sk.images[`images/${ref}`];
    if (!bytes) return null;
    return b.media({ bytes, mime: sniffImage(bytes), name: ref.split("/").pop() });
  };

  const fillsOf = (list) => {
    const out = [];
    for (const f of list || []) {
      if (f.type === "solid") out.push({ type: "solid", color: hexA(f.color, f.alpha) });
      else if (f.type === "linear" || f.type === "radial") {
        const stops = f.stops.map((s) => ({ at: Math.max(0, Math.min(1, r2(s.o * 1000) / 1000)), color: hexA(s.color, s.alpha) }));
        if (f.type === "linear") {
          const angle = r2(((Math.atan2(f.to[0] - f.from[0], -(f.to[1] - f.from[1])) * 180) / Math.PI + 360) % 360);
          out.push({ type: "linear", angle, stops });
        } else out.push({ type: "radial", center: [r2(f.from[0]), r2(f.from[1])], stops });
      } else if (f.type === "image") {
        const media = imageMedia(f.imageRef);
        if (media) out.push({ type: "image", media, fit: f.fit === "tile" ? "tile" : f.fit === "fit" ? "contain" : f.fit === "stretch" ? "fill" : "cover", ...(f.alpha < 1 ? { opacity: r2(f.alpha) } : {}) });
        else stats.missing++;
      }
    }
    return out;
  };
  const strokesOf = (list) => (list || []).map((s) => ({ color: hexA(s.color, s.alpha), w: r2(s.width), align: s.position, ...(s.dash ? { dash: s.dash.slice(0, 16).map((d) => r2(Math.max(0, num(d)))) } : {}) }));
  const effectsOf = (it) => {
    const fx = [];
    for (const s of it.shadows || []) fx.push({ type: "shadow", x: r2(s.x), y: r2(s.y), blur: r2(s.blur), spread: r2(s.spread), color: hexA(s.color, s.alpha), ...(s.inset ? { inset: true } : {}) });
    if (it.blur?.kind === "layer") fx.push({ type: "blur", radius: r2(it.blur.radius) });
    else if (it.blur?.kind === "background") fx.push({ type: "backgroundBlur", radius: r2(it.blur.radius) });
    else if (it.blur) report.dropped("Motion and zoom blurs were not imported.");
    return fx;
  };
  const common = (it) => ({
    name: cleanName(it.name, "Layer"),
    ...(it.visible === false ? { visible: false } : {}),
    ...(it.locked ? { locked: true } : {}),
    ...(it.opacity < 1 ? { opacity: r2(Math.max(0, it.opacity)) } : {}),
    ...(it.rotation ? { rot: r2(it.rotation) } : {}),
  });

  const layoutOf = (L, kids) => {
    if (!L) return null;
    if (L.kind === "stack") {
      stats.stacks++;
      return { type: "flex", dir: L.dir, ...(L.wrap ? { wrap: true, rowGap: r2(L.crossGap) } : {}), gap: r2(L.gap), pad: L.pad.map(r2), align: L.align, justify: L.justify };
    }
    // Smart Layout: the children's spacing along the axis (the most common one)
    const row = L.dir === "row";
    const sorted = [...kids].sort((a, b) => (row ? a.x - b.x : a.y - b.y));
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(r2(row ? sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width) : sorted[i].y - (sorted[i - 1].y + sorted[i - 1].height)));
    const gap = Math.max(0, gaps.sort((a, b) => gaps.filter((x) => x === b).length - gaps.filter((x) => x === a).length)[0] || 0);
    stats.stacks++;
    return { type: "flex", dir: L.dir, gap, pad: L.pad.map(r2), align: L.anchor, justify: "start", _order: sorted };
  };

  /** One reader item → a layer spec. `flow`: the parent lays it out (flex). */
  function item(it, flow) {
    const f = common(it);
    const fixed = (v) => ({ mode: "fixed", value: r2(Math.max(0, v)) });
    const size = (axis) => {
      const s = flow ? it.sizing?.[axis === "w" ? "h" : "v"] : null;
      if (s === "fill") return { mode: "fill" };
      if (s === "hug") return { mode: "hug" };
      return fixed(axis === "w" ? it.width : it.height);
    };
    if (flow && !it.absolute) f.pos = "flow";
    else {
      f.pos = "abs";
      f.x = r2(it.x);
      f.y = r2(it.y);
    }
    const fx = effectsOf(it);
    if (fx.length) f.effects = fx;
    let s;
    switch (it.kind) {
      case "group": {
        const L = layoutOf(it.layout, it.children);
        const order = L?._order || it.children;
        if (L) delete L._order;
        const children = order.map((c) => item(c, !!L));
        s = spec(b, "frame", { ...f, w: size("w"), h: size("h"), layout: L || { type: "none" }, fills: fillsOf(it.fills), strokes: strokesOf(it.borders), clip: !!it.clip }, children);
        if (L && it.sizing?.h === "hug") s.fields.w = { mode: "hug" };
        break;
      }
      case "rect":
        s = spec(b, "rect", { ...f, w: size("w"), h: size("h"), fills: fillsOf(it.fills), strokes: strokesOf(it.borders), ...(it.radius ? { radius: r2(it.radius) } : {}) });
        break;
      case "ellipse":
        s = spec(b, "ellipse", { ...f, w: size("w"), h: size("h"), fills: fillsOf(it.fills), strokes: strokesOf(it.borders) });
        break;
      case "path":
        s = spec(b, "vector", { ...f, w: fixed(it.width), h: fixed(it.height), d: it.d, rule: "nonzero", fills: fillsOf(it.fills), strokes: strokesOf(it.borders).map((x) => ({ ...x, align: "center" })) });
        break;
      case "text": {
        stats.text++;
        const runs = it.runs?.length ? it.runs : [{ text: it.text.string, font: it.text.fontPostScript, size: it.text.fontSize, color: it.text.color, alpha: 1, kerning: 0 }];
        const r0 = runs[0];
        const style = { font: family(r0.font), size: r2(Math.max(0.5, r0.size)), weight: weightOf(r0.font), lineHeight: r0.lineHeight ? { px: r2(r0.lineHeight) } : "auto", tracking: r2(r0.kerning || 0), align: it.text.align, color: hexA(r0.color, r0.alpha) };
        if (/italic|oblique/i.test(r0.font)) style.italic = true;
        if (r0.underline) style.decoration = "underline";
        else if (r0.strike) style.decoration = "strike";
        const out = runs.map((r) => {
          const rs = {};
          const fam = family(r.font);
          if (fam !== style.font) rs.font = fam;
          if (r2(r.size) !== style.size) rs.size = r2(Math.max(0.5, r.size));
          if (weightOf(r.font) !== style.weight) rs.weight = weightOf(r.font);
          if (/italic|oblique/i.test(r.font) !== !!style.italic) rs.italic = /italic|oblique/i.test(r.font);
          const c = hexA(r.color, r.alpha);
          if (c !== style.color) rs.color = c;
          return { t: r.text, s: rs };
        }).filter((r) => r.t);
        const fixedW = it.text.fixedWidth;
        s = spec(b, "text", { ...f, w: fixedW ? size("w") : { mode: "hug" }, h: { mode: "hug" }, text: { runs: out.length ? out : [{ t: "", s: {} }], style, autoSize: fixedW ? "height" : "width", maxLines: null } });
        break;
      }
      case "image": {
        const media = imageMedia(it.imageRef);
        if (media) stats.images++;
        else stats.missing++;
        s = spec(b, "image", { ...f, w: size("w"), h: size("h"), fills: media ? [{ type: "image", media, fit: "fill" }] : [{ type: "solid", color: "#e4e4e7" }], alt: "" });
        break;
      }
      case "instance": {
        const of = comp.get(it.symbolID);
        if (!of) {
          stats.missing++;
          s = spec(b, "frame", { ...f, w: size("w"), h: size("h"), layout: { type: "none" }, fills: [{ type: "solid", color: "#e4e4e7" }], clip: true });
          s.fields.name = cleanName(`${it.name} (missing symbol)`);
          break;
        }
        stats.instances++;
        s = spec(b, "instance", { ...f, of, w: size("w"), h: size("h") });
        s.overrides = it.overrides;
        pendingOverrides.push(s);
        break;
      }
      default:
        return null;
    }
    if (it.id) byLayer.set(it.id, s.id);
    specOf.set(s.id, s);
    return s;
  }
  const pendingOverrides = [];

  const frameOf = (ab, x, y, asComponent) => {
    const L = layoutOf(ab.layout, ab.items);
    const order = L?._order || ab.items;
    if (L) delete L._order;
    const children = order.map((c) => item(c, !!L)).filter(Boolean);
    const fields = {
      name: cleanName(ab.name, asComponent ? "Component" : "Frame"),
      x: r2(x),
      y: r2(y),
      w: { mode: "fixed", value: r2(ab.width) },
      h: { mode: "fixed", value: r2(ab.height) },
      layout: L || { type: "none" },
      fills: ab.background ? [{ type: "solid", color: hexA(ab.background, ab.backgroundAlpha ?? 1) }] : fillsOf(ab.fills),
      strokes: strokesOf(ab.borders),
      clip: true,
      ...(ab.visible === false ? { visible: false } : {}),
    };
    const fx = effectsOf(ab);
    if (fx.length) fields.effects = fx;
    const t = { type: asComponent ? "component" : "frame", id: asComponent ? comp.get(ab.symbolID) : b.id("n"), fields, children };
    b.count();
    if (ab.id) byLayer.set(ab.id, t.id);
    return t;
  };

  const roots = [];
  const created = [];
  const trees = [];
  let offsetX = 0;
  for (const pg of sk.pages) {
    const pageId = pageMode === "new" ? b.page(pg.name) : null;
    if (pageId) created.push(pageId);
    let minX = Infinity;
    for (const ab of pg.artboards) minX = Math.min(minX, ab.x);
    for (const ab of pg.artboards) {
      const asComp = !!ab.symbolID;
      const x = pageMode === "new" ? ab.x : ab.x - minX + offsetX;
      const t = frameOf(ab, x, ab.y, asComp);
      if (asComp) stats.components++;
      else stats.artboards++;
      trees.push({ t, page: pageId, comp: asComp });
    }
    if (pageMode !== "new") offsetX += Math.max(0, ...pg.artboards.map((ab) => ab.x - minX + ab.width)) + 200;
  }

  // overrides: "<id>/<id>_<property>" paths of Sketch object ids → "<id>/<id>" paths of Proto ids
  for (const s of pendingOverrides) {
    const over = {};
    for (const o of s.overrides || []) {
      const m = /^(.+)_(stringValue|symbolID|image|layerStyle|textStyle|fillColor|isVisible)$/.exec(o.name);
      if (!m) continue;
      const path = m[1].split("/").map((x) => byLayer.get(x));
      if (path.some((x) => !x)) {
        stats.skippedOverrides++;
        continue;
      }
      const key = path.join("/");
      const target = specOf.get(path.at(-1));
      if (m[2] === "stringValue" && target?.type === "text" && typeof o.value === "string") {
        over[key] = { ...(over[key] || {}), text: { ...target.fields.text, runs: [{ t: o.value, s: {} }] } };
        stats.overrides++;
      } else if (m[2] === "symbolID") {
        if (!o.value) over[key] = { ...(over[key] || {}), visible: false };
        else if (comp.get(String(o.value))) over[key] = { ...(over[key] || {}), of: comp.get(String(o.value)) };
        else {
          stats.skippedOverrides++;
          continue;
        }
        stats.overrides++;
      } else if (m[2] === "image" && o.value && typeof o.value === "object" && o.value._ref) {
        const media = imageMedia(o.value._ref);
        if (media) {
          over[key] = { ...(over[key] || {}), fills: [{ type: "image", media, fit: "fill" }] };
          stats.overrides++;
        } else stats.skippedOverrides++;
      } else if (m[2] === "isVisible") {
        over[key] = { ...(over[key] || {}), visible: !!o.value };
        stats.overrides++;
      } else stats.skippedOverrides++;
    }
    if (Object.keys(over).length) s.fields.over = over;
    delete s.overrides;
  }

  // components first (instances refer to them), then the other frames
  const ordered = [...trees.filter((x) => x.comp), ...trees.filter((x) => !x.comp)];
  for (const { t, page } of ordered) {
    b.add(t, { page });
    roots.push(t.id);
  }
  report.kept(`${stats.artboards} artboard${stats.artboards === 1 ? "" : "s"} as frames${pageMode === "new" ? `, ${created.length} page${created.length === 1 ? "" : "s"}` : ""}.`);
  if (stats.components) report.kept(`${stats.components} symbol${stats.components === 1 ? "" : "s"} as components and ${stats.instances} symbol instance${stats.instances === 1 ? "" : "s"} as instances (${stats.overrides} override${stats.overrides === 1 ? "" : "s"}).`);
  if (stats.stacks) report.kept(`${stats.stacks} stack${stats.stacks === 1 ? "" : "s"} and Smart Layout group${stats.stacks === 1 ? "" : "s"} as auto layout.`);
  if (stats.text) report.kept(`${stats.text} text layer${stats.text === 1 ? "" : "s"} with their styled runs.`);
  if (stats.images) report.kept(`${stats.images} bitmap${stats.images === 1 ? "" : "s"}.`);
  if (stats.skippedOverrides) report.dropped(`${stats.skippedOverrides} override${stats.skippedOverrides === 1 ? "" : "s"} (shared styles, colors, or layers that could not be found) were not imported.`);
  if (stats.missing) report.dropped(`${stats.missing} symbol${stats.missing === 1 ? "" : "s"} from libraries or image${stats.missing === 1 ? "" : "s"} could not be found; placeholders were used.`);
  report.note("Shared styles, color variables, prototyping links and boolean operations are not imported as such; their current look is.");
  report.note("The Sketch reader follows the public file format reference and was verified with synthetic files, not with files from every Sketch version.");
  const first = trees.find((x) => !x.comp)?.t || trees[0]?.t;
  return { ops: b.ops(), roots, pages: created, report, size: first ? { w: first.fields.w.value, h: first.fields.h.value } : { w: 0, h: 0 } };
}
