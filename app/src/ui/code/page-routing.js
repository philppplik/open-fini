// Which page the visual preview must show when an editor file becomes active. Pure (no DOM), unit tested.
//
// Every way of activating a file (explorer, editor tab click, Ctrl+Tab / Mod+PageDown, closing a tab that activates a
// neighbor, Quick Open, search results, outline, ...) ends in CodeEditors' "active" event; the workspace feeds it
// through previewPageFor() so the preview, page selector, breadcrumb and style panel follow the active HTML file.
// Non-HTML files (CSS, JS, images ...) keep the last previewed page.

export const isHtmlPath = (p) => /\.html?$/i.test(String(p || ""));

/**
 * @param {string|null} active  the file that just became active
 * @param {{pages: string[], current: string|null, keepPage?: boolean}} o
 *   pages: HTML pages of the project; current: the page shown now; keepPage: the caller asked to leave the preview alone
 * @returns {string|null} the page to show, or null when the preview stays as it is
 */
export function previewPageFor(active, { pages, current, keepPage = false }) {
  if (keepPage || !active || !isHtmlPath(active)) return null;
  if (!pages.includes(active) || active === current) return null;
  return active;
}
