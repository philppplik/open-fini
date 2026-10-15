// Generates OpenFini's own UI glyphs (the "of" icon library) as 16×16 SVG files.
//   node scripts/make-ui-icons.mjs
// All icons are original, drawn on a 16px grid, and inherit `currentColor`.
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "app", "assets", "icons");

// kind: 's' = stroked outline glyph, 'f' = filled glyph
const ICONS = {
  // studios
  vector: ["s", `<path d="M3 12C3 6.5 7.5 4 13 4"/><rect x="1.5" y="10.5" width="3" height="3" rx=".4"/><rect x="11.5" y="2.5" width="3" height="3" rx=".4"/>`],
  pixel: ["f", `<path d="M2 2h3.5v3.5H2zM9 2h3.5v3.5H9zM5.5 5.5H9V9H5.5zM12.5 5.5H16V9h-3.5zM2 9h3.5v3.5H2zM9 9h3.5v3.5H9zM5.5 12.5H9V16H5.5z" transform="translate(-1 -1) scale(.95)"/>`],
  layout: ["s", `<rect x="2.5" y="1.5" width="11" height="13" rx="1.2"/><path d="M5 5h6M5 8h6M5 11h3.5"/>`],
  export: ["s", `<path d="M8 10.5V2M5 5l3-3 3 3M3 9v4.5h10V9"/>`],
  code: ["s", `<path d="M5.2 4.4L1.6 8l3.6 3.6M10.8 4.4L14.4 8l-3.6 3.6M9.1 2.6L6.9 13.4"/>`],
  // selection / pixel tools
  marquee: ["s", `<rect x="2.5" y="2.5" width="11" height="11" stroke-dasharray="2 2"/>`],
  "marquee-ellipse": ["s", `<circle cx="8" cy="8" r="5.5" stroke-dasharray="2 2"/>`],
  lasso: ["s", `<path d="M3.2 7.2C3 4.2 6 2.6 9 3.3s4.4 3 2.6 5c-1.7 2-5.2 1.5-6 3.2-.6 1.3.6 2.4 2 2.1"/><circle cx="4" cy="12" r="1" fill="currentColor"/>`],
  "poly-lasso": ["s", `<path d="M2.5 11.5L4.5 3.5l5.5 2.2 3.5 5.3-4.8 2.5z" stroke-dasharray="2.2 1.6"/>`],
  wand: ["s", `<path d="M2.5 13.5L9.5 6.5"/><path d="M11 1.8v2.6M9.7 3.1h2.6M13.4 6.5v2M12.4 7.5h2M7 2.4v1.4M6.3 3.1h1.4"/>`],
  "color-range": ["s", `<circle cx="8" cy="8" r="5.6"/><path d="M5 6.2c1-1 2.2-1 3 0M9 10c1-1 2-1 3 0" /><circle cx="6" cy="9.6" r=".8" fill="currentColor"/>`],
  crop: ["s", `<path d="M4 1.5v10.5h10.5M1.5 4H12v10.5"/>`],
  brush: ["s", `<path d="M13.6 2.2C9.8 3.9 7.6 6 6.4 9l1.7 1.6c3-1 5.3-3.2 5.5-8.4z"/><path d="M5.8 9.6C3.6 9.6 2.6 11 2.6 13.4c2.4 0 3.8-1 3.8-3"/>`],
  "pixel-pencil": ["s", `<path d="M2.5 13.5l.9-3.4 7.6-7.6 2.5 2.5-7.6 7.6z"/><path d="M9.7 3.8l2.5 2.5"/>`],
  clone: ["s", `<path d="M5 10h6v2.2H5zM7 10V6.6a1 1 0 0 1 2 0V10M3.5 14h9"/><circle cx="8" cy="4" r="1.6"/>`],
  smudge: ["s", `<path d="M3 13.2c1.8-3.8 3.8-6.3 7.2-8.4l2 2.1c-2 3.3-4.3 5.4-8.5 7.2z"/><path d="M11.5 3.2l1.3 1.3"/>`],
  gradient: ["f", `<rect x="2" y="2" width="4" height="12" opacity=".22"/><rect x="6" y="2" width="4" height="12" opacity=".55"/><rect x="10" y="2" width="4" height="12"/>`],
  liquify: ["s", `<path d="M2 5.5c2-3 4 3 6 0s4 3 6 0M2 10.5c2-3 4 3 6 0s4 3 6 0"/>`],
  slice: ["s", `<rect x="2.5" y="2.5" width="11" height="11" stroke-dasharray="3 1.6"/><path d="M2 8h12M8 2v12"/>`],
  "frame-text": ["s", `<rect x="2.5" y="2.5" width="11" height="11" rx=".6"/><path d="M5 5.5h6M5 8h6M5 10.5h3.5"/>`],
  "image-frame": ["s", `<rect x="2.5" y="2.5" width="11" height="11" rx=".6"/><path d="M3 12l3-4 2 2.2 2-3 3 4.8"/><circle cx="6" cy="5.6" r="1"/>`],
  // node editing
  "node-sharp": ["s", `<rect x="5.2" y="5.2" width="5.6" height="5.6"/><path d="M2 2l3.2 3.2M14 2l-3.2 3.2"/>`],
  "node-smooth": ["s", `<circle cx="8" cy="8" r="2.6"/><path d="M1.5 8h3.9M10.6 8h3.9"/>`],
  "node-symmetric": ["s", `<circle cx="8" cy="8" r="2.4"/><path d="M3.5 8h2.1M10.4 8h2.1"/><circle cx="2.4" cy="8" r="1" fill="currentColor"/><circle cx="13.6" cy="8" r="1" fill="currentColor"/>`],
  "node-join": ["s", `<circle cx="3.8" cy="8" r="2"/><circle cx="12.2" cy="8" r="2"/><path d="M5.8 8h4.4"/>`],
  "node-break": ["s", `<circle cx="3.8" cy="8" r="2"/><circle cx="12.2" cy="8" r="2"/><path d="M6.3 5.8l1.4 1.4M9.7 10.2L8.3 8.8"/>`],
  // alignment
  "align-start": ["f", `<rect x="1.5" y="1" width="1.4" height="14"/><rect x="4.5" y="3" width="9.5" height="3.6" rx=".6"/><rect x="4.5" y="9.4" width="6" height="3.6" rx=".6"/>`],
  "align-center": ["f", `<rect x="7.3" y="1" width="1.4" height="14"/><rect x="2.5" y="3" width="11" height="3.6" rx=".6"/><rect x="4.5" y="9.4" width="7" height="3.6" rx=".6"/>`],
  "align-end": ["f", `<rect x="13.1" y="1" width="1.4" height="14"/><rect x="2" y="3" width="9.5" height="3.6" rx=".6"/><rect x="5.5" y="9.4" width="6" height="3.6" rx=".6"/>`],
  "align-top": ["f", `<rect x="1" y="1.5" width="14" height="1.4"/><rect x="3" y="4.5" width="3.6" height="9.5" rx=".6"/><rect x="9.4" y="4.5" width="3.6" height="6" rx=".6"/>`],
  "align-middle": ["f", `<rect x="1" y="7.3" width="14" height="1.4"/><rect x="3" y="2.5" width="3.6" height="11" rx=".6"/><rect x="9.4" y="4.5" width="3.6" height="7" rx=".6"/>`],
  "align-bottom": ["f", `<rect x="1" y="13.1" width="14" height="1.4"/><rect x="3" y="2" width="3.6" height="9.5" rx=".6"/><rect x="9.4" y="5.5" width="3.6" height="6" rx=".6"/>`],
  divide: ["s", `<path d="M2.5 2.5h7v3.5M2.5 2.5v7h3.5M13.5 13.5h-7V10M13.5 13.5v-7H10"/><path d="M6 6h4v4H6z" opacity=".6"/>`],
  // gradient types
  "grad-linear": ["f", `<rect x="2" y="3" width="2.4" height="10" opacity=".2"/><rect x="5" y="3" width="2.4" height="10" opacity=".45"/><rect x="8" y="3" width="2.4" height="10" opacity=".75"/><rect x="11" y="3" width="2.4" height="10"/>`],
  "grad-radial": ["s", `<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3.6" opacity=".7"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>`],
  "grad-conic": ["s", `<circle cx="8" cy="8" r="6"/><path d="M8 8V2M8 8l5.2 3"/><path d="M8 4a4 4 0 0 1 3.5 2" opacity=".6"/>`],
};

await mkdir(out, { recursive: true });
for (const [name, [kind, body]] of Object.entries(ICONS)) {
  const attrs = kind === "s" ? 'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"' : 'fill="currentColor"';
  await writeFile(join(out, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" ${attrs}>${body}</svg>\n`);
}
console.log(`Wrote ${Object.keys(ICONS).length} icons to ${out}`);
