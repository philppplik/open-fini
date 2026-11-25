// HTML sanitizer of the Proto importers (docs/concepts/proto-studio.md §14.1, task T8). Pure: parses with the Code
// studio's offset-preserving parser (engine/web/html.js) and writes the document again from an allow-list, so nothing
// the importer renders or maps can run script, navigate, submit, embed other documents or load remote resources.
//
//   sanitizeHtml(html, { report? }) → { html, removed: { scripts, handlers, urls, embeds, remote } }
//   serializeElement(el) → markup of one parsed element (used for inline <svg>)
//
// Removed: <script>, <noscript>, <template>, <iframe>, <frame>, <frameset>, <object>, <embed>, <applet>, <base>,
// <meta http-equiv>, <link>, <portal>, <foreignObject>; every on* event handler, `srcdoc`, `formaction`, `action`,
// `ping`; `javascript:`, `vbscript:` and `data:text/html` URLs; remote URLs (http, https, protocol-relative, file) in
// src, href, poster, srcset and in CSS `url()` (only data: images survive); `@import` and `expression()` in CSS.
// The sandboxed preview frame adds a Content-Security-Policy on top (no script but the probe, no network).
import { parseHtml, decodeEntities, escapeAttr, escapeText, isVoidTag } from "../../web/html.js";

const DROP = new Set(["script", "noscript", "template", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "link", "portal", "foreignobject", "param", "dialog"]);
const URL_ATTRS = new Set(["src", "href", "xlink:href", "poster", "background", "action", "formaction", "cite", "data", "srcset", "longdesc", "lowsrc", "dynsrc", "manifest", "codebase", "usemap"]);
const SVG_CASE = { viewbox: "viewBox", preserveaspectratio: "preserveAspectRatio", gradientunits: "gradientUnits", gradienttransform: "gradientTransform", patternunits: "patternUnits", patterntransform: "patternTransform", lineargradient: "linearGradient", radialgradient: "radialGradient", clippath: "clipPath", textpath: "textPath", foreignobject: "foreignObject", spreadmethod: "spreadMethod", markerwidth: "markerWidth", markerheight: "markerHeight" };

const BAD_URL = /^\s*(javascript|vbscript|livescript)\s*:|^\s*data\s*:\s*(text\/html|application\/(x?html|javascript|xml)|image\/svg\+xml[^,]*;?\s*,\s*[\s\S]*<script)/i;
const REMOTE = /^\s*(https?:|\/\/|file:|ftp:|blob:)/i;

/** Cleans CSS text: no @import, no expression(), no behavior/-moz-binding, url() only for data: images. */
export function sanitizeCss(css, counts = { remote: 0, scripts: 0 }) {
  // no "<" at all: CSS needs none, and a style element can then never be closed or opened from inside
  let s = String(css ?? "").replace(/</g, "\\3c ");
  s = s.replace(/@import[^;]*;?/gi, () => (counts.remote++, ""));
  s = s.replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript\s*:/gi, () => (counts.scripts++, "invalid("));
  s = s.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (m, q, u) => {
    if (/^\s*data:image\//i.test(u) && !/<script/i.test(u)) return m;
    counts.remote++;
    return "none";
  });
  return s;
}

/**
 * @param {string} html
 * @param {{ report?: { dropped: Function, note: Function } }} [o]
 */
export function sanitizeHtml(html, { report = null } = {}) {
  const parsed = parseHtml(String(html ?? ""));
  const removed = { scripts: 0, handlers: 0, urls: 0, embeds: 0, remote: 0 };
  const counts = { remote: 0, scripts: 0 };
  const out = [];
  const write = (node, parentTag, inSvg) => {
    if (node.type === "text") {
      if (parentTag === "style") out.push(sanitizeCss(node.text, counts));
      else if (parentTag === "textarea" || parentTag === "title") out.push(escapeText(decodeEntities(node.text)));
      else out.push(escapeText(decodeEntities(node.text)));
      return;
    }
    if (node.type !== "element") return;
    const tag = node.tag;
    if (tag === "script") return void removed.scripts++;
    if (DROP.has(tag)) return void removed.embeds++;
    if (tag === "meta") {
      if (node.attrs.some((a) => a.name === "charset")) out.push('<meta charset="utf-8">');
      return;
    }
    const svg = inSvg || tag === "svg";
    const name = svg ? SVG_CASE[tag] || tag : tag;
    out.push(`<${name}`);
    for (const a of node.attrs) {
      const an = a.name.toLowerCase();
      let v = a.value === null ? "" : decodeEntities(a.value);
      if (an.startsWith("on")) {
        removed.handlers++;
        continue;
      }
      if (an === "srcdoc" || an === "formaction" || an === "action" || an === "ping" || an === "http-equiv" || an === "target") continue;
      if (URL_ATTRS.has(an)) {
        if (BAD_URL.test(v)) {
          removed.urls++;
          continue;
        }
        if (an === "srcset" || REMOTE.test(v) || ((an === "src" || an === "poster") && !/^\s*data:image\//i.test(v)) || (an === "href" && svg && !v.trim().startsWith("#") && !/^\s*data:image\//i.test(v))) {
          if (an === "href" && !svg && !BAD_URL.test(v)) {
            // links stay as text; their target is not followed
            out.push(` data-href="${escapeAttr(v.slice(0, 2000))}"`);
            continue;
          }
          removed.remote++;
          continue;
        }
      }
      if (an === "style") v = sanitizeCss(v, counts);
      const outName = svg ? SVG_CASE[an] || a.name : an;
      out.push(a.value === null ? ` ${outName}` : ` ${outName}="${escapeAttr(v)}"`);
    }
    out.push(">");
    if (isVoidTag(tag) && !svg) return;
    for (const c of node.children) write(c, tag, svg);
    out.push(`</${name}>`);
  };
  for (const n of parsed.children) write(n, null, false);
  removed.remote += counts.remote;
  removed.scripts += counts.scripts;
  if (report) {
    if (removed.scripts) report.dropped("Scripts were removed; nothing in the imported HTML runs.");
    if (removed.handlers) report.dropped(`${removed.handlers} event handler attribute${removed.handlers === 1 ? " was" : "s were"} removed.`);
    if (removed.urls) report.dropped("Script URLs (javascript:) were removed.");
    if (removed.embeds) report.dropped("Embedded documents and objects (iframes, objects, embeds, links) were removed.");
    if (removed.remote) report.dropped("Remote resources (images, style sheets, fonts) were not loaded; only embedded data: images are imported.");
  }
  return { html: out.join(""), removed };
}

/** Markup of one parsed element (SVG names get their XML spelling back). */
export function serializeElement(el) {
  const out = [];
  const write = (node, svg) => {
    if (node.type === "text") return void out.push(escapeText(decodeEntities(node.text)));
    if (node.type !== "element") return;
    const isSvg = svg || node.tag === "svg";
    const name = isSvg ? SVG_CASE[node.tag] || node.tag : node.tag;
    out.push(`<${name}`);
    for (const a of node.attrs) out.push(a.value === null ? ` ${isSvg ? SVG_CASE[a.name] || a.name : a.name}` : ` ${isSvg ? SVG_CASE[a.name] || a.name : a.name}="${escapeAttr(decodeEntities(a.value))}"`);
    out.push(isSvg && !node.children.length ? "/>" : ">");
    if (isSvg && !node.children.length) return;
    if (isVoidTag(node.tag) && !isSvg) return;
    for (const c of node.children) write(c, isSvg);
    out.push(`</${name}>`);
  };
  write(el, false);
  return out.join("");
}
