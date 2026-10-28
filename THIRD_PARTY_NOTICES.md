# Third-party notices

OpenFini itself is MIT-licensed (see [LICENSE](LICENSE)). It includes or builds on the following
third-party software and data. Each component keeps its own license; the full texts of the vendored
libraries are shipped next to them in `app/vendor/**`.

## Shipped with the application

| Component | Version | License | Where | Copyright / source |
| --- | --- | --- | --- | --- |
| [Shoelace](https://shoelace.style) | 2.20.1 | MIT | `app/vendor/shoelace` | © 2020 A Beautiful Site, LLC |
| ↳ [Lit](https://lit.dev) | ^3.2 (bundled in Shoelace chunks) | BSD-3-Clause | `app/vendor/shoelace/chunks` | © Google LLC |
| ↳ [@floating-ui/dom](https://floating-ui.com) | ^1.6 (bundled) | MIT | `app/vendor/shoelace/chunks` | © Floating UI contributors |
| ↳ [@ctrl/tinycolor](https://github.com/scttcper/tinycolor) | ^4.1 (bundled) | MIT | `app/vendor/shoelace/chunks` | © Scott Cooper |
| ↳ composed-offset-position, qr-creator, @shoelace-style/animations, @shoelace-style/localize | bundled | MIT | `app/vendor/shoelace/chunks` | their respective authors |
| [Bootstrap Icons](https://icons.getbootstrap.com) (subset of ~240 icons) | 1.11 (as shipped by Shoelace) | MIT | `app/vendor/shoelace/assets/icons` | © 2019-2024 The Bootstrap Authors |
| [CodeMirror 6](https://codemirror.net) (`@codemirror/state`, `view`, `commands`, `language`, `autocomplete`, `search`, `lint`, `lang-html`, `lang-css`, `lang-javascript`, `lang-json`, `lang-markdown`, `lang-xml`) | see `package.json` (6.x) | MIT | `app/vendor/codemirror` (one bundle, Code studio only) | © Marijn Haverbeke and others |
| ↳ [Lezer](https://lezer.codemirror.net) parser system and grammars (`@lezer/*`), style-mod, w3c-keyname, crelt | bundled | MIT | `app/vendor/codemirror` | © Marijn Haverbeke and others |
| [KaTeX](https://katex.org) (math in the Markdown and LaTeX previews, loaded only when a document has formulas; woff2 fonts only) | 0.19.0 | MIT | `app/vendor/katex` | © 2013-2020 Khan Academy and other contributors |
| ↳ `@codemirror/legacy-modes` (stex, yaml, toml, properties stream modes, part of the CodeMirror bundle) | 6.5.5 | MIT | `app/vendor/codemirror` | © Marijn Haverbeke and others |
| [pdf.js](https://mozilla.github.io/pdf.js/) (legacy build, loaded only when a PDF is opened) | 6.4.299 | Apache-2.0 | `app/vendor/pdfjs` (worker, WebAssembly decoders for JPEG 2000 / JBIG2 / color management with their own licenses in `wasm/`, ICC profile) | © Mozilla Foundation and pdf.js contributors; OpenJPEG (BSD-2-Clause), the PDFium-derived JBIG2 decoder (BSD-3-Clause) and qcms (MIT), see `app/vendor/pdfjs/wasm/LICENSE_*` |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT | `app/vendor/fflate` | © 2023 Arjun Barrett |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | 0.15.7 | MIT | `app/vendor/polygon-clipping` (bundled) | © 2018 Mike Fogel |
| ↳ [splaytree](https://github.com/w8r/splay-tree) | 3.2.3 (bundled) | MIT | `app/vendor/polygon-clipping` | © Alexander Milevski |
| ↳ [robust-predicates](https://github.com/mourner/robust-predicates) | 3.0.3 (bundled) | Unlicense | `app/vendor/polygon-clipping` | Vladimir Agafonkin and contributors |
| [Inter](https://rsms.me/inter/) (variable, Latin subset, via Fontsource) | 5.3.0 | SIL OFL 1.1 | `app/vendor/fonts` | © The Inter Project Authors — license text in `app/vendor/fonts/Inter-OFL.txt` |
| TeX hyphenation patterns for American English (`hyph-en-us`) | 2005-05-30 | Permissive TeX Hyphen license (MIT-style) | `app/src/engine/layout/hyphenation-en-us.js` | Frank Liang et al., [tex-hyphen](https://github.com/hyphenation/tex-hyphen) — notice in `app/src/engine/layout/HYPHENATION_LICENSE.txt` |

## Credits (no code included)

- **Liquid glass refraction** (`app/src/ui/refraction.js`, `refraction-dom.js`) re-implements, in OpenFini's own code, the
  technique described by [tomacco/amazing-glass](https://github.com/tomacco/amazing-glass) (MIT License, Copyright (c) tomacco):
  a displacement map derived from a rim height profile and Snell's law, applied with `backdrop-filter: url(#svg-filter)`.
  None of its source is copied or vendored; the credit is given for the idea.
- **Sea glass** look: design inspiration from [mweinbach/SeaGlass](https://github.com/mweinbach/SeaGlass) (Android; the
  repository has no license, so no code, assets or text were used).

OpenFini's own interface glyphs (`app/assets/icons`) and application logo (`app/icons`) were created for this
project and are covered by the project license.

## Desktop shell (compiled into the installers)

| Component | License | Notes |
| --- | --- | --- |
| [Tauri](https://tauri.app) 2.x and its plugins (dialog, fs, opener, single-instance) | MIT or Apache-2.0 | `src-tauri/Cargo.toml`; the full Rust dependency license list is produced by `cargo about` / `cargo license` at release time |
| Operating-system WebView (WebView2, WKWebView, WebKitGTK) | OS vendor terms | Not redistributed |

## Build and test tooling (not shipped)

[esbuild](https://esbuild.github.io) (MIT), [Tauri CLI](https://tauri.app) (MIT / Apache-2.0),
[Node.js](https://nodejs.org) (MIT and others). The vendored `pdfjs-dist` files are copied from the npm package `pdfjs-dist@6.4.299` (not a project dependency).

## MIT license (applies to the MIT components above)

```
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions: the above copyright notice and this permission notice shall be included in all copies
or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.
```

Each component's copyright line is listed in the table above; its full license file is included in the
corresponding `app/vendor/**` directory.

## Adding a dependency

New third-party code must have a license compatible with MIT distribution, must be vendored (or declared as
a build-time tool) and must be added to this file in the same pull request. See
[docs/clean-room.md](docs/clean-room.md).
