# World Studio: concept and build plan

Status: proposed design, not built. Decision record: [ADR 0035](../adr/0035-world-studio.md). Target: the 1.4.x
releases. This page is the reference for the people (and agents) who build it: what World is, how its document is
shaped, how it models, shades and renders, how agents, the CLI, the other studios and collaboration reach it, and the
task list. It follows the structure of the [Proto Studio concept](proto-studio.md).

## Contents

1. [Vision](#1-vision)
2. [Competitive audit](#2-competitive-audit)
3. [Document model](#3-document-model)
4. [Engine and rendering architecture](#4-engine-and-rendering-architecture)
5. [Modeling: mesh kernel, modifiers, sculpting, UVs](#5-modeling-mesh-kernel-modifiers-sculpting-uvs)
6. [Tools, modes and panels](#6-tools-modes-and-panels)
7. [Materials and the shader node system](#7-materials-and-the-shader-node-system)
8. [Animation](#8-animation)
9. [Import and export](#9-import-and-export)
10. [AI: Vibe tools](#10-ai-vibe-tools)
11. [MCP](#11-mcp)
12. [CLI](#12-cli)
13. [Interop with the other studios](#13-interop-with-the-other-studios)
14. [File format](#14-file-format)
15. [Collaboration](#15-collaboration)
16. [Security](#16-security)
17. [Performance targets and memory limits](#17-performance-targets-and-memory-limits)
18. [Accessibility](#18-accessibility)
19. [Build plan](#19-build-plan)
20. [Open questions](#20-open-questions)
21. [Sources](#21-sources)

## 1. Vision

**World is where OpenFini users make 3D: model it, shade it, light it, animate it and put it to work in every other
studio, by hand or by asking the assistant, alone or together.**

* **Model.** Parametric primitives that stay editable, an edit mode with vertices, edges and faces, the everyday
  modeling operations (extrude, inset, bevel, loop cut, bridge, merge, knife-lite), a non-destructive modifier stack
  (subdivision, mirror, array, solidify, bevel, boolean, displace, decimate), SVG paths extruded or lathed into 3D,
  sculpting basics and UV unwrapping basics. The everyday 80 % of Blender's modeling, with Spline's approachability.
* **Shade.** PBR materials (metal-roughness with clearcoat, sheen, transmission, iridescence, emission), a node editor
  with procedural textures and noise, and custom WGSL or GLSL nodes for people who write shaders, with a
  Shadertoy-like playground.
* **Render.** Real-time and good-looking out of the box: image-based lighting from HDRIs or a procedural sky,
  soft shadows, ambient occlusion, bloom, depth of field, tone mapping (AgX, Khronos PBR Neutral, ACES), a post
  stack, particles. WebGPU where available, WebGL 2 everywhere else.
* **Animate.** Keyframes on any property with the Scene Studio's timeline, easing and graph editor, cameras on
  paths, turntables in one click, glTF animations in and out.
* **Everywhere in the suite.** Stills into Pixel, turntables and live 3D layers into Scene, 3D objects in Layout,
  Presentation and Proto, web export to the Code studio (a three.js project or a self-contained player), SVG from
  Vector as the start of a 3D logo.
* **Agent-native.** The Vibe assistant builds scenes from a sentence, materials and shaders from a prompt,
  procedural scatters and terrains, looks at the result from several angles and corrects it. External agents reach
  the same operations through MCP; `ofini world` converts, inspects, optimizes and renders in a terminal or CI.
* **Together.** Live editing, presence (each person's camera as a frustum, selections in their color), comments
  pinned to points on a model, through the existing end-to-end encrypted rooms.
* **Open.** glTF in and out as the native exchange, OBJ, STL and PLY, a documented `.ofini` model. Nothing locked in.

Non-goals for 1.4.x: offline path tracing as the main renderer (an optional progressive path tracer for stills is an
open question), rigging and weight painting (skinned glTF plays back, but is not authored), physics simulation,
retopology tools beyond voxel remesh and decimate, geometry nodes (the modifier stack and the procedural tools cover
the common cases; a node-based geometry system is a 2.x topic), game-engine features (scripting, colliders, scenes
with logic), CAD precision (no NURBS or B-rep; STL for printing is mesh-based), VR/AR authoring (USDZ export lets a
phone show a model in AR, nothing more).

## 2. Competitive audit

State as of November 2026, from public product pages, documentation, release notes and reviews (see
[Sources](#21-sources)). Observation of public behavior only, as the clean-room policy requires.

| | Blender 5 | Spline (V2) | Womp | three.js editor | Babylon.js (editor, NME, sandbox) | PlayCanvas editor | Godot 4 editor | **World (plan)** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Platform | Desktop app | Browser + desktop app, cloud files | Browser, cloud | Browser page | Browser tools | Browser, cloud projects | Desktop app (web export) | Browser, PWA, desktop (Windows, macOS, Linux), offline |
| License | GPL | Proprietary | Proprietary | MIT | Apache-2.0 | Engine MIT, editor proprietary service | MIT | MIT |
| Modeling | Full polygon modeling, sculpting, geometry nodes (bundles, closures, volumes in 5.0) | Primitives, parametric shapes, edit mode, booleans, extrude from vector shapes; rebuilt modeling in V2 | SDF "goop" blending, beginner-friendly, booleans | Primitives, transforms only | None (import) | None (import) | CSG nodes, primitives | Primitives, edit mode, modifier stack, booleans (manifold), SVG extrude and lathe, sculpt basics |
| Materials | Shader nodes, Principled BSDF | Layered materials (no node graph), shaders in V2 | Material presets | Standard materials | Node Material Editor | Material inspector, shader chunks | Visual shader editor + shader language | Node graph (PBR, noise, procedural), custom WGSL/GLSL nodes, presets |
| Real-time render | EEVEE (rasterized), Cycles (path traced) | WebGPU renderer in V2 | Path-traced preview | WebGL | WebGPU and WebGL 2 | WebGPU and WebGL 2 | Vulkan / GL | WebGPU with WebGL 2 fallback, IBL, shadows, AO, bloom, post stack, particles |
| Animation | Full (actions, NLA, rigging) | States, events, timeline | Turntables | None | Animation groups (code) | Animation state graphs | AnimationPlayer, AnimationTree | Keyframes with Scene Studio semantics, graph editor, turntables, glTF animations |
| Interactivity | Game logic gone since 2.8 | Events and states (hover, click), variables, export to web and native | None | Scripts | Code | Scripts | Full engine | Out of scope for 1.4.x (open question) |
| Formats | Everything incl. FBX, USD | glTF, USDZ, OBJ, STL in/out, code export | glTF, STL, OBJ out | glTF, OBJ, STL, PLY, FBX via loaders | glTF, OBJ, STL | glTF, FBX (server conversion) | glTF, FBX (via conversion), OBJ | glTF/GLB first, OBJ, STL, PLY; USDZ export; FBX through a user-installed converter |
| AI / agents | Community add-ons, MCP bridges | AI chat agent edits scenes; text and image to 3D; MCP server driving an open editor tab | AI texture tools | None | None | None | None | Built-in assistant with world tools, materials and shaders from prompts, procedural generation, scene understanding; the same tools over MCP |
| CLI | `blender -b` with Python | None | None | None | None | REST API | `godot --headless` | `ofini world` (convert, inspect, optimize, lint, apply, render preview) |
| Collaboration | None built in | Real time, cloud | Real time | None | None | Real time (the editor's strength) | None (Git) | Real time, end-to-end encrypted, no account |
| Shader playground | Text editor + OSL (Cycles) | Shader layers | None | None | Playground | None | Shader editor | Shader playground panel with live compile errors (Shadertoy-like uniforms) |

Also surveyed: **Shadertoy** (single-file fragment shaders with `iTime`, `iResolution`, `iMouse`, buffer passes: the
model for the playground's uniforms and for writing a custom node quickly), **Substance-style material graphs**
(procedural texture graphs whose outputs are base color, normal, roughness, metalness and height: the model for the
procedural texture nodes and for baking a graph into images for export), **Bezel, Vectary and Sketchfab's viewer**
(web viewers and quick product shots: the model for the turntable and the embed).

**What we take.** Blender's vocabulary (object mode and edit mode, modifier stack order, the operations' names and
keys G, R, S, E, I, Ctrl+B, Ctrl+R, Tab) because it is what 3D people expect and what tutorials teach. Spline's
approachability: parametric shapes, a clean default look, vector-to-3D, and the assistant editing the live document.
Godot's docks and scene tree with an inspector. PlayCanvas's proof that real-time collaborative 3D editing works in a
browser. Babylon's node material editor and inspector as the bar for the material UI. Shadertoy's uniforms. glTF as
the lingua franca (three.js editor, Babylon sandbox).

**What we do differently.** One operation layer for the editor, the assistant, MCP and the CLI. Local-first and
end-to-end encrypted collaboration. A pure, tested geometry kernel the CLI can run in CI. 3D as a first-class
citizen in a suite (a turntable in a video, a model in a slide, a product shot in a photo composite) without export
and import steps. Custom shaders with a trust gate and a GPU watchdog.

**Where we will be weaker** (honest list): Blender's depth (rigging, geometry nodes, simulation, Cycles), Spline's
interactivity (states and events) and native exports, very large scenes (tens of millions of triangles), FBX without
a converter, path-traced quality in the viewport.

## 3. Document model

Pure modules in `app/src/engine/world/` (no DOM, no GPU). The model is one immutable JSON value; every change goes
through `ops.js` and returns a new value with structural sharing, so unchanged parts keep their identity (the render
sync and the collaboration diff rely on that). Mesh vertex data is binary, content-addressed and outside the JSON
(3.4).

### 3.1 Top level

```json
{
  "schema": 1,
  "meta": { "title": "Bottle shot", "created": "2026-12-01T10:00:00Z", "unit": "m", "up": "+Y", "app": "OpenFini 1.4.0" },
  "scenes": { "s1": { "id": "s1", "name": "Scene", "ord": "V", "env": "e1", "camera": "n9", "render": "r1" } },
  "nodes": { "n1": { "…": "see 3.2" } },
  "meshes": { "m1": { "…": "see 3.4" } },
  "materials": { "mt1": { "…": "see 7.1" } },
  "shaders": { "sh1": { "…": "see 7.4" } },
  "textures": { "t1": { "id": "t1", "media": "md1", "color": "srgb", "wrap": ["repeat", "repeat"], "filter": "linear", "mip": true } },
  "envs": { "e1": { "id": "e1", "type": "hdri", "media": "md2", "intensity": 1, "rot": 0, "bg": "env", "blur": 0.2 } },
  "renders": { "r1": { "…": "see 4.4" } },
  "timeline": { "fps": 30, "start": 0, "end": 4, "loop": true, "markers": [] },
  "media": { "md1": { "id": "md1", "mime": "image/png", "name": "label.png", "size": 81234, "hash": "sha256-…", "w": 2048, "h": 2048 } }
}
```

* **Flat maps with ids**, as Proto: `nodes`, `meshes`, `materials`, `shaders`, `textures`, `envs`, `renders`, `media`.
  Lookups are O(1), moves are two-field changes, and every entry maps onto collaboration records. Ids are a type
  letter plus 8 base-36 characters, unique per document, never reused.
* **Several scenes** per document are allowed (variants of a product shot, a turntable set) and share meshes,
  materials and media. Most documents have one.
* **Units and axes**: meters, +Y up, right-handed, −Z forward for cameras (glTF's conventions, so import and export
  need no conversion). Imports in other conventions (Z-up STL, centimeter OBJ) are converted on the way in, with the
  choice shown in the import dialog.
* **Unknown fields are kept** within a schema (forward compatibility). `migrate.js` upgrades older schemas step by
  step; a newer schema opens read-only with a notice. `validate.js` checks types, references, cycles and limits, and
  runs on open, on import, on every MCP write and on every remote collaboration record.

### 3.2 Nodes

```json
{
  "id": "n1", "type": "mesh", "name": "Bottle", "scene": "s1", "parent": null, "ord": "V",
  "visible": true, "locked": false, "render": true,
  "xf": { "p": [0, 0, 0], "r": [0, 35, 0], "s": [1, 1, 1], "ro": "XYZ" },
  "mesh": "m1",
  "prim": null,
  "mods": [{ "id": "d1", "type": "subsurf", "on": true, "view": 2, "render": 3 }],
  "mats": ["mt1"],
  "shadow": { "cast": true, "receive": true },
  "anim": { "xf.r.1": { "kf": [{ "t": 0, "v": 0 }, { "t": 4, "v": 360 }] } },
  "tags": ["product"], "note": ""
}
```

Node types and their own fields:

| Type | Fields | Notes |
| --- | --- | --- |
| `group` | — | An empty transform with children (Blender's empty, Godot's Node3D) |
| `mesh` | `mesh` (an id) or `prim` (a parametric primitive), `mods`, `mats` (slots, by face material index), `shadow` | A `prim` stays parametric (sliders in the inspector) until the first edit-mode change turns it into a mesh |
| `instance` | `of` (a node id), `mats?` (override slots) | Linked duplicate (Alt+D): shares geometry and modifiers |
| `camera` | `cam: { kind: "persp" \| "ortho", fov, size, near, far, sensor, dof: { on, focus, fstop, target } }` | `fov` in degrees vertical; `dof.target` may be a node id (focus follows it) |
| `light` | `light: { kind: "dir" \| "point" \| "spot" \| "area" \| "hemi", color, power, unit: "lux" \| "lm" \| "W", range, cone, penumbra, size: [w, h], shadow: { on, res, bias, normalBias, soft } }` | Physical units as glTF's `KHR_lights_punctual`; area lights are rectangle lights |
| `text3d` | `text: { runs, font, size, depth, bevel: { size, segs }, align }` | Glyph outlines from `core/fonts.js` extruded by the kernel |
| `shape3d` | `path: { svg, closed }`, `op: { kind: "extrude" \| "lathe" \| "sweep", depth, bevel, segs, axis }` | SVG paths from Vector or Proto made solid; stays parametric |
| `particles` | `emit: { from: "point" \| "shape" \| node id, rate, count, life, speed, spread, gravity, drag, size, color, seed, sprite \| node id }` | Deterministic from `seed` and time (4.6) |
| `ref` | `doc` (an embedded World or a linked file), `scene` | A whole World scene placed as one node (kits, reused props) |
| `light-probe` | `probe: { kind: "env" \| "irradiance", size, box }` | Local reflections inside rooms (later; schema reserved) |

Common fields:

* `xf` is position (meters), rotation as Euler degrees with order `ro`, scale. People and agents read and write
  degrees; the renderer and glTF use quaternions. A rotation that came in as a quaternion keeps it in `xf.q` until the
  user edits the rotation, so round trips are exact.
* `parent` is a node id or `null` (scene root); `ord` is a fractional order key from `collab/fractional.js` (same
  rules as Proto). Children lists are derived and cached per revision.
* `anim` maps a property path to a Scene Studio track (section 8). Paths are scalar: `xf.p.0`, `xf.r.1`,
  `light.power`, `cam.fov`; material values are animated on the material (7.1); which modifier
  parameters are animatable is listed in section 8.
* `prim` is `{ kind, …params }` with kinds `box` (size, segments, bevel radius and segments), `sphere` (UV),
  `icosphere`, `cylinder`, `cone`, `torus`, `plane`, `grid`, `capsule`, `disc`, `tube`, `pyramid`, `prism`, `stairs`,
  `star`, `rounded-box`, `heart`, `knot`, `mascot` (an original head shape for test renders, not a copy of any
  program's mascot). The kernel generates primitives deterministically; the generated mesh is not stored while the
  node is parametric.

### 3.3 Modifiers

`mods` is an ordered stack evaluated top to bottom on the base mesh (5.2). Each entry: `{ id, type, on, view?:
boolean, …params }` (`view: false` hides it in the viewport but keeps it for renders and exports). Types in 1.4.x:

| Type | Parameters |
| --- | --- |
| `subsurf` | `view`, `render` levels (0 to 4 / 6), `creases: true`, `uv: "smooth-boundary"` |
| `mirror` | `axes: [x, y, z]`, `pivot` (node id or null), `merge`, `clip`, `bisect`, `flipUV` |
| `array` | `count`, `offset: { rel: [x, y, z], abs, node }`, `merge`, `caps`, `fitLength`, `curve?` (later) |
| `solidify` | `thickness`, `offset`, `rim`, `even` |
| `bevel` | `amount`, `segs`, `limit: "angle" \| "weight" \| "none"`, `angle`, `profile` |
| `boolean` | `op: "union" \| "difference" \| "intersect"`, `with` (node id or a collection tag), `solver: "manifold" \| "fast"`, `hideCutter` |
| `displace` | `texture` (a material-graph texture subgraph or texture id), `strength`, `mid`, `dir: "normal" \| "x" \| "y" \| "z"`, `space` |
| `decimate` | `ratio`, `mode: "collapse" \| "planar"`, `angle`, `preserve: ["border", "uv"]` |
| `weld` | `distance` |
| `triangulate` | `quads`, `ngons` |
| `smooth` | `factor`, `repeat`, `keepVolume` (Laplacian / Taubin) |
| `wireframe` | `thickness`, `even`, `replace` |
| `remesh` | `voxel` (size), `smooth` (voxel remesh through manifold's level set, 5.2) |
| `scatter` | `on` (this mesh's surface), `instance` (node id), `count`, `density` (a texture), `seed`, `align`, `scale: [min, max]`, `rot` (procedural scatter; outputs instances, not geometry) |

### 3.4 Meshes

```json
{
  "id": "m1", "name": "Bottle", "hash": "sha256-9f1c…", "size": 1849360,
  "counts": { "v": 24576, "f": 24320, "c": 97280, "e": 48896 },
  "bounds": [[-0.04, 0, -0.04], [0.04, 0.24, 0.04]],
  "attrs": { "uv": ["UVMap"], "color": ["Col"], "crease": true, "seam": true, "sharp": true, "weight": [] },
  "chunks": ["sha256-…", "sha256-…"]
}
```

* The **mesh body** is binary (`OFWM` format, 14.2): positions (f32 × 3 per vertex), polygons as a face-size array
  plus corner-to-vertex indices (u32), per-corner UV sets, per-corner or per-vertex colors, per-face material index
  and smooth flag, per-edge crease, seam and sharp flags, custom split normals when imported. Edges are derived and
  cached (half-edge index, 5.1). Little endian, sections with a type tag and a length, unknown sections kept.
* The body is **content-addressed**: `hash` is the SHA-256 of the body; `chunks` are the SHA-256 hashes of its 64 KiB
  slices. Two nodes or two documents with the same geometry share one body; collaboration sends only chunks the peer
  does not have (15); undo keeps old bodies alive in an LRU until no history entry refers to them.
* **Limits** (validated, 3.6): 4 million faces per mesh; 16 million faces per document; 8 UV sets; 8 color sets.

### 3.5 Media, textures and environments

* `media` holds image bytes (PNG, JPEG, WebP, AVIF, KTX2, Radiance `.hdr`, OpenEXR half and float for HDRIs, the
  latter through a small pure reader), stored under `office/world/media/<hash>.<ext>`.
* `textures` reference media with a color space (`srgb` for color, `linear` for data maps), wrap, filtering and
  mipmapping. Procedural textures are material-graph nodes, not texture entries; they can be baked to media (7.5).
* `envs` are `hdri` (an equirectangular image), `sky` (a physical sky with sun direction, turbidity, ground color),
  `gradient` or `color`, with intensity, rotation, and what the background shows (`env`, `blur`, `color`,
  `transparent`).

### 3.6 Limits

Nodes 50,000 per document; modifier stack 32 entries; material graph 512 nodes; custom shader source 32 KiB;
textures 256 per document, 8192 × 8192 each (4096 by default on WebGL 2 and on mobile); HDRIs 8192 × 4096; animation
channels 10,000; keyframes 200,000; particles 1,000,000 on WebGPU and 100,000 on WebGL 2 per emitter. A file over
the limits opens read-only with a list of what exceeds them.

## 4. Engine and rendering architecture

### 4.1 Layers

```
engine/world/            pure: schema, ops, validate, migrate, tree, mesh kernel, modifiers, uv, formats,
  mesh/ mods/ uv/        material graph (types, CPU evaluator), keyframe evaluation, lint, stats, raster (CPU)
  formats/ material/
  ↑ used by everything below, and by the CLI (Node) and the worker pool
world/                   app side (DOM, GPU): host, workspace, controller, tools, panels, gizmos, collab, presence
  render/                the only place that imports three.js:
    backend.js           pick WebGPU or WebGL 2, device and context loss, capabilities, quality tiers
    sync.js              model revision → three.js scene, keyed incremental updates, disposal
    materials.js         material graph → TSL node material (7.3), cache by graph hash
    env.js               HDRI / sky → prefiltered environment (PMREM), background
    passes.js            post stack (4.5)
    particles.js         GPU (compute) and CPU particle systems (4.6)
    pick.js              GPU id-buffer picking, depth readback
    capture.js           stills, turntables, multi-view grids, render passes (beauty, depth, normal, id, alpha)
vendor/three/            pinned three.js build (WebGPU build with its WebGL 2 backend, TSL), loaded on demand
vendor/manifold/ meshopt/ draco/ basis/   WebAssembly modules, loaded on demand in workers
```

Rules:

* **The model is the truth; three.js is a projection.** `sync.js` keeps a map from model keys to three.js objects and
  applies the difference between two model revisions (unchanged objects keep identity, as Proto's patch planner). It
  disposes geometries, materials, textures and render targets it removed, and the GPU memory meter (17.2) counts
  what it holds.
* **Evaluated geometry comes from the kernel**, in a worker (5.2), as typed arrays that `sync.js` uploads. The renderer
  never computes or stores the base mesh.
* **Frame = f(model, time, camera, quality).** The viewport, captures, turntables, Scene clips, embeds and the
  assistant's screenshots all go through `capture.js` with the same code, so a preview and an export match (as in
  ADR 0029).

### 4.2 Backends

| Backend | Where | What differs |
| --- | --- | --- |
| WebGPU | Chromium browsers and WebView2 (Windows), Safari and WKWebView on macOS 26 / iOS 26, Firefox where shipped | Compute-based particles (up to 1 M), GPU culling of instances, timestamp queries for the profiler, larger texture arrays |
| WebGL 2 | Everywhere else, including WebKitGTK on Linux and older macOS | CPU-simulated particles (up to 100 k), CPU instance culling, no timestamp queries (CPU timing), some post passes at lower resolution |
| None | Very old or blocklisted GPUs, software-only contexts that fail the capability check | The document opens read-only: outline, inspector, statistics, the software preview of 4.7; convert, inspect and optimize work |

`backend.js` decides once per session (Settings ▸ World ▸ Renderer: Auto, WebGPU, WebGL 2), records the adapter and
limits in the diagnostic report, and survives **device and context loss**: it drops GPU resources, recreates the
device, and rebuilds the three.js scene from the model (cheap, since the model is the truth). A loss within 10 s of a
custom shader compile switches the document to shader safe mode (16.1).

### 4.3 Look development defaults

A good look without settings: AgX tone mapping (Khronos PBR Neutral for product shots and ACES Filmic selectable),
exposure in EV, a neutral studio HDRI and a physical sky bundled as small on-demand files, a shadow catcher ground,
soft contact shadows, SSAO on, a mild bloom only for emissive values over 1, 4× MSAA or TAA depending on the tier,
sRGB output with Display P3 when the canvas supports it (ties into [color-management.md](../color-management.md)).

### 4.4 Render settings and quality tiers

`renders` entries hold `{ tier, size: [w, h], aspect, samples, tone, exposure, bg, transparent, post: [Pass],
shadows: { kind, res, cascades, soft }, ao, ssr, motionBlur, dof }`. Tiers set defaults that the post stack refines:

| Tier | Use | Shadows | AO | Anti-aliasing | Other |
| --- | --- | --- | --- | --- | --- |
| Draft | Editing heavy scenes, laptops on battery | One cascade, 1024, hard | Off | FXAA | No bloom, half-resolution while navigating |
| Balanced (default) | Everyday viewport | 2 to 3 cascades, 2048, PCF soft | SSAO half resolution | MSAA 4× (WebGL 2) or TAA (WebGPU) | Bloom, tone mapping, vignette off |
| Quality | Captures, presenting | 4 cascades, 4096, PCSS-like contact hardening | GTAO full resolution | TAA with 8 to 32 accumulated jittered frames when the camera stops | Screen-space reflections, DOF, motion blur in captures |

Captures always render at Quality with accumulation (64 frames by default for stills), so a still is cleaner than the
live viewport. A progressive path tracer for stills is an open question (20).

### 4.5 Post-processing stack

`post` is an ordered list of passes, each `{ id, type, on, p }` with parameters from a `controls` schema (the same
schema-driven panel as Pixel and Scene effects): `ssao`, `gtao`, `bloom` (threshold, knee, intensity, radius),
`dof` (from the camera, or manual focus distance and f-stop), `ssr`, `motion-blur`, `color-grade` (exposure, white
balance, contrast, saturation, lift / gamma / gain, a `.cube` LUT), `vignette`, `chromatic-aberration`, `grain`,
`outline` (selection and toon outlines, by object or by depth/normal edges), `sharpen`, `fog` (height and distance),
`pixelate`, `custom` (a custom shader pass: a full-screen custom node, same trust rules as 7.4). Pass order is fixed by
type where physics needs it (AO before lighting composite, tone mapping after bloom), free for the stylistic passes.
The Scene Studio's color grade formulas (`scene/effects.js`) are reused so a grade looks the same in both studios.

### 4.6 Particles and procedural effects

* **Particles** are deterministic: the state at time *t* is computed from the emitter, the seed and *t* (closed-form
  for ballistic motion with drag; fixed-step simulation from the start, cached in segments, for turbulence and
  collisions with the ground plane). Scrubbing, captures, collaboration peers and Scene exports show the same
  particles. Rendered as instanced sprites, meshes or trails; GPU compute on WebGPU, CPU in a worker on WebGL 2.
* **Procedural textures** (noise: value, Perlin, simplex, Worley / Voronoi, fBm, ridged, domain warp; patterns:
  checker, bricks, waves, gradient, wood, marble) are material-graph nodes with one GPU and one CPU implementation
  each (7.2), so the CLI can bake them and tests can check them as numbers.
* **Procedural sky** and fog are environment and post features; volumetrics (god rays) are an open question.

### 4.7 Software preview rasterizer

`engine/world/raster.js`: a small pure triangle rasterizer (z-buffer, flat and Lambert shading with one key light and
an ambient term, base color and base-color textures, edges optional) that renders a model to an RGBA buffer in Node
and in the browser without a GPU. Used by `ofini world render --preview`, by thumbnails when no GPU is available, by
the read-only fallback, and by tests. Output is labeled approximate. It is the 3D counterpart of Proto's pure layout
solver: never used for the editor viewport.

### 4.8 Picking, gizmos and overlays

GPU picking renders object ids (and, in edit mode, vertex, edge and face ids) into an id buffer on demand; reading one
pixel is asynchronous on WebGPU and is batched with the next frame. Transform gizmos, the navigation gizmo (axis
cube), the grid, light and camera glyphs and selection outlines are drawn by an overlay pass in the same frame, not
by DOM, so they stay in sync with the camera. Remote cursors (rays and frusta) are drawn there too.

## 5. Modeling: mesh kernel, modifiers, sculpting, UVs

### 5.1 The kernel

`engine/world/mesh/` is plain JavaScript on typed arrays, with no dependencies, usable in Node, workers and the app.

* **Representation**: the polygon mesh of 3.4 plus a derived **half-edge index** built on demand (vertex → outgoing
  half-edge, half-edge → twin, next, face) for topology queries (edge loops and rings, boundaries, manifold checks,
  neighbors). Edit operations work on the half-edge view and write back a polygon mesh.
* **Selection** is three typed bitsets (vertices, edges, faces) with conversions (grow, shrink, loop, ring, linked,
  by material, by normal, random with a seed, checker deselect, sharp edges, boundary, non-manifold).
* **Operations** (pure: `(mesh, selection, params) → { mesh, selection }`, each one undo step): extrude (region,
  individual faces, along normals, edges, vertices), inset (region, individual, depth), bevel (edges and vertices,
  segments, profile, clamp overlap), loop cut and slide (count, even), edge slide, knife-lite (cut along a polyline in
  the view plane), bridge edge loops, fill and grid fill, merge (at center, at cursor, by distance), dissolve
  (vertices, edges, faces, limited), delete (vertices, edges, faces, only faces), separate, join, split, rip, spin,
  screw, subdivide (simple, smooth), triangulate and quads from triangles, flip and recalculate normals, mark seam,
  sharp and crease, set smooth / flat, mirror, symmetrize, poke, solidify (destructive), convex hull (quickhull).
* **Primitives and shapes**: the parametric primitives of 3.2, text and SVG paths through a pure triangulator (ear
  clipping with holes, constrained to the outline; the polygon offsetting for bevels reuses `engine/vector` code where
  it fits) with extrude, bevel, lathe and sweep along a path.
* **Robustness**: operations reject non-manifold input where they need manifold topology (with a message naming the
  problem edges), never produce NaN positions, and keep attributes (UVs, colors, creases, materials) by documented
  interpolation rules. Every operation has property tests (random meshes and random selections keep the mesh valid,
  Euler characteristic changes as expected, attributes stay in range).

### 5.2 Modifier evaluation

`engine/world/mods/` evaluates a stack: `evaluate(baseMesh, mods, ctx) → { mesh, instances, warnings }`. It runs in
the worker pool (ADR 0019, a new job `world.evaluate`), cached per node by the hash of (base mesh, modifier
parameters, referenced nodes' transforms and meshes). Edits re-evaluate only from the first changed modifier
(intermediate results are cached per stack position, within the memory budget).

* `subsurf`: Catmull-Clark with crease weights and boundary rules, in our own code; levels above 2 in the viewport
  show a warning on large meshes.
* `boolean`: **manifold** (Apache-2.0, WebAssembly, loaded in the worker on first use). Inputs that are not manifold
  are repaired where safe (weld, fill small holes) or reported; `solver: "fast"` uses a simple BSP-free approach for
  convex cutters only. Results keep material indices and UVs through manifold's property channels.
* `decimate`: meshoptimizer's simplifier (MIT, WebAssembly) with attribute weights; planar decimation in our code.
* `remesh`: manifold's level-set function on a voxel grid, then smoothing. This is also the "voxel remesh" of sculpt
  mode.
* Everything else (mirror, array, solidify, bevel, displace, weld, triangulate, smooth, wireframe, scatter) is our own
  code on the kernel.

Applying a modifier writes the evaluated mesh as the new base mesh (one undo step). Exports and renders use the
`render` levels; the viewport uses `view` levels.

### 5.3 Sculpting basics

Sculpt mode works on one mesh object at full resolution:

* **Brushes**: draw, clay strips, inflate, grab, snake hook, smooth, flatten, pinch, crease, scrape, mask, and a
  layer brush; radius in screen or scene units, strength, falloff curve, spacing, pen pressure for radius and
  strength, stroke smoothing (lazy mouse), front-faces-only, auto-masking by topology.
* **Symmetry**: X, Y, Z mirrored strokes in object space, with a symmetrize command.
* **Data structures**: a BVH over triangles (rebuilt lazily per node), vertices and normals updated in place on typed
  arrays, GPU buffers patched by range (`bufferSubData` / `writeBuffer`) for the touched BVH leaves only.
* **Topology**: voxel remesh (5.2) and decimate; no dynamic topology in 1.4.x (open question), no multiresolution.
* **Commit**: the stroke is one undo step stored as a delta (touched vertex ranges, before and after) and committed to
  the model as a new content-addressed body when the user leaves sculpt mode or after 5 s idle, so collaboration sends
  only changed chunks (15).

### 5.4 UV unwrapping basics

`engine/world/uv/`: mark and clear seams, unwrap with **least squares conformal maps** (LSCM, a published algorithm;
our own implementation with a sparse conjugate-gradient solver) and angle-based fill-ins for small islands, projections
(planar, box / cube, cylinder, sphere, from view), smart project (split by angle, then unwrap), average island scale,
pack islands (rectangle packing with rotation and margin, deterministic), and a stretch heat map. The UV editor panel
shows the active UV set over the active texture, with vertex, edge, face and island selection and move, rotate,
scale, pin, straighten. Lightmap UVs are generated on request into a second set. Texture painting is an open question.

## 6. Tools, modes and panels

### 6.1 Modes

| Mode | Key | What it edits |
| --- | --- | --- |
| Object | Tab toggles with Edit | Nodes: select, transform, duplicate, parent, add, delete |
| Edit | Tab; 1 / 2 / 3 for vertex, edge, face | The selected mesh's base mesh (multi-object edit later) |
| Sculpt | Ctrl+Tab menu | One mesh with brushes |
| UV | In the UV editor panel | UVs of the edited mesh |
| Material | Material editor panel focused | The active material graph |
| Animate | Timeline focused, auto-key toggle (N) | Keyframes; any change writes a keyframe at the playhead when auto-key is on |

### 6.2 Tools and keys

Blender-compatible keys by default, with a *Simple* keymap (click-and-drag gizmos only, no modal keys) for newcomers,
switchable in Settings ▸ World ▸ Keymap; both are listed in the command palette and the keyboard reference.

| Tool | Keys | Notes |
| --- | --- | --- |
| Select (click, box, lasso, circle) | click, B, C, W cycles | Shift adds, Ctrl subtracts; select through toggle (Alt+Z x-ray) |
| Move / rotate / scale | G, R, S, then X / Y / Z (twice: local), numbers to type a value | Modal like Blender, or gizmos (W/E/R as the Simple keymap) |
| Snap | Shift+Tab toggle, Ctrl while dragging | To grid, vertex, edge, face, center, with alignment to the surface |
| Pivot and 3D cursor | `.` pie, Shift+right-click places the cursor | Pivot: median, individual origins, active, cursor, bounding box |
| Add | Shift+A | Primitives, text, SVG shape, camera, light, empty, particles, reference, environment presets |
| Extrude, inset, bevel, loop cut | E, I, Ctrl+B, Ctrl+R | Each opens an *Adjust last operation* panel |
| Knife-lite | K | Polyline cut in the view plane |
| Proportional editing | O | Falloff curve and radius (wheel), connected only |
| Duplicate, linked duplicate | Shift+D, Alt+D | — |
| Join, separate | Ctrl+J, P | — |
| Apply transform | Ctrl+A | Location, rotation, scale, all |
| Origin | Set origin menu | To geometry, to 3D cursor, to bottom center |
| View | Numpad 1 / 3 / 7 / 9 / 5 / 0, `~` pie, Home (frame all), `.` numpad (frame selected), middle-drag orbit, Shift pan, wheel zoom, fly mode (Shift+`) | Trackpad gestures: two-finger orbit, pinch zoom, Shift pan |
| Measure | — | Distances and angles, snapped, shown in the scene units |

### 6.3 Panels (dockable, ADR 0033)

| Panel | Default place (`essentials` preset) | Content |
| --- | --- | --- |
| Viewport | center (can split into 2 or 4 views) | The 3D view, header with shading (solid, material preview, rendered, wireframe, x-ray), overlays, camera |
| Outliner | right, top | Scene tree (virtualized, keyboard tree grid), visibility, lock, render toggles, drag to parent, filter, search |
| Properties | right, bottom | Tabs: object (transform, relations, visibility), modifiers (stack with drag reorder, apply, toggle), material (slots, quick PBR fields), mesh data (UV sets, colors, attributes, statistics), light or camera, particles |
| Scene | right, tab | Scenes, active camera, environment, render settings, post stack |
| Material editor | bottom (tab), or its own window | Node graph canvas (7.6) with a live preview ball, node search, frames, reroutes |
| Shader playground | bottom (tab), floating | Code editor (CodeMirror with WGSL / GLSL highlighting), uniforms, compile log, preview |
| Timeline | bottom | Keyframe rows and the graph editor from the Scene Studio (8) |
| UV editor | floating or split view | 5.4 |
| Assets | left (tab) | Primitives, materials, HDRIs, models from the document, from a library folder and from Poly Haven-style CC0 sources the user adds (no built-in network fetch without the network policy) |
| Statistics | status bar + popover | Objects, vertices, faces, triangles, draw calls, GPU memory, frame time, backend |
| Comments | right (tab) | Threads pinned to points on surfaces (15) |

Workspaces (ADR 0033 presets): *Modeling* (viewport, outliner, properties), *Shading* (viewport in rendered shading,
material editor, assets), *Animation* (camera view, timeline and graph editor), *Sculpting* (big viewport, brush
settings), *UV* (UV editor beside the viewport), *Render* (camera view, scene and post settings).

## 7. Materials and the shader node system

### 7.1 Material model

```json
{
  "id": "mt1", "name": "Frosted glass", "model": "pbr",
  "graph": {
    "nodes": {
      "g1": { "id": "g1", "type": "output.pbr", "at": [600, 120], "in": { "baseColor": "#e8f0ff", "roughness": 0.35, "transmission": 1, "ior": 1.5, "thickness": 0.02 } },
      "g2": { "id": "g2", "type": "noise.fbm", "at": [180, 200], "in": { "scale": 12, "octaves": 5, "seed": 3 } },
      "g3": { "id": "g3", "type": "math.remap", "at": [380, 200], "in": { "from": [0, 1], "to": [0.25, 0.5] } }
    },
    "links": [["g2", "value", "g3", "x"], ["g3", "value", "g1", "roughness"]]
  },
  "side": "front", "blend": "opaque", "alphaCutoff": 0.5, "shadow": "opaque",
  "anim": { "g1.in.emissiveStrength": { "kf": [] } }
}
```

* A graph is nodes with typed sockets (`float`, `vec2`, `vec3`, `color`, `vec4`, `bool`, `int`, `texture`, `closure`
  for the output) and links `[from, socket, to, socket]`. Unlinked inputs hold constants (and may be animated).
  Validation: types match (with implicit float → vector broadcast and color ↔ vec3), no cycles, one output.
* **Output nodes**: `output.pbr` (glTF's metal-roughness model plus clearcoat, sheen, transmission, volume,
  iridescence, specular, anisotropy, emissive strength, matching the `KHR_materials_*` extensions so glTF round trips
  are lossless), `output.unlit`, `output.toon` (ramp-based), `output.matcap`, `output.post` (for custom post passes).
* **Presets** are just graphs: plastic, metal (brushed, anodized), glass, frosted glass, car paint, rubber, ceramic,
  wood, marble, concrete, fabric, skin-lite, emissive, hologram, toon. A simple material is a single output node; the
  Properties panel edits its fields directly, so most users never open the node editor.

### 7.2 Node library (1.4.x)

| Group | Nodes |
| --- | --- |
| Input | value, color, vector, UV (set), position (object, world), normal (object, world, view), tangent, view direction, camera distance, object info (id, random), vertex color, time, frame, screen position, fresnel, layer weight, ambient occlusion (baked or screen space) |
| Texture | image (with transform, wrap, projection: UV, triplanar, box), normal map, bump, height to normal, environment sample, gradient, checker, bricks, waves, wood, marble |
| Noise | value, Perlin, simplex, Worley / Voronoi (F1, F2, edge distance), fBm, ridged, turbulence, domain warp, white noise, blue-noise dither |
| Color | mix (blend modes from Pixel), ramp (color stops), hue/saturation/value, brightness/contrast, gamma, invert, levels, curves, RGB ↔ HSV, blackbody, wavelength |
| Math | add, subtract, multiply, divide, power, log, sqrt, abs, min, max, clamp, remap, smoothstep, step, sin, cos, fract, mod, floor, ceil, mix, compare, dot, cross, length, normalize, distance, reflect, refract, rotate, separate / combine XYZ and RGBA |
| Vector | mapping (translate, rotate, scale), transform between spaces, displacement, vector rotate |
| Utility | reroute, frame (comment box), group (a reusable subgraph with exposed sockets), switch, custom code (7.4) |

Each node type is one module entry `{ type, inputs, outputs, cpu(inputs, ctx), tsl(inputs, ctx), doc }`:
`cpu` is the reference implementation (previews, baking, tests, CLI), `tsl` builds the three.js shading-language
expression. A conformance test renders every node on both backends and compares with `cpu` within a tolerance (per
node, documented).

### 7.3 Compilation

`world/render/materials.js` lowers a graph to a three.js node material: topological sort, constant folding,
common-subexpression sharing, dead-node removal, then one TSL expression per output socket. Compiled materials are
cached by the graph's canonical hash; editing a constant updates a uniform instead of recompiling (the graph marks
which inputs are uniforms). Compilation is asynchronous (`compileAsync` on the renderer), so the viewport keeps the
previous material until the new one is ready; errors show on the node that caused them.

### 7.4 Custom shader nodes

```json
{
  "id": "sh1", "name": "Plasma", "kind": "node",
  "inputs": [{ "name": "uv", "type": "vec2" }, { "name": "t", "type": "float", "default": { "bind": "time" } }, { "name": "scale", "type": "float", "default": 4 }],
  "outputs": [{ "name": "color", "type": "vec3" }],
  "wgsl": "fn plasma(uv: vec2f, t: f32, scale: f32) -> vec3f { … }",
  "glsl": "vec3 plasma(vec2 uv, float t, float scale) { … }"
}
```

* A custom node is a **pure function** in WGSL, GLSL ES 3.0 or both, with declared inputs and outputs. It becomes a
  node type in the library of that document (`custom.<id>`). Full-screen custom post passes use the same shape with a
  fixed signature (`fn pass(uv, color, depth, normal, t) -> color`).
* **Backends**: three.js's code nodes wrap the function for the active backend. If only one dialect is present, the
  node runs on that backend and falls back to its declared `fallback` constant on the other, with a badge in the node
  and in the Statistics panel. The assistant can translate one dialect into the other on request (a skill), and the
  playground shows both compile logs.
* **Playground** (panel): Shadertoy-like uniforms (`time`, `resolution`, `mouse`, `frame`), a quad or the selected
  object as preview, compile errors mapped to lines, a *Make node* button that reads the signature and creates the
  custom node.
* **Safety** (16.1): trust gate, static checks, asynchronous compile, GPU watchdog. Custom nodes have no access to
  anything but their inputs and the textures wired into them.

### 7.5 Baking

`bake` writes a material graph (or one socket of it) into images for export, for formats and viewers without node
support: base color, normal, roughness / metalness / occlusion packed (glTF's ORM convention), emissive, height. On
the GPU in the app (render-to-texture in UV space with dilation), and on the CPU through the `cpu` implementations in
the CLI (`ofini world bake`). glTF export bakes graphs that do not map onto plain glTF material fields (and says so in
the export report).

### 7.6 The node editor UI

There is no node editor in the app today. `ui/nodes/` is a new, generic, reusable node-graph canvas (Canvas 2D for
links and grid, DOM for nodes so that Shoelace controls and accessibility work): pan and zoom, box select, drag links,
link cutting (Ctrl+right-drag), reroutes, frames, node search on Space or Shift+A, collapse, mute, group and ungroup,
copy and paste as JSON, keyboard navigation between nodes and sockets, socket type colors with shape markers (not
color alone). It knows nothing about materials: a graph schema and node type list are its input, so Scene effects or
a future geometry-nodes system can reuse it.

## 8. Animation

* **Same semantics as the Scene Studio.** Every animatable scalar is a constant or a track `{ kf: [{ t, v, e, i, o,
  b }] }` evaluated by `scene/keyframes.js ▸ valueAt` (imported unchanged; the module is pure). Easings, Bezier
  tangents (speed and influence), hold, behaviors (wiggle, loop, spin through `scene/rig.js` where they are pure),
  frame-grid snapping and the keyboard shortcuts (F9 easy ease, Shift+J/K previous/next keyframe, U show rows) are the
  same. Time is seconds on the `timeline.fps` grid, from `timeline.start` to `timeline.end`.
* **What is animatable**: node transforms (per component), visibility (hold), light color, power, cone; camera fov,
  focus distance, f-stop; material constants (any unlinked numeric or color input); modifier numbers marked
  animatable (array count is not, bevel amount is); environment rotation and intensity; post pass parameters;
  particle emitter rate. Colors animate per channel in linear space.
* **Rotation**: Euler channels by default (what people expect when they type 360), quaternion slerp for imported
  glTF rotations kept in `xf.q` until edited; a *Rotation mode* field converts.
* **Editors**: the Scene Studio's keyframe rows and graph editor (`scene/timeline.js`, `scene/graph.js`) through a
  property adapter (`world/anim-adapter.js`) that lists the selected nodes' animated paths, reads and writes tracks
  through World operations, and maps the playhead. One timeline panel per document.
* **Helpers**: turntable (object or camera, one revolution over the range, easing choice), orbit and dolly camera
  presets, follow-path for cameras and objects (a `shape3d` path or a curve from Vector), look-at constraint (a
  `track` field on a node: `{ target, up }`), camera cuts by markers (for turntable sets and captures).
* **glTF animations**: imported clips (translation, rotation, scale, weights for morph targets, skinned meshes) play
  back as read-only *baked clips* attached to nodes, selectable in the timeline; exports write World channels as one
  glTF animation per marker range (or one for the whole range). Skinned meshes and morph targets render but are not
  edited in 1.4.x.
* **Determinism**: frame = f(model, time). Particles, procedural noise with `time` and behaviors are seeded, so
  scrubbing, captures, Scene exports and collaboration peers agree.

## 9. Import and export

All readers and writers are pure modules in `engine/world/formats/`, shared by the app, the worker pool, the
assistant and the CLI. Readers validate counts and indices before allocating, and enforce the limits of 3.6.

| Format | Read | Write | Notes |
| --- | --- | --- | --- |
| glTF 2.0 (`.gltf` + `.bin` + images) | yes | yes | The native exchange. Meshes, materials, textures, samplers, cameras, nodes, scenes, animations, skins and morph targets (read, play back), extensions below |
| GLB | yes | yes | Default export; one file with embedded images |
| OBJ + MTL | yes | yes | Groups, objects, n-gons, UVs, normals, MTL with PBR extensions (`Pr`, `Pm`, `map_Pr`) |
| STL (binary, ASCII) | yes | yes | Units choice on import (mm, cm, m, in), Z-up conversion; export checks watertightness (lint) for printing |
| PLY (binary little/big endian, ASCII) | yes | yes | Vertex colors; point clouds render as points |
| USDZ | assessment: no | yes (1.4.x late) | USDA text layer plus textures in the USDZ ZIP layout (uncompressed, 64-byte alignment, as the public USDZ specification requires) for Apple Quick Look and AR on iOS; `UsdPreviewSurface` materials (baked where needed). Reading USDZ means reading USD crate binaries; out of scope (open question 20) |
| FBX | no | no | No public specification; the FBX SDK is proprietary and closed-source. Route: File ▸ Import ▸ *FBX through Blender…* runs a Blender the user installed (desktop only, the allow-listed command runner, a fixed script that converts to GLB), or the user converts with any tool they have. Documented in the guide |
| 3MF | open question | open question | Printing format with a public specification; candidate for 1.5 |
| SVG | yes (as `shape3d`) | — (vector outlines of a render: open question) | From Vector, Proto, or a file |
| HDR / EXR | yes (environments) | EXR for render passes (open question) | Pure readers for Radiance RGBE and OpenEXR (uncompressed, RLE, ZIP, PIZ later) |

glTF extensions read and written: `KHR_materials_emissive_strength`, `_clearcoat`, `_sheen`, `_transmission`,
`_volume`, `_ior`, `_specular`, `_iridescence`, `_anisotropy`, `_unlit`; `KHR_texture_transform`;
`KHR_lights_punctual`; `KHR_mesh_quantization`; `KHR_materials_variants` (read: becomes scenes or material slots);
`EXT_mesh_gpu_instancing`; `EXT_meshopt_compression` (decode and encode, meshoptimizer); `KHR_draco_mesh_compression`
(decode only, Draco decoder WebAssembly in a worker); `KHR_texture_basisu` (KTX2 decode via the Basis transcoder,
encode is an open question because the encoder is large). Unknown extensions are reported, and preserved on round
trip where the data is opaque (`extras` always).

**Export report.** Every export returns `{ warnings, baked, dropped, stats }` (what was baked, what a format cannot
hold, sizes before and after optimization), shown in the dialog and returned by the CLI with `--json`.

**Optimization** (`engine/world/optimize.js`, used by export options and `ofini world optimize`): dedupe meshes,
materials and textures; weld; prune unused; reorder for vertex cache and overdraw; quantize; meshopt compression;
simplify to a ratio or a triangle budget; resize textures to a maximum; convert images to WebP or AVIF where the
target allows it.

## 10. AI: Vibe tools

Group **World** in `vibe/tools/world.js` (static definitions; logic loads on the first call from
`world/ai-runtime.js` and `world/ai-ops.js`). Every write tool is one undo step ("Vibe: …") through `ops.js`. Names
match the MCP tools (11) so skills and prompts work in both places.

| Tool | Kind | What it does |
| --- | --- | --- |
| `world_describe` | read | Compact outline of the document or a subtree: scenes, nodes (id, type, name, transform, bounds, mesh stats, modifiers, materials), cameras, lights, environment, animation summary, render settings |
| `world_get` | read | Full JSON of nodes, materials, modifiers, settings (raw or resolved) |
| `world_screenshot` | read | Render from the active camera, a named view (front, top, iso…) or a **multi-view contact sheet** (front, side, top, perspective in one image) at a size and quality; optional overlays: wireframe, ids, bounding boxes, a ground grid with meters |
| `world_pick` | read | What is at given pixel coordinates of a screenshot (node, face, world position, normal, material): lets the model reason about "the thing at the top left" |
| `world_measure` | read | Bounds, dimensions, distances between nodes, volume and surface area, center of mass, whether a mesh is manifold and watertight |
| `world_stats` | read | Triangles, draw calls, texture memory, GPU time per pass, the heaviest nodes, lint findings |
| `world_lint` | read | Non-manifold edges, flipped or zero-area faces, unapplied negative scale, missing UVs for textured materials, overlapping UVs, huge textures, too many draw calls, lights without shadows where expected, camera clipping, emissive bloom over budget, print checks (watertight, wall thickness) |
| `world_create` | write | Create nodes from a compact JSON spec (nested, with primitives, transforms, modifiers, materials by name or spec, lights, cameras); the main text-to-scene tool |
| `world_update` | write | Patch nodes, materials, settings (dotted paths) |
| `world_transform` | write | Move, rotate, scale, align, distribute, drop to floor, place on surface (raycast), look at |
| `world_delete` / `world_duplicate` / `world_parent` | write | Structural edits |
| `world_mesh_edit` | write | Kernel operations on a mesh with a selection given as ids, as a rule (faces facing +Y, the top 10 % by height, a loop through an edge) or as a region of a screenshot |
| `world_modifier` | write | Add, change, reorder, toggle, apply modifiers |
| `world_material` | write | Create or edit a material from a spec (preset + overrides, or a full graph) and assign it |
| `world_material_from_prompt` | write | Plans a node graph for a described material (the model writes the graph; the tool validates, compiles, renders a preview ball and returns it for inspection) |
| `world_shader` | write | Create or update a custom shader node or post pass from source; returns compile logs for both backends and a preview, so the model iterates until it compiles. Shaders written by the assistant are trusted for this document (the user asked for them) but still pass the static checks and the watchdog |
| `world_texture` | write | Procedural texture graphs, bake to images, or generate an image with the configured image model and use it as a texture (with seamless tiling check) |
| `world_environment` | write | HDRI from the library or a file, physical sky (time of day, sun direction), background, exposure, tone mapping |
| `world_light_rig` | write | Lighting presets (three-point, studio softbox, product sweep, sunset, night city) adapted to the bounds of the subject |
| `world_camera` | write | Create or move cameras, frame nodes, set focal length and depth of field, camera presets (hero, top-down, isometric) |
| `world_animate` | write | Keyframes on any property, presets (turntable, bounce, float, reveal, camera orbit, dolly), easing, behaviors |
| `world_procedural` | write | Seeded generators: scatter on surface, arrays and grids, stacks, terrain from noise, rocks, trees (L-system lite), cities (block grids), abstract compositions; heavier logic runs through `run_script` (code mode, ADR 0028) with the world operations exposed |
| `world_import` / `world_export` | write / read | Formats of section 9 with options and the export report |
| `world_render` | write | Stills, turntables and passes into Pixel (new document or layer) or Scene (clip), section 13 |
| `world_uv` | write | Unwrap, project, pack |

**Text to scene.** The skill *build a scene from a brief* has the model plan the composition (subject, props,
ground, lights, camera, mood), create it with `world_create`, look at it with `world_screenshot` (multi-view),
correct proportions and placement with `world_measure` and `world_pick`, then light and grade it. The assistant
works in meters and is told the conventions (+Y up, −Z forward).

**Scene understanding.** For questions about a model ("is this printable?", "why is it dark?", "what is this part?"),
the assistant combines `world_describe`, `world_stats`, `world_lint`, a contact sheet and `world_pick`. For an
imported model it can name parts from the screenshot and write the names back (`world_update`), which also improves
the outliner for people.

**Image or text to mesh** (a generated mesh rather than a composed scene) is not built in: OpenFini has no 3D
generation model. Through the engine registry, an extension or an MCP server the user connects can provide one; its
GLB result goes through the normal importer and lint.

Skills (lazy skill pack `world`): *build a scene from a brief*, *product shot*, *3D logo from SVG*, *material from a
description*, *shader from a description*, *procedural environment*, *turntable for a slide or a video*, *prepare
for web* (optimize, bake, compress, check budgets), *prepare for 3D printing*, *explain this model*.

## 11. MCP

World joins the MCP server that the Proto Studio introduces (ADR 0034, Proto task T12): the same transport-neutral
JSON-RPC handler, the same transports (Streamable HTTP on loopback from the desktop shell, `ofini mcp` over stdio
proxying to the app or serving one file headless), the same security rules (off by default, loopback only, bearer
token, Host and Origin checks, per-client approval, read-only until writes are allowed, rate and size limits, one undo
step per call labeled with the client, the AI log). The handler gets a second document family; tools are named
`world_*`.

* **Read tools**: `world_list_documents`, `world_describe`, `world_get`, `world_get_selection` (app host), `world_stats`,
  `world_lint`, `world_measure`, `world_screenshot` (app host renders on the GPU; the headless host returns the
  software preview, marked approximate), `world_pick` (app host), `world_export` (returns GLB, OBJ, STL or PLY bytes
  as an embedded resource, or writes to a path the user allowed for headless use).
* **Write tools** (scope `write`): `world_create`, `world_update`, `world_transform`, `world_delete`,
  `world_duplicate`, `world_parent`, `world_mesh_edit`, `world_modifier`, `world_material`, `world_animate`,
  `world_environment`, `world_camera`, `world_import`, `world_procedural` (data generators only; code mode stays
  inside the app). `world_shader` is **not** exposed to external clients in 1.4.x: shader source from an external
  agent would bypass the trust gate's intent; the user can paste it into the playground. Open question 20.
* **Resources**: `ofini-world://<doc>/tree`, `…/node/<id>`, `…/material/<id>`, `…/stats`, `…/scene.glb` (on read),
  `…/view/<camera>.png` (app host). `resources/subscribe` sends updates after commits (debounced 500 ms).
* **Prompts**: `implement_scene_in_code` (export GLB and write three.js code that loads it into the client's project),
  `review_model`, `prepare_for_web`.
* **Limits**: 200,000 faces per `world_create` or `world_mesh_edit` call, 4 MiB request size, 60 write calls per minute.

## 12. CLI

`ofini world <command>` in `cli/lib/world.mjs`, reusing `engine/world/` (ADR 0032 rules: `--json`, exit codes, no
overwrite without `--force`, wildcards, `-` for stdin and stdout). Inputs are `.ofini` World documents or any format
of section 9 (read as a temporary World model).

| Command | What it does |
| --- | --- |
| `ofini world info <file...>` | Scenes, nodes by type, meshes (vertices, faces, triangles), materials, textures with sizes, animations, extensions used, bounds, memory estimate |
| `ofini world tree <file> [--scene] [--node] [--depth]` | The outline (the `world_describe` format) |
| `ofini world inspect <file> --node <ids> [--evaluated]` | Full JSON of nodes, materials and modifiers; `--evaluated` adds the evaluated mesh statistics |
| `ofini world validate <file...> [--strict]` | Schema, references, limits, mesh bodies against their hashes; exit 1 on errors |
| `ofini world lint <file...> [--rules] [--format text\|json\|sarif] [--profile web\|print\|realtime]` | The lint of section 10 with budgets per profile (triangles, textures, draw calls, file size); SARIF for CI annotations |
| `ofini world convert <in> <out> [--up y\|z] [--units m\|cm\|mm\|in] [--apply-modifiers]` | Between `.ofini` (World), GLB, glTF, OBJ, STL, PLY; USDZ when it lands |
| `ofini world optimize <in> <out> [--simplify 0.5\|--max-tris N] [--meshopt] [--quantize] [--texture-max 2048] [--webp\|--avif] [--dedupe] [--prune]` | The optimization of section 9, with a before/after report |
| `ofini world export <file> --format glb\|gltf\|obj\|stl\|ply\|usdz [--scene] [--node] [--bake]` | Export with the export report |
| `ofini world bake <file> --material <id> [--size 2048] [--out dir]` | Bakes material graphs to images with the CPU evaluators |
| `ofini world apply <file> <ops.json\|->` | Applies World operations as one all-or-nothing batch (`--out`, `--in-place` or `--dry-run`; `--seed`) |
| `ofini world diff <a> <b>` | Structural diff: nodes, transforms, meshes (by hash, with vertex count changes), materials, animation; exit 1 when they differ |
| `ofini world render <file> [--camera] [--size 1024x1024] [--turntable 36] [--out]` | `--preview`: the pure software rasterizer (approximate, PNG, works anywhere). Without `--preview`, proxies to a running desktop app (the endpoint file of `ofini mcp`) for a GPU render; exits with code 4 when no app is running (ADR 0032) |

`ofini new world <file> [--template studio|product|empty|turntable]`, and `ofini info`, `validate`, `doctor`, `unpack
--pretty`, `extract --assets` know the kind once task T1 lands. `ofini convert` delegates to `ofini world convert`
for 3D extensions.

CLI dependencies: the meshoptimizer and manifold WebAssembly builds load from `app/vendor/` (the same files the app
uses), so the CLI adds no npm dependency.

## 13. Interop with the other studios

| From World to | How | Notes |
| --- | --- | --- |
| **Pixel** | *Render ▸ To Pixel*: a new Pixel document or a new layer in the open one, at a size and quality; optional passes as extra layers (alpha, depth as a gray layer, normal, object id mask per node, AO, shadow catcher) | Product compositing: the shadow catcher layer multiplies onto a photo |
| **Scene** | *Render ▸ Turntable / Animation to Scene*: a rendered image sequence becomes a clip (frames embedded as a WebM or a PNG sequence in media); or a **World clip** (`type: "world"` in the Scene model): a live 3D layer that the Scene compositor renders through `world/render/capture.js` at each frame, with the clip's time mapped to the World timeline and an optional camera override | The live clip keeps the scene editable; exports render it frame-exactly (frame = f(model, time) on both sides) |
| **Layout** | A **3D object** frame: an embedded World document (the model stored in the layout document's assets) with a camera and a pose; the canvas shows a cached render, double-click opens it in World (in place or as a tab) | Print and PDF export use a render at the output resolution (300 dpi by default); no live 3D in PDF (PDF 3D/U3D is not planned) |
| **Presentation** | The same 3D object on slides; in the presenter and in HTML export it can be **interactive** (orbit, zoom) or play its animation on slide entry | PPTX export: a rendered image (PowerPoint's 3D models need GLB-in-PPTX support, an open question) |
| **Proto** | A `model3d` node type: renders in the shadow root through the World player custom element, with a poster image for culled and exported frames; prototype interactions can play an animation range or orbit | Code export writes the player element with the GLB |
| **Code** | *Export ▸ Web*: (a) **three.js project**: GLB plus `main.js` with an import map using the Code studio's three.js entry (`engine/web/libs.js`), lights, environment, camera, animation mixer and orbit controls, opened as a Code studio project; (b) **World player**: a self-contained `world-player.js` (our runtime over the same pinned three.js, the same look settings and post passes), one HTML file with the GLB embedded or beside it; (c) GLB only | The Code studio can also preview `.glb` files and open them in World |
| **Vector** | SVG paths become `shape3d` nodes (extrude, lathe, sweep, with bevels): the 3D logo workflow. Back: *Export ▸ SVG outline* of a render (silhouettes and creases, an open question) | Paste a Vector selection into World creates shapes |
| **Office** | Images of renders in Documents and Sheets through the normal image paths; the Whiteboard can hold a 3D object like Presentation | — |

The World player custom element (`<ofini-world>`) is shared by Presentation's presenter, Proto, HTML exports and the
Code studio's preview: one runtime, one look. It renders only when visible (IntersectionObserver), pauses when the page
is hidden, respects `prefers-reduced-motion` (no autoplay of animation, no auto-rotate) and has an `alt` text and a
poster image.

## 14. File format

### 14.1 Container

* A World document is a normal `.ofini` file (ADR 0006): `document.json` has `"studio": "world"` and `"office": {
  "kind": "world", …model }`; media under `office/world/media/<hash>.<ext>`, mesh bodies under
  `office/world/mesh/<hash>.ofwm`. The type marker and the container version rule are unchanged; an OpenFini that
  does not know the kind keeps the object and the parts unchanged and saves them back.
* **Stable serialization**: keys in a fixed order, maps sorted by id, numbers with a fixed precision rule (positions in
  JSON are rare; transforms keep up to 6 decimals), so `ofini unpack --pretty` gives small Git diffs. Mesh bodies are
  binary but content-addressed, so an unchanged mesh is an unchanged file in Git.
* Thumbnail: the active camera's render as `preview.png` (the software preview when no GPU was available).
* `docs/file-format.md` gets a *World* section when T1 lands.

### 14.2 Mesh body (`OFWM`)

```
magic "OFWM" | u16 version = 1 | u16 flags | u32 sectionCount
section: u32 tag (four characters) | u32 byteLength | bytes (4-byte aligned)
  POSN f32[3·V]                 VFSZ u8 or u32 face sizes (flag)   CORN u32[C] corner → vertex
  UV0n f32[2·C] (+ name)        COLn u8[4·C] or f32 (+ name)        FMAT u16[F]   FSMO bitset[F]
  ECRE u8[E] crease             ESEA bitset[E] seam                 ESHA bitset[E] sharp
  NORM f32[3·C] custom normals  (edges indexed by the canonical derived edge order)
```

Readers check every length against the counts in the JSON header, reject out-of-range indices, and keep unknown
sections. The SHA-256 of the whole body is its name.

## 15. Collaboration

* **Adapter** `app/src/world/collab.js` (`collabAdapter` for kind `"world"`, added to `LIVE_OFFICE_KINDS` in
  `core/live-kinds.js`). Records:

  | Key | Value |
  | --- | --- |
  | `n:<id>` | structure: `type`, `scene`, `parent`, `ord`, `name`, `visible`, `locked`, `render`, `tags` |
  | `n:<id>/xf` | transform |
  | `n:<id>/data` | type data: `mesh` or `prim`, `cam`, `light`, `text`, `path` + `op`, `emit`, `of`, `doc` |
  | `n:<id>/mods` | the modifier stack (one record: order matters and stacks are small) |
  | `n:<id>/mats` | material slots, shadow flags |
  | `n:<id>/anim/<path>` | one animation channel |
  | `n:<id>/x` | fields this version does not know |
  | `mesh:<id>` | mesh header: hash, counts, bounds, attrs, chunk list |
  | `blob:<sha256>` | one 64 KiB chunk of a mesh body or a media file, immutable, content-addressed |
  | `mat:<id>` | material settings (`name`, `model`, `side`, `blend`, …) |
  | `mat:<id>/g:<nodeId>` | one graph node (type, position, constant inputs) |
  | `mat:<id>/links` | the link list (one record, validated against the nodes on apply) |
  | `sh:<id>` | custom shader (source as a record; large sources are chunked) |
  | `tex:`, `env:`, `scene:`, `render:`, `media:` | one record per entry |
  | `meta:*`, `timeline` | title, units, timeline settings, markers |

* **Concurrency**: two people moving different objects, editing different modifier stacks or different material nodes
  never conflict. The same record resolves by Lamport clock (last writer wins) with the existing lost-update notice.
  Moves are conflict-free through parent + fractional key; cycles are broken deterministically as in the Proto
  adapter.
* **Meshes**: an edit-mode or sculpt commit produces a new body; the sender publishes the chunks the room has not seen
  (by hash) and then the `mesh:` header. A receiver applies the header only when all its chunks are present (and
  verified by hash), so a half-received mesh is never shown. Two people editing the **same mesh** in edit mode at the
  same time is last-writer-wins on the whole mesh: presence shows "Ana is editing *Bottle*" on the object and in the
  outliner, and entering edit mode on a mesh someone else is editing asks first (a soft lock, not enforced).
* **Validation**: every remote record goes through `validateRecordOp` and the World validator for its key type;
  chunk hashes are verified; size limits per record (64 KiB for JSON records, chunks exactly as declared).
* **Presence**: each peer's viewport camera drawn as a small frustum in their color (toggle), their selection outlined
  in their color, their 3D cursor, the mode they are in. *Follow* adopts their camera (smoothly, or instantly with
  reduced motion). The playhead is shared optionally (*Sync playback*).
* **Comments**: anchor kind `world`: `{ kind: "point", node, local: [x, y, z], normal, view? }` (a point on a
  surface in the node's local space, so pins follow the object; `view` stores the camera of the comment for *Go to*).
  Comments on deleted nodes become document comments.
* **Undo**: per-person undo through the records engine (only my records are reverted), as for Scene and Proto.

## 16. Security

### 16.1 Custom shaders and the GPU

Shader source in a document is untrusted code that runs on the GPU. It cannot read files or the network, but it can
hang the GPU (a GPU reset blanks the screen for a moment and loses every web view's GPU context), crash a driver, or
make the app unusable.

* **Trust gate**: custom nodes and custom post passes in a document **do not compile** until the user trusts the
  document on this device ("This file contains custom shader code from someone else. Run it?" with *Run once*,
  *Always for this file*, *Keep off*). Documents the user created, and shaders the user (or the assistant in the user's
  chat) wrote in this document, are trusted. Trust is local state keyed by the document id and the shader hashes; a
  remote change to a shader's source in a collaboration room makes it untrusted again for the receiver until accepted.
  Untrusted nodes render their fallback constant and show a badge.
* **Static checks** before compiling (`engine/world/material/shader-check.js`, pure): source size ≤ 32 KiB;
  a tokenizer for WGSL and GLSL ES 3.0 that rejects loops without a literal or uniform-clamped bound ≤ 1,024
  (`for (i = 0; i < N; i++)` forms only, `while` and `loop` rejected), recursion (not legal in either language, but
  checked for clear messages), more than 16 texture samples inside a loop, entry points and bindings in node code
  (functions only, no `@group` declarations), and preprocessor extensions in GLSL. The check exists for helpful errors
  and to bound cost; it is not the security boundary on its own.
* **Isolation of compile and first run**: new shaders compile asynchronously; the first frames with a newly compiled
  shader render into a small offscreen target first (64 × 64) and are timed; above 50 ms the shader is suspended before
  it reaches the full-size viewport.
* **Watchdog**: frame times are measured (GPU timestamps on WebGPU, `onSubmittedWorkDone` or fence-like waits on
  WebGL 2); three consecutive frames over 1 s, or a device or context loss within 10 s of activating a shader, put the
  document into **shader safe mode** (all custom nodes off, a banner explains and offers to turn them back on one by
  one). The setting is remembered for that document.
* **Resource caps**: render target sizes, texture counts and particle counts are capped by the limits of 3.6 and the
  adapter's limits; captures above 8192 × 8192 are tiled.
* **Built-in nodes** emit only generated code from our templates; constants are numbers, never strings in code.

### 16.2 Imports

* Readers validate before allocating (counts, offsets, index ranges, accessor bounds against buffer views), cap sizes
  (3.6), and run in a worker; a malformed file fails with a message, never a hang (time limit per job, ADR 0019).
* glTF external URIs resolve only to files inside the imported folder or archive; `http(s):` URIs are never fetched
  automatically (the import dialog lists them; fetching goes through the network policy and the user's choice);
  `data:` URIs are size-capped.
* Images decode through `createImageBitmap` in a worker with a pixel cap; HDR and EXR readers are pure and bounded.
* WebAssembly decoders (Draco, Basis, meshoptimizer, manifold) are vendored, pinned, integrity-checked by the
  service worker manifest, and run in workers only.
* ZIP limits of `core/ofini.js` apply to `.ofini`, USDZ and zipped glTF.
* The *FBX through Blender* route runs only a fixed script through the allow-listed command runner (desktop), with the
  input and output paths as arguments, never user-supplied Python.

### 16.3 MCP, assistant and collaboration

* MCP: the rules of ADR 0034 ▸ 14.3 apply unchanged; `world_shader` is not exposed to external clients (11).
* The assistant's `world_procedural` heavy paths run in `run_script` (code mode, ADR 0028): an isolated worker with a
  call gate, one undo step and a dry run.
* Names, notes, text and comments in a model are untrusted content for agents (prompt injection); tool results put
  document text in delimited JSON fields.
* Collaboration: end-to-end encryption and record validation as everywhere; chunks are verified by hash; shader
  sources from peers are untrusted (16.1).

## 17. Performance targets and memory limits

### 17.1 Targets

Reference machines: a 2023 laptop with integrated graphics (Intel Iris Xe or AMD 680M, 16 GB), an Apple M1 (8 GB),
and a desktop with a mid-range discrete GPU. Measured in CI where possible (Chromium with a GPU in a self-hosted or
GPU runner when available, otherwise SwiftShader for correctness only) and by hand on the reference machines, recorded
in the PR of each task (as Proto's performance tasks do).

| Scenario | Target |
| --- | --- |
| Open the studio (cold, three.js not cached) | Interactive viewport < 1.5 s on broadband, < 400 ms when cached |
| Open a 1 M-triangle GLB (50 MB) | First frame < 3 s; full textures < 5 s |
| Viewport, Balanced, 1080p, 1 M triangles, 200 draw calls, 3 shadowed lights, IBL, SSAO, bloom | 60 fps on the M1 and the discrete GPU, ≥ 30 fps on Iris Xe |
| Viewport, Draft, same scene | ≥ 60 fps on Iris Xe |
| Navigation in a 5 M-triangle scene | ≥ 30 fps (Draft, half-resolution while moving) |
| Edit mode, 100 k-vertex mesh | Selection < 16 ms; extrude / inset / bevel / loop cut < 50 ms; commit (hash + chunk) < 100 ms |
| Subdivision level 2 on a 10 k-quad cage | < 100 ms in the worker; the viewport never blocks |
| Boolean of two 50 k-triangle meshes (manifold) | < 300 ms in the worker |
| Sculpt on 500 k triangles | 60 fps brush on the M1, ≥ 30 fps on Iris Xe |
| Material edit (constant) | Next frame (uniform update) |
| Material edit (structure) | New compile < 300 ms on WebGPU; the old material shows meanwhile |
| Still capture 2048 × 2048, Quality, 64 accumulated frames | < 4 s on the M1 |
| Turntable 72 frames 1080p to Scene | < 30 s on the M1 |
| glTF export of a 1 M-triangle scene with meshopt | < 3 s |

### 17.2 Memory

* **GPU budget**: 512 MiB by default (1 GiB on desktops with a discrete GPU, 256 MiB on mobile), configurable. The
  Statistics panel shows GPU memory by category (geometry, textures, render targets, shadow maps). Over 90 %: new
  textures load at half resolution and a notice offers to downscale; render targets shrink in Draft.
* **CPU**: the model's JSON is small; mesh bodies are typed arrays shared between the model and the worker by
  transfer (not copied twice); evaluated meshes are cached in an LRU capped at 512 MiB; undo keeps old mesh bodies
  alive only while history refers to them, capped at 1 GiB with the oldest steps dropped first (with a notice).
* **Textures**: GPU-compressed formats where supported (KTX2/Basis transcoded to BCn, ETC2 or ASTC), mipmaps always,
  maximum size 4096 by default.
* **Workers**: up to `navigator.hardwareConcurrency − 1` (max 4) for evaluation, booleans, imports and exports; the
  manifold WebAssembly module is instantiated once per worker and freed after 60 s idle.

### 17.3 Download size

* Start-up: +≤ 1 KiB (the studio definition, menu rows, Labs switch).
* The studio's own lazy JavaScript: budgeted per task in `scripts/size-budget.json`; estimated 200 to 260 KiB gzip at
  the end of 1.4.x (kernel and modifiers about 40, formats about 35, render adapter and passes about 45, UI, panels,
  node editor and tools about 80, Vibe and collaboration about 30).
* On-demand vendor files (outside `total`, cached by the service worker on first use, as the PDF reader): three.js
  (pinned WebGPU build), manifold, meshoptimizer, Draco decoder, Basis transcoder, two small default HDRIs. Each
  task records the measured size.

## 18. Accessibility

* **Keyboard first**: every tool, mode and operation is a command (command palette, menus, keys); transforms accept
  typed values (G X 2 Enter, or numeric fields in the Properties panel); the viewport has a keyboard camera (arrows
  orbit, Shift+arrows pan, +/− zoom, numpad views) and keyboard selection (Tab / Shift+Tab cycle objects in outliner
  order, Enter enters edit mode).
* **Screen readers**: the outliner is an ARIA tree grid; the viewport is a focusable region whose accessible
  description is generated from `world_describe` (scene summary and the selection: "Bottle, mesh, 24,320 faces, at
  0, 0, 0, glass material, selected"), announced on selection changes through a live region; operations announce
  their result ("Extruded 12 faces"); the material editor's nodes and sockets are focusable DOM with labels and link
  descriptions.
* **Vision**: axis colors are paired with letters on every gizmo; selection uses outline plus a pattern, not color
  alone; socket types have shapes as well as colors; a high-contrast overlay theme; UI scales with the app's font size.
* **Motion**: `prefers-reduced-motion` turns off auto-rotate, smooth camera transitions, animated previews in the asset
  browser and autoplay in embeds and exports (the World player honors it too).
* **Input**: no gesture-only actions; every drag has a numeric alternative; pen pressure is optional; the Simple
  keymap avoids modal keys; hover-only information is also available on focus.
* **Embeds and exports**: 3D objects in Layout, Presentation, Proto and HTML exports have alt text (the assistant can
  write it from a render) and a poster image; the World player is keyboard-operable (arrows orbit, Space plays).
* **Photosensitivity**: the shader playground and post passes warn when a preview flashes more than three times per
  second (luma change detector on the preview).

## 19. Build plan

Eighteen tasks, each one PR, each independently mergeable once its dependencies are merged. Sizes: **S** ≤ 1 day,
**M** 2–4 days, **L** 5–8 days of focused agent work including tests and docs. Every task: US English, German strings
at 100 %, `npm test`, `npm run build && npm run check:size` with its budget increase recorded in
`scripts/size-budget.json`, docs updated (`docs/world-studio.md` from T5 on), no new npm runtime dependency (vendored
files listed in `THIRD_PARTY_NOTICES.md` with their license), no attribution lines in commits or PRs. Until 1.4.0 is
released the studio is reachable only with *Settings ▸ Labs ▸ World Studio*, so tasks can merge to `main` as soon as
their dependencies allow.

### Waves and releases

At most four agents work in parallel; a wave starts when the dependencies of its tasks are merged.

| Wave | Tasks (parallel) | Release |
| --- | --- | --- |
| A | T1, T2 | 1.4.0 (World preview) |
| B | T3, T4, T7 | 1.4.0 |
| C | T5, T16 | 1.4.0 |
| D | T6, T8, T11, T14 | 1.4.0: model, kernel, modifiers, renderer, shell, edit mode, materials, formats, animation, collaboration, CLI |
| E | T9, T10, T12, T15 | 1.4.1: custom shaders, post stack and particles, sculpt, assistant and MCP tools |
| F | T13, T17, T18 | 1.4.2: UVs, renders into Pixel and Scene, 3D in Layout, Presentation, Proto and web export; the preview label is removed |

```
T1 ─> T4 ─> T5 ─┬─> T6 ─> T13
                ├─> T8 ─> T9
                ├─> T11 ─> T17 (also T4)
                ├─> T12 (also T2)
                └─> T14
      T4 ─> T10
T2 ─> T3 ─> T15 (also T5, T8; soft: T7, T11)
T1 + T2 ─> T7 ─┬─> T16
               └─> T18 (also T4, T5)
```

### Tasks

**T1 · Document model, schema, operations** — M — deps: none
* Scope: `engine/world/schema.js` (types, defaults, limits), `ids.js`, `tree.js` (children cache, traversal, world
  matrices), `validate.js`, `migrate.js` (schema 1 + fixture), `serialize.js` (canonical JSON), `format.js`
  (`loadModel` / `storeModel` for `doc.office`, mesh body parts under `office/world/mesh/`), `ops.js` (node create,
  insert, update with a field allow-list and dotted paths, move and reparent with fractional keys, delete with
  subtree, duplicate and linked duplicate, scene, material, texture, environment, render, timeline and media
  operations, `batch`; each returns `{ model, inverse, ids }` like Proto's), `mesh-body.js` (OFWM read/write, SHA-256
  and 64 KiB chunk hashes via `crypto.subtle` with a pure fallback for Node), kind `"world"` in `core/office.js`; the
  Doctor check (`world-invalid`, `world-newer`), so `ofini info` and `ofini validate` recognize designs.
* Files: `app/src/engine/world/*.js`, `app/src/core/office.js`, `app/src/core/doctor/`, `tests/world/model.test.js`,
  `tests/world/ops.test.js`, `tests/world/mesh-body.test.js`, `docs/file-format.md`.
* Acceptance: property tests (random op sequences keep the model valid, inverses restore deep-equal input, order keys
  sorted, no cycles); every malformed fixture is rejected with a path; serialize → parse → serialize byte-identical;
  OFWM round trip and hash stability; imports in plain Node.

**T2 · Mesh kernel: primitives, half-edge index, edit operations, triangulation** — L — deps: none
* Scope: `engine/world/mesh/` — `mesh.js` (typed-array polygon mesh, attributes), `halfedge.js` (index, loops,
  rings, boundaries, manifold checks), `select.js` (bitsets, grow, shrink, loop, ring, linked, by rule), `prims.js`
  (all parametric primitives of 3.2, deterministic), `triangulate.js` (ear clipping with holes for n-gons, text and
  SVG), `shapes.js` (SVG path → outline → extrude, bevel, lathe, sweep), `ops/*.js` (extrude variants, inset, bevel,
  loop cut and slide, edge slide, bridge, fill, merge, dissolve, delete, separate, join, split, rip, spin, subdivide,
  triangulate, quads from triangles, normals, mark seam/sharp/crease, mirror, symmetrize, poke, solidify, convex
  hull, knife-lite in a plane), `normals.js` (smooth, flat, angle-based auto smooth, custom split normals).
* Files: `app/src/engine/world/mesh/**`, `tests/world/mesh/*.test.js`, `tests/world/fixtures/meshes/`.
* Acceptance: property tests per operation (valid mesh, attribute ranges kept, Euler characteristic as expected on
  closed meshes, deterministic output for a seed); golden fixtures for every primitive (counts and hashes);
  100 k-vertex extrude/inset/bevel/loop cut < 50 ms in Node on CI; no DOM or GPU access (import test).

**T3 · Modifier stack, worker evaluation, manifold booleans, meshoptimizer** — L — deps: T2
* Scope: `engine/world/mods/` (evaluator with per-position caching, `subsurf` Catmull-Clark with creases, `mirror`,
  `array`, `solidify`, `bevel`, `displace` (CPU texture evaluation hook for T8), `weld`, `triangulate`, `smooth`,
  `wireframe`, `decimate`, `remesh`, `boolean`, `scatter` as instances); the `world.evaluate` worker job; vendoring
  manifold (WebAssembly, Apache-2.0) and meshoptimizer (MIT) under `app/vendor/` with a loader that works in the
  browser worker and in Node; `THIRD_PARTY_NOTICES.md`.
* Files: `app/src/engine/world/mods/**`, `app/src/core/workers/jobs.js`, `app/vendor/manifold/`,
  `app/vendor/meshopt/`, `tests/world/mods/*.test.js`.
* Acceptance: each modifier's output matches fixtures (counts, bounds, hashes); booleans of fixtures are manifold and
  keep material indices; stack re-evaluation starts from the first changed entry (tested by call counts); timings of
  17.1 for subsurf and boolean on CI hardware recorded; the vendor files load only when a boolean, decimate or remesh
  runs.

**T4 · Render core: three.js adapter, backends, PBR, IBL, shadows, capture** — L — deps: T1
* Scope: vendor a pinned three.js WebGPU build (with its WebGL 2 backend and TSL) under `app/vendor/three/`, loaded on
  demand and cached by the service worker; `world/render/backend.js` (capability detection, device and context loss,
  quality tiers, Settings ▸ World ▸ Renderer), `sync.js` (keyed incremental model → three.js projection, disposal,
  GPU memory accounting), `materials.js` (the plain PBR output node only; graphs come in T8), `env.js` (HDRI and
  procedural sky, PMREM, background modes; pure RGBE and minimal EXR readers in `engine/world/formats/hdr.js`,
  `exr.js`), shadows (cascades, PCF, soft), tone mapping (AgX, Neutral, ACES), MSAA / TAA, `capture.js` (stills with
  accumulation, transparent background, passes), `pick.js` (id buffer), overlay pass (grid, gizmo drawing primitives),
  the software rasterizer `engine/world/raster.js`; the render regression suite (`tests/world/render/`: fixed scenes
  rendered on WebGPU and WebGL 2 in Chromium via Playwright where a GPU is available, compared within tolerance; the
  raster tests run everywhere).
* Files: `app/vendor/three/`, `app/src/world/render/*.js`, `app/src/engine/world/raster.js`,
  `app/src/engine/world/formats/{hdr,exr}.js`, `tests/world/render/`, `tests/world/raster.test.js`,
  `THIRD_PARTY_NOTICES.md`, `scripts/size-budget.json`.
* Acceptance: no module outside `world/render/` imports three.js (a test greps); context loss in a test page rebuilds
  the scene without errors; the 1 M-triangle fixture meets the Balanced target on the reference machines (recorded);
  regression images match on both backends; the raster renders the fixtures in Node.

**T5 · Studio shell, viewport, outliner, properties, transform tools** — L — deps: T1, T4
* Scope: `studios/world.js` (definition, Labs flag `labsWorld`, menus, `essentials` docking preset and the six
  workspaces, `newDocument` with a studio template: ground, camera, three-point lights, HDRI, a rounded box),
  `world/host.js`, `workspace.js` (`app.worldUI`), `controller.js` (selection, modes, commands), `camera.js` (orbit,
  pan, zoom, fly, numpad views, frame selected, trackpad), `tools/` (select, box/lasso, move/rotate/scale gizmos and
  modal G/R/S with axis constraints and typed values, snapping, pivot, 3D cursor, add menu, duplicate, parent, apply
  transform, origin), `panels/outliner.js` (virtualized tree grid), `panels/properties.js` (object, light, camera,
  primitive parameters, modifier stack UI over T3 when present, simple material fields), statistics in the status bar,
  new / open / save (`.ofini` and drop of GLB once T7 is merged), start screen entry, keymaps (Blender-like and
  Simple), `docs/world-studio.md` (first user guide), German strings, `styles/world.css`.
* Files: `app/src/studios/{world.js,index.js}`, `app/src/world/**` (not `render/`), `app/src/commands/world.js`,
  `app/styles/world.css`, `tests/world/controller.test.js` (pure parts: selection, modal transform math, keymap
  tables), `docs/world-studio.md`.
* Acceptance: start-up bundle +≤ 1 KiB; open and save round trip; every tool reachable by keyboard and command
  palette; the outliner handles 50 k nodes at 60 fps scrolling; manual checks in WebView2, WKWebView and WebKitGTK
  recorded in the PR; read-only fallback without WebGL 2 (outline + software preview).

**T6 · Edit mode and modeling tools** — L — deps: T2, T5
* Scope: `world/edit/` (edit-mode session over the base mesh: GPU element picking for vertices, edges, faces; x-ray;
  selection tools and conversions; tools for every kernel operation with *Adjust last operation* panels; proportional
  editing; snapping to elements; loop cut preview; knife-lite; merge menu; mesh overlays: normals, face orientation,
  seams, creases, statistics), commit as one undo step with a new mesh body; parametric primitives convert to meshes
  on first edit (with a confirmation the first time); text3d and shape3d nodes keep parameters until converted.
* Files: `app/src/world/edit/**`, `app/src/world/tools/edit-*.js`, `tests/world/edit.test.js`, `docs/world-studio.md`.
* Acceptance: edit-mode targets of 17.1 on a 100 k-vertex mesh; undo/redo restores identical mesh hashes; every
  operation reachable by keys and menus; selection survives operations where the kernel maps it.

**T7 · Formats: glTF/GLB, OBJ/MTL, STL, PLY, optimization** — L — deps: T1, T2
* Scope: `engine/world/formats/gltf.js` (read and write glTF and GLB with the extensions of section 9; skins, morph
  targets and animations read into baked clips; meshopt decode/encode via the T3 vendor module when present, Draco
  decode via a vendored decoder in a worker), `obj.js`, `mtl.js`, `stl.js`, `ply.js`, `import.js` (axis and unit
  conversion, material mapping into graphs with the PBR output), `export.js` (the export report), `optimize.js`;
  File ▸ Import / Export entries and drop handling; the Code studio's file tree opens `.glb` in World.
* Files: `app/src/engine/world/formats/*.js`, `app/src/engine/world/optimize.js`, `app/vendor/draco/`,
  `tests/world/formats/*.test.js`, `tests/world/fixtures/formats/` (Khronos glTF sample models under their licenses,
  listed in the notices, or own fixtures).
* Acceptance: glTF round trip of the fixtures is lossless for supported features (structural compare); the Khronos
  validator (run in CI as a dev tool, not shipped) reports no errors on our exports; malformed fixtures fail with
  messages, within time limits, without huge allocations; OBJ/STL/PLY round trips; optimization reduces the fixture by
  the documented amounts.

**T8 · Material graphs, node library, TSL compiler, node editor** — L — deps: T4, T5
* Scope: `engine/world/material/` (graph schema and validation, node type registry with `cpu` implementations for
  every node of 7.2, presets, CPU evaluator, baking on the CPU), `world/render/materials.js` (graph → TSL, constant
  folding, uniform inputs, cache by hash, async compile with errors mapped to nodes), the generic `ui/nodes/` canvas
  (7.6), the material editor panel with preview ball and node search, the Properties material tab over the graph,
  GPU baking in the app (7.5), `displace` modifier hook to the CPU evaluator, glTF import/export mapping of graphs
  (bake when needed, when T7 is merged).
* Files: `app/src/engine/world/material/**`, `app/src/world/render/materials.js`, `app/src/ui/nodes/**`,
  `app/src/world/panels/material-editor.js`, `tests/world/material/*.test.js`, `tests/ui/nodes.test.js` (pure graph
  editing model), `docs/world-studio.md`.
* Acceptance: the node conformance test (GPU vs CPU within per-node tolerance) passes on both backends; changing a
  constant does not recompile (tested by counting compiles); the node editor is fully keyboard-operable; presets render
  as their reference images.

**T9 · Custom shader nodes, shader playground and GPU safety** — M — deps: T8
* Scope: `engine/world/material/shader-check.js` (WGSL and GLSL ES 3.0 tokenizers and the static checks of 16.1),
  custom node and custom post-pass types (7.4), the trust gate (local trust store, prompts, remote-change revocation),
  offscreen first-run timing, the watchdog and shader safe mode in `backend.js`, the playground panel (CodeMirror with
  WGSL/GLSL modes, Shadertoy-like uniforms, compile logs mapped to lines, *Make node*), the photosensitivity warning.
* Files: `app/src/engine/world/material/shader-check.js`, `app/src/world/render/custom.js`,
  `app/src/world/panels/playground.js`, `app/src/world/trust.js`, `tests/world/shader-check.test.js`,
  `docs/world-studio.md`, `docs/security.md`.
* Acceptance: fixtures of hostile shaders (unbounded loops, huge sources, deep texture loops) are rejected with clear
  messages; an untrusted document never compiles a custom node (tested with a spy on the compiler); a forced device
  loss after activation enters safe mode; the security review checklist is attached to the PR.

**T10 · Post-processing stack, particles, procedural environment** — L — deps: T4
* Scope: `world/render/passes.js` (SSAO, GTAO, bloom, DOF, SSR, motion blur, color grade reusing the Scene formulas
  and `.cube` LUTs, vignette, chromatic aberration, grain, outline, sharpen, fog, pixelate) with `controls` schemas and
  the Scene panel UI; tier defaults (4.4); `world/render/particles.js` and the pure deterministic emitter model in
  `engine/world/particles.js` (GPU compute on WebGPU, worker CPU on WebGL 2); physical sky parameters and presets.
* Files: `app/src/world/render/{passes,particles}.js`, `app/src/engine/world/particles.js`,
  `app/src/world/panels/scene.js`, `tests/world/particles.test.js`, `tests/world/render/` (pass fixtures).
* Acceptance: the same particle state at the same time from any scrub order (property test); pass regression images on
  both backends; Balanced and Quality tiers meet 17.1 on the reference machines (recorded).

**T11 · Animation and the shared timeline** — M — deps: T5
* Scope: animation channels in ops and validation (T1 schema reserved them), evaluation of a model at time *t*
  (`engine/world/evaluate.js` using `scene/keyframes.js`), `world/anim-adapter.js` that plugs World properties into
  the Scene Studio's keyframe rows and graph editor (refactoring `scene/timeline.js` and `scene/graph.js` only as far
  as an adapter interface needs, with Scene's tests green), stopwatch and diamond controls in Properties, auto-key,
  playback, markers, turntable / orbit / dolly / follow-path / look-at helpers, glTF animation clips (read-only baked
  clips; export of channels per marker range when T7 is merged).
* Files: `app/src/engine/world/evaluate.js`, `app/src/world/anim-adapter.js`, `app/src/world/panels/timeline.js`,
  `app/src/scene/{timeline,graph}.js` (adapter seam), `tests/world/evaluate.test.js`, `tests/scene/*` (unchanged and
  green), `docs/world-studio.md`, `docs/scene-studio.md`.
* Acceptance: a World track and a Scene track with the same keyframes give identical values at every frame (shared
  test); the Scene Studio's existing tests pass unchanged; turntable preset loops seamlessly (first and last frame
  differ by exactly one step).

**T12 · Sculpt mode basics** — M — deps: T2, T5
* Scope: `world/sculpt/` (BVH, brushes of 5.3, symmetry, masking, pen pressure, stroke smoothing, partial GPU buffer
  updates, delta undo, commit to a new mesh body), voxel remesh and decimate commands through T3 (if T3 is not merged
  yet, those two commands ship with T3's follow-up), brush settings panel.
* Files: `app/src/world/sculpt/**`, `app/src/engine/world/mesh/bvh.js`, `tests/world/sculpt.test.js` (pure brush math
  and BVH), `docs/world-studio.md`.
* Acceptance: brush math tests (falloff, symmetry, smoothing preserve volume within tolerance); 500 k-triangle target
  of 17.1 recorded; undo of a stroke restores the exact mesh hash.

**T13 · UV unwrapping basics and the UV editor** — M — deps: T6
* Scope: `engine/world/uv/` (seams, LSCM with a sparse solver, projections, smart project, pack, average scale,
  stretch metric, lightmap UVs), UV editor panel (display over the active texture, selection modes, move, rotate,
  scale, pin, straighten), edit-mode commands (U menu).
* Files: `app/src/engine/world/uv/**`, `app/src/world/panels/uv-editor.js`, `tests/world/uv/*.test.js`.
* Acceptance: unwrapping fixtures (cube, cylinder with a seam, character-like mesh) give no overlapping islands and
  stretch below documented thresholds; packing is deterministic and within margin; UV edits are one undo step.

**T14 · Live collaboration and comments** — M — deps: T1, T5
* Scope: `world/collab.js` (records of 15, content-addressed chunk publishing and verified assembly, tree repair),
  `"world"` in `LIVE_OFFICE_KINDS`, `world/presence.js` (camera frusta, selections, 3D cursor, mode, soft edit lock,
  follow, optional shared playhead), comment anchor kind `world` with pins on surfaces, the collaboration hooks in
  `ui/collab/runtime.js` and the overlay pass.
* Files: `app/src/world/{collab,presence,comments}.js`, `app/src/core/live-kinds.js`, `app/src/ui/collab/*`,
  `tests/collab/world-records.test.js`, `docs/collaboration.md`.
* Acceptance: 300 seeded random concurrent op sequences converge to identical models (as the Proto adapter test);
  chunks in shuffled order assemble and verify; malformed and oversized records are rejected; an edit to one vertex
  of a 1 M-vertex mesh sends ≤ 2 chunks.

**T15 · Vibe tools, skills, scene understanding and MCP world tools** — L — deps: T3, T5, T8 (soft: T7, T11)
* Scope: `vibe/tools/world.js` (static definitions of section 10), `world/ai-ops.js` and `ai-runtime.js` (spec
  parsing for `world_create`, rule-based selections for `world_mesh_edit`, multi-view contact sheets, pick, measure,
  stats, lint in `engine/world/lint.js`), procedural generators (`engine/world/procedural/`: scatter, terrain, rocks,
  L-system trees, blocks), the lazy skill pack `world` and the studio guide for the assistant; registration of the
  world tools in the MCP handler of Proto T12 (if Proto T12 is not merged yet, the MCP part becomes a follow-up S
  task and this task ships the Vibe side).
* Files: `app/src/vibe/tools/world.js`, `app/src/world/ai-*.js`, `app/src/engine/world/{lint,procedural/*}.js`,
  `app/src/vibe/skills/world/`, `app/src/engine/proto/mcp/` (world family), `tests/world/ai-ops.test.js`,
  `tests/world/lint.test.js`, `docs/vibe-studio.md`.
* Acceptance: every write tool is one undo step and validated; a scripted "product shot" brief run against a mock
  model produces a valid scene with camera, lights and environment; lint finds every seeded problem in its fixtures;
  MCP tools respect scopes (write refused until allowed).

**T16 · `ofini world` CLI** — M — deps: T1, T2, T7 (soft: T3 for `--apply-modifiers` and `optimize --simplify`)
* Scope: `cli/lib/world.mjs` with the commands of section 12, `ofini new world` templates, the software preview render,
  `--json` and SARIF output, `ofini convert` delegation for 3D extensions, completion and help.
* Files: `cli/lib/world.mjs`, `cli/lib/main.mjs`, `cli/lib/completion.mjs`, `tests/cli/world.test.js`, `docs/cli.md`.
* Acceptance: convert between every pair of supported formats on fixtures; `lint --format sarif` validates against the
  SARIF schema; `render --preview` writes PNGs matching fixtures; `render` without a running app exits 4; no new npm
  dependency.

**T17 · Renders into Pixel and Scene, the World clip** — M — deps: T4, T11
* Scope: *Render ▸ To Pixel* (new document or layer, passes as layers, shadow catcher), *Render ▸ Turntable /
  Animation to Scene* (rendered sequence as a clip), the Scene clip type `world` (model field, evaluation through
  `capture.js` at clip time, camera override, export frame-exact), the render dialog with presets (square product,
  16:9 hero, 9:16 story), `world_render` tool when T15 is merged.
* Files: `app/src/world/render-out.js`, `app/src/scene/{model,evaluate,render}.js` (world clip type),
  `app/src/scene/inspector.js`, `tests/scene/world-clip.test.js`, `docs/scene-studio.md`, `docs/world-studio.md`.
* Acceptance: a Scene export containing a World clip matches World's own capture at the same times (pixel diff within
  tolerance); passes land as named layers in Pixel; Scene's tests pass unchanged.

**T18 · 3D everywhere: the World player, embeds in Layout, Presentation and Proto, web export, USDZ** — L — deps: T4, T5, T7
* Scope: the `<ofini-world>` player element and runtime (`world/player/`, also bundled as `world-player.js` for
  exports), 3D object frames in Layout and Presentation (embedded model, camera, pose, cached render, open in World,
  print/PDF raster at output resolution, interactive in the presenter and HTML export), the Proto `model3d` node type
  (render and code export through the player), *Export ▸ Web* (three.js project into the Code studio using
  `engine/web/libs.js`, self-contained player HTML, GLB only), USDZ export (`engine/world/formats/usdz.js`, USDA +
  ZIP alignment), SVG paste into World as `shape3d`.
* Files: `app/src/world/player/**`, `app/src/engine/world/formats/usdz.js`, Layout, Presentation and Proto object
  modules (`app/src/engine/layout/`, `app/src/office/slides/`, `app/src/engine/proto/schema.js` and renderer),
  `tests/world/usdz.test.js`, `tests/world/player.test.js`, `docs/world-studio.md`, `docs/office-slides.md`,
  `docs/proto-studio.md`.
* Acceptance: a slide with a 3D object exports to PDF with a raster at the requested DPI and to HTML with a working,
  keyboard-operable player; the three.js project export runs in the Code studio preview; USDZ exports open in Apple
  Quick Look (manual check recorded) and pass a structural test (alignment, layer names); the player respects
  `prefers-reduced-motion`.

### Task summary

| Task | Title | Size | Deps | Wave / release |
| --- | --- | --- | --- | --- |
| T1 | Document model, schema, operations | M | — | A / 1.4.0 |
| T2 | Mesh kernel and edit operations | L | — | A / 1.4.0 |
| T3 | Modifier stack, worker, manifold, meshoptimizer | L | T2 | B / 1.4.0 |
| T4 | Render core (three.js adapter, PBR, IBL, shadows, capture) | L | T1 | B / 1.4.0 |
| T7 | Formats: glTF/GLB, OBJ, STL, PLY, optimize | L | T1, T2 | B / 1.4.0 |
| T5 | Studio shell, viewport, outliner, properties, transforms | L | T1, T4 | C / 1.4.0 |
| T16 | `ofini world` CLI | M | T1, T2, T7 | C / 1.4.0 |
| T6 | Edit mode and modeling tools | L | T2, T5 | D / 1.4.0 |
| T8 | Material graphs, TSL compiler, node editor | L | T4, T5 | D / 1.4.0 |
| T11 | Animation and the shared timeline | M | T5 | D / 1.4.0 |
| T14 | Live collaboration and comments | M | T1, T5 | D / 1.4.0 |
| T9 | Custom shader nodes, playground, GPU safety | M | T8 | E / 1.4.1 |
| T10 | Post stack, particles, procedural sky | L | T4 | E / 1.4.1 |
| T12 | Sculpt mode basics | M | T2, T5 | E / 1.4.1 |
| T15 | Vibe tools, skills, MCP world tools | L | T3, T5, T8 | E / 1.4.1 |
| T13 | UV unwrapping and the UV editor | M | T6 | F / 1.4.2 |
| T17 | Renders into Pixel and Scene, World clip | M | T4, T11 | F / 1.4.2 |
| T18 | World player, embeds, web export, USDZ | L | T4, T5, T7 | F / 1.4.2 |

## 20. Open questions

* **Name.** Working name **World Studio** (studio id and document kind `world`). Alternatives: *Form*, *Space*,
  *Depth*. To be decided before T5 (the id is hard to change after files exist).
* **three.js version and WebGPU stability.** Which release to pin at T4, and the upgrade policy (each upgrade is its
  own PR with the regression suite). If `WebGPURenderer` regresses on a platform, the backend switch forces WebGL 2
  there.
* **Interactivity** (Spline's states and events, hover and click reactions, variables): high value for web export and
  Proto, but a second runtime model. Candidate for 1.5 on top of the player.
* **Path tracer for stills** (an MIT WebGPU/WebGL path tracer exists for three.js): quality for product shots at the
  cost of size; optional on-demand module after 1.4.x.
* **Dynamic topology and multiresolution sculpting**: after the basics prove themselves.
* **Texture painting** (paint base color and roughness on the model, with Pixel's brushes): natural for the suite;
  needs UVs (T13) and a texture-space brush engine.
* **Geometry nodes**: the node editor of T8 can host them; the evaluation model (fields, instances) is a major design.
* **SDF "soft shapes"** (Womp-like blending of primitives, meshed through the kernel): approachable modeling for
  beginners; a later node type.
* **3MF** (printing, public specification) and **USDZ / USD import** (crate binaries): 3MF in 1.5 is likely; USD
  import probably through an optional converter, like FBX.
* **KTX2 encoding** (Basis encoder WebAssembly is large): CLI only, or an on-demand module.
* **Shaders from external agents over MCP** (`world_shader`): kept off in 1.4.x; revisit with a per-client "may write
  shaders" permission that still triggers the trust gate.
* **3D generation models** (text or image to mesh) through the engine registry: which local or hosted models to
  integrate, licensing of outputs.
* **PPTX 3D models** (GLB inside PPTX) and **PDF 3D**: not planned; renders are exported instead.
* **Library of assets** (HDRIs, materials, models): which CC0 sources to offer, how to fetch them under the network
  policy, and how to cache them.
* **Mobile and touch** (iPad as a sculpting device): the Simple keymap and pen pressure are a start; a touch layout is
  part of the 2.0 touch work.

## 21. Sources

Public pages consulted (November 2026); product names are trademarks of their owners.

* three.js WebGPURenderer manual and TSL: <https://threejs.org/manual/en/webgpurenderer>; discussion of TSL on WebGL 2
  and WebGPU: <https://discourse.threejs.org/t/tsl-and-webgl2-vs-webgpu/87974>
* WebGPU availability: <https://web.dev/blog/webgpu-supported-major-browsers>,
  <https://github.com/gpuweb/gpuweb/wiki/implementation-status>
* Engine comparisons and sizes: <https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison>,
  <https://blog.logrocket.com/three-js-vs-babylon-js/>, <https://forum.babylonjs.com/t/babylon-bundle-size/48068>
* Manifold (Apache-2.0): <https://github.com/elalish/manifold>, <https://npmjs.com/package/manifold-3d>
* meshoptimizer (MIT): <https://github.com/zeux/meshoptimizer>; Draco (Apache-2.0): <https://github.com/google/draco>;
  Basis Universal (Apache-2.0): <https://github.com/BinomialLLC/basis_universal>
* Blender 5.0 release notes (geometry nodes, rendering): <https://developer.blender.org/docs/release_notes/5.0/geometry_nodes/>,
  <https://developer.blender.org/docs/release_notes/5.0/rendering/>
* Spline V2 (rebuilt editor, AI agents, WebGPU, MCP): <https://updates.spline.design/changelog/introducing-spline-v2>,
  <https://thenewstack.io/spline-v2-mcp-agents/>, <https://spline.design/ai-generate>
* Womp: <https://womp.com/>; three.js editor: <https://threejs.org/editor/>; Babylon.js Node Material Editor:
  <https://doc.babylonjs.com/toolsAndResources/nme>; PlayCanvas editor: <https://playcanvas.com/products/editor>;
  Godot editor: <https://docs.godotengine.org/>; Shadertoy: <https://www.shadertoy.com/howto>
* glTF 2.0 and extensions: <https://registry.khronos.org/glTF/>; glTF validator: <https://github.com/KhronosGroup/glTF-Validator>
* USDZ file format specification: <https://openusd.org/release/spec_usdz.html>
* Model Context Protocol specification (2025-11-25): <https://modelcontextprotocol.io/specification>
* Least squares conformal maps (Lévy et al., SIGGRAPH 2002) and Catmull-Clark subdivision (1978): published algorithms,
  implemented from the papers.
