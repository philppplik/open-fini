# 0005 — Scene graph compiled into a backend-neutral display list

**Status:** Accepted

## Decision

Nodes compile into a **display list** of paths, images, text runs and groups
([contract](../engine-contracts.md#2-display-list-dl)). The list is cached per node revision, expressed in
document units and independent of zoom. Backends (Canvas 2D, SVG, PDF) consume only the display list.

## Rationale

* Zooming and panning reuse cached geometry.
* Export formats stay consistent with the screen because they share one description.
* New backends (for example an optional WebGL fast path) need no changes to the editor.
* Features a backend cannot express are rasterized per group at export time, keeping the rest vector.

## Consequences

* Node edits must call `doc.touch()` (or go through `doc.set`) so cached items are invalidated.
* Master-page content depends on the page it is drawn on (page-number fields), so it is compiled uncached.
