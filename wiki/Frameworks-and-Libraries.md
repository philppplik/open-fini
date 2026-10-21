# Frameworks and Libraries

OpenFini cannot run Node.js, so there is no `npm install`, bundler or dev server. "Framework support" means projects that run as they are: the sandboxed preview and the exported static site load ES modules, import maps and CDN runtimes directly in the browser. This page lists what that covers, the 13 starter templates, the library manager and offline use.

## What works without a build step

| Works | Does not work |
| --- | --- |
| Classic scripts, ES modules, import maps, dynamic `import()` | JSX, TypeScript compilation, `.vue` single-file components, Svelte, Sass, PostCSS |
| Libraries from jsDelivr, cdnjs and unpkg, or copied into `vendor/` | Packages that need Node APIs or a bundler |
| Web components, htm templates, Vue render functions, Alpine components, htmx attributes | Vue template strings and Alpine's standard build (they need `unsafe-eval`, which the desktop Content-Security-Policy forbids) |
| Tailwind through its browser build (prototypes) | Production Tailwind builds |
| Service workers and manifests in the exported site | Service workers in the preview (it is a sandboxed frame) |

The desktop app allows scripts from `self`, `data:`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com` and `unpkg.com`, and no `eval`; `esm.sh` is not allowed, so templates use jsDelivr's `+esm` builds. In the preview, import maps are applied by the preview itself (bare specifiers are rewritten); `scopes` are not applied. Check your own project against the desktop policy with `node scripts/serve.mjs --csp`.

## Starter templates

*File ▸ New ▸ Code* lists plain templates (Blank, Landing page, Portfolio, Blog, Documentation, Link in bio) and these starters:

| Template | Libraries (pinned, CDN) | Notes |
| --- | --- | --- |
| Tailwind CSS | `@tailwindcss/browser` 4.1 | Dark mode toggle; console warns it is not for production |
| Bootstrap 5 | Bootstrap 5.3 | Navbar, cards, accordion, modal, validated form |
| Alpine.js | `@alpinejs/csp` 3.14 | CSP build: use `Alpine.data()`; attribute expressions cannot assign |
| htmx | htmx 2.0 | `allowEval` off; a mock server in the page works offline |
| Vue 3 | `vue` 3.5 runtime | Components written with `h()` render functions |
| Preact + htm | `htm/preact/standalone` | Hooks and tagged templates |
| React | React 18, ReactDOM, htm | Hooks; htm instead of JSX |
| Lit | Lit 3 | Custom elements with reactive properties |
| Web components | none | Shadow DOM, slots, accessible tabs |
| Three.js | three r170 | Scene, lights, drag to rotate, reduced motion honored |
| Markdown blog | none | Posts in `content/posts/*.md`, layouts in `layouts/*.tmpl` |
| Markdown docs site | none | Sidebar from page titles and an "On this page" list |
| PWA starter | none | Manifest, service worker, install button; SVG icons only |

## The Libraries pane

Open **Libraries** from the activity bar or the palette. *Installed* lists scripts, stylesheets and import-map entries (check for updates, update, remove). *Popular* is a catalog of 25 pinned libraries (Tailwind, Bootstrap, icons, Alpine, htmx, Vue, React, Lit, Three.js, Chart.js, D3, GSAP, marked, Day.js, KaTeX, highlight.js and more) plus a Google Fonts helper. *Search* queries npm and cdnjs; choose a package, version and file, and whether to add it as a `<script>`, `<link>` or import-map entry. All edits go through the editor, so they are undoable.

### Download into project

Stores a library under `vendor/<package>@<version>/…`, rewrites its imports to relative paths and points the page at `./vendor/…`, so the exported site works offline. Limits: 80 files and 12 MB per library; only jsDelivr, cdnjs and unpkg hosts; source map comments removed. Licenses stay your responsibility.

### Offline mode

Every library request first asks the network policy for permission; with offline mode on you get the standard message and nothing is sent. Libraries already in the project keep working ([[Security and Privacy]]).

## Completions

Tailwind (about 6,000 utility names with variants such as `md:` and `dark:`) and Bootstrap 5.3 classes are suggested when the project uses that framework; Alpine and htmx attributes are completed; the Add panel offers Bootstrap components, Tailwind blocks and htmx patterns.

## Vibe

`list_templates`, `list_libraries`, `search_packages` and `add_library` (network, ask first), and `create_website` with any template id ([[Vibe Tools Reference]]).

## See also

- [[Code Studio]]
- [[Markdown and LaTeX]]
- [[Export and Publish]]
- [[Security and Privacy]]
