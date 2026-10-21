# Glossary

Terms used across the OpenFini interface and documentation, in alphabetical order. Interface terms match the labels in the app; for German translations see the repository's `docs/i18n-glossary.md`.

| Term | Meaning |
| --- | --- |
| Adjustment layer | A non-destructive layer that changes the color or tone of what lies below it (or of one layer when nested). Levels, Curves, HSL and others |
| App lock | Optional passphrase that encrypts local data at rest and locks the interface ([[Security and Privacy]]) |
| Asset | The original bytes of a placed image stored in an `.ofini` file |
| Autoflow | Layout feature that creates as many linked frames and pages as a story needs |
| Bleed | Extra artwork beyond the trim edge of a page for print |
| Breakpoint | A viewport width at which the Code studio writes `@media` rules (Desktop, Tablet, Mobile) |
| Class selector | The CSS class the Code studio's style panel writes declarations to |
| Command | A named action with an id (for example `file.save`) used by menus, shortcuts, the palette and extensions |
| Command palette | `Mod+K` search over runnable commands |
| Demo model | The offline Vibe model that follows a script of real tool calls |
| Develop | The RAW-style pipeline of exposure, shadows and highlights, contrast, clarity and vibrance in Pixel |
| Display list | Backend-neutral list of paths, images and text runs a node compiles to |
| Document | The whole `.ofini` content: pages, masters, nodes, stories, styles, swatches, slices, assets and more |
| Dock | A panel area at an edge of the window |
| Extension | A sandboxed `.ofext` add-on ([[Extensions]]) |
| Frame | A container for text or an image on a page |
| Header | The bar at the top with studio buttons, Export and quick actions |
| Import report | List of what an importer kept, flattened or dropped |
| Master page | A page template whose content and fields repeat on pages |
| MCP | Model Context Protocol, a standard for tools offered to AI assistants ([[MCP and Knowledge]]) |
| Mod | `Ctrl` on Windows and Linux, `Cmd` on macOS in shortcut notation |
| Node | One object in the document tree (shape, text, image, pixel layer, table, chart...) |
| `.ofini` | OpenFini's native document format (a ZIP of JSON and assets) |
| `.ofext` | Extension package (ZIP) |
| `.ofprofile` | Exported settings profile (JSON) |
| Offline mode | A switch that blocks every outbound network feature |
| Pop-out | A document or studio shown in its own window ([[Multi-Window]]) |
| Protected mode | Website projects opened from files start with preview scripts off |
| PWA | Progressive web app: the installable browser version |
| RAG | Retrieval-augmented generation: the assistant searches your indexed documents |
| Relay | A small server that forwards encrypted collaboration frames ([[Collaboration Relay Setup]]) |
| Room | A collaboration session with chat, comments and presence |
| Safe mode | Start with defaults, no extensions, no AI, no session restore |
| Skill | A Markdown playbook the assistant loads on demand ([[Skills Authoring]]) |
| Slice | A named export region |
| Source Control | The Code studio's Git pane ([[Git in the Code Studio]]) |
| Story | Rich text shared by linked frames |
| Studio | A workspace (Vector, Pixel, Layout, Code, Vibe, Office) over the shared document |
| Sub-agent | A parallel child run of the assistant with restricted tools |
| Surface style | How the interface chrome is drawn: Solid, Glass, Liquid glass, Sea glass |
| Swatch | A saved color in the document |
| Tool (editor) | A canvas tool such as Pen or Brush |
| Tool (Vibe) | A function the assistant can call ([[Vibe Tools Reference]]) |
| Version | A named snapshot of a document kept on the device |
| Viewport | The simulated page size in the Code studio preview |
| Vibe | OpenFini's AI studio |
| Workspace | A saved arrangement of panels per studio |

## See also

- [[Concepts]]
- [[Studio Overview]]
- [[FAQ]]
- [[Internationalization]]
