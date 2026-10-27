# Code studio

The Code studio builds **websites** inside an OpenFini document. It combines two ways of working on the same
files:

* a **code editor** (HTML, CSS, JavaScript and TypeScript, JSON, YAML, TOML, Markdown, LaTeX, SVG, plain text) with an explorer, tabs, search, a command
  palette, Emmet and completions that know your project — the everyday workflow of a desktop code editor;
* a **visual designer**: a live canvas at real breakpoints, an element navigator, an element palette, and a style
  panel with classes, breakpoints and inheritance — the workflow of a visual site builder.

They are not two views of a model. **The files are the only source of truth.** Every visual action is turned into
a minimal text edit of your HTML or CSS (so your formatting and comments survive), and every edit you type is
reflected on the canvas immediately. Undo and redo are the editor's own history.

Open it with the **Code** button in the header, **Alt+4**, *Studio ▸ Code Studio*, or `?studio=code`.

## Getting started

* **New website** (*File ▸ New*, choose *Code*): pick a template — *Blank*, *Landing page*, *Portfolio*, *Blog*,
  *Documentation* or *Link in bio* (responsive, accessible, no external requests), or a **framework starter** that runs
  without a build step: Tailwind CSS, Bootstrap, Alpine.js, htmx, Vue, Preact, React, Lit, web components, Three.js, a
  Markdown blog, a Markdown docs site and a PWA. See [frameworks.md](frameworks.md).
* **Open a file or folder**: Markdown, LaTeX, JSON, YAML and other text files open from *File ▸ Open*, drag and drop and
  *Open Folder* as a one-file project (Markdown and LaTeX get a live preview). See [frameworks.md](frameworks.md#markdown).
* **Import**: *Import a folder…* or *Import files…* on the start screen, or drag a folder onto the Explorer.
* The project is stored **inside the `.ofini` document** (`web/files/…`) next to your design pages, so one file
  holds the artwork *and* the site. Autosave and *Save* cover both.

## Workbench

| Area | What it does |
| --- | --- |
| **Activity bar** (left) | Explorer · Add elements · Navigator · Search · Source Control · Assets · Libraries · Settings |
| **Explorer** | Create, rename (`F2`), move (drag), duplicate, delete, upload, download; drop files or folders from your computer; set the home page. Renaming or moving a file updates links to it in HTML and CSS. |
| **Editor** | One editor tab per file, each with its own undo history. Syntax highlighting, bracket matching, folding, multiple cursors, find and replace, completions (tags, attributes, CSS properties, your class names, `var(--…)`, file paths), snippets, diagnostics. |
| **Canvas** | The live preview of the selected page in a sandboxed frame. *Design mode* selects and edits; *live preview* lets the page behave normally. |
| **Navigator** | The page's element tree. Click to select; drag rows to reorder or nest. |
| **Add** | Elements and ready-made sections (hero, feature grid, pricing, FAQ, …). Click to insert after the selection or drag onto the canvas. |
| **Style panel** (right dock) | Layout, spacing, size, position, typography, backgrounds, borders and effects of the selected element. |
| **Settings panel** (right dock) | Tag, id, classes, attributes (link targets, image sources, form fields …), text. |
| **Console / Problems** (bottom) | `console.log` output and runtime errors of the page; HTML, CSS, JavaScript and JSON problems with click-to-jump. |

Switch between **Design**, **Split** and **Code** with the buttons in the toolbar or `Mod+Alt+1/2/3`.

### The visual designer

* **Select** by clicking on the canvas or in the Navigator. `Alt`+click selects the parent. Selecting an
  element on the canvas moves the caret to its tag in the code; moving the caret in the HTML selects the element.
* **Edit text** by double-clicking text on the canvas (or `Enter`). `Esc` cancels.
* **Move** by dragging an element on the canvas (a blue line shows where it will land) or in the Navigator.
* **Insert** from the Add pane. Sections bring their CSS with them — inserted once, even if you add the section
  twice.
* **Copy / paste / duplicate / delete / wrap** with the usual shortcuts or the right-click menu.
* **Margin and padding guides** are drawn around the selection (orange / green).

#### Classes and breakpoints

The Style panel styles a **class selector** (like a class-based site builder): select an element, name a class
(or use the one it has) and every change writes declarations to that class's rule in your stylesheet. Elements
without a class get an automatic `div-block`-style class on their first edit; choose *inline* to write a `style`
attribute instead (desktop only).

Breakpoints use a desktop-first cascade:

| Breakpoint | Width | CSS written |
| --- | --- | --- |
| Desktop 1920 / 1440 | 1920 / 1440 px | `@media (min-width: …)` |
| **Desktop** (base) | 1280 px | no media query |
| Tablet | 991 px | `@media (max-width: 991px)` |
| Mobile landscape | 767 px | `@media (max-width: 767px)` |
| Mobile portrait | 478 px | `@media (max-width: 478px)` |

Edits at a smaller breakpoint go into the matching `@media` block of the same rule (created if needed, in
cascade order). A **blue dot** marks a value set here, an **orange dot** a value inherited from a larger screen;
click the dot to reset it. Values you have not set show the computed default, dimmed.

### Viewport, rulers and zoom

The **viewport bar** above the canvas sets the size of the page in CSS pixels:

* **Width / height fields**: type a number (or `834px`) and press `Enter` or leave the field; `↑` / `↓` change it by 1, `Shift` by 10
  (100 to 4000 px). The **lock** keeps the aspect ratio, **rotate** swaps width and height, and **fill height** lets the frame use the
  available height again (the default).
* **Presets**: Desktop 1440 / 1280 / 1024, Tablet 820 / 768 and Phone 390 / 375 / 360 / 320 (generic sizes, no product names). The
  star saves the current size under a name (*Saved sizes*, up to 12; stored in the project and as a default for new projects).
* **Zoom**: Fit, or 25 to 400 %. At 100 % the page is drawn on whole pixels.
* **Width slider** (280 to 2560 px): drag for quick responsive testing. It snaps to a breakpoint marker within 6 px unless you hold `Alt`.
* **Drag handles** on the right, bottom and corner edges of the frame resize it live with a size badge such as "834 × 612". They are
  keyboard accessible too (focus a handle, arrow keys ±1, `Shift` ±10). While dragging, the zoom stays fixed.
* **Rulers** show CSS pixels and adapt their ticks to the zoom. The triangles on the horizontal ruler mark widths where the layout
  changes: the editor's breakpoints (blue) and the `min-width` / `max-width` conditions of every `@media` rule in your CSS (amber);
  click one to jump to that width.

The size and breakpoint are remembered per project. The breakpoint of the style panel always follows the width, so styles you edit
at a custom width are written to the `@media` block of the matching breakpoint, exactly as before.

### Measure tool

Press `M` (or the ruler button in the toolbar, *View ▸ Measure Tool*, command `code.measure`) and hover over the canvas:

| Gesture | Result |
| --- | --- |
| Hover | Box model bands (margin orange, border yellow, padding green, content blue), tag and size, lines to the viewport edges |
| Hold `Alt` | Distance to the pinned element, else the selected one, else the parent (red lines) |
| Click | Pins the element (click again to unpin) |
| `Shift`+click | Pins and links to the previous pin with distance lines |
| `D` | Shows the margin and padding values on the bands |
| `Ctrl+C` | Copies the size, for example `320×48px` (or click the readout in the viewport bar) |
| `Esc` | Clears pins, then leaves the tool |

Units: px, mm, cm, in, pt, rem, em and % of the parent. Physical units follow the CSS definition (1 in = 96 px); change the
**ppi** basis if you want a different density, or turn on **Device pixels** to count CSS px × device pixel ratio. While the tool is on,
clicks do not select or edit. The overlay is drawn inside the preview, so it scales with the zoom.

#### How measurement works

All numbers in the viewport bar, the rulers, the measure tool and the media-query logic are **CSS pixels of the page inside the
preview frame**. By definition they agree:

* **Viewport** = the configured width × height of the frame (`window.innerWidth/innerHeight` inside the page).
* **Layout width** = `documentElement.clientWidth` = what a `width: 100%` element, `%` units and the measure tool use. It equals the
  viewport width as long as the page has no classic scrollbar. A classic scrollbar steals its own width from the layout (15 px on a
  desktop, a fractional amount such as 15.33 at a device pixel ratio of 1.5), which is why a 100 % wide box used to measure 375 px in
  a 390 px viewport. The preview therefore **hides the root scrollbar by default** (scrolling by wheel, touch or keys still works);
  the *Show the page scrollbar* button (command `code.previewScrollbar`) shows it again and the readout then says
  `390 × 844 · layout 374.67 (scrollbar 15.33)`.
* **Media queries** use the viewport width including the scrollbar (`100vw`), exactly like a real browser, so breakpoints trigger at
  the configured width in both modes.
* **Zoom** is a CSS `transform: scale()` on the frame box. The page itself is laid out at the unscaled size and `getBoundingClientRect`
  inside the frame is unaffected, so measurements never depend on the zoom; the host divides pointer coordinates by the scale. The
  device box is not rounded (it used to be), so the frame and its box cannot drift by a pixel.
* **Units**: 1 in = 96 CSS px, 1 mm = 96/25.4 px, 1 pt = 96/72 px; `%` is relative to the parent's border box (to the layout width for
  the root); `rem`/`em` use the computed font sizes. Values are rounded only for display (px 1 decimal, mm 1, cm 2, in 3). **Device
  pixels** multiplies by `devicePixelRatio` only when switched on; browser zoom changes the ratio, never the CSS pixels.
* **Self-check**: the bridge keeps two invisible fixed probes, `width: 100%` and `width: 100vw`, and reports `innerWidth`,
  `clientWidth` and both probe widths (`layoutMetrics`). The status line next to the zoom shows
  `Phone · 50% · 390 × 844 · layout 390`; if the frame ever disagrees with the configured size (innerWidth ≠ width, 100vw ≠
  innerWidth, or the 100 % probe ≠ `clientWidth`) a warning sign is added and the tooltip names the failed check. The logic is pure
  (`describeLayout` in `engine/web/viewport.js`, tests in `tests/web/viewport.test.js`).

### Preview and code stay in sync

*Settings ▸ Code studio ▸ Sync highlighting* (command `code.syncHighlight`) controls all of this:

* **Preview to code**: selecting an element scrolls the editor to its start tag and keeps a subtle line highlight with an accent
  bar on those lines. Hovering an element in the preview lightly highlights its lines.
* **Code to preview**: the caret in the page's HTML selects the element in the preview; hovering a line of the page's HTML outlines
  the element there. The caret inside a **CSS rule** outlines every element the rule matches (the selector is evaluated in the
  frame with `querySelectorAll`; states such as `:hover` and pseudo-elements are ignored) and shows a badge "7 elements".
* **Breadcrumb bar** above the editor: `html › body › section.hero › h1`. Click selects the element and shows its code; hovering
  outlines it in the preview. Next to it, **Rules** lists the CSS rules whose last selector part matches the element's tag, id and
  classes (a static approximation without combinators or attributes; the preview does the exact match); each chip jumps to the rule.

### Formatting

*Format Document* (`Shift+Alt+F`, command `code.format`), *Format Selection* (`code.formatSelection`), *Format on save* and
*Format pasted code* use the built-in, dependency-free formatters in `engine/web/format.js`. A formatter contributed by a VS Code
extension still takes precedence for whole documents.

| Language | What it does |
| --- | --- |
| HTML | Re-indents blocks, re-wraps inline text at the line width (a newline between inline items equals a space), wraps long start tags one attribute per line, keeps `<pre>`, `<textarea>`, `<title>`, comments, attribute values and the spacing between inline elements; script and style bodies are re-indented; optional end tags stay omitted |
| CSS | One declaration per line, normalized spacing and blank lines (`formatCss`) |
| JavaScript | Re-indents by bracket depth, trims trailing whitespace, collapses blank lines. No parser: strings, template literals, comments and regex literals are never touched, no tokens are added or moved |
| JSON | Pretty print (invalid JSON, comments and trailing commas are reported, the file is left alone) |
| Markdown | Trailing whitespace, hard breaks kept, blank lines around headings, fenced code untouched |

Options (Settings ▸ Code studio): tab size, *Indent with tabs*, *Formatter line width* (default 100), *Attribute quotes* (keep, double,
single; a value is never rewritten if it contains the chosen quote). Guarantees, tested in `tests/web/format.test.js`: formatting is
idempotent and does not change the rendered structure (tags, attributes, collapsed text) of every starter template. Limit: CSS
`white-space: pre` on an ordinary element is not known to the formatter. The Vibe tool `format_file` runs the same code.

### Split layouts

In Split view choose the arrangement with the four buttons in the toolbar, *View ▸ Split Layout* or the commands
`code.layout.codeLeft`, `codeRight`, `codeTop` and `codeBottom`: code left of the preview (default), code right, code above, or code
below. *Automatic* keeps code on the left and stacks it above the preview when the workbench is narrower than 760 px; an explicit choice
is never overridden. Drag the splitter to resize (the ratio is remembered separately for side-by-side and stacked layouts,
double-click resets to 50/50) or focus it and use the arrow keys (`Shift` for bigger steps; `Home` / `End` for the limits). Both panes
keep at least 240 px. The layout is stored in the project and as the default for new projects. A detached preview in its own window is
not offered yet.

### Code editor shortcuts

| Action | Shortcut |
| --- | --- |
| Command palette | `Mod+Shift+P` (or `F1`) |
| Quick open file | `Mod+P` (prefix `>` commands, `#` elements, `:` line) |
| Find / replace in file | `Mod+F` / `Mod+H` |
| Find in files | `Mod+Shift+F` |
| Go to line | `Mod+G` |
| Expand Emmet abbreviation | `Tab` (for example `ul>li*3`, `.card>h3{Title}+p`, `m10-20`, `df`) |
| Format document | `Shift+Alt+F` (CSS and JSON are rewritten, other languages re-indented) |
| Toggle comment | `Mod+/` |
| Move / copy line | `Alt+↑/↓` · `Shift+Alt+↑/↓` |
| Add next occurrence | `Mod+D` |
| Toggle sidebar / bottom panel | `Mod+B` / `Mod+J` |
| Design / split / code view | `Mod+Alt+1` / `2` / `3` |
| Design mode ↔ live preview | `Mod+Alt+P` |
| Measure tool on / off | `M` (focus in the canvas or workbench, not in a text field) |
| Viewport width / height field | `Enter` applies · `↑` `↓` ±1 · `Shift+↑↓` ±10 |
| Resize handle / splitter | Arrow keys (`Shift` for bigger steps) |
| Split layout | *View ▸ Split Layout* (no default shortcut; assign one in the shortcut editor) |
| Word wrap | `Alt+Z` |

### Libraries, Markdown and LaTeX

* **Libraries** (activity bar, *Libraries…* in the palette): add, update and remove CDN libraries and import-map entries,
  search npm and cdnjs, and *Download into project* (`vendor/`) so the exported site works offline.
* **Markdown and LaTeX files** show a live document preview instead of the canvas, with a formatting toolbar above the
  editor, a heading outline in the Navigator, and export to an HTML page or print / PDF. The LaTeX preview is a subset
  converter, **not a TeX engine**; unsupported commands are marked.
* **Completions** for Tailwind and Bootstrap classes, Alpine and htmx attributes; Add-panel snippets for Bootstrap,
  Tailwind and htmx.

## Preview and security

The canvas is an `<iframe sandbox="allow-scripts …">` **without** `allow-same-origin`. Your page's scripts run, but
they cannot read or change OpenFini, its storage or your documents. A small inspector script is injected as the
first script of the preview; it draws the selection and forwards clicks and keys with `postMessage` — it is never
part of an export.

* Local `<link>`, `<script>`, images and fonts are resolved from the project; scripts are delivered as `data:` URLs
  (the app's Content-Security-Policy forbids inline scripts, and the preview inherits it). ES modules that import
  other project files work; circular imports are reported.
* Inline event handler attributes (`onclick="…"`) are converted to equivalent assignments in the preview.
* Inline import maps are blocked by the desktop CSP, so the preview resolves bare module specifiers through the page's
  import map itself (see [frameworks.md](frameworks.md#the-content-security-policy)).
* The desktop app's CSP allows `https:` images, fonts, stylesheets and embeds and scripts from `cdn.jsdelivr.net`,
  `cdnjs.cloudflare.com` and `unpkg.com`. `fetch` / `XMLHttpRequest` to other servers are blocked in the **desktop
  preview**; the web version has no such restriction. Forms are not submitted in the preview.

## Publishing

**Export ▸ Website** (header button or `File ▸ Export…`):

* **ZIP archive** — upload to any static host.
* **Single-file pages** — CSS, JavaScript and images inlined into each HTML file.
* **Folder** — writes the site into a folder you choose (browsers with the File System Access API, desktop app).

Options: minify HTML and CSS, and generate `sitemap.xml` + `robots.txt` from a site address. The export contains
only your project files — no OpenFini code, no preview bridge. Warnings list broken links and missing files.

Design pages can become assets: *Assets ▸ Add a design page as SVG or PNG* exports a page of the same document into
`assets/` — so artwork made in the Vector, Pixel or Layout studio can be used on the site.

## Architecture in one paragraph

`app/src/engine/web/` is a **pure** engine (no DOM) with an offset-preserving HTML parser and CSS parser, source
edits as `Change[]`, the style-panel schema, the preview and site builders, templates, the element catalog and Emmet
(see [web-engine.md](web-engine.md)). `app/src/core/web.js` is the project model stored in the document.
`app/src/ui/code/` holds the workbench: CodeMirror 6 (vendored, one `EditorState` per file), the preview pane and
its inspector bridge, the explorer, navigator, panels and palette. The module is loaded lazily the first time the
studio is opened, so it adds nothing to application start-up.

## Architecture: viewport, measure and layout

* **Pure logic** (unit-tested, `tests/web/viewport.test.js`, `tests/web/measure.test.js`): `app/src/engine/web/viewport.js` (presets,
  size parsing and clamping, breakpoint markers parsed from CSS, snapping, ruler ticks, layout resolution, split ratios and splitter
  keys) and `app/src/engine/web/measure.js` (unit conversion, distance guides, box bands, strict validation of boxes received from the
  frame). `measureKit()` in `measure.js` is self-contained: `bridge.js` serializes it into the preview frame, so the overlay and the
  host compute identical numbers.
* **Preview pane** (`ui/code/preview.js`): owns `vw`/`vh` (CSS px; `vh` null = fill), derives `bp` from the width
  (`breakpointForWidth`), persists `web.settings.viewport`, `zoom`, `rulers`, and emits `viewport`, `breakpoint`, `measure`. All size
  changes go through `setSize` / `resizeTo` (snapping and aspect lock) so the style panel, toolbar and rulers stay in sync.
* **UI** (`ui/code/viewport-ui.js`): bar, rulers (canvas) and handles; styles in `app/styles/code.css`.
* **Bridge protocol** (additive): host to frame `measure {on, unit, ppi, dprAware, details, accent}` and `measureBox {id, reqId}`;
  frame to host `measureInfo`, `measureBox`, `measureExit`, `measureCopied`, `measureOpt`. The frame is untrusted (the page's own
  scripts can post to the parent), so the host validates every box with `sanitizeBox` and ignores anything malformed.
* **Layout** (`ui/code/workspace.js`): `data-layout` on `.of-split` with CSS flex direction reversal; settings `layout`, `splitH`,
  `splitV`; prefs `codeLayout`, `codeMeasureUnit`, `codeMeasurePpi`, `codeMeasureDpr`, `codeViewportSizes`.
* **Commands and Vibe tools**: `code.measure`, `code.rulers`, `code.viewportRotate`, `code.layout.*` in `commands/code.js`;
  `set_viewport`, `get_viewport`, `measure_element`, `set_code_layout` in `vibe/tools/web-view.js`.

* **Layout metrics and sync** (additive bridge messages): host to frame `viewportOpts {scrollbar}`, `metrics`, `matchSel {selector}`;
  frame to host `layoutMetrics`, `matchCount`. Sync lives in `ui/code/sync.js` (`SyncController`: line highlights as a CodeMirror
  `StateField`, hover links, breadcrumb bar) on top of the pure `engine/web/sync.js` (`crumbsOf`, `openTagLines`, `cssRuleAt`,
  `matchableSelector`, `rulesForElement`; tests in `tests/web/sync.test.js`). Formatters: `engine/web/format.js`; editor entry points
  `CodeEditors#format`, `#formatSelection`, format-on-paste in `editor.js`.

How to extend: add a preset to `DEVICE_PRESETS`, a unit to `UNITS` and the kit's `PER_INCH` / `DECIMALS`, or a bridge message in
`bridge.js` plus a validated handler in `preview.js`.

## Source Control and one-click publishing

The **Source Control** pane (activity bar) gives the project real Git: commits, branches, merging, tags, history with a
graph, diffs, restore from any commit and Git status in the Explorer and the editor gutter. The history is stored
inside the `.ofini` document and can be exported as a ZIP with a real `.git` folder. GitHub sync works through its API;
other servers need a CORS proxy. The **Publish** button (and *Export ▸ Publish*) deploys to Netlify, Vercel, GitHub
Pages and WebDAV, or to FTP/SFTP/rsync/SMTP through a small local helper (`npm run publish:helper`), after pre-publish
checks and a confirmation. Details, storage format and honest limits: [git-and-publishing.md](git-and-publishing.md).

## Limitations

See [roadmap.md](roadmap.md#code-studio). In short: no CMS, symbols/components, interactions editor, multi-page
shared layouts (partials) or real-time collaboration; no stash/rebase in Source Control; no terminal or language servers; the visual designer
edits one page at a time.
