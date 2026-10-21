# Frameworks, libraries and documents in the Code studio

OpenFini cannot run Node.js, so there is no `npm install`, no bundler and no dev server. "Framework support" therefore
means **projects that run as they are**: the sandboxed preview and the exported static site load ES modules, import maps
and CDN-delivered runtimes directly in the browser. This page explains what that covers, the starter templates, the
library manager, offline use, and the Markdown and LaTeX support (including its limits).

## What is possible without a build step

| Works | Does not work |
| --- | --- |
| Classic scripts, ES modules (`<script type="module">`), import maps, dynamic `import()` | JSX, TypeScript compilation, `.vue` single-file components, Svelte, Sass, PostCSS, tree shaking |
| Libraries from jsDelivr, cdnjs and unpkg, or copied into `vendor/` | Packages that need Node APIs or a bundler to resolve their imports |
| Web components, htm tagged templates, Vue render functions, Alpine components, htmx attributes | Vue **template strings** and Alpine's standard build (they need `unsafe-eval`, which the desktop app's Content-Security-Policy forbids) |
| Tailwind CSS through its browser build (prototypes) | Production Tailwind builds (use the Tailwind CLI elsewhere) |
| Service workers and manifests in the exported site | Service workers **in the preview** (it is a sandboxed frame); test a PWA after export |

### The Content-Security-Policy

The desktop app allows scripts from `'self'`, `data:`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com` and `unpkg.com`, and
no `eval`. `esm.sh` is **not** allowed (it would need a deliberate CSP change), so the templates use jsDelivr's `+esm`
builds instead. The web version has no such restriction, but everything here works under the desktop policy, and
`node scripts/serve.mjs --csp` lets you check your own projects against it.

**Import maps in the preview.** Browsers treat an inline `<script type="importmap">` as an inline script, which the
desktop CSP blocks. The preview therefore *applies the import map itself*: bare specifiers in your modules are rewritten
to the mapped URL (or to the project file, for local entries such as `./vendor/vue.js`). The import map stays in the page
for the exported site, where it is a normal import map. Limits: `scopes` are not applied, and remote modules that import
bare names (for example `three/addons/…` from a CDN) cannot be rewritten; prefer jsDelivr's `/+esm` URLs, whose
imports are absolute.

## Template matrix

*File ▸ New ▸ Code* shows the plain templates first, then these. Every one is verified in the preview and as an exported
site without console errors.

| Template | Libraries (CDN, pinned) | Notes |
| --- | --- | --- |
| Tailwind CSS | `@tailwindcss/browser` 4.1 | Dark mode toggle with a `@custom-variant`; the browser build prints a "not for production" console warning. |
| Bootstrap 5 | Bootstrap 5.3 CSS and bundle | Navbar, cards, accordion, modal, validated form. |
| Alpine.js | `@alpinejs/csp` 3.14 | CSP build: register components with `Alpine.data()`; attribute expressions cannot assign (`x-model`), call methods with arguments or build object literals. |
| htmx | htmx 2.0 | `allowEval` is off. `js/mock-server.js` answers requests inside the page so it works offline; delete it and point `hx-get` at a real server. |
| Vue 3 | `vue` 3.5 runtime build | ES modules, import map, components written with `h()` render functions. |
| Preact + htm | `htm/preact/standalone` | Hooks and JSX-like tagged templates. |
| React | React 18, ReactDOM, htm (jsDelivr `+esm`) | Hooks; templates with htm (no JSX compiler). |
| Lit | Lit 3 | Custom elements with reactive properties and scoped styles. |
| Web components | none | Vanilla custom elements with Shadow DOM, slots, accessible tabs. |
| Three.js | three r170 | Scene, lights, drag to rotate, reduced motion honored. |
| Markdown blog | none | Posts in `content/posts/*.md`, layouts in `layouts/*.tmpl`, generated pages included. |
| Markdown docs site | none | Sidebar from page titles, "On this page" table of contents. |
| PWA starter | none | Manifest, service worker (app shell cache, offline page), install button, notes in `localStorage`. SVG icons only: some browsers want PNG icons before they offer installation. |

## Libraries

Open **Libraries** from the activity bar, the command palette (*Libraries…*) or Vibe (`add_library`).

* **Installed**: every script, stylesheet and import-map entry of every page, plus CDN `import` statements in your
  JavaScript. *Check for updates* asks jsDelivr / cdnjs for newer versions; *Update* rewrites the URL. *Remove* deletes
  the tag or import-map entry (and the import map itself when it becomes empty).
* **Popular**: a catalog of 25 libraries with pinned, tested versions (Tailwind, Bootstrap, icons, Alpine, htmx, Vue,
  React, Lit, Three.js, Chart.js, D3, GSAP, marked, Day.js, KaTeX, highlight.js …). A Google Fonts helper adds the
  stylesheet link (the font itself is loaded from Google; self-hosting fonts is not automated).
* **Search**: npm packages (registry search) or cdnjs. Choose a package, a version (jsDelivr data API
  `https://data.jsdelivr.com/v1/package/npm/<name>`), a file (suggested scripts, ES modules or stylesheets) and whether
  to use it as a `<script>`, a `<link>` or an import-map entry. The file list comes from the jsDelivr API.

All edits go through the editor, so they are undoable and keep your formatting. The import map is created in `<head>`
before any script and edited as JSON.

### Download into project (offline)

*Download into project* fetches the file and what it needs and stores it under `vendor/<package>@<version>/…`:

* ES modules: imports that are absolute URLs or root paths (jsDelivr's `+esm` bundles import their siblings) are
  downloaded recursively and rewritten to relative paths.
* Stylesheets: `url(…)` assets such as fonts and images and `@import`ed sheets are downloaded; the relative layout is kept.
* The page then points at `./vendor/…`, and the exported site works with no network. Limits: 80 files and 12 MB per
  library; only jsDelivr, cdnjs and unpkg hosts are fetched; source map comments are removed.
* Licenses stay your responsibility: vendored libraries keep their own license headers, add notices where required.

### Offline mode and errors

Every request (search, versions, downloads) first asks `app.network.assert("cdn")`; with offline mode on you get the
standard offline message and nothing is sent. Other failures are explained: host unreachable, timeouts after 20
seconds, "not found". Libraries already in the project keep working.

## Completions and snippets

* **Class names**: Tailwind (about 6,000 utility names generated from the scale, with variant prefixes such as `md:`,
  `hover:`, `dark:`) and Bootstrap 5.3 classes are offered in `class="…"` when the project uses that framework
  (detected from tags, import maps and scripts), next to your own classes.
* **Attributes**: Alpine (`x-data`, `x-show`, `@click`, `:class` …) and htmx (`hx-get`, `hx-target`, `hx-swap` …),
  with common values for `hx-swap`, `hx-trigger` and `hx-target`.
* **Add panel**: Bootstrap components (navbar, card, grid, alert, accordion, modal, form group, tabs, list group),
  Tailwind blocks (button, card, hero, feature grid, badge, input) and htmx patterns appear when the project uses them.

## Markdown

Open `.md`, `.markdown` or `.mdx` files from *File ▸ Open*, by drag and drop or inside a folder.

* A single file opens as a **one-file project** (sidebar closed, editor and preview only); a folder keeps its structure
  and opens the README, `index.md` or `main.tex` first. *Save this file…* in the preview bar writes the text back out.
* **Editor**: CodeMirror Markdown mode and a toolbar (bold, italic, strikethrough, code, headings, quote, lists, tasks,
  link, image, table, code block, rule, footnote, math).
* **Preview** (own renderer, `engine/web/markdown.js`): CommonMark with GFM tables, task lists, strikethrough, bare URL
  autolinks, footnotes, front matter (shown as a table), `{#custom-id}` heading ids, fenced code with simple syntax
  highlighting (JavaScript/TypeScript, JSON, CSS, HTML, shell, Python, YAML, TOML, SQL, diff, Go, Rust, C family, TeX),
  `$…$` / `$$…$$` math through KaTeX, and `.mdx` in a lightweight form (imports and exports are ignored, components are
  shown as placeholders; JSX is never executed). Scrolling follows the caret.
* **Safety**: the HTML is sanitized with an allowlist (no scripts, styles, frames, forms, event handlers, ids or classes;
  only `http(s)`, `mailto`, `tel`, relative and `data:image` URLs); project images are served as blob URLs; remote images
  are skipped in offline mode. Relative `.md` links open the file.
* **Export**: *Export as HTML page* adds a standalone page to the project (math pre-rendered; the KaTeX stylesheet loads
  from jsDelivr), *Download* saves it, *Print or save as PDF* uses the system print dialog with print styles (page
  margins, URLs after links, no page breaks inside code and tables).
* Known limits: no raw-HTML block nesting corner cases beyond what CommonMark specifies for kinds 1 to 7, no HTML
  entities beyond about 70 common names, no Mermaid or diagrams, no emoji shortcodes, no definition lists.

### Markdown-driven sites

Projects with `content/**/*.md` and `layouts/*.tmpl` are turned into HTML pages automatically whenever a Markdown file,
layout or `site.json` changes (or with *Build Pages from Markdown*). Front matter: `title`, `description`, `date`,
`layout`, `order`, `nav`, `slug`, `draft`, `hidden`. Layouts use `{{title}}`, `{{{content}}}`, `{{#each posts}}…{{/each}}`,
`{{#if date}}…{{/if}}`, `{{nav}}` items, `{{toc}}`, `{{root}}` and `{{site.title}}`. Links to `.md` files become `.html`
links and paths that start with `/` are relative to the site root. Generated files carry a marker comment; hand-written
files with the same name are never overwritten, and the exported site leaves out `content/`, `layouts/` and `site.json`.

## LaTeX

Open `.tex` / `.latex` (and `.bib`, `.sty`, `.cls`) files the same way. Highlighting uses CodeMirror's `stex` stream mode.

> **The LaTeX preview is not a TeX engine.** It converts a practical subset to HTML. It does not reproduce page layout,
> fonts, hyphenation, page numbers, floats placement or most packages.

* **Understood**: `\documentclass`/`\usepackage` (ignored with a note), `\title \author \date \maketitle`, abstract,
  `\part … \subparagraph` (numbered like LaTeX, starred variants, `\appendix`), text styles and size declarations,
  special characters, accents and ligature-like dashes and quotes, `itemize/enumerate/description`, `quote/verse`,
  `center`, `tabular` (`\hline`, `\multicolumn`), `figure/table` with `\caption`, `\includegraphics` of project images,
  `\label/\ref/\eqref/\autoref/\cref`, `\cite/\citep/\citet` with `.bib` files or `thebibliography`, `\footnote`,
  `\newcommand`/`\def`/`\newenvironment` (macros are also expanded inside math), `\newtheorem` and `proof`, `verbatim`
  and `lstlisting`, `\input`/`\include`, `\tableofcontents`, `\url`/`\href`.
* **Math** is typeset with KaTeX (vendored under `app/vendor/katex`, MIT, loaded only when a document has formulas).
  KaTeX supports most of amsmath's core but not everything; a formula it rejects is shown as source with the reason.
* **Honest degradation**: unknown commands and environments appear as highlighted markers, are listed under *notes about
  this preview* with line numbers, and counted in the status. Undefined references and citations show `??`.
* **Export**: the same HTML export, download and print buttons as Markdown (print styles apply; the output is a browser
  rendering of the preview, not a PDF typeset by LaTeX). The Navigator shows the section outline.

## Other text files

`.txt .json .yaml .yml .xml .csv .tsv .toml .ini .conf .properties .log .ts .tsx .jsx .js .css .html` open as one-file
projects with syntax highlighting (JSON, YAML, TOML, INI, TypeScript/JSX via CodeMirror; the rest as text). Files that
contain NUL bytes are refused as binary. `.svg` keeps opening as a vector document in the Vector studio.

## Vibe tools

`list_templates`, `list_libraries`, `search_packages` (network, asks first), `add_library` (network, asks first),
`render_markdown`, `convert_latex_preview`, `create_markdown_document`. `create_website` accepts every template id.
