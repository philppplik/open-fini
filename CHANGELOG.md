# Changelog

All notable changes to OpenFini are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (while below 1.0, minor versions may contain breaking changes).

## [Unreleased]

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
