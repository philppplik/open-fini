// Scene graph → display list compiler. Display lists (docs/engine-contracts.md §2) are cached per
// node, in document units, independent of zoom — so panning/zooming never rebuilds geometry.
import { shapeGeometry, visualBounds } from "../core/nodes.js";
import { pathToData, pathBBox } from "./vector/path.js";
import { parseColor, rgbToHex } from "../core/color.js";
import { mul, ident, rectUnion } from "../core/math.js";
import { layoutStory, createHyphenator } from "./layout/index.js";
import { measurer, fontState } from "../core/fonts.js";

/** Bump when something outside a node changes what it draws (an asset finishes decoding, ...). */
export const dlState = { version: 0 };

// ------------------------------------------------------------------ paints

const stopsOf = (stops) =>
  stops
    .map((s) => {
      const c = parseColor(s.color);
      return { o: s.o, color: rgbToHex(c.r, c.g, c.b), alpha: (s.alpha ?? 1) * c.a };
    })
    .sort((a, b) => a.o - b.o);

/** Fill → display-list Paint. Gradient coordinates are unit-bbox relative and resolved against `bbox`. */
export function paintFrom(fill, bbox) {
  if (!fill) return null;
  const b = bbox || { x: 0, y: 0, w: 1, h: 1 };
  switch (fill.type) {
    case "solid": {
      const c = parseColor(fill.color);
      return { type: "solid", color: rgbToHex(c.r, c.g, c.b), alpha: (fill.alpha ?? 1) * c.a };
    }
    case "linear":
      return {
        type: "linear",
        x0: b.x + fill.x0 * b.w, y0: b.y + fill.y0 * b.h,
        x1: b.x + fill.x1 * b.w, y1: b.y + fill.y1 * b.h,
        stops: stopsOf(fill.stops),
      };
    case "radial": {
      const R = Math.max(b.w, b.h);
      return {
        type: "radial",
        cx: b.x + fill.cx * b.w, cy: b.y + fill.cy * b.h, r: Math.max(0.0001, fill.r * R),
        fx: b.x + (fill.fx ?? fill.cx) * b.w, fy: b.y + (fill.fy ?? fill.cy) * b.h,
        stops: stopsOf(fill.stops),
      };
    }
    case "conic":
      return { type: "conic", cx: b.x + fill.cx * b.w, cy: b.y + fill.cy * b.h, angle: fill.angle || 0, stops: stopsOf(fill.stops) };
    default:
      return null;
  }
}

function strokeFrom(s, bbox, widthMul = 1) {
  if (!s || !(s.width > 0)) return null;
  const paint = paintFrom(s.fill || { type: "solid", color: "#000000" }, bbox);
  if (!paint) return null;
  return {
    paint,
    width: s.width * widthMul,
    cap: s.cap || "butt",
    join: s.join || "miter",
    miterLimit: s.miterLimit || 4,
    dash: s.dash && s.dash.length ? s.dash.slice() : null,
    dashOffset: s.dashOffset || 0,
  };
}

const pathItem = (d, rule, fill, stroke) => ({ t: "path", d, rule, fill, stroke, m: ident() });
const groupItem = (items, o = {}) => ({
  t: "group", items, m: o.m || ident(), opacity: o.opacity ?? 1, blend: o.blend || "normal",
  clip: o.clip || null, isolate: !!o.isolate, fx: o.fx || null, mask: o.mask || null, b: o.b || null,
});

// ------------------------------------------------------------------ node compilers

function shapeItems(node) {
  const geo = shapeGeometry(node);
  if (!geo || !geo.subpaths.length) return [];
  const d = pathToData(geo);
  const bbox = pathBBox(geo) || { x: 0, y: 0, w: 0, h: 0 };
  const rule = node.rule || "nonzero";
  const fill = paintFrom(node.fill, bbox);
  const st = node.stroke && node.stroke.width > 0 ? node.stroke : null;
  const align = st?.align || "center";
  const openOnly = geo.subpaths.every((s) => !s.closed);
  if (!st) return fill ? [pathItem(d, rule, fill, null)] : [];
  if (align === "center" || openOnly) {
    const stroke = strokeFrom(st, bbox);
    return fill || stroke ? [pathItem(d, rule, fill, stroke)] : [];
  }
  const items = [];
  if (fill) items.push(pathItem(d, rule, fill, null));
  const stroke = strokeFrom(st, bbox, 2);
  if (!stroke) return items;
  if (align === "inside") {
    items.push(groupItem([pathItem(d, rule, null, stroke)], { clip: { d, rule, m: ident() } }));
  } else {
    const pad = st.width * 4 + 8;
    const big = [["M", bbox.x - pad, bbox.y - pad], ["L", bbox.x + bbox.w + pad, bbox.y - pad], ["L", bbox.x + bbox.w + pad, bbox.y + bbox.h + pad], ["L", bbox.x - pad, bbox.y + bbox.h + pad], ["Z"]];
    items.push(groupItem([pathItem(d, rule, null, stroke)], { clip: { d: big.concat(d), rule: "evenodd", m: ident() } }));
  }
  return items;
}

function imageItems(node, ctx) {
  const asset = ctx.doc.assets[node.assetId];
  if (!asset) return [];
  const src = asset._bitmap;
  if (!src) {
    ctx.requestAsset?.(asset);
    return [];
  }
  const ref = asset._ref || (asset._ref = { id: asset.id, width: asset.w, height: asset.h, source: src, jpeg: asset.mime === "image/jpeg" ? asset.bytes : undefined });
  return [{ t: "image", img: ref, m: [node.w / asset.w, 0, 0, node.h / asset.h, 0, 0], smooth: node.smooth !== false }];
}

function pixelItems(node, ctx) {
  const canvas = ctx.doc.pixels.get(node.id);
  if (!canvas) return [];
  const ref = { id: node.id, width: canvas.width, height: canvas.height, source: canvas };
  return [{ t: "image", img: ref, m: [node.w / canvas.width, 0, 0, node.h / canvas.height, 0, 0], smooth: node.smooth !== false }];
}

// ------------------------------------------------------------------ text

// US English hyphenation, created lazily (the pattern tables are only parsed when a paragraph asks for them)
let hyphenator = null;
const hyphenate = (word) => (hyphenator || (hyphenator = createHyphenator()))(word);

const storyIds = new WeakMap();
let storyCounter = 0;
const idOf = (o) => {
  let v = storyIds.get(o);
  if (!v) storyIds.set(o, (v = ++storyCounter));
  return v;
};
const layoutCache = new Map();

/** Frame geometry handed to the layout engine for a text node. */
function frameSpec(node) {
  const artistic = node.w == null;
  return {
    x: 0, y: 0,
    w: artistic ? 1e7 : node.w,
    h: node.h == null ? 1e7 : node.h,
    columns: node.columns || 1,
    gutter: node.gutter ?? 12,
    insets: node.insets || { top: 0, right: 0, bottom: 0, left: 0 },
    verticalAlign: node.vAlign || "top",
    exclusions: node.wrap || undefined,
  };
}

/**
 * Lays out (and caches) the whole story a text node belongs to. Returns
 * `{result, frames:[nodes], index}` so editors and the DL builder share one layout.
 */
export function getStoryLayout(doc, node, pageNo = 1) {
  const entry = doc.stories[node.storyId];
  if (!entry) return null;
  const frames = node.linked ? doc.framesOfStory(node.storyId) : [node];
  const key = `${idOf(entry.story)}|${fontState.version}|${pageNo}|${frames.map((f) => `${f.id}:${f._rev | 0}:${f.w}x${f.h}:${f.fill?.color}`).join(",")}|${JSON.stringify(entry.defaults || null)}|${JSON.stringify(doc.styles).length}`;
  const cacheKey = `${node.storyId}|${pageNo}`;
  const hit = layoutCache.get(cacheKey);
  if (hit && hit.key === key) return { ...hit, index: frames.indexOf(node) };
  const defaults = entry.defaults || { char: {}, para: {} };
  const nodeColor = frames[0].fill?.type === "solid" ? frames[0].fill.color : "#000000";
  const baseChar = { fontFamily: "Inter", fontSize: 24, fontWeight: 400, fontStyle: "normal", color: nodeColor, ...(defaults.char || {}) };
  const opts = {
    measure: measurer.measure,
    metrics: measurer.metrics,
    styles: doc.styles,
    defaults: { char: baseChar, para: { align: "left", lineHeight: 1.25, ...(defaults.para || {}) } },
    hyphenate,
    fields: { pageNumber: String(pageNo), pageCount: String(doc.pages.length), date: new Date().toLocaleDateString("en-US") },
  };
  const specs = frames.map(frameSpec);
  let result = layoutStory(entry.story, specs, opts);
  const artistic = frames.length === 1 && frames[0].w == null;
  if (artistic) {
    let maxW = 0;
    for (const l of result.frames[0].lines) maxW = Math.max(maxW, l.x + l.width);
    const needsAlign = entry.story.paragraphs.some((p) => (p.attrs?.align || defaults.para?.align || "left") !== "left");
    if (needsAlign && maxW > 0) {
      specs[0].w = maxW;
      result = layoutStory(entry.story, specs, opts);
    }
    result.artisticWidth = maxW;
  }
  const out = { key, result, frames, specs };
  if (layoutCache.size > 400) layoutCache.delete(layoutCache.keys().next().value);
  layoutCache.set(cacheKey, out);
  return { ...out, index: frames.indexOf(node) };
}

function textItems(node, ctx) {
  const lay = getStoryLayout(ctx.doc, node, ctx.pageNo || 1);
  if (!lay || lay.index < 0) return [];
  const fr = lay.result.frames[lay.index];
  if (!fr) return [];
  const artistic = node.w == null;
  const w = artistic ? lay.result.artisticWidth || 0 : node.w;
  const h = artistic || node.h == null ? fr.usedHeight : node.h;
  node._bounds = { x: 0, y: 0, w, h };
  node._overflow = !!fr.overflow;
  const boundsForPaint = node._bounds;
  const nodePaint = paintFrom(node.fill, boundsForPaint);
  const strokeSpec = node.stroke && node.stroke.width > 0 ? strokeFrom(node.stroke, boundsForPaint) : null;
  const runs = [];
  for (const line of fr.lines) {
    for (const r of line.runs) {
      if (!r.text) continue;
      const own = r.color ? paintFrom({ type: "solid", color: r.color, alpha: node.fill?.alpha ?? 1 }, boundsForPaint) : null;
      const paint = nodePaint && nodePaint.type !== "solid" ? nodePaint : own || nodePaint;
      runs.push({
        text: r.text,
        x: r.x,
        y: line.baseline - (r.baselineShift || 0),
        width: r.width,
        font: { family: r.font.family, size: r.font.size, weight: r.font.weight, style: r.font.style },
        fill: paint,
        stroke: strokeSpec,
        letterSpacing: r.tracking ? (r.tracking / 1000) * r.font.size : 0,
        underline: !!r.underline,
        strike: !!r.strike,
      });
    }
    if (line.bullet && line.bullet.text) {
      const b = line.bullet;
      runs.push({
        text: b.text, x: b.x, y: line.baseline, width: b.width || 0,
        font: b.font, fill: paintFrom({ type: "solid", color: b.color || "#000000" }, boundsForPaint), stroke: null,
        letterSpacing: 0, underline: false, strike: false,
      });
    }
  }
  return runs.length ? [{ t: "text", runs, m: ident() }] : [];
}

// ------------------------------------------------------------------ main compiler

function place(items, m) {
  if (!items.length) return items;
  if (items.length === 1 && items[0].t !== "group") {
    items[0].m = mul(m, items[0].m);
    return items;
  }
  return [groupItem(items, { m: m.slice() })];
}

function clipPathFor(node) {
  if (node.type === "rect" || node.type === "ellipse" || node.type === "polygon" || node.type === "star" || node.type === "path") {
    const geo = shapeGeometry(node);
    return geo ? { d: pathToData(geo), rule: node.rule || "nonzero", m: ident() } : null;
  }
  const w = node.w ?? node._bounds?.w;
  const h = node.h ?? node._bounds?.h;
  if (w == null || h == null) return null;
  return { d: [["M", 0, 0], ["L", w, 0], ["L", w, h], ["L", 0, h], ["Z"]], rule: "nonzero", m: ident() };
}

/** Compiles one node to display-list items expressed in the node's PARENT space. */
export function nodeItems(node, ctx) {
  if (!node.visible) return [];
  // master-page content depends on the page it is drawn on (page-number fields): never cached
  if (ctx.nocache) return compileNode(node, ctx);
  const key = `${node._rev | 0}|${dlState.version}|${fontState.version}`;
  if (node._dl && node._dl.key === key) return node._dl.items;
  const items = compileNode(node, ctx);
  node._dl = { key, items };
  return items;
}

function childItems(node, ctx) {
  const out = [];
  for (const c of node.children || []) {
    const it = nodeItems(c, ctx);
    for (let i = 0; i < it.length; i++) out.push(it[i]);
  }
  return out;
}

function compileNode(node, ctx) {
  const hasFx = node.fx && node.fx.some((f) => f.enabled !== false);
  const maskItems = node.mask && node.mask.visible !== false ? nodeItems(node.mask, ctx) : null;

  if (node.type === "adjust") {
    return [{ t: "adjust", effect: node.effect, params: node.params || {}, opacity: node.opacity, blend: node.blend, mask: maskItems, m: node.m.slice() }];
  }

  let own = [];
  switch (node.type) {
    case "rect":
    case "ellipse":
    case "polygon":
    case "star":
    case "path":
      own = shapeItems(node);
      break;
    case "text":
      own = textItems(node, ctx);
      break;
    case "image":
      own = imageItems(node, ctx);
      break;
    case "pixel":
      own = pixelItems(node, ctx);
      break;
  }

  const kids = node.children && node.children.length ? childItems(node, ctx) : [];
  const isGroup = node.type === "group";
  // adjustments nested under a layer apply to that layer only: render layer + effects in isolation
  const adjustKid = !isGroup && !!node.children?.some((c) => c.type === "adjust" && c.visible);
  const complex = node.opacity < 1 || node.blend !== "normal" || hasFx || !!maskItems || adjustKid;

  let inner;
  if (isGroup) inner = kids;
  else if (kids.length) {
    if (adjustKid) inner = own.concat(kids);
    else {
      const clip = clipPathFor(node);
      inner = own.concat(clip ? [groupItem(kids, { clip })] : kids);
    }
  } else inner = own;

  if (!inner.length) return [];
  if (!complex) {
    if (isGroup) return [groupItem(inner, { m: node.m.slice(), b: visualBounds(node) })];
    return place(inner, node.m);
  }
  return [
    groupItem(inner, {
      m: node.m.slice(),
      opacity: node.opacity,
      blend: node.blend,
      isolate: true,
      fx: hasFx ? node.fx.filter((f) => f.enabled !== false) : null,
      mask: maskItems,
      b: visualBounds(node),
    }),
  ];
}

/** Display list of a page's content (without its background). Master page items render underneath. */
export function buildPageDL(doc, page, { master = true } = {}) {
  const pageNo = Math.max(1, doc.pages.indexOf(page) + 1);
  const ctx = { doc, page, pageNo, requestAsset: doc.requestAsset };
  const items = [];
  if (master && page.masterId) {
    const m = doc.masters.find((x) => x.id === page.masterId);
    if (m) for (const c of m.root.children) for (const it of nodeItems(c, { ...ctx, page: m, nocache: true })) items.push(it);
  }
  for (const c of page.root.children) for (const it of nodeItems(c, ctx)) items.push(it);
  return { width: page.w, height: page.h, items };
}

/** Union of visual bounds of all visible top-level content — used for "zoom to content" and export. */
export function contentBounds(root) {
  let b = null;
  for (const c of root.children) if (c.visible) b = rectUnion(b, visualBounds(c));
  return b;
}
