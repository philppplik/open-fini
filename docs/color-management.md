# Color management and print output

OpenFini documents are RGB by default. For print, a document can switch to CMYK mode, carry native CMYK and spot
colors, show a soft proof and export PDF/X-1a or PDF/X-4 files with a preflight report. Decision record:
[ADR 0020](adr/0020-color-management.md).

**Honest summary.** The ICC engine is a compact implementation tested with synthetic profiles. OpenFini ships no
measured CMYK profile: without one you get a built-in *approximation*. PDF/X output is **not validated** by a PDF/X
validator (no access to Acrobat Preflight, callas pdfToolbox or veraPDF during development); the preflight below is
OpenFini's own check list. Ask your print shop before an important job.

## For users

* **File ▸ Color Settings…** (per document, saved in the `.ofini`): color mode *RGB (screen)* or *CMYK (print)*, RGB
  working space (sRGB, Display P3, Adobe RGB 1998), CMYK output profile (*Load CMYK profile (.icc)…* or the built-in
  approximation), rendering intent (perceptual, relative colorimetric, saturation, absolute colorimetric) and black point
  compensation.
* **Profiles.** FOGRA39/51, GRACoL, SWOP and similar profiles cannot be bundled: their licenses do not allow
  redistribution in an MIT app (or are unclear), and the freely downloadable ones are 0.5-2 MB, beyond our size budget. Get
  the profile of your printing condition from your print shop, [eci.org](https://www.eci.org) or
  [color.org](https://www.color.org) and load it; the bytes are stored inside the document (`assets/<id>.icc`).
* **CMYK colors.** In CMYK documents the Color panel shows C, M, Y, K sliders and an optional *spot color name*. Values
  are stored as CMYK percentages on the fill or stroke; the RGB shown on screen is their preview through the current
  profile. A color outside the CMYK gamut shows *Out of the CMYK gamut* with *Use the printable color*. Swatches added in
  CMYK keep their CMYK values.
* **File ▸ Convert Colors ▸ to CMYK / to RGB** converts the selection (or the whole document and its swatches) in one undo
  step. Out-of-gamut RGB colors change to the closest printable color.
* **View ▸ Proof Colors (CMYK)** simulates the CMYK gamut on screen; **View ▸ Gamut Warning** paints colors that the
  profile cannot print gray (CIE76 Delta E > 3). Both post-process the rendered canvas (about 40 ms per frame at 1400 x 1000
  on a laptop) and are off by default.
* **Export ▸ PDF ▸ PDF standard**: *Plain PDF*, *PDF/X-1a:2003* or *PDF/X-4*. CMYK documents always export DeviceCMYK, also
  as plain PDF. After a PDF/X export with warnings or errors the preflight report opens. **File ▸ Print Preflight…** runs the
  same check without saving.
* **Raster export**: PNG and JPEG files of documents in Display P3 or Adobe RGB are tagged with that ICC profile (PNG
  `iCCP`, JPEG `APP2 ICC_PROFILE`); sRGB files stay untagged. CMYK JPEG/TIFF export is not available (the browser canvas
  encodes RGB only); TIFF export does not exist yet.

## What the PDF writer does

| | Plain PDF (RGB doc) | Plain PDF (CMYK doc) | PDF/X-4 | PDF/X-1a:2003 |
| --- | --- | --- | --- | --- |
| Header | 1.7 | 1.7 | 1.6 | 1.4 |
| RGB colors, gradients, images | DeviceRGB | DeviceCMYK (converted) | DeviceCMYK (converted) | DeviceCMYK (converted) |
| Native CMYK / spot | DeviceCMYK / Separation (CMYK alternate, 100 % tint) | same | same | same |
| Transparency | kept | kept (page group /DeviceCMYK) | kept (page group /DeviceCMYK) | pages with transparency are rasterized to one image at the effects resolution |
| OutputIntent | none | none | `/GTS_PDFX`, ICC profile as `/DestOutputProfile` | same |
| Info / XMP | title, dates | same | `GTS_PDFXVersion`, `/Trapped /False`, `pdfxid:`, `xmpMM:DocumentID/VersionID/RenditionClass` | plus `GTS_PDFXConformance` |

MediaBox, TrimBox and BleedBox come from the page size and bleed (unchanged from the existing writer). Fonts are embedded
when the font bytes are available (TrueType subset as `FontFile2`, OpenType/CFF whole as `FontFile3/OpenType`); otherwise a
base-14 font is referenced and the preflight reports an error for PDF/X.

**Without an ICC profile** the OutputIntent has no `/DestOutputProfile` and the identifier `Custom`: such a file is
*PDF/X-ish*; it will not pass a validator. The preflight says so.

## Preflight (what is checked, precisely)

`engine/color/preflight.js` inspects the display lists that the PDF writer receives (after effects were flattened) and
the font report of the same run:

1. RGB objects: solid colors, gradients with any stop without CMYK, every image (the page color is not counted).
2. Spot colors in use (listed).
3. Total ink of native CMYK colors above 320 %.
4. Images below 300 ppi effective resolution at their placed size (images OpenFini rasterized itself are skipped).
5. Transparency: alpha < 1, gradient stop alpha, group opacity, blend modes other than normal, translucent images. Error
   for PDF/X-1a (or "flattened" when the export rasterized the page), info otherwise.
6. Pages without bleed (or bleed not included in the export).
7. Fonts not embedded; OpenType/CFF fonts in PDF/X-1a (their `FontFile3/OpenType` embedding needs PDF 1.6).
8. Output intent: a real CMYK profile or the approximation.

Not checked: overprint settings, trapping, hairlines, image color spaces inside JPEG pass-through for plain PDF, ICC
profile versions, annotation and form rules, PDF/X page box consistency beyond what the writer produces, total ink of
converted RGB colors.

## For developers

```
engine/color/icc.js        ICC parser (v2/v4 headers, curv/para, mft1/mft2, mAB/mBA, XYZ/Lab PCS), createTransform, LUT baking
engine/color/spaces.js     sRGB / Display P3 / Adobe RGB (matrix/TRC from primaries, Bradford to D50), approximate CMYK, ICC v2 RGB writer
engine/color/context.js    document color context: settings -> conversions, proof table, applyProof
engine/color/preflight.js  preflight (pure; messages are N_ templates translated by the UI)
engine/color/embed.js      PNG iCCP / JPEG APP2 embedding
core/color-doc.js          glue: cached context per document, convertColors, refreshCmykPreviews, printPdf, tagRaster
ui/color-settings.js       dialogs, soft proof hook, CMYK sliders (lazy); commands in commands/color.js
vibe/tools/color.js        set_color_mode, convert_colors, preflight_pdf (group "Color")
```

* **Data model (additive, no format version bump).** `document.json -> settings.color = { mode, rgb, cmyk (asset id or
  null), cmykName, intent (0-3), bpc }`. Solid paints and gradient stops may carry `cmyk: [c, m, y, k]` (percent) and
  `spot: "Name"`; `color` stays the RGB preview, so older readers simply see RGB. Swatches may carry the same fields. The
  display list passes `cmyk`/`spot` through (`engine/dl.js`), the PDF backend uses them.
* **Transforms** map device values to PCS XYZ (D50, Y = 1) and back. Intents choose `A2B0/1/2` and `B2A0/1/2` with
  fallback to the 0 tags; absolute colorimetric scales by the media white points. Black point compensation is the
  simplified Adobe form (linear XYZ scaling between the device-black luminance of both profiles), not the full black point
  estimation. LUT interpolation is multilinear (not tetrahedral). Images and the proof go through baked 17³ / 33³ LUTs.
* **Approximate CMYK** is a multiplicative ink model in linear light with typical coated process inks, +15 % dot gain at
  50 % and a paper-black floor; RGB -> CMYK is solved by Gauss-Newton with gray-component replacement that spares
  saturated colors. Good for previews and plausible separations, wrong for color-critical work.
* **Tests**: `tests/color/color.test.js` (built and synthetic profiles: matrix/TRC, lut16 CMYK with Lab PCS, lutAtoB with
  parametric curves, hostile input; round trips within Delta E 2-4; proof and gamut flags; PDF structure for native CMYK,
  spot, X-4, X-1a and plain output; preflight; PNG/JPEG embedding).
* **Size**: everything is lazy. Start-up gains only command stubs, menu rows, the canvas proof hook and the paint
  pass-through (about 0.7 KiB gzip).
