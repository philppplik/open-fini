# Refactoring audit

The living record of code-health audits: what was measured, what was changed, and what was considered and
deliberately *not* changed (with the reason). Append a new dated section for every future audit; do not rewrite old
ones, so the numbers stay comparable.

## Principles

1. **Refactor only for a measurable payoff**: maintainability, correctness, performance or bundle size, and only where
   tests cover the code (add characterization tests *before* touching an untested hot spot).
2. **No churn for taste**: no renames, file moves or style rewrites without a payoff someone can measure.
3. **Prefer deleting code over abstracting it.** A shared helper must remove more code than it adds.
4. **Behavior stays identical**: the whole test suite stays green; user-visible behavior does not change.
5. **Rejected ideas are written down** ("considered, not done because …"), so nobody repeats the analysis.
6. **Small PRs, one theme each**, with before/after numbers (`npm run build && node scripts/check-size.mjs`).

## Tools

| Script | What it answers |
| --- | --- |
| `node scripts/analyze-bundle.mjs [--top N] [--json]` | Runs the real production build and reads esbuild's metafile: chunks by gzip size, start-up vs lazy, start-up modules by estimated gzip size, **lazy-loading candidates** (start-up bytes reachable only through one module), size per folder. |
| `node scripts/import-report.mjs [--why <file>]` | Static import graph without a build: largest modules, fan-in/fan-out, circular imports, and the import chain that pulls a file into start-up. |
| `node scripts/find-dead-exports.mjs` | Exports nothing imports (split into real dead code and needless `export` keywords), exports only tests use. A report, never a delete list (see the blind spots in its header). |
| `node scripts/check-size.mjs` | The CI size gate (budgets in `scripts/size-budget.json`). |

The graph scripts share `scripts/lib/import-graph.mjs` (regex based, dependency-free, also used by
`tests/architecture/`).

---

## Audit 1 (October 2026, after 0.8.0)

Baseline: `main` at `39405b0` (Vibe UI v2). 494 modules (app + fflate + polygon-clipping), 131,480 lines.

### a) Size

`node scripts/check-size.mjs` on the baseline build (KiB, gzip level 9):

| Measure | Actual | Budget | Headroom |
| --- | ---: | ---: | ---: |
| Shell JS (all app JS outside `vendor/`) | 1271.5 | 1280 | 8.5 |
| **Start-up JS** (index.html modules + static imports) | **373.5** | 380 | 6.5 |
| Total download (no fonts, no on-demand libraries) | 2154.0 | 2165 | 11.0 |

The budget file has been raised 13 times; every recent feature took most of the headroom.

**Bundle composition.** 271 app chunks. The two largest are lazy shared chunks: 112.7 KiB (Code studio engines: LaTeX,
Markdown, templates) and 66.8 KiB (Vibe tool definitions). The start-up closure is 196 source modules in 20 chunks.

Start-up gzip per folder (estimated, top): `engine/layout` 69.2, `core` 47.1, `ui` 46.2, `engine/pixel` 41.2,
`studios/tools` 30.9, `commands` 24.1, `customize` 15.3, `ui/panels` 14.6, `engine/vector` 12.1, `vendor/fflate` 11.8,
`engine/web` 9.6, `vendor/polygon-clipping` 9.2.

Already lazy (good): i18n catalogs, tour steps, help, What's new, settings dialog, customize editors, collaboration,
VS Code, extensions, Office, Code and Vibe workspaces, emmet, PDF/KaTeX/CodeMirror vendors. The one big literal table
still at start-up is the HTML entity table in `engine/web/charcodec.js` (see the text-tool row below).

**Lazy-loading candidates** (start-up bytes reachable *only* through one module, from `analyze-bundle.mjs`):

| Module | Start-up KiB that would leave | Why it is at start-up | Verdict |
| --- | ---: | --- | --- |
| `engine/pixel/index.js` | 41.2 | the renderer needs the effect registry (`getEffect`) for live effects and adjustment layers | Later: needs an async effect registry; touches rendering |
| `engine/layout/hyphenation(-en-us).js` | 17.0 | `engine/dl.js` creates the hyphenator lazily, but the pattern table is a static import | Later: layout is synchronous; lazy patterns would change the first layout of hyphenated text (reflow) and exports |
| `vendor/fflate` | 11.8 | `.ofini` read/write (`core/ofini.js`) | Rejected: needed to open the session's documents at start |
| `engine/vector/boolean.js` + polygon-clipping | 10.7 | `core/ops.js` (`booleanOp`, `expandStrokeOp`) | Later: both are synchronous public APIs (Vibe tools, tests) |
| `core/io.js` | 10.0 | import/export entry points | Later: many call sites, mostly already async |
| **`ui/export-dialog.js`** | **9.5** | static import in `commands/file.js` and `commands/code.js`, only used when a command runs | **Do now** |
| **`commands/text-tools.js` → `engine/web/texttools.js` + `charcodec.js`** | **8.3** | the palette registers ~50 Code text commands at start and needs only their ids/labels, but the transforms pull the 1100+ entry HTML entity table | **Do now** (split the catalog from the implementation) |

**Duplicates.** Small helpers are re-implemented locally: `esc`/`escapeHtml` (7 one-liners in engine, web, office,
vscode), `clamp` (8), `uid` (2: `core/util.js`, `engine/office/model.js`), `crc32` (2: `ai/providers/mock.js`,
`engine/formats/embedded.js`), `debounce` (2). Verdict: **rejected**: each is one to ten lines, the engines must stay
importable on their own (pure, no `core/` dependency), and a shared module would add imports without removing
measurable bytes (the copies are one-liners that live in different lazy chunks).

**Dead code.** `find-dead-exports.mjs`: 0 orphan modules; 321 exports nothing imports, of which 93 are not referenced
in their own module either. Most of those 93 are re-exports of public engine barrels (`engine/layout/index.js`,
`studios/index.js`), which stay. Real dead functions: `core/color.js` (`withAlpha`, `luminance`, `mixColors`, `WHITE`,
`BLACK`), `core/util.js` (`lerp`, `approx`), `core/office.js` `ensureOffice`, `core/pixel.js` `readRect`,
`engine/office/report.js` `copyReport`, `ui/menus.js` `isContextMenuOpen`, `ui/controls.js` `ofIcon`, `ui/themes.js`
(`hasTheme`, `currentTheme`), `core/app.js` `STUDIO_ORDER`, `core/web.js` `DEFAULT_WEB_SETTINGS`. Payoff: lines only
(esbuild already drops unused code, so 0 KiB). Verdict: **Do now** (small, safe deletions).

**Vendored libraries** (gzip): CodeMirror 218.0 (lazy, Code studio), pdf.js 147.9 + worker 383.0 + wasm (on demand, not
precached), fflate 11.8 (start-up), polygon-clipping 9.2 (start-up), Shoelace components (loaded per component).

**CSS.** A class-name scan of `app/styles/*.css` against all JS/HTML found 93 class names never mentioned literally;
almost all are CodeMirror classes (`cm-*`), dynamic names (`lv-${level}`) or documented hooks (`of-native-scroll`).
Provably dead: 12 classes in `vibe.css` left over from Vibe UI v1 (`of-vcanvas*`, `of-slash*`, `of-vruns*`,
`of-vmsg__tools`, `of-approval__done`). Verdict: **Do now**.

### b) Structure

| Module | Lines | Note |
| --- | ---: | --- |
| `engine/layout/text-layout.js` | 2058 | cohesive (line breaking, frames, caret); split rejected: one algorithm, well tested |
| `engine/web/latex.js` | 1848 | cohesive converter, lazy |
| `engine/web/markdown.js` | 1462 | cohesive, lazy |
| `ui/office/editor.js` | 1303 | largest untested UI module |
| `engine/formats/psd.js` | 1263 | cohesive reader/writer, tested |
| `core/app.js` / `ui/shell.js` / `commands/file.js` / `ui/settings-dialog.js` / `vibe/session.js` | 481 / 265 / 426 / 457 / 460 | the suspected god objects are moderate in size; no split has a clear payoff now |

Fan-in: `core/util.js` 157, `ui/controls.js` 57, `ui/dialogs.js` 50, `core/nodes.js` 40, `i18n/index.js` 40.
Fan-out: `ui/code/workspace.js` 28, `vibe/tools/index.js` 25, `engine/web/index.js` 20, `ui/shell.js` 19.

**Circular imports: 1**, `core/data-nodes.js` ↔ `core/ops.js` (`remapLinks` vs `addNodes`). Harmless at runtime
(function bindings) but it blocks a "no cycles in core" guardrail. Verdict: **Do now** (move `remapLinks`, a pure tree
helper, next to `walk` in `core/nodes.js`).

**Layering.** `core/` imports `ui/` only through `import()` in `core/open-foreign.js` (dialogs on demand): accepted.
`engine/` never imports `ui/`. Engine DOM-freedom is tested for `engine/web` only (`tests/web/purity.test.js`).

**Events and leaks.** `Emitter.on` returns an unsubscribe function. 127 `app.on(` calls, mostly in singletons (shell,
canvas view, panels; the dock creates each panel once). Panels and panes that are rebuilt each time a dialog opens must
unsubscribe. Found: `ui/customize/toolbox-editor.js` keeps a `studio` listener (and with it the detached pane) for
every opening of *Settings ▸ Toolbox and menus*. Verdict: **Do now**. `addEventListener` 828 vs
`removeEventListener` 60: almost all on elements that are discarded together with their listeners (fine).
`setInterval` 15 / `clearInterval` 15. `ResizeObserver` 10 / `disconnect` 4: the observers are on elements of
singletons or observe their own element (collected with it).

**Logging and errors.** `core/log.js` is used in 20 files; raw `console.*` in 19 files (29 calls), mostly in
bootstrap, workers and sandboxes where the logger is unavailable. 71 empty `catch {}` blocks (best-effort storage and
feature detection). Verdict: Later (no measurable payoff now; review case by case when touching a file).

**Test coverage.** 492 app modules; 436 are loaded by at least one test, 251 directly. 82 modules (16,492 lines) are
never loaded by a test, all UI: `ui/code` 6800 lines, `ui/vibe` 3179, `ui` 2379, `ui/office` 1774, `commands`
1388. Largest: `ui/office/editor.js`, `ui/code/workspace.js`, `ui/canvas-view.js`. Refactors of these need
characterization tests or browser checks first.

### c) Risk ranking

| # | Candidate | Payoff | Risk | Effort | Tests | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Load the export dialog on demand | −9.5 KiB start-up | low (commands are async already) | S | command tests, build | **Do now** |
| 2 | Split the text-tool catalog from the transforms | −8.3 KiB start-up | low | S | `tests/web/texttools.test.js` + new catalog test | **Do now** |
| 3 | Break the `data-nodes` ↔ `ops` cycle | 0 KiB, enables a guardrail | low | S | `tests/layout/table-chart-doc.test.js` | **Do now** |
| 4 | Fix the toolbox editor listener leak | memory per settings visit | low | S | browser check | **Do now** |
| 5 | Delete dead functions and Vibe UI v1 CSS | lines, ~0.5 KiB CSS | low | S | full suite | **Do now** |
| 6 | Guardrails (cycles, layering, engine purity, start-up closure) + lower budgets | prevents regressions | low | M | new tests | **Do now** |
| 7 | Lazy hyphenation patterns | −17 KiB start-up | medium (first layout, exports) | M | layout tests | Later: needs an "ensure ready" step before layout/export |
| 8 | Async pixel effect registry | −41 KiB start-up | high (renderer) | L | partial | Later |
| 9 | Lazy boolean engine | −10.7 KiB start-up | medium (sync API used by Vibe tools) | M | core tests | Later |
| 10 | Shared `esc`/`clamp`/`crc32` helpers | ~0 KiB | low | S | yes | Rejected: no bytes saved, couples pure engines to `core/` |
| 11 | Split `core/app.js`, `ui/shell.js`, `commands/file.js` | none measurable | medium | M | partial | Rejected: < 500 lines each, no clear seam that removes code |
| 12 | Replace `console.*` with `core/log.js` everywhere | consistency | low | M | — | Later: most calls are in places without the logger |
| 13 | Lazy `fflate` | −11.8 KiB | high | — | — | Rejected: needed to restore documents at start |

### Results

Filled in as the PRs land (numbers from `check-size.mjs`, KiB gzip).

| PR | Change | Start-up | Shell JS | Total |
| --- | --- | ---: | ---: | ---: |
| baseline | `main` @ `39405b0` | 373.5 | 1271.5 | 2154.0 |
