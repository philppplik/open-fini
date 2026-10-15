# Clean-room policy

OpenFini is an **independent** project. This page explains how we keep it that way and what we ask of
contributors.

## What OpenFini is and is not

* OpenFini implements familiar *categories* of functionality — vector illustration, photo editing, page
  layout, export — using techniques that are published in textbooks, specifications and open-source
  projects (Bézier geometry, Porter-Duff compositing, Unicode line breaking, the PDF and SVG specifications,
  Schneider's curve-fitting algorithm, marching squares, …).
* The studio-based workflow is a user-interface convention. Ideas, features and workflows are not
  copyrightable, and many tools share them.
* OpenFini is **not** affiliated with, endorsed by or derived from any commercial product. Names of other
  products are used only to describe compatibility or comparison and are trademarks of their owners.

## Rules for contributions

1. **Write it yourself, from public sources.** Base work on specifications, papers, documentation and
   open-source code under compatible licenses (MIT, BSD, Apache-2.0, ISC, Unlicense, OFL for fonts).
2. **Do not copy or translate proprietary code, assets or documents.** That includes decompiled code, leaked
   source, extracted icons, fonts, UI strings, presets, brush files, templates and sample documents.
3. **Do not reverse engineer proprietary applications to reproduce their code or private formats.**
   Observing a product's *behavior as a user* (what a menu does, how a tool feels) is fine; disassembling
   it is not a source for OpenFini. If you have seen proprietary source for a feature, please do not
   implement that feature for OpenFini.
4. **Do not implement proprietary file formats** unless an official, public specification exists and its
   license permits it. The native format is [`.ofini`](file-format.md).
5. **Keep names and artwork original.** Do not use other products' logos, icon designs or trade dress.
   OpenFini's own icons are in `app/assets/icons` and were drawn for this project.
6. **Third-party code needs a compatible license** and must be recorded in
   [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) before it is merged.

By opening a pull request you confirm that you wrote the change (or have the right to submit it) under the
project's [MIT license](../LICENSE) and that it follows these rules. Pull requests that clearly violate them
will be closed and removed from history.

## Origins of the main components

| Component | Origin |
| --- | --- |
| Path geometry, curve fitting, booleans (`engine/vector`) | Original code; uses [polygon-clipping](https://github.com/mfogel/polygon-clipping) (MIT) for boolean polygon operations and Schneider's published algorithm for fitting |
| Pixel algorithms (`engine/pixel`) | Original implementations of textbook algorithms (box / Gaussian blur, Lanczos resampling, marching squares, k-means / median cut, …) |
| Text layout, line breaking, PDF writer (`engine/layout`, `backends/pdf*.js`) | Original implementations from the Unicode, TrueType / OpenType and PDF 1.7 specifications; hyphenation patterns from TeX `hyph-utf8` (see `HYPHENATION_LICENSE.txt`) |
| Website engine (`engine/web`) | Original code written against the HTML, CSS and ECMAScript specifications: offset-preserving HTML / CSS parsers, edit producers, preview and site builders, Emmet subset |
| Code editor | [CodeMirror 6](https://codemirror.net) and Lezer language grammars (MIT), vendored as one bundle in `app/vendor/codemirror` |
| User interface | [Shoelace](https://shoelace.style) (MIT), Bootstrap Icons (MIT), Inter (OFL), plus OpenFini's own glyphs |
| Desktop shell | [Tauri](https://tauri.app) (MIT / Apache-2.0) |

## Reference research

The Code studio was planned after surveying what code editors and visual website builders offer. Everything below
is observation of *publicly available behavior and open-source software*; no source or asset was copied.

* **Code editor feature survey (VS Code, MIT-licensed open-source project).** The installed application was
  inventoried with [REA](https://github.com/morluto/rea) (`analyze-javascript-application`, static and read-only;
  nothing was executed or modified). The inventory lists the built-in extensions the editor ships — among them
  `emmet`, `html` / `html-language-features`, `css` / `css-language-features`, `json-language-features`,
  `markdown-language-features`, `media-preview`, `simple-browser`, `search-result`, `references-view` — which
  fixed the feature checklist for the Code studio (Emmet, project-wide search, diagnostics, media preview,
  live preview). REA could only complete the file inventory on this ARM64 Windows host (its process-control layer
  needs x64), so no deeper analysis was possible or needed.
* **Visual builder workflow.** Class-based styling, breakpoint cascades and navigator / element-panel layouts are
  common conventions of website builders. OpenFini implements them from public CSS specifications (cascade,
  media queries) and its own design; breakpoint widths (991 / 767 / 478 px) are widely used values, not a
  copyrighted work.
* **Emmet.** The abbreviation syntax is documented publicly; `engine/web/emmet.js` is an independent
  implementation of a subset, not a port of the Emmet source.
* REA's own [responsible-use terms](https://github.com/morluto/rea/blob/main/DISCLAIMER.md) exclude copying
  proprietary software or reproducing protected code and assets; the same rule applies to this project.

## Reporting a concern

If you believe something in this repository infringes your rights, please open a private security-style
report as described in [SECURITY.md](../SECURITY.md) with the file, the origin and what you would like to
see changed. We will respond promptly and remove or rewrite anything that needs it.
