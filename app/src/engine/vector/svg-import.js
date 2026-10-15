// SVG → OpenFini nodes. Handles shapes, paths, groups, transforms, inherited styles, CSS classes,
// linear/radial gradients, <use>, basic text and embedded images. Filters, masks and clip-paths are
// reported as warnings and skipped.
import { createNode, solid, defaultStroke } from "../../core/nodes.js";
import { svgDToPath, pathBBox, ellipsePath, rectPath, polylineSubpath } from "./path.js";
import { ident, mul, translate, scale, rotate, skew, invert, apply } from "../../core/math.js";
import { parseColor, rgbToHex } from "../../core/color.js";
import { createCanvas } from "../../core/doc.js";

let colorCtx = null;
/** Resolves any CSS color (named, hsl, rgb, hex) to {hex, alpha}; null if invalid / none. */
function resolveColor(str) {
  if (!str) return null;
  const s = str.trim();
  if (!s || s === "none" || s === "transparent") return null;
  if (s[0] === "#" || s.startsWith("rgb")) {
    const c = parseColor(s);
    return { hex: rgbToHex(c.r, c.g, c.b), alpha: c.a };
  }
  if (!colorCtx) colorCtx = createCanvas(1, 1).getContext("2d");
  colorCtx.fillStyle = "#010203";
  colorCtx.fillStyle = s;
  const v = colorCtx.fillStyle;
  if (v === "#010203" && s.toLowerCase() !== "#010203") {
    // invalid color (the sentinel did not change)
    return null;
  }
  const c = parseColor(v);
  return { hex: rgbToHex(c.r, c.g, c.b), alpha: c.a };
}

function parseTransform(str) {
  if (!str) return ident();
  let m = ident();
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(str))) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n;
    switch (t[1]) {
      case "matrix":
        n = a.length === 6 ? a : ident();
        break;
      case "translate":
        n = translate(a[0] || 0, a[1] || 0);
        break;
      case "scale":
        n = scale(a[0] ?? 1, a[1] ?? a[0] ?? 1);
        break;
      case "rotate": {
        const r = rotate(((a[0] || 0) * Math.PI) / 180);
        n = a.length >= 3 ? mul(translate(a[1], a[2]), mul(r, translate(-a[1], -a[2]))) : r;
        break;
      }
      case "skewX":
        n = skew(((a[0] || 0) * Math.PI) / 180, 0);
        break;
      case "skewY":
        n = skew(0, ((a[0] || 0) * Math.PI) / 180);
        break;
    }
    m = mul(m, n);
  }
  return m;
}

const num = (v, d = 0) => {
  if (v == null || v === "") return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

function parseLength(v, ref, d = 0) {
  if (v == null || v === "") return d;
  const s = String(v).trim();
  if (s.endsWith("%")) return (parseFloat(s) / 100) * ref;
  const n = parseFloat(s);
  const u = s.replace(/^[-+.\d]+(e[-+]?\d+)?/i, "");
  const f = { "": 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, rem: 16 }[u] ?? 1;
  return Number.isFinite(n) ? n * f : d;
}

/** Collects simple CSS rules from <style> elements: .class, #id, tag, and comma lists. */
function parseStyles(doc) {
  const rules = [];
  for (const st of doc.querySelectorAll("style")) {
    const css = st.textContent.replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const decl = {};
      for (const d of m[2].split(";")) {
        const i = d.indexOf(":");
        if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      }
      for (const sel of m[1].split(",")) rules.push({ sel: sel.trim(), decl });
    }
  }
  return rules;
}

const INHERITED = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "visibility"];

export function importSVG(text, { name = "SVG" } = {}) {
  const warnings = new Set();
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "image/svg+xml");
  const svg = xml.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== "svg" || xml.querySelector("parsererror")) throw new Error("This file is not a valid SVG.");
  const rules = parseStyles(xml);
  const byId = new Map();
  for (const el of xml.querySelectorAll("[id]")) byId.set(el.getAttribute("id"), el);
  const assets = [];

  // size
  let vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  const hasVB = vb.length === 4 && vb.every(Number.isFinite);
  const width = parseLength(svg.getAttribute("width"), hasVB ? vb[2] : 300, hasVB ? vb[2] : 300);
  const height = parseLength(svg.getAttribute("height"), hasVB ? vb[3] : 150, hasVB ? vb[3] : 150);
  const rootM = hasVB ? mul(scale(width / vb[2], height / vb[3]), translate(-vb[0], -vb[1])) : ident();

  function computedStyle(el, parent) {
    const st = { ...parent };
    for (const r of rules) {
      let match = false;
      if (r.sel === "*") match = true;
      else if (r.sel[0] === "." ) match = (el.getAttribute("class") || "").split(/\s+/).includes(r.sel.slice(1));
      else if (r.sel[0] === "#") match = el.getAttribute("id") === r.sel.slice(1);
      else match = el.nodeName === r.sel;
      if (match) Object.assign(st, r.decl);
    }
    for (const k of [...INHERITED, "opacity", "display", "mix-blend-mode", "stop-color", "stop-opacity"]) {
      const a = el.getAttribute(k);
      if (a != null) st[k] = a;
    }
    const inline = el.getAttribute("style");
    if (inline) {
      for (const d of inline.split(";")) {
        const i = d.indexOf(":");
        if (i > 0) st[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      }
    }
    // non-inherited properties reset per element
    if (!el.getAttribute("opacity") && !(inline || "").includes("opacity") && !rules.some((r) => r.decl.opacity)) delete st.opacity;
    return st;
  }

  // ---- gradients
  function gradientStops(g, seen = new Set()) {
    let stops = [...g.querySelectorAll(":scope > stop")];
    if (!stops.length) {
      const href = g.getAttribute("href") || g.getAttribute("xlink:href");
      const ref = href && byId.get(href.slice(1));
      if (ref && !seen.has(ref)) {
        seen.add(ref);
        return gradientStops(ref, seen);
      }
    }
    return stops.map((s) => {
      const st = computedStyle(s, {});
      const c = resolveColor(st["stop-color"] || "#000000") || { hex: "#000000", alpha: 1 };
      const off = String(s.getAttribute("offset") ?? "0");
      const o = off.endsWith("%") ? parseFloat(off) / 100 : parseFloat(off);
      return { o: Math.max(0, Math.min(1, Number.isFinite(o) ? o : 0)), color: c.hex, alpha: c.alpha * num(st["stop-opacity"], 1) };
    });
  }
  function attrWithHref(g, name, seen = new Set()) {
    if (g.hasAttribute(name)) return g.getAttribute(name);
    const href = g.getAttribute("href") || g.getAttribute("xlink:href");
    const ref = href && byId.get(href.slice(1));
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      return attrWithHref(ref, name, seen);
    }
    return null;
  }

  function paintFor(value, opacity, bbox) {
    if (!value) return null;
    const v = value.trim();
    if (v === "none") return null;
    const m = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/.exec(v);
    if (m) {
      const g = byId.get(m[1]);
      if (g && /gradient/i.test(g.nodeName)) {
        const stops = gradientStops(g);
        if (!stops.length) return null;
        if (stops.length === 1) return solid(stops[0].color, stops[0].alpha * opacity);
        const units = attrWithHref(g, "gradientUnits") || "objectBoundingBox";
        const gt = parseTransform(attrWithHref(g, "gradientTransform"));
        const toUnit = (x, y) => {
          if (units === "userSpaceOnUse") {
            const [tx, ty] = apply(gt, x, y);
            return [(tx - bbox.x) / (bbox.w || 1), (ty - bbox.y) / (bbox.h || 1)];
          }
          const [tx, ty] = apply(gt, x, y);
          return [tx, ty];
        };
        const pct = (s, ref) => {
          if (s == null) return null;
          return String(s).endsWith("%") ? (parseFloat(s) / 100) * (units === "userSpaceOnUse" ? ref : 1) : parseFloat(s);
        };
        const sw = units === "userSpaceOnUse" ? bbox.w : 1;
        const sh = units === "userSpaceOnUse" ? bbox.h : 1;
        if (/linear/i.test(g.nodeName)) {
          const x1 = pct(attrWithHref(g, "x1"), sw) ?? 0;
          const y1 = pct(attrWithHref(g, "y1"), sh) ?? 0;
          const x2 = pct(attrWithHref(g, "x2"), sw) ?? (units === "userSpaceOnUse" ? bbox.w : 1);
          const y2 = pct(attrWithHref(g, "y2"), sh) ?? 0;
          const [ux0, uy0] = toUnit(x1, y1);
          const [ux1, uy1] = toUnit(x2, y2);
          return { type: "linear", x0: ux0, y0: uy0, x1: ux1, y1: uy1, stops: stops.map((s) => ({ ...s, alpha: s.alpha * opacity })) };
        }
        const cx = pct(attrWithHref(g, "cx"), sw) ?? (units === "userSpaceOnUse" ? bbox.x + bbox.w / 2 : 0.5);
        const cy = pct(attrWithHref(g, "cy"), sh) ?? (units === "userSpaceOnUse" ? bbox.y + bbox.h / 2 : 0.5);
        const r = pct(attrWithHref(g, "r"), Math.hypot(sw, sh) / Math.SQRT2) ?? (units === "userSpaceOnUse" ? Math.max(bbox.w, bbox.h) / 2 : 0.5);
        const [ucx, ucy] = toUnit(cx, cy);
        const R = units === "userSpaceOnUse" ? r / (Math.max(bbox.w, bbox.h) || 1) : r;
        return { type: "radial", cx: ucx, cy: ucy, r: R, fx: ucx, fy: ucy, stops: stops.map((s) => ({ ...s, alpha: s.alpha * opacity })) };
      }
      const fallback = m[2] ? resolveColor(m[2]) : null;
      warnings.add("A pattern or unsupported paint server was replaced by a solid color.");
      return fallback ? solid(fallback.hex, fallback.alpha * opacity) : solid("#808080", opacity);
    }
    if (v === "currentColor") return solid("#000000", opacity);
    const c = resolveColor(v);
    return c ? solid(c.hex, c.alpha * opacity) : null;
  }

  function applyPaint(node, st, bboxLocal) {
    const fillRaw = st.fill === undefined ? "#000000" : st.fill;
    node.fill = paintFor(fillRaw, num(st["fill-opacity"], 1), bboxLocal);
    node.rule = st["fill-rule"] === "evenodd" ? "evenodd" : "nonzero";
    const sw = parseLength(st["stroke-width"], 1, 1);
    const strokePaint = paintFor(st.stroke, num(st["stroke-opacity"], 1), bboxLocal);
    if (strokePaint && sw > 0) {
      const dash = (st["stroke-dasharray"] || "").split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);
      node.stroke = {
        ...defaultStroke("#000000", sw),
        fill: strokePaint,
        width: sw,
        cap: ["round", "square"].includes(st["stroke-linecap"]) ? st["stroke-linecap"] : "butt",
        join: ["round", "bevel"].includes(st["stroke-linejoin"]) ? st["stroke-linejoin"] : "miter",
        miterLimit: num(st["stroke-miterlimit"], 4),
        dash: dash.length && dash.some((d) => d > 0) ? dash : null,
        dashOffset: num(st["stroke-dashoffset"], 0),
      };
    } else node.stroke = null;
    const op = num(st.opacity, 1);
    if (op < 1) node.opacity = op;
    const bm = st["mix-blend-mode"];
    if (bm && bm !== "normal") node.blend = bm;
  }

  function pointsPath(str, closed) {
    const n = (str || "").split(/[\s,]+/).filter(Boolean).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
    return pts.length ? { subpaths: [polylineSubpath(pts, closed)] } : null;
  }

  function convert(el, parentStyle, parentM) {
    const tag = el.nodeName.toLowerCase().replace(/^svg:/, "");
    if (["defs", "style", "title", "desc", "metadata", "lineargradient", "radialgradient", "clippath", "mask", "pattern", "marker", "symbol", "filter"].includes(tag)) return null;
    const st = computedStyle(el, parentStyle);
    if (st.display === "none") return null;
    if (el.hasAttribute("filter")) warnings.add("Filters in the SVG were ignored.");
    if (el.hasAttribute("clip-path")) warnings.add("Clip paths in the SVG were ignored.");
    if (el.hasAttribute("mask")) warnings.add("Masks in the SVG were ignored.");
    const m = parseTransform(el.getAttribute("transform"));
    let node = null;
    const name = el.getAttribute("id") || undefined;
    switch (tag) {
      case "g":
      case "a":
      case "switch": {
        node = createNode("group", { m });
        for (const c of el.children) {
          const k = convert(c, st, mul(parentM, m));
          if (k) node.children.push(k);
          if (tag === "switch" && k) break;
        }
        if (!node.children.length) return null;
        const op = num(st.opacity, 1);
        if (op < 1) node.opacity = op;
        const bm = st["mix-blend-mode"];
        if (bm && bm !== "normal") node.blend = bm;
        break;
      }
      case "rect": {
        const x = parseLength(el.getAttribute("x"), width);
        const y = parseLength(el.getAttribute("y"), height);
        const w = parseLength(el.getAttribute("width"), width);
        const h = parseLength(el.getAttribute("height"), height);
        if (!(w > 0 && h > 0)) return null;
        let rx = parseLength(el.getAttribute("rx"), width, NaN);
        let ry = parseLength(el.getAttribute("ry"), height, NaN);
        if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
        if (Number.isNaN(ry)) ry = rx;
        if (Math.abs(rx - ry) < 1e-6) {
          node = createNode("rect", { w, h, r: [rx, rx, rx, rx], m: mul(m, translate(x, y)) });
        } else {
          node = createNode("path", { path: rectPath(w, h, Math.min(rx, ry)), m: mul(m, translate(x, y)) });
        }
        applyPaint(node, st, { x: 0, y: 0, w, h });
        break;
      }
      case "circle":
      case "ellipse": {
        const cx = parseLength(el.getAttribute("cx"), width);
        const cy = parseLength(el.getAttribute("cy"), height);
        const rx = tag === "circle" ? parseLength(el.getAttribute("r"), Math.hypot(width, height) / Math.SQRT2) : parseLength(el.getAttribute("rx"), width);
        const ry = tag === "circle" ? rx : parseLength(el.getAttribute("ry"), height);
        if (!(rx > 0 && ry > 0)) return null;
        node = createNode("ellipse", { w: rx * 2, h: ry * 2, m: mul(m, translate(cx - rx, cy - ry)) });
        applyPaint(node, st, { x: 0, y: 0, w: rx * 2, h: ry * 2 });
        break;
      }
      case "line": {
        const p = { subpaths: [polylineSubpath([[num(el.getAttribute("x1")), num(el.getAttribute("y1"))], [num(el.getAttribute("x2")), num(el.getAttribute("y2"))]], false)] };
        node = createNode("path", { path: p, m });
        applyPaint(node, { ...st, fill: "none" }, pathBBox(p) || { x: 0, y: 0, w: 1, h: 1 });
        break;
      }
      case "polyline":
      case "polygon": {
        const p = pointsPath(el.getAttribute("points"), tag === "polygon");
        if (!p) return null;
        node = createNode("path", { path: p, m });
        applyPaint(node, tag === "polyline" ? st : st, pathBBox(p) || { x: 0, y: 0, w: 1, h: 1 });
        break;
      }
      case "path": {
        const p = svgDToPath(el.getAttribute("d") || "");
        if (!p.subpaths.length) return null;
        node = createNode("path", { path: p, m });
        applyPaint(node, st, pathBBox(p) || { x: 0, y: 0, w: 1, h: 1 });
        break;
      }
      case "image": {
        const href = el.getAttribute("href") || el.getAttribute("xlink:href") || "";
        const x = parseLength(el.getAttribute("x"), width);
        const y = parseLength(el.getAttribute("y"), height);
        const w = parseLength(el.getAttribute("width"), width);
        const h = parseLength(el.getAttribute("height"), height);
        if (!href.startsWith("data:") || !(w > 0 && h > 0)) {
          warnings.add("External or empty images were skipped.");
          return null;
        }
        node = createNode("image", { w, h, m: mul(m, translate(x, y)), name: "Image" });
        node._dataUrl = href;
        assets.push(node);
        break;
      }
      case "text": {
        const x = parseLength(el.getAttribute("x"), width);
        const y = parseLength(el.getAttribute("y"), height);
        const content = el.textContent.replace(/\s+/g, " ").trim();
        if (!content) return null;
        const size = parseLength(st["font-size"], 16, 16);
        const family = (st["font-family"] || "Inter").split(",")[0].replace(/["']/g, "").trim();
        const anchor = st["text-anchor"] || "start";
        node = createNode("text", { m: mul(m, translate(x, y - size)), name: content.slice(0, 24) });
        node._svgText = { content, size, family, weight: /bold|[6-9]00/.test(st["font-weight"] || "") ? 700 : 400, italic: st["font-style"] === "italic", anchor };
        const fill = paintFor(st.fill === undefined ? "#000000" : st.fill, num(st["fill-opacity"], 1), { x: 0, y: 0, w: 1, h: 1 });
        node.fill = fill && fill.type === "solid" ? fill : solid("#000000");
        break;
      }
      case "use": {
        const href = el.getAttribute("href") || el.getAttribute("xlink:href");
        const ref = href && byId.get(href.slice(1));
        if (!ref) return null;
        const x = parseLength(el.getAttribute("x"), width);
        const y = parseLength(el.getAttribute("y"), height);
        const g = createNode("group", { m: mul(m, translate(x, y)), name: "Instance" });
        const inner = ref.nodeName.toLowerCase() === "symbol" ? [...ref.children] : [ref];
        for (const c of inner) {
          const k = convert(c, st, mul(parentM, g.m));
          if (k) g.children.push(k);
        }
        node = g.children.length ? g : null;
        break;
      }
      default:
        return null;
    }
    if (node && name && node.type !== "text") node.name = name.replace(/[-_]+/g, " ");
    return node;
  }

  const rootStyle = {};
  const top = [];
  for (const c of svg.children) {
    const k = convert(c, rootStyle, rootM);
    if (k) top.push(k);
  }
  const root = createNode("group", { name: name, m: rootM.slice() });
  root.children = top;
  return { root, width, height, warnings: [...warnings], pendingImages: assets, texts: collectText(top) };
}

function collectText(nodes) {
  const out = [];
  const visit = (n) => {
    if (n._svgText) out.push(n);
    n.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
}

export { ellipsePath, invert };
