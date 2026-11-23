# Roadmap and Known Limits

OpenFini is at 1.2: the studios, engines and tooling are real and tested, but a full professional suite is a very large surface. This page says where the plan lives, what is planned next and where to find the honest list of what is missing, so you can judge whether OpenFini fits your work and where contributions help most.

## Where the plan lives

- [docs/roadmap.md](https://github.com/philppplik/open-fini/blob/main/docs/roadmap.md): the short entry point.
- [docs/concepts/roadmap-next-major.md](https://github.com/philppplik/open-fini/blob/main/docs/concepts/roadmap-next-major.md): the plan toward 2.0 with a prioritized list, one-pull-request tasks and release waves.
- [docs/concepts/proto-studio.md](https://github.com/philppplik/open-fini/blob/main/docs/concepts/proto-studio.md): the proposed Proto Studio for interface design and prototyping (frames, components, variants, auto layout, prototype links).
- [CHANGELOG.md](https://github.com/philppplik/open-fini/blob/main/CHANGELOG.md): what each release shipped.

## What is planned next

| Wave | Version | Focus |
| --- | --- | --- |
| 0 | 1.2.x | Publish and sign the releases, close the code-scanning alerts, refresh the roadmap |
| 1 | 1.3 | Desktop smoke tests and an Office/PDF interop corpus in CI, Pixel live filters off the main thread, OpenFini as an MCP server, referenced media in the Scene Studio |
| 2 | 1.4 | Live boolean shapes, OpenType features and variable fonts, Office interop depth, optional local engines (captions, OCR, segmentation), a TypeScript worker and PTY terminal in the Code studio, canvas accessibility |
| 3 | 2.0 | 16-bit tiled Pixel layers, RAW decoding, footnotes and tagged PDF, tracking and stabilization in Scene, touch layouts |

These are plans, not promises; the order can change with feedback and contributions.

## Known limits

The single, current list is [docs/known-limits.md](https://github.com/philppplik/open-fini/blob/main/docs/known-limits.md): what OpenFini does not do yet, does only partly, or has never been verified on real hardware, per area. Items are removed there when they are done.

The gaps people switching from other tools notice first: Pixel editing is 8 bits per channel with no RAW decoding, boolean shapes are destructive, there are no OpenType features or right-to-left text, the Layout studio has no footnotes or tagged PDF, the Code studio has no language server or full terminal, and the canvas is pointer-driven ([[Accessibility]]).

## How to help

Pick an item, open an issue to discuss the approach, and read [[Contributing]]. Small, well-tested pure modules under `app/src/engine/` are the easiest way to start; roadmap tasks list their files and acceptance criteria.

## See also

- [[FAQ]]
- [[Contributing]]
- [[Architecture Overview]]
- [[Decision Records]]
