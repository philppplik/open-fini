// Presentation app: DOM rendering of one slide, shared by the editor canvas, the thumbnails, the slide sorter and the
// presenter. Geometry and text metrics match render.js (PDF/PNG export). Pictures are object URLs owned by a MediaUrls
// cache (one per view; revoke with dispose()).
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import * as M from "./model.js";
import { TEXT_PAD, LINE_HEIGHT } from "./render.js";

export class MediaUrls {
  constructor() {
    this.map = new Map(); // id → { bytes, url }
  }
  url(deck, id) {
    const m = deck.media?.[id];
    if (!m?.bytes) return null;
    const hit = this.map.get(id);
    if (hit && hit.bytes === m.bytes) return hit.url;
    if (hit) URL.revokeObjectURL(hit.url);
    const url = URL.createObjectURL(new Blob([m.bytes], { type: m.mime }));
    this.map.set(id, { bytes: m.bytes, url });
    return url;
  }
  dispose() {
    for (const v of this.map.values()) URL.revokeObjectURL(v.url);
    this.map.clear();
  }
}

const FLEX = { top: "flex-start", middle: "center", bottom: "flex-end" };

/** The text block of an element (paragraph divs inside a flex column). */
export function textNode(deck, e, { hints = false } = {}) {
  const look = M.textLook(deck, e);
  const empty = !e.text;
  const el = h("div.of-sl-txt", {
    style: {
      padding: `${TEXT_PAD.y}px ${TEXT_PAD.x}px`,
      justifyContent: FLEX[look.valign] || "flex-start",
      fontFamily: `"${look.font}", sans-serif`,
      fontSize: `${look.size * M.PT}px`,
      lineHeight: String(LINE_HEIGHT),
      color: look.color,
      fontWeight: look.bold ? "700" : "400",
      fontStyle: look.italic ? "italic" : "normal",
      textDecoration: look.underline ? "underline" : "none",
      textAlign: look.align,
    },
  });
  if (empty && hints && e.ph) el.append(h("div.of-sl-p.of-sl-hint", t(M.placeholderHint(e.ph))));
  else el.append(...paragraphs(e.text, look.bullets));
  return el;
}

export const paragraphs = (text, bullets) => String(text || "").split("\n").map((p) => h(`div.of-sl-p${bullets && p.trim() ? ".is-bullet" : ""}`, p || "​"));

function shapeSvg(e) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "of-sl-svg");
  svg.setAttribute("width", String(Math.max(1, e.w)));
  svg.setAttribute("height", String(Math.max(1, e.h)));
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", M.pathToSvg(M.shapePath(e.type === "shape" ? e.shape : "rect", e.w, e.h)));
  path.setAttribute("fill", e.shape === "line" ? "none" : e.fill || "none");
  path.setAttribute("stroke", e.stroke && e.strokeWidth ? e.stroke : "none");
  path.setAttribute("stroke-width", String(e.strokeWidth || 0));
  path.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(path);
  return svg;
}

/** One element as a positioned node (data-id = element id). */
export function elementNode(deck, e, urls, { hints = false } = {}) {
  const tf = [`rotate(${e.rot || 0}deg)`, e.flipH || e.flipV ? `scale(${e.flipH ? -1 : 1}, ${e.flipV ? -1 : 1})` : ""].join(" ");
  const node = h(`div.of-sl-el.is-${e.type}`, { "data-id": e.id, style: { left: `${e.x}px`, top: `${e.y}px`, width: `${e.w}px`, height: `${Math.max(e.h, 1)}px`, transform: tf } });
  if (e.type === "image") {
    const src = urls?.url(deck, e.media);
    node.append(src ? h("img.of-sl-img", { src, alt: deck.media[e.media]?.name || "", draggable: "false" }) : h("div.of-sl-missing", t("Picture not available")));
  } else if (e.type === "table") {
    const look = M.textLook(deck, e);
    const tbl = h("table.of-sl-table", { style: { fontFamily: `"${look.font}", sans-serif`, fontSize: `${look.size * M.PT}px`, color: look.color } },
      ...e.rows.map((r, ri) => h("tr", ...r.map((c, ci) => h(e.header && ri === 0 ? "th" : "td", { "data-r": String(ri), "data-c": String(ci), style: { background: e.header && ri === 0 ? null : e.fill || null } }, ...paragraphs(c, false))))));
    tbl.style.setProperty("--of-sl-grid", e.stroke || "#9ca3af");
    tbl.style.setProperty("--of-sl-head", deck.theme.accent);
    node.append(tbl);
  } else {
    if (e.type === "shape" || e.fill || (e.stroke && e.strokeWidth)) node.append(shapeSvg(e));
    if (e.type !== "shape" || e.shape !== "line") node.append(textNode(deck, e, { hints }));
  }
  return node;
}

/** A whole slide at 1:1 (slide px); scale it with CSS transforms. */
export function slideNode(deck, slide, urls, { hints = false } = {}) {
  const bg = slide.background?.media ? urls?.url(deck, slide.background.media) : null;
  const el = h("div.of-sl-slide", { style: { width: `${deck.size.w}px`, height: `${deck.size.h}px`, background: slide.background?.color || deck.theme.bg, backgroundImage: bg ? `url("${bg}")` : null } });
  el.append(...slide.elements.map((e) => elementNode(deck, e, urls, { hints })));
  return el;
}

/** A slide scaled into a box of `width` px (thumbnails, sorter, presenter preview). */
export function scaledSlide(deck, slide, urls, width) {
  const s = width / deck.size.w;
  const inner = slideNode(deck, slide, urls);
  inner.style.transform = `scale(${s})`;
  inner.style.transformOrigin = "0 0";
  return h("div.of-sl-scaled", { style: { width: `${width}px`, height: `${Math.round(deck.size.h * s)}px` } }, inner);
}
