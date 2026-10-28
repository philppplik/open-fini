// .ofini format versioning and migration (pure: no DOM, no storage).
//
// document.json carries `{ format: "openfini", version: N }`. Rules (see docs/file-format.md ▸ Compatibility):
//   * Every change that an older reader cannot simply ignore bumps FORMAT_VERSION and adds ONE migration step N -> N+1
//     to MIGRATIONS. A step receives the parsed JSON, mutates/returns it, and may push human-readable notes.
//   * Old files always open: `migrateDocumentJson` runs all steps from the file's version up to FORMAT_VERSION. Files
//     without a version are treated as version 0 (before the field existed).
//   * Newer files (version > FORMAT_VERSION) are opened best-effort, because readers ignore unknown fields, and are
//     reported with `newer: true` so the app can warn before a Save would drop data the old version cannot see.
//   * Migration never touches the zip (assets, pixels, web files): entry names are part of the contract documented
//     in docs/file-format.md and only change together with a version bump and a step that is told about the entries.
//
//   * Writers stamp the OLDEST version that can represent the document (`writeVersion`), so a change that only some
//     documents use (an Office spreadsheet, version 2) does not make every other file look "newer" to old readers.
//
// Versions: 1 = 0.5 .. 0.9 documents. 2 = Office documents of another kind than "document" (`office.kind`: sheet,
// slides, board …; 0.10). Older readers would show such a document as an empty word-processor file, so they must
// see it as "newer" and warn before a Save; the 1 -> 2 step itself changes nothing (absent kind = "document").
//
// To add a version: bump FORMAT_VERSION, add `MIGRATIONS[<old>] = (json, notes) => json`, add a fixture test in
// tests/core/ofini-migrate.test.js and describe the change in docs/file-format.md.

export const FORMAT_VERSION = 2;

/** The version a writer stamps: the oldest one that can represent `json` (see the header). */
export function writeVersion(json) {
  const kind = json?.office?.kind;
  return kind && kind !== "document" ? 2 : 1;
}

/** MIGRATIONS[n] upgrades a version-n document.json to version n + 1. */
export const MIGRATIONS = {
  // version 0 (no `version` field): the earliest files. Fill the fields every later reader may rely on.
  0(json, notes) {
    if (!Array.isArray(json.pages)) json.pages = [];
    if (!Array.isArray(json.masters)) json.masters = [];
    if (!json.styles || typeof json.styles !== "object") json.styles = { paragraph: {}, character: {} };
    if (!Array.isArray(json.swatches)) json.swatches = [];
    if (!json.settings || typeof json.settings !== "object") json.settings = {};
    notes.push("This file is from a very early version of OpenFini; missing fields were filled with defaults.");
    return json;
  },
  // version 1 -> 2: nothing to convert (version 2 only adds office.kind; absent means "document")
  1(json) {
    return json;
  },
};

/**
 * @param {any} json parsed document.json
 * @param {{ target?: number, steps?: Record<number, Function> }} [o] overrides for tests
 * @returns {{ json: any, from: number, to: number, newer: boolean, notes: string[] }}
 */
export function migrateDocumentJson(json, { target = FORMAT_VERSION, steps = MIGRATIONS } = {}) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("The document content is not valid.");
  if (json.format !== undefined && json.format !== "openfini") throw new Error("This file is not an OpenFini document.");
  const raw = json.version;
  const from = raw === undefined ? 0 : Number(raw);
  if (!Number.isInteger(from) || from < 0) throw new Error("The document has an unreadable format version.");
  const notes = [];
  if (from > target) {
    notes.push(`This document was saved by a newer version of OpenFini (format ${from}; this version understands ${target}). It opens with what this version can read; saving may drop newer features, so save a copy.`);
    return { json, from, to: from, newer: true, notes };
  }
  let v = from;
  while (v < target) {
    const step = steps[v];
    if (typeof step !== "function") throw new Error(`No upgrade path from document format ${v} to ${v + 1}.`);
    json = step(json, notes) || json;
    v += 1;
    json.version = v;
  }
  json.format = "openfini";
  if (from < target && notes.length) notes.unshift(`Upgraded from format ${from} to ${target}. The file on disk stays unchanged until you save.`);
  return { json, from, to: v, newer: false, notes };
}
