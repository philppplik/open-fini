# ADR 0035: World Studio: a 3D studio on a pure scene and mesh model, rendered through a pinned three.js behind our own adapter

- Status: Proposed
- Date: 2026-11-25
- Concept and build plan: [docs/concepts/world-studio.md](../concepts/world-studio.md)
- Builds on: [ADR 0002](0002-canvas2d-rendering.md) (Canvas 2D, WebGL only as an optional path),
  [ADR 0006](0006-ofini-format.md) (`.ofini`), [ADR 0011](0011-live-editing-sync.md) (live editing),
  [ADR 0019](0019-extension-workers-watchdog.md) (worker pool), [ADR 0028](0028-vibe-code-mode.md) (`run_script`),
  [ADR 0029](0029-scene-studio.md) (a studio on the generic project container, keyframes, frame = f(model, time)),
  [ADR 0032](0032-ofini-cli.md) (CLI reuses pure modules), [ADR 0033](0033-docking-layout.md) (docking),
  [ADR 0034](0034-proto-studio.md) (one operation layer for editor, Vibe, MCP and CLI)

## Context

OpenFini covers vector, pixel, page layout, code, office documents, video and UI design. It has no 3D. People who
make a product shot, a hero animation for a website, a 3D logo, a printable part or a turntable for a slide leave the
suite for Blender, Spline or a web editor, and come back with a PNG or a video. The assistant cannot build or change
3D content at all. The Code studio can start a three.js project from a template (CDN import map), and the Scene
Studio has a WebGL 2 pixel pass, but nothing models, lights, shades or renders a scene.

The owner wants a 3D studio of the class people use in 2026, native to OpenFini: modeling with an edit mode and a
modifier stack, sculpting basics, cameras and lights, PBR materials with a node editor (including custom GLSL and
WGSL nodes), real-time rendering that looks good (image-based lighting, shadows, ambient occlusion, bloom, a post
stack, particles, procedural textures), animation with the Scene Studio's timeline semantics, UV unwrapping basics,
glTF first plus OBJ, STL and PLY, renders into Pixel and Scene, 3D in Layout, Proto, Presentation and web exports,
the Vibe assistant creating scenes, materials and shaders from prompts, MCP and `ofini world` for agents and CI, live
collaboration, dockable panels, and a document kind `"world"`.

Constraints that shape the decision:

* No framework, no build step in development, lazy loading, a start-up budget with almost no headroom
  (`scripts/size-budget.json`). Vendored code must be MIT-compatible (CONTRIBUTING, THIRD_PARTY_NOTICES).
* Clean-room policy ([clean-room.md](../clean-room.md)): no proprietary formats without a public specification, no
  reverse engineering.
* Engines stay pure so that the CLI, the tests, the assistant and MCP share them (ADR 0032, ADR 0034).
* ADR 0002 keeps the 2D studios on Canvas 2D and allows WebGL / WebGPU as an optional path. A 3D studio cannot work
  without a GPU API.
* Three system web views: WebView2 (Chromium, WebGPU), WKWebView (WebGPU since macOS 26 / iOS 26), WebKitGTK (WebGL 2
  only, sometimes software rendered). WebGPU is not available everywhere we run.

## Decision

1. **A new studio, `world`, on the generic project container.** A World document is an OpenFini document whose project
   (`doc.office`) has kind `"world"`, like Scene (ADR 0029) and Proto (ADR 0034): undo through `commitOffice`,
   autosave, sessions, the format's version rule, media under `office/world/media/`, records-based live editing.
   `studios/world.js` is the only start-up code; everything else loads on first use. Until the preview label is
   removed, the studio is behind *Settings ▸ Labs ▸ World Studio*.

2. **One pure, versioned scene model and one operation layer.** `engine/world/` holds the schema (`schema: 1`,
   migrations, validation), a flat node map with parent ids and fractional order keys (as Proto), meshes,
   materials with node graphs, textures, environments, cameras, lights, animation channels and render settings.
   `engine/world/ops.js` is the only way the model changes; the editor, the Vibe tools, MCP and `ofini world` call
   the same operations. Units are meters, +Y is up, right-handed (glTF's convention), rotations are stored as Euler
   degrees for people and agents and converted to quaternions at the edges.

3. **Our own pure mesh kernel; the renderer never owns geometry.** `engine/world/mesh/` is an indexed polygon mesh
   (n-gons, a derived half-edge index for topology queries), parametric primitives, the edit operations (extrude,
   inset, bevel, loop cut, bridge, merge, dissolve, subdivide), the modifier stack (subdivision, mirror, array,
   solidify, bevel, boolean, decimate, displace, weld, triangulate) and UV unwrapping. It is plain JavaScript on
   typed arrays, runs in Node and in workers, and is unit-tested without a GPU. Mesh bytes live outside the JSON
   in content-addressed binary parts. Robust booleans use **manifold** (Apache-2.0, WebAssembly) in a worker;
   simplification and compression use **meshoptimizer** (MIT); Draco (Apache-2.0) and KTX2/Basis transcoders
   (Apache-2.0) are decode-only and on demand. All are vendored, pinned and loaded lazily.

4. **Rendering through three.js, vendored and pinned, behind `world/render/`.** The renderer is a projection of the
   model (as Proto's DOM is a projection of its model): `world/render/sync.js` turns model revisions into a three.js
   scene graph with keyed, incremental updates, and nothing outside `world/render/` imports three.js. We use
   three.js's `WebGPURenderer`, which runs on WebGPU where available and falls back to its WebGL 2 backend, so that
   one material compiler (our node graphs lowered to three.js's shading language, TSL, which emits WGSL or GLSL)
   serves both. Features that need compute (GPU particles, some post passes) have a documented WebGL 2 fallback with
   lower limits. three.js is loaded on demand like the PDF reader, never at start-up, and is cached for offline use
   after the first load.

5. **Material node graphs are data, compiled per backend.** A material is a JSON graph of typed nodes (PBR output,
   textures, noise, math, color, UV, vectors, time) with one CPU evaluator for previews, baking and the CLI and one
   compiler to TSL for the GPU. **Custom shader nodes** carry WGSL and/or GLSL source with declared inputs and
   outputs; they never run until the user trusts the document on this device, pass static checks (size, bounded
   loops, no forbidden constructs), compile asynchronously, and are disabled by a GPU watchdog on device loss or
   long frames.

6. **Animation shares the Scene Studio's semantics.** Channels use `scene/keyframes.js` unchanged (keyframes
   `{ t, v, e, i, o, b }`, easings, tangents, behaviors), times are seconds on a frame grid, frame = f(model, time),
   and the Scene Studio's keyframe rows and graph editor are reused through a property adapter. A World document can
   be a Scene clip (a live 3D layer) and render turntables and stills into Scene and Pixel.

7. **glTF 2.0 / GLB is the native exchange format.** Pure readers and writers in `engine/world/formats/` for glTF and
   GLB (with the common `KHR_materials_*`, `KHR_texture_transform`, `KHR_mesh_quantization`, `EXT_meshopt_compression`,
   `KHR_draco_mesh_compression` decode, `KHR_lights_punctual`, `KHR_texture_basisu`), OBJ + MTL, STL (binary and
   ASCII) and PLY; USDZ export only (USDA text in the documented USDZ ZIP layout, for Apple Quick Look). **No FBX
   reader or writer**: the format has no public specification, and Autodesk's FBX SDK is a proprietary, closed-source
   library under its own license, which we will not ship in an open-source app; FBX reaches OpenFini through a converter the user installs (Blender on the command line), as
   ADR 0029 handled ffmpeg.

8. **Agents and the terminal reach the same operations.** Vibe tools in `vibe/tools/world.js` (text to scene,
   material and shader from a prompt, procedural generation, multi-view screenshots, picking and scene
   description), World tools in the MCP server that ADR 0034 introduces (same handler, same security rules), and
   `ofini world` (`info`, `tree`, `inspect`, `validate`, `lint`, `convert`, `optimize`, `export`, `apply`, `diff`,
   `render`). GPU rendering stays in the app (ADR 0032); the CLI has a small pure software rasterizer for previews,
   labeled approximate, and proxies `render` to a running desktop app when asked.

9. **Live collaboration from the first preview.** A records adapter (`world/collab.js`) maps nodes, transforms,
   modifier stacks, material graph nodes, animation channels and settings to keyed records; mesh bytes travel as
   content-addressed chunks, so an edit sends only the chunks that changed. `"world"` joins `LIVE_OFFICE_KINDS`.

10. **ADR 0002 gets a scoped exception.** World is the first studio that requires a GPU API (WebGL 2 minimum). Every
    other studio keeps Canvas 2D. Without WebGL 2, a World document opens read-only with its outline, statistics
    and a software preview, and every non-rendering command (convert, inspect, optimize) still works.

11. **Built in small, independently mergeable tasks** across the 1.4.x releases, listed in the concept document
    (eighteen tasks in six waves; 1.4.0 ships a Labs preview).

## Engine: own renderer, three.js, Babylon.js or PlayCanvas

| | Own renderer | three.js (chosen) | Babylon.js | PlayCanvas engine |
| --- | --- | --- | --- | --- |
| License | ours (MIT) | MIT | Apache-2.0 | MIT |
| Size we would load (gzip, estimate) | 60 to 120 KiB after years of work | about 170 KiB (WebGL renderer); the WebGPU build with TSL and its WebGL 2 backend is larger, measured in T4 | about 500 KiB for a basic glTF viewer, much more with the node material editor | about 300 KiB |
| WebGPU with a WebGL 2 fallback | to build | `WebGPURenderer` with a WebGL 2 backend and TSL (still marked experimental upstream) | mature, both backends | both backends |
| Node materials | to build | TSL is a node system; our graph lowers to it | Node Material Editor (its own UI and format) | shader chunks, no node system in the engine |
| PBR, IBL, shadows, post | to build (years) | built in or in examples | built in | built in |
| Control over the frame and memory | full | high: we own the scene sync, the passes and disposal | medium: a large framework with its own scene and asset model | medium: an engine with its own entity and asset model |
| Ecosystem, examples, contributors | none | largest | large | medium |
| Fit with a pure model we own | natural | good: three.js is a scene graph library, our model stays the truth | weaker: wants to own the scene, inspector and serialization | weaker: wants to own entities and assets |

**Why three.js.** It is MIT, the smallest of the complete engines, the most widely known by contributors and by
language models (the assistant writes three.js well, which matters for web export and custom code), and it is a
library rather than a framework: our pure model stays the source of truth and three.js is a disposable projection.
Its node shading language lets one material compiler target WebGPU and WebGL 2. An own renderer would spend the
1.4.x line on PBR, IBL prefiltering, shadow cascades and post passes that three.js already has, and would still be
behind. Babylon.js is excellent and more stable on WebGPU, but larger, Apache-2.0 rather than MIT, and built around
owning the scene and its tooling. PlayCanvas is MIT and fast, but its engine is built around its own editor and
asset pipeline.

**Risks we accept and how we bound them.** `WebGPURenderer` is still labeled experimental upstream and its API changes
between releases: we pin one release, vendor it, upgrade deliberately with a visual regression suite (a fixed set
of scenes rendered on both backends and compared within a tolerance), and keep all three.js use inside
`world/render/`, so a later change of engine (or an own renderer for the editor viewport) does not touch the model,
the kernel, the formats, the tools or the CLI.

## Consequences

* The studio is usable on every platform we ship, with the best rendering on WebGPU (Windows, macOS 26, Chromium
  browsers) and a WebGL 2 path everywhere else (Linux desktop, older macOS, Firefox without WebGPU).
* Geometry, materials as data, formats and animation are pure and tested in Node; the assistant, MCP and the CLI can
  inspect, convert and optimize 3D files without a GPU.
* The download grows: the studio's own code (estimated 200 to 260 KiB gzip of lazy JavaScript over 1.4.x) plus
  on-demand vendor files outside the start-up and total budgets: three.js, manifold, meshoptimizer, Draco and the
  KTX2 transcoder. Start-up grows by the studio definition and menu rows only (about 1 KiB).
* Custom shader code is a new kind of untrusted content. The trust gate, static checks and watchdog are required
  parts of the first task that compiles user shaders, not later hardening.
* We depend on three.js's release cadence. The pinned version, the adapter boundary and the render regression suite
  are mandatory.
* FBX users need a converter they install themselves; we document the route.

## Alternatives considered

* **An own WebGPU renderer with a WebGL 2 fallback.** Maximum control and the smallest code, but years of work to
  match three.js's PBR, shadows and post-processing, and two backends to maintain. Rejected for 1.4.x; the adapter
  boundary keeps it possible for the viewport later.
* **Babylon.js.** Mature WebGPU, a node material editor and an inspector; rejected for size, for owning the scene
  and serialization, and because its node material format would become our file format by accident.
* **PlayCanvas engine.** MIT and fast; rejected because it is designed around its own editor's entity and asset
  model and has no node material system to build on.
* **Blender (or another native 3D program) as a back end.** Not available in the browser, a large install, and GPL
  code cannot be linked into the app. It stays useful as an optional user-installed converter (FBX, USD crate).
* **Extending the Pixel studio's 3D Transform or the Scene Studio's WebGL pass.** Both are 2D effects on images;
  they have no geometry, materials or scene. Rejected; Scene gains a World clip type instead.
* **A reverse-engineered FBX reader (for example an existing open-source one built from observing the format).**
  Rejected by the clean-room policy and by the absence of a specification.
* **SDF-first modeling (as Womp).** Approachable for beginners and great for organic shapes, but it does not
  produce the polygon meshes that glTF, games, web export and printing need without meshing. Kept as an open
  question for a later "soft shapes" object type that meshes to the kernel.
