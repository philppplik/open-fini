# Testing

OpenFini has three layers of checks. All automated tests use Node's built-in runner (`node:test`) — no test
framework to install.

```bash
npm test                                   # everything below, via scripts/test.mjs
node --test "tests/pixel/*.test.js"        # one suite (explicit globs; directories are not accepted)
node tests/pixel/bench.mjs                 # pixel-engine benchmark (not part of npm test)
npm run build && npm run check:size        # production build + size budgets
```

## 1. Automated unit tests (`tests/`)

| Suite | What it covers |
| --- | --- |
| `tests/vector` | Path geometry (bounds, flattening, nearest point, node insertion), SVG path parsing incl. arcs, Schneider curve fitting, boolean operations (areas, curved results), stroke expansion, matrix math |
| `tests/core` | Document model: transactions, rollback, coalescing, undo / redo of every primitive edit, pages and facing layout, JSON and `.ofini` round trips, group / align / distribute / duplicate / boolean operations, scale baking, display-list compilation and caching, SVG export, color helpers, file-type sniffing |
| `tests/pixel` | Every adjustment, filter, selection mask operation, flood fill, retouch dab, liquify, histogram, Develop pipeline, tracing and resampling — numeric spot checks plus invariants (identity parameters change nothing, blur preserves the mean, …). A test also asserts that no pixel-engine source touches the DOM |
| `tests/layout` | Text model edit operations (fuzzed against a plain-string oracle), style resolution, line breaking, justification, tabs, bullets, drop caps, frame chains, exclusions, caret / hit-test round trips, font parsing, PDF structure (xref offsets, stream lengths, object references), CSV and field merging |
| `tests/web` | Web engine: HTML and CSS parsers (ranges slice back to the exact source, tolerance, fuzzing), edit producers (minimal changes, idempotence, re-parse without new errors), style schema and value helpers, preview building (annotation ids, asset and module rewriting, handler conversion), site export, templates and element catalog (valid, self-contained), Emmet |
| `tests/packaging` | Dev server, production build (hashing, precache list, service worker), version script, platform bridge |

Engines are deliberately **pure** so they can be tested in Node without a browser; DOM-dependent code (canvas
backend, tools, panels) is covered by the manual checklist below and by the browser smoke tests the
maintainers run before releases.

## 2. Build checks

* `npm run build` must succeed and `npm run check:size` must stay within `scripts/size-budget.json`.
* CI (`.github/workflows/ci.yml`) runs tests, build and size check on Linux, Windows and macOS, and
  `cargo fmt`, `clippy` and `cargo check` for `src-tauri`.

## 3. Manual QA checklist

Run through this before a release (a Chromium-based browser at minimum; Firefox and the desktop app on the
platforms you can reach). `?fresh=1` in the URL starts without restoring the last session.

**Start-up**
- [ ] No errors in the console; welcome screen shows; *New Document* opens the dialog and creates a document.
- [ ] Reload restores the session (documents, pixel layers, placed images, active studio).

**Vector**
- [ ] Draw each shape type; drag-resize and rotate with the handles (rotated objects resize along their own axes).
- [ ] Pen: click, click-drag, close the path; Node tool: drag nodes / handles / a segment, insert, delete, toggle smooth.
- [ ] Fill and stroke: solid, linear, radial, conical; dash; alignment; effects (shadow, glow, blur).
- [ ] Booleans, group / ungroup, arrange, align / distribute, undo / redo after each.
- [ ] Place an SVG and a PNG; export SVG, PNG, PDF and open the results.

**Pixel**
- [ ] Brush, eraser, fill, gradient with and without a selection; undo / redo strokes.
- [ ] Marquee, lasso, wand, color range; add / subtract; feather; invert; selection to layer / mask.
- [ ] Layer mask: add, paint with black / white, toggle editing, apply.
- [ ] Adjustment and filter layers: add, edit parameters live, nest under a layer, reorder, merge down.
- [ ] Clone / heal (Alt-click source), dodge / burn, liquify (apply and reset), crop, canvas size, image trace.

**Layout**
- [ ] Text frame: type, select, bold / italic, change font; overflow marker appears.
- [ ] Flow into new frame creates the next page; edit the first frame and watch text reflow into the second.
- [ ] Master page with page-number field shows the right number on each page.
- [ ] Styles: add defaults, apply Heading 1, generate the table of contents.
- [ ] Image frame fill by drop; table insertion; data merge preview and merged PDF.
- [ ] Export PDF with bleed and crop marks; text is selectable and fonts display correctly.

**Export**
- [ ] Draw slices, change format / scale, export all (ZIP).

**Platform**
- [ ] Theme switch (dark / light / system), low-power mode toggle, window resize down to tablet width.
- [ ] Desktop app: open via double-click on a `.ofini` file, save and re-open, native dialogs, installer works.

## Reporting results

Attach the output of `npm test` and the platform / browser versions to pull requests that touch engines,
and mention which manual checks you ran for UI changes.
