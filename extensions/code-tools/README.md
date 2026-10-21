# Code Snippets & Formatter

For the Code studio: a pack of 44 snippets, *Format Document* for HTML, CSS, JavaScript and JSON, *Sort CSS
Properties*, *Minify File*, and a manager for your own snippets. Not installed by default: *Studio ▸ Extensions… ▸
Available extensions*.

**Permissions:** `document.read` (list and read project files), `document.write` (write the formatted file, insert
markup), `ui`, `storage` (your own snippets).

## What you get

- **Snippets in code completion.** Type the trigger in the editor: `html5`, `form-contact`, `form-login`, `a11y-skip-link`,
  `a11y-landmarks`, `a11y-dialog`, `a11y-tabs`, `flex-center`, `grid-auto-fit`, `grid-holy-grail`, `sticky-footer`,
  `fluid-type`, `media-mobile`, `media-dark`, `media-reduced-motion`, `anim-fade-in`, `anim-spin`, `fetch-json`,
  `debounce`, `observer-reveal`, `theme-toggle` and more (HTML boilerplate, forms, accessible components, CSS layouts,
  animations, media queries, JavaScript patterns).
- **Panel "Code Tools"** (top dock). *Screenshot, described:* two tabs. *Snippets* has a search box, a language filter
  and a list where each row shows the trigger, a description, a language tag and *Insert* (HTML goes into the page body,
  CSS and JavaScript are appended to a file you choose); below, a *New snippet* form (trigger, language, body with
  `${1:placeholder}` tab stops) that saves to the extension's storage. *Format* has a project file menu with *Format*,
  *Sort CSS properties* and *Minify to .min file*, and a scratchpad for any pasted text (language menu, Format,
  Minify, Sort CSS, Copy).
- **Commands:** *Format Document…* (`Ctrl+Alt+L`, Document menu and the editor context menu), *Sort CSS Properties…*,
  *Minify File…*, *Open Panel*.

## The formatters

Pure functions in `src/lib-format.js`, no dependencies, covered by `tests/extensions-bundled/code-tools.test.js`.

- **CSS:** parsed into rules, declarations and at-rules (comments, strings and `url(data:…;base64,…)` are safe), one
  declaration per line, selector lists on separate lines. Sorting orders properties alphabetically with vendor prefixes
  after their base property.
- **JavaScript:** a conservative token-based printer. It only changes whitespace, never adds or removes tokens, and keeps
  line breaks that automatic semicolon insertion might depend on. It handles strings, template literals, regexes,
  comments, `switch`, `else`/`catch` chaining and ternaries. It is not a full parser: very unusual layouts may be
  indented differently from Prettier.
- **HTML:** block elements get their own lines, inline runs stay together, `<pre>`/`<textarea>` are untouched, `<style>`
  and `<script>` contents are formatted with the CSS and JavaScript printers.
- **JSON:** `JSON.parse` + `JSON.stringify`; invalid JSON reports the error instead of changing the file.
- **Minify:** comments and whitespace removed (same tokenizers); JavaScript minification is whitespace-only, no renaming.

## Limits

The extension API has no access to the editor's cursor or text selection, so commands work on a whole project file
(chosen in a dialog) and the scratchpad covers pasted fragments. User snippets are managed in the panel and inserted
from there; they do not appear in editor completion because completion snippets come from the extension manifest.

## Editing the snippet pack

Snippets live in `SNIPPETS` in `src/lib.js`. After editing run `node extensions/code-tools/build-manifest.mjs` to copy
them into the manifest (a test fails when the two differ), then `npm run ext:pack-all`.
