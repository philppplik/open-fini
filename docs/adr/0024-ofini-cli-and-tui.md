# ADR 0024: An `ofini` command-line tool with an optional TUI

- Status: Proposed (first slice built: `scripts/ofini.mjs` with `info` and `validate`)
- Date: 2026-11-06

## Context

OpenFini is used from the window: the desktop shell answers only `--help`, `--version` and file arguments
(`src-tauri/src/cli.rs`). People and scripts ask for headless work: inspect or validate a document in CI, export pages
to PNG or PDF on a server, batch-convert, run a Vibe prompt against a file, and keep an eye on long jobs from a
terminal. The engines are ES modules; most of the document model, the format migration and many codecs are pure,
but rendering, fonts and some importers rely on the browser (`OffscreenCanvas`, `createImageBitmap`, `FontFace`).

## Decision

Build one command, `ofini`, in three layers. Each layer ships on its own.

1. **Headless core (Node 20+, no window).** Subcommands that only need pure modules:
   - `ofini info <file>` and `ofini validate <file>` (built now; read-only, offline, exit code 1 on errors, `--json`);
   - later: `ofini convert` for formats whose codecs are pure (palettes, CSV, Markdown, DOCX/ODT text, XLSX/ODS,
     Excalidraw), `ofini format` for website projects, `ofini knowledge check` style maintenance tasks.
   Rule: a subcommand may import only modules that run in Node without DOM shims; a test imports each subcommand
   in plain Node to enforce it.
2. **Rendering through the desktop app.** Raster and PDF export, thumbnails and anything that needs canvas or
   fonts run in the real engine: `openfini --headless export <file> --pages 1-3 --to out.pdf` starts the Tauri app
   without showing a window, runs one job through the same export code as the dialog, prints JSON progress lines
   to stdout and exits. No second renderer is written for Node (that would drift from what users see).
3. **TUI (optional).** `ofini tui` is a full-screen terminal view over the same commands: a file browser with `info`,
   a job list with progress (exports, crawls, AI runs), and a Vibe chat pane that drives a headless app instance.
   It is plain ANSI on top of Node's `readline` (no framework, in line with ADR 0004): keyboard first, works over SSH,
   honors `NO_COLOR` and falls back to line output when stdout is not a TTY.

**AI from the terminal.** `ofini vibe "<prompt>" <file>` runs the agent loop headlessly against a document with the
same settings, keys (read from the app's storage only after an unlock prompt when the vault is sealed) and approval
policy as the app. Approvals become terminal prompts; `--yes` is refused for tools that are "always ask" in the app
(web, terminal, local files, MCP). Nothing about the safety model changes because the surface is a terminal.

**Distribution.** `npm run ofini` in the repository now; later the desktop installers add an `ofini` shim on PATH
(opt-in in the Windows installer, a symlink in the macOS/Linux packages) that runs the bundled Node-free build of
layer 1 via the app (`openfini --cli …`) so users do not need Node.

## Alternatives considered

- **A Rust CLI that reimplements the format.** Fast and dependency-free, but duplicates the JS document model and
  its migrations; every format change would need two implementations.
- **jsdom or node-canvas shims for rendering in Node.** Large native dependencies, font metrics that differ from
  the web view, and a second rendering path to keep in sync. Rejected in favor of layer 2.
- **A TUI framework (Ink, blessed).** Pulls a framework into a codebase that avoids them; the TUI needs only a few
  widgets.

## Consequences

- CI and scripts can check documents today (`npm run ofini -- validate file.ofini`).
- Layer 2 needs a headless mode in the shell (no window, single job, no single-instance hand-off) and a JSON
  progress protocol; both are small but need their own review.
- Commands that touch keys, the network or the file system follow the same switches and approvals as the app and
  are documented with the app's security notes.
