# Roadmap and Known Limits

OpenFini is alpha: the studios, engines and tooling are real and tested, but a full professional suite is a very large surface. This page lists what is missing or approximate today, per area, so you can judge whether OpenFini fits your work, and where contributions help most. It is a snapshot; the repository's `docs/roadmap.md` is the working copy and some of its older entries predate recent releases.

## Color and image fidelity

- sRGB, 8 bits per channel only. No CMYK, ICC profiles, 16 or 32-bit editing, HDR, spot colors or overprint. PDF output is DeviceRGB.
- No RAW decoding; Develop and Tone Mapping work on decoded 8-bit images.
- Selective Color and Color Balance use an RGB-based approximation, not true CMYK.

## Vector

- Boolean operations are destructive (undo restores). Missing: symbols, constraint-based artboards, shape builder, contour or offset tool, gradient mesh, hatch fills, vector brushes, path-on-text, clipping to text.
- SVG import ignores filters, masks, clip paths and patterns; SVG export flattens live effects it cannot express.

## Pixel

- Missing: smart selection, refine edge, patch tool, perspective and warp transforms, channels, brush textures and dynamics, symmetry painting, macros, frequency separation.
- Effects run in JavaScript on viewport pixels (a Web Worker or WebAssembly move is the highest-impact performance task). No waveform or vectorscope, color management or soft proof. Layers above about 50 megapixels depend on web view memory.

## Layout

- Missing: footnotes, indexes, cross references, books, per-page numbering formats, inline rich text in a table cell, live-linked table splits, secondary chart axes, trend lines, 3D charts, tagged-PDF alt text.
- Text wrap around shapes and baseline grids exist in the engine but have no UI.
- No OpenType features, right-to-left or complex scripts; hyphenation is US English only. PDF: no PDF/X, tagged PDF, forms or CMYK; only fonts added through the Type panel are embedded.

## Code

- The designer edits one page at a time (no partials, symbols or CMS). No interactions editor, forms backend or image optimization.
- No language server, type checking or terminal; Emmet covers a common subset.
- The preview resolves project files only; in the desktop app network requests from the preview are blocked by the Content-Security-Policy.
- Source Control lacks stash, rebase, cherry-pick, submodules and signed commits; remotes other than GitHub need a CORS proxy you configure; a native Git command is not available. Cloudflare Pages deploy is not possible from the app.
- Very large projects (thousands of files) are not optimized.

## Vibe

- Providers other than OpenAI-compatible servers and Anthropic are not native (Gemini uses its compatible endpoint). No subscription logins.
- Tested with fake servers and recorded fixtures; real providers may need fixes as they change.
- MCP: Streamable HTTP with bearer headers only, tools only (no resources or prompts), stdio through the gateway.
- No voice input, no web browsing tool, and OpenFini is not yet an MCP server for external agents.

## Office

- Text documents only. Spreadsheets and presentations are planned (their files are detected and explained). No comments, tracked changes, mail merge, tables of contents, sections or floating objects. PDF export uses standard fonts.

## Collaboration

- No live co-editing of one document; snapshots are exchanged. No WebRTC peer to peer. No per-message forward secrecy; a compromised member device exposes the room. Relay over real LAN, TLS and reverse proxies is not covered by automated tests.

## Extensions

- No marketplace, signing or review. A synchronous loop in an extension can freeze the window. VS Code extensions are not supported ([[VS Code Extensions]]).

## Platform and distribution

- Desktop builds are unsigned until certificates are configured; there is no auto-update.
- Installers (especially Windows ARM64 and the macOS Intel cross-build) are CI-built and not yet hardware-tested.
- The window size is not remembered. Touch-first phone layouts are not designed.

## Accessibility and localization

- The canvas is pointer driven. Interface languages: US English and German; right-to-left is wired but no RTL language exists yet ([[Accessibility]], [[Internationalization]]).

## Ideas for later

Planned studios (Video, Motion, Render/3D), scripting and macros, file-based sync, real-time co-editing, variable-font axes, color-managed workflows, optional WebGPU acceleration, spreadsheet and presentation editing.

## How to help

Pick an item, open an issue to discuss the approach, and read [[Contributing]]. Small, well-tested pure modules under `app/src/engine/` are the easiest way to start.

## See also

- [[FAQ]]
- [[Contributing]]
- [[Architecture Overview]]
- [[Decision Records]]
