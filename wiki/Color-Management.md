# Color Management

Print-oriented color in the Vector, Layout and Pixel studios: a CMYK document mode, native CMYK and spot colors, ICC profiles, a soft proof and PDF/X-1a or PDF/X-4 export with a preflight report. The developer view is in `docs/color-management.md` in the repository.

## Color Settings

*File ▸ Color Settings…* is stored per document:

| Setting | Choices |
| --- | --- |
| Document color mode | RGB (screen) or CMYK (print) |
| RGB working space | sRGB, Display P3, Adobe RGB (1998) |
| CMYK output profile | a `.icc` file you load, or the built-in approximation |
| Rendering intent | perceptual, relative colorimetric, saturation, absolute colorimetric |
| Black point compensation | on (default) or off |

OpenFini cannot ship FOGRA, GRACoL or SWOP profiles: their licenses do not allow redistribution. Ask your print shop for the profile of its printing condition, or download one from eci.org or color.org, and load it here. The profile is saved inside the document. Without a profile OpenFini uses an **approximation** that is fine for previews but not for color-critical work.

## CMYK and spot colors

In a CMYK document the Color panel shows **C, M, Y, K** sliders and an optional spot color name. A color that cannot be printed shows *Out of the CMYK gamut* with **Use the printable color**. *File ▸ Convert Colors* converts the selection (or the whole document and its swatches) to CMYK or back to RGB in one undo step.

## Soft proof and gamut warning

- *View ▸ Proof Colors (CMYK)* shows the colors as the profile would print them.
- *View ▸ Gamut Warning* paints colors that cannot be printed gray.

Both are off by default and cost a few milliseconds per redraw.

## PDF/X export and preflight

In the Export popup choose PDF and a **PDF standard**: Plain PDF, PDF/X-1a:2003 (CMYK, no transparency: transparent pages are rasterized) or PDF/X-4 (CMYK, transparency kept). CMYK documents always export CMYK. *File ▸ Print Preflight…* lists RGB objects, spot colors, ink above 320 %, images below 300 ppi, transparency, missing bleed, fonts that are not embedded and a missing profile.

The preflight is OpenFini's own check list, **not** a certified PDF/X validator such as Acrobat Preflight or veraPDF. Without a loaded profile a PDF/X file is "PDF/X-ish" and will not pass a validator. Check important jobs with your print shop.

## Image export

PNG and JPEG exports of documents in Display P3 or Adobe RGB carry that ICC profile. CMYK JPEG or TIFF export is not available.

## The assistant

The Vibe tools `set_color_mode`, `convert_colors` and `preflight_pdf` (group *Color*) do the same; loading a profile file stays a user action.

## See also

- [[Export and Publish]]
- [[Layout Studio]]
- [[Vibe Tools Reference]]
