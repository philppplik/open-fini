// The Proto model inside an OpenFini document (docs/concepts/proto-studio.md §12, docs/file-format.md ▸ Proto). Pure.
//
// A Proto document is an `.ofini` file whose `document.json` has `"studio": "proto"` and `"office": { "kind":
// "proto", …model }`; core/office.js (OfficeProject) stores it like every other kind and keeps media bytes under
// `office/proto/media/<id>.<ext>`. This module is the bridge between that container and the engine:
//
//   loadModel(raw) → { model, readOnly, newer, from, notes, errors, warnings }
//       `raw` is `doc.office.model` (or the parsed `office` object of document.json); container-only fields (`kind`,
//       `_raw`, the `file` of media items) are removed, the schema is migrated and the result validated. A model with
//       errors is still returned (the caller decides: the studio refuses to edit it, the Doctor reports it).
//   storeModel(model) → object   the canonical model to put into `doc.office` (serialize.js), so saved files are stable
import { KIND, SCHEMA_VERSION } from "./schema.js";
import { migrate } from "./migrate.js";
import { validate } from "./validate.js";
import { canonical } from "./serialize.js";

export { KIND };
/** Archive folder of Proto media (core/office.js ▸ officeMediaDir("proto")). */
export const MEDIA_DIR = `office/${KIND}/media/`;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Removes the container's bookkeeping from a raw model. */
function strip(raw) {
  const { kind: _kind, _raw, ...model } = raw;
  if (isObj(model.media)) {
    const media = {};
    for (const [id, m] of Object.entries(model.media)) {
      if (!isObj(m)) {
        media[id] = m;
        continue;
      }
      const { file: _file, ...rest } = m;
      media[id] = rest;
    }
    model.media = media;
  }
  return model;
}

/**
 * Reads the Proto model of a document. Throws only when `raw` is not a Proto model at all (no object, no schema).
 * @param {object} raw
 * @param {{ validate?: boolean }} [o]
 */
export function loadModel(raw, { validate: check = true } = {}) {
  if (!isObj(raw)) throw new Error("The document has no Proto design.");
  const mig = migrate(strip(raw));
  const res = check && !mig.newer ? validate(mig.model) : { ok: true, errors: [], warnings: [] };
  return { model: mig.model, readOnly: mig.readOnly || !res.ok, newer: mig.newer, from: mig.from, notes: mig.notes, errors: res.errors, warnings: res.warnings, schema: SCHEMA_VERSION };
}

/** The model to store in `doc.office` (canonical key order; see serialize.js). */
export function storeModel(model) {
  return canonical(model);
}
