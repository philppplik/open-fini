// SVG display-list backend. Pure string output — no DOM needed.
// Features that SVG cannot express (conic gradients, adjustment layers, exotic effects) are
// handled through the optional `rasterize` hook or degrade gracefully.
import { dataToSvgD } from "../vector/path.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// decimal places of numbers and path data; set per call by displayListToSVGResult (synchronous, so a module variable is safe)
let PREC = 4;
let PATH_PREC = 3;
const num = (v) => {
  const s = (+v.toFixed(PREC)).toString();
  return s === "-0" ? "0" : s;
};
const mat = (m) => `matrix(${m.map(num).join(" ")})`;
const isIdent = (m) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;

class Ctx {
  constructor(o) {
    this.defs = [];
    this.n = 0;
    this.o = o;
    this.warnings = new Set();
    this.fonts = new Map();
  }
  id(p) {
    return `${p}${++this.n}`;
  }
}

function paint(ctx, p, fillOrStroke) {
  if (!p) return { attr: `${fillOrStroke}="none"` };
  if (p.type === "solid") {
    const op = p.alpha < 1 ? ` ${fillOrStroke}-opacity="${num(p.alpha)}"` : "";
    return { attr: `${fillOrStroke}="${p.color}"${op}` };
  }
  const stops = (list) => list.map((s) => `<stop offset="${num(s.o)}" stop-color="${s.color}"${s.alpha < 1 ? ` stop-opacity="${num(s.alpha)}"` : ""}/>`).join("");
  if (p.type === "linear") {
    const id = ctx.id("lg");
    ctx.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(p.x0)}" y1="${num(p.y0)}" x2="${num(p.x1)}" y2="${num(p.y1)}">${stops(p.stops)}</linearGradient>`);
    return { attr: `${fillOrStroke}="url(#${id})"` };
  }
  if (p.type === "radial") {
    const id = ctx.id("rg");
    ctx.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(p.cx)}" cy="${num(p.cy)}" r="${num(p.r)}" fx="${num(p.fx ?? p.cx)}" fy="${num(p.fy ?? p.cy)}">${stops(p.stops)}</radialGradient>`);
    return { attr: `${fillOrStroke}="url(#${id})"` };
  }
  // conic: no SVG equivalent — fall back to the mid stop color
  ctx.warnings.add("Conic gradients are approximated with a solid color in SVG.");
  const mid = p.stops[Math.floor(p.stops.length / 2)] || { color: "#000000", alpha: 1 };
  return { attr: `${fillOrStroke}="${mid.color}"${mid.alpha < 1 ? ` ${fillOrStroke}-opacity="${num(mid.alpha)}"` : ""}` };
}

function strokeAttrs(ctx, s) {
  if (!s) return "";
  const a = [paint(ctx, s.paint, "stroke").attr, `stroke-width="${num(s.width)}"`];
  if (s.cap !== "butt") a.push(`stroke-linecap="${s.cap}"`);
  if (s.join !== "miter") a.push(`stroke-linejoin="${s.join}"`);
  else if (s.miterLimit !== 4) a.push(`stroke-miterlimit="${num(s.miterLimit)}"`);
  if (s.dash) a.push(`stroke-dasharray="${s.dash.map(num).join(" ")}"`);
  if (s.dashOffset) a.push(`stroke-dashoffset="${num(s.dashOffset)}"`);
  return " " + a.join(" ");
}

function emitItem(ctx, it, out) {
  switch (it.t) {
    case "path": {
      const t = isIdent(it.m) ? "" : ` transform="${mat(it.m)}"`;
      const fill = paint(ctx, it.fill, "fill").attr;
      const rule = it.rule === "evenodd" ? ' fill-rule="evenodd"' : "";
      out.push(`<path d="${dataToSvgD(it.d, PATH_PREC)}" ${fill}${rule}${strokeAttrs(ctx, it.stroke)}${t}/>`);
      break;
    }
    case "image": {
      const href = ctx.o.encodeImage ? ctx.o.encodeImage(it.img) : null;
      if (!href) {
        ctx.warnings.add("Some images could not be embedded.");
        break;
      }
      const t = isIdent(it.m) ? "" : ` transform="${mat(it.m)}"`;
      const rendering = it.smooth ? "" : ' image-rendering="pixelated"';
      out.push(`<image width="${it.img.width}" height="${it.img.height}" href="${href}"${rendering}${t}/>`);
      break;
    }
    case "text": {
      const t = isIdent(it.m) ? "" : ` transform="${mat(it.m)}"`;
      const parts = it.runs.map((r) => {
        ctx.fonts.set(`${r.font.family}\u0000${r.font.weight}\u0000${r.font.style}`, r.font);
        const deco = [r.underline ? "underline" : "", r.strike ? "line-through" : ""].filter(Boolean).join(" ");
        const attrs = [
          `x="${num(r.x)}"`, `y="${num(r.y)}"`,
          `font-family="${esc(r.font.family)}"`, `font-size="${num(r.font.size)}"`,
          r.font.weight !== 400 ? `font-weight="${r.font.weight}"` : "",
          r.font.style === "italic" ? 'font-style="italic"' : "",
          r.letterSpacing ? `letter-spacing="${num(r.letterSpacing)}"` : "",
          deco ? `text-decoration="${deco}"` : "",
          paint(ctx, r.fill, "fill").attr,
          strokeAttrs(ctx, r.stroke).trim(),
          'xml:space="preserve"',
        ].filter(Boolean);
        return `<text ${attrs.join(" ")}>${esc(r.text)}</text>`;
      });
      out.push(t ? `<g${t}>${parts.join("")}</g>` : parts.join(""));
      break;
    }
    case "group":
      emitGroup(ctx, it, out);
      break;
    case "adjust":
      ctx.warnings.add("Adjustment layers are not representable in SVG and were skipped.");
      break;
  }
}

function filterFor(ctx, fx) {
  const id = ctx.id("fx");
  const prims = [];
  let last = "SourceGraphic";
  let k = 0;
  const res = () => `r${k++}`;
  for (const f of fx) {
    if (f.type === "blur") {
      const r = res();
      prims.push(`<feGaussianBlur in="${last}" stdDeviation="${num(f.radius)}" result="${r}"/>`);
      last = r;
    }
  }
  const base = last;
  const merge = [];
  for (const f of fx) {
    if (f.type === "dropShadow") {
      const r = res();
      prims.push(`<feGaussianBlur in="${base}" stdDeviation="${num((f.blur ?? 8) / 2)}" result="${r}b"/>`);
      prims.push(`<feOffset in="${r}b" dx="${num(f.dx ?? 0)}" dy="${num(f.dy ?? 4)}" result="${r}o"/>`);
      prims.push(`<feFlood flood-color="${f.color}" flood-opacity="${num(f.alpha ?? 0.5)}" result="${r}c"/>`);
      prims.push(`<feComposite in="${r}c" in2="${r}o" operator="in" result="${r}"/>`);
      merge.push(r);
    } else if (f.type === "outerGlow") {
      const r = res();
      prims.push(`<feGaussianBlur in="${base}" stdDeviation="${num((f.radius ?? 10) / 2)}" result="${r}b"/>`);
      prims.push(`<feFlood flood-color="${f.color}" flood-opacity="${num(f.alpha ?? 0.7)}" result="${r}c"/>`);
      prims.push(`<feComposite in="${r}c" in2="${r}b" operator="in" result="${r}"/>`);
      merge.push(r);
    } else if (f.type === "colorOverlay" || f.type === "outline" || f.type === "innerShadow" || f.type === "innerGlow") {
      ctx.warnings.add(`The "${f.type}" effect is not exported to SVG.`);
    }
  }
  prims.push(`<feMerge>${merge.map((m) => `<feMergeNode in="${m}"/>`).join("")}<feMergeNode in="${base}"/></feMerge>`);
  ctx.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${prims.join("")}</filter>`);
  return id;
}

function emitGroup(ctx, g, out) {
  const attrs = [];
  if (!isIdent(g.m)) attrs.push(`transform="${mat(g.m)}"`);
  if (g.opacity < 1) attrs.push(`opacity="${num(g.opacity)}"`);
  const styles = [];
  if (g.blend && g.blend !== "normal") styles.push(`mix-blend-mode:${g.blend}`);
  if (g.isolate) styles.push("isolation:isolate");
  if (styles.length) attrs.push(`style="${styles.join(";")}"`);
  if (g.fx && g.fx.length) attrs.push(`filter="url(#${filterFor(ctx, g.fx)})"`);
  if (g.mask && g.mask.length) {
    const id = ctx.id("mk");
    const inner = [];
    for (const it of g.mask) emitItem(ctx, it, inner);
    ctx.defs.push(`<mask id="${id}" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">${inner.join("")}</mask>`);
    attrs.push(`mask="url(#${id})"`);
  }
  const inner = [];
  if (g.alt) inner.push(`${g.alt.title ? `<title>${esc(g.alt.title)}</title>` : ""}${g.alt.desc ? `<desc>${esc(g.alt.desc)}</desc>` : ""}`);
  const altCount = inner.length;
  for (const it of g.items) emitItem(ctx, it, inner);
  if (inner.length <= altCount) return;
  let body = `<g${attrs.length ? " " + attrs.join(" ") : ""}>${inner.join("")}</g>`;
  if (g.clip) {
    const id = ctx.id("cp");
    const t = isIdent(g.clip.m) ? "" : ` transform="${mat(g.clip.m)}"`;
    ctx.defs.push(`<clipPath id="${id}"><path d="${dataToSvgD(g.clip.d, PATH_PREC)}" clip-rule="${g.clip.rule}"${t}/></clipPath>`);
    // clip lives in the group's interior space: apply it on an inner wrapper that shares the group transform
    const outerAttrs = attrs.filter((a) => !a.startsWith("transform="));
    const tr = !isIdent(g.m) ? ` transform="${mat(g.m)}"` : "";
    body = `<g${tr}><g clip-path="url(#${id})"><g${outerAttrs.length ? " " + outerAttrs.join(" ") : ""}>${inner.join("")}</g></g></g>`;
  }
  out.push(body);
}

/**
 * @param {{width:number,height:number,items:any[]}} dl
 * @param {object} [options]
 * @param {string|null} [options.background]   page color painted behind the artwork
 * @param {(img:any)=>string|null} [options.encodeImage]  data URL of an image reference
 * @param {string} [options.title]              <title> of the document
 * @param {string} [options.description]        <desc> of the document
 * @param {string} [options.metadata]           XML placed in <metadata> (for example an XMP packet)
 * @param {number} [options.pxPerUnit=1]        width/height = display list size x pxPerUnit
 * @param {string} [options.unit=""]            unit suffix of width/height ("", "pt", "mm", "cm", "in")
 * @param {boolean} [options.responsive=false]  omit width/height (the SVG scales to its container; viewBox stays)
 * @param {{x:number,y:number,w:number,h:number}} [options.viewBox]  crop to this area (width/height follow it)
 * @param {number} [options.precision=4]        decimal places of numbers (path data: one less, at least 0)
 * @param {(font:{family:string,weight:number,style:string})=>string|null} [options.fontFace]
 *   src of an @font-face rule (for example a data URL) for every font used by text; null leaves the font referenced by name
 * @param {boolean} [options.xmlDeclaration=true]
 * @returns {{svg:string, warnings:string[], fonts:{family:string,weight:number,style:string,embedded:boolean}[]}}
 */
export function displayListToSVGResult(dl, options = {}) {
  const ctx = new Ctx(options);
  const prec = Number.isInteger(options.precision) ? Math.max(0, Math.min(8, options.precision)) : null;
  PREC = prec ?? 4;
  PATH_PREC = prec === null ? 3 : Math.max(0, prec - 1);
  try {
    const body = [];
    const vb = options.viewBox && options.viewBox.w > 0 && options.viewBox.h > 0 ? options.viewBox : { x: 0, y: 0, w: dl.width, h: dl.height };
    if (options.background) body.push(`<rect width="${num(dl.width)}" height="${num(dl.height)}" fill="${options.background}"/>`);
    for (const it of dl.items) emitItem(ctx, it, body);
    const k = options.pxPerUnit || 1;
    const unit = /^(pt|mm|cm|in|px)$/.test(options.unit || "") ? options.unit : "";
    const size = options.responsive ? "" : ` width="${num(vb.w * k)}${unit}" height="${num(vb.h * k)}${unit}"`;
    const head = [
      options.title ? `<title>${esc(options.title)}</title>` : "",
      options.description ? `<desc>${esc(options.description)}</desc>` : "",
      options.metadata ? `<metadata>${options.metadata}</metadata>` : "",
    ].join("");
    const fonts = [];
    const faces = [];
    for (const f of ctx.fonts.values()) {
      const src = options.fontFace ? options.fontFace(f) : null;
      fonts.push({ family: f.family, weight: f.weight, style: f.style, embedded: !!src });
      if (src) faces.push(`@font-face{font-family:"${esc(f.family)}";font-weight:${f.weight};font-style:${f.style === "italic" ? "italic" : "normal"};src:url(${src})}`);
    }
    if (faces.length) ctx.defs.unshift(`<style>${faces.join("")}</style>`);
    const defs = ctx.defs.length ? `<defs>${ctx.defs.join("")}</defs>` : "";
    const decl = options.xmlDeclaration === false ? "" : '<?xml version="1.0" encoding="UTF-8"?>\n';
    const svg = `${decl}<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="${num(vb.x)} ${num(vb.y)} ${num(vb.w)} ${num(vb.h)}">${head}${defs}${body.join("")}</svg>\n`;
    return { svg, warnings: [...ctx.warnings], fonts };
  } finally {
    PREC = 4;
    PATH_PREC = 3;
  }
}

export const displayListToSVG = (dl, options) => displayListToSVGResult(dl, options).svg;
