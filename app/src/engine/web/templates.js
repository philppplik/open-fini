// Starter projects for the Code studio. Each template is a set of plain files: semantic HTML5, one stylesheet with a
// desktop-first cascade (@media max-width 991px / 767px / 478px), a small script, inline SVG or assets/*.svg imagery.
// No external requests, no web fonts, no raster images. See docs/web-engine.md.
import { blank } from "./tpl/blank.js";
import { landing } from "./tpl/landing.js";
import { portfolio } from "./tpl/portfolio.js";
import { blog } from "./tpl/blog.js";
import { docs } from "./tpl/docs.js";
import { linkinbio } from "./tpl/linkinbio.js";

/**
 * @typedef {{
 *   id: string, name: string, description: string, category: 'Starter'|'Business'|'Personal'|'Content',
 *   accent: string, files: Record<string, string>
 * }} Template
 */

/** @type {Template[]} */
export const TEMPLATES = [blank, landing, portfolio, blog, docs, linkinbio];

/**
 * The template with the given id (a copy of its file map, so callers can modify it), or null.
 * @param {string} id
 * @returns {Template|null}
 */
export function getTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  return t ? { ...t, files: { ...t.files } } : null;
}
