# Proto Studio (Labs preview)

Design application interfaces and prototypes on a canvas that is real HTML and CSS. The design reasons are in
[ADR 0034](adr/0034-proto-studio.md); the full plan, the document model and the build tasks are in the
[concept](concepts/proto-studio.md). This page is the user guide and grows with every task of the plan.

> **Preview.** Proto is being built in steps during the 1.3.x releases. Until the preview ends it is reachable only
> with **Settings ▸ Labs ▸ Proto Studio**. What is there today: the canvas, frames, selection, the Layers panel, a
> read-only Inspector, undo, and saving. Drawing tools, the Design panel, components, variables, prototyping, code
> export and the assistant follow.

## Turning it on

Open **Settings ▸ Labs** and turn on **Proto Studio**. The studio appears at once in the studio switcher (in the
*More* menu when the header already shows five studios), in **File ▸ New** (*Proto* creates a design with one
desktop frame) and in **File ▸ New Blank** (*Blank Proto Design*, an empty page). Turning the switch off takes effect
at the next start; designs you made stay ordinary files. Opening a design while the switch is off offers to turn it on.

## Designs and files

A design is an ordinary `.ofini` document (kind `proto`, see [file format](file-format.md#proto-designs)). Save,
Save As, autosave, session restore and the History panel work as for every other document; every change is one undo
step. A design saved by a newer version of OpenFini, or one with problems, opens read-only with a notice (Help ▸
Doctor lists the problems).

## Canvas

| Action | How |
| --- | --- |
| Select a layer | Click it. A click inside a frame selects the frame's layer under the pointer; with a layer selected, clicks select among its siblings. The frame's own background selects the frame. |
| Select the deepest layer | Ctrl-click (Cmd-click on macOS) |
| Add to or remove from the selection | Shift-click |
| Select several frames | Drag on the empty canvas (marquee); Shift keeps the current selection |
| Select all | Ctrl+A: the siblings of the selection, or every frame of the page |
| Children / parent | Enter selects the children of the selection, Shift+Enter or Escape its parent |
| Pan | Scroll (Shift+scroll: sideways), hold Space and drag, or drag with the middle mouse button |
| Zoom | Ctrl+scroll or pinch around the pointer; + and − step; Shift+0 is 100 %, Shift+1 fits everything, Shift+2 fits the selection |
| Delete, duplicate | Delete or Backspace; Ctrl+D |
| Add a frame | Insert ▸ Desktop Frame or Phone Frame: placed to the right of the page's frames and selected |

Frame names are drawn above the frames. Far zoomed out, small frames are drawn as simplified boxes until you zoom in
again; that keeps very large pages smooth.

## Panels

The panels dock like everywhere else ([workspaces](workspaces.md)).

* **Layers** (left): the layers of the page, top of the list = in front. Click selects, Shift-click and Ctrl-click
  add; the arrow opens a frame; the arrow keys move through the list; a double click zooms to the layer.
* **Inspector** (right): name, type, position and size of the selection. Editing comes with the Design panel.

## For developers

Code: `app/src/studios/proto.js` (definition, menus, Labs switch), `app/src/proto/` (host, workspace, renderer) and
the pure engine in `app/src/engine/proto/`. The renderer and its performance are described in the concept
([§4](concepts/proto-studio.md#4-rendering)); `node scripts/proto-perf.mjs` measures the targets of §4.3 in a headless
Chromium-based browser, and `tests/proto/perf/bench.html` runs the same benchmark by hand in any browser
(`node scripts/serve.mjs --root .`, then open `/tests/proto/perf/bench.html`).
