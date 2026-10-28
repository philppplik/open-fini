# 0016: Office Suite: one studio, a registry of lazily loaded apps per document kind

Status: Accepted

## Context

The Office studio was a word processor. The product needs spreadsheets, presentations and a whiteboard with the same
file handling (open in many formats, save back in the original format), Vibe tools, collaboration and comments, and
several engineers build these apps in parallel. The start-up budget (365 KiB gzip) leaves no room for four editors.

Options considered:

1. **One studio per app** (Sheets studio, Slides studio …): reuses the studio registry, but File ▸ Open routing,
   templates, export, Vibe awareness and the launcher would be duplicated four times, and the header would grow.
2. **One monolithic Office editor** that switches modes: one place, but every app change touches the same files
   (merge conflicts) and everything loads together.
3. **One Office studio hosting a registry of apps**, each a small manifest plus a lazily imported implementation
   behind a fixed contract.

## Decision

Option 3. `app/src/office/apps.js` is a pure registry; manifests (kind, formats, templates, AI note, `load()`) are
registered in `office/index.js` with one line per app; implementations provide `create / open / save / mount` and
optional `collabAdapter` (keyed records merged last-writer-wins) and `aiAdapter`. The suite host mounts one app
instance per document. `doc.office.kind` is an additive field; writers stamp format version 2 only for non-document
kinds so older versions warn instead of misreading them. App menus are static with an `officeKinds` filter; app Vibe
tools are static files (the tool list is built synchronously), calling into the lazy implementation.

## Consequences

* Adding an app touches its own folder plus a few one-line registrations (manifest, menus, commands, Vibe tools), so
  parallel branches merge cleanly. The contract is documented in [office-suite.md](../office-suite.md).
* Nothing of the suite is in the start-up bundle; each app's cost is paid when its first document opens.
* Live editing of Office apps is per-record last-writer-wins: concurrent edits of the same cell/object keep one
  value (the user is told). Character-level merging inside a record is out of scope; the word processor stays
  snapshot-shared until it has an adapter.
* A file of a kind whose app a build does not include still opens as an Office document with an explanation and is
  saved back unchanged.
