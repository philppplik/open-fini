# Changelog

All notable changes to OpenFini are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (while below 1.0, minor versions may contain breaking changes).

## [Unreleased]

### Security
- Resolved all open CodeQL code-scanning alerts: the compact-CSS regexes no longer backtrack polynomially, `h()` lost its `html` (innerHTML) option, tag stripping and removal in the Markdown, LaTeX, SSG, table-import and extension-panel code now repeat until stable (nested fragments like `<scr<b>ipt>` cannot reassemble), script end tags such as `</script >` are recognized, generated ids and window ids come from `crypto.getRandomValues`, extension and preview message handlers are looked up with `typeof function` checks, and external links open the re-serialized URL. Regression tests in `tests/core/sanitizers.test.js`.
- Dependabot alerts and security updates are now enabled for the repository; `docs/security.md` lists the vendored libraries with their versions and the date they were checked against known advisories.

### Changed
- Tauri CLI 2.12.3 (bundler 2.10.3, NSIS 3.13): the custom installer template picked up the upstream uninstaller clean-up fix (the in-place uninstaller leaves no stray `uninstall.exe`/install folder after an upgrade).
- GitHub Actions: `dtolnay/rust-toolchain` pin updated.

### Fixed
- Test-only regex and no-op `replace` calls flagged by code scanning were cleaned up.

## [0.7.0] — Collaboration, Code studio tools, glass

### Added
- **Surface styles** (Settings ▸ Appearance ▸ Surface style): optional **Glass** (frosted glassmorphism), **Liquid glass** (bevelled, refractive, soft sheen on controls) and **Sea glass** (muted green-teal, matte, light grain) on top of any color theme, in light and dark. Sliders for Blur, Transparency and Dim, a selectable background layer (Aurora, Ocean, Dusk, Sea glass, Mono, accent-derived, optional slow drift, or your own image that stays on the device, is downscaled to 1920 px and is never exported). Applies to the chrome only: the document canvas, pickers and artboards stay opaque and color-accurate. Text stays AA over the worst backdrops (fill-opacity floor and lifted text colors, tested in `tests/ui/glass.test.js`); blur turns off automatically in Low-power mode, High contrast, `prefers-reduced-transparency` and without `backdrop-filter` (opaque panels, same tint). New prefs `surfaceStyle`, `glassBlur`, `glassTransparency`, `glassBackdrop`, `glassDim`, `glassAnimate` travel in customization profiles; extension themes may set `surface` (`"none"` opts out). Vibe: `set_theme` / `list_themes` accept and report `surface`. See [docs/themes.md](docs/themes.md#surface-styles).
- **Code studio, pixel-exact viewport**: a viewport bar above the preview with width and height fields (CSS px; Enter or blur applies, arrows ±1, Shift ±10), aspect lock, rotate, generic device presets (Desktop 1440/1280/1024, Tablet 820/768, Phone 390/375/360/320), your own saved sizes, zoom from 25 to 400 % or Fit (crisp at 100 %), a width slider that snaps to breakpoints (hold Alt to disable), drag handles on the right, bottom and corner edges with a live size badge, and rulers with breakpoint markers taken from the editor's breakpoints plus the `@media` rules in your CSS (click a marker to jump to that width). The breakpoint of the style panel follows the viewport width.
- **Code studio, measure tool** (`M`, toolbar, View menu): hover any element in the preview for margin, border, padding and content bands, its size and the distance to the viewport edges; hold Alt for the distance to the pinned, selected or parent element; click to pin, Shift+click to link two elements; `Ctrl+C` copies "320×48px". Units: px, mm, cm, in, pt, rem, em and % of the parent, with a configurable pixels-per-inch basis (96 = CSS reference) and an optional device-pixel mode.
- **Code studio, split layouts**: code left, code right, code above or code below the preview (toolbar buttons, View ▸ Split Layout, `code.layout.*` commands), a draggable and keyboard-resizable splitter with a remembered ratio per orientation (double-click resets to 50/50), minimum pane sizes, and automatic stacking in a narrow workbench unless you picked a layout.
- Vibe tools `set_viewport`, `get_viewport`, `measure_element` and `set_code_layout`. See [docs/code-studio.md](docs/code-studio.md).
- **Collaboration** (*Studio ▸ Collaborate…* or the people button in the header): end-to-end encrypted rooms over a relay you run yourself (`npm run relay`, a dependency-free WebSocket relay in `scripts/relay.mjs`) or between the windows of this device. A floating chat that stays open across studios with @mentions (autocomplete, toast and title badge), replies, threads, reactions, edit/delete, typing indicator, files up to 25 MB (allow-listed, never opened without a click), links that jump to a layer, page or code line, and an optional activity feed of edits ("Move · 3 layers on Page 2 · Jump · Show"). Live cursors, selection halos and editor carets, *follow* a member's view, host roles (editor / commenter / viewer), removal with automatic key rotation, six verification words. See [docs/collaboration.md](docs/collaboration.md) and [ADR 0010](docs/adr/0010-collaboration-e2e-relay.md). Simultaneous editing of the same document is not live yet: documents are shared as snapshots.
- **Comments** like in Google Docs on layers, pages, Office text and code lines: threads, replies, resolve/reopen, @mentions, markers on the canvas that follow their layer, a Comments tab with filters. Saved in the document (`document.json ▸ comments`, additive) and synced in rooms; they also work without a room.
- **Named versions**: *Save Version…* keeps complete snapshots on this device (with thumbnail, author and note, up to 30 per document); restore in place as one undoable step (a snapshot of the current state is saved first), open as a copy, or send a version to the room.
- **Settings ▸ Profile and collaboration**: nickname, presence color and picture (≤ 128 px, stored only on this device and never exported in profiles), activity feed, cursors, notifications; a *Collaboration* entry in the security center with one-click *Leave*.
- Vibe tools `get_collab_status`, `read_chat`, `post_chat_message`, `list_comments`, `add_comment`, `reply_comment`, `resolve_comment`, `list_versions`, `save_version`.

### Changed
- Desktop Content-Security-Policy: `connect-src` allows `ws:` and `wss:` for user-entered relays; offline mode gains the `collab` kind and blocks every relay that is not on this computer. Log redaction removes collaboration invite codes. The header's default quick actions include *Collaborate*.

## [0.6.0] — Your files stay yours

### Added
- **Save in the original format**: a file opened with File ▸ Open is saved again as the same kind of file (a `.txt` stays a `.txt`, a `.docx` stays a `.docx`, `.md`, `.json`, `.odt`, `.rtf`, `.html`, `.svg` too). Only when edits need more than the format can hold (a second file, design pages, pixel layers ...) does Save ask once whether to switch to `.ofini`. Text keeps its BOM and line endings and unchanged files are written byte for byte. Raster images, PSD and PDF are never overwritten (Save writes `.ofini`; Save As offers a flattened export). New setting *Save opened files in their original format when possible*, a save-target badge in the status bar, and the Vibe tool `get_save_target`. See [docs/file-compat.md](docs/file-compat.md).
- **.ofini versioning and migration** (`app/src/core/ofini-migrate.js`): old documents are upgraded in memory when opened (the file stays untouched until you save), documents from a newer OpenFini open best-effort with a warning and a confirmation before the first Save. A frozen version 1 sample guards compatibility; the checklist for format changes is in docs/file-format.md.
- **Quit with unsaved documents**: one dialog lists them with *Save All / Discard / Cancel* (desktop close button, Alt+F4, Cmd+Q); the browser/PWA arms the browser's leave-page warning.
- **Custom AI provider**: pick the API type (OpenAI- or Anthropic-compatible) and extra headers; when a server has no model list you can type the model id.
- **More accent colors**: 12 additional presets and a free color picker (Settings, Appearance).

### Fixed
- Settings search lost its focus after every typed letter.

### Changed
- The header no longer shows the light/dark toggle and the panel toggle by default (View menu, command palette and *Settings, Toolbox and menus, Quick actions* still offer them).

## [0.5.0] — Office, concurrent Vibe chats, multi-window, German

**Small improvements**
- **Update checker** (Settings, About): "Check for updates" asks GitHub for the latest release, compares versions and offers the installer for your platform plus the release notes; optional automatic check once a day (off by default); honors offline mode. Nothing is installed automatically.
- **Hidden layers** stay in the Layers panel (dimmed, with a highlighted eye) instead of disappearing, so they can be shown again.
- **Header logo**: the white OpenFini mark on an accent-colored tile, in every theme (`app/icons/mark-white.svg`).

### Added

**Vibe engine: concurrent chats, sub-agents, power tools, skills v2** (docs/vibe-studio.md, docs/vibe-skills.md, ADR 0008)
- **Several chats at once:** chats keep running in the background with status badges (running, needs approval, done, failed), a "Stop all" kill switch, per-chat model and approval mode, queued approvals that never steal focus, a fair document write lock and per-run undo that stays correct (or explains why not) when chats share a document.
- **Sub-agents:** `spawn_agent`, `wait_agent`, `list_agents`, `cancel_agent` delegate focused tasks to parallel child runs with restricted tools, budgets and a depth limit; live nested cards with cancel; optional cheaper sub-agent model.
- **Power tools:** `run_plan` (many calls in one turn with step references, one approval, one undo), `query_layers`, `describe_page` / `describe_selection` (compact scene text, revision cache), `apply_to_many`, `evaluate` (sandboxed JS), `screenshot_layers`, `compare_screenshots`, `grid_layout`, `distribute_layers`, `snap_layers`, `make_component`.
- **Attachments:** `list_attachments` and `open_attachment` open a file attached in the chat as a new document.
- **Skills v2:** parameters with a form, composition (`requires`), reference files, triggers with a "Use skill X?" chip, optional enforced tool restrictions, versions, studio filters, usage stats, editor with live preview and validation, `.skill.md` / `.skillpack` import and export, Demo test runs, "Create from this chat" (`create_skill` drafts) and 16 new built-in workflow skills.
- **AI progress pill:** a floating "AI is …" status with progress, Stop and open-chat in every studio.

**Pop-out windows and recent files** (docs/multi-window.md)
- **Pop-out windows:** move or copy a document tab, or open a studio, in its own window (tab and studio-button right-click, File ▸ New Window, Detach Current Studio, Return to Main Window). Documents are handed over through IndexedDB and a BroadcastChannel; the source closes its copy only after the new window confirmed. Preferences stay in sync across windows. Desktop uses real Tauri windows; the browser uses a popup window.
- **Recent files:** Clear recent on the start page with a 6-second Undo, a remove button per entry, File ▸ Open Recent ▸ Clear Recent, and settings for showing the list and how many files to remember (0-50).
**More native file formats** (docs/file-format-research.md, docs/file-compat.md)
- Research with sources and a legal / technical verdict per format (Affinity, Adobe, Figma, Krita, GIMP, TIFF, HEIC, fonts, palettes ...). Affinity (including the new single-app `.af`), InDesign, Figma and XD stay export routes; the guidance dialogs have updated steps and link to the research.
- Open **TIFF** (multi-page, LZW / PackBits / Deflate, 1 to 16 bit, CMYK), **animated GIF** (frames as layers), **OpenRaster** (read and write with layers and blend modes), **Krita** (flattened), **ICO / CUR**, and the preview image of DOS **EPS** files, each with an import report.
- Color palettes: import and export **GPL, ASE and ACO** through File > Swatches.
- Fonts: WOFF is unwrapped, TrueType collections (.ttc) are split, WOFF2 works on screen (PDF export falls back).
- Vibe tools `list_supported_formats`, `import_palette_from_text`, `export_palette`.

**Internationalization, German first** (docs/i18n.md, ADR 0007)
- The interface follows the system language automatically (`navigator.languages`, `de-AT`/`de-CH` match German) and ships in US English and **German**; Settings ▸ General ▸ Language switches live without a reload and shows the detected language. Menus, command labels, the palette, settings, new document / about / shortcuts dialogs, welcome screen, status bar, studio bar, title bar, tours, What's new, context menus, common toasts and the Vibe composer are translated; the rest falls back to English (known gaps are listed in docs/i18n.md).
- Core in `app/src/i18n/` (`t()` with the English text as key, ICU-lite plurals and placeholders, lazy locale files, `<html lang>`/`dir`, `Intl` helpers); `npm run i18n:extract` and `i18n:check` keep the catalog and translations consistent in CI. Adding a language is one `LOCALES` entry plus a JSON file.
- Extensions can use `%key%` placeholders resolved from `locales/<code>.json`; Vibe replies follow the UI language; the offline page has a German variant.

**Bundled extensions** (docs/bundled-extensions.md)
- Five extensions ship with the app but are **not installed by default**: **Palette Pro** (palettes from selection or image, harmonies, WCAG contrast checker with fixes), **Batch Export & Rename** (sizes x formats with a name template, ZIP, bulk rename), **Lorem & Data Filler** (seeded placeholder text, names, emails, prices, avatars, HTML lists/tables/cards), **Code Snippets & Formatter** (44 snippets, format/minify/sort CSS for HTML, CSS, JS and JSON, own snippets) and **Accessibility Checker** (designs and websites, fixes, Markdown report).
- **Available extensions** gallery in the extension manager: permissions shown, normal consent dialog, Installed / Update state. The packages are data in `dist/extensions/` (not precached, not part of the size budget). `npm run ext:pack-all` builds them.
- Extension API (additive): permission `export` and `document.export()` render layers and pages to image bytes; the `set_style` tool accepts `alt`, and `get_selection` / `list_layers` report font size, family and weight of text layers. The extension tools appear in Vibe through `list_extensions` / `run_extension_command`.
- Fixed: inserting HTML into a page in the Code studio (`insert_html`) failed with "k is not defined" because of a broken outline panel handler.

**Customization everywhere** (docs/customization.md)
- **Keyboard shortcut editor:** click to record, conflict detection (swap / unassign / use for both), two shortcuts per command, search and filters, reset one or all, import / export JSON, presets Default, Classic, Compact and Editor-style. Menus, tooltips and the palette show the effective shortcut.
- **Toolbox and menus:** show, hide, reorder and ungroup tools per studio, hide menus and menu items, choose the header's quick actions. Hidden tools stay in the command palette ("Tool: …").
- **Layout and workspaces:** panel visibility, dock side and width, built-in and saved workspaces per studio, reset layout.
- **Look and defaults:** interface text size, interface font, corner radius, animation speed, pointer size, canvas background, checkerboard, grid, guide and selection colors, default new-document, export and text settings. Reset arrow per setting and per section.
- **Profiles:** export / import `.ofprofile` with a strict validator and a merge / replace preview, named profiles (Work, Presentation, Low power templates), reset everything. Secrets, keys and documents are never included.
- **Hooks:** `app.customize.registerSetting` and `registerToolboxEntry` for extensions and future studios.
- Vibe tools `get_settings`, `set_setting`, `list_shortcuts`, `set_shortcut`, `export_profile`.
**Studio registry, More menu and custom title bar** (docs/studios.md, docs/os-integration.md)
- Studios come from a registry (`registerStudio`); the header shows at most five (Settings ▸ Studios: choose and reorder), the rest are in a new **More** menu. Alt+1..N follow the header order.
- Desktop app: the header is the window title bar (drag, double-click maximize, minimize / maximize / close; macOS keeps the traffic lights). Closing the window asks about unsaved documents.
**Office Studio: a word processor for Word documents** (docs/office-studio.md)
- **New studio** with page view (real page sheets, headers and footers with page numbers), web layout, zoom, a formatting toolbar, outline and styles sidebar, find and replace (regular expressions), word count, page setup, named styles with inheritance, lists with levels, tables (insert with a grid picker, rows and columns, merge and split, shading, borders, header rows), images, links, footnotes, spellcheck and an optional dark page; every edit is one step of the normal undo history.
- **Open and save** Word `.docx`, OpenDocument `.odt`, RTF, HTML, Markdown and text, and **export PDF**; clean-room readers and writers with an import report, ZIP-bomb and path-traversal limits and sanitized HTML. `.docx`, `.odt` and `.rtf` join the "Open with" lists. Google Docs shortcuts (`.gdoc`), Apple Pages, legacy `.doc`, spreadsheets and presentations are recognized and explained (with a button that opens a Google document in the browser).
- **Vibe**: ten `office_` tools, the `write-business-document` skill and AI quick actions in the editor's context menu (Improve writing, Fix grammar, Summarize, Translate, Change tone).

### Fixed
- Save, Save As, close and export prompts could appear twice (no re-entrancy guard, the Export button could be clicked twice while the popup animated out). They are now one prompt per request.
**Context menus and text tools** (docs/context-menus.md)
- **One context menu service** (`app/src/ui/context-menu/`): menus are assembled from providers that match what was clicked (canvas, layers, tabs, explorer, history, assets, navigator, panels, status bar, rulers, recent files, text fields, code editor, Vibe messages and tool cards). Keyboard navigation, type-ahead, screen-reader roles, viewport-aware placement, a "last used" marker, touch long-press, and Shift + right-click for the browser menu in text fields. Extensions can contribute to `context:code`, `context:explorer`, `context:layers` and `context:text` besides `context:canvas`.
- **Code editor Transform menu**: encode special characters (HTML named, decimal and hex entities, JS and JSON `\u`, CSS, percent, code points; three modes), decode them, Base64, URL, case, sort and join lines, trim, tabs and spaces, wrap, JSON prettify and minify, color converter and Unicode info. Every transform is one undo step and has a command palette entry.
- **Vibe tools** `encode_text`, `decode_text`, `transform_file_text`; Vibe chat messages can be copied, retried, deleted and branched from the right-click menu.
**Branded installers and new app icon** (docs/installer.md)
- **Windows installer:** custom NSIS wizard with an OpenFini sidebar and header, custom welcome and finish texts, the MIT license page, and a new *Windows integration* page (associate `.ofini` / `.ofext`, offer OpenFini under Open with for images, PDF and code files, optional desktop shortcut). Finish page can launch OpenFini and open the online quick-start guide. Still per user without an administrator prompt; the uninstaller keeps its optional "Delete the application data" checkbox.
- **macOS DMG:** styled window with background, arrow and fixed icon positions.
- Artwork is generated from SVG sources in `src-tauri/installer/` with `npm run installer:assets`.
- **New app icon:** near-black mark on an off-white tile (desktop, PWA, maskable, apple-touch, favicon and document icons); installer artwork follows. The Windows installer picks English or German from the Windows display language.
**Vibe Studio UI polish** (docs/vibe-studio.md)
- Redesigned tool cards (compact line, collapsible JSON, image thumbnails, groups, inline approvals), text shimmer for running work, collapsible thinking blocks with elapsed time, follow-the-bottom auto-scroll with a "Jump to latest" pill, message copy and retry, slimmer themed scrollbars.
- **Activity tab is a real run log:** plan, tool calls with timing, approvals, errors, tokens, filters, per-run undo order, click-to-reveal, copy and clear.
- The OpenFini mark replaces the generic icon in the assistant avatar, empty state and send button.

### Fixed

- Vibe tool cards were broken by a class name clash with the toolbox styles; the side panel no longer covers the composer on windows up to 1180 px wide; the Canvas panel no longer prints "null" or a broken image.

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
