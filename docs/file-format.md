# The `.ofini` file format (version 1)

An OpenFini document is a **ZIP archive** (MIME type `application/vnd.openfini+zip`). Everything is plain
JSON plus the original image bytes, so documents can be inspected and repaired with standard tools.

```
Document.ofini
├─ mimetype              "application/vnd.openfini+zip" (stored, first entry)
├─ document.json         structure, styles and text
├─ assets/<id>.<ext>     original bytes of placed images (png, jpg, webp, gif, avif, …)
├─ pixels/<nodeId>.png   one lossless PNG per pixel layer or mask
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

## Compatibility

* Readers must ignore unknown fields.
* Unknown node types should be preserved on a best-effort basis and rendered as nothing.
* `version` is incremented only for changes that older readers cannot ignore.
* Colors are always sRGB; OpenFini does not (yet) store CMYK or ICC profiles.
