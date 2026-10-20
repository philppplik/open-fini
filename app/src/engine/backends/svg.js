// SVG display-list backend. Pure string output — no DOM needed.
// Features that SVG cannot express (conic gradients, adjustment layers, exotic effects) are
// handled through the optional `rasterize` hook or degrade gracefully.
import { dataToSvgD } from "../vector/path.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v) => {
  const s = (+v.toFixed(4)).toString();
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
      out.push(`<path d="${dataToSvgD(it.d)}" ${fill}${rule}${strokeAttrs(ctx, it.stroke)}${t}/>`);
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
    ctx.defs.push(`<clipPath id="${id}"><path d="${dataToSvgD(g.clip.d)}" clip-rule="${g.clip.rule}"${t}/></clipPath>`);
    // clip lives in the group's interior space: apply it on an inner wrapper that shares the group transform
    const outerAttrs = attrs.filter((a) => !a.startsWith("transform="));
    const tr = !isIdent(g.m) ? ` transform="${mat(g.m)}"` : "";
    body = `<g${tr}><g clip-path="url(#${id})"><g${outerAttrs.length ? " " + outerAttrs.join(" ") : ""}>${inner.join("")}</g></g></g>`;
  }
  out.push(body);
}

/**
 * @param {{width:number,height:number,items:any[]}} dl
 * @param {{background?:string|null, encodeImage?:(img:any)=>string|null, title?:string, pxPerUnit?:number}} [options]
 * @returns {{svg:string, warnings:string[]}}
 */
export function displayListToSVGResult(dl, options = {}) {
  const ctx = new Ctx(options);
  const body = [];
  if (options.background) body.push(`<rect width="${num(dl.width)}" height="${num(dl.height)}" fill="${options.background}"/>`);
  for (const it of dl.items) emitItem(ctx, it, body);
  const w = num(dl.width * (options.pxPerUnit || 1));
  const h = num(dl.height * (options.pxPerUnit || 1));
  const title = options.title ? `<title>${esc(options.title)}</title>` : "";
  const defs = ctx.defs.length ? `<defs>${ctx.defs.join("")}</defs>` : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${num(dl.width)} ${num(dl.height)}">${title}${defs}${body.join("")}</svg>\n`;
  return { svg, warnings: [...ctx.warnings] };
}

export const displayListToSVG = (dl, options) => displayListToSVGResult(dl, options).svg;
