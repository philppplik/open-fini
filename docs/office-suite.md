# Office Suite

The Office studio is a suite: a **launcher** plus one **app per document kind**. The word processor is the first app
(`kind: "document"`, user guide: [office-studio.md](office-studio.md)); Spreadsheet (`sheet`), Presentation
(`slides`) and Whiteboard (`board`) plug in through the same contract. This page is for engineers who add or change
an Office app. Decision record: [ADR 0016](adr/0016-office-suite-apps.md).

## Architecture

```
ui/shell.js ──import()──► office/host.js ──► office/launcher.js        (no Office document active, or Home)
                               │
                               └──► office/apps.js registry ──load()──► <app impl>.mount(el, doc, app) → instance
                                         ▲                                     = app.officeUI
office/index.js registers manifests ─────┘
commands/file.js ─► ui/office/open.js ─► registry.appForFile / engine/office detectOfficeFormat ─► impl.open()
```

* **Manifest** (plain data, registered when the suite first loads): kind, label, icon, formats, templates, AI note,
  `load()`. Cheap; the launcher, file routing and Vibe use only this.
* **Implementation** (loaded with `import()` the first time a document of that kind is opened, created or exported):
  create / open / save / mount and optional adapters.
* **Document storage**: `doc.office` is a `core/office.js ▸ OfficeProject { kind, model, view }`. The model is your
  app's plain JSON. In `.ofini` it is `document.json → "office"` plus `office/<kind>/media/*` entries
  ([file-format.md](file-format.md#office-studio)). `kind` is additive (absent = `"document"`); writers stamp format
  version 2 only for non-document kinds, so older OpenFini versions warn instead of opening a spreadsheet as an empty
  text document.
* **Nothing of the suite is in the start-up bundle** (`tests/architecture/guardrails.test.js` lists `src/office/` as
  lazy). Start-up keeps only the studio definition and menus (`studios/office.js`).

## Where things live

| Part | File |
| --- | --- |
| Registry (pure) | `app/src/office/apps.js` |
| Built-in manifests (one line per app) | `app/src/office/index.js` |
| Suite host (bar, kind switcher, mounting) | `app/src/office/host.js` |
| Launcher (new, templates, recent, open, Google import) | `app/src/office/launcher.js` |
| Export service | `app/src/office/services/export.js` |
| Vibe prompt summary | `app/src/office/ai.js` |
| Document app (adapter around `ui/office/`, `engine/office/`) | `app/src/office/document/{manifest,app}.js` |
| Presentation app ([office-slides.md](office-slides.md)) | `app/src/office/slides/` |
| Office Toolkit | `app/src/office/toolkit/` (`ui.js` DOM; `selection`, `virtual`, `find`, `clipboard`, `numfmt`, `rough`, `export` pure or engine-only) |
| Styles (suite + toolkit) | `app/styles/office-suite.css` (your app: its own stylesheet) |
| Storage, undo | `app/src/core/office.js` (`OfficeProject`, `commitOffice`) |
| File opening / creating | `app/src/ui/office/open.js` (`openOfficeFile`, `createOfficeDocument`, `openOfficeModel`) |
| Content sniffing + guidance texts | `app/src/engine/office/index.js` (`FORMATS`, `detectOfficeFormat`, `officeGuidance`) |
| Save in the original format | `app/src/core/source-format.js`, `app/src/commands/save-source.js` |
| Live editing | `app/src/collab/office-records.js` + `ui/collab/live.js ▸ OfficeBinding` |
| Comment anchors | `app/src/collab/anchors.js ▸ officeItemAnchor`, `protocol.js ANCHOR kind "item"` |
| Vibe tools | `app/src/vibe/tools/office-suite.js` (all kinds), `office.js` (text documents), `office-board.js` (whiteboards) |
| Whiteboard app | `app/src/office/board/` ([office-board.md](office-board.md)) |
| Tests | `tests/office/suite.test.js`, `tests/office/toolkit.test.js`, `tests/collab/office-records.test.js` |

## The contract

### Manifest: `registerOfficeApp(manifest)`

```js
registerOfficeApp({
  kind: "sheet",                       // [a-z][a-z0-9-]{1,23}; stored in files, never rename
  label: "Spreadsheet",                // English; the UI translates with t()
  icon: "table",                       // Bootstrap icon in app/vendor/shoelace/assets/icons (or the "of" set)
  blurb: "Budgets, lists and calculations: Excel, OpenDocument, CSV",
  order: 20,                           // launcher/kind switcher order: document 10, sheet 20, slides 30, board 40
  formats: [                           // read = this app opens it; write = save()/export; template = opens as new
    { id: "xlsx", label: "Excel workbook", ext: ["xlsx", "xlsm"], mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", read: true, write: true },
    { id: "xltx", label: "Excel template", ext: ["xltx"], read: true, template: true },
    { id: "csv", label: "CSV", ext: ["csv", "tsv"], mime: "text/csv", read: true, write: true, lossy: true },
    { id: "pdf", label: "PDF", ext: ["pdf"], mime: "application/pdf", write: true },
  ],
  templates: [{ id: "blank", label: "Blank spreadsheet" }, { id: "budget", label: "Budget", description: "…", icon: "currency-dollar", category: "Business" }],
  aiNote: "The active Office document is a spreadsheet. Read it with sheet_read … before editing.",
  load: () => import("./app.js"),       // the implementation module (default export)
});
```

Registration throws for an invalid/duplicate kind, a missing label/`load`, or an extension another app already
`read`s. Manifests are frozen. Other registry functions: `officeApps()`, `officeApp(kind)`, `appForFile(name)`,
`officeOpenExtensions()`, `loadOfficeApp(kind)` (cached promise, validates the impl with `checkImpl`),
`loadedOfficeApp(kind)` (sync, null until loaded), `officeKindOf(doc)`.

### Implementation (default export of `load()`)

| Member | Required | Signature and meaning |
| --- | --- | --- |
| `create(opts)` | yes | `({ template, title, ...}) → model \| Promise<model>`: a new model (templates of the manifest). |
| `mount(host, doc, app)` | yes | Build your UI inside `host` (an element the suite owns, one per document; keep your state on the instance). Return the **instance**, which becomes `app.officeUI` while the document is active. |
| `open(bytes, name, { report, app })` | for `read` formats | `→ { model, asNew? }`. Fill the `ImportReport` (`report.kept/simplified/dropped`, see `core/import-report.js`). `asNew` (or a `template` format) opens as an untitled copy. |
| `save(model, formatId, { title, doc })` | for `write` formats | `→ { bytes, mime?, ext?, notes?: string[] }`. Used by Export, File ▸ Save in the original format and `office_export`. `notes` say what the format cannot keep. |
| `describe(model)` | recommended | Small JSON summary (no DOM) for Vibe `office_describe` and the prompt. |
| `aiAdapter` | optional | `{ describe(model) }` (overrides `describe` for Vibe). App tools are **static** (see Vibe below). |
| `collabAdapter` | optional | `{ records(model) → { key: json }, applyRecords(model, { key: json \| null }) → model }` (see Collaboration). |

**Instance** (returned by `mount`, all optional except as noted):

| Member | Used by |
| --- | --- |
| `kind`, `doc` | set by the host if you do not |
| `activate()` / `deactivate()` | the host when the document becomes active / inactive (focus, relayout, listeners) |
| `destroy()` | the host when the document closes (disconnect observers, `el.destroy?.()` of toolkit parts) |
| `statusText()` | status bar (emit `app.emit("officestatus")` when it changes) |
| `exportDialog()` | `office.export` (else the generic export dialog of `services/export.js`) |
| `commentAnchor()` → anchor | Collaboration ▸ Add comment: name the selection with `officeItemAnchor({ item, label })` |
| `revealAnchor(anchor)` | clicking a comment: select / scroll to `anchor.item` |

### Rules every app follows

* **Undo**: change the model only with `commitOffice(doc, label, nextModel, { coalesce })` (`core/office.js`). Models
  are immutable values: build a new object per change. Listen to `doc.office.on("change", info)`; `info.origin` is
  `"undo"`, `"redo"` or `"collab"` (remote, not in history).
* **Commands, menus, shortcuts**: register commands in a new `app/src/commands/office-<kind>.js` (ids
  `<kind>.<action>`, `studios: ["office"]`, `enabled: (a) => a.officeUI?.kind === "<kind>"`), and add top-level menus
  to `OFFICE_MENUS` in `studios/office.js` with `officeKinds: ["<kind>"]` so they show only while your app is active.
  Never wire behavior directly into a button.
* **Context menus**: `officeContextMenu(app, event, "office-<kind>", data)` from the toolkit plus
  `registerContextProvider({ matches: (ctx) => ctx.kind === "office-<kind>" … })` ([context-menus.md](context-menus.md)).
* **Find / replace**: flatten text items to `{ id, text }`, use `toolkit/find.js`, commit replacements as one step.
* **Clipboard**: `toolkit/clipboard.js` (`writeClipboard({ text, html, json, png })`, TSV via `toDelimited`).
* **Print / PDF / PNG**: render pages as display lists → `toolkit/export.js ▸ displayListsToPdf`; canvases →
  `canvasToPng`; SVG → `svgToPng`.
* **i18n / a11y / theme**: `t("English")`, German in `app/src/i18n/locales/de.json` (`npm run i18n:extract`); every
  control labelled and keyboard reachable; colors only from `--of-*` tokens; respect `prefers-reduced-motion`.
* **Size**: the impl and everything it imports must be lazy; heavy parsers go behind another `import()` in `open()`.

## Worked example: a minimal app (about 60 lines)

```js
// app/src/office/notes/manifest.js
export const NOTES_APP = {
  kind: "notes", label: "Notes", icon: "sticky", order: 50,
  formats: [{ id: "txt", label: "Plain text", ext: ["note"], mime: "text/plain", read: true, write: true }],
  templates: [{ id: "blank", label: "Blank notes" }, { id: "todo", label: "To-do list", icon: "list-check" }],
  aiNote: "The active document is a notes list: read it with office_describe.",
  load: () => import("./app.js"),
};

// app/src/office/notes/app.js
import { h } from "../../core/util.js";
import { commitOffice } from "../../core/office.js";
import { ribbon, button, officeContextMenu } from "../toolkit/ui.js";

const lines = (m) => m.items.map((i) => i.text);
export function describe(model) {
  return { items: model.items.length, first: model.items[0]?.text || "" };
}

export default {
  create: ({ template }) => ({ items: template === "todo" ? [{ id: "i1", text: "First task" }] : [] }),
  open: async (bytes) => ({ model: { items: new TextDecoder().decode(bytes).split(/\r?\n/).filter(Boolean).map((text, i) => ({ id: `i${i + 1}`, text })) } }),
  save: async (model) => ({ bytes: new TextEncoder().encode(lines(model).join("\n")), mime: "text/plain", ext: "note" }),
  describe,
  aiAdapter: { describe },
  collabAdapter: {
    records: (m) => Object.fromEntries(m.items.map((i, k) => [`item:${i.id}`, { text: i.text, pos: k }])),
    applyRecords: (m, ch) => {
      const map = new Map(m.items.map((i, k) => [`item:${i.id}`, { text: i.text, pos: k }]));
      for (const [k, v] of Object.entries(ch)) v === null ? map.delete(k) : map.set(k, v);
      const items = [...map].sort((a, b) => a[1].pos - b[1].pos).map(([k, v]) => ({ id: k.slice(5), text: v.text }));
      return { ...m, items };
    },
  },
  mount(host, doc, app) {
    const list = h("ul", { role: "list" });
    const render = () => list.replaceChildren(...doc.office.model.items.map((i) => h("li", i.text)));
    const add = () => commitOffice(doc, "Add Note", { ...doc.office.model, items: [...doc.office.model.items, { id: `i${Date.now()}`, text: "New note" }] });
    const bar = ribbon([{ id: "edit", label: "Edit", items: [button({ icon: "plus-lg", label: "Add note", onClick: add })] }]);
    list.addEventListener("contextmenu", (e) => officeContextMenu(app, e, "office-notes", { doc }));
    const off = doc.office.on("change", render);
    host.append(bar, list);
    render();
    return {
      statusText: () => `${doc.office.model.items.length} notes`,
      commentAnchor: () => null,
      destroy: () => (off?.(), bar.destroy()),
    };
  },
};
```

Then add `import { NOTES_APP } from "./notes/manifest.js";` and `NOTES_APP,` to `office/index.js`. The launcher shows
"Blank notes" and the "To-do list" template, File ▸ Open routes `.note` (also add the extension to `OFFICE_FILE` in
`commands/file.js` and `OFFICE_ONLY_EXTS` in `engine/office/index.js`; a test keeps them equal), Export and Vibe's
`office_describe` / `office_new` / `office_export` work without further code.

## File routing

1. `commands/file.js` sends every extension in `OFFICE_FILE` (= `engine/office/index.js ▸ OFFICE_ONLY_EXTS`) to
   `ui/office/open.js ▸ openOfficeFile`. In the Office studio, `.html .md .txt .csv .tsv` go there too; elsewhere they
   keep their studios (Code studio).
2. `detectOfficeFormat(name, bytes)` sniffs content first (a renamed `.xlsx` is still a workbook; OLE binaries,
   ODF mimetypes, flat ODF XML, RTF) and maps it to a kind (`document`, `spreadsheet`→`sheet`,
   `presentation`→`slides`, `whiteboard`→`board`).
3. If a registered app reads that format, its `open()` runs, the import report is attached, the file becomes a recent
   file, and for non-document kinds `doc.source` records `{ officeKind, officeId }` so **File ▸ Save** writes the
   original format again through `save()` (core/source-format.js, commands/save-source.js).
4. Otherwise `officeGuidance()` explains the state honestly: Google `.gdoc/.gsheet/.gslides` (cloud links; download
   a copy, button opens the document in the browser), Apple iWork, legacy binaries (`.doc`, `.xls`, `.ppt`: convert
   first), and kinds whose app is not in this version.
5. OS integration: `platform/file-types.js` is the single table (rows `kind: "office"` for docx, odt, rtf, xlsx, ods,
   pptx, odp, excalidraw, tldraw). Adding a row means updating `src-tauri/tauri.conf.json`, `tauri.windows.conf.json`
   (owned types only), `src-tauri/windows/open-with.nsh`, `src-tauri/linux/openfini.desktop` and
   `app/manifest.webmanifest`; `tests/packaging/os-integration.test.js` fails on drift. OpenFini is only an "Open
   with" candidate for these types, never the default.

## Vibe

* `app/src/vibe/tools/office-suite.js` (group **Office suite**): `office_formats` (apps, formats, templates),
  `office_list_documents`, `office_describe` (kind-aware via `aiAdapter.describe`), `office_new` (kind + template).
  `office_export` (in `office.js`) exports any kind through `save()`. Files arrive through `open_attachment` / File ▸
  Open, which use the same routing.
* The system prompt has an `office` studio note and the active document's summary (`office/ai.js ▸ officeSummary`:
  label, kind, `describe()` when the app is loaded, and the manifest's `aiNote`).
* **App tools are static**: put them in `app/src/vibe/tools/office-<kind>.js` exporting `(app) => Tool[]`, register
  them in `vibe/tools/index.js` and `TOOL_GROUPS` (`tests/ai/tool-contract.test.js`). Inside `run()`, check
  `app.doc?.office?.kind === "<kind>"`, `await loadOfficeApp(kind)` if you need the impl, and commit with
  `commitOffice(doc, "Vibe: …", next)` so the user can undo the step. The text-document tools refuse other kinds.

## Collaboration

* **Live editing ("Edit together")**: give the impl a `collabAdapter`. `records(model)` flattens the model into
  stable keys (`"cell:<sheet>!B3"`, `"obj:<slide>/<id>"`, `"item:<id>"`, `"meta:title"`); `applyRecords(model,
  changes)` returns the new model with `{ key: value | null }` applied (null = deleted). `OfficeBinding` diffs your
  records after every model change (60 ms batches), stamps ops `{ k, v, c, s }` (Lamport clock + site) and merges
  remote ops: the same record goes to the higher `(clock, site)`, different records merge, remote changes bypass the
  undo history (`info.origin === "collab"`). Keep orders as fractional keys (`collab/fractional.js`) inside records,
  never as arrays, so concurrent moves do not fight. Limits: key ≤ 256 chars, value ≤ 64 KiB JSON. Apps without an
  adapter (the word processor) are shared as a copy.
* **Comments**: anchor kind `item` (`collab/anchors.js ▸ officeItemAnchor({ item, label })`) uses the same record keys;
  the instance's `commentAnchor()` and `revealAnchor(anchor)` connect it to your selection. Text documents keep the
  `text` anchor.

## Office Toolkit

All in `app/src/office/toolkit/`; module headers document the full API.

| Module | What |
| --- | --- |
| `ui.js` | `button`, `ribbon(groups)` (groups with overflow into "More", arrow-key focus), `formulaBar`, `colorPicker`, `fontControls`, `numberFormatMenu`, `zoomControl`, `splitPanels`, `ruler`, `virtualGrid({ rows, cols, renderCell })`, `dragGesture`, `officeContextMenu`, re-exported `openDialog/confirmDialog/promptDialog` |
| `selection.js` | A1 refs and ranges (`colName`, `parseRef`, `parseRange`, `formatRange`, `moveCell`, `extendRange`), `createItemSelection` |
| `virtual.js` | `createAxis({ count, size })`: offsets, custom sizes, `indexAt`, `visible()` in O(log n) (million-row sheets) |
| `find.js` | `findMatches`, `replaceMatches`, `compileQuery` (case, whole word, regex; never throws) |
| `clipboard.js` | `parseDelimited` / `toDelimited` (RFC 4180, TSV), `sniffSeparator`, `rowsToHtml`, `writeClipboard`, `readClipboard` |
| `numfmt.js` | `NUMBER_FORMATS`, `formatValue(value, fmt, locale)` (number, percent, currency, accounting, scientific, date/time from serial days) |
| `rough.js` | hand-drawn strokes: `roughLine/Rect/Ellipse/Polygon`, `hachure`, `strokesToPath`, `drawStrokes`; seeded, deterministic |
| `export.js` | `displayListsToPdf`, `canvasToPng`, `svgToPng` |

## Testing

* Pure logic (models, codecs, adapters' `records/applyRecords`, toolkit) gets unit tests under `tests/office/`.
  Register a fake app in a test with `registerOfficeApp` and remove it with `unregisterOfficeApp` (see
  `tests/office/suite.test.js`).
* Round trip your model through `OfficeProject.manifest()/entries()/fromManifest()` and `Doc.toJSON()`.
* Codecs get hostile-input tests (zip limits from `engine/office/zip.js`, no entity expansion).
* Browser check: `node scripts/serve.mjs --port <n>`, `openfini.setStudio("office")`, create from the launcher, open a
  file with `(await import("/src/ui/office/open.js")).openOfficeFile(openfini, { name, bytes })`.
* `npm run build && node scripts/check-size.mjs` must pass; the suite adds nothing to start-up.
