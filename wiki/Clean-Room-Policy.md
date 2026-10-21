# Clean-Room Policy

OpenFini is an independent project. It implements familiar categories of functionality (vector illustration, photo editing, page layout, export) using techniques published in textbooks, specifications and open-source projects, and it contains no code, assets, icons or file formats from other products. This page summarizes the policy and the rules for contributors; the repository's `docs/clean-room.md` is the canonical text.

## What OpenFini is and is not

- It implements public algorithms and standards: Bezier geometry, Porter-Duff compositing, Unicode line breaking, the PDF and SVG specifications, curve fitting, marching squares and similar.
- The studio-based workflow is a user-interface convention. Ideas, features and workflows are not copyrightable and many tools share them.
- It is **not** affiliated with, endorsed by or derived from any commercial product. Names of other products appear only to describe compatibility or comparison and are trademarks of their owners.

## Rules for contributions

1. **Write it yourself, from public sources:** specifications, papers, documentation and open-source code under compatible licenses (MIT, BSD, Apache-2.0, ISC, Unlicense, OFL for fonts).
2. **Do not copy or translate proprietary code, assets or documents:** that includes decompiled code, leaked source, extracted icons, fonts, UI strings, presets, brush files, templates and sample documents.
3. **Do not reverse engineer proprietary applications** to reproduce their code or private formats. Observing a product's behavior as a user is fine; disassembling it is not a source for OpenFini. If you have seen proprietary source for a feature, please do not implement it for OpenFini.
4. **Do not implement proprietary file formats** unless an official, public specification exists and its license permits it. The native format is `.ofini`.
5. **Keep names and artwork original:** no other products' logos, icon designs or trade dress. OpenFini's own icons were drawn for this project.

## How this shows up in the product

- Importers (PSD, IDML, TIFF, GIF, Sketch, OpenRaster and others) were written from public specifications and tested with synthetic files; the sources are listed in `docs/file-compat.md` ([[File Formats]]).
- Affinity, InDesign, Figma and XD files are proprietary without public specifications: OpenFini detects them and explains how to export to an open format instead.
- DOCX and ODT codecs follow ECMA-376 and ISO/IEC 26300; nothing was copied from other office suites ([[Office Studio]]).
- Vendored third-party code is listed in `THIRD_PARTY_NOTICES.md` with its license.

## Writing about other products

In docs, UI text and this wiki, mention other products only when needed to describe a file format or compatibility, in a neutral way and without logos. Do not make comparative marketing claims ([[Wiki Style Guide]]).

## See also

- [[Contributing]]
- [[File Formats]]
- [[Decision Records]]
- [[Roadmap and Known Limits]]
