# 0006 — `.ofini` is a ZIP of JSON plus original assets

**Status:** Accepted

## Decision

Documents are ZIP archives containing `document.json`, the original bytes of placed images, one PNG per
pixel layer and a thumbnail ([specification](../file-format.md)).

## Rationale

* Human-readable and repairable with common tools; easy for other software to read.
* Placed images keep their original encoding (no generation loss); pixel layers are lossless PNG.
* ZIP gives integrity and compression without a custom container, via the vendored `fflate`.

## Consequences

* Large pixel documents are written as many PNG entries; saving is asynchronous.
* Forward compatibility relies on readers ignoring unknown fields; `version` is bumped only for breaking
  changes.
