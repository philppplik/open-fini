# Vector Studio

The Vector studio is for logos, icons, illustration and interface design: Bezier paths, parametric shapes, boolean operations, gradients, live effects and text, with SVG in and out. Shortcuts shown are the defaults on [[Keyboard Shortcuts]]; `Mod` is `Ctrl` or `Cmd`.

## Tools

| Tool | Key | Notes |
| --- | --- | --- |
| Move | `V` | Click, marquee, drag, scale and rotate handles. Double-click a group to enter it, `Esc` leaves. `Alt`-drag copies. Arrow keys nudge (`Shift` = 10x). |
| Node | `A` | Move anchors and handles; click a segment to drag it; double-click a segment to insert a node; double-click a node to toggle smooth or sharp. Buttons for node type, join, break, delete. |
| Pen | `P` | Click for corner nodes, click-drag for smooth nodes (`Alt` breaks the handle), click the first node to close, `Enter` or double-click to finish, `Backspace` removes the last node. |
| Pencil | `N` | Freehand with adjustable smoothing; ending near the start closes the shape. |
| Rectangle | `M` | Drag to draw; `Shift` = square, `Alt` = from center. Click for a default size. |
| Ellipse | `E` | Same modifiers. |
| Polygon, Star, Shapes (17 presets), Line | see [[Keyboard Shortcuts]] | Tool group in the toolbox. |
| Text | `T` | Click for artistic text, drag for a frame. In-canvas editor, IME aware. |
| Gradient | `G` | Drag on an object; edit start and end points; double-click the line to add stops. |
| Fill | `F` | Applies the current fill to the clicked object (`Alt` removes it). |
| Color picker | `I` | Samples the composited color (`Shift` applies it to the selection). |
| Hand, Zoom | `H`, `Z` | Navigation. |
| Slice | `S` | Draws export slices (see [[Export and Publish]]). |
| Crop | `C` | Crops the page; `Enter` applies. |

## Panels

**Appearance** (fill, stroke, shape parameters, effects), **Transform** (position, size, rotation, align, arrange), **Color** (picker and swatches), **Type**, **Layers**, **History**, **Navigator**.

## Styling

- **Fills and strokes:** solid, linear, radial and conical gradients on both; stroke alignment, caps, joins and dashes.
- **Opacity and blend:** opacity plus 16 blend modes.
- **Live effects:** outer and inner shadow, outer and inner glow, outline, color overlay, Gaussian blur. They stay editable.
- **Type:** character and paragraph controls, artistic text and frames, and your own font files (*Add font file…* in the Type panel; one file per family).

## Shape menu

| Command | What it does |
| --- | --- |
| Convert to Curves (`Mod+Enter`) | Turns a parametric shape or text into editable paths |
| Expand Stroke | Turns a stroke into a filled outline |
| Add, Subtract, Intersect, Exclude, Divide | Boolean operations (destructive; undo restores) |
| Trace Image to Vector… | Image trace of a pixel layer |

## Snapping, guides and rulers

Snapping covers guides, objects, grid and margins. Rulers (`Mod+R`), grid (`Mod+'`) and guides (`Mod+;`) toggle; drag from a ruler to create a guide. Align and distribute are in the Transform panel. Transform handles work on rotated objects.

## Import and export

SVG in and out; PNG, JPEG, WebP and PDF out. SVG import ignores filters, masks, clip paths and patterns (reported as notes); SVG export flattens live effects it cannot express. Details: [[File Formats]] and [[Export and Publish]]. A single-page plain vector drawing opened as `.svg` saves back as `.svg` ([[Save in Original Format]]).

## Limits

No live compound shapes, symbols, gradient mesh, shape builder, offset tool, vector brushes, path-on-text or clipping to text. Color is sRGB only. See [[Roadmap and Known Limits]].

## Vibe

The assistant can draw shapes, text and paths, restyle, align and run boolean operations through tools such as `add_shape`, `add_text`, `set_style` and `apply_to_many` ([[Vibe Tools Reference]]).

## See also

- [[Studio Overview]]
- [[Pixel Studio]]
- [[Layout Studio]]
- [[Keyboard Shortcuts]]
- [[File Formats]]
