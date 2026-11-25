# Roadmap

OpenFini is at 1.2 (see [CHANGELOG.md](../CHANGELOG.md) for what each release shipped). This page is the short entry
point: where the plan lives, what is known to be missing, and how to help. It is not a backlog of its own.

## What is planned

The plan toward the next major release (2.0) is [concepts/roadmap-next-major.md](concepts/roadmap-next-major.md): themes,
a prioritized list (R1 to R22) with one-pull-request tasks, and four release waves.

| Wave | Version | Focus |
| --- | --- | --- |
| 0 | 1.2.x | Publish and sign the releases, close the code-scanning alerts, refresh this page |
| 1 | 1.3 | Desktop smoke tests and an Office/PDF interop corpus in CI, Pixel live filters off the main thread, OpenFini as an MCP server, referenced media in the Scene Studio |
| 2 | 1.4 | Live boolean shapes, OpenType features and variable fonts, Office interop depth, optional local engines (captions, OCR, segmentation), a TypeScript worker and PTY terminal in the Code studio, canvas accessibility |
| 3 | 2.0 | 16-bit tiled Pixel layers (a file format change), RAW decoding, footnotes and tagged PDF, tracking and stabilization in Scene, touch layouts |

A new **Proto Studio** for interface design and prototyping (frames, components, variants, auto layout, prototype
links) is designed separately: [concepts/proto-studio.md](concepts/proto-studio.md) (proposed, not built yet). The
2.0 plan only references it where items overlap, such as components, constraints and live booleans.

A new **World Studio** for 3D (modeling with a modifier stack, sculpting basics, PBR materials with a node editor and
custom shaders, WebGPU rendering with a WebGL 2 fallback, animation on the Scene Studio's timeline, glTF first, 3D in
the other studios, assistant, MCP and `ofini world`) is designed for the 1.4.x releases:
[concepts/world-studio.md](concepts/world-studio.md) and [ADR 0035](adr/0035-world-studio.md) (proposed, not built yet).

These are plans, not promises: the order can change with feedback and contributions.

## What is missing today

[known-limits.md](known-limits.md) is the single list of what OpenFini does not do yet, does only partly, or has never
been verified on real hardware, per area. The studio guides add detail where it matters (for example
[code-studio.md](code-studio.md#limitations), [scene-studio.md](scene-studio.md#limits) and
[office-suite.md](office-suite.md#roadmap-office-depth)). When an item is done it is removed there and noted in
`CHANGELOG.md`.

The headline gaps that people switching from other tools notice first: Pixel editing is 8 bits per channel with no
RAW decoding, boolean shapes are destructive, there are no OpenType features or right-to-left text, the Layout
studio has no footnotes or tagged PDF, the Code studio has no language server or full terminal, and the canvas is
pointer-driven (no keyboard drawing or screen-reader descriptions of objects).

## How to help

Pick an item from the roadmap or from [known-limits.md](known-limits.md), open an issue to agree on the approach, and
read [CONTRIBUTING.md](../CONTRIBUTING.md). Small, well-tested pure modules under `app/src/engine/` are the easiest way
to start. Tasks in the roadmap list their files and acceptance criteria, so each one can become one pull request.
