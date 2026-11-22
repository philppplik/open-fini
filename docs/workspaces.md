# Panels, docking and workspaces

The panels of every studio live in a flexible workspace, much like Photoshop or Illustrator: Vector, Pixel and Layout
(Color, Brush, Adjust, Transform, Appearance, Type, Layers, History, Histogram, Info, Navigator, Pages, Styles, Data,
Comments), Code (Explorer, Add, Navigator, Search, Source Control, Assets, Libraries on the left; Style, Settings,
Comments on the right; Problems, Console, Terminal below), Scene (Media, Effects, Inspector), Vibe (Chats, Canvas,
Activity) and the Office apps (Document: Outline, Styles; Presentation: Slides; Whiteboard: Comments, Outline,
Properties, Library). Until you move something it looks as before: the design studios keep one column on the right
with two tab groups, the others their familiar places. Each Office app has its own layout and its own workspaces. Design: [ADR 0033](adr/0033-docking-layout.md).

## User guide

### Dock, tab and float by dragging

Drag a panel by its **tab** (mouse, pen or touch). While you drag, a highlighted guide shows where it will land:

| Drop on … | Result |
|---|---|
| the tab row of a group | the panel becomes a tab of that group, at that position (reorder tabs the same way) |
| the middle of a group | the panel becomes a tab of that group |
| the left, right, top or bottom part of a group | the group splits and the panel docks beside it |
| the left or right edge of the window | a new dock column at that edge |
| the bottom edge of the canvas | the bottom dock (under the canvas) |
| anywhere else (the canvas) | the panel floats in its own small window |

Drag the **empty end of a tab row** to move the whole group with all its tabs. A floating group moves the same way and
docks again when you drop it on a guide. Press **Escape** while dragging to cancel. Resize a floating group with its
lower-right corner.

### Resize, collapse, maximize

* Drag the thin bars between groups to share space, and the inner edge of a dock (next to the canvas) to make the
  whole dock wider or taller. Both work with the arrow keys when focused.
* **Collapse to icons**: *Window ▸ Collapse Right Dock to Icons* (or the group menu, or double-click the empty end of a
  tab row). The dock becomes a strip of panel icons; click an icon to fly the panel out, click outside or press Escape
  to close it, and click the double arrow at the top to expand the dock again.
* **Maximize group** (group menu, the `…` button at the end of each tab row): the group fills its dock; *Restore
  Group* brings the others back.

### Close and reopen panels

*Window* lists every panel of the studio with a check mark for the visible ones. Untick to close a panel, tick to bring
it back: it returns next to the panels it was grouped with in the workspace. *Close* is also in the group menu and the
right-click menu of a tab. Opening a panel from elsewhere (for example *Comments* or the Data panel of the Layout
studio) reopens it the same way.

### Workspaces

*Window ▸ Workspace* switches between workspaces and manages them:

| Command | What it does |
|---|---|
| a workspace name | applies it (the check mark shows the current one) |
| Save as New Workspace… | saves the current arrangement under a name (at most 24 per studio) |
| Rename Workspace… / Delete Workspace… | for your own workspaces |
| Reset *name* | puts the panels back where the workspace keeps them |
| Reset All Workspaces… | resets the arrangement of every studio; your saved workspaces are kept |
| Export Workspace… / Import Workspace… | a `.json` file to share or back up; importing adds it as a new workspace of the same studio |

Built-in workspaces:

| Studio | Workspaces |
|---|---|
| Vector | Essentials, Typography (type and appearance over layers and history), Minimal (layers only) |
| Pixel | Essentials, Photography (histogram/info/navigator, adjustments/color, layers/history), Painting (brush docked on the left, color and layers on the right) |
| Layout | Essentials, Typography, Data, Review (comments over pages and history) |
| Code | Essentials (Explorer and friends on the left, style panels on the right, Problems/Console/Terminal closed until Ctrl+J), Review (Explorer and Source Control, comments first, Problems below), Focus (editor and Explorer only) |
| Scene | Essentials (Media and Effects left, Inspector right), Motion (Effects and a wider Inspector), Audio (Media and Inspector) |
| Vibe | Essentials (Chats left, Canvas and Activity right) |
| Office: Document | Essentials (Outline and Styles left), Review (Outline only) |
| Office: Presentation | Essentials (Slides left) |
| Office: Whiteboard | Essentials (the four panels tabbed on the right, closed until opened), Review (Comments and Outline) |

A workspace stores the full arrangement: docks, splits and sizes, tab groups and the front tab, floating rectangles,
collapsed docks and closed panels. Workspaces are kept with your other preferences (and in profile files, see
[customization.md](customization.md)). *Settings ▸ Layout and workspaces* shows the same list and can still hide panels,
put the dock on the left and set its width; changing the side or the width starts again from the workspace
arrangement.

Layouts are repaired when they load: panels that no longer exist (for example from a removed extension) are dropped,
new panels appear at their usual place, and floating panels are moved back into view on a smaller window.

### Keyboard and accessibility

* Panel tabs are buttons in a `tablist`: **Left/Right**, **Home/End** switch tabs; the body is the `tabpanel`.
* **Ctrl+Shift+M** on a focused tab (or *Move Panel…* in the group menu or the tab's context menu) starts the
  keyboard move mode: **arrow keys** or **Tab** step through every place the panel can go (each one is highlighted and
  announced), **Enter** moves it, **Escape** cancels. Focus returns to the moved tab.
* The group menu and the tab context menu also offer *Dock Left*, *Dock Right*, *Dock Bottom* and *Float*.
* Splitters and dock edges are focusable `separator`s with arrow-key resizing.
* Drop guides animate only when motion is allowed (reduced motion turns it off). Light and dark themes, glass and
  sea surfaces and high contrast apply to docks, floating panels and fly-outs.

## Developer guide

### Registering a panel

Panels are registered in `app/src/ui/panels/index.js` (or by an extension through `contributes.panels`):

```js
import { registerPanel } from "../ui/panels/index.js";
registerPanel("my-panel", {
  title: "My Panel", // English; shown in tabs, the Window menu and fly-outs
  icon: "stars", // Bootstrap icon name, or "of:name" for the app's own icons
  create: (app) => ({ el, show() {} }), // called once; `el` is moved between docks, never rebuilt
});
```

Then add the id to a studio's `top` or `bottom` list (`app/src/studios/index.js`, or `registerStudio`). Those lists are
the studio's panel set and, without more, its Essentials arrangement (top group over bottom group, on the right). A
studio can instead give an `essentials` spec (`{ left, right, bottom: [[ids]], sizes }`, same shape as a preset) and a
`closed` list of panels that start closed. A studio whose apps have their own panels (Office) lists them in `docks`
and names the active one with `dockApp(app)`; the layout key is then `office:board` (`dockKeyOf(app)`, `dockDef(key)`
in `studios/registry.js`).

**Panels with per-document content.** The Code workspace, the Scene editor, the Office apps and Vibe are created per
document, but a panel is created once. Register such a panel as a *slot panel* (`slotPanel("id")` in
`panels/index.js`) and publish the content from the studio instance with `setPanelSlot(app, "id", { el, show? })`
(`ui/panels/slots.js`; `null` takes it back). The element is moved, never rebuilt, so scroll, inputs and listeners
survive a move. `app.dock.isOpen(id)`, `app.dock.reveal(id)`, `app.dock.hidePanel(id)` and
`app.dock.toggleRegion("left")` let the studio react to the layout. `show()` is called when the panel
becomes visible (front tab, fly-out, after a move), so a panel can refresh lazily. Keep panel state in the panel
object, not in the DOM position: the element may be detached while the panel is a background tab or its dock is
collapsed.

For a lazily loaded panel use the `lazyPanel(() => import(...))` helper in `panels/index.js`.

### Built-in workspaces

`customize/toolbox-model.js ▸ builtinWorkspaces` lists each studio's workspaces (name, description and which panels
are hidden), and a `preset` id that names the arrangement in `ui/docking/presets.js ▸ PRESETS`:

```js
pixel: { photography: { right: [["histogram", "info", "navigator"], ["adjustments", "color"], ["layers", "history"]], shares: { right: [0.3, 0.3, 0.4] } } }
```

Each region lists its tab groups (left and right stack them in a column, bottom puts them in a row); `sizes` sets the
region size in px. `tests/ui/docking.test.js` checks that every preset only uses registered panels and shows exactly
the panels its workspace keeps visible.

### The model

`ui/docking/model.js` is pure and tested in Node. A layout is
`{ v: 1, regions: { left|right|bottom: { root, size, collapsed } }, floating: [{ x, y, w, h, group }], maximized }`,
where `root` is a tree of `{ type: "split", dir: "row"|"column", children, sizes }` and
`{ type: "group", id, panels, active }`. Every operation returns a new normalized layout; `normalize(raw, { known,
viewport })` is the loader for stored or imported JSON. `ui/docking/view.js` renders it into the hosts created by
`ui/dock.js` and stores changes through `app.customize.setLayout(studio, { ..., dock })`.

Preferences: `layout[studio] = { hidden, side, width, preset?, dock?, ws? }` and `workspaces[studio][name]` with the
same shape (without `ws`); `dock` is only stored when the arrangement differs from the workspace preset.

### Not built

The Scene timeline and the Code editor and preview stay in the central area (the engine's central area is the canvas), the
Spreadsheet has no side panels, and tearing a panel off into its own desktop window is not built (see
[ADR 0033](adr/0033-docking-layout.md) and [known-limits.md](known-limits.md)).
