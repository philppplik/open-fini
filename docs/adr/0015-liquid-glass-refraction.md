# 0015: Liquid glass refraction: own SVG displacement-map code instead of vendoring amazing-glass

Status: Accepted

## Context

The Liquid surface style should bend the content behind floating surfaces like real glass, standalone and offline.
[tomacco/amazing-glass](https://github.com/tomacco/amazing-glass) (MIT) does this with web components. Its distributable is
about 60 KB minified plus chunks, includes React/Vue wrappers, ten controls, a GPU field renderer and fitting data against
Apple's renderer, and has its own DOM and styling model. OpenFini already has a surface system (`ui/glass.js`, `glass.css`)
with strict rules: one blur layer per surface level, AA contrast floors, low-power and accessibility fallbacks.

## Decision

Re-implement the core technique (about 250 lines) in `ui/refraction.js` (pure) and `ui/refraction-dom.js` (lazy), with
attribution in `THIRD_PARTY_NOTICES.md` and `docs/themes.md`; do not vendor the library.

* A rim height profile (quarter sine) and Snell's law give a displacement map per rounded box; `feImage` +
  `feDisplacementMap` (three channels for dispersion) inside `backdrop-filter: url(#id)`.
* Maps are drawn once per size class and cached; filters are per surface, resized by a debounced `ResizeObserver`.
* Chromium-only: feature probe, otherwise the existing blur + specular edge.

## Consequences

* No third-party runtime code, nothing to update, no CDN; loaded only while Liquid is active (about 4 KB gzip).
* Less polished than a result fitted against Apple's renderer (no GPU field, no specular channel in the map; the highlight
  stays CSS).
* Refraction targets floating surfaces only; the chrome layer keeps a single blur (nested backdrop-filters are forbidden).
* If Safari or Firefox add `backdrop-filter: url()` the probe enables it without code changes.
* Alternative kept open: vendoring `dist/amazing-glass.min.js` under `app/vendor/amazing-glass/` with its LICENSE would give a
  richer look at roughly 15x the size and a second styling system to keep in sync with the theme variables.
