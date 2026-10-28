# The `.ofini` file format (version 1 and 2)

An OpenFini document is a **ZIP archive** (MIME type `application/vnd.openfini+zip`). Everything is plain
JSON plus the original image bytes, so documents can be inspected and repaired with standard tools.

```
Document.ofini
├─ mimetype              "application/vnd.openfini+zip" (stored, first entry)
├─ document.json         structure, styles and text
├─ assets/<id>.<ext>     original bytes of placed images (png, jpg, webp, gif, avif, …)
├─ pixels/<nodeId>.png   one lossless PNG per pixel layer or mask
├─ office/media/<id>.<ext>  images of an Office Studio document (only when "office" is present)
└─ thumbnail.png         preview of the first page (≤ 256 px)
```

## `document.json`

```jsonc
{
  "format": "openfini",
  "version": 1,
  "id": "d_…", "name": "My Poster", "dpi": 300, "unit": "mm", "studio": "layout",
  "createdAt": 1760000000000, "modifiedAt": 1760000000000,
  "pages":   [ { "id": "p_…", "name": "Page 1", "x": 0, "y": 0, "w": 2480, "h": 3508,
                 "bg": "#ffffff", "masterId": null,
                 "margins": {"top":142,"right":142,"bottom":142,"left":142},
                 "columns": 2, "gutter": 12, "bleed": 35,
                 "guides": {"h": [], "v": []},
                 "root": { /* group node */ } } ],
  "masters": [ /* same shape as pages */ ],
  "assets":  [ { "id": "a_…", "name": "photo.jpg", "mime": "image/jpeg", "w": 4000, "h": 3000 } ],
  "stories": { "s_…": { "id": "s_…", "story": { "paragraphs": [ … ] }, "defaults": { "char": {…}, "para": {…} } } },
  "styles":  { "paragraph": { "st_…": { "name": "Body", "attrs": {…}, "char": {…} } }, "character": {} },
  "swatches": [ { "id": "sw0", "name": "#000000", "color": "#000000" } ],
  "slices":  [ { "id": "sl_…", "name": "Hero", "page": "p_…", "x": 0, "y": 0, "w": 800, "h": 400, "format": "png", "scale": 2, "quality": 0.9 } ],
  "settings": { "snap": true, "grid": { "size": 32, "subdivisions": 4, "visible": false }, "guidesVisible": true, "facing": false }
}
```

### `source` (display only)

`"source": { "name": "notes.txt", "format": "txt" }` is written when the document was opened from a file and File ▸ Save
still writes it in that format (see [file-compat.md](file-compat.md#saving-back-to-the-original-format)). It is metadata for
display: readers must ignore it, and OpenFini never restores a file location from it (a path or handle is not part of the
file). The key is absent for documents created in OpenFini or once the document became an `.ofini` document.

### Nodes

Every node has `id`, `type`, `name`, `visible`, `locked`, `opacity` (0–1), `blend` (CSS blend-mode name),
`m` (the 2×3 matrix `[a,b,c,d,e,f]` from local to parent space, same convention as Canvas
`transform()`), `fx` (live effects) and optional `children` and `mask`.

| `type` | Extra fields |
| --- | --- |
| `group` | `children` |
| `rect` | `w`, `h`, `r` (`[tl,tr,br,bl]`), `fill`, `stroke` |
| `ellipse` | `w`, `h`, `fill`, `stroke` |
| `polygon` | `w`, `h`, `sides`, `cr`, `fill`, `stroke` |
| `star` | `w`, `h`, `points`, `ratio`, `cr`, `fill`, `stroke` |
| `path` | `path` (see below), `rule` (`nonzero` \| `evenodd`), `fill`, `stroke` |
| `text` | `storyId`, `w`/`h` (`null` = artistic text), `columns`, `gutter`, `insets`, `vAlign`, `flowIndex`, `linked`, `fill`, `stroke` |
| `image` | `assetId`, `w`, `h`, `smooth` |
| `pixel` | `w`, `h` — pixels live in `pixels/<id>.png` |
| `table` | `cols` (widths), `rows` (minimum heights), `cells` (rows × cols of `{v, rs?, cs?, m?, bold?, align?, fill?, fmt?, borders?, …}`), `headerRows`, `headerCols`, `tstyle` (resolved table style), `styleId?`, `colFmt`, `autoHeight`, `repeatHeader?`, `alt?` |
| `chart` | `w`, `h`, `chart` (`{type, title, subtitle, data:{categories, series:[{name, values, color?}]}, source:{tableId, range?, seriesIn, header, labelCol}|null, options}`), `alt?` |
| `adjust` | `effect` (`{group, id}` — group is `adjustment`, `filter` or `develop`), `params` |

**Paint** (`fill`, stroke `fill`): `{"type":"solid","color":"#rrggbb","alpha":1}` or a gradient
`{"type":"linear"|"radial"|"conic", "stops":[{"o":0,"color":"#…","alpha":1}], …}` with coordinates in unit
bounding-box space (0–1).

**Stroke**: `{fill, width, align:"center"|"inside"|"outside", cap, join, miterLimit, dash, dashOffset}`.

**Path**: `{"subpaths":[{"closed":true,"nodes":[{"x":0,"y":0,"ix":null,"iy":null,"ox":10,"oy":0,"t":"smooth"}]}]}`
— anchors with absolute control points for the incoming (`ix`,`iy`) and outgoing (`ox`,`oy`) handles.

**Effects** (`fx`): `dropShadow`, `innerShadow`, `outerGlow`, `innerGlow`, `outline`, `colorOverlay`,
`blur`, each with `enabled` and its parameters.

### Text stories

A story is a list of paragraphs, each with `runs` (`{text, attrs}`) and optional paragraph `attrs` and
`styleId`. Run attributes include `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `color`,
`underline`, `strike`, `tracking`, `baselineShift`, `caps` and `field` (`pageNumber`, `pageCount`,
`date`). The exact schema is in [engine-contracts.md](engine-contracts.md#3-text-model).

### Tables and charts

A `table` node stores its whole model (see [layout-tables-charts.md](layout-tables-charts.md)); cell text starting with `=` is a formula, evaluated at render time. Merged cells: the origin cell has `rs` / `cs`, covered cells have `m: [row, col]`. A `chart` node stores its definition, never generated geometry; with `source` set the data comes from the table node with that id in the same document (the stored `data` is a cache). Document-level `tableStyles` is `{ id: { name, style } }`. Readers that do not know these types render nothing for them.

### Office documents (`"office"`)

**Kinds (Office Suite, additive since 0.10).** `"office"` may carry `"kind"`: `"document"` (the word processor below;
the field is then omitted, so these files are byte-for-byte what earlier versions wrote), `"sheet"`, `"slides"`,
`"board"` or another registered app kind ([office-suite.md](office-suite.md)). For any other kind the rest of the object
is that app's model (documented by the app), its media live under `office/<kind>/media/<id>.<ext>` instead of
`office/media/`, and the writer stamps `"version": 2` (see [Versioning](#versioning-and-migration)). A reader without
an app for a kind keeps the object unchanged and saves it back as it was.


A document created in or opened by the Office Studio has an `"office"` object in `document.json` (its `studio` is
`"office"`; the design `pages` hold one empty page used for the thumbnail). It is the word-processing model of
[`engine/office/model.js`](../app/src/engine/office/model.js), lengths in points:

```jsonc
"office": {
  "type": "office-document", "version": 1,
  "meta":   { "title": "", "author": "", "subject": "", "keywords": "", "created": "2026-…", "lang": "en-US" },
  "page":   { "size": "A4", "width": 595.28, "height": 841.89, "orientation": "portrait", "columns": 1, "columnGap": 36,
              "margins": { "top": 70.87, "right": 70.87, "bottom": 70.87, "left": 70.87, "header": 36, "footer": 36 } },
  "styles": { "Normal": { "name": "Normal", "type": "paragraph", "para": { "spaceAfter": 8, "lineHeight": 1.15 }, "run": { "font": "Calibri", "size": 11 } },
              "Heading1": { "name": "Heading 1", "basedOn": "Normal", "next": "Normal", "outline": 1, "para": {…}, "run": {…} } },
  "blocks": [
    { "type": "paragraph", "style": "Heading1", "runs": [ { "text": "Intro" } ] },
    { "type": "paragraph", "style": "List", "list": { "kind": "bullet", "level": 0, "id": "l1" }, "props": { "align": "left" },
      "runs": [ { "text": "bold", "b": true }, { "type": "break" }, { "type": "image", "media": "img1", "width": 120, "height": 80, "alt": "…" },
                { "type": "footnote", "id": "fn1" }, { "type": "field", "field": "page" } ] },
    { "type": "table", "cols": [150, 150], "borders": { "style": "single", "width": 0.5, "color": "#808080" },
      "rows": [ { "header": true, "cells": [ { "blocks": [ … ], "colspan": 2, "shading": "#ffeeaa" } ] } ] },
    { "type": "pageBreak" }, { "type": "rule" }
  ],
  "header": [ /* paragraphs */ ], "footer": [ /* paragraphs */ ],
  "footnotes": { "fn1": [ /* paragraphs */ ] },
  "media":  { "img1": { "id": "img1", "mime": "image/png", "name": "photo.png", "w": 800, "h": 600, "file": "office/media/img1.png" } }
}
```

Run marks are `b`, `i`, `u`, `s`, `va` (`"sub"` / `"super"`), `color`, `highlight`, `font`, `size` (pt) and `link`.
Covered cells of a merge are simply absent (HTML-style `colspan` / `rowspan`). Readers validate the object with
`normalizeDoc()`, which drops unknown fields and clamps values.

## Comments

`"comments"` (optional, additive since 0.7.0, no format version bump: older readers ignore it) holds the comment threads
of the document ([collaboration.md](collaboration.md)). The key is absent when there are none.

```jsonc
"comments": [
  {
    "id": "cAbC…", "author": "<22-char member id>", "nick": "Mia", "color": "#0090ff", "ts": 1760000000000,
    "anchor": { "kind": "node", "node": "n_…", "page": "p_…", "quote": "Hero box" },
    "resolved": false, "resolvedBy": "Hana", "resolvedAt": 1760000000000,
    "messages": [ { "id": "cAbC…-0", "author": "…", "nick": "Mia", "color": "#0090ff", "text": "Bigger?", "ts": 1760000000000,
                    "edited": 1760000000000, "deleted": false, "mentions": ["<member id>"] } ]
  }
]
```

Anchor kinds: `doc`; `page` (`page`); `node` (`node`, `page`); `region` (`page`, `rect {x,y,w,h}` in page coordinates);
`text` (Office studio: `path` = JSON paragraph path, `from`, `to` offsets, `quote`); `line` (Code studio: `path` = file,
`line`, `endLine`, `quote`). Text is plain text (never HTML). Readers validate every thread with
`collab/comments.js ▸ normalizeThreads` (unknown fields, wrong types and oversize values drop the thread); the document
loader itself only keeps objects with an `id` (at most 2000). Comments are not undoable steps; they mark the document as
changed.

**Named versions are not in the file.** Versions (*Collaboration ▸ Versions*) are complete `.ofini` snapshots stored on
the device (IndexedDB keys `versions.index`, `versions.data.<id>`, `versions.thumb.<id>`, encrypted by the app lock).

## Versioning and migration

`document.json` carries `"version": N`. The code lives in `app/src/core/ofini-migrate.js` (pure, tested in `tests/core/ofini-migrate.test.js`):

* **Old files always open.** `migrateDocumentJson` upgrades a document from its version to `FORMAT_VERSION` one step at a time (`MIGRATIONS[n]` turns version n into n + 1). Files without a version are format 0. The upgrade happens in memory; the file on disk is untouched until you save, and the toast on open says what changed.
* **Newer files open best-effort.** A file from a newer OpenFini opens with what this version understands (unknown fields are ignored and kept in memory), the user is warned, and the first Save asks for confirmation because saving could drop data this version cannot see (use *Save As* to keep the original).
* **Writers stamp the oldest version that can represent the document** (`ofini-migrate.js ▸ writeVersion`): 1 for
  everything except Office documents of a kind other than `"document"`, which are 2. Version 1 → 2 needs no
  conversion (an absent `office.kind` means `"document"`); the bump exists so OpenFini 0.9 and earlier treat a
  spreadsheet, presentation or whiteboard as a newer file (warning before Save) instead of an empty text document.
* **Changing the format** (checklist): bump `FORMAT_VERSION`, add the step to `MIGRATIONS`, add a frozen sample of the old `document.json` to the tests (the version 1 sample is there already), describe the change here. Never rename zip entries without a migration that is told about the entries.

## Compatibility

* Readers must ignore unknown fields.
* Unknown node types should be preserved on a best-effort basis and rendered as nothing.
* `version` is incremented only for changes that older readers cannot ignore.
* Colors are always sRGB; OpenFini does not (yet) store CMYK or ICC profiles.
