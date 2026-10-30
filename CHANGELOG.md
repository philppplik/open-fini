# Changelog

All notable changes to OpenFini are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (while below 1.0, minor versions may contain breaking changes).

## [Unreleased]

### Added
- **Presentation app** in the Office Suite ([docs/office-slides.md](docs/office-slides.md)): blank, pitch-deck and report templates; opens `.pptx`, `.ppsx`, `.odp` and `.fodp` (`.potx`/`.otp` as new decks) with an import report and saves `.pptx`/`.odp` back in their format; exports PDF, PNG per slide (ZIP) and the current slide as PNG. Layouts, themes, backgrounds, text boxes, shapes, pictures and tables; thumbnails panel and slide sorter with drag-and-drop; canvas with move, resize, rotate, snapping, align and z-order; in-place text editing; speaker notes; fade and slide-in transitions; full-screen slide show with presenter view (next slide, notes, timer). Live-editing records per slide and element, comments on elements, Vibe tools `slides_describe`, `slides_add_slide`, `slides_delete`, `slides_set_text`, `slides_add_shape`, `slides_add_image`, `slides_apply_layout`, `slides_apply_theme`, `slides_reorder`, `slides_set_notes` and `slides_set_transition`, German translation. Size budgets: shell JS +40 KiB and total +45 KiB (all lazy; start-up +0.3 KiB).
- Web access for the Vibe assistant (off by default): tools `web_search`, `fetch_page` and `download_image` (group "Web"), the `find-images` skill and Settings ▸ Artificial intelligence ▸ Web access (search backend, always-allowed and blocked domains, size, pixel and time limits). Every request asks for approval per domain (allow once, always for this domain, decline; never skipped by Auto mode), local and private addresses are blocked also after redirects, no cookies or credentials are sent, images are checked by content and pixel size, fetched text is wrapped as untrusted data, and openly licensed images (Openverse, Wikimedia Commons) record license and source with the asset. See [Vibe Studio](docs/vibe-studio.md#web-access) and [Security](docs/security.md#web-access-for-the-assistant).
- Color management for print ([docs/color-management.md](docs/color-management.md), [ADR 0020](docs/adr/0020-color-management.md)): per-document Color Settings (RGB or CMYK mode, sRGB / Display P3 / Adobe RGB working space, user-loaded CMYK ICC profile or a clearly labeled built-in approximation, rendering intent, black point compensation) stored additively in `.ofini`; a compact ICC engine (matrix/TRC, lut8/lut16, lutAtoB/lutBtoA, XYZ and Lab PCS); CMYK sliders, spot color names and an out-of-gamut hint in the Color panel; Convert Colors to CMYK / RGB; Proof Colors and Gamut Warning views; PDF export as PDF/X-1a:2003 (transparent pages rasterized) or PDF/X-4 with DeviceCMYK, OutputIntent, GTS keys and XMP; a Print Preflight report (RGB objects, spot colors, total ink, image resolution, transparency, bleed, fonts, profile); PNG/JPEG exports tagged with wide-gamut working spaces; Vibe tools `set_color_mode`, `convert_colors`, `preflight_pdf` (group "Color"). No CMYK profile is bundled (licenses), and PDF/X output is not validated by a certified validator.
- Office Suite framework ([docs/office-suite.md](docs/office-suite.md), [ADR 0016](docs/adr/0016-office-suite-apps.md)): the Office studio opens on a launcher (new document per app, templates with a kind filter, recent Office files, *Open file…*, *Import from Google…* guidance) with a suite bar (Home, kind switcher); a data-driven app registry with lazy implementations; the word processor is its first app (new invoice, memo and meeting-notes templates; `.dotx`/`.dotm`/`.ott` templates open as new documents). `office.kind` in `.ofini` (format version 2 only for non-document kinds), save in the original format for every app, kind-aware export, live-editing adapter (keyed last-writer-wins records) and item comment anchors for Office apps, the shared Office Toolkit (ribbon, formula bar, pickers, split panels, ruler, virtual grid, A1 selection model, find/replace, TSV/CSV clipboard, number formats, hand-drawn strokes, PDF/PNG helpers), Vibe tools `office_formats`, `office_list_documents`, `office_describe`, `office_new` and a kind-aware `office_export`, and "Open with" registration for .xlsx, .ods, .pptx, .odp, .excalidraw and .tldraw (routed to the matching app, or an honest dialog while it is not part of the build).
- Logs are now kept across sessions: all info, warning and error entries are stored (redacted before they are written) in rotating segments, limited to 20,000 entries or 5 MB and to **Keep logs for N days** (Settings > Security and privacy, default 14, 0 = this session only). Troubleshooting has a session selector, search across sessions, **Export all logs** and **Clear logs**; the diagnostic report lists the build and the number of stored sessions.
- Comments in every studio without a room: a Comments dock panel (Vector, Pixel, Layout, Code), comment mode (`Shift+C`), Edit menu entries; the comment UI loads without the collaboration code. Website element comments keep a stable element path. Saved in the `.ofini` with anchors, replies, resolved state and authors (unknown authors are shown as such).
- Comments for the AI: `list_comments` returns the exact target of every comment, new `get_comment_context` (cropped screenshot, surrounding lines), the `address-comments` skill, `@comments` in the Vibe composer, **Resolve with AI** in the thread popover and panel, a Demo script. Comment tools moved to their own "Comments" group (names unchanged).
- Chat bubbles (Settings ▸ Artificial intelligence ▸ Chat appearance): shape (rounded, pill, square, speech bubble, thought bubble, flat), tail, corner radius, presets or custom colors with automatic contrast fixing, border, shadow, density, width, text size, avatars, live preview; stored in the profile-portable `chatBubbles` setting.
- Pixel studio, crop and image tools: the Crop tool is rebuilt with custom ratios, portrait / landscape swap, straightening (drag outside the box, angle field or a level line), composition guides (`O`: thirds, grid, golden ratio, diagonals, golden triangle), flips, empty-corner fills and non-destructive cropping; new **Perspective Crop** and **Magic Eraser** tools and reflected / diamond gradients. The Document menu gains Crop to Selection, Trim Edges, Reveal All, Rotate 90 CCW / 180 / by angle, and Resize Document now offers Lanczos, bicubic, bilinear and nearest-neighbor resampling plus DPI. Vibe tools `crop_image`, `resize_image`, `rotate_image` and `trim_edges`.
- OpenAI account sign-in (desktop): preset *OpenAI account (ChatGPT plan)* uses OpenAI's documented "plan usage" preview for open-source apps (OAuth with PKCE, dynamic registration, one-shot loopback callback, Responses API, automatic refresh, revoking sign-out, account model list). It never reuses Codex credentials or ChatGPT private endpoints; the web build explains why it is unavailable. The OpenAI API-key preset gained optional `OpenAI-Organization` / `OpenAI-Project` headers. See [docs/openai-account-auth.md](docs/openai-account-auth.md) and ADR 0017.
- OAuth for MCP servers: *Sign in* / *Sign out* per server (discovery, dynamic client registration, PKCE S256, resource indicator, refresh with rotation, 401 handling), on desktop and in the web build.
- Built-in collaboration relay (desktop, [ADR 0018](docs/adr/0018-built-in-network-services.md)): *Collaborate ▸ Start a room ▸ Your network* starts a relay inside the app (same protocol and limits as `scripts/relay.mjs`, plain `ws://`), creates the room and puts this computer's network address into the invite; *People* shows the address, a QR code of the invite and *Stop relay*. No Node.js or terminal needed. The browser/PWA explains that it needs a hosted relay address instead.
- Built-in FTP/FTPS publishing and *Send by email* (desktop): a new *FTP / FTPS server* publish target (explicit or implicit TLS, plain FTP clearly labeled, *Test connection*) and *Export ▸ Send by email…* through your own SMTP server (STARTTLS/TLS, AUTH PLAIN/LOGIN, attachments), both in Rust with the system TLS stack. Passwords stay in the key store; self-signed certificates ask *Trust this certificate?* with the SHA-256 fingerprint and are pinned (trust on first use). SFTP is not built in yet (use FTPS or the publish helper). The web build says these need the desktop app.
- When the publish helper or a local MCP gateway does not answer, a guide explains how to install Node.js, where to run the command and the built-in alternative, instead of a raw network error.

### Changed
- Extensions: background scripts (`main.js`) now run in a dedicated worker started by their sandboxed frame, so a runaway loop no longer blocks the app and is terminated. A watchdog (heartbeat every 5 s, hung after 15–20 s, flood guard on every message, 8 MB reply cap, call timeouts on both sides) stops misbehaving extensions with a **Restart** / **Disable** notification, shows *Not responding* in the manager, logs to the persistent log and disables an extension after three stops in 30 minutes. Background scripts have no DOM. Limits per build in [docs/extensions.md](docs/extensions.md), [ADR 0019](docs/adr/0019-extension-workers-watchdog.md).
- Worker pool (`app/src/core/workers/`): Resize Document with a resample filter, Trace Image and saving large documents run off the UI thread (cancellable, with an in-thread fallback). See [docs/performance.md](docs/performance.md#worker-pool).
- Vibe composer: the screenshot and prompt library buttons are gone; the paperclip opens a menu (file, page screenshot), `/screenshot` and `/prompt-library` are in the `/` menu, the mic hides when speech input is unavailable.

### Fixed
- `scripts/relay.mjs` runs standalone (`node relay.mjs --lan` in any folder): the QR code and the self-signed certificate are optional extras, and without an app next to it `--lan` only relays. The docs explain that `npm run relay` only works inside the project folder (elsewhere npm reports `ENOENT … package.json`).
- Code studio: switching HTML files through the editor tabs (click, Ctrl+Tab, closing a tab, Quick Open, search, outline) or through a link in the preview now also switches the visual preview, the page selector, the explorer highlight and the style panel, exactly like clicking the file in the explorer. CSS and JS tabs keep the last previewed page.
- The console error "Option values cannot include a space" no longer occurs: select values that come from file names or extension settings are encoded (`optVal`), and a test lints `sl-option` values.
- Action icons in the sent chat bubble are readable on every theme, accent and surface style.


## [0.9.0] — Vibe 2, folders, routing, glass 2

### Changed
- Refactoring audit 1 ([docs/refactoring-audit.md](docs/refactoring-audit.md)): bundle, import-graph and dead-export analysis scripts (`scripts/analyze-bundle.mjs`, `scripts/import-report.mjs`, `scripts/find-dead-exports.mjs`) with the measured baseline, a risk-ranked list of candidates and the ideas that were rejected, with reasons.
- Faster start-up: the export dialog and the Code text-tool transforms (with the HTML entity table) load on first use; start-up JavaScript 373.5 → 357.2 KiB gzip, and the CI budget is lowered from 380 to 365 KiB.
- Architecture guardrails in the test suite (`tests/architecture/`): no circular imports, `core/` and `engine/` stay free of UI imports, engine code uses no browser globals, and heavy areas stay out of the start-up imports. Removed dead functions and unused Vibe UI v1 styles; the PSD fuzz test no longer flakes on slow CI runners.

### Fixed
- *Settings ▸ Toolbox and menus* no longer keeps a detached copy of its pane alive after every visit (a listener was never removed).

### Added
- **Collaboration UX**: *Add comment here…* in the right-click menu of the canvas, layers panel, Code editor, Office editor and website elements (`Ctrl+Alt+M`, comment mode, status bar toggle). An inline composer with @mention suggestions, numbered pins that follow layers, zoom and pan (drag to re-anchor), highlights for code and text ranges, thread popovers and `]` / `[` navigation. Comment anchors gained `pin`, `off`, `elem`, `col`, `endCol` and a `reanchor` op (additive). Vibe: `add_comment` takes an optional `at` anchor.
- **Responsive Collaboration window**: top tabs below 520 px, a left side rail from 520 px, a list column from 900 px; compact density, maximize, edge snapping, keyboard moving, remembered size and position. *Pop out* opens the Collaboration UI in its own OS window (a UI-only remote view; the main window keeps the room connection, see ADR 0013).
- Model routing with fallback: an ordered fallback chain behind the model menu (Settings ▸ Artificial intelligence ▸ Models). Retries with backoff, per-target circuit breaker, first-token timeout, continuation of cut-off answers, tool/vision/context-aware skipping, notices in chat, Activity log and progress pill, per-chat toggle, presets, success rates, auto-suggestion, "Test route". Authentication and invalid-request errors are never hidden. Provider errors now carry a normalized `category`. Sub-agents and quick actions use the chain too. Vibe tools `get_model_route` and `set_model_route`. See [ADR 0014](docs/adr/0014-model-routing-fallback.md).
- OpenCode: "OpenCode Zen" provider preset, import of connections from `opencode.json` (keys are never read), and an experimental "OpenCode (local server)" adapter for `opencode serve` (documented endpoints only, non-streaming). Health check (Test button) for every connection.
- The Demo provider can inject failures (`createMockProvider({ failures })`) for testing routing.
- Liquid glass now refracts: dialogs, menus, context menus, the command palette, popovers and toasts bend what is behind them
  (displacement-map SVG filter, optional chromatic dispersion) on Chromium-based engines (Chrome, Edge, the Windows app); other
  engines keep blur plus a specular edge. New Settings > Appearance > Surface style controls: Refraction strength, Edge
  thickness, Specular highlight, Chromatic dispersion (`glassRefraction`, `glassBevel`, `glassSpecular`, `glassDispersion`, part
  of profiles). Offline, no library: own code (`ui/refraction*.js`, ADR 0015), lazy-loaded, maps cached per size class.
- Sea glass follows the active accent (any theme, accent preset, custom accent) instead of being only turquoise; new **Sea tint**
  setting (Follow accent, Teal classic, Own hue) and soft caustic highlights. Surface gallery previews reflect the accent.
- Vibe `set_theme` accepts `seaTint` and `refraction`.

## [0.8.0] — Live editing, VS Code extensions, wiki

### Security
- Resolved all open CodeQL code-scanning alerts: the compact-CSS regexes no longer backtrack polynomially, `h()` lost its `html` (innerHTML) option, tag stripping and removal in the Markdown, LaTeX, SSG, table-import and extension-panel code now repeat until stable (nested fragments like `<scr<b>ipt>` cannot reassemble), script end tags such as `</script >` are recognized, generated ids and window ids come from `crypto.getRandomValues`, extension and preview message handlers are looked up with `typeof function` checks, and external links open the re-serialized URL. Regression tests in `tests/core/sanitizers.test.js`.
- Dependabot alerts and security updates are now enabled for the repository; `docs/security.md` lists the vendored libraries with their versions and the date they were checked against known advisories.

### Changed
- Start page menubar shows only File, View, Studio and Help while no document is open, and the full studio menus return as soon as one opens (`app/src/ui/menubar-select.js`).
- Windows, Linux and PWA app icons are larger: the tile fills 96% of the canvas and the mark about 66% of the tile. The macOS `.icns` keeps the standard grid (`app/icons/icon-macos.svg`).
- Settings dialog: the section list keeps its row height and scrolls inside the sidebar with the search box pinned on top.
- Removed the GitHub Pages workflow and the hosted-app links; the PWA is shipped as the release zip and can be self-hosted (the "Publish to GitHub Pages" target for user websites is unchanged).
- Tauri CLI 2.12.4 (bundler 2.10.4, NSIS 3.13): the custom installer template picked up the upstream fixes (uninstaller clean-up after an in-place upgrade, shared WiX detection, file-association icon quoting).
- GitHub Actions: `dtolnay/rust-toolchain` pin updated.

### Fixed
- **Code studio viewport and measure tool disagreed**: the preview frame's root scrollbar (15 px, 15.33 at a device pixel ratio of 1.5) reduced the layout width, so a 100 % wide element measured 375 px in a 390 px viewport. The scrollbar is now hidden by default (button *Show the page scrollbar* restores it), the status shows `390 × 844 · layout 390`, a probe-based self-check flags any remaining mismatch, the measure tool uses the layout width for `%`, and the device box is no longer rounded. See *How measurement works* in [docs/code-studio.md](docs/code-studio.md).
- Test-only regex and no-op `replace` calls flagged by code scanning were cleaned up.

### Added
- **Vibe Studio UI v2**: the side panel keeps only **Canvas** and **Activity**; Models, Tools and MCP, Skills and Knowledge moved to *Settings ▸ Artificial intelligence* (deep link `app.run("settings.open", { section: "ai", tab })`). The composer understands `@` (layers, @selection, project files, documents, attachments, room members), `/` (commands, skills with a parameter form, recent prompts) and `!` (tools the model must use) with a caret-anchored, fuzzy, keyboard and screen-reader friendly list; choices become chips sent as structured context blocks. Mutating tool calls record change sets: **View changes** badges on tool cards, a run summary and a diff drawer (unified / side-by-side text diffs with per-file and per-block revert, layer property changes with per-layer revert and before/after thumbnails, Office paragraph diffs). The Canvas panel gained zoom and pan, pages, a layers outline with show/lock toggles, rings around AI-touched layers, a before/after slider, Open in studio and Export. Messages got icon toolbars (copy, retry, feedback, edit and resend, retry with another model, read aloud, pin, save to knowledge, share to the room, collapse, branch, delete); the composer got page screenshots, a prompt library and per-chat tool groups.
- **Open whole project folders from the OS**: Windows Explorer right-click on a folder or on the empty space inside one, *Open folder with OpenFini* (installer option on the Windows integration page, default on, per user without administrator rights, English and German; NSIS only, not the MSI); Finder *Open With* and drop on the Dock icon (`public.folder` document type; Quick Action instructions for a folder right-click item); Linux `inode/directory` in the desktop file and `openfini <folder>`. The Rust shell keeps folders as launch arguments, second-launch arguments and macOS open events and grants them recursively for the session only. The folder is read with ignore rules (`.git`, `node_modules`, build folders, symbolic links), size and file-count limits and progress, then opened as a website project or as design documents; *File ▸ Open Folder…* on the desktop uses the same path, and folders appear in *Open Recent* with a folder icon. See [docs/os-integration.md](docs/os-integration.md#open-folders-from-the-file-manager).
- **Code studio: preview and code stay in sync, and better formatting**: the selected element keeps a line highlight on its start tag, hovering links both ways, the caret inside a CSS rule outlines the matching elements ("7 elements"), a breadcrumb bar (`html › body › section.hero › h1`) selects in both directions and lists the applying rules with jump links (setting *Sync highlighting*). *Format Document*, new *Format Selection* and *Format pasted code* use dependency-free formatters for HTML (keeps `pre`, `textarea`, comments and inline spacing; wraps attributes), CSS, JavaScript (re-indent only), JSON and Markdown, with settings for tabs, line width and attribute quotes; formatting is idempotent and structure-preserving (tested on every starter template). Vibe tool `format_file`. See [docs/code-studio.md](docs/code-studio.md).
- **Wiki**: a 54-page user and developer manual in `wiki/` (installation, every studio, file formats, collaboration, Vibe, extensions, security, troubleshooting, developer guides, decision-record index), published to the GitHub wiki by `.github/workflows/wiki.yml` through `scripts/wiki-sync.mjs` on pushes to `main`. `npm run wiki:shortcuts` generates the keyboard-shortcut tables from the command registry; `tests/docs/wiki-links.test.js` checks links, reachability, structure and that the generated page is current. See `docs/wiki-maintenance.md`; the owner must create the first wiki page once in the web UI.
- **Share the open document with one gesture and edit it together (beta)**: right-click a document tab, the empty canvas, a Code explorer file or tab, or the Office editor ▸ *Share with collaboration room…* / *Share as linked live document* / *Share a copy (snapshot)* (also *File* menu and palette; without a room the start/join flow opens first). Others get a card *Open live / Open copy / Ignore*; tabs show a shared badge with the number of people, a bar "Editing together · N people" offers Pause (host/sharer), Resync and Stop sharing. Live sync over the existing end-to-end encrypted channel: a replicated tree of last-writer-wins registers with Lamport clocks for Vector, Layout and Pixel layer structure (delete wins, fractional ordering keys, move-cycle breaking) and an RGA text CRDT for Code files bound to CodeMirror; remote edits never enter your undo history; a version is saved automatically before a remote edit replaces something you just changed. Pixel bitmaps and Office documents travel as snapshots. Vibe tools `share_document`, `get_sharing_status`, `list_shared_documents`. See [docs/collaboration.md](docs/collaboration.md#live-editing-edit-together-beta) and [ADR 0011](docs/adr/0011-live-editing-sync.md).
- **Rooms across your network**: `npm run relay -- --lan` binds every interface, serves the app itself, answers http/ws and https/wss (self-signed certificate for the LAN addresses) on one port, prints the addresses and a QR code, and exposes `GET /info`. In the app: *Test connection* with a plain-language diagnosis, a warning for `localhost` invites with a list of detected network addresses, join links (`…/#join=<invite>`) and their QR code, and *How to start a relay*. Clients fall back between `ws://` and `wss://` on the same port. The shell JS size budget rises by 20 KiB (all lazy).
- **VS Code extensions** (*Studio ▸ Extensions… ▸ VS Code extensions*): search and install from Open VSX (not the Visual Studio Marketplace, whose terms restrict it to Microsoft products) or from a `.vsix` file (picker, drag and drop, *Open with*). Every extension gets an honest compatibility badge (fully / partially / not supported) before install. Color themes become OpenFini themes (contrast-checked), snippets appear in Code studio completions, language configurations add comment toggling and auto-closing pairs, settings get a form. Web extensions run in the extension sandbox against a documented subset of the `vscode` API (commands, messages, quick pick, the active editor with one-step undoable edits, configuration, read-only workspace files, completion, hover, formatting and code action providers); Node-only extensions are never run. Verified with Prettier's web build, Dracula and ES7 React snippets. Vibe tools `search_vscode_extensions`, `install_vscode_extension`, `list_vscode_extensions`, `describe_vscode_extension`. See [docs/vscode-extensions.md](docs/vscode-extensions.md) and [ADR 0012](docs/adr/0012-vscode-extensions.md).

### Added
- **Tool pill**: a floating pill at the bottom of the canvas shows the active state with its actions: "Selection active · 1,240 × 860 px" with Deselect, Invert, Feather…, To layer mask and Fill for pixel selections; Deselect for layer selections in Vector, Layout and Pixel; Apply / Cancel for crop and liquify; Finish path / Close path for the pen; Done editing for text. Settings ▸ Canvas and editing ▸ *Show the tool pill* (default on). See [docs/studios.md](docs/studios.md).
- **Vibe skill `about-the-developer`**: answers "who made OpenFini?" with publicly stated facts about Philipp Paulik and the project only, and points to philipp-paulik.de and GitHub for more.

### Changed
- The native webview / OS context menu no longer appears in the app chrome. Right-clicks that no OpenFini menu handles do nothing; the native menu remains for website previews and for Shift + right-click in editable text (`shouldAllowNativeContextMenu`, see [docs/context-menus.md](docs/context-menus.md)).

### Fixed
- Submenus of menus and context menus (File ▸ Quick Export, Open Recent, Swatches, ...) were clipped and needed horizontal scrolling in the Glass, Liquid glass and Sea glass styles. The blur now sits on the menu frame instead of the menu itself, so submenus open beside their parent, flip near screen edges and no longer scroll. A CSS test guards the rule.

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
