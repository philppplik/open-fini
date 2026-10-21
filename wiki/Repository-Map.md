# Repository Map

This page maps the repository: which folder holds what, and which document describes it. Use it to find the right place before you change something. Paths are relative to the repository root.

## Top level

| Path | Contents |
| --- | --- |
| `app/` | The application, served as is in development |
| `src-tauri/` | Rust desktop shell (Tauri 2), capabilities, installer assets, Linux and Windows packaging |
| `sdk/` | Extension SDK: typings, JSON schema, scaffolding and pack scripts, examples |
| `extensions/` | Bundled extensions (sources, packed `.ofext` packages, `catalog.json`) |
| `scripts/` | Dev server, build, size check, relay, MCP gateway, publish helper, icons, i18n, version, pack scripts, wiki scripts |
| `tests/` | `node:test` suites by area |
| `docs/` | Deep technical documentation and decision records |
| `wiki/` | Source of this wiki ([[Wiki Style Guide]]) |
| `.github/` | Workflows (CI, CodeQL, Pages, release, wiki), issue and PR templates, release notes config |

## `app/src`

| Path | Contents | Doc |
| --- | --- | --- |
| `core/` | App state, document model, history, ops, io, `.ofini`, importers, security, logging, network policy | architecture.md |
| `engine/vector`, `pixel`, `layout`, `backends` | Pure engines and render backends | engine-contracts.md |
| `engine/formats`, `engine/office`, `engine/web`, `engine/git`, `engine/publish` | Format readers and writers, Office codecs, website engine, Git, deploy targets | file-compat.md, office-studio.md, web-engine.md |
| `studios/` | Registry and tools per studio | studios.md |
| `commands/` | One module per command area | development.md |
| `ui/` | Shell, menus, panels, dialogs, per-studio UI (`code/`, `office/`, `vibe/`, `collab/`, `customize/`, `context-menu/`) | design-system.md |
| `ai/` | Pure AI runtime: providers, agent loop, MCP, RAG, skills | ai-engine.md |
| `vibe/` | Hub, session, store, tools (`vibe/tools/*.js`) | vibe-studio.md |
| `collab/` | Pure collaboration: crypto, protocol, room, chat, comments, versions, transports | collaboration.md |
| `extensions/` | Extension host, manifest validation, RPC, catalog | extensions.md |
| `customize/` | Shortcut keymap, schema, profiles, workspaces | customization.md |
| `i18n/` | Runtime, pure formatters, locales | i18n.md |
| `platform/` | Web and Tauri bridges, file types, pop-out, window controls | os-integration.md |

Other app folders: `app/styles/` (CSS, one file per area), `app/vendor/` (vendored Shoelace, fflate, polygon-clipping, CodeMirror bundle, KaTeX, pdf.js), `app/assets/`, `app/icons/`, `app/sw.js` and `app/manifest.webmanifest`.

## `tests/`

Suites: `core`, `vector`, `pixel`, `layout`, `web`, `git`, `publish`, `formats`, `office`, `ai`, `vibe`, `collab`, `extensions`, `extensions-bundled`, `customize`, `i18n`, `ui`, `packaging` and `docs` (this wiki). See [[Testing]].

## Important single files

| File | Why it matters |
| --- | --- |
| `app/src/platform/file-types.js` | Single source of truth for file types; a test keeps installers and the manifest in sync |
| `app/src/studios/registry.js` | The list of studios |
| `app/src/vibe/tools/index.js` | Tool registration and `TOOL_GROUPS` |
| `scripts/size-budget.json` | Size budgets enforced in CI |
| `scripts/version.mjs` | The only way to change the version |
| `src-tauri/tauri.conf.json` | Desktop configuration, CSP, bundle settings |

## Shared hot spots

`core/app.js`, `ui/shell.js`, `ui/menus.js`, `ui/settings-dialog.js`, `commands/index.js`, `vibe/tools/index.js`, `CHANGELOG.md` and `app/index.html` are touched by many changes: keep edits small and additive and put new code in new files ([[Git Workflow and Releases]]).

## See also

- [[Architecture Overview]]
- [[Development Setup]]
- [[Extending OpenFini]]
- [[Testing]]
