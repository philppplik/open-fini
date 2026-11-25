// Proto designs in the command line tool (`ofini proto`, docs/cli.md ▸ Proto): reading a design from an `.ofini`
// file or from model JSON, writing it back, and the lookups the commands share (pages, layers, modes). The design
// logic itself is the engine's (app/src/engine/proto/), so the CLI, the studio and the assistant agree.
import { strFromU8, strToU8 } from "../../app/vendor/fflate/fflate.js";
import { looksLikeZip } from "../../app/src/core/doctor/zip.js";
import { loadModel, storeModel } from "../../app/src/engine/proto/format.js";
import { emptyDocument, KIND } from "../../app/src/engine/proto/schema.js";
import { stringify } from "../../app/src/engine/proto/serialize.js";
import { apply } from "../../app/src/engine/proto/ops.js";
import { pageList, topLevel, ancestors } from "../../app/src/engine/proto/tree.js";
import { UsageError } from "./args.mjs";
import { CliError, EXIT, readOfini, writeOfini } from "./project.mjs";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** A new Proto model for `ofini new proto`: an empty page, or one frame `{ name, w, h }` at 0, 0. */
export function protoStarter({ title = "Untitled design", frame = null } = {}) {
  let model = emptyDocument({ title });
  if (frame) {
    const page = Object.keys(model.pages)[0];
    model = apply(model, { op: "node.create", type: "frame", page, fields: { name: frame.name, x: 0, y: 0, w: { mode: "fixed", value: frame.w }, h: { mode: "fixed", value: frame.h } } }).model;
  }
  return storeModel(model);
}

/**
 * Reads a Proto design from file bytes: an `.ofini` file whose project is a design, a `document.json` of one (from
 * `ofini unpack`), or a bare model (`*.json`).
 * @returns {{ model, load, source: "ofini"|"json", doc?, entries?, name }}
 *   load: the result of format.js ▸ loadModel (errors, warnings, readOnly, newer, notes)
 */
export function readProto(bytes, name) {
  if (looksLikeZip(bytes)) {
    const { doc, entries } = readOfini(bytes, name);
    if (doc.office?.kind !== KIND) throw new CliError(`${name} is not a Proto design (it is a ${doc.office?.kind || (doc.web ? "website" : doc.studio || "design")} project).`, EXIT.PROBLEMS);
    const load = loadModel(doc.office.model);
    return { model: load.model, load, source: "ofini", doc, entries, name };
  }
  let json;
  try {
    json = JSON.parse(strFromU8(bytes));
  } catch {
    throw new CliError(`${name} is neither an .ofini file nor JSON.`, EXIT.PROBLEMS);
  }
  const raw = isObj(json?.office) && json.office.kind === KIND ? json.office : json;
  if (!isObj(raw) || raw.schema === undefined || !isObj(raw.nodes)) throw new CliError(`${name} is not a Proto design (no "schema" and "nodes").`, EXIT.PROBLEMS);
  const load = loadModel(raw);
  return { model: load.model, load, source: "json", name };
}

/** Refuses to change a design this version cannot write safely. */
export function assertWritable(state) {
  if (state.load.newer) throw new CliError(`${state.name} was made by a newer OpenFini (Proto schema ${state.model.schema}); it is read-only here.`, EXIT.PROBLEMS);
  if (state.load.errors.length) throw new CliError(`${state.name} has ${state.load.errors.length} validation error(s); repair it first (ofini proto validate ${state.name}).`, EXIT.PROBLEMS);
}

/**
 * Bytes of a design after a change: the same container it came from (or JSON when `target` ends in .json). The rest
 * of an `.ofini` file (preview image, other parts) is kept as it was.
 */
export function protoBytes(state, model, target = "") {
  if (state.source === "json" || /\.json$/i.test(target)) return strToU8(`${stringify(model, { pretty: true })}\n`);
  const doc = state.doc;
  doc.office.model = storeModel(model);
  return writeOfini(doc, state.entries);
}

/** Pages in order: [{ id, name, index }]. */
export const pagesOf = (model) => pageList(model).map((p, i) => ({ id: p.id, name: p.name || p.id, index: i + 1 }));

/** A page by id, name (case-insensitive) or 1-based number; the first page without a spec. */
export function findPage(model, spec) {
  const pages = pagesOf(model);
  if (!pages.length) throw new CliError("The design has no pages.", EXIT.PROBLEMS);
  if (spec === undefined || spec === null || spec === true) return pages[0];
  const s = String(spec);
  const hit = pages.find((p) => p.id === s) || pages.find((p) => p.name.toLowerCase() === s.toLowerCase()) || (/^\d+$/.test(s) ? pages[Number(s) - 1] : null);
  if (!hit) throw new UsageError(`No page “${s}”. Pages: ${pages.map((p) => `${p.name} (${p.id})`).join(", ")}.`);
  return hit;
}

/** Top-level layers of a page in z order (bottom first). */
export const topLayers = (model, pageId) => (topLevel(model, pageId) || []).map((id) => model.nodes[id]).filter(Boolean);

/** The top-level layer that contains a layer (itself when it is top-level). */
export function topOf(model, id) {
  const up = ancestors(model, id);
  return up.length ? up[up.length - 1] : id;
}

/**
 * Layer ids from --node: a comma list of ids, instance-inner keys ("n5/n22") or exact layer names. Unknown entries
 * are usage errors.
 */
export function findNodes(model, spec) {
  const out = [];
  for (const part of String(spec).split(",").map((s) => s.trim()).filter(Boolean)) {
    const first = part.split("/")[0];
    if (isObj(model.nodes[first])) {
      out.push(part);
      continue;
    }
    const byName = Object.values(model.nodes).filter((n) => n?.name === part);
    if (byName.length === 1) out.push(byName[0].id);
    else if (byName.length > 1) throw new UsageError(`The name “${part}” matches ${byName.length} layers (${byName.slice(0, 5).map((n) => n.id).join(", ")}${byName.length > 5 ? ", …" : ""}); use an id.`);
    else throw new UsageError(`No layer “${part}” in the design.`);
  }
  return out;
}

/**
 * Parses --mode "Theme=dark,Density=compact" against the design's collections (names or ids, case-insensitive) →
 * { <collection id>: <mode id> }.
 */
export function parseModes(model, spec) {
  if (!spec || spec === true) return null;
  const colls = model.vars?.collections || {};
  const out = {};
  for (const part of String(spec).split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq < 1) throw new UsageError(`Invalid mode “${part}”: use Collection=Mode, for example Theme=dark.`);
    const cn = part.slice(0, eq).trim().toLowerCase();
    const mn = part.slice(eq + 1).trim().toLowerCase();
    const cid = Object.keys(colls).find((id) => id.toLowerCase() === cn || String(colls[id]?.name || "").toLowerCase() === cn);
    if (!cid) throw new UsageError(`No variable collection “${part.slice(0, eq).trim()}”. Collections: ${Object.values(colls).map((c) => c.name).join(", ") || "none"}.`);
    const modes = Array.isArray(colls[cid].modes) ? colls[cid].modes : [];
    const m = modes.find((x) => String(x?.id).toLowerCase() === mn || String(x?.name || "").toLowerCase() === mn);
    if (!m) throw new UsageError(`The collection “${colls[cid].name}” has no mode “${part.slice(eq + 1).trim()}”. Modes: ${modes.map((x) => x.name || x.id).join(", ")}.`);
    out[cid] = m.id;
  }
  return out;
}

/**
 * The model with `modes` set on a top-level layer, so a --mode choice wins over the mode the layer itself picks
 * (layers deeper inside that pick their own mode keep it, as on the canvas). The input is not changed.
 */
export function withModes(model, topId, modes) {
  const n = model.nodes?.[topId];
  if (!modes || !Object.keys(modes).length || !isObj(n)) return model;
  return { ...model, nodes: { ...model.nodes, [topId]: { ...n, modes: { ...(isObj(n.modes) ? n.modes : {}), ...modes } } } };
}

/** "390×844" for a sizing pair, or "fill×hug" when a side is not fixed. */
export function sizeText(node) {
  const one = (s) => (!isObj(s) ? "?" : s.mode === "fixed" ? fmtNum(s.value) : s.mode === "rel" ? `${fmtNum(s.value)}%` : s.mode);
  return `${one(node.w)}×${one(node.h)}`;
}

export const fmtNum = (n) => (typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(n));
