# Developer guide

For engineers who join the project. Read this first, then [architecture.md](architecture.md) and the doc of the area you
touch (every area has one, see the map below). [CONTRIBUTING.md](../CONTRIBUTING.md) covers the rules of the road;
this file covers *how the code is organized and how to work on it*.

## 1. The 10-minute orientation

OpenFini is a no-framework ES-module app in `app/` (served as-is in development, bundled with esbuild for releases),
wrapped by a Tauri v2 shell in `src-tauri/` and shipped as a PWA too.

```
UI (app/src/ui, app/src/studios)  ──►  commands (app/src/commands)  ──►  core (app/src/core)  ◄──  engines (app/src/engine, pure)
          │                                                              ▲
          └── Vibe tools (app/src/vibe/tools) ─── the same commands/ops ──┘
```

Rules that explain most of the code:

1. **Engines are pure** (no DOM, no `window`, no global `fetch`): `app/src/engine/*`, `app/src/ai/*`, `app/src/core/*.js`
   modules documented as pure (`log.js`, `network.js`, `updates.js`, …). They run in Node and are unit-tested.
2. **Everything a user can do is a command** with an id (`file.save`, `arrange.group`, `window.popout` …), registered in
   `app/src/commands/*`. Menus, shortcuts, the command palette, context menus, extensions and the Vibe assistant all go
   through commands or the same ops. Do not wire behavior directly into a button.
3. **Every document change is undoable**: `doc.tx(...)` / `doc.set(...)`; interactive tools mutate live and record once.
4. **Heavy things are lazy.** Anything not needed at start-up is loaded with `import()`. CI enforces size budgets
   (`scripts/size-budget.json`: startup JS, total app JS, total download). Add features lazily or the build fails.
5. **Everything user-visible is translatable**: `t("English text")` (the English text is the key). `npm run i18n:check`
   runs in the test suite.
6. **Security by construction**: untrusted code (extensions, custom tools, website previews) only runs in sandboxed
   iframes; outbound network goes through `app.network.assert(kind)`; secrets are never written to documents or logs.

## 2. Where things live

| Area | Code | Doc |
| --- | --- | --- |
| Document model, history, ops, app state | `app/src/core/` | [architecture.md](architecture.md), [engine-contracts.md](engine-contracts.md) |
| Vector / Pixel / Layout engines | `app/src/engine/{vector,pixel,layout,backends}` | [studios.md](studios.md), [layout-tables-charts.md](layout-tables-charts.md), [pixel-histogram.md](pixel-histogram.md) |
| Studio registry, tools, docks | `app/src/studios/` (`registry.js` is the single list of studios) | [studios.md](studios.md) |
| Code studio and web engine | `app/src/ui/code/`, `app/src/engine/web/`, `app/src/engine/git`, `engine/publish` | [code-studio.md](code-studio.md), [web-engine.md](web-engine.md), [frameworks.md](frameworks.md), [git-and-publishing.md](git-and-publishing.md) |
| Office Suite (registry, launcher, apps, Office Toolkit) | `app/src/office/`, word processor `app/src/ui/office/`, `app/src/engine/office/` | [office-suite.md](office-suite.md), [office-studio.md](office-studio.md) |
| Vibe (AI) | runtime `app/src/ai/`, hub/session/tools `app/src/vibe/`, UI `app/src/ui/vibe/` | [vibe-studio.md](vibe-studio.md), [ai-engine.md](ai-engine.md), [vibe-skills.md](vibe-skills.md) |
| File formats / importers | `app/src/engine/formats/`, `app/src/core/import-*.js`, `app/src/platform/file-types.js` (single source of truth for types) | [file-compat.md](file-compat.md), [pdf-import.md](pdf-import.md), [file-format-research.md](file-format-research.md) |
| Extensions + SDK | `app/src/extensions/`, `app/src/ui/extensions/`, `sdk/`, `extensions/` (bundled) | [extensions.md](extensions.md), [bundled-extensions.md](bundled-extensions.md) |
| VS Code extensions (Open VSX, `.vsix`, `vscode` API shim) | pure `app/src/vscode/`, UI `app/src/ui/extensions/vscode*.js` | [vscode-extensions.md](vscode-extensions.md), [ADR 0012](adr/0012-vscode-extensions.md) |
| Themes, onboarding, command palette | `app/src/ui/themes.js`, `tour*.js`, `command-palette.js` | [themes.md](themes.md), [design-system.md](design-system.md) |
| Settings and customization | `app/src/ui/settings-dialog.js`, `app/src/customize/` | [settings.md](settings.md), [customization.md](customization.md) |
| Context menus | `app/src/ui/context-menu/` | [context-menus.md](context-menus.md) |
| i18n | `app/src/i18n/` | [i18n.md](i18n.md), [i18n-glossary.md](i18n-glossary.md) |
| Windows (pop-out), title bar, OS integration | `app/src/platform/`, `app/src/ui/popout.js`, `src-tauri/` | [multi-window.md](multi-window.md), [os-integration.md](os-integration.md) |
| Collaboration (rooms, chat, comments, versions, presence, relay, Edit together, LAN rooms) | pure `app/src/collab/` (incl. `tree-crdt.js`, `text-crdt.js`, `qr.js`), UI `app/src/ui/collab/` (`live.js`, `network.js`), `scripts/relay.mjs`, `scripts/relay-tls.mjs` | [collaboration.md](collaboration.md), [ADR 0010](adr/0010-collaboration-e2e-relay.md), [ADR 0011](adr/0011-live-editing-sync.md) |
| Security, logging, diagnostics | `app/src/core/{log,network,security,atrest}.js`, `app/src/ui/security-center.js` | [security.md](security.md), [troubleshooting.md](troubleshooting.md) |
| Build, size budgets, installer, release | `scripts/`, `src-tauri/installer`, `.github/workflows/` | [building.md](building.md), [installer.md](installer.md), [release-process.md](release-process.md) |
| The wiki (user and developer manual, published to the GitHub wiki) | `wiki/`, `scripts/wiki-sync.mjs`, `scripts/wiki-shortcuts.mjs`, `.github/workflows/wiki.yml`, `tests/docs/` | [wiki-maintenance.md](wiki-maintenance.md), `wiki/Wiki-Style-Guide.md` |

## 3. Recipes: how to add…

* **A command**: register in `app/src/commands/<area>.js` (id, label via `N_`/`t`, run, enabled, shortcut). It then shows up in
  menus (add the id to the menu list in `ui/menus.js`), the palette and the shortcut editor. Add it to `tests/` if it has logic.
* **An Office app** (spreadsheet, slides, whiteboard …): a manifest + lazy implementation, one line in `app/src/office/index.js`; contract and worked example in [office-suite.md](office-suite.md).
* **A studio**: one `registerStudio({...})` entry (`studios/registry.js` documents the fields); put heavy UI behind `import()`.
  It appears in the header "More" menu; users choose the five visible studios in Settings.
* **A tool the Vibe assistant can use**: a `tool()` in `app/src/vibe/tools/<area>.js` (`helpers.js` has `tool`, `S` schema
  helpers), register it in `tools/index.js` **and** `TOOL_GROUPS`. `tests/ai/tool-contract.test.js` enforces schemas,
  uniqueness and grouping. Mark read-only tools `{ readOnly: true }`; outward actions return an approval reason.
* **A skill**: Markdown with front matter, see [vibe-skills.md](vibe-skills.md); built-ins in `app/src/ai/skills-library.js`.
* **A context menu**: `registerContextProvider` ([context-menus.md](context-menus.md)); never call `showContextMenu` with a hand-built list for new surfaces.
* **A setting**: add it to the schema in `app/src/customize/schema.js` / the settings dialog section; prefs live in `App.prefs` (`defaultPrefs()`).
* **A file format**: a pure reader/writer in `engine/formats/` + tests with synthetic fixtures, a row in `platform/file-types.js`
  (the packaging tests check that Open dialogs, drag-and-drop, Tauri associations and the PWA manifest agree), routing in `commands/file.js`.
* **An extension**: `node sdk/create-extension.mjs publisher.name`, see [extensions.md](extensions.md).
* **A translation**: wrap with `t()`, `npm run i18n:extract`, translate `app/src/i18n/locales/de.json`; new language = one `LOCALES` entry.
* **A dependency**: avoid. Vendored code needs an MIT-compatible license, a folder in `app/vendor/`, an entry in `THIRD_PARTY_NOTICES.md`.

## 4. Testing

* `npm test` runs every `tests/**/*.test.js` with `node:test` (no browser, no dependencies). Aim for pure logic in testable modules.
* Pure modules get unit tests with synthetic fixtures; parsers get hostile-input tests (truncation, huge sizes, bad offsets).
* UI changes need a manual check in Chromium (the repo ships a dev server: `npm start`, or `node scripts/serve.mjs --port N`). The app
  is exposed as `window.openfini` for scripting (`setStudio`, `run(commandId)`, `prefs`, `doc`, `toast`, `emit/on`).
* `npm run build && npm run check:size` must pass; CI runs tests on Linux, macOS and Windows plus the Rust build.
* The Demo (mock) Vibe provider makes AI features testable without keys; extend `app/src/ai/providers/mock.js` when you add tools.

## 5. Working together: Git, branches, PRs

* **`main` is protected.** All changes go through pull requests; required checks: Web/PWA (Ubuntu, macOS, Windows) and Rust.
* Branch names: `feat/…`, `fix/…`, `docs/…`, `refactor/…`. One topic per branch.
* Commits: Conventional Commits (`feat(scope): summary`), body explains *what and why*. PRs are squash-merged, so the PR title becomes the history line.
* PR description: Summary, What changed, How verified, Limits/not verified, Docs. Keep unverified things explicit: never claim a test you did not run.
* Shared files (`core/app.js`, `ui/shell.js`, `ui/menus.js`, `ui/settings-dialog.js`, `commands/index.js`, `vibe/tools/index.js`,
  `CHANGELOG.md`, `app/index.html`) are conflict hot spots when several people work in parallel: make small additive edits,
  put new code in new files and new CSS in your own stylesheet, merge `main` often.
* Update the docs of the area you changed and add a bullet to `CHANGELOG.md` under `## [Unreleased]`.
* The wiki lives in `wiki/` and is published to the GitHub wiki on merge to `main`; if you change a shortcut or command, run `npm run wiki:shortcuts` (a test fails when `wiki/Keyboard-Shortcuts.md` is stale) and update the affected wiki page ([wiki-maintenance.md](wiki-maintenance.md)).
* Design decisions that are hard to reverse get an ADR in [adr/](adr/README.md) (context, decision, consequences).

## 6. Size, performance and low-power devices

OpenFini targets old and low-power machines. Use the budgets as a design constraint: lazy-load, prefer pure functions and plain
data, avoid per-frame allocations in canvas code, and keep undo history bounded (`prefs.historyMB`, low-power mode).
Measure with `npm run build && npm run check:size` (prints startup, total app and download sizes).

### Keeping the app small and clean

Rules (enforced where cheap, by `tests/architecture/guardrails.test.js` and `scripts/check-size.mjs`):

* **Start-up is precious.** Only what the shell needs to draw the first frame is imported statically from `main.js`.
  Dialogs, studios' workspaces, importers, engines that only a command needs: `import()` them where they are used.
  The test keeps a list of lazy areas (`LAZY_AREAS`: collab, VS Code, extensions, Office, formats, git, publish, Code
  and Vibe UI, AI, locales, the export dialog, pdf.js, CodeMirror, KaTeX) out of the static start-up closure.
* **If start-up only needs a list, split the list from the code.** Example: `engine/web/texttools-catalog.js` (ids and
  labels for the palette) vs. `texttools.js` (the implementations and the HTML entity table).
* **No circular imports** in `app/src`; **`core/` and `engine/` never import `ui/`, `studios/`, `commands/` or
  `vibe/`** statically (use a callback or `import()`); **engine code touches no DOM or browser globals**.
* **Prefer deleting code over abstracting it.** A shared helper must remove more code than it adds; tiny local
  one-liners in pure engines are fine.
* **Long-lived listeners unsubscribe.** `app.on()` returns an `off` function; anything built more than once (dialog
  panes, popovers) must call it when it goes away.
* **Budgets go down, not only up.** After a size win, lower `scripts/size-budget.json` to the measured value plus about
  2 % and note it in the file's `$comment`.

How to look:

```
npm run build && node scripts/check-size.mjs     # the CI gate
node scripts/analyze-bundle.mjs --top 40         # chunks, start-up modules, lazy-loading candidates (runs a build)
node scripts/import-report.mjs                   # largest modules, fan-in/out, cycles
node scripts/import-report.mjs --why app/src/engine/web/charcodec.js   # why is a file loaded at start-up?
node scripts/find-dead-exports.mjs               # dead code report (never fails; read its blind spots)
```

[refactoring-audit.md](refactoring-audit.md) is the living record: append a dated section with numbers for every audit,
including the ideas that were considered and rejected.

## 7. Known sharp edges

* Rust/Tauri code cannot be compiled on every dev machine; CI is the first real build. Keep Rust changes small and `cargo fmt` clean.
* `makensis` (Windows installer) and macOS DMG layout are validated only by the release build.
* The English text is the i18n key: editing an English string drops its German translation until you re-run `npm run i18n:extract`.
* Extension and sandbox code has no module loader: bundled extensions are concatenated by `scripts/pack-extensions.mjs`.
* Roadmap and honest limits per area live in [roadmap.md](roadmap.md); planned studios: Video, Motion, Render (3D).
