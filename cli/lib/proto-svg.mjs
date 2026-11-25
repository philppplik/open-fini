// SVG render of Proto layers without a browser (`ofini proto render` and `assets`; docs/concepts/proto-studio.md §4.4).
//
// The layer is resolved (engine/proto/resolve.js: instances, variables in the chosen modes, styles) and laid out by the
// pure solver (engine/proto/layout.js) inside its top-level frame, so fill and hug sizes come out as on the canvas;
// then every visible layer is drawn from the resolved fields: fills (solid, linear and radial gradients, images),
// strokes (inside, center, outside, per-side widths), corner radii, drop shadows, layer blur, opacity, blend modes,
// rotation, clipping, vector paths and lines, and text from the solver's lines. The result is **approximate**: text
// uses the PDF base-14 metrics (no kerning, no real fonts), conic gradients are drawn with their first color, inner
// shadows, shadow spread and background blur are left out. Those omissions are listed in `notes`.
//
// Public API
//   renderSvg(model, key, opts?) → { svg, width, height, approximate: true, notes: string[], warnings }
//       key    a layer id, or an instance-inner key such as "n5/n22"
//       opts   { modes?: { collectionId: modeId }, measurer?, media?: "embed"|"link"|"none", scale?: number,
//                background?: string|null }   modes are set on the top-level layer (they win over its own choice)
import { createResolver } from "../../app/src/engine/proto/resolve.js";
import { layout } from "../../app/src/engine/proto/layout.js";
import { textStyleOf, fontStack, hexAlpha } from "../../app/src/engine/proto/css.js";
import { field } from "../../app/src/engine/proto/schema.js";
import { ancestors } from "../../app/src/engine/proto/tree.js";
import { withModes } from "./proto-model.mjs";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const numOr = (v, d) => (finite(v) ? v : d);
const f = (n) => String(Math.round(n * 1000) / 1000);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CONTAINERS = new Set(["frame", "component", "componentSet", "instance", "slot"]);
const MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg" };
const BLEND_OK = /^[a-z-]+$/;

/** A hex color (with an opacity) as SVG paint attributes: `fill="#rrggbb" fill-opacity="0.5"`. */
function paint(attr, hex, opacity = 1) {
  const c = hexAlpha(hex, opacity);
  if (!c) return null;
  if (c.length === 7) return `${attr}="${c}"`;
  const a = parseInt(c.slice(7, 9), 16) / 255;
  return `${attr}="${c.slice(0, 7)}" ${attr}-opacity="${f(a)}"`;
}

/** A rounded rectangle as SVG: a <rect> for equal radii, a path otherwise. */
function roundRect(x, y, w, h, radii, attrs) {
  w = Math.max(0, w);
  h = Math.max(0, h);
  const lim = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(lim, r)));
  if (tl === tr && tr === br && br === bl) return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${tl ? ` rx="${f(tl)}"` : ""} ${attrs}/>`;
  const d = `M${f(x + tl)} ${f(y)}H${f(x + w - tr)}${tr ? `A${f(tr)} ${f(tr)} 0 0 1 ${f(x + w)} ${f(y + tr)}` : ""}V${f(y + h - br)}${br ? `A${f(br)} ${f(br)} 0 0 1 ${f(x + w - br)} ${f(y + h)}` : ""}H${f(x + bl)}${bl ? `A${f(bl)} ${f(bl)} 0 0 1 ${f(x)} ${f(y + h - bl)}` : ""}V${f(y + tl)}${tl ? `A${f(tl)} ${f(tl)} 0 0 1 ${f(x + tl)} ${f(y)}` : ""}Z`;
  return `<path d="${d}" ${attrs}/>`;
}

function radiiOf(node) {
  const v = node.radius;
  if (Array.isArray(v) && v.length === 4) return v.map((x) => Math.max(0, numOr(x, 0)));
  const r = Math.max(0, numOr(v, 0));
  return [r, r, r, r];
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

class Painter {
  constructor(model, opts) {
    this.model = model;
    this.opts = opts;
    this.defs = [];
    this.notes = new Set();
    this.seq = 0;
  }
  id(prefix) {
    return `ofp-${prefix}${++this.seq}`;
  }
  note(s) {
    this.notes.add(s);
  }

  /** The SVG shape of a layer's outline (for fills, clips and shadows), offset by `grow` on every side. */
  shape(r, b, attrs, grow = 0) {
    if (r.type === "ellipse") return `<ellipse cx="${f(b.x + b.w / 2)}" cy="${f(b.y + b.h / 2)}" rx="${f(Math.max(0, b.w / 2 + grow))}" ry="${f(Math.max(0, b.h / 2 + grow))}" ${attrs}/>`;
    const radii = radiiOf(r.node).map((x) => (x > 0 ? Math.max(0, x + grow) : 0));
    return roundRect(b.x - grow, b.y - grow, b.w + 2 * grow, b.h + 2 * grow, radii, attrs);
  }

  gradient(fill, b) {
    const stops = (Array.isArray(fill.stops) ? fill.stops : [])
      .map((s) => {
        const c = hexAlpha(s?.color, numOr(fill.opacity, 1));
        if (!c) return null;
        const op = c.length === 9 ? ` stop-opacity="${f(parseInt(c.slice(7), 16) / 255)}"` : "";
        return `<stop offset="${f(Math.max(0, Math.min(1, numOr(s.at, 0))))}" stop-color="${c.slice(0, 7)}"${op}/>`;
      })
      .filter(Boolean);
    if (!stops.length) return null;
    const id = this.id("g");
    if (fill.type === "linear") {
      // CSS angles: 0deg points up, 90deg right; the gradient line spans the box's projection on that direction
      const a = (numOr(fill.angle, 180) * Math.PI) / 180;
      const dx = Math.sin(a);
      const dy = -Math.cos(a);
      const len = Math.abs(b.w * dx) + Math.abs(b.h * dy);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(cx - (dx * len) / 2)}" y1="${f(cy - (dy * len) / 2)}" x2="${f(cx + (dx * len) / 2)}" y2="${f(cy + (dy * len) / 2)}">${stops.join("")}</linearGradient>`);
    } else {
      // radial: an ellipse through the farthest corner (CSS `radial-gradient(at x y, …)`), in box units
      const [px, py] = Array.isArray(fill.center) ? [numOr(fill.center[0], 0.5), numOr(fill.center[1], 0.5)] : [0.5, 0.5];
      const r = Math.hypot(Math.max(px, 1 - px), Math.max(py, 1 - py));
      this.defs.push(`<radialGradient id="${id}" cx="${f(px)}" cy="${f(py)}" r="${f(r)}">${stops.join("")}</radialGradient>`);
    }
    return `url(#${id})`;
  }

  imageFill(r, b, fill) {
    const media = this.model.media?.[fill.media];
    if (!isObj(media)) return "";
    let href;
    const mode = this.opts.media || "embed";
    if (mode === "none") return "";
    if (mode === "embed" && media.bytes instanceof Uint8Array && MIME_EXT[media.mime]) href = `data:${media.mime};base64,${bytesToBase64(media.bytes)}`;
    else href = `media/${fill.media}.${MIME_EXT[media.mime] || "bin"}`;
    const fit = fill.fit || "cover";
    const [px, py] = Array.isArray(fill.pos) ? fill.pos : [0.5, 0.5];
    const al = (v) => (numOr(v, 0.5) < 0.34 ? "Min" : numOr(v, 0.5) > 0.66 ? "Max" : "Mid");
    const clip = this.id("c");
    this.defs.push(`<clipPath id="${clip}">${this.shape(r, b, "")}</clipPath>`);
    const op = numOr(fill.opacity, 1) < 1 ? ` opacity="${f(numOr(fill.opacity, 1))}"` : "";
    if (fit === "none" || fit === "tile") {
      const w = numOr(media.w, b.w);
      const h = numOr(media.h, b.h);
      if (fit === "tile") {
        const pat = this.id("p");
        this.defs.push(`<pattern id="${pat}" patternUnits="userSpaceOnUse" x="${f(b.x)}" y="${f(b.y)}" width="${f(w)}" height="${f(h)}"><image href="${esc(href)}" width="${f(w)}" height="${f(h)}"/></pattern>`);
        return this.shape(r, b, `fill="url(#${pat})"${op}`);
      }
      return `<image href="${esc(href)}" x="${f(b.x + (b.w - w) * numOr(px, 0.5))}" y="${f(b.y + (b.h - h) * numOr(py, 0.5))}" width="${f(w)}" height="${f(h)}" clip-path="url(#${clip})"${op}/>`;
    }
    const par = fit === "fill" ? "none" : `x${al(px)}Y${al(py)} ${fit === "contain" ? "meet" : "slice"}`;
    return `<image href="${esc(href)}" x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" preserveAspectRatio="${par}" clip-path="url(#${clip})"${op}/>`;
  }

  /** Fills of a box layer, bottom to top. */
  fills(r, b) {
    const out = [];
    for (const fill of Array.isArray(r.node.fills) ? r.node.fills : []) {
      if (!isObj(fill) || fill.visible === false) continue;
      if (fill.type === "solid") {
        const p = paint("fill", fill.color, numOr(fill.opacity, 1));
        if (p) out.push(this.shape(r, b, p));
      } else if (fill.type === "linear" || fill.type === "radial") {
        const g = this.gradient(fill, b);
        if (g) out.push(this.shape(r, b, `fill="${g}"`));
      } else if (fill.type === "conic") {
        this.note("conic gradients are drawn with their first color");
        const s = Array.isArray(fill.stops) ? fill.stops.find((x) => hexAlpha(x?.color)) : null;
        const p = s && paint("fill", s.color, numOr(fill.opacity, 1));
        if (p) out.push(this.shape(r, b, p));
      } else if (fill.type === "image") out.push(this.imageFill(r, b, fill));
    }
    return out.join("");
  }

  strokes(r, b) {
    const out = [];
    for (const s of Array.isArray(r.node.strokes) ? r.node.strokes : []) {
      if (!isObj(s) || s.visible === false) continue;
      const w = Math.max(0, numOr(s.w, 1));
      const align = s.align === "center" || s.align === "outside" ? s.align : "inside";
      const dash = Array.isArray(s.dash) && s.dash.length ? ` stroke-dasharray="${s.dash.map((d) => f(Math.max(0, numOr(d, 0)))).join(" ")}"` : "";
      const p = paint("stroke", s.color);
      if (!p) continue;
      if (Array.isArray(s.sides) && s.sides.length === 4 && new Set(s.sides.map((x) => numOr(x, 0))).size > 1) {
        // per-side widths: four strips (inside, as the CSS border; corner radii are not followed)
        const [t, rr, bb, l] = s.sides.map((x) => Math.max(0, numOr(x, 0)));
        const c = paint("fill", s.color);
        const strip = (x, y, sw, sh) => (sw > 0 && sh > 0 ? `<rect x="${f(x)}" y="${f(y)}" width="${f(sw)}" height="${f(sh)}" ${c}/>` : "");
        out.push(strip(b.x, b.y, b.w, t) + strip(b.x + b.w - rr, b.y, rr, b.h) + strip(b.x, b.y + b.h - bb, b.w, bb) + strip(b.x, b.y, l, b.h));
        continue;
      }
      if (!w) continue;
      const grow = align === "inside" ? -w / 2 : align === "outside" ? w / 2 : 0;
      out.push(this.shape(r, b, `fill="none" ${p} stroke-width="${f(w)}"${dash}`, grow));
    }
    return out.join("");
  }

  /** Drop shadows of a box layer: blurred copies of its outline under the fills. */
  shadows(r, b) {
    const out = [];
    for (const e of Array.isArray(r.node.effects) ? r.node.effects : []) {
      if (!isObj(e) || e.visible === false || e.type !== "shadow") continue;
      if (e.inset) {
        this.note("inner shadows are left out");
        continue;
      }
      if (numOr(e.spread, 0)) this.note("shadow spread is approximated by growing the outline");
      const p = paint("fill", e.color);
      if (!p) continue;
      const blur = Math.max(0, numOr(e.blur, 0));
      let filter = "";
      if (blur > 0) {
        const id = this.id("s");
        this.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(blur / 2)}"/></filter>`);
        filter = ` filter="url(#${id})"`;
      }
      out.push(`<g transform="translate(${f(numOr(e.x, 0))} ${f(numOr(e.y, 0))})"${filter}>${this.shape(r, b, p, numOr(e.spread, 0))}</g>`);
    }
    return out.join("");
  }

  /** A filter for layer blur and the drop shadows of vectors and text (as `filter: drop-shadow()` in css.js). */
  layerFilter(r, path) {
    const parts = [];
    let src = "SourceGraphic";
    for (const e of Array.isArray(r.node.effects) ? r.node.effects : []) {
      if (!isObj(e) || e.visible === false) continue;
      if (e.type === "blur" && numOr(e.radius, 0) > 0) {
        parts.push(`<feGaussianBlur in="${src}" stdDeviation="${f(numOr(e.radius, 0) / 2)}" result="b${parts.length}"/>`);
        src = `b${parts.length - 1}`;
      } else if (e.type === "backgroundBlur") this.note("background blur is left out");
    }
    if (path) {
      for (const e of Array.isArray(r.node.effects) ? r.node.effects : []) {
        if (!isObj(e) || e.visible === false || e.type !== "shadow" || e.inset) continue;
        const c = hexAlpha(e.color);
        if (!c) continue;
        const op = c.length === 9 ? parseInt(c.slice(7), 16) / 255 : 1;
        parts.push(`<feDropShadow in="${src}" dx="${f(numOr(e.x, 0))}" dy="${f(numOr(e.y, 0))}" stdDeviation="${f(Math.max(0, numOr(e.blur, 0)) / 2)}" flood-color="${c.slice(0, 7)}" flood-opacity="${f(op)}" result="d${parts.length}"/>`);
        src = `d${parts.length - 1}`;
      }
    }
    if (!parts.length) return "";
    const id = this.id("f");
    this.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts.join("")}</filter>`);
    return ` filter="url(#${id})"`;
  }

  vector(r, b) {
    const node = r.node;
    const fills = Array.isArray(node.fills) ? node.fills.filter((x) => isObj(x) && x.visible !== false) : [];
    const solid = [...fills].reverse().find((x) => x.type === "solid");
    const s = (Array.isArray(node.strokes) ? node.strokes : []).find((x) => isObj(x) && x.visible !== false);
    const stroke = s ? `${paint("stroke", s.color) || 'stroke="none"'} stroke-width="${f(Math.max(0, numOr(s.w, 1)))}"${Array.isArray(s.dash) && s.dash.length ? ` stroke-dasharray="${s.dash.map((d) => f(numOr(d, 0))).join(" ")}"` : ""}` : 'stroke="none"';
    if (r.type === "line") return `<line x1="${f(b.x)}" y1="${f(b.y)}" x2="${f(b.x + b.w)}" y2="${f(b.y + b.h)}" ${stroke}/>`;
    const d = typeof node.d === "string" ? node.d : "";
    if (!d) return "";
    const fill = solid ? paint("fill", solid.color, numOr(solid.opacity, 1)) || 'fill="none"' : 'fill="none"';
    return `<path transform="translate(${f(b.x)} ${f(b.y)})" d="${esc(d)}" fill-rule="${node.rule === "evenodd" ? "evenodd" : "nonzero"}" ${fill} ${stroke}/>`;
  }

  text(r, b) {
    if (!Array.isArray(b.lines) || !b.lines.length) return "";
    const base = textStyleOf(r.node);
    const runs = Array.isArray(r.node.text?.runs) ? r.node.text.runs : [];
    const s0 = (Array.isArray(r.node.strokes) ? r.node.strokes : []).find((x) => isObj(x) && x.visible !== false);
    const strokeAttr = s0 ? ` ${paint("stroke", s0.color) || ""} stroke-width="${f(Math.max(0, numOr(s0.w, 1)))}"` : "";
    const out = [];
    for (const line of b.lines) {
      const spans = line.segs.map((seg) => {
        const s = { ...base, ...(isObj(runs[seg.run]?.s) ? runs[seg.run].s : {}) };
        const attrs = [`x="${f(b.x + line.x + seg.x)}"`, `font-family="${esc(fontStack(s.font))}"`, `font-size="${f(Math.max(0.5, numOr(s.size, 16)))}"`];
        if (numOr(s.weight, 400) !== 400) attrs.push(`font-weight="${f(numOr(s.weight, 400))}"`);
        if (s.italic) attrs.push('font-style="italic"');
        if (numOr(s.tracking, 0)) attrs.push(`letter-spacing="${f(numOr(s.tracking, 0))}"`);
        if (s.decoration === "underline" || s.decoration === "strike") attrs.push(`text-decoration="${s.decoration === "strike" ? "line-through" : "underline"}"`);
        attrs.push(paint("fill", s.color) || 'fill="#000000"');
        return `<tspan ${attrs.join(" ")}>${esc(seg.text)}</tspan>`;
      });
      out.push(`<text y="${f(b.y + line.baseline)}" xml:space="preserve"${strokeAttr}>${spans.join("")}</text>`);
    }
    return out.join("");
  }

  node(r, boxes) {
    const b = boxes.get(r.key);
    if (!b) return ""; // hidden
    const node = r.node;
    const attrs = [`data-key="${esc(r.key)}"`];
    const opacity = Math.max(0, Math.min(1, numOr(field(node, "opacity"), 1)));
    if (opacity < 1) attrs.push(`opacity="${f(opacity)}"`);
    const blend = field(node, "blend");
    if (blend && blend !== "normal" && BLEND_OK.test(blend)) attrs.push(`style="mix-blend-mode:${blend}"`);
    const rot = numOr(field(node, "rot"), 0);
    if (rot) attrs.push(`transform="rotate(${f(rot)} ${f(b.x + b.w / 2)} ${f(b.y + b.h / 2)})"`);
    const path = r.type === "vector" || r.type === "line";
    const filter = this.layerFilter(r, path || r.type === "text");
    let body = "";
    if (path) body = this.vector(r, b);
    else {
      // text shadows are drop shadows of the glyphs (layerFilter), not of the box
      body = (r.type === "text" ? "" : this.shadows(r, b)) + this.fills(r, b);
      if (r.type !== "text") body += this.strokes(r, b);
      if (r.type === "text") body += this.text(r, b);
    }
    let kids = r.children.map((c) => this.node(c, boxes)).join("");
    if (kids && CONTAINERS.has(r.type) && (field(node, "clip") === true || field(node, "scroll") !== "none")) {
      const id = this.id("c");
      this.defs.push(`<clipPath id="${id}">${this.shape(r, b, "")}</clipPath>`);
      kids = `<g clip-path="url(#${id})">${kids}</g>`;
    }
    return `<g ${attrs.join(" ")}${filter}>${body}${kids}</g>`;
  }
}

/** Finds the resolved node with a key in a resolved tree. */
function findKey(root, key) {
  const stack = [root];
  while (stack.length) {
    const r = stack.pop();
    if (r.key === key) return r;
    for (const c of r.children) stack.push(c);
  }
  return null;
}

/**
 * Renders one layer as an SVG document (see the header).
 * @param {object} model
 * @param {string} key
 * @param {{ modes?: object, measurer?: object, media?: "embed"|"link"|"none", scale?: number, background?: string|null }} [opts]
 */
export function renderSvg(model, key, opts = {}) {
  const realId = String(key).split("/")[0];
  if (!isObj(model.nodes?.[realId])) throw new Error(`No layer “${key}”.`);
  const up = ancestors(model, realId);
  const topId = up.length ? up[up.length - 1] : realId;
  model = withModes(model, topId, opts.modes);
  const resolver = createResolver(model, opts.modes ? { modes: opts.modes } : {});
  const top = resolver.tree(topId);
  const target = top && findKey(top, key);
  if (!target) throw new Error(`No layer “${key}” in the resolved design.`);
  const L = layout(top, { origin: true, measurer: opts.measurer });
  const box = L.boxes.get(target.key);
  if (!box) throw new Error(`The layer “${key}” is hidden; nothing to render.`);
  const P = new Painter(model, opts);
  const body = P.node(target, L.boxes);
  const scale = numOr(opts.scale, 1) > 0 ? numOr(opts.scale, 1) : 1;
  const w = Math.max(1, box.w);
  const h = Math.max(1, box.h);
  const bg = opts.background ? paint("fill", opts.background) : null;
  const name = String(target.node?.name || target.key);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w * scale)}" height="${f(h * scale)}" viewBox="${f(box.x)} ${f(box.y)} ${f(w)} ${f(h)}" data-approximate="true">`,
    `<title>${esc(name)}</title>`,
    `<desc>Rendered by ofini proto (pure layout solver, approximate: base-14 font metrics).</desc>`,
    P.defs.length ? `<defs>${P.defs.join("")}</defs>` : "",
    bg ? `<rect x="${f(box.x)}" y="${f(box.y)}" width="${f(w)}" height="${f(h)}" ${bg}/>` : "",
    body,
    "</svg>",
    "",
  ].join("\n");
  return { svg, width: w * scale, height: h * scale, approximate: true, notes: [...P.notes], warnings: resolver.warnings.slice() };
}
