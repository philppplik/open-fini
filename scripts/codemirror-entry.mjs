// Entry point of the CodeMirror 6 bundle shipped in app/vendor/codemirror (see scripts/vendor.mjs).
// Only what the Code studio uses is re-exported, so esbuild can drop the rest.
export { EditorState, EditorSelection, Compartment, StateEffect, StateField, Prec, Transaction, Annotation, RangeSetBuilder, Text } from "@codemirror/state";
export {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection,
  crosshairCursor, highlightActiveLine, placeholder, Decoration, ViewPlugin, WidgetType, tooltips, scrollPastEnd,
} from "@codemirror/view";
export {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, selectAll, indentSelection, toggleComment, toggleBlockComment,
  copyLineDown, copyLineUp, moveLineUp, moveLineDown, deleteLine, undoDepth, redoDepth, cursorLineBoundaryBackward,
} from "@codemirror/commands";
export {
  syntaxTree, indentOnInput, bracketMatching, foldGutter, foldKeymap, foldAll, unfoldAll, foldCode, unfoldCode, HighlightStyle,
  syntaxHighlighting, StreamLanguage, LanguageSupport, indentUnit, getIndentation, matchBrackets, ensureSyntaxTree,
} from "@codemirror/language";
export { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, startCompletion, snippetCompletion, completeFromList, insertCompletionText } from "@codemirror/autocomplete";
export {
  searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel, search, SearchQuery, setSearchQuery, findNext,
  findPrevious, replaceNext, replaceAll, gotoLine, selectNextOccurrence, selectSelectionMatches,
} from "@codemirror/search";
export { linter, lintGutter, lintKeymap, setDiagnostics, forceLinting, diagnosticCount } from "@codemirror/lint";
export { html, htmlLanguage } from "@codemirror/lang-html";
export { css, cssLanguage } from "@codemirror/lang-css";
export { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
export { json, jsonLanguage } from "@codemirror/lang-json";
export { markdown, markdownLanguage } from "@codemirror/lang-markdown";
export { xml } from "@codemirror/lang-xml";
export { tags, classHighlighter } from "@lezer/highlight";
