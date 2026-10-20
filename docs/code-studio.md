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
