# Concept: roadmap to the next major release (2.0)

Status: **concept / research**, not a commitment. Written after 1.2.0 (November 2026). It turns the open backlog into
themes, a prioritized list and small, reviewable tasks grouped into release waves. When an item lands, close it in
[known-limits.md](../known-limits.md) and note it in `CHANGELOG.md` as usual; this page is a plan, not a second backlog.

A new **Proto Studio** (a Figma-like interface design and prototyping studio: frames, components, variants,
auto layout, prototype links) is being conceptualized separately. This roadmap only references it where items overlap
(components and symbols, constraints, live booleans, the shared canvas); it does not plan it.

## Sources

| Source | What it gave |
| --- | --- |
| [known-limits.md](../known-limits.md) | Verification gaps, security follow-ups, Pixel, Office, Scene, docking and size-budget limits |
| [limits-audit.md](../limits-audit.md), [office-limits-audit.md](../office-limits-audit.md) | Open A6–A18 (OCR, STT, TTS, relay TLS, headless reading, change sets, plans, terminal), Office "next by value per effort" |
| [office-suite.md](../office-suite.md#roadmap-office-depth), [scene-studio.md](../scene-studio.md#limits), [color-management.md](../color-management.md), [performance.md](../performance.md), [i18n.md](../i18n.md) | Per-studio depth gaps |
| [roadmap.md](../roadmap.md) | Still describes 0.1 (says sRGB only, no i18n, no collaboration); several items there are done. Useful for the gaps that remain (16-bit, RAW, tiled layers, OpenType features, RTL, footnotes, LSP, canvas accessibility) |
| `CHANGELOG.md` | What 1.0–1.2 shipped, so the plan does not repeat it |
| GitHub issues | **No open issues** at the time of writing; the backlog lives in the docs above |
| Dependabot | 1 open alert (moderate): `glib` < 0.20 `VariantStrIter` unsoundness, pulled in by Tauri's GTK stack on Linux; blocked upstream |
| CodeQL (code scanning) | 17 open alerts: **3 errors** (`js/bad-code-sanitization` ×2 in `app/src/engine/web/local-serve.js`, `js/clear-text-storage-of-sensitive-data` in `app/src/vibe/account-auth.js`), 12 sanitization warnings (`app/src/vibe/web-access.js` ×6, `app/src/engine/web/open-plan.js`, `format.js`, `app/src/core/update-policy.js`, `app/src/office/board/model.js`, `app/src/ui/code/local-preview.js`, a test), 2 intentional `rust/disabled-certificate-check` in `src-tauri/src/netio.rs` |
| `TODO` / `FIXME` in code | None in `app/src`, `src-tauri/src`, `cli`, `scripts` (the only hit is an instruction string in a LaTeX skill). The codebase tracks debt in docs, not comments |
| GitHub releases | `v1.1.3` is *Latest*; `v1.1.4` and `v1.2.0` are still **drafts**, so the in-app updater and any download page still serve 1.1.3 |
| Competitor research | See [Competitive landscape](#competitive-landscape) |

## Competitive landscape

What the reference products shipped in 2025–2026 and what it means for OpenFini. OpenFini's position stays the same:
**one light, local-first, open-source app for all of it, AI optional and bring-your-own-model.**

| Product | Recent direction | Gap or opportunity for OpenFini |
| --- | --- | --- |
| **Affinity (Canva)** | Since October 2025 a single *free* app with Vector, Pixel and Layout workspaces and customizable, saveable panel layouts; generative AI features need a Canva subscription; account needed to activate. | Affinity now matches OpenFini's "one app, three studios" story at price zero. OpenFini must win on **open source, no account, Linux and web, Office + Code + Scene + Vibe in the same app, local or any AI**, and close the depth gaps pros notice first: 16-bit, RAW, live booleans, OpenType features. |
| **Photoshop** (MAX, Nov 2026) | Relight, Generative Restyle with a strength slider, Remove that also takes shadows and reflections, Harmonize (match light and color between layers), an agentic assistant (beta) and local MCP integrations (preview). | Local-first counterparts through the engine registry: a pluggable `segment` / `inpaint` / `relight` engine, a non-AI **Harmonize** (statistical color and tone match) that needs no model, and OpenFini **as an MCP server** so external agents drive it. |
| **Figma** (Config, June 2026) | Code layers on the canvas, a built-in Motion timeline, GPU shader effects, reusable AI "skills" and agents, generative plugins. | Mostly the Proto Studio's job. For existing studios: Vibe skills already exist; Scene + Code already cover motion and code. Shareable skill packs and prompt-built extensions are a small step from what exists. |
| **VS Code** | Agent mode, MCP everywhere, multi-agent sessions, a real terminal and language servers. | The Code studio lacks a language server, type checking and a PTY terminal (one program per line). A TypeScript worker and a PTY are the two biggest credibility gaps. |
| **Microsoft 365 / LibreOffice 26.8** | M365: agent mode in Word/Excel/PowerPoint. LibreOffice 26.8 (Aug 2026): paragraph composer (multi-line justification), OpenType variable fonts, automatic RTL paragraph direction, Presentation sections, pivot calculated fields, deliberately no generative AI. | Interop is what users judge an Office suite by: a **real-file round-trip corpus** in CI, embedded fonts in Office PDF, LET / LAMBDA / spill refs, several slide masters, RTL and variable fonts in the shared text engine. |
| **DaVinci Resolve 21 / 21.1**, **CapCut** | Resolve 21 (June 2026): Photo page with native RAW decoding, many AI tools (mostly Studio-only); 21.1 (Sept 2026) connects to AI assistants such as Claude Code and adds scripting APIs. CapCut: auto captions, templates, one-click effects. | Scene's biggest practical limits are **embedded media** (huge files), real-time-speed export and no tracking / stabilization. Auto captions need a bundled-or-installable STT engine. An MCP server would give Scene the same "drive it from an agent" story Resolve now markets. |

Research sources (accessed 2026-11-23): [Canva: the all-new Affinity](https://canva.com/newsroom/news/all-new-affinity),
[Figma: Config 2026 recap](https://www.figma.com/blog/config-2026-recap/),
[Figma help: What's new from Config 2026](https://help.figma.com/hc/en-us/articles/39582753756695-What-s-new-from-Config-2026),
[PetaPixel: Photoshop Relight and Restyle](https://petapixel.com/2026/11/10/photoshop-now-relights-and-restyles-your-photos-using-ai/),
[TechCrunch: Adobe adds more AI and launches an MCP](https://techcrunch.com/2026/11/10/adobe-adds-more-ai-to-its-products-and-launches-an-mcp/),
[PetaPixel: DaVinci Resolve 21 released](https://petapixel.com/2026/06/03/davinci-resolve-21-officially-released-with-new-photo-editing-ai-tools/),
[No Film School: Resolve 21.1](https://nofilmschool.com/davinci-resolve-update-21-1),
[Phoronix: LibreOffice 26.8](https://phoronix.com/news/LibreOffice-26.8),
[Linuxiac: LibreOffice 26.8](https://linuxiac.com/libreoffice-26-8-released-with-new-paragraph-composer-variable-font-support/).
VS Code and CapCut entries summarize their public release notes over 2025–2026.

## Themes

1. **Trust: ship, sign, verify.** Publish the drafted releases, sign them, and turn "Unverified" rows into verified
   ones with scripted checks on real runners. Nothing else matters if users cannot install a signed build.
2. **Security hygiene.** Zero open CodeQL errors, documented dismissals for intentional findings, the Dependabot
   blocker tracked.
3. **Performance headroom.** The start-up budget is at its cap; the Pixel live filters still run on the main thread.
   Buy room before adding features.
4. **Pro depth where switchers look first.** 16-bit Pixel, RAW, live booleans, OpenType features, variable fonts,
   footnotes. These are what an Affinity or Photoshop user checks in the first ten minutes.
5. **Interop you can prove.** Office and PDF/X round trips against real files and validators, in CI.
6. **Scene for real projects.** Referenced media, faster export, tracking, captions.
7. **Open AI surface.** OpenFini as an MCP server, pluggable local engines (STT, OCR, segmentation), persisted plans.
8. **Reach.** More languages incl. one RTL, touch layouts, keyboard and screen-reader access to the canvas.
9. **Housekeeping.** Replace the stale `docs/roadmap.md`, finish docking gaps, clean up worktrees, publish the wiki.

## Prioritized list

Impact (I) and effort (E) on a 1–5 scale; **score = I × 2 − E** (impact weighs double, so a cheap high-impact item
ranks first). S = up to a day, M = a few days, L = one to two weeks, XL = more (split before starting). The table is
ordered by wave, because some high scores depend on earlier work; the score decides the order inside a wave.

**Top 10 by score** (ties broken by wave): R1 (9), R2 (8), R4 (7), R7 (7), R6 (6), R9 (6), R3 (5), R5 (5), R8 (5),
R17 (5; chosen over R10 because nothing else covers accessibility). R10 and R13 also score 5 and follow directly.

| # | Item | Theme | I | E | Score | Wave |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | R1 Publish and sign releases (1.1.4 / 1.2.0 drafts, signing, updater keys) | Trust | 5 | 1 | 9 | 0 |
| 2 | R2 Close CodeQL errors and sanitization warnings | Security | 5 | 2 | 8 | 0 |
| 3 | R3 Replace the stale `docs/roadmap.md` and refresh competitor-facing docs | Housekeeping | 3 | 1 | 5 | 0 |
| 4 | R4 Verification harness on real runners (desktop smoke, Office/PDF corpus) | Trust / Interop | 5 | 3 | 7 | 1 |
| 5 | R5 Pixel live filters off the main thread (worker + optional Wasm) and size-budget savings | Performance | 4 | 3 | 5 | 1 |
| 6 | R6 OpenFini as an MCP server | Open AI | 4 | 2 | 6 | 1 |
| 7 | R7 Scene: referenced media on the desktop and faster export | Scene | 5 | 3 | 7 | 1 |
| 8 | R8 Live (non-destructive) boolean shapes in Vector | Pro depth | 4 | 3 | 5 | 2 |
| 9 | R9 OpenType features, variable fonts and shaping (shared text engine) | Pro depth | 5 | 4 | 6 | 2 |
| 10 | R10 Office interop depth: embedded fonts in Office PDF, LET / LAMBDA / `A1#`, several slide masters, ODS charts | Interop | 4 | 3 | 5 | 2 |
| 11 | R11 Pluggable local engines shipped as optional packs: STT (captions), OCR, segmentation | Open AI | 4 | 4 | 4 | 2 |
| 12 | R12 Code studio: TypeScript language worker and PTY terminal | Code | 4 | 4 | 4 | 2 |
| 13 | R13 High bit depth (16-bit) Pixel pipeline and tiled layers | Pro depth | 5 | 5 | 5 | 3 |
| 14 | R14 RAW decoding (DNG first) into Develop | Pro depth | 4 | 4 | 4 | 3 |
| 15 | R15 Layout: footnotes, cross references, tagged PDF | Pro depth | 4 | 4 | 4 | 3 |
| 16 | R16 Scene: track mattes, spatial Bezier paths, point tracking and stabilization | Scene | 3 | 4 | 2 | 3 |
| 17 | R17 Accessibility of the canvas (keyboard drawing, object descriptions) | Reach | 4 | 3 | 5 | 2 |
| 18 | R18 Third UI language and the first RTL language | Reach | 3 | 3 | 3 | 3 |
| 19 | R19 Docking gaps and tear-off windows polish | UI | 3 | 2 | 4 | 1 |
| 20 | R20 Bug fixes from the known limits | Quality | 3 | 2 | 4 | 1 |
| 21 | R21 Touch layout for tablets in portrait and phones (view, comment, light edits) | Reach | 3 | 4 | 2 | 3 |
| 22 | R22 Built-in Rust relay TLS (A10) | Security | 2 | 3 | 1 | 3 |

Not planned for 2.0 (kept for later): headless-browser page reading (A12, no safe design), persisted change sets (A13),
OpenCode bridge streaming (A15), local neural TTS (A8), WebGPU fast path, real-time co-editing of Scene timelines.

## Items and tasks

Every task is meant to be one pull request. "Files" lists where the work starts, not every file touched. Acceptance
criteria are what the reviewer checks.

### R1 Publish and sign releases (Wave 0)

The in-app updater, the website download page and every install guide depend on a published, signed release.

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R1.1 | Decide on the drafts: publish `v1.2.0` (it contains 1.1.4), delete or keep the `v1.1.4` draft | GitHub releases, `docs/release-process.md` | `gh release view --json isLatest` shows 1.2.0 as latest; release notes match `CHANGELOG.md` | S |
| R1.2 | Owner adds `TAURI_SIGNING_PRIVATE_KEY` and the `TAURI_UPDATER_PUBKEY` variable; release workflow attaches `latest.json` | `.github/workflows/release.yml`, `docs/updates.md` | A 1.2.1 test build updates from 1.2.0 through *Help ▸ Check for Updates* on Windows | S |
| R1.3 | Windows code signing (Azure Trusted Signing or SignPath for open source) and macOS notarization | `release.yml` (signing steps exist, need secrets), `docs/release-process.md` | SmartScreen shows the publisher; `spctl -a -v` accepts the macOS app | M |
| R1.4 | Release checklist in CI: block tagging when `CHANGELOG.md` has no section for the tag | `scripts/version.mjs`, `release.yml` | A tag without a changelog section fails in *Verify and plan* | S |

### R2 Close CodeQL errors and sanitization warnings (Wave 0)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R2.1 | `js/bad-code-sanitization` (×2): build the injected script from JSON with `JSON.stringify` plus `<`/` ` escaping, never by string sanitizing | `app/src/engine/web/local-serve.js`, tests in `tests/web/` | Alerts 57 and 58 close on the PR; test with `</script>` and U+2028 in project names | S |
| R2.2 | `js/clear-text-storage-of-sensitive-data`: store the account token only through the vault (encrypted when a passphrase is set), never in plain settings | `app/src/vibe/account-auth.js`, `app/src/ai/vault.js`, `docs/openai-account-auth.md` | Alert 47 closes; migration moves an existing token into the vault; test | M |
| R2.3 | Sanitization warnings: replace hand-written tag/entity stripping with the shared `sanitizeHtml` / a loop-until-stable helper | `app/src/vibe/web-access.js`, `app/src/engine/web/open-plan.js`, `app/src/engine/web/format.js`, `app/src/core/update-policy.js`, `app/src/office/board/model.js`, `app/src/ui/code/local-preview.js` | All 11 app warnings close; existing tests pass; one new test per helper with nested `<scr<script>ipt>` input | M |
| R2.4 | Owner dismisses the two `rust/disabled-certificate-check` alerts as "won't fix" with the reason from `docs/security.md`; fix the test-file warning | GitHub code scanning, `tests/web/starters-open.test.js` | Code scanning shows 0 open alerts | S |
| R2.5 | Track the `glib` Dependabot alert: a monthly check in the docs and a note in `SECURITY.md` until Tauri moves to gtk-rs 0.20 | `docs/known-limits.md`, `SECURITY.md` | Note present; alert dismissed as "tolerable risk" by the owner with a link | S |

### R3 Replace the stale roadmap page (Wave 0)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R3.1 | Rewrite `docs/roadmap.md` as a short, current page: what is planned (link here), what is known missing (link `known-limits.md`), how to help; remove the 0.1 statements that are no longer true (CMYK, i18n, collaboration, MCP, extensions exist) | `docs/roadmap.md`, `wiki/Roadmap-and-Known-Limits.md` | No statement on the page contradicts `CHANGELOG.md`; wiki tests pass | S |
| R3.2 | "Switching from Affinity / Photoshop / Office" pages: what maps to what, what is missing | `wiki/` (new pages), `docs/file-compat.md` | Three wiki pages with "See also"; linked from the website (see [website.md](website.md)) | M |

### R4 Verification harness on real runners (Wave 1)

Turns the largest block of "Unverified" rows into automated checks.

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R4.1 | Desktop smoke test: build the Tauri app in CI on Windows, macOS and Linux, start it with a `--smoke` flag that opens each studio, a torn-off panel window and the collaboration window, then quits with a status | `src-tauri/src/lib.rs`, `app/src/main.js`, `.github/workflows/ci.yml` (nightly job) | Nightly job green on three systems; failure uploads a screenshot | L |
| R4.2 | Interop corpus: a folder of small real files saved by Excel, PowerPoint, Word and LibreOffice (licensed CC0 / made by contributors) with expected-value JSON | `tests/fixtures/interop/`, `tests/office/interop-corpus.test.js` | Every file opens without error; cell values, slide count, paragraph count match | M |
| R4.3 | LibreOffice headless round trip in CI: OpenFini writes XLSX/ODS/DOCX/ODT/PPTX/ODP, `soffice --convert-to` reads them back, values compared | `.github/workflows/ci.yml` (Linux job), `scripts/interop-check.mjs` | Job green; a deliberately broken writer makes it fail | M |
| R4.4 | PDF/X validation with veraPDF (open source) in CI for PDF/X-4 and PDF/X-1a output | `scripts/pdfx-validate.mjs`, CI job | veraPDF passes for the sample documents with a loaded ICC profile; `color-management.md` "not validated" note updated | M |
| R4.5 | Fix the local `cargo test` start on Windows or document the workaround | `src-tauri/`, `docs/development.md` | `cargo test` runs locally or the doc states the exact cause | S |

### R5 Pixel live filters off the main thread, size-budget savings (Wave 1)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R5.1 | Measure: a bench for the 10 heaviest live filters at 1400×1000 and 4000×3000 | `tests/pixel/bench-live.mjs`, `docs/performance.md` | Numbers recorded in `performance.md` | S |
| R5.2 | Run live adjustment/filter layers in the worker pool with tiles and cancellation while dragging (keep the half-resolution draft on the main thread) | `app/src/engine/pixel/filters.js`, `adjustments.js`, `app/src/core/workers/jobs.js` | Longest main-thread gap while dragging a Gaussian blur on 12 MP below 50 ms; results pixel-identical to today | L |
| R5.3 | Lazy pixel effects registry (about 41 KiB from start-up): make the renderer's synchronous call await a preloaded module | `app/src/engine/pixel/effect.js`, `scripts/size-budget.json` | Start-up budget lowered by at least 35 KiB; tests pass | M |
| R5.4 | Split i18n: load only the active locale's sections for the shell at start-up | `app/src/i18n/locales.js`, `scripts/i18n-extract.mjs` | Start-up JavaScript smaller; `npm run i18n:check` passes | M |
| R5.5 | Optional Wasm path for the 3 heaviest kernels (blur, unsharp, bilateral), same results within ±1 | `app/src/engine/pixel/wasm/` (new), build step | Wasm used when available; Canvas 2D-only fallback still passes all tests | L |

### R6 OpenFini as an MCP server (Wave 1)

Photoshop (preview) and Resolve 21.1 now market "drive it from your agent". OpenFini already has 100+ typed tools.

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R6.1 | ADR: transport (Streamable HTTP on 127.0.0.1 in the desktop app, stdio shim via `ofini mcp`), auth (per-client token approved in a native dialog), which tool groups are exposed, per-call approval reuse | `docs/adr/0034-mcp-server.md` | ADR accepted | S |
| R6.2 | Expose the Vibe tool registry read-only first (`list_documents`, `get_selection`, export, `run_doctor`) | `src-tauri/src/` (new `mcp_server.rs`), `app/src/vibe/hub.js` | Claude Code / VS Code connect and list tools; calls need the token | M |
| R6.3 | Write tools with the same permission modes and one-click undo as Vibe | same, `app/src/vibe/run-undo.js` | A write call shows the approval UI and is undoable | M |
| R6.4 | `ofini mcp` stdio bridge for clients without HTTP support | `cli/` | Works from a client config with `command: ofini mcp` | S |

### R7 Scene: referenced media and faster export (Wave 1)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R7.1 | Referenced media on the desktop: the scene stores a path + hash instead of the bytes; *Collect media* embeds them on demand | `app/src/scene/media.js`, `app/src/scene/model.js`, file format notes in `docs/file-format.md` | A 2 GB project saves as a small `.ofini`; moved media show *Relink*; format version bumped additively | L |
| R7.2 | Export: decode sources with WebCodecs `VideoDecoder` sequentially instead of seeking per frame where the container is supported (MP4/WebM demux) | `app/src/scene/export.js`, `frames.js`, `mux.js` | 1080p export at least 3× faster than real time on a mid-range laptop; output frame-identical within tolerance | L |
| R7.3 | Smooth playback of time-remapped clips with a decoded-frame cache around the playhead | `app/src/scene/frames.js` | No stutter on a 60-second reversed clip in Chromium | M |
| R7.4 | Reversed audio for reversed clips (decode, reverse buffer) | `app/src/scene/audio.js` | Reversed clip plays reversed sound; test on the buffer | S |

### R8 Live boolean shapes (Wave 2)

Overlaps with the Proto Studio (shared vector model); build here first so Proto reuses it.

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R8.1 | Model: a `compound` node with an operation and children; evaluated with `polygon-clipping` and cached per display list | `app/src/engine/vector/boolean.js`, document model, file format | Undo, save/load and SVG export (flattened) work | M |
| R8.2 | UI: *Add/Subtract/Intersect/Exclude* with Alt makes a live compound; *Expand* makes it destructive; editable children in the Layers panel | Vector studio UI | Moving a child updates the result live at 60 fps for 200-node shapes | M |
| R8.3 | Vibe tool `vector_compound` and PDF export of compounds | `app/src/vibe/tools/` | Tool documented and tested | S |

### R9 OpenType features, variable fonts, shaping (Wave 2)

One text engine serves Layout, Vector type, Document and Presentation; LibreOffice 26.8 just shipped variable fonts.

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R9.1 | ADR: shaping engine (HarfBuzz compiled to Wasm, lazy-loaded, about 300–400 KiB, only when a feature or script needs it) vs. a JS subset; size budget impact | `docs/adr/` | ADR accepted with measured size | S |
| R9.2 | Read `GSUB`/`GPOS` and `fvar` from added fonts; ligatures, small caps, oldstyle figures, alternates in the Character panel | `app/src/engine/layout/sfnt.js`, `text-layout.js` | Ligatures render on canvas and in PDF; PDF text stays searchable (ToUnicode) | L |
| R9.3 | Variable-font axes (weight, width, optical size, custom) in the Character panel; PDF embeds the instance | same, PDF writer | Axis slider changes the text live; PDF matches the screen | M |
| R9.4 | WOFF2 reading (Brotli decode) for added fonts | `sfnt.js` | WOFF2 fonts can be added and embedded | M |
| R9.5 | Hyphenation patterns for German (en + de first; more as data files) | `app/src/engine/layout/hyphenation.js` | German text hyphenates; license file added | S |

### R10 Office interop depth (Wave 2)

From [office-limits-audit.md](../office-limits-audit.md#result) "next by value per effort".

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R10.1 | Embedded fonts in Office PDF output (Document, Presentation), reusing the Layout PDF font embedding | `app/src/engine/office/`, PDF writer | Document PDF with an added font passes `pdffonts` with all fonts embedded | M |
| R10.2 | `LET` and `LAMBDA` (named via defined names) in the formula engine | `app/src/engine/layout/formula.js` or the sheet engine | Excel test vectors pass; XLSX round trip keeps them | M |
| R10.3 | Spill references `A1#` | sheet engine | `=SUM(A1#)` follows the spill; XLSX writes `_xlfn.ANCHORARRAY` | M |
| R10.4 | ODS charts and conditional formats on write | ODS writer | LibreOffice opens them with charts and formats (R4.3 job) | M |
| R10.5 | Several slide masters per presentation; PPTX/ODP round trip | slides model and writers | A PPTX with 2 masters round-trips | M |

### R11 Optional local engines: STT, OCR, segmentation (Wave 2)

The engine registry exists (A4); what is missing is engines users can install with one click.

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R11.1 | "Engine packs" install flow: download a signed pack from GitHub releases of a separate repo after consent, verify hash, store in app data | `app/src/extensions/`, `docs/engines.md` | Pack installs offline-afterwards; uninstall frees the space | M |
| R11.2 | whisper.cpp Wasm `stt` pack (batch and streaming) → Scene auto captions and Vibe voice input | separate repo + `app/src/scene/captions.js` | A 1-minute clip gets captions locally | L |
| R11.3 | Tesseract Wasm `ocr` pack → RAG on scanned PDFs, PDF import of scans | separate repo + `app/src/vibe/rag-pdf.js` | A scanned PDF becomes searchable in RAG | M |
| R11.4 | Segmentation pack (small open model, ONNX Runtime Web) → *Select Subject* in Pixel, object eraser masks | separate repo + `app/src/engine/pixel/selection.js` | Select Subject on a portrait in under 2 s on CPU | L |
| R11.5 | Non-AI **Harmonize**: match mean/variance in Lab of a layer to what is below it, as an adjustment | `app/src/engine/pixel/adjustments.js` | New adjustment, tested, no model needed | S |

### R12 Code studio: language worker and PTY terminal (Wave 2)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R12.1 | TypeScript language service in a worker (lazy, only for JS/TS projects): diagnostics, hover, go to definition, completions | `app/src/ui/code/`, new worker | Type errors appear in Problems; budget stays off the start-up path | L |
| R12.2 | PTY terminal on the desktop (`portable-pty`) with xterm-compatible rendering; keep the allow/deny policy | `src-tauri/src/` (new `pty.rs`), `app/src/vibe/terminal-policy.js`, ADR 0025 amendment | `npm run dev` with colors and Ctrl+C works; closes A17 | L |
| R12.3 | Shared partials (header/footer include) in the visual designer, written as a build step on export | `app/src/engine/web/` | One header edit updates all pages on export | M |

### R13 High bit depth and tiled layers (Wave 3, major)

The one change that justifies a major version in the Pixel studio: it touches storage, filters and the file format.

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R13.1 | ADR: layer storage (tiled `Uint16Array`/`Float32Array` tiles, 256×256), canvas only as a display cache; memory limits; file format | `docs/adr/` | ADR accepted | M |
| R13.2 | Tiled layer store behind the current layer API (8-bit first, no visible change) | `app/src/engine/pixel/image.js` | All Pixel tests pass; a 100 MP document opens | L |
| R13.3 | 16-bit per channel for Levels, Curves, HSL, Develop, gradients; dithering on display | `adjustments.js`, `develop.js` | No banding in a 16-bit gradient after strong curves | L |
| R13.4 | 16-bit TIFF and PNG import/export kept at 16 bits | `app/src/engine/formats/`, `docs/export.md` | Round trip of a 16-bit PNG is lossless | M |

### R14 RAW decoding (Wave 3)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R14.1 | DNG (open spec) decoder: lossless JPEG, linearization, demosaic (AHD), camera matrix | `app/src/engine/formats/dng.js` | DNG samples decode; Develop works on linear 16-bit data (needs R13) | L |
| R14.2 | Optional LibRaw Wasm pack for proprietary RAW (CR3, NEF, ARW, RAF) as an engine pack (R11.1); clean-room review | separate repo, `docs/clean-room.md` | CR3 opens when the pack is installed | M |

### R15 Layout: footnotes, cross references, tagged PDF (Wave 3)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R15.1 | Footnotes in the text model and line breaker (balanced on the page) | `app/src/engine/layout/text-model.js`, `text-layout.js` | Notes stay on the page of their reference across reflow | L |
| R15.2 | Cross references (to headings, figures, pages) updated on layout | same, `toc.js` | Moving text updates "see page N" | M |
| R15.3 | UI for the existing text wrap, baseline grid and exclusions engine | Layout studio UI | All three reachable from panels; documented | M |
| R15.4 | Tagged PDF (structure tree, alt text, reading order) for Layout and Document | PDF writer | veraPDF PDF/UA check passes for a sample (R4.4 job) | L |

### R16 Scene: mattes, spatial paths, tracking (Wave 3)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R16.1 | Track mattes (alpha / luma, inverted) | `app/src/scene/render.js`, `gl.js` | Matte renders identically in preview and export | M |
| R16.2 | Spatial Bezier handles on motion paths | `app/src/scene/motion.js`, viewer | Handles editable in the viewer; old files unchanged | M |
| R16.3 | Point tracking (pyramidal Lucas–Kanade in a worker) → attach a layer to a track | `app/src/scene/analysis.js` | A text follows a tracked point on a sample clip | L |
| R16.4 | Stabilization from tracks (translation, rotation, scale) | same | Shaky sample stabilized; crop shown | M |

### R17 Canvas accessibility (Wave 2)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R17.1 | Keyboard object navigation (Tab / Shift+Tab through objects, arrow nudge, Enter to edit) in Vector and Layout | `app/src/ui/` canvas controllers | Every object reachable and movable without a pointer | M |
| R17.2 | Screen-reader descriptions: a live region describing the selection (type, name, position, size) and an off-screen object tree | same | NVDA and VoiceOver read the selection | M |
| R17.3 | Keyboard drawing: create shapes at the cursor with typed size; pen tool by coordinates | Vector tools | Documented in `wiki/Accessibility.md` | M |

### R18 Languages (Wave 3)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R18.1 | Translation workflow for contributors (Weblate hosted for open source, or PRs against `locales/*.json`) | `docs/i18n.md`, `CONTRIBUTING.md` | Contributors can add a locale without code changes | S |
| R18.2 | Third language (French or Spanish) for the main surfaces | `app/src/i18n/locales/` | `npm run i18n:check` passes | M |
| R18.3 | First RTL language (Arabic or Hebrew) to exercise the wired `dir` support; mirror icons where needed | same, shell CSS | Shell renders mirrored without overlaps; needs R9 shaping for canvas text | L |

### R19 Docking gaps and tear-off polish (Wave 1)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R19.1 | Menus, dialogs, toasts and tooltips opened from a torn-off panel appear in the panel window | `app/src/ui/` docking, `docs/workspaces.md` | Right-click in a torn-off Layers panel opens its menu there | M |
| R19.2 | Drag a panel between panel windows and back into the app | same | Works in the browser path; desktop verified by R4.1 | M |
| R19.3 | Scene timeline and Code editor/preview as dockable groups (central area becomes a dock root) | docking engine, ADR 0033 amendment | Timeline can go to a second monitor | L |

### R20 Bug fixes from the known limits (Wave 1)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R20.1 | Content-aware fill: run patch synthesis on a pyramid above 60 000 px instead of switching to a blurry fill | `app/src/engine/pixel/inpaint.js` | Large crop corners show texture; time under 3 s for 4000×3000 | M |
| R20.2 | Spreadsheet validation rechecks existing values (*Circle invalid data*) and formula results | sheet engine and UI | Invalid cells marked after a rule change | S |
| R20.3 | Pixel before/after snapshot survives a reload (stored with the session, capped) | Pixel studio | Snapshot present after reload | S |
| R20.4 | Whiteboard: optional "include comment pins" in export | `app/src/office/board/` | Option in the export dialog | S |

### R21 Touch layout (Wave 3)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R21.1 | Phone "review mode": open, view, comment, export, light edits (text, crop) with a bottom sheet UI | shell, `app/src/ui/` | Usable at 375 px width; Lighthouse mobile accessibility ≥ 95 | L |
| R21.2 | Tablet portrait layout with collapsible docks and a pencil-first toolbar | docking | Verified on a real iPad and Android tablet | M |

### R22 Built-in relay TLS (Wave 3)

| Task | Scope | Files | Acceptance | Size |
| --- | --- | --- | --- | --- |
| R22.1 | `rustls` with a generated self-signed certificate and the fingerprint in the invite (pinned by the client) | `src-tauri/src/relay.rs`, `app/src/collab/` | Browser on another device joins over `wss://` after trusting the fingerprint; closes A10 | L |

## Release waves

| Wave | Version | Theme | Items | Gate |
| --- | --- | --- | --- | --- |
| **0** | 1.2.x (now, about 1 week) | Ship and clean up | R1, R2, R3 | Signed 1.2.x is *Latest*; 0 open CodeQL errors; roadmap page current |
| **1** | 1.3 | Trust and headroom | R4, R5, R6, R7, R19, R20 | Nightly desktop smoke green on 3 systems; start-up budget lowered; MCP server preview; Scene referenced media |
| **2** | 1.4 | Depth that switchers notice | R8, R9, R10, R11, R12, R17 | Live booleans; ligatures and variable fonts in PDF; interop corpus green; captions with a local engine |
| **3** | **2.0** | The major | R13, R14, R15, R16, R18, R21, R22 | 16-bit tiled Pixel with file format bump (old files open; 1.x opens 2.0 files read-only with a warning); RAW; footnotes and tagged PDF; Proto Studio lands here if its concept is ready |

Why 2.0 is where it is: R13 changes the Pixel layer storage and the `.ofini` format in a way 1.x cannot write back
losslessly, and R14 and R15 depend on it or on the same text engine work. Everything before it is additive and can ship
in minors.

## Open questions

- Engine packs (R11) need a place to host signed binaries. A separate `open-fini-engines` repository with its own
  releases keeps the MIT app small; who signs the packs?
- Shaping (R9.1): HarfBuzz Wasm adds a few hundred KiB lazily. Is that acceptable against the size philosophy, or is a
  JS subset (Latin ligatures and kerning only) enough until an RTL language is added?
- MCP server (R6): browser/PWA version cannot listen on a port; is a desktop-only server acceptable, or should the PWA
  offer a relay-based bridge?
- Proto Studio: shares the component/symbol model with R8 and the constraints engine. Agree on the shared model before
  R8.1 is merged.
