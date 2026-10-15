# 0002 — Canvas 2D rendering, no WebGL requirement

**Status:** Accepted

## Context

The renderer has to be fast on integrated or software-rendered graphics and behave the same in WebView2,
WKWebView and WebKitGTK.

## Decision

Render with **Canvas 2D** only. Vector content is drawn directly with `Path2D`; groups are isolated into
pooled offscreen canvases only when opacity, blend mode, masks or effects require it. Layer effects use the
browser's native shadow engine and `ctx.filter` when available, with a pure-JavaScript fallback in the pixel
engine. Pixel adjustments run on the viewport region, not on the whole document.

## Consequences

* Works on every device that can show a web page; no shader compilation, no context-loss handling.
* Per-frame cost of live adjustments grows with the window size (see [performance](../performance.md)).
  WebGL / WebGPU may be added later as an **optional** accelerated path behind the same display-list
  interface.
* Safari-family WebViews lack some `CanvasRenderingContext2D` features (`filter`); the code probes for them
  and falls back.
