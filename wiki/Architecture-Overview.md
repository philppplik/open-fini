# Architecture Overview

OpenFini is a static web application in `app/` (plain ES modules, no framework) wrapped by two thin shells: a service worker (PWA) and a Tauri v2 window (desktop). This page gives the layers, the rules that explain most of the code, the document model, rendering and the lazy-loading strategy. The authoritative detail is in the repository's `docs/architecture.md` and `docs/engine-contracts.md`.

## Layers

```text
Shells      PWA (sw.js, manifest)            Tauri v2 (src-tauri, system WebView)
Platform    platform/{web,tauri}.js   files, dialogs, clipboard, launch files
UI          ui/  shell, menus, toolbox, context bar, dock, panels, dialogs, canvas view
Studios     studios/  registry and tool sets          Commands  commands/  actions
Core        core/  App (state hub), Doc (model, undo), nodes, ops, transform, snap, history, io, ofini
Engines     engine/  dl.js (scene to display list), backends/{canvas,svg,pdf}, vector/, pixel/, layout/,
            formats/, office/, web/, git/, publish/   (pure, testable in Node)
Vibe        ai/ (pure runtime), vibe/ (hub, session, tools), ui/vibe/
```

Dependencies point only downwards. Engines never touch the DOM, so they run in the browser and in Node, which is how they are unit tested.

## Rules that explain most of the code

1. **Engines are pure:** no DOM, no `window`, no global `fetch` (`engine/*`, `ai/*`, and `core/*.js` modules documented as pure such as `log.js`, `network.js`).
2. **Everything a user can do is a command** with an id, registered in `app/src/commands/*`. Menus, shortcuts, the palette, context menus, extensions and the assistant go through commands or the same ops.
3. **Every document change is undoable** (`doc.tx(...)`, `doc.set(...)`); interactive tools mutate live and record once.
4. **Heavy things are lazy** (`import()`); CI enforces size budgets ([[CI and Size Budgets]]).
5. **Everything user-visible is translatable** (`t("English text")`, [[Internationalization]]).
6. **Security by construction:** untrusted code (extensions, custom tools, website previews) only runs in sandboxed frames; outbound network goes through `app.network.assert(kind)`; secrets never enter documents or logs.

## Document model

A `Doc` owns pages and master pages, a tree of nodes per page, shared assets, text stories, styles, swatches and slices.

```text
Doc  pages[]   root (group)   children[]   Node (group, rect, ellipse, polygon, star, path, text, image, pixel, adjust, table, chart)
     masters[], stories{}, assets{}, styles{paragraph, character}, slices[], swatches[], settings
```

Parametric shapes keep their parameters until converted; nesting equals clipping; masks are pixel nodes in the owner's space. Edits go through transactions that record inverse operations, so undo and redo are exact; pixel edits store only dirty rectangles; history is capped by a byte budget.

## Rendering

Nodes compile into a **display list** of paths, images, text runs and groups, cached per node revision and independent of zoom ([ADR 0005](https://github.com/philppplik/open-fini/blob/main/docs/adr/0005-display-list.md)). Backends (Canvas 2D, SVG, PDF) consume only the display list, so what you see is what exports. Groups are isolated into pooled offscreen canvases only when opacity, blend mode, masks or effects require it ([ADR 0002](https://github.com/philppplik/open-fini/blob/main/docs/adr/0002-canvas2d-rendering.md)). Panning and zooming move a composited bitmap and re-render when the gesture settles.

## Studios and the registry

`app/src/studios/registry.js` is the single list of studios; one `registerStudio({...})` call defines id, label, icon, workspace and tools, and derives the header, the *More* menu, the Studio menu, `studio.<id>` commands, welcome cards and `Alt+N` shortcuts.

## Vibe

The pure AI runtime (providers, agent loop, MCP, RAG, skills, vault) is in `app/src/ai/`. OpenFini's tools are in `app/src/vibe/tools/`. A hub in `app/src/vibe/hub.js` runs several chats with a fair document write lock and tag-based run undo ([ADR 0008](https://github.com/philppplik/open-fini/blob/main/docs/adr/0008-vibe-hub.md)).

## Desktop shell

`src-tauri/` holds the Rust shell (Tauri 2). The frontend uses no Tauri npm packages: `app/src/platform` talks to the injected globals, so the same code runs in a plain browser ([ADR 0001](https://github.com/philppplik/open-fini/blob/main/docs/adr/0001-desktop-shell-tauri.md)).

## Build

Development serves `app/` as is (`npm start`). `npm run build` bundles each module script of `app/index.html` with esbuild (ES2022, code splitting at `import()`), hashes assets, writes the service worker precache and copies the extension packages to `dist/` ([[Development Setup]], [[CI and Size Budgets]]).

## See also

- [[Repository Map]]
- [[Extending OpenFini]]
- [[Decision Records]]
- [[Testing]]
