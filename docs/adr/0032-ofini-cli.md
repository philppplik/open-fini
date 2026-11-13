# ADR 0032: The `ofini` command line tool reuses the pure engine modules in Node

- Status: Accepted
- Date: 2026-11-13
- Builds on: [ADR 0024](0024-ofini-cli-and-tui.md) (layer 1, the headless core, and a small interactive mode)

## Context

ADR 0024 proposed a command in three layers and shipped a first slice (`scripts/ofini.mjs`: `info`, `validate`). Users
want a real `ofini` command in their terminal: inspect, validate, repair, create, convert and export projects, in CI
and by hand. The question is how much of the app runs in Node without a window, and how to keep the command honest
about the rest.

We measured it by importing every candidate module in plain Node 20+ and running it on real projects:

* Run headless: the document model (`core/doc.js`, `nodes.js`, `web.js`, `office.js`), format migration, the display
  list (`engine/dl.js`), the SVG and PDF writers (`engine/backends/svg.js`, `pdf.js`), every Office app's `create`,
  `open` and `save` (DOCX, ODT, RTF, HTML, Markdown, text, XLSX, ODS, CSV, TSV, PPTX, ODP, Excalidraw, tldraw, and the
  PDF writers), the website templates, the Scene model and text extraction.
* Need a canvas: text measurement (`core/fonts.js` measures with `CanvasRenderingContext2D`), decoding pictures
  (`createImageBitmap`), pixel layers, raster export, thumbnails, effects and adjustment layers, video.

## Decision

1. **A Node CLI in `cli/`**, with `"bin": { "ofini": "cli/ofini.mjs" }` in `package.json`, so `npm link`,
   `npm install -g .` and `npx ofini` work from the repository. ES modules, no dependencies. Commands: `info`,
   `validate`, `doctor`, `export`, `convert`, `formats`, `extract`, `ls`, `new`, `pack`, `unpack`, `diff`, `version`,
   `help`, `completion`, and an interactive mode when started without arguments in a terminal (Node's `readline`:
   history and Tab completion, no framework). `scripts/ofini.mjs` is removed; `npm run ofini` runs the new entry.
2. **Reuse, never fork.** The CLI imports the app's modules directly. Two seams make that possible without DOM shims:
   * `core/fonts.js ▸ setTextMeasurer(m)`: the CLI installs `engine/layout/measurers.js ▸ approxMeasurer` (AFM
     widths of the PDF base-14 fonts). The browser never calls it.
   * Pictures and pixel layers are read as **placeholders** that carry their stored bytes (`cli/lib/project.mjs`):
     the display list sees an object with a size, the SVG writer embeds the original bytes, and writing the project
     back keeps every part byte for byte.
3. **Ship only what works end to end.** Formats that need rendering are refused with exit code 4 and a pointer to the
   app (PNG and other raster formats, video, PDF of design pages with pictures, adjustment layers). No second renderer
   is written for Node: ADR 0024 ▸ layer 2 (`openfini --headless`) remains the plan for those.
4. **One Doctor module** (`core/doctor/`) serves the CLI and the in-app Doctor ([doctor.md](../doctor.md)); it is pure
   and reuses the ZIP limits of `core/ofini.js`.
5. **Terminal conventions.** `--json` on every command, `--quiet`, `--no-color`, `NO_COLOR` / `FORCE_COLOR` / non-TTY
   detection, wildcards expanded by the tool (cmd.exe and PowerShell do not), `-` for standard input and output,
   documented exit codes (0 ok, 1 problems, 2 usage, 3 file, 4 unsupported, 5 internal, 130 interrupted), no
   overwriting without `--force`. Tables and colors are written by hand (`cli/lib/term.mjs`).
6. **Desktop.** The desktop app does not install the command. The app bundle contains the built web assets, not the
   engine modules as files and no Node.js, so a launcher script on PATH would have nothing to run; bundling Node would
   add tens of megabytes. Users install from the repository (docs/cli.md). The Tauri route of ADR 0024
   (`openfini --cli …` running the JS in a hidden web view) stays open and would reuse `cli/lib/main.mjs` unchanged;
   when it exists, a *Help ▸ Install Command Line Tool* action can write a per-user launcher (no elevated rights,
   with a visible target path and an *Uninstall*).

## Consequences

* CI and scripts can validate, repair, convert and export documents with the same code as the app.
* Text layout in Node uses base-14 metrics, so line breaks in SVG and PDF from the CLI can differ slightly from the
  app. This is documented next to the formats.
* `tests/packaging/ofini-cli.test.js` imports and runs every command in plain Node, which keeps the modules it uses
  free of DOM requirements at import time.
* A new export format becomes available in the CLI automatically when an Office app's `save` handles it without a
  canvas; formats that fail with a canvas error are reported as "needs the app".

## Alternatives considered

* **Shimming `OffscreenCanvas` in Node** (as some tests do for measurement): small, but it hides which features really
  work and invites drawing code that silently does nothing. Rejected in favor of the two explicit seams.
* **node-canvas or a WASM rasterizer**: native dependencies or a second renderer that drifts from the app.
* **A separate npm package**: possible later; today the CLI imports the app's source tree directly, which keeps one
  version of everything.
