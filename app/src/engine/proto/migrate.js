// Schema migrations of the Proto model (docs/concepts/proto-studio.md §3.1 and §12). Pure.
//
// Rules (the same as core/ofini-migrate.js for document.json):
//   * Older models always open: `migrate` runs every step from the model's schema up to SCHEMA_VERSION.
//   * A model with a newer schema is returned unchanged with `newer: true` and `readOnly: true`: the studio opens it
//     read-only with a notice, because saving could drop what this version does not understand.
//   * A step never mutates its input; it returns a new model (structural sharing is fine).
//
// To add schema 2: bump SCHEMA_VERSION in schema.js, add `MIGRATIONS[1] = (model, notes) => newModel`, store a schema 1
// fixture under tests/proto/fixtures/schema-1/ (it is already there) and add a test that migrates it.
import { SCHEMA_VERSION } from "./schema.js";

/** MIGRATIONS[n] upgrades a schema-n model to schema n + 1. Schema 1 is the first, so there is no step yet. */
export const MIGRATIONS = Object.freeze({});

/**
 * Upgrades a model to `target` (SCHEMA_VERSION by default).
 * @param {object} model
 * @param {{ migrations?: Record<number, (model: object, notes: string[]) => object>, target?: number }} [o]
 * @returns {{ model: object, from: number, to: number, newer: boolean, readOnly: boolean, notes: string[] }}
 */
export function migrate(model, { migrations = MIGRATIONS, target = SCHEMA_VERSION } = {}) {
  if (!model || typeof model !== "object" || Array.isArray(model)) throw new Error("The Proto design is not an object.");
  const from = model.schema;
  if (!Number.isInteger(from) || from < 1) throw new Error("The Proto design has no readable schema version.");
  const notes = [];
  if (from > target) {
    notes.push(`This design was saved by a newer version of OpenFini (Proto schema ${from}; this version understands ${target}). It opens read-only.`);
    return { model, from, to: from, newer: true, readOnly: true, notes };
  }
  let m = model;
  for (let v = from; v < target; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`No migration from Proto schema ${v} to ${v + 1}.`);
    m = { ...step(m, notes), schema: v + 1 };
  }
  return { model: m, from, to: target, newer: false, readOnly: false, notes };
}
