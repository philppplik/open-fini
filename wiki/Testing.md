# Testing

OpenFini has three layers of checks: automated unit tests that run in Node without a browser, build and size checks, and a manual QA checklist for what only a browser can show. This page explains how to run them, where tests live, and what to test when you change something.

## Run the tests

```sh
npm test                                   # everything, via scripts/test.mjs
node --test "tests/pixel/*.test.js"        # one suite (explicit globs; directories are not accepted)
node tests/pixel/bench.mjs                 # pixel-engine benchmark (not part of npm test)
npm run build && npm run check:size        # production build and size budgets
```

`scripts/test.mjs` finds every `tests/**/*.test.{js,mjs}` and passes explicit file paths to `node --test`, because plain `node --test` also walks vendored folders and Node 20 and Node 22 handle directories and globs differently. No test framework is installed: tests use `node:test` and `node:assert`.

## Suites

| Suite | Covers |
| --- | --- |
| `tests/core` | Document model, transactions, undo of every primitive, `.ofini` round trips and migration, logging, network policy, recents, source-format decisions |
| `tests/vector` | Path geometry, SVG parsing, curve fitting, booleans, stroke expansion |
| `tests/pixel` | Every adjustment, filter, selection operation, retouch, liquify, histogram, develop pipeline |
| `tests/layout` | Text model, styles, line breaking, frame chains, fonts, PDF structure |
| `tests/web` | Web engine parsers, edit producers, style schema, preview building, viewport and measure logic, Markdown and LaTeX |
| `tests/git`, `tests/publish` | Git engine against known hashes and real Git; deploy request builders with mock `fetch`, the helper with fake servers |
| `tests/formats`, `tests/office` | Format readers and writers with synthetic fixtures; Office codecs |
| `tests/ai`, `tests/vibe` | AI runtime, skills, tool contract, hub with the Demo provider on real documents |
| `tests/collab` | Crypto, protocol, stores, sessions, and the real relay on a random port |
| `tests/extensions`, `tests/extensions-bundled` | Host, manifest, RPC, catalog freshness, each bundled package |
| `tests/customize`, `tests/i18n`, `tests/ui` | Shortcuts and profiles, catalogs, themes and glass contrast |
| `tests/packaging` | Dev server, build, version script, file-type consistency across installers and manifest |
| `tests/docs` | This wiki: links, reachability, page rules, the generated shortcuts page |

## Conventions

- Put new logic in **pure modules** so it can be tested in Node. Parsers get hostile-input tests (truncation, huge sizes, bad offsets).
- Fixtures are synthetic and written by independent writers in the tests, not by the readers under test.
- Tests that need `git` or other tools skip themselves when the tool is missing.
- The offline **Demo** Vibe provider makes AI features testable without keys; extend `app/src/ai/providers/mock.js` when you add tools.
- `tests/ai/tool-contract.test.js` checks that every Vibe tool is in a group, has a schema and a unique name.
- `npm run i18n:check` runs inside the suite; changing an English string without extracting fails it.

## Manual QA

Run the checklist in `docs/testing.md` before a release, in a Chromium browser at minimum, plus Firefox and the desktop app where you can. `?fresh=1` starts without restoring the last session. Check: start-up without console errors, each studio's core flow, export, save and reopen, the website export, themes in light and dark, keyboard access and reduced motion.

For UI changes, open the dev server in Chromium, exercise the feature, and check light and dark themes, High contrast and low-power mode. Do not claim a manual check you did not run.

## What CI runs

Tests, build and size checks on Ubuntu, Windows and macOS, plus `cargo fmt`, `clippy` and `cargo check` for the Rust shell ([[CI and Size Budgets]]).

## Not covered

Canvas rendering and tools are covered by manual checks; the Rust shell and installers are verified only by CI builds; relay over a real LAN, TLS and proxies are untested; live AI providers and deploy vendors are tested with fakes.

## See also

- [[Development Setup]]
- [[CI and Size Budgets]]
- [[Extending OpenFini]]
- [[Contributing]]
