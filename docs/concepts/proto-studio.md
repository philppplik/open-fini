# Proto Studio: concept and build plan

Status: proposed design, not built. Decision record: [ADR 0034](../adr/0034-proto-studio.md). Target: the 1.3.x
releases. This page is the reference for the people (and agents) who build it: what Proto is, how its document is
shaped, how it renders, how agents, the CLI, the Code studio and collaboration reach it, and the task list.

## Contents

1. [Vision](#1-vision)
2. [Competitive analysis](#2-competitive-analysis)
3. [Document model](#3-document-model)
4. [Rendering](#4-rendering)
5. [Tools, modes and panels](#5-tools-modes-and-panels)
6. [Prototyping and the player](#6-prototyping-and-the-player)
7. [AI: Vibe tools](#7-ai-vibe-tools)
8. [MCP server and client](#8-mcp-server-and-client)
9. [CLI](#9-cli)
10. [Code export, code import and the Code studio link](#10-code-export-code-import-and-the-code-studio-link)
11. [Imports and the `.fig` question](#11-imports-and-the-fig-question)
12. [File format](#12-file-format)
13. [Collaboration](#13-collaboration)
14. [Security](#14-security)
15. [Build plan](#15-build-plan)
16. [Open questions](#16-open-questions)
17. [Sources](#17-sources)

## 1. Vision

**Proto is where application interfaces are designed, prototyped and handed to code, by people and agents together,
in a document whose meaning is CSS.**

* **Design.** Frames on an infinite canvas, auto layout (flex) and grid layout, constraints, components with
  variants and properties, instances with overrides, variables with modes (light and dark, brands, densities), text
  and effect styles. The feature set of a modern UI design tool, not an illustration tool.
* **Prototype.** Interactions on any layer, flows, overlays, scrolling and fixed layers, variables and conditions
  for state, smart animate. A player in its own window, shareable in a collaboration room, exportable as a single
  HTML file.
* **Agent-native.** The Vibe assistant creates frames and components from a prompt, a screenshot or a URL, edits
  them, checks them (contrast, touch targets, unbound values) and generates code. External agents (Claude Code,
  Cursor, Codex) reach the same document through an MCP server. The assistant inside the app can call other MCP
  servers (a code base, a component library, an icon set).
* **Code-native.** What the canvas shows is what the browser does, because the canvas *is* the browser's layout
  engine. Export to HTML + CSS, React, Tailwind and SwiftUI; import HTML; share a `tokens.json` and components with
  the Code studio.
* **Terminal-native.** `ofini proto` exports code, tokens and assets, lints, renders and serves MCP over stdio, so CI
  can check a design system the way it checks code.
* **Together from day one.** Live editing, cursors, comments on layers and follow mode through the existing
  end-to-end encrypted rooms. No account, no server of ours.
* **Open.** The document is versioned JSON inside `.ofini`, tokens are W3C DTCG JSON, exports are plain files.
  Nothing is locked in.

Non-goals for 1.3.x: whiteboarding (the Whiteboard app covers it), print layout (Layout studio), illustration depth
(Vector studio: Proto embeds SVG from it), hosting websites (Code studio publishing covers it), a plug-in API of its
own (extensions reach Proto through the operation layer later).

## 2. Competitive analysis

State as of November 2026, from public product pages, documentation and reviews (see [Sources](#17-sources)).
Observation of public behavior only, as the clean-room policy requires.

| | Figma | Penpot | Paper | Sketch | **Proto (plan)** |
| --- | --- | --- | --- | --- | --- |
| Platform | Browser + desktop wrapper, cloud files | Browser, self-hostable server | Browser + desktop app | macOS app, web workspace | Browser, PWA, desktop (Windows, macOS, Linux), offline |
| License | Proprietary | Open source (MPL-2.0) | Proprietary | Proprietary | Open source (MIT) |
| File format | `.fig`, undocumented | Open; export as ZIP of JSON and assets | HTML and CSS in the app | `.sketch`, documented ZIP + JSON | `.ofini` (ZIP + JSON), documented |
| Canvas | Own WebGL/WASM renderer | SVG, moving to a WASM renderer | Real HTML and CSS | Native Metal renderer | Real HTML and CSS (DOM) |
| Layout | Auto layout (flex), wrap, grid auto layout, constraints | Flex and CSS grid layout | CSS flex and grid | Stacks, Smart Layout | Flex, CSS grid, constraints |
| Components | Components, variants, properties (text, boolean, instance swap), slots | Components, variants | Components (early) | Symbols, overrides, variants | Components, variants, properties incl. instance swap and slots |
| Variables / tokens | Variables with modes and extended collections; styles | Design tokens (DTCG-compatible) | CSS variables | Color variables, shared styles | Variables with modes and extending collections, styles as composite tokens, DTCG in and out |
| Prototyping | Rich: smart animate, variables, conditionals, overlays, scroll | Interactions, flows, overlays | Basic | Links, overlays, flows | Interactions, overlays, scroll, variables, conditions, smart animate |
| Dev handoff | Dev Mode, Code Connect, code snippets | Inspect panel with CSS and SVG | Export React/Tailwind | Inspect in the web app | Inspect mode, code panel, export HTML/CSS/React/Tailwind/SwiftUI, Code studio link |
| AI / agents | Figma AI, Make; MCP server, write to canvas (beta) | Official MCP server (Plugins API) | Agents edit the canvas over MCP | Local MCP server (port 31126) | Built-in assistant with the same tool set as a local MCP server; MCP client |
| CLI | None (REST API) | None (API) | None | `sketchtool` (macOS) | `ofini proto …` on Linux, macOS, Windows |
| Collaboration | Real time, cloud | Real time, server | Real time | Web workspace | Real time, end-to-end encrypted, relay without accounts |

**What we take.** Figma's model of components with properties and variables with modes is the industry vocabulary;
designers expect it, so Proto uses the same concepts under CSS names. Penpot's insistence that layout *is* CSS flex
and grid. Paper's proof that a DOM canvas is fast enough and makes agents productive (agents write HTML well).
Sketch's local-only MCP server and fixed, documented file format.

**What we do differently.** One operation layer for the editor, the assistant, the MCP server and the CLI (no
second-class API). Local-first and end-to-end encrypted collaboration. A terminal workflow for design systems. Export
that matches the canvas exactly. Everything in one suite: SVG from Vector, images from Pixel, the code in Code, the
deck in Presentation.

**Where we will be weaker** (honest list): very large files (tens of thousands of visible layers) render slower
than a WebGL engine; no plug-in ecosystem; no community file library; `.fig` files must come in through SVG or the
REST API.

## 3. Document model

Pure modules in `app/src/engine/proto/` (no DOM). The model is one immutable JSON value; every change goes through
`ops.js` and returns a new value with structural sharing, so unchanged nodes keep their identity (the renderer and the
collaboration diff rely on that).

### 3.1 Top level

```json
{
  "schema": 1,
  "meta": { "title": "Checkout", "created": "2026-12-01T10:00:00Z", "unit": "px", "app": "OpenFini 1.3.0" },
  "pages": {
    "p1": { "id": "p1", "name": "Screens", "ord": "V", "bg": "#f4f4f5", "flows": [{ "id": "f1", "name": "Checkout", "start": "n1" }] },
    "p2": { "id": "p2", "name": "Components", "ord": "k", "bg": "#ffffff" }
  },
  "nodes": { "n1": { "…": "see 3.2" } },
  "vars": { "collections": {}, "items": {} },
  "styles": {},
  "breakpoints": [{ "id": "base", "w": 1280 }, { "id": "md", "w": 991 }, { "id": "sm", "w": 478 }],
  "code": { "links": {}, "tokensFile": null },
  "media": {}
}
```

* **Flat node map.** `nodes` maps id to node; each node has `parent` (a node id, or `null` for a top-level node on
  its `page`) and `ord`, a fractional order key (`collab/fractional.js`: base-62 digits that never end in `0`, so the
  first key is `"V"`, not `"a0"`; equal keys sort by id). A flat map makes lookups O(1), makes moves a
  two-field change, and maps one to one onto collaboration records. Children lists are derived (cached per revision).
* **Ids** are short random strings (`n` + 8 base-36 characters), unique per document, never reused.
* **Unknown fields are kept.** Readers preserve fields they do not know (forward compatibility within a schema).
* **Schema version.** `schema` is an integer. `migrate.js` upgrades older models step by step; a model with a newer
  schema opens read-only with a notice. `validate.js` checks types, references (parent, component, variable, media),
  cycles and limits, and is used on open, on import, on every MCP write and on every remote collaboration record.

### 3.2 Nodes

Common fields:

```json
{
  "id": "n7", "type": "frame", "name": "Card", "page": "p1", "parent": "n1", "ord": "a3",
  "visible": true, "locked": false, "opacity": 1, "blend": "normal",
  "x": 24, "y": 120, "rot": 0,
  "w": { "mode": "fill", "min": 240, "max": 480 },
  "h": { "mode": "hug" },
  "pos": "flow",
  "cx": "leftRight", "cy": "top",
  "tag": "article",
  "a11y": { "label": "Product card", "role": null },
  "modes": { "c1": "dark" },
  "proto": []
}
```

| Field | Meaning | CSS meaning |
| --- | --- | --- |
| `type` | `frame`, `rect`, `ellipse`, `line`, `vector`, `text`, `image`, `instance`, `component`, `componentSet`, `slot` | element kind |
| `w`, `h` | `{ mode: "fixed", value }`, `{ mode: "hug" }`, `{ mode: "fill" }`, `{ mode: "rel", value: 0.5 }`, plus `min`, `max` | `width: 320px` / `fit-content` / `flex: 1 1 0` or `align-self: stretch` / `50%`; `min-width`, `max-width` |
| `pos` | `flow` (laid out by the parent's flex or grid) or `abs` (positioned) | `position: relative` / `absolute` |
| `x`, `y` | position relative to the parent (top-left, unrotated); for flow children it is derived and stored for the overview only | `left` / `top` (abs) |
| `cx`, `cy` | constraints of `abs` children: `left`, `right`, `leftRight`, `center`, `scale` (and `top`, `bottom`, `topBottom`, `center`, `scale`) | `left` / `right` / both / `left: calc(50% + d)` + `translate` / percentages |
| `rot` | rotation in degrees around the center | `transform: rotate()` |
| `tag`, `a11y` | semantic element and accessibility name/role for code export; never affects the canvas | HTML element, `aria-label`, `role` |
| `modes` | variable mode per collection for this subtree | `data-mode-<collection>` attribute that switches custom properties |

**Containers** (`frame`, `component`, `instance` roots) add:

```json
{
  "layout": {
    "type": "flex", "dir": "row", "wrap": false, "gap": 8, "rowGap": 8,
    "pad": [16, 16, 16, 16],
    "align": "center", "justify": "space-between", "alignContent": "start",
    "reverseZ": false
  },
  "clip": true,
  "scroll": "none"
}
```

* `layout.type`: `none` (children are `abs`, like a classic artboard), `flex`, or `grid`.
* Grid: `"grid": { "cols": [{ "fr": 1 }, { "px": 240 }, { "auto": true }, { "minmax": [200, { "fr": 1 }] }], "rows": [...], "areas": null, "autoFlow": "row", "dense": false }`
  and on children `"cell": { "col": 1, "colSpan": 2, "row": 1, "rowSpan": 1, "alignSelf": "start", "justifySelf": "stretch" }`
  (omitted = auto-placed). Exactly the CSS grid concepts, minus named lines in schema 1.
* `pad`, `gap` and every numeric or color value may be a **binding** `{ "$var": "v12" }` instead of a literal
  (see 3.4). Spacing tokens therefore survive into code as `var(--space-4)`.
* `scroll`: `none`, `x`, `y`, `both` (prototype overflow behavior); children may set `"sticky": "top"` (fixed while
  scrolling).

**Appearance** (all visual nodes):

```json
{
  "fills": [
    { "type": "solid", "color": { "$var": "v1" }, "opacity": 1 },
    { "type": "linear", "angle": 135, "stops": [{ "at": 0, "color": "#6366f1" }, { "at": 1, "color": "#a855f7" }] },
    { "type": "image", "media": "m3", "fit": "cover", "pos": [0.5, 0.5] }
  ],
  "strokes": [{ "color": "#e4e4e7", "w": 1, "align": "inside", "dash": null, "sides": [1, 1, 1, 1] }],
  "radius": [12, 12, 12, 12],
  "effects": [{ "type": "shadow", "x": 0, "y": 4, "blur": 16, "spread": -2, "color": "#0000001f" }],
  "style": { "fill": "s4", "effect": "s9" }
}
```

Fills map to `background` layers (gradients: `linear-gradient`, `radial-gradient`, `conic-gradient`), strokes to
`border` (inside, uneven sides) or `outline` / `box-shadow` (center, outside), effects to `box-shadow`, `filter: blur()`
and `backdrop-filter`. Anything the CSS mapping cannot express is not in the schema; that is the rule that keeps the
canvas and the export identical.

**Text:**

```json
{
  "type": "text",
  "text": {
    "runs": [{ "t": "Total ", "s": {} }, { "t": "$42.00", "s": { "weight": 700 } }],
    "style": { "font": "Inter", "size": 16, "weight": 400, "lineHeight": { "pct": 150 }, "tracking": 0, "align": "left", "case": "none", "decoration": "none", "color": { "$var": "v3" } },
    "autoSize": "height",
    "maxLines": null
  },
  "style": { "text": "s2" }
}
```

`autoSize`: `width` (hug), `height` (fixed width, wraps), `fixed`; `maxLines` → `-webkit-line-clamp`. Text content can
be bound to a string variable or a component text property.

**Vector and image:** `vector` stores SVG path data (`d`, fill rule) in its own box and renders as inline SVG; it is
where boolean results, icons and drawings from the Vector studio land. `image` is a frame with one image fill and
`"alt"`; media bytes live in `media` (the `doc.office` media contract).

### 3.3 Components, variants, properties, instances, overrides

```json
{
  "n20": { "id": "n20", "type": "componentSet", "name": "Button", "props": {
      "size": { "type": "variant", "options": ["sm", "md", "lg"], "default": "md" },
      "state": { "type": "variant", "options": ["default", "hover", "disabled"], "default": "default" },
      "label": { "type": "text", "default": "Button" },
      "icon": { "type": "swap", "default": "n90", "preferred": ["n90", "n91"] },
      "showIcon": { "type": "bool", "default": false },
      "content": { "type": "slot" }
    } },
  "n21": { "id": "n21", "type": "component", "parent": "n20", "variant": { "size": "md", "state": "default" }, "bind": { "n22.text": "label", "n23.visible": "showIcon", "n23.of": "icon" } },
  "n50": { "id": "n50", "type": "instance", "of": "n20", "variant": { "size": "lg" }, "props": { "label": "Pay now" }, "over": { "n22": { "fills": [{ "type": "solid", "color": "#ffffff" }] } } }
}
```

* A `component` is a container; a `componentSet` groups variants and declares the properties. A single component
  without variants may declare `props` itself.
* Property types: `variant` (one axis of the set), `text`, `bool`, `swap` (instance swap, with preferred
  components), `number`, `slot` (a container whose children the instance provides; exported as `children` or a
  named React prop).
* `bind` connects properties to fields inside the component (`<nodeId>.<field>`).
* An `instance` references the set or component (`of`), picks variant values, sets property values and stores
  overrides in `over`, keyed by the **path of source node ids** (`"n22"`, or `"n31/n22"` through nested instances).
  Paths stay valid when the main component's other layers change; overrides of removed layers are kept but
  inactive and reported by lint.
* Instances are **not expanded in storage.** `resolve.js` expands an instance into a virtual subtree (cached by the
  identity of the component, the instance and the variables) for rendering, hit testing, export and agents.
  Detaching an instance is an operation that materializes that subtree.
* Remote components (from another `.ofini` file or a library) are a later step; schema 1 reserves
  `"of": "lib:<libraryId>/<componentId>"`.

### 3.4 Variables, modes and styles

```json
{
  "vars": {
    "collections": {
      "c1": { "name": "Color", "modes": [{ "id": "light", "name": "Light" }, { "id": "dark", "name": "Dark" }], "default": "light" },
      "c2": { "name": "Brand B", "extends": "c1", "modes": [{ "id": "light", "name": "Light" }, { "id": "dark", "name": "Dark" }] },
      "c3": { "name": "Space", "modes": [{ "id": "base", "name": "Base" }] }
    },
    "items": {
      "v1": { "name": "color/bg/surface", "coll": "c1", "type": "color", "values": { "light": "#ffffff", "dark": "#18181b" }, "scopes": ["fill"], "code": { "css": "--color-bg-surface" } },
      "v2": { "name": "color/brand", "coll": "c1", "type": "color", "values": { "light": "#4f46e5", "dark": { "$var": "v7" } } },
      "v9": { "name": "space/4", "coll": "c3", "type": "number", "unit": "px", "values": { "base": 16 } }
    }
  },
  "styles": {
    "s2": { "name": "Body/Regular", "kind": "text", "value": { "font": "Inter", "size": 16, "weight": 400, "lineHeight": { "pct": 150 } } },
    "s9": { "name": "Elevation/2", "kind": "effect", "value": [{ "type": "shadow", "x": 0, "y": 4, "blur": 16, "spread": -2, "color": { "$var": "v12" } }] }
  }
}
```

* Types: `color`, `number` (with an optional unit: `px`, `%`, `ms`, none), `string`, `bool`. Values per mode may alias
  another variable. Aliases must not form cycles (validated).
* **Extending collections** (`extends`) override some values of a base collection for a brand or theme, the way
  Figma's extended collections and DTCG theming work.
* **Mode resolution** walks up from a node to the first ancestor with `modes[coll]`, then the page, then the
  collection's default. In CSS this is exactly the cascade of custom properties: the renderer and the exporter emit
  `:root` values for defaults and `[data-mode-color="dark"]` rules for other modes.
* **Styles are composite tokens** (typography, shadow, gradient, grid). Nodes reference them (`style.text`); local
  edits detach the field, which lint reports.
* **DTCG interchange** (`tokens.js`): variables and styles export to and import from Design Tokens Community Group JSON
  (`$value`, `$type`, aliases `{color.brand}`, groups from the `/`-separated names, modes as one file per mode or as
  `$extensions["org.openfini.modes"]`). Round trip is tested.

### 3.5 Prototype data

Stored on nodes (`proto`) and pages (`flows`); described in [section 6](#6-prototyping-and-the-player).

### 3.6 Limits

Validated on open, import, MCP and collaboration: 200,000 nodes per document, 64 KiB per record value (collaboration
limit), nesting depth 64, 64 options per variant property, 2,000 variables per collection, 20 modes per
collection, 16 MiB per media item (the `.ofini` limits apply on top).

## 4. Rendering

### 4.1 Architecture

```
model ──resolve.js──▶ resolved tree (instances expanded, variables bound per mode)
                        │
                        ├─ css.js ──▶ declarations per node ──▶ view.js: keyed DOM in a shadow root per top-level frame
                        │                                    └─▶ codegen (same declarations)
                        └─ layout.js (pure solver, Node only: CLI render, lint, headless MCP)

DOM ──measure.js──▶ geometry cache (boxes in canvas space) ──▶ hit testing, snapping, overlay, agents
overlay.js: one Canvas 2D layer above the stage: selection, handles, guides, redlines, padding and gap handles, remote cursors
```

* **`css.js` is the single source of CSS.** It turns a resolved node into a list of declarations (`width`,
  `display: flex`, `gap`, `background`, …) with variable references kept as `var(--…)`. The renderer applies them
  with `style.setProperty` (never `innerHTML`); the exporter prints them. A test asserts that both see the same
  declarations for every fixture.
* **Stage.** The canvas is a positioned world element transformed by `translate() scale()`. Each top-level frame
  is a host element with its own shadow root holding the frame's subtree and a small reset stylesheet plus the
  variable rules. Shadow roots isolate the design from the app's CSS (Shoelace, themes) and give each frame its own
  style scope; they cost far less than one iframe per frame. Free-floating layers on the page (not in a frame) live
  in one extra root.
* **Keyed incremental patching.** Each node id has one element. After a commit, the view compares node objects by
  identity (the model shares structure) and patches only changed elements: changed declarations, moved or
  reordered children, added and removed nodes. No virtual DOM library.
* **Geometry.** After patching, `measure.js` reads `getBoundingClientRect` for the changed subtrees only
  (batched in one read phase per frame, inside `requestAnimationFrame`, so there is no layout thrashing) and converts
  boxes into canvas coordinates. A `ResizeObserver` on frame hosts catches reflow caused by fonts loading. Hit
  testing, marquee selection, snapping and the overlay use this cache, not the DOM.
* **Text editing** happens in place in a `contenteditable` element that replaces the text node's element while
  editing (plain text with runs; paste is sanitized to text), committing runs on blur or Escape.
* **Fonts.** Fonts come from `core/fonts.js` (bundled Inter, system fonts, fonts added to the document as media).
  Exports list the fonts they need; nothing is fetched from the network without the network policy allowing it.

### 4.2 Zoom, pan, culling and level of detail

* **Pan and zoom** change only the world transform. While a gesture is active the stage has `will-change:
  transform` (GPU scaling of the existing raster, very fast); 150 ms after the gesture ends it is removed so the
  browser re-rasterizes crisp text at the new scale.
* **Culling.** Frames whose box is outside the viewport plus a margin get `content-visibility: hidden` (layout and
  paint skipped, state kept). Frames far outside are detached from the DOM after 10 s and re-attached on approach.
* **Level of detail.** Below 25 % zoom, frames whose on-screen size is under 160 px render as their cached geometry:
  a box with the fill and blocks for text lines, drawn on the overlay canvas. Below 5 %, frames are drawn as filled
  rectangles with their names. The DOM of those frames is detached.
* **Prototype player** renders with the same `view.js`, without overlay and without editing affordances.

### 4.3 Performance targets

Measured by `tests/proto/perf/` on a generated fixture in Chromium (CI) and by hand in WebView2, WKWebView and
WebKitGTK before each release. Reference machine: a 2020 mid-range laptop (4 cores, integrated GPU).

| Scenario | Target |
| --- | --- |
| Pan and zoom, 50 frames and 5,000 visible nodes | 60 fps (p95 frame time ≤ 16.7 ms) |
| Pan and zoom, 200 frames and 20,000 nodes, level of detail active | ≥ 30 fps |
| Hover highlight and selection change | ≤ 8 ms |
| Property edit (padding, fill) to painted frame, 10,000-node document | p95 ≤ 50 ms |
| Drag-resize an auto layout container with 500 children | ≥ 30 fps |
| Open a 10,000-node document (warm cache) to first paint | ≤ 1.5 s |
| Memory, 10,000-node document | ≤ 300 MB for the tab |
| Smart animate in the player, 200 matched layers | 60 fps |
| Start-up bundle growth | ≤ 1 KiB gzip (studio definition and menu rows) |
| Lazy Proto code over 1.3.x | ≤ 160 KiB gzip in total, budgeted per task in `scripts/size-budget.json` |

### 4.4 The pure solver (`layout.js`)

Used where there is no browser: `ofini proto render` (SVG), `ofini proto lint` (overlaps, overflow, touch target
sizes), and headless MCP (`proto_get_geometry`). It implements the CSS flex algorithm (single and multi-line,
grow, shrink, min/max, alignment), grid track sizing for `px`, `fr`, `auto` and `minmax`, absolute positioning with
constraints, and text boxes measured with `engine/layout/measurers.js ▸ approxMeasurer` (AFM metrics). Results carry
`approximate: true`. Conformance tests compare it to geometry recorded from Chromium for every fixture; tolerance
1 px for boxes without text, and a documented tolerance for text.

## 5. Tools, modes and panels

### 5.1 Modes

* **Design** — editing (default).
* **Prototype** — connections, interactions and flows on the canvas; the Prototype panel replaces the Design panel.
* **Inspect** — read-only handoff: redlines on hover, the Code panel, measurements, tokens per value, asset export.
  Also the default for viewers in a room who were given view rights.

### 5.2 Tools

| Tool | Key | Notes |
| --- | --- | --- |
| Move / select | V | Click, Shift-click, marquee, Ctrl/Cmd-click selects deep, Enter selects children, Shift+Enter the parent; drag in auto layout reorders with an insertion line; Alt-drag duplicates |
| Scale | K | Scales a subtree including text sizes, strokes and effects |
| Frame | F | Draw, or choose a device preset (phone, tablet, desktop, watch, custom presets) |
| Rectangle, Ellipse, Line | R, O, L | |
| Pen | P | Reuses `engine/vector/path.js`; creates a `vector` node |
| Text | T | Click for auto width, drag for fixed width |
| Image | Shift+Ctrl/Cmd+K | Place images as image frames; also drop and paste |
| Hand | H, Space | |
| Comment | C | Pins anchored to layers (see 13) |
| Connect | (Prototype mode) | Drag from a layer to a frame to create a navigate interaction |
| Measure | Alt (hold) | Redlines between the selection and the hovered layer |
| Ask Vibe | / | Inline prompt bar on the canvas that sends the selection as context |

**Auto layout shortcuts.** Shift+A wraps the selection in a flex frame (direction guessed from positions);
Ctrl/Cmd+Alt+G wraps in a grid; padding and gap are adjustable by dragging handles on the canvas; Alt while
resizing a child switches between hug, fill and fixed. **Smart selection** (several equal siblings) adjusts spacing
for all of them.

**Snapping.** To pixel grid, layout grids, sibling edges and centers, equal spacing, and (with Shift) 15° angles.
Snap lines come from the geometry cache.

### 5.3 Panels

All panels are dockable through the docking engine (ADR 0033); `studios/proto.js` declares `essentials` presets.

| Panel | Default dock | Contents |
| --- | --- | --- |
| Pages | left, top | Pages, flows (jump to a flow's start frame) |
| Layers | left | Tree of the page, type icons, lock and hide, rename, drag to reorder and reparent, search |
| Assets | left (tab) | Components and sets of this document and linked libraries, styles, variables, icons; drag to insert |
| Design | right | Position, sizing (fixed/hug/fill/rel with min and max), constraints, auto layout or grid, appearance, fills, strokes, effects, text, export settings, variable binding on every field (a small button opens the variable picker) |
| Prototype | right (Prototype mode) | Interactions of the selection, flow starting points, scroll and sticky, overlay settings |
| Variables | bottom or floating | Collections as tables (rows variables, columns modes), alias picker, scopes, code names, import and export DTCG |
| Code | right (Inspect mode), dockable anywhere | Live code of the selection (HTML+CSS, React, Tailwind, SwiftUI), copy, "Export…", "Open in Code" |
| Comments | right (tab) | Threads of the document (existing comments host) |
| Vibe | right (tab) | The assistant (existing panel), with Proto skills |
| History | floating | Undo history and named versions (existing) |

## 6. Prototyping and the player

### 6.1 Model

```json
"proto": [
  { "on": { "type": "click" }, "do": [{ "act": "navigate", "to": "n40", "tr": { "type": "smart", "dur": 300, "ease": "ease-out" } }] },
  { "on": { "type": "hover" }, "do": [{ "act": "variant", "set": { "state": "hover" }, "tr": { "type": "smart", "dur": 150, "ease": { "spring": [1, 300, 20] } } }] },
  { "on": { "type": "key", "key": "Escape" }, "do": [{ "act": "closeOverlay" }] },
  { "on": { "type": "afterDelay", "ms": 2000 }, "do": [{ "act": "if", "cond": { "var": "v30", "op": "==", "value": true }, "then": [{ "act": "navigate", "to": "n41" }], "else": [] }] }
]
```

* **Triggers:** `click`, `doubleClick`, `press` (while pressed), `hover` (while hovering), `mouseEnter`,
  `mouseLeave`, `drag`, `key` (with modifiers), `afterDelay`, `variableChange`.
* **Actions:** `navigate`, `back`, `scrollTo`, `openOverlay` (position, background dim, close on outside click),
  `swapOverlay`, `closeOverlay`, `variant` (change the instance's variant), `set` (variable), `if` (condition with
  `then` and `else`), `openUrl` (through the app's external link confirmation), `media` (play/pause a video fill,
  later).
* **Conditions and expressions** are a tiny data language (`==`, `!=`, `<`, `>`, `and`, `or`, `not`, arithmetic,
  string concatenation), evaluated by a pure interpreter; never `eval`, never `Function`.
* **Transitions:** `instant`, `dissolve`, `moveIn`, `moveOut`, `push`, `slide` (with direction), `smart`;
  easing `linear`, the CSS keywords, `cubic-bezier`, or `spring [mass, stiffness, damping]` (sampled into a
  `linear()` easing).
* **Smart animate** matches layers of the outgoing and incoming frames by source id (instances of the same
  component), then by name path. The player uses the FLIP technique: measure both states in the DOM, render the
  target, animate transforms, opacity, colors, radius and size with the Web Animations API. Unmatched layers fade.
  This is natural for a DOM renderer and is one reason for that choice.

### 6.2 Player

* **Preview window**: a separate OS window on the desktop (multi-window), a new tab in the browser; device frame
  (optional), scale to fit, restart, flow picker, hotspot hints on misclicks, keyboard shortcuts (R restart, arrows
  between flows), the current frame's comments.
* **Present in a room**: the presenter's player state (frame, overlay stack, variables) travels as presence data;
  followers see the same screen and can take control.
* **Export as HTML**: `ofini proto export --target prototype` or *File ▸ Export ▸ Prototype (HTML)* writes one
  self-contained HTML file (resolved frames, the player runtime of a few KiB, media as data URIs or a folder),
  viewable offline in any browser. No analytics, no external requests.

## 7. AI: Vibe tools

Group **Proto** in `vibe/tools/proto.js` (static definitions; logic loads on first call). Every write tool is one undo
step ("Vibe: …") through `ops.js`. Each tool lands with the task that provides its capability (section 15). Names
match the MCP tools (section 8) where they overlap, so skills and prompts
work in both places.

| Tool | Kind | What it does |
| --- | --- | --- |
| `proto_describe` | read | Compact outline of the active document or a subtree: pages, frames, one line per node (id, type, name, size mode, layout, key styles, bindings), components and variants, variables summary |
| `proto_get_node` | read | Full JSON of nodes (resolved or raw) |
| `proto_screenshot` | read | PNG of a node or frame at a scale, for the model to look at |
| `proto_search` | read | Find nodes by name, text, type, component, variable use, unbound values |
| `proto_create` | write | Create nodes from a compact JSON spec (nested, with layout, styles, variable names) under a parent |
| `proto_write_html` | write | Create nodes from HTML + CSS (agents write HTML fluently); runs the HTML importer (10.4) |
| `proto_update` | write | Patch fields of nodes (layout, sizing, fills, text, bindings, name, tag, a11y) |
| `proto_move` / `proto_delete` / `proto_duplicate` | write | Structural edits, reorder, reparent, wrap in auto layout or grid |
| `proto_component` | write | Make component, combine as variants, add properties, bind fields, create instances, set variant and properties, reset or detach |
| `proto_variables` | write | Create collections, modes, variables, aliases; set values; bind fields; switch a frame's mode |
| `proto_styles` | write | Create and apply text, effect and fill styles |
| `proto_interaction` | write | Add, change or remove interactions and flows |
| `proto_from_screenshot` | write | Places the image as a locked reference layer, extracts a palette and text (engine registry OCR where available) as hints; the model then builds with `proto_create` / `proto_write_html` and checks with `visual_diff` |
| `proto_lint` | read | Contrast (WCAG), touch target size, unbound colors and spacings, detached styles, overrides of removed layers, empty frames, naming, overflowing text (`engine/proto/lint.js`, machine-applicable fixes) |
| `proto_fix` | write | Applies lint fixes |
| `proto_to_code` | read | Generated code for a node and target (10.1) |
| `proto_tokens` | read/write | Export or import DTCG tokens; sync with the linked tokens file |
| `proto_responsive` | read | Resizes a frame to breakpoints and reports overflow and clipped text |
| `proto_content` | write | Fills text layers with realistic content (names, prices, dates) or data from a sheet range |
| `proto_rename` | write | Semantic layer names and `tag` values (button, nav, h1…) for better code |

Skills (lazy skill pack `proto`): *design a screen from a brief*, *screenshot to editable design*, *build a component
with variants*, *set up tokens and dark mode*, *prototype a flow*, *prepare for handoff*, *design system audit*.
Existing tools combine with these: `visual_diff`, `run_script` (code mode), `plan_work` (orchestration), image
generation for placeholder art, Office sheet data for content.

**From a screenshot.** The assistant sees the image (vision model), calls `proto_from_screenshot` for reference and
hints, writes the structure with auto layout as HTML or JSON, then compares `proto_screenshot` with the reference
through `visual_diff` and corrects. Layers come out editable, with auto layout, not as one flat image.

## 8. MCP server and client

### 8.1 Server design

`engine/proto/mcp/` is a transport-neutral handler: `handle(jsonRpcMessage, session) → response | notifications`.
It implements the MCP 2025-11-25 lifecycle (initialize, capabilities, ping), `tools/list`, `tools/call`,
`resources/list`, `resources/read`, `resources/subscribe` and `prompts/list` / `prompts/get`. Tools call `ops.js`
through a **document host** interface with two implementations: the running app (active and opted-in documents, with
undo and collaboration) and a file host for headless use (one `.ofini` file, written back atomically on `save`).

### 8.2 Tools

Read tools (scope `read`):

| Tool | Result |
| --- | --- |
| `proto_list_documents` | Documents available to this client: id, title, pages, kind, whether writes are allowed |
| `proto_get_tree` | Outline of a page or subtree (depth, fields), the same format as `proto_describe` |
| `proto_get_node` | Raw or resolved JSON of nodes |
| `proto_get_selection` | Current selection in the app (app host only) |
| `proto_get_geometry` | Boxes of nodes (exact in the app, approximate headless) |
| `proto_screenshot` | PNG of a node (app host only; headless returns an SVG render, marked approximate) |
| `proto_get_tokens` | Variables and styles as DTCG JSON, or CSS / Tailwind / Swift |
| `proto_get_components` | Components, variant axes, properties, code links, usage counts |
| `proto_generate_code` | Code for a node and target (`html`, `react`, `react-tailwind`, `tailwind`, `swiftui`), options as in 10.1 |
| `proto_lint` | Lint report |
| `proto_search` | As the Vibe tool |
| `proto_get_comments` | Open comment threads with anchors (only when the user allows comments for agents) |

Write tools (scope `write`, off until the user allows it per client and document): `proto_create`,
`proto_write_html`, `proto_update`, `proto_move`, `proto_delete`, `proto_component`, `proto_variables`,
`proto_styles`, `proto_interaction`, `proto_set_tokens` (import DTCG), `proto_fix`, `proto_reply_comment`. Every
call is one undo step labeled with the client's name ("MCP · Claude Code: …") and appears in the AI log.

Resources: `ofini-proto://<doc>/tree`, `…/page/<id>`, `…/node/<id>`, `…/tokens.json`, `…/components`,
`…/code/<node>/<target>`. `resources/subscribe` sends `notifications/resources/updated` after commits (debounced
500 ms), so an agent implementing a screen sees design changes.

Prompts: `implement_frame` (generate code for a frame into the client's project, using its components and tokens),
`sync_tokens`, `review_design`.

### 8.3 Transports

| Where | Transport | How a client connects |
| --- | --- | --- |
| Desktop app | Streamable HTTP on `127.0.0.1:<port>` served by the Tauri shell (`src-tauri/src/mcp_server.rs`, std-only like `preview_server.rs`) | URL and token shown in *Settings ▸ AI ▸ MCP server*, with ready-to-copy configuration for Claude Code, Cursor, VS Code and Codex |
| Terminal, app running | stdio: `ofini mcp` reads the endpoint file the app writes (port and token, user-only permissions) and proxies | `claude mcp add openfini -- ofini mcp` |
| Terminal, headless | stdio: `ofini mcp --file design.ofini [--write]` serves one file with the file host | Same, in CI or without the app |
| Browser / PWA | None: a web page cannot listen on a port | Use the CLI on a saved file, or the in-app assistant |

The Rust side terminates HTTP, enforces the security rules in 14.3 and forwards JSON-RPC to the web view over a Tauri
event channel with request ids and a 30 s timeout; the JavaScript handler does all MCP logic, so there is one
implementation to test. Server-sent events carry notifications. Port: random by default, fixed if the user sets one.

### 8.4 Client

Proto adds nothing new on the client side: the Vibe assistant already connects to MCP servers (`ai/mcp.js`, OAuth in
`ai/mcp-oauth.js`). Proto skills describe useful pairings: the user's code base server (read existing components
before designing), a component library's documentation server, an icon set server, a design tool's own MCP server the
user is entitled to (for example to pull SVG or tokens). Results are untrusted data as everywhere in Vibe.

## 9. CLI

`ofini proto <command>` in `cli/lib/proto.mjs`, reusing `engine/proto/` (ADR 0032 rules: `--json`, exit codes, no
overwrite without `--force`, wildcards, `-` for stdin and stdout).

| Command | What it does |
| --- | --- |
| `ofini proto info <file>` | Pages, frames, nodes by type, components, variables, styles, media, flows |
| `ofini proto tree <file> [--page] [--node] [--depth]` | Prints the outline (the `proto_describe` format) |
| `ofini proto validate <file>` | Schema, references, limits; exit 1 on errors |
| `ofini proto lint <file> [--rules] [--fix]` | Design lint; `--fix` writes machine-applicable fixes; SARIF with `--format sarif` for CI annotations |
| `ofini proto export <file> --target html\|react\|react-tailwind\|tailwind\|swiftui\|prototype [--node] [--out dir]` | Code export (10.1) |
| `ofini proto tokens <file> [--format dtcg\|css\|tailwind\|swift\|json] [--mode]` | Token export |
| `ofini proto tokens import <file> <tokens.json>` | Token import (DTCG) |
| `ofini proto assets <file> [--node] [--format svg] [--out dir]` | Exports vectors and marked layers as SVG and embedded media as files; PNG needs the app (exit 4, as ADR 0032) |
| `ofini proto render <file> --node <id> [--out x.svg]` | SVG render through the pure solver (approximate) |
| `ofini proto import <in> <out.ofini>` | From HTML (static path), SVG, Sketch, Penpot export, DTCG |
| `ofini proto diff <a> <b>` | Structural diff: nodes added, removed, changed fields, variables, components |
| `ofini mcp [--file f] [--write]` | MCP over stdio (8.3) |

`ofini new proto <file> [--template]` and `ofini info`, `validate`, `doctor`, `unpack --pretty` work through the existing
commands once the kind is known.

## 10. Code export, code import and the Code studio link

### 10.1 Export pipeline

```
resolved tree ─lower.js─▶ IR ─▶ emit/html.js     index.html + styles.css
                              ├▶ emit/react.js    Component.tsx (+ .module.css) per component, screens
                              ├▶ emit/tailwind.js class lists; tokens as @theme (Tailwind v4)
                              └▶ emit/swiftui.js  Views, Color/Font extensions
```

* **IR**: `{ el, tag, name, classes, decls, tokens, children, component?: { name, props }, slot? }`. `lower.js`
  chooses tags (`tag` field, otherwise inferred: text with a heading style → `h2`, frame with a click interaction →
  `button` or `a`, image → `img` with `alt`), turns layer names into class names (kebab case, deduplicated), and
  collapses wrappers that add nothing.
* **CSS** is what `css.js` produced for the canvas. Absolute positioning appears only for `abs` nodes; hug and fill
  become intrinsic sizing and flex, never fixed pixels. Variables become custom properties with fallbacks; modes
  become `[data-mode-…]` blocks and, for a collection named like a color scheme, optionally `@media
  (prefers-color-scheme: dark)`.
* **Responsive.** Frames may be grouped as breakpoint variants of one screen (same component or a `responsive`
  link). The exporter emits the base frame and `@media` overrides for the differences, desktop-first, with the same
  breakpoints as the Code studio's designer, so an exported page edits naturally there.
* **React.** One component per main component; variant axes become union-typed props, `bool` and `text` props become
  props, `swap` and `slot` become `ReactNode` props; instances become JSX usages; screens import components.
  Styling: CSS Modules (default) or Tailwind. TypeScript or JavaScript.
* **SwiftUI** (best effort, documented limits): flex → `HStack` / `VStack` with spacing and alignment, grid →
  `Grid`, absolute → `ZStack` with offsets, padding, frame modifiers, `background`, `overlay` for strokes, `shadow`,
  `Text` with font modifiers; variables → `Color` / `CGFloat` extensions with light and dark values. Not mapped:
  CSS-only features without SwiftUI equivalents (listed in the output as comments).
* **Determinism.** Same model, same options → byte-identical output (stable ordering, no timestamps). Snapshot
  tests per emitter and fixture.
* **Code links.** A component may carry `code: { react: { path: "src/ui/Button.tsx", export: "Button", props: {…} } }`
  (like Code Connect): the exporter then *uses* the existing component instead of generating one, and the Code panel
  shows the real usage snippet.

### 10.2 Tokens shared with the Code studio

A Code studio project may contain a DTCG file (default `tokens/tokens.json`). *Link tokens file* in the Variables panel
binds the Proto document to it (`code.tokensFile`: project-relative path plus, on the desktop, the folder handle).
While linked, the file is the source of truth: Proto reads it on open and on file change (the Code studio's watcher),
and Variables panel edits write the file (debounced, one Code studio undo step). Generated companions
(`tokens.css`, `tailwind.css` with `@theme`) are regenerated next to it on change if enabled. Conflicts (both changed
since the last sync) open a small merge dialog per variable.

### 10.3 Live component link

*Export to Code project* writes generated files into a Code studio project. Generated content sits between
markers (`/* @ofini-proto begin <id> hash=<h> */ … /* @ofini-proto end */`); code outside the markers is the
developer's. Re-export replaces regions whose hash still matches and asks for regions edited by hand (keep, overwrite,
or show diff). With *Live link* on, re-export happens automatically after design commits (debounced 1 s) while both
documents are open, and the Code studio preview reloads. The Code studio shows a gutter badge on linked regions that
opens the component in Proto.

### 10.4 Import from HTML and CSS

* **In the app**: the HTML (a Code studio file, a pasted snippet, an agent's `proto_write_html`, a URL fetched by the
  existing web access tools) is rendered in the sandboxed preview frame at a chosen viewport width. The probe kit
  walks the DOM and reports computed styles and boxes; the mapper turns `display: flex/grid` into layout, sizes into
  fixed/hug/fill where the computed values show it, positioned elements into `abs` with constraints, text into runs,
  `img` and `svg` into image and vector nodes, repeated sibling structures into component candidates (offered, not
  forced), and CSS custom properties into variables. Scripts never run (the preview sandbox already blocks them for
  this mode).
* **In the CLI**: static parsing with `engine/web` (HTML and CSS parsers, a simple cascade for class and element
  selectors); unsupported selectors and properties are reported. Results are marked approximate.
* Elements exported with `data-proto-id` (off by default, on for live links) map back to their nodes, which makes the
  HTML round trip lossless for what Proto can express.

## 11. Imports and the `.fig` question

| Source | Route | Status in the plan |
| --- | --- | --- |
| SVG | Existing SVG import → vector, frame and text nodes; groups become frames without layout | T8 |
| Clipboard | SVG and HTML on the clipboard (design tools put SVG or HTML there); images | T8 |
| Sketch | Existing `engine/formats/sketch.js` (public file format reference), extended: artboards → frames, symbols → components, symbol instances and overrides → instances, stacks → flex layout | T8 |
| Penpot | Penpot's export (ZIP with JSON and assets) of an open-source product: shapes, flex and grid layout, components, tokens. Written from the format's published structure, no Penpot code copied (Penpot is MPL-2.0; reading a format is not using code) | T8 |
| HTML / CSS | 10.4 | T8 |
| DTCG tokens (Tokens Studio, Style Dictionary, Penpot, Figma variable exports) | `tokens.js` | T5 |
| Figma `.fig` | **Not supported** | — |
| Figma via REST API | Optional later importer: the user pastes a file URL and their own personal access token; we call the documented `GET /v1/files/:key` and `/images` endpoints and map the JSON node tree | After 1.3.x, after a review of Figma's developer terms |

**Why no `.fig`.** Legal: the clean-room policy (rule 4) admits proprietary formats only with an official public
specification; `.fig` has none, and existing community parsers are built by reverse engineering. Implementing one
would contradict our own policy and invite a takedown. Technical: the container (a Kiwi-encoded schema embedded in the
file) changes without notice, so a reader would break silently. The REST API is the supported, documented route and
returns the same node tree as JSON.

## 12. File format

* A Proto document is a normal `.ofini` file (ADR 0006): `document.json` has `"studio": "proto"` and `"office":
  { "kind": "proto", …model }`; media bytes live under `office/proto/media/<id>.<ext>` (the `doc.office` contract,
  `core/office.js`). The type marker and the container version rule are unchanged; older OpenFini versions that do
  not know the kind keep the object unchanged and save it back as it was.
* The model carries its own `schema` integer (3.1). Migrations live in `engine/proto/migrate.js` and are tested with
  stored fixtures of every schema.
* **Stable serialization**: keys in a fixed order, nodes sorted by id, so `ofini unpack --pretty` gives small Git diffs.
* Thumbnails: the first flow's start frame (or the first frame) as `preview.png`, rendered by the app.
* `docs/file-format.md` gets a *Proto* section when task 1 lands.

## 13. Collaboration

* **Adapter** `app/src/proto/collab.js` (`collabAdapter` for kind `"proto"`, added to `LIVE_OFFICE_KINDS` in
  `core/live-kinds.js`). Records:

  | Key | Value |
  | --- | --- |
  | `n:<id>` | structure: `type`, `page`, `parent`, `ord`, `name`, `visible`, `locked` |
  | `n:<id>/geo` | `x`, `y`, `rot`, `w`, `h`, `pos`, `cx`, `cy`, `cell` |
  | `n:<id>/lay` | `layout`, `clip`, `scroll`, `sticky` |
  | `n:<id>/look` | `fills`, `strokes`, `radius`, `effects`, `opacity`, `blend`, `style` |
  | `n:<id>/text` | `text` (runs and style) |
  | `n:<id>/comp` | `props`, `variant`, `bind`, `of`, `over`, `code` |
  | `n:<id>/proto` | `proto` (interactions), `tag`, `a11y`, `modes` |
  | `p:<id>` | page |
  | `vc:<id>`, `v:<id>`, `s:<id>` | variable collections, variables, styles |
  | `meta:*` | title, breakpoints, code links |

  Two people changing a node's fill and its padding at the same time both win (different records); the same record
  resolves by Lamport clock (last writer wins), with the existing lost-update notice. Moves are conflict-free
  through parent + fractional key; cycles are broken deterministically, as in the tree CRDT. Text edits are record
  level in 1.3.0 (a text layer is short); an RGA binding for long text is a later improvement.
* **Validation**: every remote record goes through `validateRecordOp` and the Proto schema validator for its key
  type, so a malicious peer cannot inject unknown fields, scripts or oversized values.
* **Presence**: cursors and selections in canvas coordinates (page id + point), viewport for *follow*, the player
  state when presenting (6.2).
* **Comments**: the existing comments system with anchor kind `proto` (`{ kind: "node", node, page, at: [x, y]
  relative to the node }`); pins follow layers when they move; comments on removed layers become page comments.
* **Media**: image bytes travel with the snapshot and on *Resync*, as for other kinds.

## 14. Security

### 14.1 Canvas and player

* No script execution in the design: the renderer creates elements with `createElement`, sets text with
  `textContent` and styles with `style.setProperty` from `css.js`, which only emits declarations from an allow-list
  of properties with validated values. `url()` values only reference the document's own media (blob URLs).
* Imported HTML and SVG are sanitized before mapping (no scripts, event handlers, `javascript:` URLs, iframes,
  external resources without the network policy).
* `openUrl` in the player goes through the app's external link confirmation; prototype HTML exports contain no
  external requests.

### 14.2 Expressions

Prototype conditions are data interpreted by a pure evaluator with a step limit; no `eval`, no `Function`, no
property access on host objects.

### 14.3 MCP server

* **Off by default.** Enabled in *Settings ▸ AI ▸ MCP server*; a status indicator in the title bar while it runs; one
  click stops it and drops all sessions.
* **Loopback only**: binds `127.0.0.1` (and `::1`), never a LAN address.
* **Authentication**: a 256-bit bearer token, generated per installation, rotatable, required on every request; the
  endpoint file for `ofini mcp` has user-only permissions.
* **DNS rebinding and browser protection**: the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`;
  requests with an `Origin` header are refused unless the origin is the app itself (MCP security best practice).
* **Per-client approval**: the first connection of a client (by its `clientInfo` name) asks the user in the app:
  deny, allow read, allow read and write; per document or all Proto documents; remembered until revoked in Settings.
* **Scope**: only Proto documents that are open and allowed; no file system access, no other studios, no app
  settings, no network.
* **Limits**: request size 4 MiB, 2,000 nodes per create call, 60 write calls per minute per client, 30 s timeout.
* **Accountability**: every write is one undo step labeled with the client name and is recorded in the AI log;
  the user can undo an agent's whole session through the existing tag-based run undo (ADR 0008).
* **Prompt injection**: design content (layer names, text, comments) is untrusted for the *receiving* agent too.
  Tool results put document text in clearly delimited JSON fields; comments are only exposed when the user allows
  it. We cannot prevent an external agent from following instructions it reads; the README of the feature says so.
* **Headless `ofini mcp --file`**: read-only unless `--write`; writes go to a temporary file renamed over the
  original on `save`, with the `.ofini` validation first.

### 14.4 Collaboration, imports and tokens

The existing end-to-end encryption and op validation apply (13). ZIP limits of `core/ofini.js` apply to Sketch and
Penpot imports. The optional Figma REST importer stores the token only in the OS credential store on the desktop and
only in memory in the browser, and contacts only `api.figma.com` under the network policy.

## 15. Build plan

Fourteen tasks, each one PR, each independently mergeable once its dependencies are merged. Sizes: **S** ≤ 1 day,
**M** 2–4 days, **L** 5–8 days of focused agent work including tests and docs. Every task: US English, German strings
at 100 %, `npm test`, `npm run build && npm run check:size` with its budget increase recorded in
`scripts/size-budget.json`, docs updated, no new runtime dependency, no attribution lines in commits or PRs.

### Waves and releases

Waves are the build order; at most four agents work in parallel, and a wave starts when the dependencies of its tasks
are merged. Each release ships the waves completed before it.

| Wave | Tasks (parallel) | Release |
| --- | --- | --- |
| A | T1 | 1.3.0 (Proto preview) |
| B | T2 | 1.3.0 |
| C | T3, T5 | 1.3.0 |
| D | T4, T10, T11, T13 | 1.3.0: model, renderer, core tools, components and variables in the engine, live collaboration, assistant, CLI |
| E | T6, T7, T8, T9 | 1.3.1: Assets and Variables panels, code export, imports, prototyping and player |
| F | T12, T14 | 1.3.2: MCP server, Code studio live link; the preview label is removed |

Dependencies at a glance:

```
T1 → T2 → T3 → T4 ──────┬→ T6 → T14
           │             └→ T9
           └→ T10
     T2 → T5 → T6, T8, T9, T11, T13
     T13 → T7 → T12, T14
     T11 → T12
```

Until 1.3.0 is released the studio is reachable only with the *Labs ▸ Proto Studio* preference, so tasks can merge to
`main` as soon as their dependencies allow.

### Tasks

**T1 · Document model, schema, operations** — M — deps: none
* Scope: `engine/proto/schema.js` (types, defaults), `validate.js`, `migrate.js` (schema 1 plus fixture), `ids.js`,
  `ops.js` (create, update with a field allow-list, move and reparent with fractional keys, delete with subtree,
  duplicate, wrap in flex or grid, pages), `tree.js` (children cache, traversal), stable serialization; kind `"proto"`
  in the `doc.office` container with its media folder.
* Files: `app/src/engine/proto/*`, `tests/proto/model.test.js`, `tests/proto/ops.test.js`, `docs/file-format.md`.
* Acceptance: property tests (random op sequences keep the model valid, no cycles, order keys sorted); `validate`
  rejects every malformed fixture; serialize → parse → serialize is byte-identical; imports in plain Node.
* As built (deviations and decisions the later tasks build on):
  * Two more modules: `serialize.js` (`canonical`, `stringify`, `parse`) and `format.js` (`loadModel` strips the
    container fields, migrates and validates; `storeModel` returns the canonical model for `doc.office`).
  * Operations are JSON objects `{ op, …args }` applied with `apply(model, op, { random })` → `{ model, inverse, ids,
    map? }`; `inverse` restores the input exactly (deep-equal), a no-op returns the input model itself, and a failing
    operation throws `OpError` and changes nothing. Names: `node.create` (nested `children`), `node.insert`,
    `node.update` (`set` and `unset` with dotted paths such as `"layout.gap"`; list items are replaced as a whole),
    `node.move`, `node.place` (exact placement, the inverse of moves), `node.delete`, `node.duplicate`, `node.wrap`
    (`flex` guesses direction, order and gap from positions; `grid`; `none`), `page.create` / `update` / `move` /
    `delete`, `meta.update`, `batch`. Later tasks add their own operations (components, variables, interactions) to the
    same table.
  * The grid definition lives in `layout.grid`. Colors in schema 1 are hex literals or `{ "$var" }` bindings. Effects
    are `shadow` (with `inset`), `blur` and `backgroundBlur`.
  * Interactions and flows that point at a removed layer and fills whose media is missing are warnings, so deleting a
    frame never fails; deleting a component (or its page) that instances or swap properties still use is refused
    (`in-use`). Extending collections are checked for references and cycles only; their value semantics come with T5.
  * The File Doctor checks Proto designs (`proto-invalid`, `proto-newer`), so `ofini info` (with a design summary) and
    `ofini validate` recognize them now; `ofini new proto` and the `ofini proto` commands stay in T13.
  * Each operation copies the node map once (copy on write; a batch copies once) and hands its updated child index to
    the cache, so a property edit never re-sorts children. Until T3 imports it, `ops.js` ships as an unminified source
    file (recorded in `scripts/size-budget.json`).

**T2 · Resolver, CSS compiler and pure layout solver** — L — deps: T1
* Scope: `resolve.js` (plain nodes and variable references, extension points for instances), `css.js` (node →
  declarations, property allow-list), `layout.js` (flex, grid, constraints, approximate text), recorded Chromium
  geometry fixtures and `scripts/proto-record-geometry.mjs` to re-record them by hand (results committed).
* Files: `app/src/engine/proto/{resolve,css,layout}.js`, `tests/proto/{css,layout}.test.js`,
  `tests/proto/fixtures/geometry/*.json`, `scripts/proto-record-geometry.mjs`.
* Acceptance: every schema field has a CSS mapping test; solver within 1 px of the recorded boxes for fixtures without
  text; no DOM access (import test in Node).
* As built (deviations and decisions the later tasks build on):
  * `resolve.js`: `createResolver(model, { modes, instance, applyStyles, variableValue })` → `.tree(id)`, `.page(pageId)`,
    `.modesAt(id)`, `.variable(id, modes)`, `.value(v, modes)`, `.cssName(id)`, `.warnings`. A resolved node is
    `{ key, id, type, node, children, modes, bound, instance, parent }`: `node` is plain JSON with styles and overrides
    applied and every `{ "$var" }` replaced by its value; `bound` maps the field paths that were bound (`"layout.gap"`,
    `"fills.0.color"`) to variable ids, so one tree serves both literal output (solver) and `var()` output (canvas,
    export). Layers inside an instance are keyed `"<instanceKey>/<sourceId>"` (`"n50/n23/n91"`). Problems (missing
    variables or components, cycles) are warnings, never exceptions.
  * Modes resolve node → ancestors → page → the resolver's `modes` → collection default → first mode; aliases are
    followed in the same modes. Extending collections are not applied yet (T5, through the `variableValue` hook).
  * Styles: text (merged over the local text style), effect, fill and stroke references apply over the local fields;
    grid styles are not applied (they have no CSS meaning yet). T5 can replace this with the `applyStyles` hook.
  * Instances (beyond the T2 scope, as a baseline T5 extends through the `instance` hook): the variant of a set is
    picked (set defaults, then the instance's values, best partial match), the main component's fields lie under the
    instance's own fields, its layers become virtual children, and `over` applies by source-id path through nested
    instances (outer instances win). Not yet: `props` and `bind`, swap, slots, detach, caches.
  * `css.js`: `nodeCss(r, { parent, index, count, vars: "value"|"css", resolver, root, scroll, mediaUrl, designSize })`
    → `{ decls: [[property, value]], attrs, text?: { runs }, svg? }`, `treeCss(root, opts)` → `Map`, `boxModel`,
    `PROPERTIES` (the allow-list). In `"css"` mode a bound value prints as `var(--name, <value in this node's modes>)`,
    so the canvas is correct before T5 emits the custom property rules; modes become `data-mode-<collection slug>`
    attributes. Vector and line layers return SVG presentation attributes (inline SVG), text layers their runs.
  * Mapping decisions that keep the canvas, the export and the solver identical: `box-sizing: border-box`; flow
    children get explicit minimum sizes (`min-width: <min or 0>`), fixed and hug layers `flex: 0 0 auto`, fill layers
    `flex: 1 1 0px` on the main axis and `align-self: stretch` on the cross axis, so CSS automatic minimum sizes
    never apply; hug and fixed layers never stretch. `gap` is the main-axis gap (column gap in a grid), `rowGap` the
    gap between lines (row gap in a grid) and defaults to `gap`. `rel` values are percentages (0 to 100, as validate.js
    checks), not fractions as in the example of §3.2. The first `inside` stroke is the CSS border (it takes layout
    space, and absolute children are offset by it), the first `center` stroke an outline with a negative offset,
    further strokes box-shadow rings; `sides` are per-side widths. Fills and effects are listed bottom to top.
    Constraints other than left/top need fixed design-time sizes of the layer and its parent on that axis (or the
    `designSize` hook) and fall back to left/top otherwise; `center` is `calc(50% + offset)` without a transform.
    `scroll` clips on the canvas and scrolls with `scroll: true` (player, export). Line-height percentages follow CSS
    (a run without its own line height inherits the layer's computed pixels).
  * `layout.js`: `layout(resolvedRoot, { measurer, viewport, origin, designSize })` → `{ approximate: true, root,
    boxes: Map<key, { x, y, w, h, px, py, rot, lines? }> }`, `layoutNode(model, id, opts)`. Text boxes carry their
    lines (`segs` with run indexes, baselines) for the SVG render of T13. The measurer is the `{ measure, metrics }`
    seam of `core/fonts.js` (default `approxMeasurer`). Baseline alignment is implemented for rows; grid baseline
    alignment falls back to start.
  * Geometry fixtures: 16 models in `tests/proto/fixtures/geometry/` (13 without text: flex sizing, justify and
    align, column fill with min/max freezing, wrap with align-content, nested hug, grid tracks, flow and dense
    placement, hug grids, constraints, absolute layers in flex, strokes, instances, variables; 3 with text), recorded in
    Microsoft Edge 158 on Windows. Measured agreement: within 0.02 px without text; within 1.6 px with text (the
    browser kerns, the base-14 widths do not), tested with 1 px and 2 px tolerances.

**T3 · Studio shell and DOM renderer** — L — deps: T1, T2
* Scope: `studios/proto.js` (definition, menus, `essentials` docking preset, `newDocument`, `newBlank`, Labs flag),
  `proto/host.js` (mount, commits through `commitOffice`, autosave), `proto/view.js` (stage, shadow roots, keyed
  patching, pan and zoom, culling, level of detail), `proto/measure.js`, `proto/overlay.js` (selection and hover),
  new / open / save, start screen entry, first user guide `docs/proto-studio.md`, German strings.
* Files: `app/src/studios/{proto.js,index.js}`, `app/src/proto/{host,view,measure,overlay}.js`, `app/styles/proto.css`,
  `tests/proto/view-patch.test.js` (the patch planner is pure), `tests/proto/perf/`, `docs/proto-studio.md`.
* Acceptance: start-up bundle +≤ 1 KiB; open and save round trip; the 5,000-node fixture pans at 60 fps in Chromium
  (perf script), manual checks in WebView2 and WebKitGTK recorded in the PR.
* As built (deviations and decisions the later tasks build on):
  * Labs switch: the preference `labsProto` (*Settings ▸ Labs ▸ Proto Studio*); `studios/proto.js ▸ installProtoLabs`
    registers the studio at start-up and as soon as the switch turns on (the registry cannot unregister, so off takes
    effect at the next start). Opening a design while it is off shows a notice with *Turn on*. `newDocument` creates a
    design with one desktop frame, `newBlank` an empty page; both come from the registry (File ▸ New, New Blank).
  * Modules: `proto/host.js` (mount, start screen), `proto/workspace.js` (the instance, `app.protoUI`, with input and
    panels), `proto/view.js` (stage, shadow roots, culling, level of detail), `proto/patch.js` (the pure planner:
    `changedRoots`, `entriesFor`, `planPatch`, `cullState`), `proto/geometry.js` (cache, `hitTest`, `pickAt`,
    `marqueeSelect`), `proto/measure.js`, `proto/overlay.js`, `proto/camera.js`, `proto/controller.js` (selection and
    `opStep`), `proto/panels.js`, `commands/proto.js` (registered on first mount). Tests: `tests/proto/view-patch.test.js`,
    `controller.test.js`, `perf/pipeline.test.js`; the browser benchmark is `tests/proto/perf/bench.html` driven by
    `scripts/proto-perf.mjs`.
  * Undo: `controller.run(op, label)` turns an operation into one document history step (`doc.tx`). Undo and redo
    restore the stored models when nothing else changed in between, and otherwise apply the operation's inverse (and
    the inverse of that replay for redo, which keeps created ids) to the current model, so T10 can rebase on top of
    remote edits without `prj.rebase`. Updates that set a field to its current value are not recorded.
  * Saving: `workspace.js ▸ ensureProto` loads the model once (`format.js ▸ loadModel`; a newer or invalid model opens
    read-only with a banner) and makes `doc.office.manifest()` write the canonical model, so saved files are stable.
  * Rendering: one host with its own shadow root per **top-level layer** (also free-floating layers; the concept's
    single extra root for them was not needed), a shared constructable reset sheet, declarations from `css.js` with
    `vars: "css"` and `root: "origin"` (the host carries `left`, `top` and the page z-order as `z-index`). Changed
    top-level layers are found by node identity (`changedRoots`; a change inside a component re-resolves every frame
    with an instance), re-resolved whole, and patched per element (style, attributes, text runs, SVG, child order).
    Detached layers keep their elements and are patched when they come back. Geometry is measured in the animation
    frame after a patch (and when a root's `ResizeObserver` or `document.fonts.ready` fire), rounded to 1/100 px.
  * Culling and level of detail as in §4.2 with the constants in `patch.js` (`LOD_ZOOM` 0.25, `BLOCK_ZOOM` 0.05,
    `LOD_PIXELS` 160, `DETACH_AFTER` 10 s, live margin half a viewport). A layer that was never measured renders once
    to learn its size. The overlay draws the simplified layers from the geometry cache (fills, ellipses, text as line
    blocks).
  * Selection semantics (`geometry.js ▸ pickAt`): a click selects the top-level layer's child under the point (or the
    top-level layer itself); with a selection, its siblings; Ctrl/Cmd deep; layers inside instances select the
    outermost instance. The marquee selects top-level layers (T4 adds marquees inside frames with the Move tool).
  * Panels: `proto-layers` (tree, top of the list in front, keyboard navigation, at most 2,000 rows until the
    virtualized tree of T4) and `proto-inspector` (read-only name, type and box). The workspace API in the header of
    `proto/workspace.js` (`run`, `select`, `pickAt`, `setTool`, `view.overlay.addLayer`, `on("change" | "selection" |
    "camera" | "geometry")`) is what T4 tools and T10 collaboration build on.
  * Small engine fix: `node.duplicate` offsets layers whose position is omitted (the default 0) as well.
  * Measured with `scripts/proto-perf.mjs` (Microsoft Edge 158 headless, 1920 × 1080, Windows 11 on the
    development machine, not the reference laptop): pan with 5,000 visible layers p95 17.0 ms (57–60 fps), zoom p95 17.3 ms; 20,000 layers
    at 10 % with level of detail 60 fps; selection change p95 1.8 ms, hover 0.5 ms; property edit to painted frame in
    10,000 layers p95 20.4 ms; 10,000 layers to first paint 188 ms, JS heap 27 MB. Manual checks in WebView2,
    WKWebView and WebKitGTK are still open.

**T4 · Core tools and panels** — L — deps: T3
* Scope: tools Move/select, Scale, Frame (device presets), Rectangle, Ellipse, Line, Pen, Text (in-place editing),
  Image, Hand, Measure; snapping and smart guides; padding and gap handles; hug / fill / fixed switching; panels Pages,
  Layers and Design (every field of 3.2, variable binding buttons hidden until T6); shortcuts, context menu, copy and
  paste inside Proto.
* Files: `app/src/proto/tools/*.js`, `app/src/proto/panels/{pages,layers,design}.js`, `app/src/commands/proto.js`,
  `tests/proto/{snap,tools-math}.test.js`.
* Acceptance: every tool action is one undo step; Layers and Design usable by keyboard alone (tab order, ARIA);
  manual checks in Chromium and Firefox listed in the PR.
* As built (deviations and decisions the later tasks build on):
  * Modules: `proto/tools/` (`index.js` registry and toolbar, `select.js` Move tool, `draw.js` Frame, Rectangle,
    Ellipse, Line and Zoom, `pen.js`, `text.js` with in-place editing, `presets.js`, `common.js`) with two pure
    modules tested in Node: `math.js` (handles, resize, rotation, constraints, insertion points, padding and gap
    handles, grid track text, text runs after an edit) and `snap.js` (snap targets, guides, distance labels);
    `tools/edit.js` builds every edit of the tools, panels and commands as one `ops.js` operation (a batch for several
    layers), also pure and tested. Panels: `proto/panels/{pages,layers,design}.js`; `proto/panels.js` of T3 is gone.
    The Design panel keeps the dock id `proto-inspector` (saved layouts keep working) and is titled *Design*.
  * Workspace additions (header of `proto/workspace.js`): `apply(op, label)` (a refused op becomes a notice),
    `preview(op)` (a drag renders the operation's result without recording it; the drop runs the operation once, so
    every gesture is one undo step and collaboration sees one change), `box(id)`, `tools`, `setHover`, `setMarquee`,
    `setCursor`, `editText`, `rename`, `copy` / `cut` / `paste` (an in-app clipboard), and the `tool` event. Tools get
    `down` / `move` / `up` / `hover` / `key` / `draw` / `deactivate`. `view.js` gained `elementOf(key)`,
    `remeasure(rootId)` and `invalidate(rootId)` for in-place text editing. No engine change was needed.
  * Resizing a frame applies its absolute children's constraints to their stored boxes in the same batch, because the
    CSS of `right`, `center` and `scale` constraints is computed from the design-time size (T2). Rotated layers resize
    by their axis-aligned box (no rotated handles yet).
  * A new text is previewed while typing and created with its text on finish (one step; nothing when it stays empty);
    a text layer named after its content keeps following it. Editing uses `contenteditable="plaintext-only"` (falls back
    to `true` with plain-text paste) and keeps run styles outside the edited range (`math.js ▸ editRuns`).
  * Undo and redo shortcuts now reach the Proto Studio (`ui/shortcuts.js` treats it like the Office Suite).
  * Not in this task: the Scale tool (K), the Image tool (added by T8), the Comment tool (T10) and
    Alt-toggling hug, fill and fixed while resizing; alignment of auto layout children is the 3 × 3 matrix in the
    Design panel (padding and gap have canvas handles); equal-spacing snapping; copy and paste stay inside OpenFini
    (T8 added the system clipboard); multi-selection fields show the first layer's value.

**T5 · Components, variables, styles and DTCG tokens (engine)** — L — deps: T2
* Scope: component and component set ops, property definitions and bindings, instance resolution with overrides by
  source-id path, swap, slot, detach, reset; variable collections, extending collections, modes, aliases with cycle
  check, scopes, styles as composite tokens, mode resolution in `resolve.js` and `css.js`; `tokens.js` (DTCG import
  and export, CSS custom properties, Tailwind v4 `@theme`, Swift). Instances render on the canvas through T3 once
  both are merged; no new panels.
* Files: `app/src/engine/proto/{components,variables,tokens}.js`, `resolve.js`, `css.js`,
  `tests/proto/{components,variables,tokens}.test.js`, `tests/proto/fixtures/tokens/*.json`.
* Acceptance: nested instances, overrides surviving edits of the main component, swap with a preferred list, slot
  content, detach equal to the resolved subtree; DTCG round trip of the specification's examples; alias cycles
  rejected; 1,000 instances resolve in under 50 ms.
* As built (deviations and decisions the later tasks build on):
  * Modules: `components.js` (helpers and operation handlers for components and instances), `variables.js` (families,
    mode selection, value lookup, scopes, references, style application and the variable, mode and style operations),
    `tokens.js` (DTCG, CSS, Tailwind v4, Swift). The handlers are registered in the one operation table of `ops.js`
    (`apply` stays the only entry point). Their inverse is one generic exact operation, `restore { nodes?, pages?,
    collections?, items?, styles? }` (`{ id: object | null }`), recorded by a journal in the draft; `restore` refuses
    orphans and cycles. New operations: `component.create` (a frame becomes a component in place, anything else is
    wrapped), `component.combine` ("size=md, state=hover" names become variant axes, other names one `variant` axis;
    component properties move to the set), `component.addVariant`, `prop.define` / `prop.rename` / `prop.delete`
    (cascading to variants' `variant`, `bind` and instance values), `prop.bind`, `instance.create` (the main
    component's size applies), `instance.set`, `instance.swap`, `instance.override` (top-level fields per path),
    `instance.reset`, `instance.detach`, `collection.*`, `mode.*`, `var.create` / `var.update` / `var.delete`
    (`detach: true` replaces bindings by their values in each user's modes; without it a used variable is refused),
    `node.bind` (binds list items such as `fills.0.color`, checks scopes unless `force`; `var: null` writes the value),
    `style.create` (also `from` a layer) / `update` / `delete` / `apply` / `detach`, `tokens.import` (the result has a
    `report`).
  * Properties: a text property bound to `text` replaces the content (first run's style kept); every other binding sets
    the field (`visible`, `of` of a nested instance for swap properties). Bindings apply to the layers of the instance's
    own component; overrides apply after them. Main components render their stored layers (defaults are not applied).
  * Slots: an instance's stored children are slot content (`props.<slot>` lists ids; unlisted children go to the first
    slot property); a slot property is connected by `bind: { "<slotLayer>.children": prop }`, else the first free
    `slot` layer. Content of a real instance keeps its own key; resolved nodes carry `slot` (the providing instance),
    `src` (stored node with properties and overrides) and `base` (after expansion, still with bindings and style
    references). New layers created inside an instance flow (`pos: "flow"`). `r.node` may be the stored object itself
    when nothing changed it (treat it as immutable).
  * Detach materializes the resolved subtree with new ids; the instance keeps its id and becomes a frame; slot layers
    become frames; nested instances stay instances and receive the outer overrides that reached into them; slot content
    of the detached instance keeps its ids. Instance children that fill no slot stay children of the frame.
  * Extending collections: overrides live on the variable (`ext[collection][mode]`); an extending collection has its
    base's modes (validated, kept in step by the mode operations, which run on the base only). Selecting any collection
    of a family selects the family; a deeper selection replaces the inherited one, and inside one `modes` object the
    most derived collection wins (`mergeModes`). The resolver's `opts.modes` apply over the page's modes (as in T2).
  * Grid styles are CSS grid definitions; a container with a grid style becomes a grid (the style wins).
  * `css.js`: `varRules` / `varSheet` emit `:root` (or `:host`) defaults and one `[data-mode-<collection slug>="<mode>"]`
    rule per collection and mode with every variable of its family (base collections first). Aliases inside a family
    are written as values; aliases into another family stay `var()` (they follow that family through the cascade; a
    cross-family alias whose own family also switches modes deeper is a known CSS limitation). A unitless number
    variable bound to a length prints `calc(var(--x, n) * 1px)`.
  * Resolve cache: `createResolveCache()` passed as `opts.cache` reuses resolved real instances (the same objects) while
    the stored nodes and children lists they read, `vars`, `styles` and the parent's modes are unchanged. Measured: 1,000
    two- to four-layer instances resolve in about 11 ms without the cache (Node 24, Windows laptop); the test asserts
    50 ms for the best of five runs.
  * DTCG: export in the 2025.10 shapes (sRGB color objects with `hex`, dimension and duration objects, `$root` tokens
    for names that are also groups); modes in `$extensions["org.openfini.modes"]`, collections, ids, scopes, code names
    and brand overrides in `$extensions["org.openfini"]`; styles as typography, shadow, gradient or color tokens with the
    exact style in the extension. Import reads both the 2025.10 objects and the older strings, `$type` inheritance,
    `$root`, group `$extends`, `{a.b}` and `$ref` aliases, HSL and sRGB-linear colors; rem becomes px (×16) and s
    becomes ms, both reported; cubicBezier, strokeStyle, border, transition, unreadable colors and broken aliases are
    skipped and reported. Golden files: `tests/proto/fixtures/tokens/` (`UPDATE_GOLDEN=1` rewrites them).
  * Like `ops.js`, the new modules have no app importer until T3 and ship as unminified source files (budget +39 KiB
    gzip, recorded in `scripts/size-budget.json`).

**T6 · Assets, components and variables UI** — M — deps: T4, T5
* Scope: Assets panel (components, sets, styles, drag to insert), component section of the Design panel (create
  component, combine as variants, properties, variant pickers and property fields on instances, go to main, reset,
  detach), Variables panel (collections as tables, modes, aliases, scopes, code names, DTCG import and export),
  binding picker on every Design field, mode switcher per frame.
* Files: `app/src/proto/panels/{assets,variables,binding}.js`, `app/src/proto/panels/design.js`,
  `tests/proto/panels-model.test.js` (pure view models).
* Acceptance: every action one undo step; a mode switch repaints only affected frames; keyboard access as in T4.
* As built (deviations and decisions the later tasks build on):
  * Modules: `proto/panels/model.js` (pure view models and the operations every panel action runs: `assetList`,
    `insertInstanceOp`, `instanceInfo`, `componentInfo`, `propBindTargets`, `bindCandidates`, `bindOp`, `variableTable`,
    `cellOp`, `resetCellOp`, `modeChoices`, `modeOp`, `styleSlotInfo`, the style operations, `tokenExport`; tested in
    `tests/proto/panels-model.test.js`), `panels/binding.js` (the shared popover, the variable picker and `bindable`, the
    bind button or bound chip of a Design field), `panels/assets.js` (dock id `proto-assets`, a tab next to Layers),
    `panels/variables.js` (dock id `proto-variables`, bottom dock). No engine operation was added; every action is one
    operation (a batch for several layers) through `ws.apply`, so one undo step. The workspace gained `goTo(id)`,
    `comments`, `commentAnchor()` and `revealComment(anchor)`; the Proto layout now gives the bottom dock its height
    (it was fixed at 0) and the Window menu shows in the studio.
  * Component section: create (a frame becomes the component in place) and combine come from the selection; properties
    are edited in place (rename, defaults, variant options as a comma list); an inner layer binds its `text`,
    `visible`, `of` (nested instance) or `children` (slot) to a property in a *Component property* section. Text property
    defaults start as “Text”.
  * Instance section: swap lists every component and set; variant pickers start from the variant an instance of one
    variant keeps; overrides count active and inactive paths plus set property values. Overrides of inner layers are not
    edited from the panel (canvas clicks select the outer instance, T3); they come from the assistant and reset here.
  * Bindings: opacity, corner radius (also per corner), gap, row gap, padding sides, fill, stroke and shadow colors,
    stroke width, font, font size, weight, letter spacing, text color and visibility. Width and height and line height
    are not bindable from the panel yet (`w.value` works through `node.bind`). Variables outside their scopes are listed
    disabled. Editing a list (fills, padding) keeps bindings of the other items.
  * Variables panel: a brand table shows the chain's variables; editing a cell writes `ext[brand][mode]`; *Reset to the
    base value* removes it. Deleting a used variable or collection detaches (layers keep their values) after a
    confirmation. Tokens import merges into the shown collection (a base collection) or the file's own collections.
  * Styles: a palette button per section (fill, stroke, effect, text, grid layout); while a style is applied the section
    shows the style chip instead of the local fields. A stroke uses fill styles, so a stroke style is created from the
    layer's fills.
  * Mode switcher: one select per collection family with more than one mode or a brand (`Auto` inherits); a frame's
    `modes` change re-renders only that top-level layer (T3's `changedRoots`).
  * Comments (T10 follow-up): anchor kind `proto` (`protocol.js ▸ ANCHOR`, `anchors.js ▸ protoAnchor`: `page`, `pin` in
    world coordinates, `node` and `off` for the deepest layer under the point, `quote`); `proto/comments.js` draws the
    pins over the canvas (DOM buttons of the comment UI, two frames after a change so they follow the measured boxes),
    drags them (`reanchor`), and adds the Comment tool (C). `comments-host` asks `app.protoUI.commentAnchor()` for
    *Add Comment* and reveals `proto` anchors in the workspace; `comment-context.js` resolves them for the assistant.
    The assistant's `add_comment` with a `layer_id` still resolves only layers of the classic studios.
  * Lint (T11/T13 follow-up): `cli/lib/proto-lint.mjs` runs `engine/proto/lint.js` for the design rules; the CLI-only
    checks are `schema`, `unresolved` and `clipped`. `stale-override` and `text-overflow` are aliases; the CLI's own
    touch-target and empty-frame checks are gone in favor of the engine's. Safe fixes become one operation or batch;
    unsafe ones a `suggestion`.
  * Assets previews are the solver's display list painted into a canvas (`ai-render.js`), cached per component and the
    identities of its subtree, variables and styles.

**T7 · Code export** — L — deps: T5, T13
* Scope: `codegen/lower.js` (IR, tag inference, class names), emitters HTML + CSS, React (CSS Modules or Tailwind,
  TS or JS), Tailwind, SwiftUI; responsive breakpoint merge; code links; Code panel (Inspect mode) with copy and an
  export dialog; `ofini proto export` and `ofini proto tokens`.
* Files: `app/src/engine/proto/codegen/*`, `app/src/proto/panels/code.js`, `cli/lib/proto.mjs`,
  `tests/proto/codegen/*.test.js` with snapshots.
* Acceptance: deterministic snapshots; exported HTML rendered in Chromium matches T2's recorded geometry per fixture;
  generated React passes a syntax check (TypeScript compiler only if it is already a dev dependency).

**T8 · Imports: HTML and CSS, SVG, clipboard, Sketch, Penpot** — L — deps: T5
* Scope: `import/html.js` (computed-style mapper in the app, static path for the CLI), SVG through the existing
  importer, clipboard handlers, Sketch reader extension (symbols → components, overrides, stacks → flex), Penpot
  export reader, import report (`core/import-report.js`), `ofini proto import`.
* Files: `app/src/engine/proto/import/*`, `app/src/proto/paste.js`, `cli/lib/proto.mjs`,
  `tests/proto/import/*.test.js` with synthetic fixtures built from public format descriptions only.
* Acceptance: export → import → export is stable for the HTML fixtures; sanitizer tests (scripts, event handlers,
  `javascript:` URLs); every importer reports what it skipped.
* As built (deviations and decisions the later tasks build on):
  * Modules: `engine/proto/import/` (pure, plain Node): `common.js` (limits, `safeUnzip` with declared-size and ratio
    checks before inflating, the builder that pre-assigns ids against the target model and deduplicates media,
    colors, image sniffing and sizes), `sanitize.js`, `html.js` (`importHtml`, `mapProbe`, `tracks`),
    `html-static.js` (`staticProbe`: user agent defaults, a cascade with specificity, `!important`, inheritance,
    `@media` widths, `var()` and shorthand expansion; unsupported selectors skip their rule and are counted),
    `svg.js`, `sketch.js`, `penpot.js` and `index.js` (`detectFormat`, `importInto`, `importImage`, `applyImport`,
    `designFromImport`). The app side is `proto/paste.js`, `proto/html-probe.js` and `proto/tools/image.js`; the
    import report is `core/import-report.js` (existing), attached to the document, so *File ▸ Import Report…* shows it.
  * Every importer returns engine operations (`media.put`, `page.create`, `collection.create` / `var.create`,
    `node.create` with nested children and pre-assigned ids), so an import is one validated undo step everywhere.
    Components are created before their instances; `node.create` starts from the type's defaults, so the importers
    set every field they mean (fills, clip) explicitly.
  * HTML: the app renders the sanitized page in a hidden `sandbox="allow-scripts"` frame (opaque origin) with its own
    CSP (only the probe's `data:` script, `data:` images and fonts, no network) instead of the Code studio's preview
    pane, which is bound to a Code project; the probe waits until the frame has its viewport (a sandboxed frame runs
    in its own process and gets its size after `load`). The probe reports computed styles, boxes and the *declared*
    width, height, flex basis and grid templates (from the matching rules), because computed values are always pixels.
    Sizing rules: `flex-grow` or 100 % → fill, auto in a stretching cross axis → fill, `fit-content` and auto → hug,
    lengths → fixed (border-box). Blocks become column auto layouts (gap = the most common space between children,
    first and last margins and equal side margins become padding; uneven spacing is reported), inline-only blocks
    wrapping rows; a text-only element with decoration becomes a frame around a text layer; a fragment with one
    element (pasted HTML) becomes that element, a page becomes a frame named after its `<title>`. `data-proto-id`
    keeps ids. Custom properties of `:root` become the collection *CSS variables*; colors equal to exactly one of them
    are bound. Repeated sibling structures (three or more) are reported as component candidates, not converted.
  * Round trip: `tests/proto/import/_export.js` prints `css.js` declarations as style attributes (what T7's HTML
    export and the live link write); export → import → export is byte-identical for the fixtures, also on a second
    pass.
  * SVG is a new pure importer (`office/xml.js` parser, `vector/path.js` for path math), not `vector/svg-import.js`,
    which needs the DOM and canvas; groups become frames without layout, axis-aligned rectangles and ellipses stay
    shapes, everything else becomes vectors with all transforms applied.
  * Sketch: `engine/formats/sketch.js ▸ readSketch(input, { symbols: true })` adds object ids, symbol masters with
    `symbolID`, instances with override values, image fills, shadows, blurs, text runs, stacks
    (`MSImmutableFlexGroupLayout`: direction, justify, align, gap, wrap, padding, children's fixed / fit / fill
    sizing) and Smart Layout (direction, gap from positions); without the option the Vector importer's result is
    unchanged. Overrides `_stringValue`, `_symbolID` (empty hides), `_image` and `_isVisible` map to `over` by the
    path of Proto ids; shared style and color overrides are reported.
  * Penpot: the export format version 3 (Penpot 2.x) as described in Penpot's technical guide; shapes in page
    coordinates are made relative; `layoutItemHSizing` / `VSizing` map to fill, hug and fixed; copies of components
    become instances whose overrides are the differences of their `shapeRef` children (text, fills, visibility).
    Tokens are reported (import them with DTCG); the binary v1 format is refused.
  * Clipboard: copy writes an OpenFini MIME type (`application/x-openfini-proto+json`), HTML with the same payload in a
    `data-openfini-proto` attribute (survives other apps and the async Clipboard API) and the layer names as text;
    the payload carries the images its layers use (16 MiB). Ctrl/Cmd+C, X and V on the canvas pass through to the
    browser's clipboard events (the workspace stops the shortcut there); *Edit ▸ Paste* reads the system clipboard and
    falls back to the in-app clipboard. Proto layers pasted into the same design without a target keep T4's
    placement (next to the originals). Text becomes a text layer.
  * Image tool (from T4's open list): `Shift+Ctrl/Cmd+K`, click where the pictures go; *Insert ▸ Image…*; media go in
    through `media.put`.
  * `proto_write_html` uses the browser probe when the app window exists and the static path in Node; it returns the
    import report. `ofini proto import <file> [--from] [-o] [--width] [--into <design> --in-place|--out]` (the
    concept's `<in> <out.ofini>` form is `-o`).
  * Limits (`IMPORT_LIMITS`): HTML 8 MiB, SVG 16 MiB, archives 256 MiB, 20,000 entries, 128 MiB per entry, 512 MiB
    unpacked and at most 200× the archive size above 64 MiB, 50,000 layers per import; media keep the 16 MiB schema
    limit.
  * Not done: the Figma REST importer (as planned, after 1.3.x); HTML from a URL (the web access tools can fetch it
    and pass it to `proto_write_html`); converting repeated structures into components automatically.

**T9 · Prototyping and the player** — L — deps: T4, T5
* Scope: interaction ops, Prototype mode and panel, Connect tool, expression evaluator, player runtime (navigation
  stack, overlays, scroll and sticky, transitions, smart animate with FLIP and WAAPI, springs), preview window
  (multi-window on the desktop), presenting in a room, HTML prototype export.
* Files: `app/src/engine/proto/{interactions,expr}.js`, `app/src/proto/player/*`, `app/src/proto/panels/prototype.js`,
  `tests/proto/{interactions,expr}.test.js`.
* Acceptance: the evaluator accepts only the data language (fuzz test); the exported prototype contains no external
  URLs (test) and works offline; smart animate at 60 fps for the 200-layer fixture (manual check in the PR).

**T10 · Live collaboration** — M — deps: T3
* Scope: `proto/collab.js` records adapter (section 13), `"proto"` in `LIVE_OFFICE_KINDS`, per-record validation,
  presence on the canvas (cursors, selections, follow), comment anchor kind `proto` with pins on the overlay.
* Files: `app/src/proto/collab.js`, `app/src/core/live-kinds.js`, `app/src/collab/anchors.js`,
  `tests/proto/collab.test.js`, `docs/collaboration.md`.
* Acceptance: convergence property test (thousands of seeded random concurrent histories through the adapter);
  malformed records rejected; two-window manual test over BroadcastChannel.
* As built (deviations and decisions the later tasks build on):
  * `proto/collab.js` (`protoCollabAdapter`) runs on the existing records engine (`collab/office-sync.js`, op kind
    `office`); `"proto"` is in `LIVE_OFFICE_KINDS` and `ui/collab/live.js` loads the adapter for the kind. Records as in
    §13 with these choices: the structure record `n:<id>` also carries `name`, `visible` and `locked`; `n:<id>/text`
    carries the content of every layer kind (`text`, `d`, `rule`, `alt`); `opacity` and `blend` are in `look`, `sticky`
    in `lay`, `tag`, `a11y` and `modes` in `proto`; fields this version does not know travel in `n:<id>/x`. A group
    record exists only when the layer has one of its fields. Values are canonical (sorted keys) and cached per node
    object, so unchanged layers cost nothing per flush.
  * Generic over the model (for T5 and later tasks): `COLLECTIONS` lists the id-keyed maps that sync per entry (`p:`
    pages, `vc:` `vars.collections`, `v:` `vars.items`, `s:` styles, `media:` media without bytes); every other
    top-level key (meta, breakpoints, code, and anything a later task adds) is one `meta:<key>` record, so new data
    syncs without code changes. A new id-keyed map that should merge per entry is one line in `COLLECTIONS`; a new node
    field is one entry in `GROUPS` (until then it travels in `n:<id>/x`). Components and instances are nodes, so T5's
    component operations sync through the node records as they are.
  * Validation: remote node records go through `validate.js ▸ nodeProblems`, the other records through `validate()` on
    the model without layers. Shape errors reject a record (when a layer fails as a whole its records are tried one by
    one, so one bad record does not hold back the others of the layer); reference problems (`missing-*`, cycles,
    limits, binding types) are accepted, because rejecting them depends on arrival order and would make replicas
    diverge, and the resolver treats them as warnings.
  * Tree repair, the same on every replica: layers of a missing page are hidden; layers whose parent is missing, is no
    container, is on another page, or is a component set while the layer is no component, go to the top level of their
    page (a move into a concurrently deleted frame keeps the layer); a parent cycle from concurrent moves is broken at
    the layer with the smallest id (the tree CRDT undoes the newest move instead, but the record adapter has no clocks).
    A text layer whose text record was removed by a concurrent delete while someone renamed it gets the default text.
    The children index is updated incrementally for the changed layers (`adoptIndex`), as `ops.js` does locally.
  * `office-sync.js` change for every adapter: records the model changed as a side effect of a remote op (not only the
    keys of the op) are compared with the view and retried when they differ. Without it, a layer that came back (undo
    of a delete) missed a group record that had survived in the view, and a repaired placement was never retried.
  * Undo: nothing new; the workspace's `opStep` replays the inverse on the current model, which keeps remote edits (the
    binding's `prj.rebase` hook is installed but the Proto history does not use it).
  * A snapshot opened by a late joiner still has the container fields; the adapter's `prepare` loads it
    (`format.js ▸ loadModel`) before the binding starts.
  * Presence: `proto/presence.js` publishes the Proto page, the pointer and the visible rect in world units and the
    selected ids (the existing presence message; `studio: "proto"`), draws the others' pointers and selection outlines
    in their colors through `view.overlay.addLayer` (added once per workspace by `ui/collab/overlay.js`, redrawn on
    presence changes), and *Follow* sets the page and the camera that fits the member's visible rect. The workspace
    needed no new hooks: the runtime listens to the stage's pointer events and to `ws.on("selection" | "camera" |
    "page")`.
  * Not done in T10 (added with T6): the comment anchor kind `proto` with pins on the overlay (comments on a Proto design are document
    comments for now); it needs the comment composer's canvas hooks, which T4 is changing, and follows as its own task.
  * Tests: `tests/proto/collab.test.js` (two and three peers with the real controller, shuffled delivery, late joiner,
    chunked media, malformed records, 300 seeded random histories in CI; 2,000 checked with `PROTO_COLLAB_SEEDS=2000`).
    Manual check: two tabs of the dev server in a *This device* room (share live, open live, concurrent fill and move
    of one layer, Undo of the fill in one tab keeps the other's move, pointer and selection outline of the other tab,
    Follow).

**T11 · Vibe tools, lint and skills** — M — deps: T5
* Scope: `vibe/tools/proto.js` with the tools of section 7 whose capability exists (describe, get, screenshot,
  search, create, update, move, delete, duplicate, component, variables, styles, lint, fix, tokens, responsive,
  content, rename, from_screenshot); `write_html`, `to_code` and `interaction` are added by T8, T7 and T9. Tool group
  and verify hints, `engine/proto/lint.js` with fixes, skill pack, studio guide.
* Files: `app/src/vibe/tools/{proto.js,index.js}`, `app/src/engine/proto/lint.js`, `app/src/ai/packs/proto.js`,
  `app/src/ai/packs/studio-guides.js`, `tests/proto/lint.test.js`, `tests/vibe/proto-tools.test.js`.
* Acceptance: every write tool is one undo step and validated; each lint rule has positive and negative fixtures; a
  scripted agent run (mock provider) builds a login screen with auto layout.
* As built (deviations and decisions the later tasks build on):
  * Modules: `vibe/tools/proto.js` (20 static definitions, group *Proto*, verify hint "proto_describe and
    proto_screenshot"), `proto/ai-ops.js` (pure: `describe`, `nodeLine`, `getNodes`, `search`, `createOps`,
    `updateOps`, `fieldsOf`, `names`, `renameOps`, `contentOps`, `responsive`), `proto/ai-render.js` (pure display list
    from the solver, `paintCanvas`), `proto/ai-runtime.js` (`protoTarget`, `renderImage`, `readImage`, `imageHints`) and
    `engine/proto/lint.js` (`lint`, `fixOps`, `suggestName`, `suggestTag`, `contrastRatio`). Like the Scene Studio's
    tools (`scene/ai-ops.js`), the pure part lives next to the studio, not in `vibe/`.
  * Commits: `protoTarget(app).run(ops, label)` applies a tool's operations as one `batch` through `app.protoUI.run`
    when the design is mounted (the same path as the editor), else through the same `opStep` undo step on the
    document history; labels are "Vibe: …". A failing operation throws the engine's `OpError` and nothing changes.
  * Specs: `createOps` turns nested specs with shorthands (sizes as numbers, "hug", "fill", "50%"; `layout: "row"`;
    `gap`, `pad`, `justify: "between"`; `fill`, `stroke`, `shadow: "md"`; text style keys; `{ "$var": name }`; type
    aliases row, column, stack, box) into `node.create` / `instance.create` operations with **pre-assigned ids**, so
    redo and collaboration replay the same ids and the tool can return them (`refs`). Nested frames default to a
    transparent column that hugs (a div), text layers without a name take their first words. Names of variables,
    styles and components resolve to ids everywhere.
  * Additions beyond the section 7 table: `proto_new` (a design from the tools, like `scene_new`); `proto_screenshot`
    has `compare` (side by side with a reference image and a mean pixel difference), which stands in for
    `visual_diff` on designs. Tool names `proto_variables` and `proto_styles` take an `action`, like `proto_component`.
  * Engine addition: the operation `media.put { id?, media | null }` (add, replace or remove one media item; the
    inverse puts the previous item back; bytes are shared, never copied). `proto_from_screenshot` uses it for the
    reference image; the Image tool of T4 and the importers of T8 can use it too.
  * Screenshots: the canvas DOM cannot be rasterized portably (an SVG foreignObject taints the canvas in WebKit and
    loses the app fonts), so `proto_screenshot` paints the solver's boxes (fills, gradients, images, strokes, drop
    shadows, blur, text lines with the app's fonts and the canvas measurer) and says it is approximate. In Node the
    tools work without it (it needs the app window).
  * Lint rules (`RULES`): contrast (WCAG 2, against the composited solid backgrounds; gradients and images skip),
    touch-target (under 24 px warning, under 44 px info; interactive = tag, a11y role, click interaction or a
    button-like name), unbound-color and unbound-spacing (only when variables exist; a value equal to exactly one
    variable gets a `node.bind` fix), off-grid (gap and padding off 4 px), detached-style (local values equal to a
    style), inactive-override (`components.overridePaths`), detached-instance (a frame named like a component; the
    fix replaces it with an instance and runs only when its id is named), empty-frame, naming (default names with a
    suggested name), overflow-text (fixed text boxes, text past a clipping container), unused-token (variables and
    styles nobody uses; deleting runs only when named). Layers inside instances are reported by key and never fixed
    directly. Touch targets, overflow and contrast use the solver, so they are approximate in the same way.
  * Skills: lazy pack `proto` (`app/src/ai/packs/proto.js`): proto-screen-from-brief, proto-screen-from-screenshot,
    proto-component-variants, proto-tokens-dark-mode, proto-handoff, proto-design-audit; *prototype a flow* follows
    with T9. Studio guide `studio-guide-proto`; the system prompt note, compact tool list (context `proto`), plan_work
    studio `proto` and the sub-agent tool set `proto` know the studio.
  * OCR in `proto_from_screenshot` uses only local engines of the registry (no data leaves the device); colors and
    text need the app window.

**T12 · MCP server** — L — deps: T7, T11
* Scope: `engine/proto/mcp/` handler (lifecycle, tools, resources with subscribe, prompts), app document host, file
  host, `src-tauri/src/mcp_server.rs` (loopback HTTP, token, Host and Origin checks, limits, event bridge), Settings
  UI (enable, port, token, approved clients, copyable client configurations), approval prompt, AI log entries,
  `ofini mcp` (stdio proxy and headless file mode).
* Files: `app/src/engine/proto/mcp/*`, `app/src/proto/mcp-host.js`, `app/src/ui/vibe/settings-mcp-server.js`,
  `src-tauri/src/{mcp_server.rs,lib.rs}`, `cli/lib/mcp.mjs`, `tests/proto/mcp.test.js`, Rust unit tests,
  `docs/security.md`, `docs/proto-studio.md`.
* Acceptance: handler conformance in Node (initialize, tools/list, tools/call errors, resources, subscribe); a stdio
  session against the headless file host; Rust tests for the Host, Origin and token checks and the size limits;
  manual connection from Claude Code and Cursor described in the PR.

**T13 · CLI `ofini proto`** — M — deps: T5
* Scope: `cli/lib/proto.mjs` with `info`, `tree`, `validate`, `lint` (schema checks; design rules once T11 is
  merged), `render` (SVG through the solver), `assets` (SVG and embedded media), `diff`; help, completion,
  `ofini new proto`. T7 adds `export` and `tokens`, T8 `import`, T12 `ofini mcp`.
* Files: `cli/lib/{proto.mjs,main.mjs,completion.mjs}`, `tests/packaging/ofini-proto.test.js`, `docs/cli.md`.
* Acceptance: every command runs in plain Node on the fixtures; `--json` shapes tested; exit codes as ADR 0032.
* As built (deviations and decisions the later tasks build on):
  * Modules: `cli/lib/proto.mjs` (the command table `PROTO_COMMANDS`, a command group: `main.mjs` dispatches the
    first word after `proto` and parses that subcommand's options; help, completion and the interactive mode know
    groups), `proto-model.mjs` (reading designs from `.ofini`, `document.json` or a bare model; writing back the same
    container; page, layer and mode lookups; `withModes`), `proto-svg.mjs` (`renderSvg`), `proto-lint.mjs`
    (`LINT_RULES`, `lintModel`, `applyFixes`) and `io.mjs` (the file helpers moved out of `main.mjs`). No engine
    module changed. T7 adds `export` to `PROTO_COMMANDS`, T8 `import`.
  * Beyond the scope: `inspect` (raw and resolved layers, CSS, solver box), `tokens` and `tokens import` (moved here
    from T7 because `tokens.js` exists: DTCG, CSS, Tailwind, Swift and plain JSON values), `apply` (engine operations
    from JSON, standard input or `--ops`, one batch, `--seed` for reproducible ids), `validate --strict`.
  * The SVG render lays out the layer inside its top-level layer and draws from the resolved fields (not from the CSS
    declarations); it is approximate (base-14 metrics; conic gradients as their first color; no inner shadows, shadow
    spread by growing the outline, no background blur; per-side strokes ignore radii). PNG exits 4. `--mode` is set on
    the top-level layer, because a layer's own `modes` win over the resolver's `modes`.
  * Lint rules until T11's `engine/proto/lint.js`: `schema`, `unresolved`, `stale-override` (fix: `instance.reset`
    with the path), `text-overflow`, `clipped`, `touch-target` (24 px, WCAG 2.5.8), `empty-frame`; the geometry rules
    are marked approximate; SARIF 2.1.0 output. T11 can add its rules to `LINT_RULES` / `lintModel`.
  * Assets: no layer field marks layers for export yet, so `assets` writes every vector layer (or the `--node` layers).
  * Writing a changed design needs `--out`, `--in-place` (atomic rename, no backup) or `--dry-run`; `lint --fix`
    defaults to `<name>.fixed.ofini` like the Doctor's `.repaired` copies.

**T14 · Code studio live link** — M — deps: T6, T7
* Scope: tokens file link with two-way sync (10.2), export into a Code project with guarded regions and hash checks
  (10.3), live link mode, gutter badges in the Code studio, *Open in Proto* and *Open in Code*, importing selected HTML
  from the Code studio into Proto (uses T8 when merged).
* Files: `app/src/proto/code-link.js`, `app/src/ui/code/proto-link.js`, `app/src/engine/proto/regions.js`,
  `tests/proto/regions.test.js`, `docs/code-studio.md`.
* Acceptance: region merge tests (unchanged, edited by hand, markers removed); a token edit in either studio appears in
  the other within 1 s; nothing is written outside markers.

## 16. Open questions

* **Name.** Decided: **Proto Studio** (final; the studio id and document kind are `proto`).
* **Libraries across files.** Publishing components from one `.ofini` to others (reserved `lib:` references) needs a
  library cache and update notifications; after 1.3.x.
* **Variable fonts and OpenType features** in the Design panel: CSS supports them; UI scope to be decided in T4.
* **Vector networks** (Figma) versus SVG paths: Proto keeps SVG paths (what code can express).
* **Penpot format stability.** Penpot's export format has changed between major versions; the reader targets the
  current format and states its version.
* **Figma REST importer.** Needs a terms review; may be dropped if the terms forbid this use.

## 17. Sources

Public pages consulted (November 2026); product names are trademarks of their owners.

* Figma MCP server and write to canvas: <https://developers.figma.com/docs/figma-mcp-server/>,
  <https://developers.figma.com/docs/figma-mcp-server/write-to-canvas>
* Penpot MCP server and features: <https://penpot.app/ai/mcp-server>, <https://penpot.app/design>
* Paper: <https://paper.design/>, <https://paper.design/docs/mcp>
* Sketch MCP server: <https://www.sketch.com/docs/mcp-server/>, <https://www.sketch.com/blog/sketch-in-2025/>
* Design Tokens Community Group format: <https://www.designtokens.org/>
* Model Context Protocol specification (2025-11-25), security best practices: <https://modelcontextprotocol.io/specification>
* Figma `.fig` format notes (why we do not read it): [file-format-research.md](../file-format-research.md)
