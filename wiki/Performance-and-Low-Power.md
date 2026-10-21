# Performance and Low Power

OpenFini targets old laptops, ARM single-board computers and budget tablets as much as workstations. This page explains the design rules behind that, the low-power mode, measurements you can reproduce and the known limits. Numbers come from the repository's performance document and depend on your hardware.

## Design rules

1. **Do less.** Nothing renders unless something changed; display lists are cached per node and reused across zooming and panning.
2. **Never block on a gesture.** Panning and zooming move already-rendered bitmaps with a GPU-composited transform and re-render once when the gesture settles.
3. **Touch only what changed.** Brush strokes recomposite only the 256x256 tiles they touched; undo stores the dirty rectangle, not the layer.
4. **No mandatory GPU features.** Canvas 2D only, no WebGL or WebGPU.
5. **Lazy everything.** The Code studio, Vibe runtime, PDF import, KaTeX and panels load when first used.
6. **Bounded memory.** History is capped by bytes; temporary canvases are pooled.
7. **Small download.** No framework, minified production JavaScript, precached for offline use.

## Low-power mode

*Settings ▸ Canvas and editing ▸ Low-power mode*: **Auto** (default) turns it on when the device reports 4 or fewer CPU cores or 4 GB RAM or less.

| | Normal | Low-power |
| --- | --- | --- |
| Canvas resolution cap | 2x device pixels | 1x |
| Page shadows | on | off |
| Undo memory | 96 MB | 32 MB |
| Live layer effects while dragging | full quality | skipped until release |
| Glass surface styles | as chosen | fall back to opaque |

## Measurements

Measured on a Windows 11 ARM64 laptop with a Chromium-based web view (release candidate; yours will differ):

| Metric | Result |
| --- | --- |
| DOMContentLoaded, cold production start | 83 ms |
| First contentful paint | 208 ms |
| JavaScript heap after start | about 6 MB |
| Create a website from a template to live preview | about 260 ms |
| 1,500 shapes, cold viewport render / warm | 32 ms / 5 ms |
| 12-megapixel layer, viewport render | 19 ms |
| 12 MP with HSL adjustment and live Gaussian blur at full quality | 133 ms (45 ms as a half-resolution draft while dragging) |
| Pixel engine, 2 MP image: Levels or Curves | about 8 ms |

Reproduce the pixel numbers with `node tests/pixel/bench.mjs`. The full tables are in [performance.md](https://github.com/philppplik/open-fini/blob/main/docs/performance.md).

## Size budgets

CI enforces gzip budgets with `npm run check:size`; see [[CI and Size Budgets]]. The desktop app is a Tauri shell around the system web view, so installers do not carry a browser.

## Tips

- Turn on low-power mode on slow machines, and lower *Undo-history memory*.
- While painting, hide stacks of heavy live filters (blur, median, defocus, oil paint) and show them again afterward.
- Close unused documents; each open document holds its pixels in memory.
- Prefer exporting at the scale you need; image export is capped at 16,384 px per side and 140 megapixels.

## Known limits

Adjustments and filters are computed in JavaScript on the viewport pixels (a Web Worker or WebAssembly move is on the roadmap). Documents above roughly 50 megapixels per layer depend on the web view's canvas memory. Histogram analysis runs on the main thread in small steps ([[Histogram and Tone Tools]]).

## See also

- [[Settings Reference]]
- [[Pixel Studio]]
- [[CI and Size Budgets]]
- [[Roadmap and Known Limits]]
