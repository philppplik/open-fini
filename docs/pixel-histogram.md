# Histogram, Levels and Curves (Pixel studio)

The Pixel studio has a live **Histogram** panel, an **Info** panel and interactive **Levels**, **Curves** and
before / after histograms inside the Adjust panel. Everything is computed in JavaScript from what is actually
painted on the page, so it works for any layer type and for adjustment layers. The Vibe assistant uses the same
numbers (`get_histogram`, `auto_correct_suggestion`).

## Histogram panel

Bottom dock of the Pixel studio (next to Layers and History).

* **Source**: *Composite* (all visible layers), *Active layer* (only that layer's pixels; while you edit a layer
  **mask**, the mask's gray values), *Selection* (the composite inside the current pixel selection) and
  *With adjustments up to this layer* (the result of the stack up to and including the active layer, so you can see
  what an adjustment layer produces). Without a selection or layer the panel falls back to the composite and says so.
* **Channels**: RGB (three overlaid curves), Luminosity, Red, Green, Blue and Lab L* (CIE lightness).
* **Log** makes small populations visible; **Bars** draws bars instead of a smooth area.
* **Hover** (or focus the graph and use `Left` / `Right`, `Shift` for 16 levels, `Home` / `End`) to read level, pixel
  count, share and percentile ("% of pixels at or below this level").
* **Statistics**: mean, median, standard deviation, pixels, min / max, shadows and highlights clipped, and the 1% / 99%
  levels. A one-line assessment appears when a problem is detected.
* **Compact** shrinks the panel to a thin strip with one summary line; **Detail** restores everything.
* **Data** shows the histogram as a table (16 buckets of 16 levels, percent per channel) for screen readers.
  The graph itself has `role="img"` and an `aria-label` that describes the distribution in words.
* Colors follow the theme (`--of-*` variables) and the canvas renders at device resolution (also on high-DPI screens).

### Clipping overlay

The **Shadows** and **Highlights** buttons (also **View > Show Shadow / Highlight Clipping**) paint pixels with a
clipped channel on the canvas: shadows in blue (a channel at 0), highlights in red (a channel at 255). The overlay is
computed from a composite render of at most 4 megapixels and is drawn pixel-crisp; at very high zoom on huge pages
it is blocky because it is not rendered per screen pixel. Pixels with alpha 0 are never marked; the page background
counts (a pure white page background therefore shows as clipped highlights).

### Statistics definitions

| Value | Definition |
| --- | --- |
| Mean, median, std dev | Of the 256-bin histogram of the selected channel. For **RGB**: of all three channels together. |
| Pixels | Counted pixels (alpha > 0, inside the selection). A trailing `≈` means estimated from a sample. |
| Shadows / highlights clipped | Share of samples at level 0 / 255. For **RGB**: pixels where *any* channel is 0 / 255. |
| 1% / 99% | Levels below which 1% / 99% of the samples lie (the effective black and white point). |
| Percentile (hover) | Share of samples with a level less than or equal to the hovered level. |
| Lab L* | CIE L* of the linear luminance, scaled to 0-255. |
| Luminosity | `(77 R + 150 G + 29 B) / 256` (Rec. 601 weights, the engine's luma). |

The *assessment* (also returned to the assistant) is deliberately tolerant: *underexposed* when median < 80 and mean
< 95, *overexposed* when median > 180 and mean > 165, *low contrast* when the 1%-99% range is under 140 levels or the
standard deviation under 38, *high contrast* above 80, clipping "some" from 1% and "heavy" from 5% of pixels at
luminosity 0-1 or 254-255, and a possible color cast when the channel means differ by 14 levels (warm / cool) or 10
(green / magenta). Dark, low-key or high-key images are often intentional, so treat it as a hint.

## Interactive Levels

Add *Levels* from the Adjust panel. The graph shows the histogram of what enters the layer (everything below it)
with a line for the result.

* Drag the **black**, **gray** (midtone / gamma) and **white** triangles under the graph; arrow keys move the focused
  triangle by one level (`Shift` = 10). Output black and white are the two triangles under the gradient bar.
* Numeric fields for input black, gamma, input white, output black and output white.
* Tabs **RGB / R / G / B** edit the master or a single channel (stored in the layer's `channels`; the master and the
  channel settings are combined).
* Eyedroppers: **black point** and **white point** use the luminosity of the clicked pixel (in a channel tab: that
  channel); the **gray point** neutralizes a color cast so the clicked color becomes gray (per-channel gamma). They
  sample the picture *below* the adjustment layer; the sample size follows *Info > Sample*. `Esc` cancels.
* **Auto** sets black / white point and gamma from the histogram (0.1% clipping). **Reset channel** and the panel's
  **Reset** restore defaults. A line shows how much would clip at each end.

## Interactive Curves

* Click the curve to add a point, drag to move, double-click or right-click a point (or press `Delete`) to remove it.
  Keys: `[` / `]` select the previous / next point, arrow keys nudge it (`Shift` = 10 levels).
* Tabs RGB / R / G / B, numeric *In* / *Out* fields for the selected point, presets (medium and strong contrast,
  lighter, darker, lift shadows, faded blacks, negative), **Reset channel**, and an eyedropper that adds a point for the
  clicked tone. The histogram of the input is drawn behind the curve; hovering shows *In -> Out*.

## Other adjustments

Every adjustment layer (Exposure, Brightness / Contrast, Shadows / Highlights, HSL, ...) and Develop show a small
**before / after histogram** (filled = before, line = after, luminosity) above their controls. The effect runs on a
~160 000-pixel proxy for this preview. Common to all adjustment layers: **Enabled**, **Opacity**, **Hold to compare**
(shows the picture without the effect while the button is held, no undo step), a mask button, **Reset** and
**Apply to layer**. The controls follow undo / redo and Reset.

## Info panel

Shows position and the composite color under the pointer as RGB, hex, HSL, HSB and Lab (D65), plus the foreground
and background colors. Clicking with the **Color Picker** pins *Sample 1*, `Alt`-click pins *Sample 2* with the color
difference (CIE76 delta E). *Sample* chooses a point or a 3 x 3, 5 x 5 or 11 x 11 average.

## Color Range and Magic Wand

Color Range gained a sample size, a choice between all layers and the active layer, and **Invert**; its *Softness*
slider now really feathers the range (it was passed to the engine in the wrong unit and had almost no effect). Both
selection tools report the number of selected pixels in the status bar, and the wand explains when the active layer
has no pixels.

## Performance and limits

* The live histogram renders at most 1.5 megapixels. Pages above that are shown as *approximate* (sampled) and an
  **exact** pass over the full resolution follows after 0.6 s without changes, in 1-megapixel strips that yield to the
  UI between strips. Measured on a 24-megapixel page: the longest blocking step was under 100 ms and the exact numbers
  were ready after about 1.5 s. Edits restart or cancel the exact pass.
* Updates are debounced (220 ms), run only while a histogram panel is visible, and are skipped when document revision,
  selection, source and active layer did not change.
* There is no Web Worker: analysis runs on the main thread in small steps.
* Layer-mask histograms are always from a downsampled copy for very large masks. Selection histograms count pixels
  with at least 50% selection coverage.
* There is no color management or soft proof: values are sRGB-encoded 8-bit.
* The clipping overlay and the Levels / Curves backdrops use proxies and can therefore differ from the exact numbers by
  a fraction of a percent on large images.

## For the assistant

`get_histogram` (read-only) returns statistics, 64-bin data, a tonal summary and an assessment with suggestions for a
source (`composite`, `layer`, `selection`, `upto`) and channel. `auto_correct_suggestion` returns Levels, Curves,
per-channel color-correction Levels and Exposure parameters. `apply_adjustment` accepts them directly:
levels `{ inBlack, inWhite, gamma, outBlack, outWhite, channels? }`, curves `{ master|red|green|blue: [[x, y], ...] }`
(0..1), and validates both. `list_effects` with an `id` shows the usage text.
