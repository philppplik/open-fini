// DOM helpers for UI that is built once and must follow a live language switch.
//
//   h("button", { ...ta({ "aria-label": "Undo", tip: "Undo" }) }, tspan("Export"))
//
// ta(map)    translated attributes + data-i18n-* markers (keys: "aria-label", "title", "placeholder", "tip" = data-tip)
// tspan(txt) <span data-i18n="txt">translated</span>
// The markers are re-applied by translateDom() (index.js) which main.js calls on every locale change.
// The extractor scans these calls (see IMPLICIT in scripts/i18n-extract.mjs).

import { h } from "../core/util.js";
import { t } from "./index.js";

const ATTR = { "aria-label": "aria-label", title: "title", placeholder: "placeholder", tip: "data-tip" };

export function ta(map) {
  const out = {};
  for (const [k, text] of Object.entries(map)) {
    if (!text) continue;
    const attr = ATTR[k] || k;
    out[attr] = t(text);
    out[`data-i18n-${k}`] = text;
  }
  return out;
}

export const tspan = (text, cls = "") => h(cls ? `span.${cls}` : "span", { "data-i18n": text }, t(text));
