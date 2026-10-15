# Web engine (Code studio)

The Code studio edits **website projects**: a set of plain files (HTML, CSS, JavaScript, images, fonts) that
live inside an `.ofini` document. Everything under `app/src/engine/web/` is **pure** — no DOM, no `window`,
no `Blob`/`URL.createObjectURL`, no `fetch` — so it runs unchanged in the browser, in a worker and in Node.js
(for tests). The UI (`app/src/ui/code/`) owns the DOM: the CodeMirror editor, the preview iframe, the
inspector bridge, the panels.

The central idea is **source-preserving edits**. The files are the single source of truth. Visual tools (style
panel, outline drag-and-drop, "add element", attribute editor) never serialize a tree back to text; they compute
a list of minimal text changes (`Change[]`) against the exact source and the UI applies them to the editor
state. Formatting, comments and indentation the user wrote are therefore never disturbed, and undo/redo is the
editor's own history.

Conventions (same as `docs/engine-contracts.md`)

- ES modules, JSDoc types on every export, US English strings, no dependencies except `app/vendor/*`.
- Offsets are UTF-16 code-unit indices into the source string, `end` is exclusive.
- Parsers are **error tolerant**: they never throw, they return diagnostics.
- Tests: `tests/web/*.test.js` (`node:test`), run by `npm test`.

## Modules

| Module | Purpose |
| --- | --- |
| `paths.js` | project path helpers, MIME types, language detection |
| `bytes.js` | *(extension)* base64 / UTF-8 / data URL helpers shared by preview and site |
| `html.js` | offset-preserving HTML parser, tree helpers, diagnostics |
| `css.js` | offset-preserving CSS parser, selector/media helpers, formatter, minifier |
| `edit.js` | `Change[]` producers for HTML and CSS (set attribute, move element, set declarations …) |
| `css-props.js` | style-panel schema, value parsing/formatting (lengths, colors, shadows, gradients, box shorthands), breakpoints |
| `preview.js` | builds the self-contained document shown in the preview iframe |
| `site.js` | builds the published site (copy, optional minify, single-file mode, sitemap) |
| `templates.js` | starter projects (the file contents live in `tpl/*.js`) |
| `elements.js` | catalog of insertable elements and sections |
| `index.js` | re-exports everything above with `export *` (111 names, no duplicates). `emmet.js` is owned by the UI and is not re-exported |

Every module is importable on its own (`tests/web/purity.test.js` loads each one and scans the sources for DOM,
browser and Node-only APIs).

## Shared types

```js
/** One text replacement against the *original* source. Lists are non-overlapping. */
type Change = { from: number; to: number; insert: string };

type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  code: string;            // e.g. 'html/unclosed', 'css/unbalanced-brace'
  message: string;         // US English, shown in the Problems panel
  start: number; end: number;
};

/** Read access to the project files. The UI implements it over its project model; tests over a Map. */
interface FileSource {
  list(): string[];                       // all file paths, '/'-separated, no leading slash, e.g. 'css/site.css'
  readText(path: string): string | null;  // null when missing or binary
  readBytes(path: string): Uint8Array | null;
}
```

## `paths.js`

```js
normalizePath(p)            // 'a/./b/../c.txt' -> 'a/c.txt'; strips leading '/', converts '\\'; never escapes the root ('../x' -> 'x')
dirname(p) basename(p, ext?) extname(p) joinPath(...parts)    // extname keeps the dot and the case as written; dotfiles have none
resolveRef(fromFile, ref)   // -> { path, query: string, hash: string } | null
                            // null for absolute URLs (http:, https:, //, data:, blob:, mailto:, tel:, javascript:), empty refs and pure '#hash'
                            // percent escapes in the path are decoded ('my%20pic.png' -> 'my pic.png'); '?x=1' alone resolves to fromFile
relativeRef(fromFile, toPath)   // path from the folder of fromFile to toPath, e.g. ('pages/a.html','css/s.css') -> '../css/s.css'
mimeOf(path)                // html css js mjs json svg png jpg jpeg gif webp avif ico woff woff2 ttf otf txt md xml webmanifest mp4 webm mp3 wav ogg pdf ...
isTextPath(path)            // true for text-like extensions (html htm css js mjs json svg txt md xml webmanifest csv ...)
languageOf(path)            // 'html' | 'css' | 'javascript' | 'json' | 'markdown' | 'xml' | 'text'   (svg -> 'xml')
sanitizeFileName(name)      // removes characters invalid on Windows/macOS/Linux, trims dots/spaces, prefixes reserved device names ('con' -> '_con'); '' if nothing is left
uniquePath(path, existing: Iterable<string>)   // 'a.css' -> 'a-2.css' when taken (compared case-insensitively, like Windows and macOS)
isExternalRef(ref)          // (extension) true for scheme: and //host references
```

### `bytes.js` (extension)

`bytesToBase64(bytes)`, `utf8Bytes(text)`, `utf8Text(bytes)` (strips a BOM), `dataUrl(bytes, mime)`, `lineOf(source, offset)` (1-based).

## `html.js`

```js
parseHtml(source: string): ParsedHtml

type ParsedHtml = {
  source: string;
  children: HtmlNode[];             // top level (doctype, comments, <html> …)
  elements: ElementNode[];          // every element in document order; elements[i].id === i
  errors: Diagnostic[];             // all severities (the name is historical)
};
type HtmlNode = ElementNode | TextNode | CommentNode | DoctypeNode;
type ElementNode = {
  type: 'element'; id: number;
  tag: string;                      // lower-case
  attrs: Attr[];
  children: HtmlNode[];
  parent: ElementNode | null;
  start: number; end: number;       // whole element incl. children and end tag
  open: { start: number; end: number };            // the start tag '<div class="a">'
  close: { start: number; end: number } | null;    // the end tag; null for void / self-closing / implied end tag
  void: boolean; selfClosing: boolean;
  depth: number;                    // 0 for top-level elements
  index: number;                    // (extension) index among the *element* siblings; elementPath() is built from it
};
type Attr = {
  name: string;                     // lower-case
  value: string | null;             // raw source text (entities NOT decoded); null for a boolean attribute
  start: number; end: number;       // the whole attribute, name through closing quote
  valueStart: number; valueEnd: number;   // value text only (inside the quotes); == end when value is null
  quote: '"' | "'" | '' | null;
  unterminated?: true;              // (extension) the closing quote is missing; the value then ends at the next '>'
};
type TextNode = { type: 'text'; start: number; end: number; text: string };
type CommentNode = { type: 'comment'; start: number; end: number };
type DoctypeNode = { type: 'doctype'; start: number; end: number };
```

Parsing rules that matter (this is a *tolerant source parser*, not a full HTML5 tree builder — it must not insert
implied `<html>/<head>/<body>/<tbody>` elements, because every node must map to real source text):

- void elements: `area base br col embed hr img input link meta param source track wbr`; `/>` on any tag is
  accepted as self-closing (the tree treats it as closed; browsers ignore the slash on non-void HTML elements, so
  `<div />` also gets a `html/self-closing` warning outside `<svg>`/`<math>`);
- raw-text elements `script`, `style` (content ends at the matching `</script>`/`</style>`, case-insensitive) and
  escapable raw text `textarea`, `title`;
- attribute values: double-quoted, single-quoted, unquoted, boolean; tolerate stray quotes and `<` in values;
- comments `<!-- -->` (also unterminated), `<!doctype …>`, CDATA treated as a comment, processing instructions
  as comments;
- implied end tags for `p, li, dt, dd, tr, td, th, option, optgroup, thead, tbody, tfoot, rt, rp` (and `head` closed by
  `body`) and `p` closed by block-level starts; elements still open at EOF get `close: null` and a diagnostic
  (not for the optional-end elements and `html/head/body`);
- stray end tags are ignored (diagnostic `html/stray-end-tag`; no gap node is created, so `children` are ordered and
  non-overlapping but not necessarily contiguous);
- the parser is iterative (20 000 nested elements are fine) and the implied-end lookups are bounded, so pathological
  input stays linear;
- diagnostics: `html/unclosed` (error), `html/stray-end-tag` (error), `html/unterminated-tag` (error: start or end tag
  without `>`), `html/unterminated-attribute` (error), `html/unclosed-comment` (error), `html/duplicate-id` (warning),
  `html/duplicate-attr` (warning), `html/self-closing` (warning), `html/img-alt` (warning), `html/missing-doctype`
  (info), `html/missing-lang` (info) — the last two only when the file has an `<html>` element —,
  `html/deprecated-tag` (`font center marquee blink`, info), `html/empty-link` (`<a>` without `href`/`name`, info).

Helpers

```js
getAttr(el, name): string | null          // raw value, '' for boolean attributes present, null when absent
hasAttr(el, name): boolean
classList(el): string[]
elementPath(el): number[]                 // index among *element* siblings at each level, root first
elementAtPath(parsed, path): ElementNode | null
elementAtOffset(parsed, offset): ElementNode | null   // deepest element whose [start,end) contains offset (offset inside tags counts)
findByTag(parsed, tag): ElementNode | null            // first element, document order
elementText(parsed, el): string           // concatenated text descendants (entities decoded for &amp; &lt; &gt; &quot; &#39; &nbsp; and numeric, plus ~40 named ones; not inside script/style)
describe(el): string                      // 'div.hero#top' = tag + up to two '.classes' + '#id'
isVoidTag(tag): boolean
decodeEntities(text): string; escapeText(text): string; escapeAttr(text, quote = '"'): string
// extensions
findAttr(el, name): Attr | null; childElements(node); findById(parsed, idValue); isInside(el, ancestor);
contentRange(el): { start, end }; isRawTextTag(tag); BOOLEAN_ATTRS: Set<string>
```

## `css.js`

```js
parseCss(source: string): ParsedCss

type ParsedCss = { source: string; rules: CssRule[]; errors: Diagnostic[] };
type CssRule = StyleRule | AtRule;
type StyleRule = {
  type: 'style';
  selector: string;                 // trimmed, whitespace inside kept as written (comments removed)
  selectorStart: number; selectorEnd: number;
  block: { start: number; end: number };   // content between '{' and '}' (exclusive of the braces)
  start: number; end: number;       // selector start .. closing brace + 1
  decls: Decl[];
  parent: AtRule | null;            // the direct container when it is an at-rule, else null
  outer: StyleRule | null;          // (extension) the direct container when it is a style rule (CSS nesting)
  rules: CssRule[];                 // native CSS nesting (optional, may be empty)
};
type AtRule = {
  type: 'at';
  name: string;                     // 'media' 'supports' 'font-face' 'keyframes' 'import' 'charset' 'layer' 'container' 'page' 'property' ...
  prelude: string;                  // trimmed text between the name and '{' or ';'
  preludeStart: number; preludeEnd: number;
  block: { start: number; end: number } | null;    // null for statement at-rules like @import
  start: number; end: number;
  rules: CssRule[];                 // grouping at-rules (@media @supports @layer @container @keyframes frames as 'style' rules)
  decls: Decl[];                    // descriptor at-rules (@font-face @page @property) and declarations directly inside nested at-rules
  parent: AtRule | null;
  outer: StyleRule | null;          // (extension)
};
type Decl = {
  prop: string;                     // lower-case, custom properties (--x) keep their case
  value: string;                    // trimmed, without '!important', comments removed
  important: boolean;
  start: number; end: number;       // 'prop: value' plus the trailing ';' when present
  nameStart: number; nameEnd: number;
  valueStart: number; valueEnd: number;   // value text without '!important' (an empty value has valueStart == valueEnd)
};
```

Must handle: comments (`/* */` anywhere, kept out of values), strings with `;`/`{`/`}`/`/*` inside, `url(...)` with
unquoted `;`, nested parentheses, `!important`, `@media` nesting, CSS nesting, missing final `;`, missing final `}`
(diagnostic `css/unbalanced-brace`), stray `}` (`css/stray-brace`), unknown at-rules, `<!--`/`-->` tokens ignored,
braces inside custom property values (`--x: { a: b }` stays one declaration). A `{`/`}` always ends an unclosed `(`,
so one stray parenthesis cannot swallow the file. Other diagnostics: `css/unclosed-comment`, `css/unclosed-string`,
`css/unclosed-paren` (warnings), `css/invalid-declaration` (no colon, or whitespace in the property name) and
`css/invalid-statement` (a declaration outside a rule) (warnings). The parser is token based and iterative (100 000
nested braces are fine).

Helpers

```js
flattenRules(parsed): StyleRule[]                    // depth-first, all style rules incl. those inside at-rules
splitSelectorList(selector): string[]                // top-level commas only (empty members are dropped)
normalizeSelector(selector): string                  // collapse whitespace, trim, ' > ' ' + ' ' ~ ' at the top level, ', ' between list members
selectorSpecificity(selector): [number, number, number]   // :is/:not/:has take their most specific argument, :where is 0
classesInSelector(selector): string[]
mediaOf(rule): string | null                         // innermost enclosing @media prelude, normalized (see normalizeMedia), else null
parseMediaQuery(prelude): { minWidth: number | null; maxWidth: number | null; other: boolean }   // px only; also '(width <= 600px)'; 'other' when the query has anything else
formatCss(source, { indent = '  ' } = {}): string    // pretty printer: one declaration per line, blank line between rules, comments kept
minifyCss(source): string                            // removes comments and insignificant whitespace; must not change meaning (strings, url(), calc() operators, custom property values)
// extensions
normalizeMedia(prelude); containerOf(rule); parseDeclarationList(text): Decl[]   // offsets relative to text (inline style attributes)
cssUrls(source): { start, end, url, urlStart, urlEnd, quote }[]                  // url(...) outside comments and strings
parseImport(prelude): { url, rest } | null            // @import "x.css" screen / url(x.css) layer(base)
scanClassTokens(text); cssEscapeIdent(text); unescapeCss(text)
```

`formatCss` and `minifyCss` never repair invalid input: a selector list with an empty member (`a,,b`) is kept as
written, and an unclosed block is left open.

## `edit.js`

```js
applyChanges(source: string, changes: Change[]): string   // throws on overlapping changes; order independent; inserts at the same offset keep list order
mapOffset(offset: number, changes: Change[], bias?: 'left' | 'right'): number   // where an offset of the old source ends up
detectIndent(source: string): string                      // '\t' or '  ' or '    ' (most common leading indent, default '  ')
```

### HTML edits

All take the `ParsedHtml` of the *current* source and return `Change[]` (or `{ changes, at }`, see below).
They keep untouched text byte-identical and indent new lines consistently with the surrounding code (CRLF sources keep
CRLF; `<pre>`/`<textarea>` content is never re-indented).

```js
setAttribute(parsed, id, name, value: string | null): Change[]   // null removes; '' on a boolean attribute (hidden, disabled, ...) writes the bare name; keeps the existing quote style; escapes & and the quote char
setClasses(parsed, id, classes: string[]): Change[]               // removes the attribute when empty; no change when only whitespace differs
setInlineStyle(parsed, id, props: Record<string, string | null>): Change[]   // merges into style="…" keeping order/other declarations; removes the attribute when empty
setTag(parsed, id, newTag): Change[]                              // renames the start and the end tag; throws for void <-> non-void
setText(parsed, id, text): Change[]                               // replaces the content with escaped text (raw for script/style)
setInnerHtml(parsed, id, html): Change[]
insertHtml(parsed, parentId: number | null, index: number, html: string): { changes: Change[]; at: number }
    // parentId null = top level of <body> (else of <html>, else of the document); index counts *element* children
    // `at` = offset of the inserted fragment in the NEW source (use with elementAtOffset after re-parsing)
deleteElement(parsed, id): Change[]                               // also removes the now-empty line / indentation it occupied
duplicateElement(parsed, id): { changes: Change[]; at: number }   // copy inserted after the element; `id=""` attributes inside the copy are removed to avoid duplicates
moveElement(parsed, id, newParentId: number | null, index: number): { changes: Change[]; at: number }
    // throws when newParentId is the element itself or one of its descendants; `index` is relative to the children *after* removal of the element;
    // returns no changes when the element would stay where it is
wrapElement(parsed, id, tag, attrs?: Record<string, string>): { changes: Change[]; at: number }
unwrapElement(parsed, id): Change[]                               // replaces the element by its children (de-indented)
elementSource(parsed, id): string                                 // the exact text of the element (without the whitespace that belongs to the next sibling when the end tag is implied)
```

Notes

- `value`s are plain text, not entity-encoded. Read attributes with `decodeEntities(getAttr(...))` for display and
  write them back with `setAttribute`; writing the value that is already there returns `[]`.
- Insertion rules: before a sibling that starts its line → a new line with that sibling's indentation; after the last
  sibling → a new line below it; into an empty or whitespace-only block container → expanded to three lines; into
  text-flow elements (`p`, `li`, `a`, `span`, headings …) → inline, without new lines. `insertHtml`/`moveElement`
  throw for void and raw-text containers and when the insertion point lies inside an unterminated tag.
- **Structure guard**: `insertHtml`, `moveElement`, `wrapElement`, `unwrapElement` and `setTag` re-parse the result and
  throw `Cannot …: the result would contain invalid HTML` when it would add error diagnostics (a `<section>` inside a
  `<p>`, an unclosed snippet, a `<li>` that would split another `<li>` …). Block elements inside `<p>` get their own
  message. The UI should show the message instead of applying the edit.
- `setInnerHtml`, `setText`, `setAttribute`, `deleteElement` and `duplicateElement` do not guard (the content is the
  caller's responsibility); duplicating an element copies the problems it already has.

### CSS edits

```js
type RuleTarget = { selector: string; media?: string | null };   // media e.g. '(max-width: 991px)'; null/undefined = top level

findRule(parsed, target): StyleRule | null                        // selector compared with normalizeSelector; media with normalizeMedia; the LAST match when the sheet defines the rule twice
getDeclarations(parsed, target): Record<string, Decl>             // {} when no rule; all matching rules merged, last declaration of a property wins
setDeclarations(parsed, target, props: Record<string, string | { value: string; important?: boolean } | null>): Change[]
    // updates in place, appends missing declarations (indent matches the rule's existing declarations),
    // null or '' removes; creates the rule (and the enclosing @media block) when missing:
    //   - a new top-level rule (media null) is inserted BEFORE the first top-level @media block whose query is
    //     width based (min-width / max-width in px; print, prefers-reduced-motion … do not count), so media blocks can
    //     still override it; without such a block it is appended at the end of the file (blank line before)
    //   - an @media block with the same normalized prelude is reused (the last one); otherwise a new block is created,
    //     ordered like a desktop-first cascade: max-width blocks from the largest to the smallest value, after all
    //     un-queried rules; min-width blocks after the max-width blocks, ascending; any other query goes to the end
    //   - a rule left without declarations is removed, and a media block left without rules is removed
    //   - a property that already exists several times is updated where it is defined last
deleteRule(parsed, target): Change[]                              // every matching rule; an emptied media block goes too
renameSelector(parsed, from, to): Change[]                        // exact (normalized) selector match, every media context
renameClass(parsed, fromClass, toClass): Change[]                 // every selector containing `.fromClass` as a whole class token (not inside strings/attribute selectors/comments); the new name is CSS-escaped
appendRulesIfMissing(source: string, cssText: string): Change[]   // adds only those rules of cssText whose (selector, media) pair is absent in source
    // top-level rules follow the same placement as setDeclarations (before the first width-based @media block);
    // rules of an @media block go into an existing block with the same prelude or a new block in cascade order;
    // other at-rules (@keyframes, @font-face …) are appended at the end when an identical one is absent
findRules(parsed, target): StyleRule[]                            // (extension) all matches in document order
```

Top-level targets (media `null`) match only rules that are not inside any at-rule; media targets match rules whose
innermost enclosing `@media` has the same normalized prelude (nested style rules never match). Blank lines around
removed rules are tidied, single-line rules (`.a { color: red; }`) stay single-line, trailing comments stay with their
declaration, tabs and CRLF are preserved.

## `css-props.js` — the style-panel schema

The Style panel is generated from this schema (like the pixel-effect controls). Keep it data-driven.

```js
STYLE_SECTIONS: StyleSection[]        // order: layout, spacing, size, position, typography, backgrounds, borders, effects
type StyleSection = { id: string; label: string; props: PropDef[] };
type PropDef = {
  prop: string;                       // CSS property ('margin', 'font-size', 'background-color', …) ; composite controls use a shorthand
  label: string;
  type: 'keyword' | 'segmented' | 'length' | 'number' | 'color' | 'box' | 'font-family' | 'font-weight' | 'shadow' | 'gradient' | 'text' | 'toggle';
  options?: { value: string; label: string; icon?: string }[];     // keyword / segmented / toggle (icon = Bootstrap Icons name)
  units?: string[];                   // allowed units for length, first = default ('px','%','em','rem','vw','vh'; '' = unitless, used by line-height)
  keywords?: string[];                // extra non-numeric values for length ('auto', 'none', 'fit-content', 'min-content', …)
  min?: number; max?: number; step?: number;
  longhands?: string[];               // for 'box': ['margin-top','margin-right','margin-bottom','margin-left']
  when?: { prop: string; in: string[] };   // show only if the *computed* value of another property is in the list
                                           // (e.g. flex-direction when display ∈ flex/inline-flex)
  inherited?: boolean;
};
```

The border `box` controls use `options` for `border-style`; `border-color` has no units; `border-radius` longhands are
ordered top-left, top-right, bottom-right, bottom-left.

Required coverage (Webflow-style; original labels): **Layout** `display` (block, flex, grid, inline-block, inline, none),
`flex-direction`, `flex-wrap`, `justify-content`, `align-items`, `align-content`, `gap`/`row-gap`/`column-gap`,
`grid-template-columns`, `grid-template-rows`, `flex-grow/shrink/basis`, `align-self`, `order`, `overflow`.
**Spacing** `margin` and `padding` (box type). **Size** `width`, `height`, `min-*`, `max-*`, `aspect-ratio`, `object-fit`.
**Position** `position`, `top/right/bottom/left`, `z-index`, `float`, `clear`. **Typography** `font-family`, `font-size`, `font-weight`,
`line-height`, `letter-spacing`, `color`, `text-align`, `font-style`, `text-decoration`, `text-transform`, `white-space`,
`text-overflow`, `text-shadow`. **Backgrounds** `background-color`, `background-image` (gradient or `url()`), `background-size`,
`background-position`, `background-repeat`, `background-attachment`. **Borders** `border-style/width/color` (box type over
sides), `border-radius` (box over corners), `outline`. **Effects** `opacity`, `box-shadow`, `transform`, `transition`, `filter`,
`backdrop-filter`, `cursor`, `mix-blend-mode`, `pointer-events`, `visibility`.

```js
parseLength(value): { n: number; unit: string } | { keyword: string } | null    // '12px' '1.5rem' '50%' '0' '1.5' (unit '') 'auto' 'calc(…)' -> { keyword:'calc(…)' }
formatLength({ n, unit }): string                                               // 0 -> '0' (for length units), trims trailing zeros, { keyword } passes through
expandBox(value): [string, string, string, string]                              // CSS 1–4 value shorthand -> top,right,bottom,left
collapseBox([t, r, b, l]): string                                               // shortest valid shorthand
parseColor(value): { r, g, b, a } | null                                        // hex 3/4/6/8, rgb()/rgba() (comma and space syntax), hsl()/hsla(), 'transparent', ~60 common names
formatColor({ r, g, b, a }): string                                             // '#rrggbb' or 'rgba(r, g, b, a)' when a < 1
parseShadowList(value): Shadow[]   // { inset, x, y, blur, spread, color }; px only: 'none', other units and var() give [] (compare with 'none' to tell them apart)
formatShadowList(list): string     // [] -> 'none'
parseGradient(value): { kind: 'linear' | 'radial'; angle?: number; shape?: string; stops: { color: string; pos: number | null }[] } | null
    // percent stops only; repeating/conic gradients and px stops give null; 'to right' = 90, corners are approximations; `shape` (extension) keeps the radial shape/position text
formatGradient(g): string
parseTransition(value) / formatTransition(list)        // { property, duration (ms), timing, delay (ms) }
FONT_STACKS: { label: string; value: string }[]        // Sans / Serif / Mono / Rounded / Humanist / Geometric as system font stacks, no web fonts
BREAKPOINTS: Breakpoint[]
type Breakpoint = { id: string; label: string; media: string | null; width: number; min?: boolean };
// desktop (media null, width 1280) · desktop-xl (min-width 1440, preview 1440) · desktop-2xl (min 1920) ·
// tablet (max-width: 991px, width 991) · mobile-landscape (max-width: 767px, width 767) · mobile-portrait (max-width: 478px, width 478)
mediaForBreakpoint(id): string | null
breakpointForWidth(px): Breakpoint                      // the breakpoint whose media matches a viewport of px width (most specific max-width wins)
// extensions
getPropDef(prop): PropDef | null                        // also finds the longhands of box properties
isPropVisible(def, getValue): boolean                   // evaluates `when`
breakpointForMedia(media): string | null
```

## `preview.js`

```js
buildPreview(files: FileSource, entry: string, options?: PreviewOptions): PreviewResult

type PreviewOptions = {
  bridge?: string;            // JavaScript source injected as the first script of <head>
  config?: object;            // JSON, exposed to the bridge as window.__OF_CONFIG__ (set before the bridge runs, in the same script)
  makeScriptUrl?: (code: string, info: { file: string; module: boolean; inline: boolean }) => string | null;
                              // EVERY script goes through it when it is provided: local <script src>, inline <script> blocks
                              // (classic and module), the generated event-handler script and the injected bridge
                              // (info.file 'openfini-bridge.js'). The UI returns a data:text/javascript URL because the app CSP
                              // blocks inline scripts. Return null/omit to inline the code (Node tests).
  makeAssetUrl?: (path: string, bytes: Uint8Array, mime: string) => string;   // default: base64 data: URL
  annotate?: boolean;         // default true: add data-of="<element id>" to every element start tag (ids = parseHtml ids of the ORIGINAL entry source)
};
type PreviewResult = {
  html: string;
  pages: string[];            // every .html/.htm file of the project, sorted (for the page switcher)
  styles: { file: string; inline: boolean; index: number }[];   // the <style data-of-file="…"> elements generated; index = ordinal among
                              // the linked stylesheets (inline: false) or the data-of-inline number (inline: true)
  diagnostics: (Diagnostic & { file: string })[];   // missing referenced files etc.; offsets refer to `file`
};
hotCss(files, cssFile, options?): string          // the rewritten CSS text for one stylesheet (assets as URLs, @import inlined) for live replacement without reloading the iframe
scanModuleSpecifiers(code): { start, end, specifier, dynamic }[]   // (extension) the import scanner
```

There is **no `<base>` tag and no import map** in the generated document: hash links must keep working natively in
`about:srcdoc`, and inline scripts are blocked by the CSP. (`baseHref` was removed from the options.)

Behavior

- every local `<link rel="stylesheet" href>` becomes `<style data-of-file="css/site.css">…</style>` in the same position
  (the `media` attribute is kept); `@import` of local files is inlined recursively (depth ≤ 5, cycles skipped), wrapped in
  `@media` / `@layer` / `@supports` when the import has conditions; `url(...)` references to local files become asset
  URLs; external stylesheets are left untouched;
- every `<style>` block of the entry gets `data-of-file="<entry>"` and `data-of-inline="<n>"`;
- **scripts**: local `<script src>`, inline classic and inline module scripts go through `makeScriptUrl(code, info)`;
  without it they are inlined (`</script` escaped). An inline script that is turned into a `src` script loses its
  `defer`/`async` attributes (they had no effect while it was inline). Other script types (`application/ld+json`,
  import maps …) stay as written; the injected bridge always comes first in `<head>`;
- **module graph**: for `type="module"` scripts (local or inline) the import specifiers of project files
  (`import … from "./x.js"`, `import "./x.js"`, `export … from "./x.js"`, `import("./x.js")` with a string literal) are
  rewritten to the **URL returned by `makeScriptUrl` for the dependency**; dependencies are created first
  (topological order), each module once, specifiers resolve relative to the importing file, bare and absolute-URL
  specifiers are left alone, comments, strings, template literals and regex literals are skipped. Without
  `makeScriptUrl` dependencies get `data:text/javascript` URLs. A cycle keeps the specifier unchanged and adds a
  `preview/module-cycle` warning; a missing file adds `preview/missing-file`;
- **inline event handlers** (`onclick`, `onsubmit`, `oninput` … on any element) are removed from the markup and
  re-attached by one generated classic script placed just before `</body>` (or at the end of the document), through
  `makeScriptUrl`: `(function(){var e=document.querySelector('[data-of="ID"]');if(e)e.onclick=function(event){CODE\n};})();`.
  This needs the annotation: with `annotate: false` the handlers stay in place. `javascript:` hrefs are untouched;
- `src`, `srcset`, `poster`, `data`, `<link rel="icon|apple-touch-icon|preload|manifest">`, `<source>`, `<input type=image>`,
  SVG `<image href>` and inline `style="…url()"` attributes that point at project files become asset URLs (one
  `makeAssetUrl` call per file); missing files produce a `preview/missing-file` warning whose offsets slice to the reference;
- `<a href="other.html#x">` and `<form action>` stay as written (the bridge intercepts them); `data-of` annotation never touches text, comments, or raw-text contents;
- the document is always valid enough to render: a missing `<head>` is created for the injected nodes, a missing
  doctype is added, a fragment is wrapped in `<head>`/`<body>`; a missing entry file renders a "File not found" page
  (with the bridge) and the error `preview/missing-entry`;
- diagnostics codes: `preview/missing-file`, `preview/missing-entry`, `preview/css-cycle`, `preview/css-import-depth`,
  `preview/module-cycle`.

## `site.js`

```js
buildSite(files: FileSource, options?: SiteOptions): { files: { path: string; bytes: Uint8Array }[]; warnings: string[]; stats: { files: number; bytes: number } }
type SiteOptions = {
  minify?: boolean;            // minify HTML (whitespace between tags outside <pre>/<textarea>/<script>/<style>, comments), CSS (minifyCss); JS is copied untouched
  singleFile?: boolean;        // each HTML page gets its CSS, JS and images inlined (data: URLs); other files are dropped
  siteUrl?: string;            // enables sitemap.xml + robots.txt when set (https://example.com)
  include?: (path: string) => boolean;     // default: everything except dotfiles and folders named node_modules/.git
  entry?: string;              // default 'index.html'
};
minifyHtml(source): string     // (extension) the HTML minifier on its own
```

Output paths mirror the project, sorted by path. Warnings list broken local references (`href`, `src`, `srcset`, `poster`,
CSS `url()`/`@import`, inline styles and `<style>` blocks) as `index.html (line 12): missing file "img/logo.png"`
(a folder reference resolves when it contains an `index.html`), and a missing `index.html`; unreferenced assets are *not*
an error. The result never contains `data-of` attributes or bridge code. HTML minification keeps one space between inline
elements and drops whitespace next to block-level elements, removes comments except conditional comments, collapses
whitespace between attributes and minifies `<style>` content. `sitemap.xml` (every page except `404.html`;
`index.html` becomes the folder URL) and `robots.txt` are added only when the project does not have them. Single-file
mode reuses the preview rewriting without annotations: `@import` is inlined, images become data URLs, module imports
become `data:` URLs.

## `templates.js`

```js
TEMPLATES: { id: string; name: string; description: string; category: 'Starter' | 'Business' | 'Personal' | 'Content'; accent: string; files: Record<string, string> }[]
getTemplate(id)               // a copy (the file map can be modified), or null
```

Six original templates — **Blank** (`blank`), **Landing page** (`landing`, a fictional note-taking app), **Portfolio** (`portfolio`),
**Blog** (`blog`: `index.html` + `posts/finding-your-pace.html`, which uses `../` paths), **Documentation** (`docs`: sidebar layout, `index.html` +
`configuration.html`), **Link in bio** (`link-in-bio`). Requirements: valid semantic HTML5 (`lang="en-US"`, landmarks, `alt` text, one `h1`),
one stylesheet `css/style.css` using CSS custom properties and a *desktop-first* cascade with `@media (max-width: 991px)`, `767px` and `478px`
blocks (exactly one block per query, largest first, followed by a `prefers-reduced-motion` block), a small `js/main.js`
(mobile nav toggle, smooth anchors, current year), inline-SVG or `assets/*.svg` imagery (no raster files, no external requests, no web fonts),
real US-English copy (no lorem ipsum), good-looking at 1280 px and at 390 px. Class names are plain and readable (`.hero`, `.container`, `.card`…).
All files must parse without any diagnostics and every local reference must exist (`tests/web/templates.test.js` checks both, runs the
script in a `vm` and builds every site without warnings). The stylesheets are 230–400 lines; short rules are written on one line.
The files are generated from the sources in `tpl/*.js` (`tpl/shared.js` holds the script and the shared CSS foundation).

## `elements.js`

```js
ELEMENT_CATEGORIES: { id: string; label: string; items: ElementDef[] }[]
type ElementDef = { id: string; label: string; icon: string /* Bootstrap Icons name */; description: string; html: string; css?: string };
planInsert(htmlParsed: ParsedHtml, cssSource: string | null, parentId: number | null, index: number, def: ElementDef):
  { html: { changes: Change[]; at: number }; css: Change[] }    // css changes use appendRulesIfMissing(def.css) against cssSource
getElementDef(id): ElementDef | null                            // (extension)
```

Categories and minimum items — **Layout**: Section, Container, Div block, Columns (2/3/4 grid), Flex row, Stack, Spacer;
**Typography**: Heading 1–6, Paragraph, Link, Button, List (bulleted/numbered), Quote, Code block, Divider;
**Media**: Image, Video, Audio, Embed (iframe), Figure with caption, SVG icon;
**Forms**: Form, Text input, Email input, Textarea, Select, Checkbox, Radio group, Label, Submit button;
**Navigation**: Navbar, Footer, Breadcrumbs, Pagination;
**Sections**: Hero, Feature grid, Pricing table, Testimonial, Call to action, Image gallery, FAQ (details/summary), Stats row, Team cards (51 items).
Snippets are semantic HTML with plain class names, exactly one root element each, and no `id` attributes (form controls are wrapped in
their `<label>`); `css` carries only the baseline rules for those classes, with `var(--accent, #4f46e5)`-style fallbacks, so inserting
a Hero twice adds the CSS once. Every snippet parses without diagnostics, every `css` parses without diagnostics and uses only the three
shared breakpoints. Placeholder images are inline SVG data URIs, never network URLs.

`planInsert` makes `id` attributes (and the `for` / `aria-*` / `#href` references to them) and radio group names unique within the page
(`choice-group`, `choice-group-2` …). `cssSource === null` means the page has no stylesheet: no CSS changes (an empty string is a
stylesheet and receives the rules). It throws like `insertHtml` (for example when a section would land inside a `<p>`).

## Performance and robustness requirements

- parsing a 1 MB HTML file and a 1 MB CSS file each takes < 150 ms on a laptop (measured: about 25 ms each; the test limit is a generous 400 ms);
  `formatCss` and `minifyCss` take about 50 ms for 1 MB; no regexes with catastrophic backtracking, deep nesting and unclosed constructs stay linear;
- fuzz tests (`tests/web/fuzz.test.js`; set `FUZZ_SEED=<n>` to explore other random sequences): random truncations/mutations of the templates and
  snippets never throw, produce ranges inside the source, keep `children` ranges nested and ordered, and `applyChanges(source, changes)` of every edit function yields a
  string that re-parses with no *new* `error` diagnostics (error-free documents stay error-free; documents that were already broken may only get a
  little worse; invalid edits throw instead, see the structure guard);
- every edit function is **idempotent where it should be** (setting a value that is already set returns `[]`) and never changes text outside the targeted range.
