# Concepts

OpenFini has a small number of ideas that explain most of its behavior: one document model shared by all studios, pages and nodes, a non-destructive and fully undoable editing model, and a single native file format, `.ofini`. This page defines them in user terms; [[Architecture Overview]] covers the code.

## Documents, pages and nodes

A **document** contains **pages** (and optional **master pages**). Each page holds a tree of **nodes**: groups, rectangles, ellipses, polygons, stars, paths, text frames, images, pixel layers and adjustment layers. Tables and charts are nodes too. Other shared parts of a document:

| Part | Meaning |
| --- | --- |
| Stories | Rich text shared by linked text frames, so text can flow from frame to frame |
| Styles | Paragraph and character styles |
| Swatches | The document's color swatches |
| Slices | Named export regions with format and scale |
| Assets | Original bytes of placed images |
| Web project | Website files of the Code studio, stored inside the document |
| Office content | The text of an Office studio document |
| Comments and versions | Collaboration data (see [[Collaboration]]) |

Because every node type can live on every page, a Layout page may contain vector shapes and photos, and a Vector document may contain text frames.

## Studios

A **studio** is a workspace, not a document type. Switching studios changes the toolbox, default panels and context bar; it never converts the document. The header shows up to five studios; the rest are in the *More* menu. Choose and order them in *Settings ▸ Studios*. See [[Studio Overview]].

## Nesting means clipping

The children of a painted node are clipped to it: put an image inside a frame and the frame crops it. An adjustment layer nested under a layer applies to that layer only; one at page level applies to everything below.

## Non-destructive editing and undo

Adjustments and live filters are layers you can reorder, mask, hide and re-edit. Parametric shapes (rectangle, ellipse, polygon, star) keep their parameters until you convert them to curves. Every change is one undoable step; a drag is one step, not hundreds. History memory is capped (96 MB, 32 MB in low-power mode; see [[Performance and Low Power]]). Boolean operations are destructive, but undo restores the shapes.

## Everything is a command

Every user action has a command id such as `file.save` or `arrange.group`. Menus, shortcuts, the command palette (`Mod+K`), context menus, extensions and the AI assistant all use them. That is why a hidden tool or menu item stays reachable from the palette ([[Customization and Profiles]]).

## The `.ofini` file

An `.ofini` document is a ZIP archive with `document.json`, the original image bytes, one lossless PNG per pixel layer, and a thumbnail. Anything that reads ZIP and JSON can inspect it. Old files are upgraded in memory when opened (the file stays untouched until you save); files from a newer OpenFini open best-effort with a warning. The format is documented in the repository: [file-format.md](https://github.com/philppplik/open-fini/blob/main/docs/file-format.md).

## Opening other files

Files you open with *File ▸ Open* keep their own format when saved, if the format can hold your edits ([[Save in Original Format]]). Formats OpenFini imports (PSD, PDF, IDML, TIFF, GIF and more) become editable documents with an **import report** listing what was kept, flattened or dropped ([[File Formats]]).

## Where your data lives

Documents are files you choose. Settings, the autosaved session, recent files and optional AI keys are in the app profile on your device. Nothing is sent anywhere unless you switch on a network feature ([[Security and Privacy]]).

## See also

- [[Studio Overview]]
- [[File Formats]]
- [[Save in Original Format]]
- [[Glossary]]
