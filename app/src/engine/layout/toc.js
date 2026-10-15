/**
 * Table of contents helper: builds a story whose entries have a right-aligned page number behind a dot leader.
 *
 * @module toc
 */

/**
 * @typedef {Object} TocEntry
 * @property {string} title
 * @property {number|string} page
 * @property {number} [level=1] 1-based heading level (controls the indent and the optional per-level formatting)
 */

/**
 * @typedef {Object} TocOptions
 * @property {number} width        px position of the right-aligned page-number tab stop (e.g. the text width)
 * @property {string} [leader='.'] leader string; empty for none
 * @property {number} [indent=18]  px of left indent per level above 1
 * @property {object} [charAttrs]  CharAttrs for all runs
 * @property {Record<number, object>} [levelCharAttrs]  extra CharAttrs per level (e.g. bold for level 1)
 * @property {object} [paraAttrs]  ParaAttrs for all entries
 * @property {number} [spaceAfter=0]
 * @property {string} [styleId]    paragraph style id for all entries
 */

/**
 * Builds a table-of-contents story: one paragraph per entry, `title<TAB>page`, with a right tab stop at
 * `opts.width` carrying the leader. The page number is a plain run (use a `field` attr in `charAttrs` if the host
 * resolves it at layout time).
 * @param {TocEntry[]} entries
 * @param {TocOptions} opts
 * @returns {import('./text-model.js').Story}
 */
export function buildTOC(entries, opts) {
  const o = opts || { width: 400 };
  const leader = o.leader === undefined ? '.' : o.leader;
  const indent = o.indent === undefined ? 18 : o.indent;
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return { paragraphs: [{ runs: [] }] };
  const paragraphs = list.map((e) => {
    const level = e && e.level > 1 ? Math.floor(e.level) : 1;
    const attrs = { ...(o.charAttrs || {}), ...((o.levelCharAttrs && o.levelCharAttrs[level]) || {}) };
    const title = String((e && e.title) || '').replace(/[\r\n\t\u{2028}\u{2029}]+/gu, ' ');
    const page = String(e && e.page !== undefined && e.page !== null ? e.page : '').replace(/[\r\n\t\u{2028}\u{2029}]+/gu, ' ');
    /** @type {any} */
    const para = {
      runs: [{ text: `${title}\t${page}`, ...(Object.keys(attrs).length ? { attrs } : {}) }],
      attrs: {
        ...(o.paraAttrs || {}),
        indentLeft: (level - 1) * indent,
        spaceAfter: o.spaceAfter || 0,
        tabs: [{ pos: o.width, align: 'right', ...(leader ? { leader } : {}) }],
      },
    };
    if (o.styleId) para.styleId = o.styleId;
    return para;
  });
  return { paragraphs };
}
