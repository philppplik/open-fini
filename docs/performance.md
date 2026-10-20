# Performance

OpenFini targets low-power hardware: old laptops, ARM single-board computers, budget tablets. This page
explains how that is achieved and records measurements you can reproduce.

## Design rules

1. **Do less.** Nothing renders unless something changed (`requestAnimationFrame` coalescing, no idle loop).
   Display lists are cached **per node** and reused across zooming and panning.
2. **Never block on a gesture.** Panning and zooming move the already-rendered bitmaps with a
   GPU-composited CSS transform and re-render once when the gesture settles (70 ms, or 140 ms when frames
   were slow). Scrolling costs no JavaScript.
3. **Touch only what changed.** Brush strokes recomposite the 256×256 tiles they touched; undo stores the
   dirty rectangle, not the layer; retouching works on small patches around each dab.
4. **No mandatory GPU features.** Canvas 2D only — no WebGL, no WebGPU, no OffscreenCanvas requirement.
   Effects use the browser's native shadow engine and `ctx.filter` when available, with a pure-JS fallback.
5. **Lazy everything.** UI components, panels and effect parameter forms are created on first use. Shoelace
   components load on demand. Algorithms live in small modules.
6. **Bounded memory.** History is capped by bytes (96 MB, 32 MB in low-power mode), temporary canvases are
   pooled, sprite caches are size-limited.
7. **Small download.** No framework; production JavaScript is minified; assets are precached for offline use.

## Low-power mode

*Preferences ▸ Low-power mode* (**Auto** by default: enabled when the device reports ≤ 4 CPU cores or
≤ 4 GB RAM):

| | Normal | Low-power |
| --- | --- | --- |
| Canvas resolution cap | 2× device pixels | 1× |
| Page shadows | on | off |
| Undo memory | 96 MB | 32 MB |
| Live layer effects (shadows, glows, blur) while dragging | full quality | skipped until release |

## Measurements

Measured on a Windows 11 ARM64 laptop with a Chromium-based WebView, **development** build for the
workload tests and **production** build for start-up. Your numbers will differ; re-run the scripts below.

### Start-up (production build, cold, no session to restore)

| Metric | Result |
| --- | --- |
| DOMContentLoaded | 83 ms |
| First contentful paint | 208 ms |
| JavaScript heap after start | 6.1 MB |
| JavaScript requested during start-up | 73 files, 832 KB uncompressed (Shoelace components included) |
| Application JavaScript (gzip, all chunks incl. the lazily loaded studios, engines and the Vibe Studio AI runtime) | 839 KiB (budget 900 KiB) |
| JavaScript needed to start (gzip, static import closure) | 317 KiB (budget 340 KiB) |
| PDF import (pdf.js and wasm, gzip, loaded when you open a PDF) | about 610 KiB, not precached |
| Total download incl. all lazily loaded Shoelace files (gzip, no fonts) | 701 KiB (budget 2 MiB) |

### Code studio (production build, local server, cold)

| Metric | Result |
| --- | --- |
| Start-up cost when the studio is not used | none (editor, engine and panels are lazy chunks) |
| Create a website from a template → live preview on screen | ~260 ms |
| Lazily loaded on first use | CodeMirror bundle 628 KB (216 KiB gzip), studio and engine chunks ~300 KB |
| JavaScript heap | 22 MB → 29 MB with the studio open |
| Stylesheet edit → canvas updated (no reload) | ~90 ms |
| Parsing 1 MB of HTML / CSS | ~25 ms each (Node) |

### Rendering and editing

| Workload | Result |
| --- | --- |
| 1,500 shapes (rectangles, ellipses, stars, 25 % gradients), cold render of the viewport | 32 ms |
| Same, warm re-render | 5 ms |
| Same, after panning | 4 ms |
| Plus 20 live drop shadows | 14 ms |
| 12-megapixel pixel layer (4000×3000), viewport render | 19 ms |
| 12 MP + one HSL adjustment layer (1.2 MP viewport, warm) | 31 ms |
| 12 MP + HSL + live Gaussian blur, full quality | 133 ms |
| Same while dragging or painting (half-resolution draft) | 45 ms |
| Brush stroke, 400 pointer events, 120 px brush, 12 MP layer | 151 ms total |
| JavaScript heap with the 12 MP document open | 88 MB |

### Pixel engine (Node 24, 2-megapixel image)

| Operation | Time |
| --- | --- |
| Gaussian blur (opaque / translucent) | ~110 ms / ~165 ms |
| Levels / Curves | ~8 ms |
| Resize 50 % (bicubic / Lanczos-3) | ~79 ms / ~93 ms |
| Develop pipeline (exposure, shadows / highlights, contrast, clarity, vibrance) | ~180 ms |
| Selection contour tracing, 4000² disc | ~100 ms |

Reproduce with `node tests/pixel/bench.mjs`.

## Known limits

* **Adjustment and filter layers are computed in JavaScript on the viewport pixels.** Simple adjustments
  cost tens of milliseconds per frame, heavy filters (blur, median, defocus) and large windows cost more.
  While you drag or paint, effects are computed at half resolution (a quick draft) and the full-quality
  frame follows when you release; panning and zooming use the CSS preview. A stack of several heavy live
  filters on a slow CPU can still make painting beneath it feel slow — hide them while painting.
  Moving these effects to a Web Worker / WebAssembly is on the [roadmap](roadmap.md).
* Very large documents (> 50 MP per layer) are limited by the WebView's canvas memory; the export size is
  capped at 16,384 px per side and 140 MP.
* Median, defocus and oil-paint filters are CPU heavy at large radii.

## Budgets in CI

`npm run check:size` fails the build when the gzip size of the application JavaScript exceeds 900 KiB, the JavaScript needed to start exceeds 340 KiB, or the
total download exceeds 2 MiB (see [`scripts/size-budget.json`](../scripts/size-budget.json)).
