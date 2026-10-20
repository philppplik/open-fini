# Bundled extensions

OpenFini ships five ready-made [extensions](extensions.md). They are **not installed and not enabled by default**: a
fresh OpenFini has zero extensions. Open *Studio ▸ Extensions…* and choose **Available extensions**. Each card shows what
the extension does, the studios it works in and every permission it asks for; **Install** opens the normal consent
dialog (permissions explained, risk levels) and nothing is installed without your confirmation. The card then shows
*Installed*, or *Update* when the app ships a newer version than the one you have.

## Catalog

| Extension | Id | Studios | What it does |
| --- | --- | --- | --- |
| [Palette Pro](../extensions/palette-pro/README.md) | `openfini.palette-pro` | Vector, Pixel, Layout | palettes from the selection or an image, harmonies, WCAG contrast checker with fixes, apply palette to layers |
| [Batch Export & Rename](../extensions/batch-export/README.md) | `openfini.batch-export` | Vector, Pixel, Layout | export layers, pages in several sizes and formats with a name template (ZIP), bulk layer rename |
| [Lorem & Data Filler](../extensions/data-filler/README.md) | `openfini.data-filler` | Vector, Pixel, Layout, Code | seeded lorem ipsum, names, emails, addresses, dates, prices; initials avatars; HTML lists, tables and card grids |
| [Code Snippets & Formatter](../extensions/code-tools/README.md) | `openfini.code-tools` | Code | 44 snippets, format HTML/CSS/JS/JSON, sort CSS properties, minify, own snippets |
| [Accessibility Checker](../extensions/a11y-checker/README.md) | `openfini.a11y-checker` | all | contrast, font size, alt text, reading order; website audit; fixes; Markdown report |

## Permissions

Each extension declares only what it needs (a test fails when a manifest asks for more than the table below).

| Permission | Palette Pro | Batch Export | Data Filler | Code Tools | A11y Checker |
| --- | :-: | :-: | :-: | :-: | :-: |
| `document.read` | x | x | x | x | x |
| `document.write` | x (apply, swatches) | x (rename) | x (fill, insert) | x (write files) | x (fixes) |
| `export` | | x | | | |
| `files` | x (pick an image) | x (save ZIP) | | | x (save report) |
| `storage` | x | | | x | x |
| `ui` | x | x | x | x | x |

None needs the network, `commands` or `vibe`. All of them also work through the Vibe assistant without extra tools:
`list_extensions` shows the commands of installed extensions and `run_extension_command` runs them (the user is asked to
approve). Commands accept optional JSON arguments so the assistant can run them without dialogs, for example
`run_extension_command { extension: "openfini.batch-export", command: "export", args: { source: "selection", scales: [1, 2], formats: ["png"], template: "{name}@{scale}x" } }`.

## The `export` permission and `document.export`

Batch export needed a way to render layers, so the extension API got an additive method (API version stays 1):

```js
const r = await openfini.document.export({ format: "png", scale: 2, ids: ["layer id"] }); // needs "export"
// r = { mime, ext, width, height, data: Uint8Array, isolated }
```

`format` is `png`, `jpg`, `webp` or `svg`; `scale` 0.05 to 8; `ids` renders those layers on their own (top-level layers in
isolation, nested layers as a page region with `isolated: false`); `page` selects a page by index; without `ids` the
whole page is rendered. It only returns bytes; saving still needs `files.save` and the system dialog. Implementation:
`app/src/extensions/export-api.js`. The `set_style` tool also gained `alt` and `get_selection` / `list_layers` report
`fontSize`, `fontFamily` and `fontWeight` of text layers (used by the Accessibility Checker).

## Architecture

```text
extensions/
  catalog.json            generated: id, name, description, version, engines, permissions, studios, icon, file, size
  packages/*.ofext        generated, committed: what the app installs
  _shared/color.js        code several extensions share (inlined by the packer)
  <folder>/               one extension (source)
    openfini-extension.json   manifest (validated by app/src/extensions/manifest.js)
    src/lib*.js               pure logic; Node-testable ES modules; no DOM, no `openfini` global
    src/main.js               background script: commands
    src/panel.js, panel/      panel UI (HTML, CSS, script)
    README.md, icon.svg
scripts/pack-extensions.mjs   packs everything, writes the catalog, `--check` verifies it is current
app/src/extensions/catalog.js     fetch the catalog, installed/update state, install through host.install (pure, tested)
app/src/ui/extensions/gallery.js  the "Available extensions" view of the manager
```

### Where things live at run time

- **Development:** `scripts/serve.mjs` serves `app/` and maps `/extensions/catalog.json` and `/extensions/packages/*.ofext`
  to the repository's `extensions/` folder.
- **Build:** `scripts/build.mjs` copies the catalog and packages to `dist/extensions/` (web/PWA and desktop). They are
  data: they are **not** in the service worker precache (they are fetched when you install one) and do not count towards
  the JavaScript size budget. The gallery code is a lazy chunk of the extension manager.
- **Offline:** the packages are part of the app's own files, so installing works offline (no network permission is used).

### Why packing concatenates files

The extension runtime loads exactly one `main` script and inlines panel scripts; there is no module loader inside the
sandbox. So pure code lives in ES modules (`src/lib*.js`, imported by the tests) and the packer strips `export`, inlines
the `../../_shared/*.js` imports and prepends all `lib*.js` files to `main.js` and `panel/panel.js`. The packaged files are
generated and marked as such. Lib files may only import from `../../_shared/` and sibling `./lib*.js` files.

## Add a new bundled extension

1. Create `extensions/<folder>/` with `openfini-extension.json` (id `openfini.<name>`, `engines.openfini` `>=0.4.0`
   or higher when it needs newer APIs, **minimal** permissions), `src/lib.js`, `src/main.js`, optional `src/panel.js`
   and `panel/`, `README.md` and `icon.svg`. Keep user-visible strings in one exported `STRINGS` object.
2. Write tests in `tests/extensions-bundled/` for the pure logic and, with `_mock.js`, the API-driven helpers.
3. Run `npm run ext:pack-all` and commit the generated `extensions/catalog.json` and `extensions/packages/`.
4. Add the id and its expected permissions to `EXPECTED` in `tests/extensions-bundled/catalog.test.js`, add a row to the
   tables above and a README for the extension. Test it in the app: install it from the gallery and use every command.

`npm run ext:pack-all -- --check` (and the test suite) fails when the committed packages or the catalog are stale.

## Testing

`node --test tests/extensions-bundled/*.test.js`: pure logic (colors, name templates, ZIP writer, PRNG and generators,
formatters, audits), the API-driven helpers against a recording mock API, the catalog (packages up to date, valid
manifests, minimal permissions, plain-script check, gallery states), a fresh host that has zero extensions, and each
package installed through the real `ExtensionHost` with the consent callback.

## Honest limits

- Extensions cannot read the Code editor's cursor or text selection; the Code tools work on project files and a
  scratchpad, and HTML is inserted into the page body.
- Snippet completion comes from the manifest, so your own snippets live in the Code Tools panel, not in editor completion.
- The accessibility checks cover a subset of WCAG 2.2; contrast over images and gradients cannot be measured.
- UI strings are English; a German translation is added separately (each extension keeps its strings in one object).
