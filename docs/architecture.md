# Architecture

OpenFini is a static web application (`app/`) wrapped by two thin shells: a service worker (PWA) and a
Tauri window (desktop). Everything interesting is plain JavaScript modules — no framework, no build step in
development.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Shells      PWA (sw.js, manifest)           Tauri v2 (src-tauri, system WebView)│
├───────────────────────────────────────────────────────────────────────────────┤
│ Platform    platform/{web,tauri}.js  — files, dialogs, clipboard, launch files │
├───────────────────────────────────────────────────────────────────────────────┤
│ UI          ui/  shell · menus · toolbox · context bar · dock · panels ·       │
│             dialogs · canvas-view (viewport, rulers, overlays, input routing)  │
├───────────────────────────────────────────────────────────────────────────────┤
│ Studios     studios/  tool sets per studio (move, node, pen, brush, text, …)   │
│ Commands    commands/ menu/shortcut actions (edit, file, pixel, layout)        │
├───────────────────────────────────────────────────────────────────────────────┤
│ Core        core/  App (state hub) · Doc (model, undo) · nodes · ops ·         │
│             transform · snap · history · io · ofini · storage                  │
├───────────────────────────────────────────────────────────────────────────────┤
│ Engines     engine/dl.js  scene → display list (cached per node)               │
│  (pure,     engine/backends/{canvas,svg,pdf}.js                                │
│  testable)  engine/vector/  paths · booleans · curve fitting · SVG import      │
│             engine/pixel/   adjustments · filters · masks · retouch · liquify   │
│             engine/layout/  text model · line breaking · layout · PDF fonts    │
└───────────────────────────────────────────────────────────────────────────────┘
```

Dependencies only point **downwards**. The `engine/pixel`, `engine/layout` and `engine/backends/pdf.js`
modules never touch the DOM, so they run in the browser, in a Web Worker and in Node.js (that is how
they are unit-tested). The contracts between them are written down in
[engine-contracts.md](engine-contracts.md).

## The document model

A `Doc` owns pages (and master pages), a tree of **nodes** per page, shared assets, text **stories**,
styles, swatches and export slices.

```
Doc ── pages[]  ── root (group) ── children[] ── Node
    ├─ masters[]                                   ├ group | rect | ellipse | polygon | star | path
    ├─ stories{}   (rich text shared by frames)    ├ text | image | pixel | adjust
    ├─ assets{}    (images, original bytes)        └ common: m (matrix), opacity, blend, fx[], mask?, children?
    ├─ styles{paragraph, character}
    └─ slices[], swatches[], settings
```

* One **document, many studios**: any node type can live on any page, so a Layout page can hold vector
  shapes and pixel layers, and a Vector document can contain text frames.
* **Parametric shapes** (rectangle, ellipse, polygon, star) keep their parameters until they are converted
  to curves. Resizing folds the scale into the parameters so stroke weights are preserved
  ([`core/transform.js`](../app/src/core/transform.js)).
* **Nesting = clipping.** The children of a painted node are clipped to it (an image inside a frame);
  adjustment layers nested under a layer apply to that layer only.
* **Masks** are pixel nodes in the owner's local space, used as alpha.

### Edits and undo

Every change goes through a transaction (`doc.tx(label, fn)`). Primitive operations
(`set`, `insert`, `remove`, `move`, pixel edits, story edits, style edits, …) record an inverse operation
into the current transaction, so undo/redo is exact and cheap. Interactive tools mutate nodes live for
immediate feedback and call `doc.recordSet(...)` once on pointer-up, giving a single history step per drag.
Slider drags and typing use *coalescing keys* to merge into one entry. Pixel edits store only the dirty
rectangle before/after, and the history is capped by a **byte budget** that is lower in low-power mode.

## Rendering

```
 Node tree ──(dl.js, cached per node revision)──▶ Display list ──▶ Canvas 2D │ SVG │ PDF
```

The **display list** (DL) is a small, backend-neutral description: paths with fills and strokes, images,
text runs, groups (opacity, blend mode, clip, mask, effects) and adjustment items. It is expressed in
document units and independent of the zoom level, so panning and zooming never rebuild geometry.

* **Canvas backend** — draws paths directly, isolates groups only when needed (opacity, blend, effects,
  masks) using a pool of reusable offscreen canvases, applies adjustment items by running the pixel engine
  on the viewport region, and uses the browser's native shadow engine for drop shadows and glows.
* **SVG backend** — pure string output with gradients, clips, masks, blend modes and SVG filters.
* **PDF backend** — a compact PDF 1.7 writer with transparency groups, shadings, JPEG pass-through, and
  embedded fonts.
* Features a vector backend cannot express (live effects, masks, adjustments) are **rasterized per group**
  at export time; everything else stays vector.

### The viewport

`ui/canvas-view.js` renders pages into one canvas and tool overlays (selection handles, guides, marching
ants, snapping lines) into a second one. Pan and zoom are previewed with a **CSS transform of the already
rendered bitmaps** and the pixels are re-rendered once the gesture settles — scrolling costs nothing even
on slow devices.

## Text

Text is a **story** (paragraphs → runs with attributes) displayed by one or more **frames**. The layout
engine breaks lines (UAX #14-style rules, optional hyphenation), handles tabs, bullets, drop caps,
columns, exclusions and widow/orphan control, and flows a story through a chain of frames. The in-canvas
editor is a hidden `<textarea>` (for IME and clipboard) combined with caret, hit-testing and selection
geometry computed by the layout engine, so editing works identically across linked frames.

## Pixels

A pixel layer is a canvas. Painting uses a tile-based stroke engine
([`engine/brush.js`](../app/src/engine/brush.js)): each 256×256 tile touched by a stroke keeps a snapshot
of its original pixels and a stroke buffer, so *stroke opacity* is correct without copying the whole layer
and undo data is exactly the dirty rectangle. Selections are 8-bit masks (`engine/pixel/selection.js`)
with contour tracing for marching ants and conversion to curves. Retouching tools call per-dab operations
of the pixel engine on small patches.

## The Code studio

A document may carry a **website project** (`doc.web`, [`core/web.js`](../app/src/core/web.js)): a flat map of
files stored in the `.ofini` archive under `web/files/`. The workbench ([`ui/code/`](../app/src/ui/code)) is
loaded on first use. CodeMirror 6 holds one `EditorState` per file; the *files* are the single source of truth.
Visual tools never serialize a tree: they ask the pure web engine
([`engine/web/`](../app/src/engine/web), see [web-engine.md](web-engine.md)) for a minimal `Change[]` against the
current text and apply it through the editor (so undo, formatting and comments are untouched). The preview is a
double-buffered sandboxed `iframe`; an inspector injected into it reports clicks and computed styles with
`postMessage`. Details: [code-studio.md](code-studio.md).

## Packaging

* `scripts/build.mjs` copies `app/` to `dist/`, bundles and minifies the entry with esbuild (Shoelace stays
  unbundled and loads components on demand), hashes assets and writes the service-worker precache list.
* `src-tauri/` is a minimal Tauri v2 project: dialog, filesystem, opener and single-instance plugins and
  file associations for `.ofini`.
* GitHub Actions builds installers for Windows x64/ARM64, macOS Intel/Apple Silicon and Linux x64/ARM64.

See [decision records](adr) for the reasoning behind the main technology choices.
