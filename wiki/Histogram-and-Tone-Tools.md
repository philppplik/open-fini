# Histogram and Tone Tools

The Pixel studio has a live Histogram panel, an Info panel, interactive Levels and Curves, before/after histograms for every adjustment and a clipping overlay. Everything is computed from what is actually painted, so it works for any layer type. The Vibe assistant uses the same numbers.

## Histogram panel

Bottom dock of the Pixel studio.

| Control | Options |
| --- | --- |
| Source | Composite, Active layer (or the mask's gray values while editing a mask), Selection, or With adjustments up to this layer |
| Channels | RGB (three overlaid curves), Luminosity, Red, Green, Blue, Lab L* |
| Display | Log (small populations), Bars, Compact (one summary line), Detail |
| Inspect | Hover, or focus the graph and use `Left`/`Right` (`Shift` = 16 levels, `Home`/`End`) to read level, count, share and percentile |
| Data | A table view (16 buckets) for screen readers; the graph also has an `aria-label` describing the distribution |

**Statistics:** mean, median, standard deviation, pixel count, min and max, shadows and highlights clipped, and the 1 percent and 99 percent levels. A one-line assessment appears when a problem is detected (underexposed, overexposed, low or high contrast, clipping, possible color cast). It is deliberately tolerant; dark or high-key images are often intentional, so treat it as a hint.

### Clipping overlay

The Shadows and Highlights buttons (also *View ▸ Show Shadow / Highlight Clipping*) paint clipped pixels on the canvas: shadows blue (a channel at 0), highlights red (a channel at 255). It renders from a composite of at most 4 megapixels, so very high zoom on huge pages looks blocky. The page background counts: a white background shows as clipped highlights.

## Levels

Add *Levels* from the Adjust panel. The graph shows the histogram of what enters the layer.

- Drag the **black**, **gray** (gamma) and **white** triangles; arrow keys move the focused triangle by one level (`Shift` = 10). Numeric fields cover input black, gamma, input white, output black and output white.
- Tabs RGB, R, G and B edit the master or one channel.
- Eyedroppers set black point, white point (luminosity of the clicked pixel) and gray point (neutralizes a color cast); they sample the picture below the adjustment layer. `Esc` cancels.
- **Auto** sets points from the histogram (0.1 percent clipping); **Reset channel** and **Reset** restore defaults.

## Curves

Click the curve to add a point, drag to move, double-click or right-click (or `Delete`) to remove. `[` and `]` select the previous or next point; arrows nudge it (`Shift` = 10 levels). Tabs RGB, R, G, B; numeric In and Out fields; presets (medium and strong contrast, lighter, darker, lift shadows, faded blacks, negative); an eyedropper that adds a point for the clicked tone.

## Before/after histograms and Hold to compare

Every adjustment layer and Develop shows a small before/after histogram (filled = before, line = after). *Hold to compare* shows the picture without the effect while the button is held and creates no undo step.

## Info panel

Position and the composite color under the pointer as RGB, hex, HSL, HSB and Lab (D65), plus foreground and background. Clicking with the Color Picker pins Sample 1; `Alt`-click pins Sample 2 with the color difference (CIE76 delta E). *Sample* chooses a point or a 3x3, 5x5 or 11x11 average.

## Performance

The live histogram renders at most 1.5 megapixels; larger pages show an *approximate* result and an exact pass follows after 0.6 s without changes, in 1-megapixel strips. Updates are debounced and only run while a histogram panel is visible. There is no Web Worker, waveform or vectorscope, and no color management or soft proof: values are 8-bit sRGB.

## Vibe

`get_histogram` (read-only: statistics, 64-bin data, tonal summary, assessment) and `auto_correct_suggestion` (ready-made Levels, Curves, color-correction and Exposure parameters) ([[Vibe Tools Reference]]).

## See also

- [[Pixel Studio]]
- [[Performance and Low Power]]
- [[Accessibility]]
- [[Vibe Tools Reference]]
