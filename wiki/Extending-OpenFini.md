# Extending OpenFini

Recipes for the common changes: a command, a studio, a tool, a Vibe tool, a skill, a file format, a setting, a context menu, an extension and a translation. Each recipe names the files to touch and the tests that must pass. Read [[Architecture Overview]] first, and keep new code lazy and in new files.

## A command

Register it in `app/src/commands/<area>.js` (this example is illustrative, the id is made up):

```js
def("demo.hello", "Say Hello", (a) => a.toast("Hello"), {
  shortcut: "Mod+Alt+H",
  enabled: (a) => !!a.doc,
  icon: "emoji-smile",
});
```

Give it an id, a label (English text is the i18n key), `run`, optionally `enabled`, `shortcut` and `icon`. Add the id to the menu lists in `app/src/ui/menus.js` to show it in a menu; it appears automatically in the command palette and the shortcut editor. A command id has exactly one owner. Test any logic in a pure module.

## A studio

One `registerStudio({ id, label, icon, blurb, order, workspace?, document?, newDocument?, tools?, top?, bottom? })` entry in `app/src/studios/registry.js` (see the file header for all fields). The header, *More* menu, Studio menu, `studio.<id>` commands, welcome cards, New Document dialog and `Alt+N` shortcuts are derived from it. Put heavy UI behind `import()`.

## A canvas tool

Extend `Tool` and register the class in `app/src/studios/tool-sets.js`; set `static id`, `label`, `shortcut` and `studios`. Interactive tools mutate live and call `doc.recordSet(...)` once on pointer-up. Tool shortcuts are then picked up by the shortcut editor and by `npm run wiki:shortcuts`.

## A Vibe tool

Create `app/src/vibe/tools/<area>.js` exporting `(app, ctx) => Tool[]` built with `tool()` and the `S` schema helpers from `helpers.js`. Mark pure reads `{ readOnly: true }`; outward actions (network, push, publish, messaging) return a `needsApproval` reason. Register it with one import and spread in `app/src/vibe/tools/index.js` **and** add the names to `TOOL_GROUPS`. Mention it in `docs/vibe-studio.md`. `tests/ai/tool-contract.test.js` enforces schemas, uniqueness and grouping. Add a Demo scenario in `app/src/ai/providers/mock.js` if useful.

## A skill

Append a SKILL.md string to `LIBRARY_SKILLS` in `app/src/ai/skills-library.js` (rules in [[Skills Authoring]]). Tests require a long enough description and body, at least three existing `allowed-tools`, a `## Verify` section and only existing tool names.

## A file format

1. A pure reader and writer in `app/src/engine/formats/` with tests using synthetic fixtures (and hostile inputs).
2. A loader in `core/import-raster.js` (or the matching importer), the extension in `RASTER_FORMAT_EXT` where relevant, routing in `commands/file.js` and `OPEN_FILTERS` in `core/io.js`.
3. A row in `app/src/platform/file-types.js`; the packaging tests check that Open dialogs, drag and drop, Tauri associations and the PWA manifest agree (update the hand-written installer lists).
4. A verdict in `platform/format-verdicts.js`.
5. Update [[File Formats]] and `docs/file-compat.md`. Never implement a proprietary format without a public specification that permits it ([[Clean-Room Policy]]).

## A setting

Add it to `defaultPrefs()` in `app/src/core/app.js` and to the schema in `app/src/customize/schema.js` (so profiles carry it) and the settings dialog section in `app/src/ui/settings-dialog.js`. Never put secrets in the schema.

## A context menu

Call `registerContextProvider` ([context-menus.md](https://github.com/philppplik/open-fini/blob/main/docs/context-menus.md)); do not build lists by hand for new surfaces.

## An extension

`npm run ext:create -- publisher.name`, then see [[Extension SDK Reference]]. A bundled extension also needs `npm run ext:pack-all` and an entry in `tests/extensions-bundled/catalog.test.js` ([[Bundled Extensions]]).

## A translation

Wrap strings with `t()`, run `npm run i18n:extract`, translate `app/src/i18n/locales/de.json` or add a new locale file and a `LOCALES` entry ([[Internationalization]]).

## A dependency

Avoid it. Vendored code needs an MIT-compatible license, a folder in `app/vendor/` and an entry in `THIRD_PARTY_NOTICES.md`, and must respect the size budget ([[CI and Size Budgets]]).

## A wiki page

Add `wiki/Page-Name.md`, link it from `_Sidebar.md`, and run `npm test` ([[Wiki Style Guide]]).

## Always

Update the docs of the area you changed, add a bullet under `## [Unreleased]` in `CHANGELOG.md`, give every new module a header comment (purpose, public API, invariants), and write an ADR for hard-to-reverse decisions ([[Decision Records]]).

## See also

- [[Architecture Overview]]
- [[Repository Map]]
- [[Testing]]
- [[Git Workflow and Releases]]
