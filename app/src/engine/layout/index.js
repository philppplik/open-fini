/**
 * Public API of the layout engine: text model, text layout, caret / hit-test helpers, font parsing, hyphenation,
 * data merge and table-of-contents helpers. The PDF writer lives in `../backends/pdf.js`.
 *
 * @module layout
 */

// text model ---------------------------------------------------------------------------------------------------
export {
  DEFAULTS,
  emptyStory,
  storyFromPlain,
  storyFromPlainWithTabs,
  plainText,
  storyLength,
  normalizeStory,
  normalizeInputText,
  insertText,
  deleteRange,
  sliceStory,
  insertStory,
  getAttrsAt,
  getStyleAt,
  applyCharAttrs,
  applyCharStyle,
  applyParaAttrs,
  applyParaStyle,
  paragraphAt,
  paragraphStarts,
  wordRange,
  charClass,
  resolveRun,
  resolveParagraph,
  createStyleResolver,
  sanitizeCharAttrs,
  sanitizeParaAttrs,
  storyToJSON,
  storyFromJSON,
  validateStory,
  storyToHTML,
} from './text-model.js';

// layout -------------------------------------------------------------------------------------------------------
export { layoutStory, clearLayoutCaches, approxMeasurer, makeSfntMeasurer } from './text-layout.js';
export { findBreaks } from './line-break.js';

// caret / selection helpers -----------------------------------------------------------------------------------------
export {
  offsetToCaret,
  hitTest,
  hitTestEx,
  selectionRects,
  moveCaretVertical,
  lineStart,
  lineEnd,
  wordBoundary,
} from './text-caret.js';

// fonts / hyphenation -----------------------------------------------------------------------------------------------
export { parseFont } from './sfnt.js';
export { createHyphenator } from './hyphenation.js';
export { std14Name, std14Metrics, std14TextWidth, std14Widths, winAnsiCode, STD14_FONTS } from './std14.js';

// data merge / table of contents --------------------------------------------------------------------------------------
export { parseCSV, parseDelimited, detectDelimiter, mergeFields, listFields } from './data-merge.js';
export { buildTOC } from './toc.js';
