# Context menus

Right-clicking opens a menu that depends on WHERE and WHAT you clicked. One service (`app/src/ui/context-menu/`)
builds it from small providers; the floating menu itself is `showContextMenu` in `app/src/ui/menus.js`.

## How a menu is chosen

1. A widget (or the global listener) describes the target: a `kind` such as `canvas-layers`, `text-field`,
   `code-editor`, `layers-row`, `doc-tab`, `editor-tab`, `explorer-file`, `history-item`, `panel-header`,
   `vibe-message`, plus `selection`, `data`, the studio and the app.
2. Every registered provider whose `matches(ctx)` is true contributes a section. Sections are ordered by `priority`
   (highest first) and joined with separators. Empty sections, hidden items and doubled separators disappear.
3. Widgets can pass `base` items (their own commands, shown first), as the explorer and the website designer do.
4. The menu opens, keeps inside the viewport, scrolls when taller than the window and returns focus when it closes.

Priority bands used by the built-ins: 100 owner/legacy items, 50 target specific, 40 transforms, 10 generic, -10
extensions, -20 AI.

Targets are found in two ways: widgets call `openContextMenu(app, {kind, x, y, data, base})`, or they mark an element
with `markContext(el, kind, data)` and the global `contextmenu` listener does the rest. Text inputs, textareas and
content-editable elements are detected automatically (also inside Shoelace controls).

## Behavior

- Keyboard: arrows, Home/End, Enter, Escape (focus returns to where it was), type-ahead, ArrowRight for submenus.
- Screen readers: the menu has `role="menu"` and an accessible name per target; items are `menuitem`s.
- The item you chose last in a kind of menu gets a small "last" marker (menus with more than five items).
- Shift + right-click in a text field opens the browser's own menu. Spell-check suggestions exist only there; a web
  page cannot read them, so OpenFini does not fake them.
- **Native menu policy** (`context-menu/native-policy.js`, `shouldAllowNativeContextMenu(target, event)`): OpenFini is an
  app, so the OS/webview menu ("Back", "Reload", "Inspect") never appears in the chrome. Any right-click that no OpenFini
  menu handled is `preventDefault()`ed (empty areas, panel backgrounds, disabled UI show nothing). The native menu is
  allowed only for (1) website previews (an `<iframe>`: the sandboxed page is the user's own site), (2) Shift +
  right-click in editable text (inputs, textareas, contenteditable, also inside Shoelace controls), and (3) elements
  marked `data-native-menu`. Tests: `tests/ui/native-context-menu.test.js`.
- Glass styles: the menu blur is painted by a `::before` on the dropdown panel / `.of-ctxmenu` host, never by `sl-menu`
  itself (a `backdrop-filter` on a menu would trap the position:fixed submenu popups in the menu's scroll box). A test in
  `tests/ui/glass.test.js` enforces this.
- Touch: press and hold for about half a second.
- Canvas: right-click selects the layer under the pointer first (like other design tools); on empty canvas it clears the
  selection.

## Adding a provider

```js
import { registerContextProvider } from "../ui/context-menu/index.js";

const off = registerContextProvider({
  id: "my.section",            // registering the same id again replaces it
  priority: 50,
  matches: (ctx) => ctx.kind === "layers-row" && ctx.data.node.type === "text",
  items: (ctx) => [
    { label: "Do something", icon: "magic", shortcut: "Mod+K", run: () => {/* ... */} },
    "edit.duplicate",          // a command id works too
    { label: "More", items: [ /* submenu */ ] },
  ],                           // item fields: label, run, icon, shortcut, disabled, hidden, checked, id, title, items
});
// off() removes it again
```

`ctx` holds `app`, `studio`, `kind`, `x`, `y`, `event`, `target`, `selection` (layers for canvas kinds, the selected text
for text kinds), `data` (kind specific: `node`, `doc`, `path`, `view`, `editors`, `recent`, ...) and `base`.

### Extensions

Extensions do not run code in the menu. They declare menu entries for a command:

```json
"menus": [{ "menu": "context:code", "command": "myCommand" }]
```

`context:canvas` (all canvas and layer targets), `context:code` (code editor), `context:explorer` (files and folders),
`context:layers` (layers panel rows) and `context:text` (text fields). The built-in provider `core.extensions` maps them
(priority -10).

### AI

The AI submenu comes from providers with priority -20 (`core.ai.canvas`, `code.ai`, `code.ai.element`) and is only
present when Settings > Artificial intelligence is on (`prefs.aiEnabled`).

## Where menus exist

Canvas (empty, layers, text layers, tables, charts), layers panel rows, document tabs, editor tabs, explorer files and
folders, history steps, assets, navigator, panel tabs (hide, move, reset; session only), status bar, rulers (add guide,
clear guides), recent files on the welcome screen, text inputs everywhere (undo, cut, copy, paste, select all, a small
Transform submenu), the code editor, website elements, Vibe chat messages (copy, copy as Markdown, retry, branch chat
from here, delete turn) and tool cards (copy input and result).

The section `collab.share` (priority 10, registered in `commands/collab.js`) adds *Share with collaboration room…*, *Share as linked live document*, *Share a copy (snapshot)* and *Stop sharing* to document tabs, the empty canvas, Code explorer files and tabs and the Office editor.

The section `collab.comment` (priority 12, also in `commands/collab.js`) adds **Add comment here…** to the canvas kinds (empty, layers, text, table, chart), layers panel rows, the code editor, the Office editor (`office-document`) and website elements (`web-element`). It runs the command `collab.addCommentHere` with `{ctx: {kind, x, y, data}}`; the anchor is built from the target (`ui/collab/comment-ui.js`, `collab/anchors.js`), see [collaboration.md](collaboration.md#comments-on-the-canvas-in-code-and-in-text).

Not done: a units submenu for rulers (documents store a unit, but the rulers do not use it yet).

## Code editor: Transform

Right-click in the Code studio > Transform, or the command palette (`code.encodeEntitiesDecimal`, `code.sortLinesAsc`,
...). A transform runs on the selection (every cursor); with an empty selection it uses the word (case, wrap), the line
(encode, decode, Base64, URL) or the whole file (sorting, whitespace, JSON). The color converter uses the color
literal at the cursor. Everything is applied as one CodeMirror transaction (one Undo) and the selection stays on the
new text. If any range fails (invalid JSON, invalid Base64) nothing changes and a message explains why.

**Encode special characters** formats: HTML named (`&eacute;`, falls back to decimal when there is no HTML 4 name),
HTML decimal (`&#233;`), HTML hex (`&#xE9;`), JavaScript and JSON (`é`, surrogate pairs for astral characters, or
`\u{1f600}`), CSS (`\E9 `), URL percent-encoding (UTF-8), code points (`<U+00E9>`). Modes: all non-ASCII characters,
only special characters (`& < > " '` plus non-ASCII symbols and punctuation, letters stay), every character (line breaks
and tabs stay). "Choose format and mode..." shows a live preview.

**Decode** handles entities (named from a table of the full HTML 4 set plus common HTML 5 names, decimal, hex,
windows-1252 numeric references), `\u` escapes, CSS escapes, percent-encoding and code points. Decoding is one pass:
`&amp;#233;` becomes `&#233;`, never `é`. "Auto" decodes entities and `\u` escapes only, because CSS or percent
sequences are ambiguous in plain text.

Other transforms: Base64 and URL encode/decode, UPPER, lower, Title, camelCase, snake_case, kebab-case,
CONSTANT_CASE, sort lines (ascending, descending, numeric, unique), reverse, join, remove blank lines, trim, normalize
whitespace, tabs to spaces and back, wrap in tag, quotes, parentheses, brackets or comment, JSON prettify and minify,
color to hex/rgb/hsl, Show Unicode info (code point, category, UTF-8 and UTF-16 bytes, entity name; no full Unicode
name table is bundled).

Line-ending conversion is available to the assistant only: CodeMirror normalizes line breaks inside the editor.

Text layers (Vector, Pixel and Layout studios) get a Transform text submenu with case and whitespace transforms that
keep character formatting; text inputs get the same case and entity transforms for their selection.

## Vibe tools

`encode_text`, `decode_text` (read-only, same codec) and `transform_file_text` (named transform on one file, or on
several files with approval; one undo step per file).

## Code map

`engine/web/charcodec.js` and `engine/web/texttools.js` are pure and unit tested (`tests/web/`); `ui/code/text-tools.js`
applies them to CodeMirror; `commands/text-tools.js` registers palette commands; `vibe/chat-ops.js` holds the pure
transcript operations behind the Vibe message menu (`tests/ai/chat-ops.test.js`).
