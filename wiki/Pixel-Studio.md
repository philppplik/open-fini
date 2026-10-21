# Pixel Studio

The Pixel studio is for photo editing and painting: layers and masks, selections, brushes, retouching tools, 18 non-destructive adjustments, 22 live filters, a RAW-style Develop pipeline, Liquify and a live histogram. Everything is 8-bit sRGB; see the limits at the end.

## Tools

| Tool | Key | Notes |
| --- | --- | --- |
| Marquee (rectangular, elliptical) | `M` | `Shift`, `Alt` and `Shift+Alt` add to, subtract from or intersect the selection |
| Lasso (freehand, polygonal) | `L` | Polygonal: click points, click the first point or press `Enter` to close, `Backspace` removes a point |
| Magic wand, Color range | `W` | Tolerance, contiguous, sample the layer or all layers; Color range adds softness, sample size and invert |
| Crop | `C` | Ratios; optionally delete cropped pixels |
| Brush, Pencil | `B` | `[` and `]` change the size; pressure sensitive; on a mask light colors reveal and dark colors hide |
| Eraser | `E` | |
| Clone, Heal, Spot heal, Red eye | `S`, `J`, `R` | `Alt`-click sets the source for clone and heal |
| Smudge, Blur, Sharpen | `O` | |
| Dodge, Burn, Sponge | `D` | Range: shadows, midtones, highlights |
| Fill, Gradient | `F`, `G` | Respect the active selection |
| Liquify | `Q` | Push, twirl, pinch, bloat, reconstruct; `Enter` applies |
| Color picker | `I` | Click = foreground, `Alt`-click = background |

Colors: `X` swaps foreground and background, `D` resets them. `Alt+Backspace` fills the selection with the foreground color, `Mod+Backspace` with the background color.

## Selections

The Select menu has All, Deselect, Reselect, Invert (`Mod+Shift+I`), Feather, Grow, Shrink, Border, Smooth, Color Range, and selection to layer, layer mask or curves. The status bar reports the number of selected pixels.

## Layers

New pixel layer (`Mod+Shift+N`), groups, layer masks (paint on them or build from selections), blend modes, **Merge Down** (`Mod+E`, which also bakes an adjustment into the layer below), Rasterize and Flatten. Hidden layers stay in the Layers panel, dimmed.

## Adjustments and filters

Adjustments and live filters are **non-destructive layers**: reorder, mask, hide and re-edit them.

- **Adjustments (18):** levels, curves, HSL, white balance, selective color, gradient map and more.
- **Live filters (22):** Gaussian, motion, radial and zoom blur, unsharp mask, clarity, noise, halftone, oil paint, tilt-shift and more.
- **Develop** (exposure, shadows and highlights, contrast, clarity, vibrance) and **Tone Mapping** work on decoded 8-bit images; there is no RAW decoding.
- *Apply to the selected layer only* in the Adjust panel nests an adjustment under one layer instead of affecting everything below.

Every adjustment layer has Enabled, Opacity, Hold to compare, a mask button, Reset and Apply to layer, plus a small before/after histogram.

## Histogram, Levels and Curves

The bottom dock has a live **Histogram**, the **Info** panel shows the color under the pointer, and the Adjust panel has interactive **Levels** and **Curves**. See [[Histogram and Tone Tools]].

## Other features

- **Image Trace** converts a pixel layer to vectors; **Liquify** reshapes pixels.
- File support: PNG, JPEG, WebP, GIF, BMP, AVIF, TIFF (pages as layers), animated GIF (frames as layers, no timeline), PSD and PSB import, PSD and OpenRaster export ([[File Formats]]).
- The clipping overlay (View menu) marks clipped shadows in blue and highlights in red.

## Performance

Adjustments and filters are computed in JavaScript on the viewport pixels, at half resolution while you drag or paint. Heavy filters on large images can feel slow on weak CPUs; hide them while painting and see [[Performance and Low Power]].

## Limits

8-bit sRGB only: no CMYK, ICC profiles, 16-bit editing, HDR or RAW decoding. No smart selection, patch tool, perspective or warp transforms, channels, brush dynamics or batch processing. Layers above roughly 50 megapixels depend on the web view's canvas memory. See [[Roadmap and Known Limits]].

## Vibe

Tools include effect catalog, pixel and adjustment layers, selections, image generation and editing (with the image model you configure), `get_histogram` and `auto_correct_suggestion` ([[Vibe Tools Reference]]).

## See also

- [[Histogram and Tone Tools]]
- [[Studio Overview]]
- [[File Formats]]
- [[Performance and Low Power]]
