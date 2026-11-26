// SVG → Proto layers (docs/concepts/proto-studio.md §11, task T8). Pure: parses with engine/office/xml.js (no DOM, no
// external entities) and builds paths with engine/vector/path.js, so the app, the clipboard and the CLI share it.
//
//   importSvg(text, { model, name?, random? }) → { ops, roots, pages: [], report, size }
//
// Mapping: the document becomes one frame of the SVG's size (no layout, no fill). Groups (<g>, <a>, <switch>, <use>
// of a <symbol>) become frames without layout around their content. Axis-aligned rectangles and ellipses stay
// rectangle and ellipse layers (radius, fill and stroke editable); every other shape (paths, polygons, lines and
// rotated or skewed shapes) becomes a vector layer whose path data has every transform applied, relative to its own
// box. Text becomes text layers (the position follows the baseline approximately); data: images become image layers
// with their bytes as media. Fills: solid colors and linear and radial gradients (the gradient's first and last
// points define the angle); strokes are centered (SVG strokes straddle the outline). Filters, masks, clip paths,
// patterns, markers, external images and scripts are skipped and reported. The parser never fetches anything.
import { parseXml } from "../../office/xml.js";
import { svgDToPath, pathBBox, ellipsePath, rectPath, polylineSubpath, transformPath, pathToSvgD } from "../../vector/path.js";
import { ident, mul, translate, scale, rotate, skew, apply } from "../../../core/math.js";
import { createBuilder, spec, ImportReport, checkSize, cssColor, hexA, dataUrlBytes, r2, num, cleanName, matrixAngle } from "./common.js";

const SKIP = new Set(["defs", "style", "title", "desc", "metadata", "lineargradient", "radialgradient", "clippath", "mask", "pattern", "marker", "symbol", "filter", "script", "foreignobject", "animate", "animatetransform", "animatemotion", "set", "font", "font-face", "cursor", "view"]);
const INHERITED = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "visibility", "color", "letter-spacing", "text-decoration"];

const els = (el) => (el.children || []).filter((c) => typeof c !== "string");
const local = (el) => String(el.local || el.name || "").toLowerCase().replace(/^svg:/, "");
const textOf = (el) => (el.children || []).map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
// SVG inside HTML arrives with lower-case attribute names (viewbox), standalone SVG with the XML spelling (viewBox)
const attr = (el, k) => (own(el.attrs, k) ? el.attrs[k] : own(el.attrs, k.toLowerCase()) ? el.attrs[k.toLowerCase()] : null);

function parseTransform(str) {
  let m = ident();
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(str))) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n = ident();
    if (t[1] === "matrix" && a.length === 6 && a.every(Number.isFinite)) n = a;
    else if (t[1] === "translate") n = translate(a[0] || 0, a[1] || 0);
    else if (t[1] === "scale") n = scale(a[0] ?? 1, a[1] ?? a[0] ?? 1);
    else if (t[1] === "rotate") {
      const r = rotate(((a[0] || 0) * Math.PI) / 180);
      n = a.length >= 3 ? mul(translate(a[1], a[2]), mul(r, translate(-a[1], -a[2]))) : r;
    } else if (t[1] === "skewX") n = skew(((a[0] || 0) * Math.PI) / 180, 0);
    else if (t[1] === "skewY") n = skew(0, ((a[0] || 0) * Math.PI) / 180);
    m = mul(m, n);
  }
  return m;
}

function length(v, ref, d = 0, fontSize = 16) {
  if (v == null || v === "") return d;
  const s = String(v).trim();
  if (s.endsWith("%")) return (parseFloat(s) / 100) * ref;
  const n = parseFloat(s);
  const u = s.replace(/^[-+]?[\d.]+(e[-+]?\d+)?/i, "").toLowerCase();
  const f = { "": 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: fontSize, rem: 16, ex: fontSize / 2 }[u] ?? 1;
  return Number.isFinite(n) ? n * f : d;
}

function declarations(text) {
  const out = {};
  for (const d of String(text || "").split(";")) {
    const i = d.indexOf(":");
    if (i > 0) out[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).replace(/!important/i, "").trim();
  }
  return out;
}

/** Simple rules of <style> elements: tag, .class, #id, *, comma lists (others are reported). */
function styleRules(root, report) {
  const rules = [];
  const visit = (el) => {
    if (local(el) === "style") {
      const css = textOf(el).replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[^{;]+;/g, "");
      const re = /([^{}]+)\{([^}]*)\}/g;
      let m;
      while ((m = re.exec(css))) {
        const decl = declarations(m[2]);
        for (const sel of m[1].split(",").map((s) => s.trim())) {
          if (/^(\*|[a-zA-Z][\w-]*|\.[\w-]+|#[\w-]+)$/.test(sel)) rules.push({ sel, decl });
          else if (sel) report.note("Some CSS selectors in the SVG's style sheet are not supported; their styles were ignored.");
        }
      }
    }
    els(el).forEach(visit);
  };
  visit(root);
  return rules;
}

/**
 * Imports SVG markup as Proto layers.
 * @param {string} text
 * @param {{ model: object, name?: string, random?: () => number, report?: ImportReport, builder?: object, asFrame?: boolean }} o
 */
export function importSvg(text, { model, name = "SVG", random, report = null, builder = null } = {}) {
  text = String(text ?? "");
  checkSize(text.length, "svg");
  report ||= new ImportReport("SVG", name);
  const b = builder || createBuilder(model, { random, report });
  const tree = svgTree(text, b, report, name);
  b.add(tree.root, { page: null });
  report.kept(`${tree.stats.shapes} shape${tree.stats.shapes === 1 ? "" : "s"} as rectangle, ellipse and vector layers${tree.stats.groups ? `, ${tree.stats.groups} group${tree.stats.groups === 1 ? "" : "s"} as frames` : ""}.`);
  if (tree.stats.text) report.kept(`${tree.stats.text} text layer${tree.stats.text === 1 ? "" : "s"} (positions follow the baseline approximately).`);
  if (tree.stats.images) report.kept(`${tree.stats.images} embedded image${tree.stats.images === 1 ? "" : "s"}.`);
  return { ops: b.ops(), roots: [tree.root.id], pages: [], report, size: tree.size };
}

/**
 * The layer tree of an SVG document (used by importSvg and by the HTML importer for inline <svg>).
 * @returns {{ root: object, size: { w, h }, stats }}
 */
export function svgTree(text, b, report, name = "SVG") {
  const doc = parseXml(text, { maxDepth: 128, maxNodes: 200000 });
  const svg = findSvg(doc);
  if (!svg) throw new Error("This file is not a valid SVG (no <svg> element).");
  const rules = styleRules(svg, report);
  const byId = new Map();
  const index = (el) => {
    const id = attr(el, "id");
    if (id && !byId.has(id)) byId.set(id, el);
    els(el).forEach(index);
  };
  index(svg);
  const stats = { shapes: 0, groups: 0, text: 0, images: 0 };

  const vb = String(attr(svg, "viewBox") || "").split(/[\s,]+/).map(Number);
  const hasVB = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const width = Math.max(1, length(attr(svg, "width"), hasVB ? vb[2] : 300, hasVB ? vb[2] : 300));
  const height = Math.max(1, length(attr(svg, "height"), hasVB ? vb[3] : 150, hasVB ? vb[3] : 150));
  const rootM = hasVB ? mul(scale(width / vb[2], height / vb[3]), translate(-vb[0], -vb[1])) : ident();

  function computed(el, parent) {
    const st = {};
    for (const k of INHERITED) if (parent[k] !== undefined) st[k] = parent[k];
    const cls = String(attr(el, "class") || "").split(/\s+/);
    for (const r of rules) {
      const s = r.sel;
      if (s === "*" || (s[0] === "." && cls.includes(s.slice(1))) || (s[0] === "#" && attr(el, "id") === s.slice(1)) || s.toLowerCase() === local(el)) Object.assign(st, r.decl);
    }
    for (const k of [...INHERITED, "opacity", "display", "mix-blend-mode", "stop-color", "stop-opacity"]) {
      const a = attr(el, k);
      if (a != null) st[k] = a;
    }
    Object.assign(st, declarations(attr(el, "style")));
    return st;
  }

  const colorOf = (v, st) => {
    if (/^currentcolor$/i.test(String(v).trim())) return cssColor(st.color || "#000000");
    return cssColor(v);
  };

  function stopsOf(g, seen = new Set()) {
    let stops = els(g).filter((c) => local(c) === "stop");
    if (!stops.length) {
      const ref = hrefTarget(g);
      if (ref && !seen.has(ref)) {
        seen.add(ref);
        return stopsOf(ref, seen);
      }
    }
    return stops.map((s) => {
      const st = computed(s, {});
      const c = cssColor(st["stop-color"] || "#000000") || { hex: "#000000", alpha: 1 };
      const off = String(attr(s, "offset") ?? "0");
      const o = off.endsWith("%") ? parseFloat(off) / 100 : parseFloat(off);
      return { at: Math.max(0, Math.min(1, Number.isFinite(o) ? o : 0)), color: hexA(c.hex, c.alpha * num(st["stop-opacity"], 1)) };
    });
  }
  function hrefTarget(el) {
    const href = attr(el, "href") || attr(el, "xlink:href");
    return href && href[0] === "#" ? byId.get(href.slice(1)) : null;
  }
  function gAttr(g, k, seen = new Set()) {
    const v = attr(g, k);
    if (v != null) return v;
    const ref = hrefTarget(g);
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      return gAttr(ref, k, seen);
    }
    return null;
  }

  /** A Proto fill for an SVG paint; `box` is the shape's box in user space before `M` (for objectBoundingBox). */
  function paint(value, opacity, st, M, box) {
    if (value == null) return null;
    const v = String(value).trim();
    if (!v || v === "none") return null;
    const m = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/.exec(v);
    if (m) {
      const g = byId.get(m[1]);
      const kind = g ? local(g) : "";
      if (kind === "lineargradient" || kind === "radialgradient") {
        const stops = stopsOf(g);
        if (!stops.length) return null;
        if (stops.length === 1) return { type: "solid", color: stops[0].color, ...(opacity < 1 ? { opacity } : {}) };
        const units = gAttr(g, "gradientUnits") || "objectBoundingBox";
        const gt = parseTransform(gAttr(g, "gradientTransform"));
        const toUser = (x, y) => {
          const [gx, gy] = apply(gt, x, y);
          return units === "userSpaceOnUse" ? [gx, gy] : [box.x + gx * box.w, box.y + gy * box.h];
        };
        const frac = (s, d) => (s == null ? d : String(s).endsWith("%") ? parseFloat(s) / 100 : parseFloat(s));
        const ref = (k, d) => {
          const raw = gAttr(g, k);
          if (units === "userSpaceOnUse") return raw == null ? d : String(raw).endsWith("%") ? (parseFloat(raw) / 100) * (k.includes("x") ? width : height) : parseFloat(raw);
          return frac(raw, d);
        };
        if (kind === "lineargradient") {
          const p1 = apply(M, ...toUser(ref("x1", units === "userSpaceOnUse" ? box.x : 0), ref("y1", units === "userSpaceOnUse" ? box.y : 0)));
          const p2 = apply(M, ...toUser(ref("x2", units === "userSpaceOnUse" ? box.x + box.w : 1), ref("y2", units === "userSpaceOnUse" ? box.y : 0)));
          const angle = r2(((Math.atan2(p2[0] - p1[0], -(p2[1] - p1[1])) * 180) / Math.PI + 360) % 360);
          return { type: "linear", angle, stops, ...(opacity < 1 ? { opacity } : {}) };
        }
        const c = toUser(ref("cx", units === "userSpaceOnUse" ? box.x + box.w / 2 : 0.5), ref("cy", units === "userSpaceOnUse" ? box.y + box.h / 2 : 0.5));
        const center = [box.w ? r2((c[0] - box.x) / box.w) : 0.5, box.h ? r2((c[1] - box.y) / box.h) : 0.5];
        return { type: "radial", center, stops, ...(opacity < 1 ? { opacity } : {}) };
      }
      report.flattened("Patterns and other paint servers were replaced by a solid color.");
      const fb = m[2] ? colorOf(m[2], st) : null;
      return { type: "solid", color: hexA(fb ? fb.hex : "#808080", fb ? fb.alpha : 1), ...(opacity < 1 ? { opacity } : {}) };
    }
    const c = colorOf(v, st);
    if (!c) return null;
    const a = c.alpha * opacity;
    return { type: "solid", color: c.hex, ...(a < 0.999 ? { opacity: r2(a) } : {}) };
  }

  const det = (M) => Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;

  function appearance(st, M, box, { noFill = false } = {}) {
    const f = {};
    const fill = noFill ? null : paint(st.fill === undefined ? "#000000" : st.fill, num(st["fill-opacity"], 1), st, M, box);
    f.fills = fill ? [fill] : [];
    const sw = length(st["stroke-width"], 1, 1);
    const sp = paint(st.stroke, num(st["stroke-opacity"], 1), st, M, box);
    if (sp && sw > 0) {
      const color = sp.type === "solid" ? hexA(sp.color, num(sp.opacity, 1)) : sp.stops[0].color;
      if (sp.type !== "solid") report.flattened("Gradient strokes were replaced by their first color.");
      const dash = String(st["stroke-dasharray"] || "").split(/[\s,]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
      f.strokes = [{ color, w: r2(sw * det(M)), align: "center", ...(dash.length && dash.some((d) => d > 0) ? { dash: dash.slice(0, 16).map((d) => r2(d * det(M))) } : {}) }];
    }
    const op = num(st.opacity, 1);
    if (op < 1) f.opacity = Math.max(0, r2(op));
    const bm = st["mix-blend-mode"];
    if (bm && bm !== "normal" && /^[a-z-]+$/.test(bm)) f.blend = bm;
    if (st.visibility === "hidden") f.visible = false;
    return f;
  }

  const warnUnsupported = (el) => {
    if (attr(el, "filter") != null) report.dropped("SVG filters were not imported.");
    if (attr(el, "clip-path") != null) report.dropped("Clip paths were not imported (the clipped shapes are shown whole).");
    if (attr(el, "mask") != null) report.dropped("Masks were not imported.");
    if (attr(el, "marker-start") != null || attr(el, "marker-end") != null || attr(el, "marker-mid") != null) report.dropped("Markers (arrowheads) were not imported.");
  };

  /** Items in root-frame coordinates: { kind, box: {x,y,w,h}, make(dx, dy) → spec }. */
  function convert(el, parentSt, M, depth, seenUse) {
    const tag = local(el);
    if (SKIP.has(tag) || depth > 64) {
      if (tag === "script") report.dropped("Scripts in the SVG were removed.");
      if (tag === "foreignobject") report.dropped("HTML inside the SVG (foreignObject) was not imported.");
      return null;
    }
    const st = computed(el, parentSt);
    if (st.display === "none") return null;
    warnUnsupported(el);
    const m = mul(M, parseTransform(attr(el, "transform")));
    const label = attr(el, "id") || attr(el, "inkscape:label") || null;
    switch (tag) {
      case "svg":
      case "g":
      case "a":
      case "switch": {
        let inner = m;
        if (tag === "svg" && depth > 0) {
          const x = length(attr(el, "x"), width);
          const y = length(attr(el, "y"), height);
          inner = mul(m, translate(x, y));
        }
        const kids = [];
        for (const c of els(el)) {
          const k = convert(c, st, inner, depth + 1, seenUse);
          if (k) kids.push(k);
          if (tag === "switch" && k) break;
        }
        return group(kids, st, label || (tag === "a" ? "Link" : "Group"), m);
      }
      case "use": {
        const ref = hrefTarget(el);
        if (!ref || seenUse.has(ref) || seenUse.size > 32) return null;
        const x = length(attr(el, "x"), width);
        const y = length(attr(el, "y"), height);
        const um = mul(m, translate(x, y));
        const next = new Set(seenUse).add(ref);
        const list = local(ref) === "symbol" ? els(ref) : [ref];
        const symM = local(ref) === "symbol" ? symbolMatrix(ref, el, um) : um;
        const kids = list.map((c) => convert(c, st, symM, depth + 1, next)).filter(Boolean);
        return group(kids, st, label || attr(ref, "id") || "Instance", m);
      }
      case "rect": {
        const x = length(attr(el, "x"), width);
        const y = length(attr(el, "y"), height);
        const w = length(attr(el, "width"), width);
        const h = length(attr(el, "height"), height);
        if (!(w > 0 && h > 0)) return null;
        let rx = length(attr(el, "rx"), width, NaN);
        let ry = length(attr(el, "ry"), height, NaN);
        if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
        if (Number.isNaN(ry)) ry = rx;
        const r = Math.min(rx, ry, w / 2, h / 2);
        return shape(rectPath(w, h, r), translate(x, y), m, st, label || "Rectangle", { kind: "rect", w, h, r, x, y });
      }
      case "circle":
      case "ellipse": {
        const cx = length(attr(el, "cx"), width);
        const cy = length(attr(el, "cy"), height);
        const rx = tag === "circle" ? length(attr(el, "r"), Math.hypot(width, height) / Math.SQRT2) : length(attr(el, "rx"), width);
        const ry = tag === "circle" ? rx : length(attr(el, "ry"), height);
        if (!(rx > 0 && ry > 0)) return null;
        return shape(ellipsePath(rx * 2, ry * 2), translate(cx - rx, cy - ry), m, st, label || "Ellipse", { kind: "ellipse", w: rx * 2, h: ry * 2, x: cx - rx, y: cy - ry });
      }
      case "line": {
        const p = { subpaths: [polylineSubpath([[num(attr(el, "x1")), num(attr(el, "y1"))], [num(attr(el, "x2")), num(attr(el, "y2"))]], false)] };
        return shape(p, ident(), m, { ...st, fill: "none" }, label || "Line");
      }
      case "polyline":
      case "polygon": {
        const n = String(attr(el, "points") || "").split(/[\s,]+/).filter(Boolean).map(Number);
        const pts = [];
        for (let i = 0; i + 1 < n.length; i += 2) if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) pts.push([n[i], n[i + 1]]);
        if (pts.length < 2) return null;
        return shape({ subpaths: [polylineSubpath(pts, tag === "polygon")] }, ident(), m, st, label || (tag === "polygon" ? "Polygon" : "Polyline"));
      }
      case "path": {
        let p;
        try {
          p = svgDToPath(String(attr(el, "d") || ""));
        } catch {
          return null;
        }
        if (!p.subpaths.length) return null;
        return shape(p, ident(), m, st, label || "Path");
      }
      case "image": {
        const href = attr(el, "href") || attr(el, "xlink:href") || "";
        const x = length(attr(el, "x"), width);
        const y = length(attr(el, "y"), height);
        const w = length(attr(el, "width"), width);
        const h = length(attr(el, "height"), height);
        const data = href.startsWith("data:") ? dataUrlBytes(href) : null;
        const id = data && w > 0 && h > 0 ? b.media({ bytes: data.bytes, mime: data.mime, name: label || "Image" }) : null;
        if (!id) {
          report.dropped("External, unsupported or empty images in the SVG were skipped (nothing is downloaded).");
          return null;
        }
        stats.images++;
        const [x0, y0] = apply(m, x, y);
        const [x1, y1] = apply(m, x + w, y + h);
        const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        if (Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6) report.flattened("Rotated images were placed upright.");
        return { box, make: (dx, dy) => spec(b, "image", { name: cleanName(label, "Image"), x: r2(box.x - dx), y: r2(box.y - dy), w: { mode: "fixed", value: r2(box.w) }, h: { mode: "fixed", value: r2(box.h) }, fills: [{ type: "image", media: id, fit: attr(el, "preserveAspectRatio") === "none" ? "fill" : "contain" }], alt: "" }) };
      }
      case "text": {
        const content = textOf(el).replace(/\s+/g, " ").trim();
        if (!content) return null;
        const size = length(st["font-size"], 16, 16) * det(m);
        const family = String(st["font-family"] || "Inter").split(",")[0].replace(/["']/g, "").trim() || "Inter";
        let x = length(attr(el, "x"), width);
        let y = length(attr(el, "y"), height);
        const firstSpan = els(el).find((c) => local(c) === "tspan");
        if (firstSpan && attr(el, "x") == null) x = length(attr(firstSpan, "x"), width, x);
        if (firstSpan && attr(el, "y") == null) y = length(attr(firstSpan, "y"), height, y);
        const [px, py] = apply(m, x, y);
        const est = content.length * size * 0.52;
        const anchor = st["text-anchor"] || "start";
        const left = anchor === "middle" ? px - est / 2 : anchor === "end" ? px - est : px;
        const top = py - size * 0.8;
        const fill = paint(st.fill === undefined ? "#000000" : st.fill, num(st["fill-opacity"], 1), st, m, { x: 0, y: 0, w: 1, h: 1 });
        const color = fill?.type === "solid" ? hexA(fill.color, num(fill.opacity, 1)) : "#000000";
        const w = String(st["font-weight"] || "400");
        const weight = w === "bold" || w === "bolder" ? 700 : w === "lighter" ? 300 : Math.max(1, Math.min(1000, num(w, 400)));
        const rot = matrixAngle(m);
        stats.text++;
        const box = { x: left, y: top, w: est, h: size * 1.2 };
        return {
          box,
          make: (dx, dy) =>
            spec(b, "text", {
              name: cleanName(content.slice(0, 40), "Text"),
              x: r2(left - dx),
              y: r2(top - dy),
              ...(rot ? { rot } : {}),
              ...(num(st.opacity, 1) < 1 ? { opacity: r2(num(st.opacity, 1)) } : {}),
              text: { runs: [{ t: content, s: {} }], style: { font: family, size: r2(Math.max(0.5, size)), weight, lineHeight: { pct: 120 }, tracking: 0, align: anchor === "middle" ? "center" : anchor === "end" ? "right" : "left", color, ...(st["font-style"] === "italic" ? { italic: true } : {}) }, autoSize: "width", maxLines: null },
            }),
        };
      }
      default:
        return null;
    }
  }

  function symbolMatrix(sym, use, um) {
    const v = String(attr(sym, "viewBox") || "").split(/[\s,]+/).map(Number);
    if (v.length !== 4 || !v.every(Number.isFinite) || !(v[2] > 0 && v[3] > 0)) return um;
    const w = length(attr(use, "width"), width, v[2]);
    const h = length(attr(use, "height"), height, v[3]);
    return mul(um, mul(scale(w / v[2], h / v[3]), translate(-v[0], -v[1])));
  }

  function shape(path, place, M, st, label, simple = null) {
    const total = mul(M, place);
    const axis = Math.abs(total[1]) < 1e-9 && Math.abs(total[2]) < 1e-9 && total[0] > 0 && total[3] > 0;
    const p = transformPath(path, total);
    const bb = pathBBox(p);
    if (!bb) return null;
    const box = { x: bb.x, y: bb.y, w: bb.w, h: bb.h };
    const localBox = simple ? { x: simple.x ?? 0, y: simple.y ?? 0, w: simple.w, h: simple.h } : pathBBox(path, place) || { x: 0, y: 0, w: 1, h: 1 };
    const look = appearance(st, M, localBox, { noFill: false });
    stats.shapes++;
    if (simple && axis) {
      const sx = total[0];
      const sy = total[3];
      const fields = { name: cleanName(label, simple.kind === "rect" ? "Rectangle" : "Ellipse"), w: { mode: "fixed", value: r2(simple.w * sx) }, h: { mode: "fixed", value: r2(simple.h * sy) }, ...look };
      if (simple.kind === "rect" && simple.r > 0) fields.radius = r2(simple.r * Math.min(sx, sy));
      return { box, make: (dx, dy) => spec(b, simple.kind, { ...fields, x: r2(total[4] - dx), y: r2(total[5] - dy) }) };
    }
    const d = pathToSvgD(transformPath(p, translate(-bb.x, -bb.y)), null, 3);
    const fields = { name: cleanName(label, "Vector"), w: { mode: "fixed", value: r2(bb.w) }, h: { mode: "fixed", value: r2(bb.h) }, d, rule: st["fill-rule"] === "evenodd" ? "evenodd" : "nonzero", ...look };
    if (!fields.fills.length) fields.fills = [];
    return { box, make: (dx, dy) => spec(b, "vector", { ...fields, x: r2(bb.x - dx), y: r2(bb.y - dy) }) };
  }

  function group(kids, st, label, m) {
    if (!kids.length) return null;
    if (kids.length === 1 && num(st.opacity, 1) >= 1 && !st["mix-blend-mode"]) return kids[0];
    stats.groups++;
    const x0 = Math.min(...kids.map((k) => k.box.x));
    const y0 = Math.min(...kids.map((k) => k.box.y));
    const x1 = Math.max(...kids.map((k) => k.box.x + k.box.w));
    const y1 = Math.max(...kids.map((k) => k.box.y + k.box.h));
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const op = num(st.opacity, 1);
    return {
      box,
      make: (dx, dy) => {
        // children keep the source order (the last child paints on top, as in SVG)
        const made = kids.map((k) => k.make(x0, y0));
        for (const c of made) c.fields.pos = "abs";
        return spec(b, "frame", { name: cleanName(label, "Group"), x: r2(x0 - dx), y: r2(y0 - dy), w: { mode: "fixed", value: r2(box.w) }, h: { mode: "fixed", value: r2(box.h) }, layout: { type: "none" }, clip: false, fills: [], ...(op < 1 ? { opacity: r2(op) } : {}) }, made);
      },
    };
  }

  const items = [];
  for (const c of els(svg)) {
    const k = convert(c, computed(svg, {}), rootM, 1, new Set());
    if (k) items.push(k);
  }
  const children = items.map((k) => {
    const s = k.make(0, 0);
    s.fields.pos = "abs";
    return s;
  });
  const root = spec(b, "frame", { name: cleanName(name.replace(/\.svg$/i, ""), "SVG"), x: 0, y: 0, w: { mode: "fixed", value: r2(width) }, h: { mode: "fixed", value: r2(height) }, layout: { type: "none" }, clip: false, fills: [] }, children);
  return { root, size: { w: width, h: height }, stats };
}

function findSvg(el) {
  if (!el || typeof el === "string") return null;
  if (local(el) === "svg") return el;
  for (const c of els(el)) {
    const f = findSvg(c);
    if (f) return f;
  }
  return null;
}
