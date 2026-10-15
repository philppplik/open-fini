// Pixel engine entry point: re-exports every module and provides a unified effect registry.
// Pure ES modules, no DOM / Canvas / ImageData: runs in the browser, in a Web Worker and in Node.js.

export * from "./image.js";
export * from "./adjustments.js";
export * from "./filters.js";
export * from "./selection.js";
export * from "./fill.js";
export * from "./retouch.js";
export * from "./liquify.js";
export * from "./histogram.js";
export * from "./develop.js";
export * from "./trace.js";
export * from "./transform.js";
export { gaussianBlurImage, boxBlurImage, gaussianBlurPlane, boxBlurPlane } from "./blur.js";

import { ADJUSTMENTS } from "./adjustments.js";
import { FILTERS } from "./filters.js";
import { DEVELOP, TONEMAP } from "./develop.js";

/**
 * Lists every registered effect. `group` repeats `kind` so hosts can use either name when calling {@link getEffect}.
 * @returns {{kind: 'adjustment'|'filter'|'develop', group: 'adjustment'|'filter'|'develop', id: string, label: string, category: string}[]}
 */
export function listEffects() {
  const out = [];
  for (const m of Object.values(ADJUSTMENTS)) out.push({ kind: "adjustment", group: "adjustment", id: m.id, label: m.label, category: m.category });
  for (const m of Object.values(FILTERS)) out.push({ kind: "filter", group: "filter", id: m.id, label: m.label, category: m.category });
  for (const m of [DEVELOP, TONEMAP]) out.push({ kind: "develop", group: "develop", id: m.id, label: m.label, category: m.category });
  return out;
}

/**
 * Looks up an effect module.
 * @param {'adjustment'|'filter'|'develop'} kind registry
 * @param {string} id effect id, e.g. 'levels', 'gaussian-blur', 'develop', 'tone-mapping'
 * @returns {import('./effect.js').EffectModule|null} the module, or null when unknown
 */
export function getEffect(kind, id) {
  if (kind === "adjustment") return Object.prototype.hasOwnProperty.call(ADJUSTMENTS, id) ? ADJUSTMENTS[id] : null;
  if (kind === "filter") return Object.prototype.hasOwnProperty.call(FILTERS, id) ? FILTERS[id] : null;
  if (kind === "develop") return id === DEVELOP.id ? DEVELOP : id === TONEMAP.id ? TONEMAP : null;
  return null;
}
