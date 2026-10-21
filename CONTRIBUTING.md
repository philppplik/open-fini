# Contributing to OpenFini

Thank you for helping! OpenFini is a small, fast, dependency-light creative suite and we want it to stay
that way. This guide gets you from zero to a merged pull request.

## Ground rules

* Be kind — see the [Code of Conduct](CODE_OF_CONDUCT.md).
* **Original work only.** Read the [clean-room policy](docs/clean-room.md): no code, assets, icons, fonts or
  file formats from proprietary products, no decompiled code.
* Everything user-facing is **US English** (UI text, docs, commit messages, comments).
* Keep it light: no new runtime dependencies without discussion. Vendored code must be MIT-compatible and
  listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Getting set up

```bash
git clone https://github.com/<you>/OpenFini.git
cd OpenFini
npm install
npm start          # http://localhost:4173, no build step — edit and reload
npm test           # unit tests (Node 20+)
```

The desktop shell needs Rust only if you work on `src-tauri/` — see [docs/building.md](docs/building.md).

### Project layout

```
app/                 the application (served as-is in development)
  src/core/          document model, history, operations, app state
  src/engine/        pure engines: vector/, pixel/, layout/, backends/ (testable in Node)
  src/studios/       tools per studio
  src/commands/      menu and shortcut actions
  src/ui/            shell, panels, dialogs, canvas view
  vendor/            vendored third-party code (Shoelace, fflate, polygon-clipping, Inter)
src-tauri/           desktop shell (Tauri 2)
scripts/             dev server, build, size budget, icon generation
tests/               node:test suites (core, vector, pixel, layout, packaging)
docs/                documentation and decision records
```

Read the [developer guide](docs/development.md) (module map, recipes, Git workflow) and [docs/architecture.md](docs/architecture.md) first; the shapes shared between engines are in
[docs/engine-contracts.md](docs/engine-contracts.md).

## Making a change

1. **Open an issue** for anything larger than a small fix, so we can agree on the approach.
2. Create a branch: `feat/short-name`, `fix/short-name`, `docs/short-name`. `main` is protected: all changes arrive through pull requests (squash-merged) with passing CI.
3. Write the code. Conventions:
   * ES modules, 2-space indent, double quotes, semicolons; follow the surrounding style (`.editorconfig`).
   * JSDoc types on exported functions. Comments explain *why*, not *what*.
   * **Engines are pure**: `engine/pixel`, `engine/layout` and `engine/backends/pdf*.js` must not touch the
     DOM, canvas or `window`.
   * Every document change goes through `doc.tx(...)` / `doc.set(...)` so it is undoable. Interactive tools
     mutate live and call `doc.recordSet(...)` once on pointer-up.
   * New tools extend `Tool` and are registered in `app/src/studios/tool-sets.js`; new panels are added to
     `app/src/ui/panels/index.js`; new menu actions are commands registered in `app/src/commands`.
   * Parameter UIs for effects are generated from `controls` schemas — do not hand-write forms.
4. **Test it.** Add or update tests in `tests/` (they run with `npm test`). Pure engine code needs tests;
   UI changes need a manual check in at least one Chromium-based browser and, where relevant, Firefox.
5. Run `npm test` and `npm run build && npm run check:size`.
6. Commit with a clear message (Conventional Commits are welcome: `feat:`, `fix:`, `docs:`, `perf:`,
   `test:`, `chore:`).
7. Open a pull request using the template. Describe the problem, the approach and how you verified it.
   Screenshots or short recordings help for UI changes.

## Good first contributions

* Pick an item from the [roadmap](docs/roadmap.md) marked as missing.
* Add an adjustment or filter: implement an `EffectModule` in `app/src/engine/pixel` (see
  `docs/engine-contracts.md` §1.2) — it appears in the menus and panels automatically.
* Add a preset shape in `app/src/engine/vector/presets.js`.
* Improve hyphenation, line breaking or PDF output with tests in `tests/layout`.
* Translate documentation or find and fix accessibility problems.

## Reporting bugs and requesting features

Use the issue templates. For bugs, include the OpenFini version (Help ▸ About), your platform, steps to
reproduce, what you expected and what happened; attach a minimal `.ofini` file if possible. Please report
**security** problems privately (see [SECURITY.md](SECURITY.md)).

## Releases

Maintainers follow [docs/release-process.md](docs/release-process.md). Version numbers use
[SemVer](https://semver.org); user-visible changes are recorded in [CHANGELOG.md](CHANGELOG.md).
