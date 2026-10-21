# Bundled Extensions

OpenFini ships five ready-made extensions. They are not installed or enabled by default: a fresh OpenFini has zero extensions. This page lists them, the permissions each one asks for, how to install them and how contributors add a new one.

## Install

*Studio ▸ Extensions…* then **Available extensions**. Each card shows what it does, the studios it works in and every permission; **Install** opens the normal consent dialog. The packages are part of the app's files, so installing works offline.

## Catalog

| Extension | Id | Studios | What it does |
| --- | --- | --- | --- |
| Palette Pro | `openfini.palette-pro` | Vector, Pixel, Layout | Palettes from the selection or an image, harmonies, WCAG contrast checker with fixes, apply a palette to layers |
| Batch Export and Rename | `openfini.batch-export` | Vector, Pixel, Layout | Export layers and pages in several sizes and formats with a name template (ZIP), bulk layer rename |
| Lorem and Data Filler | `openfini.data-filler` | Vector, Pixel, Layout, Code | Seeded lorem ipsum, names, emails, addresses, dates, prices, initials avatars, HTML lists, tables and card grids |
| Code Snippets and Formatter | `openfini.code-tools` | Code | 44 snippets, format HTML, CSS, JS and JSON, sort CSS properties, minify, your own snippets |
| Accessibility Checker | `openfini.a11y-checker` | all | Contrast, font size, alt text, reading order, website audit, fixes, Markdown report |

## Permissions

| Permission | Palette Pro | Batch Export | Data Filler | Code Tools | A11y Checker |
| --- | :-: | :-: | :-: | :-: | :-: |
| `document.read` | x | x | x | x | x |
| `document.write` | x | x | x | x | x |
| `export` | | x | | | |
| `files` | x | x | | | x |
| `storage` | x | | | x | x |
| `ui` | x | x | x | x | x |

None needs the network, `commands` or `vibe`. All of them work through the assistant: `list_extensions` shows their commands and `run_extension_command` runs them after your approval, for example:

```json
{ "extension": "openfini.batch-export", "command": "export",
  "args": { "source": "selection", "scales": [1, 2], "formats": ["png"], "template": "{name}@{scale}x" } }
```

## The export permission

Batch export needed a way to render layers, so the API gained `document.export({ format, scale, ids, page })` (needs `export`) that returns bytes (`png`, `jpg`, `webp`, `svg`; scale 0.05 to 8). Saving still needs `files.save` and the system dialog.

## Limits

Extensions cannot read the Code editor's cursor or selection, so Code Tools works on project files and a scratchpad. Your own snippets live in the Code Tools panel, not in editor completion. The accessibility checks cover a subset of WCAG 2.2 and cannot measure contrast over images or gradients. UI strings of the extensions are English with separate German translations.

## For contributors

Sources are in `extensions/<folder>/`; `npm run ext:pack-all` packs them into `extensions/packages/*.ofext` and writes `extensions/catalog.json` (`-- --check` fails when they are stale). Pure logic lives in `src/lib*.js` (tested in Node); the packer strips `export`, inlines `_shared` imports and prepends the lib files, because the sandbox has no module loader. See [[Extending OpenFini]] and [ADR 0009](https://github.com/philppplik/open-fini/blob/main/docs/adr/0009-bundled-extensions.md).

## See also

- [[Extensions]]
- [[Extension SDK Reference]]
- [[Extending OpenFini]]
- [[Decision Records]]
