# 0004 — Plain ES modules, no UI framework, no build step in development

**Status:** Accepted

## Decision

The application is written as native ES modules with a tiny hyperscript helper (`h()`), an event emitter and
explicit panel / tool classes. `app/` is served as-is during development (`npm start`); production builds
bundle and minify with esbuild.

## Rationale

* Smallest possible download and memory footprint; nothing runs unless it is needed.
* The hot paths (canvas rendering, pointer handling, hit testing) do not benefit from a virtual DOM.
* Contributors can read, debug and change the code in the browser without a toolchain.
* The pure engines (`engine/pixel`, `engine/layout`) run unchanged in Node.js for unit tests.

## Consequences

* UI code is imperative; panels re-render themselves on events. Conventions are described in
  [architecture](../architecture.md).
* Types are documented with JSDoc rather than TypeScript.
