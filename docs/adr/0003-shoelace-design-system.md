# 0003 — Shoelace as the prebuilt design system

**Status:** Accepted

## Context

We want a professional, accessible, dense tool UI without writing every control — and without a UI
framework or a heavy dependency.

## Options considered

* **Shoelace 2.x** (web components, MIT): prebuilt color picker, range, select, menu / submenu, dialog, toast,
  tooltip, icons; dark and light themes; on-demand loading.
* Adobe Spectrum Web Components: closest "pro tool" look, but needs bundling and import maps.
* Fluent UI / Carbon web components: capable, heavier, with stricter bundling needs.
* CSS-only systems (Pico, Open Props): lightest, but no color picker, menu or dialog behavior.

## Decision

Use **Shoelace**, vendored in `app/vendor/shoelace` (autoloader, components, themes, ~150 icons), themed with
a small token layer (`app/styles/theme.css`) that tightens density and sets the accent color.

## Consequences

* Components load lazily (about 0.5 MB of the library per session instead of all of it).
* The UI is tied to custom elements; production builds keep Shoelace *unbundled* so the autoloader can fetch
  components by URL.
* Shoelace 2.20 is the last release of the 2.x line; migrating to its successor (Web Awesome) is possible
  later because only the primitives listed in the [design system](../design-system.md) are used.
