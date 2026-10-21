// Starter projects for the Code studio. Each template is a set of plain files: semantic HTML5, one stylesheet with a
// desktop-first cascade (@media max-width 991px / 767px / 478px), a small script, inline SVG or assets/*.svg imagery.
// No external requests, no web fonts, no raster images. See docs/web-engine.md.
import { blank } from "./tpl/blank.js";
import { landing } from "./tpl/landing.js";
import { portfolio } from "./tpl/portfolio.js";
import { blog } from "./tpl/blog.js";
import { docs } from "./tpl/docs.js";
import { linkinbio } from "./tpl/linkinbio.js";
import { tailwind, bootstrap } from "./tpl/fw-css.js";
import { FRAMEWORK_JS_TEMPLATES } from "./tpl/fw-js.js";
import { mdBlog, mdDocs } from "./tpl/fw-content.js";
import { pwa } from "./tpl/fw-pwa.js";

/**
 * @typedef {{
 *   id: string, name: string, description: string, category: 'Starter'|'Business'|'Personal'|'Content'|'Framework',
 *   accent: string, files: Record<string, string>, framework?: boolean, libs?: string[]
 * }} Template
 * `framework: true` marks the templates that load libraries from a CDN or are generated from Markdown (see docs/frameworks.md);
 * the first six are plain HTML and CSS without external requests.
 */

/** @type {Template[]} */
export const TEMPLATES = [blank, landing, portfolio, blog, docs, linkinbio, tailwind, bootstrap, ...FRAMEWORK_JS_TEMPLATES, mdBlog, mdDocs, pwa];

/**
 * The template with the given id (a copy of its file map, so callers can modify it), or null.
 * @param {string} id
 * @returns {Template|null}
 */
export function getTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  return t ? { ...t, files: { ...t.files } } : null;
}
