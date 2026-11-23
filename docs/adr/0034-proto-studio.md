# ADR 0034: Proto Studio: a UI design and prototyping studio whose canvas is real HTML and CSS

- Status: Proposed
- Date: 2026-11-23
- Concept and build plan: [docs/concepts/proto-studio.md](../concepts/proto-studio.md)
- Builds on: [ADR 0006](0006-ofini-format.md) (`.ofini`), [ADR 0011](0011-live-editing-sync.md) (live editing),
  [ADR 0016](0016-office-suite-apps.md) (`doc.office` kinds), [ADR 0029](0029-scene-studio.md) (a studio on the
  generic project container), [ADR 0032](0032-ofini-cli.md) (CLI reuses pure modules), [ADR 0033](0033-docking-layout.md)
  (docking)

## Context

OpenFini can draw (Vector), lay out pages (Layout), build websites by hand (Code, with a visual HTML designer) and edit
video (Scene). It cannot design application UI the way people do it today in Figma, Penpot, Paper or Sketch: frames
with auto layout, components with variants and properties, variables with modes, clickable prototypes, and a handoff
to code. In 2025 and 2026 these products all added a way for AI agents to work on the document: Figma's MCP server
(read, and since 2026 write to the canvas), Penpot's official MCP server, Sketch's local MCP server, and Paper, whose
canvas is HTML and CSS and which ships an MCP server in its desktop app.

The owner wants a studio of that class that is native to OpenFini: the Vibe assistant creates and edits frames and
components from prompts and screenshots, an MCP server exposes the document to external agents (Claude Code, Cursor),
the `ofini` CLI exports code, tokens and assets and lints, the Code studio shares tokens and components with it, it is
live-collaborative from the first release, its panels dock, and it imports SVG, Sketch and Penpot files.

Constraints that shape the decision:

* No framework, no build step in development, lazy loading, a start-up budget with almost no headroom
  (`scripts/size-budget.json`).
* Clean-room policy ([clean-room.md](../clean-room.md)): no proprietary formats without a public specification.
* Engines must stay pure so that the CLI, the tests and the assistant share them (ADR 0032).
* Collaboration is a records CRDT on immutable JSON models for non-tree kinds (`collab/office-records.js`).

## Decision

1. **A new studio, `proto`, on the generic project container.** A Proto document is an OpenFini document whose
   project (`doc.office`) has kind `"proto"` (like Scene, ADR 0029). This reuses undo (`commitOffice`), autosave,
   sessions, the file format's version rule, media storage (`office/proto/media/`) and the records-based live
   editing. The studio definition (`studios/proto.js`) is the only start-up code; everything else loads on first use.

2. **One pure, versioned document model.** `engine/proto/` holds the schema (`schema: 1`, migrations, validation),
   a flat map of nodes with parent ids and fractional order keys, components with variants, properties and
   overrides, variables with collections and modes, styles as composite tokens, and prototype interactions. Its
   vocabulary is CSS's: sizing, flex and grid layout, constraints, fills, strokes and effects all have one documented
   CSS meaning.

3. **One operation layer for every caller.** `engine/proto/ops.js` is the only way the model changes. The editor
   tools, the Vibe tools, the MCP server and `ofini proto` all call the same pure operations, so a capability exists
   for one caller only if it is deliberately hidden from the others.

4. **The canvas is rendered as real DOM and CSS.** One compiler (`engine/proto/css.js`) turns nodes into CSS
   declarations; the editor renders them as keyed DOM inside a shadow root per top-level frame, and the code exporter
   emits the same declarations. The browser's layout engine is the layout engine, so what the designer sees is what
   the exported code does. Selection, guides, measurements and remote cursors are drawn on one Canvas 2D overlay.
   A small pure layout solver (`engine/proto/layout.js`, flex, grid and constraints with approximate text metrics)
   serves the places without a browser: the CLI's SVG render and lint, and headless MCP. Its results are labeled
   approximate, as with the CLI's text metrics today (ADR 0032).

5. **Design tokens in the W3C DTCG format.** Variables and styles import and export as Design Tokens Community Group
   JSON (stable format 2025.10), and compile to CSS custom properties, a Tailwind v4 `@theme`, and Swift. A Code studio
   project can own a `tokens.json` that the Proto document links to; the file is the source of truth while linked.

6. **Code export through one intermediate representation.** `engine/proto/codegen/` lowers the model to an element
   tree with semantic tags, classes and token references; emitters write HTML + CSS, React (CSS Modules or Tailwind),
   Tailwind HTML and SwiftUI. Output is deterministic and snapshot-tested. Import of HTML runs in the Code studio's
   sandboxed preview (computed styles and boxes); the CLI has a static best-effort path.

7. **An MCP server over the same operations, off by default.** A transport-neutral JSON-RPC handler
   (`engine/proto/mcp/`) implements MCP 2025-11-25 tools and resources over `ops.js`. Transports: on the desktop,
   Streamable HTTP on `127.0.0.1` from the Tauri shell (random port, bearer token, Host and Origin checks, per-client
   approval, read-only until the user allows writes); in a terminal, `ofini mcp` over stdio, either working headless on
   a file or proxying to the running desktop app. The browser build cannot listen on a port and offers no server.
   Proto also uses MCP as a client through the existing `ai/mcp.js`.

8. **Live collaboration from the first release.** A records adapter (`proto/collab.js`) maps the model to keyed
   records (structure, layout, style, text, component, variable, interaction records per node), and `"proto"` joins
   `LIVE_OFFICE_KINDS`. Comments anchor to node ids through the existing comments system; presence shows cursors and
   selections in canvas coordinates.

9. **No `.fig` import.** Figma's `.fig` container has no public specification; reading it would mean reverse
   engineering, which the clean-room policy rules out (rule 4, and [clean-room.md ▸ Formats we deliberately do not
   read](../clean-room.md#formats-we-deliberately-do-not-read)). Routes from Figma are SVG (copy or export), Figma's
   official REST API with the user's own token (a later, optional importer, after a review of the API terms), and
   whatever the user's own MCP connections return. SVG, Sketch (existing reader, extended to symbols) and Penpot
   exports (an open, documented format of an open-source product, read by our own code) are imported.

10. **Built in small, independently mergeable tasks** across the 1.3.x releases, listed in the concept document.
    1.3.0 ships a preview (model, renderer, core tools, components and variables in the engine, live
    collaboration, assistant tools, CLI); 1.3.1 adds the panels for components and variables, code export, imports
    and prototyping; 1.3.2 the MCP server and the Code studio live link.

## Rendering: why DOM and not Canvas 2D or WebGL

| | DOM + CSS (chosen) | Canvas 2D display list (as Vector) | WebGL / WASM engine (as Figma) |
| --- | --- | --- | --- |
| Layout fidelity with exported code | Exact: the same CSS | Needs our own flex, grid and text engine with browser parity | Same as Canvas 2D, plus a GPU renderer |
| Text (shaping, fallback, wrapping, variable fonts) | The browser's | Our layout engine (good for print, not for CSS parity) | Our own |
| Effort | Small renderer, large performance care | Large | Very large |
| Large documents | Needs culling and level of detail | Scales well | Scales best |
| Headless (CLI, Node) | Needs a second, approximate solver | Same code | Same code |
| Smart animate in the player | Native (FLIP + Web Animations) | Own interpolation | Own interpolation |

The decisive argument is fidelity: Proto exists to produce interfaces that become HTML, React or SwiftUI. Every
point where the canvas and the browser disagree is a bug the user finds in production. Paper shows that an HTML and
CSS canvas works for this class of tool. The costs are accepted and bounded: culling and `content-visibility` per
frame, a simplified level of detail below 25 % zoom, a transform-only pan and zoom with re-rasterization when idle,
keyed incremental patching, and the performance targets in the concept document, measured in CI on a fixture.
Vector-style drawing inside a frame (paths, boolean results) renders as inline SVG, which is also what the exporter
writes.

## Consequences

* A designer's frame, its prototype in the player, its HTML export and its React export share one CSS meaning.
* Agents inside and outside the app get the same capabilities, through the same tested operations, with one
  security model; external agents cannot do anything the user has not allowed, and every write is one undo step.
* The pure solver is a second layout implementation. It is kept small, documented as approximate, and tested
  against geometry recorded from Chromium and Firefox; it is never used to draw the canvas.
* Performance depends on the browser engine (WebView2, WKWebView, WebKitGTK). WebKitGTK is the slowest; the level
  of detail and culling are mandatory, not optional.
* The start-up bundle grows by the studio definition and menu rows only (about 1 KiB); the studio itself adds an
  estimated 120 to 160 KiB gzip of lazy JavaScript over the 1.3.x releases, budgeted per task.
* Two new network surfaces (the MCP HTTP endpoint and, later, the Figma API importer) need security review;
  both are off by default.

## Alternatives considered

* **Extending the Vector studio with auto layout and components.** Its Canvas 2D display list and print-oriented
  model (pages, artboards, text stories for layout) would need a CSS layout engine with browser parity anyway, and
  the Vector studio would carry UI-design concepts that illustrators never use. Rejected; Vector keeps its role and
  Proto imports and exports SVG to exchange artwork with it.
* **Extending the Code studio's visual designer.** It edits arbitrary hand-written HTML and CSS with offset-preserving
  source edits; it has no components with variants, no variables with modes, no free canvas with many frames and no
  prototypes. Making the source text the model would make every design operation a text edit. Rejected; the two
  studios link instead (tokens, components, HTML import and export).
* **Vendoring an open-source design tool or layout engine** (Penpot is Clojure on a server; Yoga is C++/WASM, about
  100 KiB gzip, and covers flex only). Rejected for size, language and fidelity with grid.
* **A `.fig` reader based on community reverse engineering.** Rejected by the clean-room policy (see Decision 9).
* **An MCP server in the browser over a local WebSocket bridge.** Possible later through Chrome's Local Network
  Access permission and a pairing code, but it adds a listening helper the user must install; not part of this plan.
