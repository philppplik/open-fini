# Presentation App

The Presentation app is part of the [[Office Studio]]. It creates slide decks, opens PowerPoint (`.pptx`) and
OpenDocument (`.odp`) presentations, saves them back in their format, exports PDF and PNG, and presents full screen.

## Create a deck

1. Switch to the **Office** studio and choose **Home** (or **File ▸ New**).
2. Pick **Presentation**, then **Blank presentation**, **Pitch deck** or **Report**.

To open an existing deck, use **File ▸ Open** or drop the file onto the window. `.pptx`, `.ppsx`, `.odp` and `.fodp`
open for editing; `.potx` and `.otp` templates open as a new deck. Old `.ppt` files have to be saved as `.pptx` first.
After opening, **Details** in the notification lists what could not be kept (for example charts or animations).

## Edit slides

* **Slides panel** (left): click a slide to edit it, drag to reorder, right-click for new, duplicate, delete, hide and
  move. **View ▸ Slide Sorter** shows every slide as a grid.
* **Canvas**: click an object to select it (Shift adds to the selection, drag on empty space selects an area). Drag to
  move, use the square handles to resize and the round handle to rotate. Double-click text to type; **Esc** finishes.
* **Ribbon**: new slide with a layout, layouts, text box, shapes, pictures, tables, text formatting, fill and outline
  colors, arrange and align, theme, background and transition.
* **Speaker notes**: type below the slide.

Every change can be undone with **Ctrl+Z**.

## Present

| Keys | Action |
| --- | --- |
| F5 | Present from the beginning |
| Shift+F5 | Present from the current slide |
| Alt+F5 | Presenter view (current slide, next slide, notes, timer) |
| → Space Enter | Next slide |
| ← Backspace | Previous slide |
| B / W | Black / white screen |
| P | Toggle the presenter view |
| Esc | End the show |

Hidden slides are skipped.

## Save and export

* **File ▸ Save** writes an opened `.pptx` or `.odp` back in its format. An OpenFini document (`.ofini`) keeps
  everything.
* **Slide ▸ Export Presentation…** writes PowerPoint, OpenDocument, PDF, PNG images of every slide (ZIP), or the
  current slide as PNG.

## AI

With Vibe you can ask, for example, "add a slide about pricing with three bullets" or "use the midnight theme". Vibe
uses the `slides_` tools; each step can be undone.

## Limits

One text style per text box, no charts, SmartArt, animations or video, and built-in layouts only. See
`docs/office-slides.md` in the repository for details.

## See also

- [[Office Studio]]
- [[Save in Original Format]]
- [[File Formats]]
- [[Vibe Tools Reference]]
