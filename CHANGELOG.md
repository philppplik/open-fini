# Changelog

All notable changes to OpenFini are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (while below 1.0, minor versions may contain breaking changes).

## [Unreleased]

### Added

**Studio registry, More menu and custom title bar** (docs/studios.md, docs/os-integration.md)
- Studios come from a registry (`registerStudio`); the header shows at most five (Settings ▸ Studios: choose and reorder), the rest are in a new **More** menu. Alt+1..N follow the header order.
- Desktop app: the header is the window title bar (drag, double-click maximize, minimize / maximize / close; macOS keeps the traffic lights). Closing the window asks about unsaved documents.

### Fixed
- Save, Save As, close and export prompts could appear twice (no re-entrancy guard, the Export button could be clicked twice while the popup animated out). They are now one prompt per request.

## [0.4.0] — Extensions, Git, tables and charts, PDF, themes

### Added

**Frameworks, libraries, Markdown and LaTeX in the Code studio** (docs/frameworks.md)
- **13 starter templates that run without a build step:** Tailwind CSS, Bootstrap 5, Alpine.js (CSP build), htmx (with an in-page mock server), Vue 3 (render functions), Preact + htm, React 18 + htm, Lit, vanilla web components, Three.js, a Markdown blog, a Markdown docs site and a PWA starter. Verified in the preview and as exported sites.
- **Library manager:** catalog of 25 libraries, search in npm and cdnjs, versions and files from the jsDelivr data API, scripts, stylesheets and **import-map entries**, update checks, remove, Google Fonts helper and **Download into project** (`vendor/`, recursive for ES modules and stylesheet assets) for offline sites; honors offline mode. The preview now applies import maps itself (the desktop CSP blocks inline import maps).
- **Completions and snippets** for Tailwind and Bootstrap classes, Alpine and htmx attributes, plus Bootstrap, Tailwind and htmx blocks in the Add panel.
- **Markdown:** own CommonMark/GFM renderer (tables, task lists, footnotes, front matter, sanitized HTML, highlighted code, KaTeX math), live preview with scroll sync, formatting toolbar, outline, export to HTML / print to PDF, Markdown-driven sites (`content/` + `layouts/`).
- **LaTeX:** `stex` highlighting, outline and a subset-to-HTML preview with KaTeX math, BibTeX citations, labels and references, honest "unsupported" markers. It is a preview, not a TeX engine.
- **File ▸ Open, drag and drop and Open Folder** accept Markdown, LaTeX, JSON, YAML, TOML, CSV, TypeScript and other text files as one-file projects. KaTeX 0.19 (MIT) is vendored and loaded lazily.
- Vibe tools `list_templates`, `list_libraries`, `search_packages`, `add_library`, `render_markdown`, `convert_latex_preview`, `create_markdown_document`.

**Tables and charts in the Layout studio** (docs/layout-tables-charts.md)
- **Real tables:** new `table` object with a Table tool (`B`), insert dialog, in-canvas cell editing (click, type, Tab / arrows, drag borders), rows / columns (insert, delete, duplicate, move, distribute, fit), merge / split, per-cell fills and per-edge borders, padding, alignment, number formats (number, currency, percent, date), zebra rows, style presets and styles saved in the document, sort by column, **formulas** (`=SUM(B2:B5)`, AVERAGE, MIN, MAX, COUNT, IF, … safe interpreter), copy / paste from spreadsheets (TSV, CSV, HTML), CSV / TSV import and CSV export, flow across pages with repeated header rows, Data Merge support, Data panel and *Table* menu.
- **Real charts:** new `chart` object with a Chart tool (`H`), gallery of ~20 presets (column, grouped, stacked, 100 %, bar, line, area, pie, donut, scatter, radar, big number, progress, ring, sparkline), spreadsheet-like data grid with paste / CSV import, charts **linked to a table** that update live, palettes, legends, axes, log scale, data labels, number formats, alt text exported to SVG `<title>` / `<desc>`. Vector export to SVG and PDF.
- Vibe tools `add_table`, `edit_table`, `read_table`, `list_tables`, `import_csv_to_table`, `add_chart`, `edit_chart`, `read_chart` and the `report-with-charts` skill.

**Git and one-click publishing** (docs/git-and-publishing.md)
- **Source Control in the Code studio:** real Git for website projects with a purpose-built engine (genuine object database, standard index, packfile reader/writer; tested against real Git). Stage/unstage/discard, commit, history graph with search, unified and side-by-side diffs, branches, fast-forward and three-way merge with conflict markers, tags, restore a file from any commit, compare with working copy, `.gitignore`, Explorer badges and editor change markers. History is saved inside the `.ofini` (`web/git/…`); export a ZIP with a real `.git` folder or open a repository ZIP (loose objects and packfiles).
- **Remotes:** GitHub push, pull and clone through the REST API with a personal access token (works from the browser); other HTTPS servers through smart HTTP and a CORS proxy you configure. Tokens live in the device vault, never in documents.
- **Publish** (toolbar button and *Export ▸ Publish*): Netlify, Vercel, GitHub Pages and WebDAV / HTTP PUT, saved targets without secrets, include/exclude patterns, dry-run file list, pre-publish checks (broken links, alt text, title, description, viewport, lang, mixed content), confirmation, progress with Cancel, result with copy/open, deploy history. Cloudflare Pages is not offered (needs BLAKE3 and no browser CORS).
- **Publish helper** (`npm run publish:helper`): local, token-protected program for FTP, FTPS, SFTP (ssh keys), rsync and mailing the site over SMTP.
- Vibe tools `git_init`, `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_checkout`, `git_restore`, `git_push`, `git_pull`, `list_publish_targets`, `add_publish_target`, `preflight_site`, `publish_site`.
- Settings ▸ Code studio: commit author name and email.

**Opening PDFs and other formats** (docs/pdf-import.md, docs/file-compat.md)
- **PDF in the Layout studio:** File ▸ Open, drag and drop, folders and Open With create one Layout page per PDF page (CropBox and rotation honored) with text as editable text frames (embedded fonts reused, substitutes with width-preserving spacing), images, vector paths (fills, strokes, dashes, gradients, clipping, opacity). Import dialog with modes *Editable objects*, *Page images + editable text* and *Text only*, page range, image resolution, password prompt, progress with Cancel. pdf.js (Apache-2.0) is vendored under `app/vendor/pdfjs` and loaded lazily.
- *File ▸ Insert Pages from PDF…*, *Extract Pages as PDF…* and *Import Report…*; one shared import report (kept editable / flattened / dropped) for PDF, AI, PSD, IDML, Sketch and SVG.
- **Illustrator (.ai)** with PDF content and PDF-wrapped EPS open through the PDF importer; other EPS / PostScript-only AI files get an honest explanation.
- **Sketch (.sketch)** best-effort reader (artboards as pages, shapes, gradients, borders, text, bitmaps). Photoshop import: text layers become editable text, smart objects and adjustment layers are reported.
- Affinity, InDesign (.indd), Figma and XD files show exact export steps to an open format; for Affinity files an embedded standard PNG/JPEG preview is offered when one can be found (flattened, labeled).
- Vibe: chat attachments (PDF, AI, PSD, IDML, Sketch) get an *Open as document* button; tools `get_import_report`, `list_pdf_pages`, `describe_document_pages`, `extract_pdf_text`.

**Extensions and SDK** (docs/extensions.md)
- Extension system (`app/src/extensions/`): `.ofext` packages or folders with `openfini-extension.json`; every extension runs in its own sandboxed frame (opaque origin, CSP with no network) and talks to the host over a versioned, permission-checked, rate-limited and size-capped `postMessage` RPC. Install from file, folder or https URL with a consent dialog that lists every permission; enable/disable, per-permission switches, settings, logs, update, uninstall; developer mode with *Load unpacked* and hot reload.
- Contribution points: commands, menus and context menus, keybindings, dock panels, themes (through `registerTheme`), templates, importers/exporters, Code studio snippets, settings, Vibe tools and skills. Document changes go through the Vibe tool layer and each extension command is one undo step; network access is per granted origin and honors offline mode.
- Studio ▸ Extensions…, Settings ▸ Extensions (safe-mode switch, developer mode), Vibe tools `list_extensions`, `run_extension_command`, `install_extension_from_url`, `create_extension`; extension tools (`ext_<id>_<tool>`) always ask for approval and are listed with their origin.
- `sdk/`: typings (`openfini.d.ts`), JSON schema, `create-extension.mjs`, `pack.mjs` (`npm run ext:create`, `npm run ext:pack`) and four working examples.

**Security tools and troubleshooting** (docs/security.md, docs/troubleshooting.md)
- Central logging (`app/src/core/log.js`): leveled, scoped, 2,000-entry ring buffer, automatic redaction of API keys, tokens, credentials in URLs, e-mail addresses and user names in paths; captures console warnings/errors, uncaught errors, rejections, failed resource loads and requests, CSP violations and failed commands.
- *Help ▸ Troubleshooting…* (`Ctrl+Shift+F1`): live log viewer, grouped Problems with plain-language hints, Environment, copy report, save bundle (ZIP/JSON), prefilled GitHub issue (reviewed before opening), safe mode (`?safe=1`), reset guidance; error dot in the status bar; error toasts have *Details*; crash-loop guard offers safe mode after two failed starts.
- Security center (Settings ▸ Security and privacy): live security check, **offline mode** (`app.network.allowed(kind)` for every outbound feature), **app lock** (passphrase, idle/hidden lock, encrypts the autosaved session, recent files, AI keys and chats at rest), protected mode for website projects opened from files, ask-before-opening-links everywhere, privacy tools, stored-data inventory, delete all local data, integrity self-check.
- Vibe tools `get_app_logs`, `get_diagnostics`, `get_security_status`.

**Pixel: histogram and tone tools** (docs/pixel-histogram.md)
- A real Histogram panel: sources (composite, active layer or mask, selection, up to this layer), RGB / luminosity / R / G / B / Lab L* channels, log and bars, hover readout with percentile, statistics, compact mode, data table and an accessible description; large pages are sampled live and measured exactly in the background.
- Clipping overlay on the canvas (shadows blue, highlights red) from the panel or View > Show Shadow / Highlight Clipping.
- Interactive Levels (draggable black / gray / white points on the histogram, numeric fields, per-channel tabs, Auto, eyedroppers) and Curves (histogram backdrop, add / move / delete points, keyboard editing, presets, numeric In / Out, image sampling); before / after histograms for the other adjustments and Develop; **Hold to compare**; adjustment controls that follow undo and Reset.
- Info panel (RGB, hex, HSL, HSB, Lab under the pointer, two pinned samples with delta E, foreground / background).
- Color Range: sample size, source and invert, and a Softness slider that actually works; selection tools show the selected pixel count.
- Vibe tools `get_histogram` and `auto_correct_suggestion`; `apply_adjustment` documents and validates Levels / Curves parameters; the photo-retouch skill starts with the histogram.

**Themes, onboarding and help** (docs/themes.md)
- Eleven color themes besides the default (Slate, Mono, Midnight, Paper, Ocean, Forest, Sunset, Rose, Coffee, Solar,
  High contrast), each with a light and a dark variant and every text and accent pair verified for WCAG AA by a test.
  Themes tint surfaces, borders, selection, the code editor and Shoelace components; Settings ▸ Appearance has a theme
  gallery with live previews; the accent presets remain an override; extensions can `registerTheme()`.
- Themed scrollbars everywhere (including inside Shoelace dialogs and selects and the code editor), thicker in high-contrast mode.
- Command palette (`Ctrl/Cmd+K` or `F1`) with fuzzy search, shortcuts, recent commands and studio-aware ranking.
  The keyboard shortcuts dialog moved to `Ctrl/Cmd+/`.
- Welcome tour and a mini tour per studio (offered once, repeatable from Help), "What's this?" mode (`Shift+F1`), tooltips
  with a one-line explanation for tools, panels and studios, hints in empty panels, a What's new dialog, and
  Settings ▸ Onboarding and help.
- Vibe tools `list_themes`, `set_theme`, `start_tour`, `list_commands` and the built-in skill `help-me-use-openfini`.
- Text on the accent color now follows `--of-on-accent` (readable in every theme), consistent menu item alignment.


**Open with OpenFini** (docs/os-integration.md)
- File associations: `.ofini` and `.ofext` open on double click; PSD, PSB, IDML, SVG, PNG, JPEG, WebP, GIF, BMP, AVIF,
  PDF, AI, Affinity files, Markdown, LaTeX, HTML, CSS, JS, JSON, TXT and CSV are offered under "Open with" without
  becoming the default app (macOS rank Alternate, Linux `.desktop` MIME list, Windows "Open with" registration).
- Command line: `openfini [--help] [--version] [FILE...]`; a second launch opens the files in a new tab of the running window.
- Already open files are brought to the front instead of opening twice; large files show progress.
- Document icon for `.ofini` files (Windows, macOS, Linux), Linux shared-mime-info entries for every OpenFini type.
- PWA: file handlers for all types, Web Share Target (share images and files to OpenFini), files opened before the
  app is ready are queued.
- Vibe tools `get_platform_info` and `list_recent_files`; Settings ▸ General ▸ Open with OpenFini.

## [0.3.0] — Vibe Studio

### Added

- New OpenFini logo and app icon (UI, installers, PWA).

**Vibe Studio** (`Alt+5`) — an AI studio that works natively with OpenFini. See docs/vibe-studio.md.
- Chat with attachments, skills (`/`), memory, a plan view, tool cards and a live Canvas of the document being made;
  the assistant uses 52 tools across Vector, Pixel, Layout and Code and every run can be undone in one click.
- Bring your own model: OpenRouter (OAuth sign-in), OpenAI, Anthropic, DeepSeek, xAI, Mistral, Groq, Together, Gemini,
  Ollama, LM Studio and any OpenAI-compatible server. Keys stay on the device, optionally encrypted with a passphrase.
- Permission modes (careful / balanced / auto), MCP servers (Streamable HTTP) with `npm run mcp:gateway` for stdio
  servers, RAG over your documents and open website project, SKILL.md-style skills (eight built in), custom tools the
  assistant can write (sandboxed), image generation and editing.
- Right-click AI functions in the canvas, the code editor and the website designer.
- An offline Demo assistant that needs no key. AI features are **off by default** (*Settings ▸ Artificial intelligence*).
- Pure AI runtime in `app/src/ai` with its own tests (docs/ai-engine.md).

**Settings and compatibility**
- Settings dialog with sidebar (General, Appearance, Accessibility, Canvas and editing, Code studio, Artificial
  intelligence, Security and privacy, Keyboard shortcuts, About), logo menu with *Save All* and *Open Folder…*.
- Open PSD / PSB and IDML, export PSD; drag and drop files or folders anywhere on the window; open whole project
  folders (website projects or design files). See docs/file-compat.md.

### Changed
- The application JavaScript budget is 520 KiB gzip (was 400): the Code studio and Vibe Studio chunks are loaded lazily.

## [0.2.0] — Code studio

### Added

**Code studio** (replaces the Export studio in the studio switcher; `Alt+4`)
- Website projects inside the `.ofini` document: a code editor (CodeMirror 6: one tab and undo history per file,
  HTML / CSS / JavaScript / JSON / Markdown / SVG, completions that know classes, custom properties and files,
  Emmet on `Tab`, find and replace, find in files, command palette, quick open, diagnostics) and a visual
  designer (live sandboxed canvas at desktop / tablet / mobile breakpoints, element navigator with drag and drop,
  element palette, class-based style panel with inherited values, settings panel, inline text editing).
- Source-preserving edits: visual actions are written as minimal text changes to HTML and CSS; typing updates the
  canvas instantly; rename / move updates links.
- Pure web engine (`app/src/engine/web`): offset-preserving HTML and CSS parsers, edit producers, style schema,
  preview and site builders, six starter templates, element catalog, Emmet. See docs/web-engine.md.
- Console and Problems panel, assets pane, design pages as SVG / PNG assets, static-site export.

**Export popup**
- Export is now a popup (header button, `Mod+Shift+E`) available from every studio, with *Image & PDF*, *Slices*
  and *Website* tabs. The Slice tool moved to the Vector and Layout toolboxes.

### Changed
- The desktop Content-Security-Policy now allows `data:` scripts and `https:` images, fonts, stylesheets and
  frames so that website previews work; the application itself still loads nothing remote.
- Menus follow the active studio.

## [0.1.0] — first public alpha

### Added

**Platform**
- Installable offline PWA and Tauri 2 desktop app for Windows (x64, ARM64), macOS (Intel, Apple Silicon)
  and Linux (x64, ARM64); GitHub Actions for CI, GitHub Pages and tag-triggered releases with checksums.
- Shoelace-based design system with dark / light / system themes, Inter typeface, OpenFini icon set.
- Low-power mode (automatic on weak hardware), size budgets enforced in CI.

**Document**
- `.ofini` format (ZIP + JSON + PNG pixel layers), autosave and session restore, recent files.
- Pages, master pages, facing pages, bleed, margins, columns, guides, grid, rulers, snapping.
- Transactional undo / redo with coalescing and byte-budgeted history.

**Vector studio**
- Pen, pencil, shapes, 17 preset shapes, node editing, transform handles, booleans, expand stroke,
  convert to curves, gradients (linear, radial, conical), strokes, live effects, blend modes.
- SVG import and export; image trace.

**Pixel studio**
- Layers, groups, masks, selections (marquee, lasso, wand, color range, refine), brushes with pressure,
  eraser, fill, gradients, clone / heal / spot heal / red eye, smudge / blur / sharpen, dodge / burn / sponge.
- 18 adjustment layers, 22 live filters, Develop and Tone Mapping, auto levels / contrast / color, histogram.
- Crop, resize, canvas size, Liquify.

**Layout studio**
- Text engine with in-canvas editor, linked frames flowing across pages, tabs, bullets, drop caps,
  hyphenation (en-US), styles, tables, table of contents, page-number fields, data merge from CSV.
- PDF export with embedded fonts, transparency, gradients, bleed and crop marks.

**Export studio**
- Slices, per-slice format and scale, batch ZIP export; PNG / JPEG / WebP / SVG / PDF.

### Known limitations
See [docs/roadmap.md](docs/roadmap.md).

[Unreleased]: https://github.com/philppplik/open-fini/compare/v0.1.0...HEAD
[0.2.0]: https://github.com/philppplik/open-fini/releases/tag/v0.2.0
[0.1.0]: https://github.com/philppplik/open-fini/releases/tag/v0.1.0
