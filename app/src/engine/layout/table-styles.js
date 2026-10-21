/**
 * Table style presets. A table style is plain JSON stored inside each table (so a document never depends on
 * built-ins) and can be saved into the document (`doc.tableStyles`) for reuse.
 *
 * @module table-styles
 */

/**
 * @typedef {Object} TableStyle
 * @property {string} family   font family
 * @property {number} size     font size in px
 * @property {number} weight   body font weight
 * @property {string} color    body text color
 * @property {string|null} fill       body fill (null = transparent)
 * @property {string|null} headFill   header fill
 * @property {string} headColor       header text color
 * @property {number} headWeight
 * @property {boolean} zebra          alternate body row fill
 * @property {string} altFill         fill of every second body row when `zebra`
 * @property {string|null} firstColFill  fill of the header columns
 * @property {number} firstColWeight  font weight of the header columns
 * @property {string} borderColor
 * @property {number} borderWidth
 * @property {boolean} hLines  horizontal lines between rows
 * @property {boolean} vLines  vertical lines between columns
 * @property {boolean} outer   outer frame
 * @property {{color:string,width:number}|null} headLine  line under the header rows
 * @property {number} padX
 * @property {number} padY
 * @property {number} lineHeight
 */

/** @type {TableStyle} */
export const BASE_STYLE = {
  family: 'Inter',
  size: 14,
  weight: 400,
  color: '#111827',
  fill: null,
  headFill: '#f3f4f6',
  headColor: '#111827',
  headWeight: 700,
  zebra: false,
  altFill: '#f9fafb',
  firstColFill: null,
  firstColWeight: 700,
  borderColor: '#d1d5db',
  borderWidth: 1,
  hLines: true,
  vLines: false,
  outer: false,
  headLine: { color: '#111827', width: 1.5 },
  padX: 10,
  padY: 7,
  lineHeight: 1.25,
};

/** @type {Record<string, {name:string, style:Partial<TableStyle>}>} */
export const TABLE_PRESETS = {
  clean: { name: 'Clean', style: {} },
  grid: { name: 'Grid', style: { vLines: true, outer: true, headLine: null, headFill: '#e5e7eb', borderColor: '#9ca3af' } },
  striped: { name: 'Striped', style: { zebra: true, hLines: false, headFill: '#e5e7eb', headLine: null, altFill: '#f3f4f6' } },
  minimal: { name: 'Minimal', style: { headFill: null, borderColor: '#e5e7eb', headLine: { color: '#9ca3af', width: 1 }, padY: 6 } },
  dark: { name: 'Dark header', style: { headFill: '#111827', headColor: '#ffffff', headLine: null, zebra: true, altFill: '#f3f4f6', hLines: false } },
  accent: { name: 'Accent', style: { headFill: '#4f46e5', headColor: '#ffffff', headLine: null, zebra: true, altFill: '#eef2ff', hLines: false, borderColor: '#c7d2fe' } },
  soft: { name: 'Soft', style: { headFill: '#ecfdf5', headColor: '#065f46', headLine: { color: '#10b981', width: 2 }, zebra: false, borderColor: '#d1fae5', vLines: false } },
  ledger: { name: 'Ledger', style: { family: 'Georgia', headFill: null, headLine: { color: '#111827', width: 2 }, hLines: true, borderColor: '#d1d5db', firstColWeight: 400, size: 15 } },
};

export const PRESET_IDS = Object.keys(TABLE_PRESETS);

/**
 * Resolves a preset id, a saved style or a partial style object to a complete {@link TableStyle}.
 * @param {string|Partial<TableStyle>|null|undefined} spec
 * @param {Record<string, {name:string, style:Partial<TableStyle>}>} [saved]
 * @returns {TableStyle}
 */
export function resolveStyle(spec, saved) {
  let part = {};
  if (typeof spec === 'string') {
    const p = TABLE_PRESETS[spec] || (saved && saved[spec]);
    part = p ? p.style : {};
  } else if (spec && typeof spec === 'object') part = spec;
  const out = { ...BASE_STYLE, ...part };
  if (part.headLine === undefined) out.headLine = BASE_STYLE.headLine ? { ...BASE_STYLE.headLine } : null;
  return out;
}

/** Fully expanded copy of a preset (safe to store in a node and edit). */
export const presetStyle = (id, saved) => JSON.parse(JSON.stringify(resolveStyle(id, saved)));
