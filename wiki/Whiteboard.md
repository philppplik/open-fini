# Whiteboard

The Whiteboard is the Office studio's infinite canvas for sketches, sticky notes, flowcharts and handwritten notebooks. It opens and saves Excalidraw (`.excalidraw`) and tldraw (`.tldraw`) files and exports PNG, SVG and PDF. Everything runs locally.

## Getting started

- **New:** Office *Home* ▸ *Whiteboard*, or a template: Blank, Brainstorm, Kanban board, Flowchart, Notebook.
- **Open:** *File ▸ Open…*, drag and drop, or *Open with* for `.excalidraw` and `.tldraw`. *File ▸ Save* writes that format again; the import report lists what changed.
- **Export:** *Board ▸ Export As*: Excalidraw, tldraw, PNG or SVG (current page), PDF (all pages).

## Tools

| Key | Tool | Key | Tool |
| --- | --- | --- | --- |
| `V` | Select, move, resize, rotate | `R` `O` `D` | Rectangle, ellipse, diamond |
| `H` or `Space`-drag | Pan | `L` `A` | Line, arrow (connects shapes and follows them) |
| `P` | Pen (pressure-aware) | `T` | Text |
| `M` | Highlighter | `N` | Sticky note |
| `E` | Eraser | `I` | Image (paste and drop work too) |
| `K` | Laser pointer | `F` | Frame |
| `C` | Comment | `Ctrl+\` | Sidebar |

`Delete`, `Ctrl+D` duplicate, `Ctrl+G` group, `Ctrl+]` / `Ctrl+[` order, `Shift+1` zoom to fit, `Ctrl`+wheel or pinch to zoom. Double-click a shape, note or arrow to type a label.

- **Hand-drawn or clean:** the feather button switches between sketchy strokes and exact geometry.
- **Pages:** the bar below the canvas adds, renames and deletes pages and sets the paper (plain, dotted, squared, lined), like a notebook.
- **Arrange:** align, distribute, z-order, group, lock, *Arrange as Flowchart*.
- **Stylus:** pressure shapes the ink; after the first pen contact, fingers only pan and zoom (palm rejection).

## Comments

Press `C` and click an element or the board (or right-click ▸ *Add comment*). The pin follows its element when it moves; if the element is deleted the pin stays where it was, and undo re-attaches it. Click a pin to reply, edit, resolve or reopen; drag your own pin to move it. Pins merge into a numbered cluster when they overlap; click it to zoom in. Comments are saved in the document, work without a collaboration room and sync when you are in one. Pins never appear in exports.

## Sidebar

*View ▸ Sidebar* or `Ctrl+\` opens a resizable panel on the right (a drawer on narrow windows) with four tabs:

- **Comments:** all threads with Open / Resolved / Mine / This page filters, search and unread marks; click a row to jump to the pin.
- **Outline:** pages and elements (frames with their contents): select, rename, hide, lock, zoom to, drag to reorder.
- **Properties:** position, size, angle, colors, line, text and arrowheads of the selection.
- **Library:** shapes and sticky notes to click or drag onto the board.

## Working together and Vibe

*Edit together* shares every element as its own record, so people can move different shapes at the same time. Comments sync through the room. Vibe can describe the board, list and add comments, add shapes, sticky notes, text and connectors, rearrange them and import or export Excalidraw / tldraw JSON (`board_` tools, [[Vibe Tools Reference]]).

## Limits

Some formatting is simplified on export: tldraw has a fixed color palette and sizes, Excalidraw has no sticky notes or pages (pages become frames). Curved and elbow connectors, user shape libraries and remote cursors are not available.

## See also

- [[Office Studio]]
- [[File Formats]]
- [[Save in Original Format]]
- [[Collaboration]]
