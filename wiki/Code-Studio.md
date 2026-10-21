# Code Studio

The Code studio builds websites inside an OpenFini document. It combines a real code editor and a visual designer over the same HTML, CSS and JavaScript files. The files are the only source of truth: visual actions are written as minimal text edits (your formatting and comments survive), and typing in the editor updates the canvas immediately. Open it with `Alt+4`, the Code button in the header, or *Studio ▸ Code Studio*.

## Getting started

- **New website:** *File ▸ New*, choose Code. Pick Blank, Landing page, Portfolio, Blog, Documentation or Link in bio, or a framework starter ([[Frameworks and Libraries]]).
- **Open files or a folder:** Markdown, LaTeX, JSON, YAML and other text files open as one-file projects; folders keep their structure ([[Markdown and LaTeX]]).
- **Import:** *Import a folder…* or *Import files…* on the start screen, or drag a folder onto the Explorer.
- The project is stored inside the `.ofini` file (`web/files/…`), next to your design pages, so one file holds the artwork and the site.

## Workbench

| Area | What it does |
| --- | --- |
| Activity bar | Explorer, Add elements, Navigator, Search, Source Control, Assets, Libraries, Settings |
| Explorer | Create, rename (`F2`), move, duplicate, delete, upload, download; renaming updates links in HTML and CSS |
| Editor | One tab per file with its own undo; highlighting, folding, multiple cursors, completions for tags, attributes, CSS properties, your classes, `var(--…)` and file paths, snippets, diagnostics |
| Canvas | Live preview in a sandboxed frame; *Design mode* selects and edits, *live preview* lets the page run |
| Navigator | Element tree; drag rows to reorder or nest |
| Add | Elements and ready-made sections (hero, feature grid, pricing, FAQ) |
| Style panel | Layout (flex, grid), spacing, size, position, typography, backgrounds, borders, effects |
| Settings panel | Tag, id, classes, attributes, text |
| Console and Problems | `console.log` output and runtime errors; HTML, CSS, JavaScript and JSON problems |

Switch between **Design**, **Split** and **Code** with the toolbar buttons or `Mod+Alt+1/2/3`; `Mod+Alt+P` toggles design mode and live preview.

## The visual designer

Select on the canvas or in the Navigator (`Alt`-click selects the parent). Selecting an element moves the caret to its tag and the reverse. Double-click text to edit (`Esc` cancels), drag to move, insert from the Add pane, and use the usual copy, paste, duplicate, delete and wrap shortcuts.

### Classes and breakpoints

The Style panel styles a **class selector**. Name a class (or use the one the element has) and every change writes declarations to that class rule in your stylesheet. Choose *inline* to write a `style` attribute instead (desktop only). Breakpoints are desktop-first:

| Breakpoint | Width | CSS written |
| --- | --- | --- |
| Desktop 1920 / 1440 | 1920 / 1440 px | `@media (min-width: …)` |
| Desktop (base) | 1280 px | none |
| Tablet | 991 px | `@media (max-width: 991px)` |
| Mobile landscape | 767 px | `@media (max-width: 767px)` |
| Mobile portrait | 478 px | `@media (max-width: 478px)` |

A blue dot marks a value set at this breakpoint, an orange dot one inherited from a larger screen; click the dot to reset.

## Viewport, rulers and zoom (since 0.7)

The viewport bar sets the page size in CSS pixels: width and height fields (`Enter` applies, arrows change by 1, `Shift` by 10, range 100 to 4000), aspect lock, rotate, fill height, generic presets (Desktop 1440, 1280, 1024; Tablet 820, 768; Phone 390, 375, 360, 320), up to 12 saved sizes, zoom from 25 to 400 percent, a width slider (280 to 2560) that snaps to breakpoint markers (hold `Alt` to avoid snapping), and drag handles with a size badge. Rulers show CSS pixels and mark the editor breakpoints (blue) and the `@media` conditions in your CSS (amber).

## Measure tool (since 0.7)

Press `M` in the canvas (or *View ▸ Measure Tool*). Hover shows margin, border, padding and content bands with size and distances to the viewport edges; `Alt` shows the distance to the pinned, selected or parent element; click pins; `Shift`+click links two pins; `D` shows values; `Ctrl+C` copies the size; `Esc` clears. Units: px, mm, cm, in, pt, rem, em and percent.

## Split layouts (since 0.7)

In Split view choose code left, right, above or below the preview (toolbar, *View ▸ Split Layout*, commands `code.layout.codeLeft`, `codeRight`, `codeTop`, `codeBottom`). The splitter is draggable and keyboard resizable; each pane keeps at least 240 px. A detached preview window is not offered yet.

## Editor shortcuts

| Action | Shortcut |
| --- | --- |
| Command palette | `Mod+Shift+P` (or `F1`) |
| Quick open (prefixes `>` commands, `#` elements, `:` line) | `Mod+P` |
| Find / replace in file | `Mod+F` / `Mod+H` |
| Find in files | `Mod+Shift+F` |
| Go to line | `Mod+G` |
| Expand Emmet abbreviation | `Tab` (for example `ul>li*3`, `.card>h3{Title}+p`) |
| Format document | `Shift+Alt+F` |
| Toggle comment | `Mod+/` |
| Move / copy line | `Alt+Up/Down` / `Shift+Alt+Up/Down` |
| Add next occurrence | `Mod+D` |
| Toggle sidebar / bottom panel | `Mod+B` / `Mod+J` |
| Word wrap | `Alt+Z` |

## Preview and security

The canvas is an `<iframe sandbox="allow-scripts …">` without `allow-same-origin`: your page's scripts run but cannot read OpenFini, its storage or your documents. In the desktop app the Content-Security-Policy blocks `fetch` and `XMLHttpRequest` to other servers from the preview and allows scripts only from `self`, `data:`, jsDelivr, cdnjs and unpkg. Website projects opened from a file start with scripts off ("protected mode"); see [[Security and Privacy]].

## Git, publishing and libraries

Source Control gives real Git inside the document ([[Git in the Code Studio]]). The Publish button deploys to hosting targets ([[Export and Publish]]). The Libraries pane manages CDN libraries and import maps ([[Frameworks and Libraries]]).

## Limits

The designer edits one page at a time (no shared partials, symbols or CMS). No interactions editor, no language server, no terminal, no type checking. Details: [[Roadmap and Known Limits]].

## Vibe

The assistant can create sites from templates, read and edit files, insert elements, edit styles per breakpoint, check problems and control the viewport and layout ([[Vibe Tools Reference]]).

## See also

- [[Frameworks and Libraries]]
- [[Markdown and LaTeX]]
- [[Git in the Code Studio]]
- [[Export and Publish]]
- [[Keyboard Shortcuts]]
