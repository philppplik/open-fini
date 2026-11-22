# ADR 0033: Docking layout with our own small engine: a pure layout tree plus a DOM renderer

- Status: Accepted
- Date: 2026-11-22
- Related: [docs/workspaces.md](../workspaces.md), [docs/customization.md](../customization.md), [docs/multi-window.md](../multi-window.md)

## Context

Up to 1.1.3 every design studio (Vector, Pixel, Layout) and the right side of the Code studio had one fixed dock: a
column on the right with two tab areas (`top` and `bottom` panel lists in `studios/index.js`, rendered by
`ui/dock.js`). Settings could hide panels, move the dock to the left and change its width, and named "workspaces"
stored exactly those three things. Users coming from Photoshop, Illustrator or Affinity expect a flexible workspace:
drag a panel by its tab to dock it elsewhere, merge panels into tab groups, float them, resize splitters, collapse a
dock to icons, and save the arrangement as a workspace.

Constraints:

* No framework (ES modules + Shoelace). Start-up JavaScript is budgeted (`scripts/size-budget.json`, 353 KiB gzip,
  with almost no headroom), so whatever we add must load lazily.
* Panels must keep their state when they move (Layers selection, Color picker, Brush settings, the lazily loaded
  Histogram worker) — the DOM of a panel is created once and moved, never rebuilt.
* Theming: light/dark, glass and sea surfaces, high contrast, reduced motion, German at 100 %.
* Layouts are stored in the preferences (`layout`, `workspaces`) and must survive unknown or removed panel ids
  (extensions come and go), damaged JSON and other window sizes.

Options:

1. **dockview-core** (MIT, vanilla TypeScript, about 50 KiB gzip with its CSS) or **GoldenLayout 2** (MIT, about
   45 KiB gzip, needs its own theme). Both are capable, but each is several times the size of what we need, brings its
   own DOM structure and class names (our `.of-dock__tab` styles, glass rules, tour and help selectors would have to
   be rewritten or overridden), its own serialization format and its own idea of panel lifecycles (dockview recreates
   panel bodies on some moves unless configured carefully; GoldenLayout's virtual components need extra glue). Both
   would need THIRD_PARTY_NOTICES entries and a vendored copy.
2. **Our own engine**: a pure layout tree with tested operations, plus a renderer that reuses the existing dock markup.

## Decision

Option 2. The engine is three small modules in `app/src/ui/docking/`:

* `model.js` — pure data and functions, no DOM. A layout has three dock regions around the canvas (`left`, `right`,
  `bottom`; each a tree of row/column splits whose leaves are tab groups, plus a size in px and a collapsed flag), a
  list of floating groups with rectangles, and an optional maximized group. Operations return new normalized layouts:
  `movePanel`, `moveGroup`, `addPanels`, `removePanels`, `reorderTab`, `setActive`, `setSizes`, `setRegionSize`,
  `setCollapsed`, `setMaximized`, `setFloatRect`, `raiseFloat`, `mirror`, `fromSpec`, `reconcile`. `normalize` is also
  the JSON loader: it drops unknown and duplicate panels, empty groups and one-child splits, flattens nested splits of
  the same direction, fixes shares, ids and sizes, and clamps floating rectangles to the window.
* `presets.js` — the built-in arrangements per studio. Which panels a built-in workspace shows stays in
  `customize/toolbox-model.js` (`builtinWorkspaces`, a `hidden` list plus a `preset` id), so the settings code and the
  docking engine agree.
* `view.js` — the renderer: tab groups (`role="tablist"`/`tab`/`tabpanel`), splitters (`role="separator"`), the inner
  edge of each region, icon strips with fly-out panels, floating groups, drop guides, Pointer Events dragging (mouse,
  pen, touch), a keyboard move mode, the Window menu and the workspace commands (save, rename, delete, reset, export,
  import).

`ui/dock.js` stays in the start-up bundle as a thin facade that creates the three host elements and loads the engine
right after start-up; calls made before it arrives are queued. Because the panel modules are now imported by the
engine, they left the start-up bundle too (start-up JavaScript went down by about 16 KiB).

The stored state per studio is the old `{ hidden, side, width }` plus `preset` (built-in arrangement), `dock` (the
layout tree, only when it differs from the preset) and `ws` (the workspace it was applied from, for "Reset"). Old
preferences keep working unchanged: without `dock` the layout is built from the preset, `side` mirrors it and `width`
sizes it. Closing a panel adds it to `hidden`, reopening removes it and `reconcile` puts it back next to a panel it
shared a group with in the preset — so panels that an extension or a later version adds show up by themselves.

Tear-off into a separate native window is not part of this decision: the panels are live views of the in-memory
document in the main window, and the existing multi-window code (docs/multi-window.md, `ui/popout.js`) moves whole
documents or studios between windows, not individual views. A torn-off panel would need a document mirror and a
command channel per panel. Floating panels stay inside the window; tear-off is a follow-up.

## Consequences

* About 9 KiB gzip of JavaScript and 2 KiB of CSS, all outside the start-up bundle; no new dependency.
* The tree operations are unit-tested in Node (`tests/ui/docking.test.js`), including normalization of hostile JSON
  and the guarantee that every built-in workspace only references registered panels.
* Studios that own their whole workspace (Code's left sidebar and bottom panel, Vibe, Office apps, Scene) are not
  migrated yet; they keep their own layouts. Registering their panels with `ui/panels/index.js` and listing them in
  `studios/*.js` is enough to bring them into the docking engine later.
* The old "Move to the other area" panel menu entry is replaced by Dock Left / Dock Right / Dock Bottom / Float.
