// File Doctor (docs/doctor.md): checks an .ofini project (and gives a short report on other files OpenFini reads) for
// damage, explains each finding and repairs what can be repaired safely. One code path does both: `analyze` walks the
// file and, when a fix is requested, applies it to its working copy right where the problem is found; `repairFile`
// then writes the working copy and checks the result again.
//
// Pure: no DOM, no storage, no network. Used by the app (ui/doctor-dialog.js, lazy) and by the `ofini` command line
// tool in Node (cli/). Messages are English templates with {placeholders}; the local N_ marks them for the i18n
// extractor, the UI translates them with t(message, params) and the CLI formats them with formatMessage.
//
// Finding: { code, severity: "error"|"warning"|"info", message, params, where?, fix?: { id, label, safe }, fixed? }
// Fixes marked `safe` never remove content a user made (they fill defaults, drop unreadable or unreferenced bytes,
// re-number duplicates); the others (`--fix=all` in the CLI, per item in the app) can drop broken layers or clips.
import { readZipStrict, scanLocalHeaders, looksLikeZip, safeEntryName, crc32, writeOfiniZip, DOCTOR_LIMITS } from "./zip.js";
import { zipSync } from "../../../vendor/fflate/fflate.js";
import { FORMAT_VERSION, writeVersion } from "../ofini-migrate.js";
import { formatMessage } from "../../i18n/format.js";
import { uid } from "../util.js";

const N_ = (s) => s; // marks text for the i18n extractor (this module does not import the i18n runtime)

export const OFINI_MIME = "application/vnd.openfini+zip";
/** Embedded parts above this size are reported (they make saving, autosave and collaboration slow). */
export const LARGE_PART = 64 * 1048576;
/** Layer trees deeper than this are refused by the Doctor (the app's recursive renderers would overflow the stack). */
export const MAX_DEPTH = 200;

/** Every fix the Doctor knows: label (English, translated by the UI) and whether "Fix all safe issues" applies it. */
export const FIXES = Object.freeze({
  "recover-entries": { label: N_("Rebuild the file from the readable parts"), safe: true },
  "drop-unsafe": { label: N_("Remove parts with unsafe names"), safe: true },
  mimetype: { label: N_("Rewrite the file type marker"), safe: true },
  "json-clean": { label: N_("Remove the damaged bytes around the document content"), safe: true },
  "format-field": { label: N_("Mark the content as an OpenFini document"), safe: true },
  "version-reset": { label: N_("Reset the format version"), safe: false },
  structure: { label: N_("Fill in missing document structure"), safe: true },
  ids: { label: N_("Give layers and pages unique ids"), safe: true },
  values: { label: N_("Replace invalid numbers with defaults"), safe: true },
  "drop-invalid": { label: N_("Remove unreadable layers"), safe: true },
  "drop-deep": { label: N_("Cut off layers nested too deeply"), safe: false },
  stories: { label: N_("Restore missing text stories as empty text"), safe: true },
  refs: { label: N_("Clear references to missing master pages and styles"), safe: true },
  "drop-broken-images": { label: N_("Remove image layers whose picture is missing"), safe: false },
  "prune-orphans": { label: N_("Remove stored files nothing refers to"), safe: true },
  "prune-unused": { label: N_("Remove assets no layer uses"), safe: false },
  web: { label: N_("Remove missing files from the website file list"), safe: true },
  office: { label: N_("Remove media records whose file is missing"), safe: true },
  "scene-cycle": { label: N_("Remove composition clips that nest a composition in itself"), safe: true },
  "scene-refs": { label: N_("Remove clips whose source is missing"), safe: false },
  thumbnail: { label: N_("Remove the broken preview (it is recreated on the next save)"), safe: true },
});

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

/** Formats a finding (or any { message, params }) in English, or through `translate(message, params)`. */
export function findingText(f, translate = null) {
  return translate ? translate(f.message, f.params || {}) : formatMessage(f.message, f.params || {});
}

/** Counts per severity. */
export function countFindings(findings) {
  const c = { error: 0, warning: 0, info: 0, fixable: 0, fixed: 0 };
  for (const f of findings) {
    c[f.severity] = (c[f.severity] || 0) + 1;
    if (f.fix && !f.fixed) c.fixable++;
    if (f.fixed) c.fixed++;
  }
  return c;
}

const sortFindings = (list) => list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const dec = (b) => new TextDecoder("utf-8").decode(b);
const enc = (s) => new TextEncoder().encode(s);
const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(String(name || "")) || [])[1]?.toLowerCase() || "";
const MiB = (n) => Math.round((n / 1048576) * 10) / 10;

// ------------------------------------------------------------------------------------------- byte-level checks

/** Checks the PNG signature, chunk CRCs and the IEND chunk. Returns null when fine, otherwise a short reason. */
export function pngProblem(b) {
  if (!b || b.length < 33) return "too short";
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return "not a PNG";
  let i = 8;
  let first = true;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    if (i + 12 + len > b.length) return "truncated";
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (first && type !== "IHDR") return "no header";
    first = false;
    const want = ((b[i + 8 + len] << 24) | (b[i + 9 + len] << 16) | (b[i + 10 + len] << 8) | b[i + 11 + len]) >>> 0;
    if (crc32(b.subarray(i + 4, i + 8 + len)) !== want) return "checksum mismatch";
    if (type === "IEND") return null;
    i += 12 + len;
  }
  return "truncated";
}

/** PNG width and height from the header, or null. */
export function pngSize(b) {
  if (!b || b.length < 24 || b[12] !== 0x49 || b[13] !== 0x48) return null;
  const r = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  return { width: r(16), height: r(20) };
}

/** Rough magic-number check of image bytes against their declared type. Null when consistent or unknown. */
function imageMismatch(bytes, mime) {
  if (!bytes || !bytes.length) return "empty";
  const m = String(mime || "");
  if (m === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 ? null : "not a PNG";
  if (m === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 ? null : "not a JPEG";
  if (m === "image/gif") return bytes[0] === 0x47 && bytes[1] === 0x49 ? null : "not a GIF";
  if (m === "image/webp") return bytes[8] === 0x57 && bytes[9] === 0x45 ? null : "not a WebP";
  return null;
}

// ------------------------------------------------------------------------------------------- the .ofini analysis

/**
 * Walks an .ofini file. `apply(fixId)` decides whether a fix is applied to the working copy.
 * @returns {{ report: object, state: object }}
 */
function analyze(bytes, { name = "document.ofini", limits = DOCTOR_LIMITS, apply = () => false } = {}) {
  const findings = [];
  const applied = new Set();
  const st = { entries: {}, order: [], json: null, jsonDirty: false, entriesDirty: false };
  const add = (code, severity, message, params = {}, fixId = null, where = undefined) => {
    const f = { code, severity, message, params };
    if (where) f.where = where;
    if (fixId && FIXES[fixId]) f.fix = { id: fixId, label: FIXES[fixId].label, safe: FIXES[fixId].safe };
    findings.push(f);
    return f;
  };
  /** Adds a finding and reports whether its fix should be applied now (marks it fixed). */
  const fixNow = (f) => {
    if (!f.fix || !apply(f.fix.id, f.fix)) return false;
    f.fixed = true;
    applied.add(f.fix.id);
    return true;
  };
  const report = { name, size: bytes?.length || 0, type: "ofini", container: "ok", findings, info: null };
  const done = () => {
    sortFindings(findings);
    report.counts = countFindings(findings);
    report.ok = report.counts.error === 0 || findings.filter((f) => f.severity === "error").every((f) => f.fixed);
    report.applied = [...applied];
    return { report, state: st };
  };

  if (!bytes || !bytes.length) {
    add("empty", "error", N_("The file is empty (0 bytes)."));
    report.container = "broken";
    return done();
  }
  if (!looksLikeZip(bytes)) {
    add("not-zip", "error", N_("This is not an OpenFini document: the file is not a ZIP container."));
    report.container = "broken";
    return done();
  }

  // --- container
  const z = readZipStrict(bytes, limits);
  if (z.overLimit) {
    add("limits", "error", N_("The file unpacks to more than OpenFini opens (2 GiB, 100,000 parts, 1 GiB per part). It may be damaged or hostile."));
    report.container = "broken";
    return done();
  }
  if (z.ok) {
    st.entries = z.entries;
    st.order = z.order;
  } else {
    const scan = scanLocalHeaders(bytes, limits);
    const n = scan.order.length;
    if (!n) {
      add("zip-corrupt", "error", N_("The ZIP container is damaged and no part of it could be read."), { reason: z.error || "" });
      report.container = "broken";
      return done();
    }
    report.container = "recovered";
    st.entries = scan.entries;
    st.order = scan.order;
    st.entriesDirty = true;
    const f = add("zip-corrupt", "error", N_("The ZIP container is damaged or truncated; {n, plural, one {# readable part was} other {# readable parts were}} recovered from it."), { n }, "recover-entries");
    fixNow(f);
    if (scan.damaged.length) add("damaged-entries", "warning", N_("{n, plural, one {# part is} other {# parts are}} damaged and cannot be recovered: {list}"), { n: scan.damaged.length, list: scan.damaged.slice(0, 8).join(", ") });
    z.unsafe.push(...scan.unsafe);
  }
  if (z.unsafe.length) {
    const f = add("unsafe-names", "warning", N_("{n, plural, one {# part has an unsafe name} other {# parts have unsafe names}} (absolute paths or \"..\"), ignored: {list}"), { n: z.unsafe.length, list: z.unsafe.slice(0, 5).join(", ") }, "drop-unsafe");
    if (fixNow(f)) st.entriesDirty = true;
  }
  const E = st.entries;

  // --- mimetype
  const mime = E.mimetype ? dec(E.mimetype) : null;
  if (mime === null) {
    const f = add("mimetype-missing", "warning", N_("The file type marker (mimetype) is missing."), {}, "mimetype");
    if (fixNow(f)) st.entriesDirty = true;
  } else if (mime !== OFINI_MIME) {
    const f = add("mimetype-wrong", "warning", N_("The file type marker says “{mime}” instead of an OpenFini document."), { mime: mime.slice(0, 80) }, "mimetype");
    if (fixNow(f)) st.entriesDirty = true;
  } else if (z.ok && (st.order[0] !== "mimetype" || z.stored.mimetype === false)) {
    const f = add("mimetype-order", "info", N_("The file type marker is not the first, uncompressed part, so other tools may not recognize the file."), {}, "mimetype");
    if (fixNow(f)) st.entriesDirty = true;
  }

  // --- document.json
  const djson = E["document.json"];
  if (!djson) {
    add("no-document", "error", N_("The document content (document.json) is missing; the remaining {n, plural, one {part} other {# parts}} can be extracted but not opened."), { n: st.order.length });
    return done();
  }
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(djson);
  } catch {
    text = dec(djson);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    let cleaned = null;
    if (start >= 0 && end > start) {
      try {
        cleaned = JSON.parse(text.slice(start, end + 1));
      } catch {
        cleaned = null;
      }
    }
    if (!cleaned) {
      add("json-invalid", "error", N_("The document content (document.json) is not valid JSON and cannot be repaired automatically ({reason})."), { reason: String(e?.message || "").slice(0, 120) });
      return done();
    }
    json = cleaned;
    const f = add("json-damaged", "error", N_("The document content has stray bytes around it (for example from a partial write)."), {}, "json-clean");
    if (fixNow(f)) st.jsonDirty = true;
  }
  if (!isObj(json)) {
    add("json-shape", "error", N_("The document content is not a JSON object."));
    return done();
  }
  st.json = json;

  // --- format and version
  if (json.format === undefined) {
    const f = add("format-missing", "warning", N_("The document content does not declare its format."), {}, "format-field");
    if (fixNow(f)) (json.format = "openfini"), (st.jsonDirty = true);
  } else if (json.format !== "openfini") {
    const f = add("format-wrong", "error", N_("The document content declares the format “{format}”, not OpenFini."), { format: String(json.format).slice(0, 60) }, "format-field");
    if (fixNow(f)) (json.format = "openfini"), (st.jsonDirty = true);
  }
  const rawV = json.version;
  if (rawV === undefined) add("version-missing", "info", N_("The file has no format version (a very early OpenFini file); it is upgraded when opened."));
  else if (!Number.isInteger(rawV) || rawV < 0) {
    const f = add("version-invalid", "error", N_("The format version “{version}” cannot be read."), { version: String(rawV).slice(0, 40) }, "version-reset");
    if (fixNow(f)) (json.version = writeVersion(json)), (st.jsonDirty = true);
  } else if (rawV > FORMAT_VERSION) add("version-newer", "warning", N_("The file was saved by a newer OpenFini (format {version}; this version understands {known}). Newer features may be lost when it is saved here."), { version: rawV, known: FORMAT_VERSION });

  // --- top-level structure
  const structure = (key, ok, make, sev = "warning") => {
    if (ok(json[key])) return;
    if (json[key] === undefined && rawV === undefined) return; // version 0 files are filled by the migration
    const f = add("structure", sev, N_("The document field “{field}” is missing or has the wrong type."), { field: key }, "structure");
    if (fixNow(f)) (json[key] = make()), (st.jsonDirty = true);
  };
  structure("pages", Array.isArray, () => [], "error");
  structure("masters", Array.isArray, () => []);
  structure("assets", (v) => v === undefined || Array.isArray(v), () => []);
  structure("stories", (v) => v === undefined || isObj(v), () => ({}));
  structure("styles", (v) => v === undefined || (isObj(v) && (v.paragraph === undefined || isObj(v.paragraph)) && (v.character === undefined || isObj(v.character))), () => ({ paragraph: {}, character: {} }));
  structure("swatches", (v) => v === undefined || Array.isArray(v), () => []);
  structure("settings", (v) => v === undefined || isObj(v), () => ({}));
  structure("comments", (v) => v === undefined || Array.isArray(v), () => []);

  const pages = Array.isArray(json.pages) ? json.pages : [];
  const masters = Array.isArray(json.masters) ? json.masters : [];
  const stories = isObj(json.stories) ? json.stories : {};
  const styles = isObj(json.styles) ? json.styles : {};

  const blankRoot = () => ({ id: uid("n"), type: "group", name: "Root", visible: true, locked: false, opacity: 1, blend: "normal", m: [1, 0, 0, 1, 0, 0], fx: [], children: [] });
  // pages that are not objects
  for (const list of [pages, masters]) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (isObj(list[i])) continue;
      const f = add("page-invalid", "error", N_("A page entry is unreadable."), {}, "drop-invalid");
      if (fixNow(f)) list.splice(i, 1), (st.jsonDirty = true);
    }
  }
  if (Array.isArray(json.pages) && !pages.length && !json.office && !json.web) {
    const f = add("no-pages", "error", N_("The document has no pages."), {}, "structure");
    if (fixNow(f)) pages.push({ id: uid("p"), name: "Page 1", x: 0, y: 0, w: 1920, h: 1080, bg: "#ffffff", root: blankRoot(), masterId: null, margins: { top: 0, right: 0, bottom: 0, left: 0 }, columns: 1, gutter: 12, bleed: 0, guides: { h: [], v: [] } }), (st.jsonDirty = true);
  }

  // --- pages, masters and layer trees
  const ids = new Map(); // id -> count (pages and nodes share no namespace in the app, but duplicates within each matter)
  const pageIds = new Set();
  const masterIds = new Set(masters.filter(isObj).map((m) => m.id));
  const used = { assets: new Set(), pixels: new Set(), stories: new Set() };
  const brokenImages = [];
  const typeCount = {};
  let layerTotal = 0;
  const fonts = new Set();

  const fixValue = (node, key, value, where) => {
    const f = add("bad-value", "warning", N_("“{field}” of {where} is not a valid number."), { field: key, where }, "values", where);
    if (fixNow(f)) (node[key] = value), (st.jsonDirty = true);
  };
  const checkNode = (node, parent, index, depth, where, seen) => {
    if (!isObj(node) || typeof node.type !== "string" || !node.type) {
      const f = add("node-invalid", "warning", N_("An unreadable layer was found in {where}."), { where }, "drop-invalid", where);
      if (fixNow(f) && parent) parent.children.splice(index, 1), (st.jsonDirty = true);
      return f.fixed ? "removed" : null;
    }
    if (seen.has(node)) return null; // shared object (in-memory input); JSON input cannot loop
    seen.add(node);
    if (depth > MAX_DEPTH) {
      const f = add("too-deep", "error", N_("Layers in {where} are nested more than {max} levels deep."), { where, max: MAX_DEPTH }, "drop-deep", where);
      if (fixNow(f) && parent) parent.children.splice(index, 1), (st.jsonDirty = true);
      return f.fixed ? "removed" : null;
    }
    const label = node.name ? `“${String(node.name).slice(0, 40)}”` : node.type;
    if (typeof node.id !== "string" || !node.id) {
      const f = add("node-id", "warning", N_("The layer {layer} has no id."), { layer: label }, "ids", where);
      if (fixNow(f)) (node.id = uid("n")), (st.jsonDirty = true);
    } else if (ids.has(node.id)) {
      const f = add("duplicate-id", "warning", N_("Two layers share the id “{id}”; edits to one could change the other."), { id: node.id.slice(0, 40) }, "ids", where);
      if (fixNow(f)) (node.id = uid("n")), (st.jsonDirty = true);
    }
    ids.set(node.id, (ids.get(node.id) || 0) + 1);
    if (depth > 0) {
      typeCount[node.type] = (typeCount[node.type] || 0) + 1;
      layerTotal++;
    }
    // numbers
    if (node.m !== undefined && !(Array.isArray(node.m) && node.m.length === 6 && node.m.every(finite))) {
      const I = [1, 0, 0, 1, 0, 0];
      fixValue(node, "m", Array.isArray(node.m) && node.m.length === 6 ? node.m.map((v, i) => (finite(v) ? v : I[i])) : I, label);
    }
    for (const k of ["w", "h"]) {
      const v = node[k];
      if (v === undefined || (v === null && node.type === "text")) continue;
      if (!finite(v)) fixValue(node, k, node.type === "text" ? null : 100, label);
      else if (v < 0) {
        const f = add("negative-size", "warning", N_("The layer {layer} has a negative size."), { layer: label }, "values", where);
        if (fixNow(f)) (node[k] = Math.abs(v)), (st.jsonDirty = true);
      }
    }
    if (node.opacity !== undefined && !(finite(node.opacity) && node.opacity >= 0 && node.opacity <= 1)) fixValue(node, "opacity", finite(node.opacity) ? Math.min(1, Math.max(0, node.opacity)) : 1, label);
    if (node.children !== undefined && !Array.isArray(node.children)) fixValue(node, "children", [], label);
    // references
    if (node.type === "text") {
      if (node.storyId != null) {
        used.stories.add(node.storyId);
        if (!isObj(stories[node.storyId])) {
          const f = add("missing-story", "warning", N_("The text layer {layer} refers to a text story that is missing."), { layer: label }, "stories", where);
          if (fixNow(f)) (stories[node.storyId] = { paragraphs: [{ runs: [] }] }), (json.stories = stories), (st.jsonDirty = true);
        }
      }
    }
    if (node.type === "image") {
      used.assets.add(node.assetId);
      if (!(json.assets || []).some((a) => isObj(a) && a.id === node.assetId)) brokenImages.push({ node, parent, index, where, label });
    }
    if (node.type === "pixel") used.pixels.add(node.id);
    if (typeof node.fontFamily === "string") fonts.add(node.fontFamily);
    // children (backwards so removals keep indexes valid) and the mask
    if (Array.isArray(node.children)) for (let i = node.children.length - 1; i >= 0; i--) checkNode(node.children[i], node, i, depth + 1, where, seen);
    if (node.mask !== undefined && node.mask !== null) {
      if (!isObj(node.mask) || typeof node.mask.type !== "string") {
        const f = add("node-invalid", "warning", N_("An unreadable layer was found in {where}."), { where }, "drop-invalid", where);
        if (fixNow(f)) (node.mask = null), (st.jsonDirty = true);
      } else {
        const holder = { children: [node.mask] };
        checkNode(node.mask, holder, 0, depth + 1, where, seen);
        if (!holder.children.length) (node.mask = null), (st.jsonDirty = true);
      }
    }
    return null;
  };

  const seen = new WeakSet();
  const pageList = [...pages.map((p, i) => [p, `page ${i + 1}`, false]), ...masters.map((p, i) => [p, `master ${i + 1}`, true])];
  for (const [p, where] of pageList) {
    if (!isObj(p)) continue;
    if (typeof p.id !== "string" || !p.id || pageIds.has(p.id)) {
      const f = add("page-id", "warning", N_("A page in {where} has a missing or duplicate id."), { where }, "ids", where);
      if (fixNow(f)) (p.id = uid("p")), (st.jsonDirty = true);
    }
    pageIds.add(p.id);
    // fields every page has since 0.5 (core/doc.js ▸ makePage); views read them without checks
    const PAGE_DEFAULTS = { name: () => "Page", x: () => 0, y: () => 0, margins: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), columns: () => 1, gutter: () => 12, bleed: () => 0, guides: () => ({ h: [], v: [] }) };
    const missing = Object.keys(PAGE_DEFAULTS).filter((k) => (k === "name" ? typeof p[k] !== "string" : k === "margins" || k === "guides" ? !isObj(p[k]) || (k === "guides" && !(Array.isArray(p.guides.h) && Array.isArray(p.guides.v))) : !finite(p[k])));
    if (missing.length) {
      const f = add("page-fields", "warning", N_("{where} is missing page settings ({fields})."), { where, fields: missing.join(", ") }, "structure", where);
      if (fixNow(f)) {
        for (const k of missing) p[k] = PAGE_DEFAULTS[k]();
        st.jsonDirty = true;
      }
    }
    for (const k of ["w", "h"]) {
      if (!(finite(p[k]) && p[k] > 0)) {
        const f = add("page-size", "error", N_("The size of {where} is invalid ({value})."), { where, value: String(p[k]) }, "values", where);
        if (fixNow(f)) (p[k] = finite(p[k]) && p[k] !== 0 ? Math.abs(p[k]) : k === "w" ? 1920 : 1080), (st.jsonDirty = true);
      }
    }
    if (p.masterId != null && !masterIds.has(p.masterId)) {
      const f = add("master-ref", "warning", N_("{where} uses a master page that does not exist."), { where }, "refs", where);
      if (fixNow(f)) (p.masterId = null), (st.jsonDirty = true);
    }
    if (!isObj(p.root) || p.root.type !== "group") {
      const f = add("page-root", "error", N_("The layer tree of {where} is missing."), { where }, "structure", where);
      if (fixNow(f)) (p.root = blankRoot()), (st.jsonDirty = true);
      else continue;
    }
    checkNode(p.root, null, 0, 0, where, seen);
  }
  for (const b of brokenImages) {
    const f = add("dangling-asset", "error", N_("The image layer {layer} refers to a picture that is not in the file."), { layer: b.label }, "drop-broken-images", b.where);
    if (fixNow(f) && b.parent) {
      const i = b.parent.children.indexOf(b.node);
      if (i >= 0) b.parent.children.splice(i, 1), (st.jsonDirty = true);
    }
  }

  // --- stories and styles
  const pStyles = isObj(styles.paragraph) ? styles.paragraph : {};
  const cStyles = isObj(styles.character) ? styles.character : {};
  for (const [sid, story] of Object.entries(stories)) {
    if (!isObj(story) || !Array.isArray(story.paragraphs)) {
      const f = add("story-invalid", "warning", N_("A text story is unreadable; its text is lost."), {}, "stories");
      if (fixNow(f)) (stories[sid] = { paragraphs: [{ runs: [] }] }), (st.jsonDirty = true);
      continue;
    }
    for (const para of story.paragraphs) {
      if (!isObj(para)) continue;
      if (para.styleId != null && !pStyles[para.styleId]) {
        const f = add("style-ref", "warning", N_("Text uses the paragraph style “{style}”, which does not exist."), { style: String(para.styleId).slice(0, 40) }, "refs");
        if (fixNow(f)) delete para.styleId, (st.jsonDirty = true);
      }
      for (const run of Array.isArray(para.runs) ? para.runs : []) {
        if (!isObj(run)) continue;
        if (typeof run.text !== "string") {
          const f = add("bad-value", "warning", N_("“{field}” of {where} is not a valid number."), { field: "text", where: "a text story" }, "values");
          if (fixNow(f)) (run.text = ""), (st.jsonDirty = true);
        }
        if (run.styleId != null && !cStyles[run.styleId]) {
          const f = add("style-ref", "warning", N_("Text uses the character style “{style}”, which does not exist."), { style: String(run.styleId).slice(0, 40) }, "refs");
          if (fixNow(f)) delete run.styleId, (st.jsonDirty = true);
        }
        if (typeof run.attrs?.fontFamily === "string") fonts.add(run.attrs.fontFamily);
      }
      if (typeof para.attrs?.fontFamily === "string") fonts.add(para.attrs.fontFamily);
    }
  }
  for (const s of [...Object.values(pStyles), ...Object.values(cStyles)]) if (isObj(s) && typeof (s.attrs?.fontFamily ?? s.fontFamily) === "string") fonts.add(s.attrs?.fontFamily ?? s.fontFamily);

  // --- assets and stored parts
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const assetIds = new Set();
  const assetFile = (id) => st.order.find((k) => k.startsWith(`assets/${id}.`));
  for (let i = assets.length - 1; i >= 0; i--) {
    const a = assets[i];
    if (!isObj(a) || typeof a.id !== "string" || !a.id || assetIds.has(a.id)) {
      const f = add("asset-invalid", "warning", N_("An asset record is unreadable or duplicated."), {}, "drop-invalid");
      if (fixNow(f)) assets.splice(i, 1), (st.jsonDirty = true);
      continue;
    }
    assetIds.add(a.id);
    const file = assetFile(a.id);
    const referenced = used.assets.has(a.id);
    if (!file && !a.url) {
      if (referenced) add("asset-missing", "warning", N_("The picture “{asset}” has no stored bytes; it shows as an empty frame."), { asset: a.name || a.id });
      else {
        const f = add("asset-unused", "info", N_("The asset “{asset}” is not used by any layer and has no stored bytes."), { asset: a.name || a.id }, "prune-unused");
        if (fixNow(f)) assets.splice(i, 1), (st.jsonDirty = true);
      }
      continue;
    }
    if (file) {
      const b = E[file];
      const bad = imageMismatch(b, a.mime);
      if (bad) add("asset-corrupt", "warning", N_("The picture “{asset}” is damaged ({reason})."), { asset: a.name || a.id, reason: bad });
      if (b.length > LARGE_PART) add("asset-large", "info", N_("The picture “{asset}” is {size} MiB; large embedded files slow down saving, autosave and collaboration."), { asset: a.name || a.id, size: MiB(b.length) });
    }
    if (!referenced) {
      const f = add("asset-unused", "info", N_("The asset “{asset}” is not used by any layer ({size} MiB)."), { asset: a.name || a.id, size: file ? MiB(E[file].length) : 0 }, "prune-unused");
      if (fixNow(f)) {
        assets.splice(i, 1);
        assetIds.delete(a.id);
        if (file) delete E[file];
        st.jsonDirty = st.entriesDirty = true;
      }
    }
  }
  const orphan = (file) => {
    const f = add("orphan-file", "warning", N_("The stored file “{file}” is not used by anything in the document."), { file }, "prune-orphans");
    if (fixNow(f)) delete E[file], (st.entriesDirty = true);
  };
  const officeFiles = new Set();
  const office = isObj(json.office) ? json.office : null;
  if (office) for (const m of Object.values(isObj(office.media) ? office.media : {})) if (isObj(m) && typeof m.file === "string") officeFiles.add(m.file);
  const webFiles = new Set();
  const web = isObj(json.web) ? json.web : null;
  if (web && Array.isArray(web.files)) for (const f of web.files) if (isObj(f) && typeof f.path === "string") webFiles.add(`web/files/${f.path}`);
  const KNOWN_TOP = new Set(["mimetype", "document.json", "thumbnail.png"]);
  for (const file of [...st.order]) {
    if (!E[file]) continue;
    if (file.startsWith("assets/")) {
      const id = file.slice(7).replace(/\.[^.]*$/, "");
      if (!assetIds.has(id)) orphan(file);
    } else if (file.startsWith("pixels/")) {
      const id = file.slice(7).replace(/\.png$/, "");
      if (!used.pixels.has(id)) orphan(file);
      else {
        const bad = pngProblem(E[file]);
        if (bad) add("pixels-corrupt", "warning", N_("The pixels of a pixel layer are damaged ({reason}); the layer opens empty."), { reason: bad }, null, file);
        else if (E[file].length > LARGE_PART) add("asset-large", "info", N_("The picture “{asset}” is {size} MiB; large embedded files slow down saving, autosave and collaboration."), { asset: file, size: MiB(E[file].length) });
      }
    } else if (file.startsWith("office/")) {
      if (!officeFiles.has(file)) orphan(file);
    } else if (file.startsWith("web/files/")) {
      if (!webFiles.has(file)) orphan(file);
    } else if (file.startsWith("web/git/")) {
      /* repository history: opaque to the Doctor */
    } else if (!KNOWN_TOP.has(file)) add("unknown-entry", "info", N_("The part “{file}” is unknown to this version and is kept as it is."), { file });
  }
  for (const id of used.pixels) if (!E[`pixels/${id}.png`]) add("pixels-missing", "info", N_("A pixel layer has no stored pixels and opens empty."), {});

  // --- website project
  if (web) {
    if (!Array.isArray(web.files)) {
      const f = add("structure", "warning", N_("The document field “{field}” is missing or has the wrong type."), { field: "web.files" }, "structure");
      if (fixNow(f)) (web.files = []), (st.jsonDirty = true);
    } else {
      for (let i = web.files.length - 1; i >= 0; i--) {
        const wf = web.files[i];
        const path = isObj(wf) ? wf.path : null;
        if (typeof path !== "string" || !safeEntryName(path) || !E[`web/files/${path}`]) {
          const f = add("web-missing", "warning", N_("The website file “{file}” is listed but missing."), { file: String(path ?? "?").slice(0, 120) }, "web");
          if (fixNow(f)) web.files.splice(i, 1), (st.jsonDirty = true);
        }
      }
    }
  } else if (json.web !== undefined && json.web !== null) {
    const f = add("structure", "warning", N_("The document field “{field}” is missing or has the wrong type."), { field: "web" }, "structure");
    if (fixNow(f)) delete json.web, (st.jsonDirty = true);
  }

  // --- Office and Scene projects
  if (office) {
    const media = isObj(office.media) ? office.media : {};
    for (const [mid, m] of Object.entries(media)) {
      if (!isObj(m) || typeof m.file !== "string" || !safeEntryName(m.file) || !E[m.file]) {
        const f = add("office-media-missing", "warning", N_("The media file “{file}” is listed but missing."), { file: String(m?.name || m?.file || mid).slice(0, 120) }, "office");
        if (fixNow(f)) delete media[mid], (st.jsonDirty = true);
      } else if (E[m.file].length > LARGE_PART) add("asset-large", "info", N_("The picture “{asset}” is {size} MiB; large embedded files slow down saving, autosave and collaboration."), { asset: m.name || mid, size: MiB(E[m.file].length) });
    }
    if (office.kind === "scene") checkScene(office, { add, fixNow, st });
  } else if (json.office !== undefined && json.office !== null) {
    const f = add("structure", "warning", N_("The document field “{field}” is missing or has the wrong type."), { field: "office" }, "structure");
    if (fixNow(f)) delete json.office, (st.jsonDirty = true);
  }

  // --- thumbnail
  if (E["thumbnail.png"]) {
    const bad = pngProblem(E["thumbnail.png"]);
    if (bad) {
      const f = add("thumbnail", "warning", N_("The preview image is damaged ({reason})."), { reason: bad }, "thumbnail");
      if (fixNow(f)) delete E["thumbnail.png"], (st.entriesDirty = true);
    }
  } else add("thumbnail-missing", "info", N_("The file has no preview image; OpenFini adds one the next time it is saved."));
  if (djson.length > LARGE_PART) add("json-large", "info", N_("The document content is {size} MiB; opening and saving it is slow."), { size: MiB(djson.length) });

  // --- summary
  const totalBytes = st.order.reduce((s, k) => s + (E[k]?.length || 0), 0);
  report.info = {
    title: typeof json.name === "string" ? json.name : "",
    studio: typeof json.studio === "string" ? json.studio : "",
    kind: office ? (typeof office.kind === "string" ? office.kind : "document") : web ? "website" : json.studio || "design",
    format: rawV ?? null,
    formatKnown: FORMAT_VERSION,
    unit: json.unit || "",
    dpi: json.dpi ?? null,
    pages: pages.filter(isObj).map((p) => ({ name: String(p.name || ""), width: p.w, height: p.h })),
    masters: masters.length,
    layers: { total: layerTotal, byType: typeCount },
    stories: Object.keys(stories).length,
    fonts: [...fonts].sort(),
    assets: assets.filter(isObj).map((a) => ({ id: a.id, name: a.name || "", mime: a.mime || "", bytes: E[assetFile(a.id)]?.length || 0 })),
    pixelLayers: used.pixels.size,
    websiteFiles: web && Array.isArray(web.files) ? web.files.length : 0,
    officeMedia: office ? Object.keys(isObj(office.media) ? office.media : {}).length : 0,
    comments: Array.isArray(json.comments) ? json.comments.length : 0,
    thumbnail: !!E["thumbnail.png"],
    parts: st.order.filter((k) => E[k]).length,
    unpackedBytes: totalBytes,
  };
  return done();
}

/** Scene projects: compositions that contain themselves (directly or through others) and clips without a source. */
function checkScene(model, { add, fixNow, st }) {
  const comps = isObj(model.comps) ? model.comps : {};
  const media = isObj(model.media) ? model.media : {};
  const refsOf = (seq) => Object.values(isObj(seq?.clips) ? seq.clips : {}).filter((c) => isObj(c) && c.type === "comp").map((c) => c.comp);
  const reaches = (from, target) => {
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop();
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...refsOf(comps[id]));
    }
    return false;
  };
  for (const [seqId, seq] of [["main", model], ...Object.entries(comps)]) {
    const clips = isObj(seq?.clips) ? seq.clips : {};
    for (const [cid, c] of Object.entries(clips)) {
      if (!isObj(c)) continue;
      if (c.type === "comp") {
        if (!comps[c.comp]) {
          const f = add("scene-ref", "warning", N_("A clip uses a composition that does not exist."), {}, "scene-refs", seqId);
          if (fixNow(f)) delete clips[cid], (st.jsonDirty = true);
        } else if (seqId !== "main" && reaches(c.comp, seqId)) {
          const f = add("scene-cycle", "error", N_("The composition “{comp}” contains itself (directly or through other compositions)."), { comp: String(comps[seqId]?.name || seqId).slice(0, 60) }, "scene-cycle", seqId);
          if (fixNow(f)) delete clips[cid], (st.jsonDirty = true);
        }
      } else if (c.media != null && (c.type === "video" || c.type === "audio" || c.type === "image") && !media[c.media]) {
        const f = add("scene-ref", "warning", N_("A clip uses a media file that is not in the project."), {}, "scene-refs", seqId);
        if (fixNow(f)) delete clips[cid], (st.jsonDirty = true);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------- other files

const ZIP_EXTS = new Set(["docx", "docm", "dotx", "xlsx", "xlsm", "pptx", "odt", "ods", "odp", "ott", "ora", "kra", "sketch", "zip", "idml", "ofext", "vsix"]);
const JSON_EXTS = new Set(["json", "excalidraw", "tldraw"]);

function analyzeOther(bytes, name, { apply = () => false, limits = DOCTOR_LIMITS } = {}) {
  const findings = [];
  const applied = [];
  const add = (code, severity, message, params = {}, fixId = null) => {
    const f = { code, severity, message, params };
    if (fixId) f.fix = { id: fixId, label: FIXES[fixId].label, safe: FIXES[fixId].safe };
    findings.push(f);
    return f;
  };
  const ext = extOf(name);
  const report = { name, size: bytes?.length || 0, type: ext || "unknown", container: "ok", findings, info: { ext } };
  let out = null;
  if (!bytes?.length) add("empty", "error", N_("The file is empty (0 bytes)."));
  else if (ZIP_EXTS.has(ext) || looksLikeZip(bytes)) {
    report.type = ZIP_EXTS.has(ext) ? ext : "zip";
    const z = readZipStrict(bytes, limits);
    if (z.overLimit) add("limits", "error", N_("The file unpacks to more than OpenFini opens (2 GiB, 100,000 parts, 1 GiB per part). It may be damaged or hostile."));
    else if (!z.ok) {
      const scan = scanLocalHeaders(bytes, limits);
      report.container = scan.order.length ? "recovered" : "broken";
      if (!scan.order.length) add("zip-corrupt", "error", N_("The ZIP container is damaged and no part of it could be read."));
      else {
        const f = add("zip-corrupt", "error", N_("The ZIP container is damaged or truncated; {n, plural, one {# readable part was} other {# readable parts were}} recovered from it."), { n: scan.order.length }, "recover-entries");
        if (apply("recover-entries", f.fix)) {
          f.fixed = true;
          applied.push("recover-entries");
          const files = {};
          if (scan.entries.mimetype) files.mimetype = [scan.entries.mimetype, { level: 0 }];
          for (const k of scan.order) if (k !== "mimetype") files[k] = [scan.entries[k], { level: 6 }];
          out = { files };
        }
        if (scan.damaged.length) add("damaged-entries", "warning", N_("{n, plural, one {# part is} other {# parts are}} damaged and cannot be recovered: {list}"), { n: scan.damaged.length, list: scan.damaged.slice(0, 8).join(", ") });
      }
      report.info.parts = scan.order.length;
    } else report.info.parts = z.order.length;
    if (z.unsafe.length) add("unsafe-names", "warning", N_("{n, plural, one {# part has an unsafe name} other {# parts have unsafe names}} (absolute paths or \"..\"), ignored: {list}"), { n: z.unsafe.length, list: z.unsafe.slice(0, 5).join(", ") });
  } else if (JSON_EXTS.has(ext)) {
    try {
      JSON.parse(dec(bytes));
    } catch (e) {
      add("json-invalid", "error", N_("The file is not valid JSON ({reason})."), { reason: String(e?.message || "").slice(0, 120) });
    }
  } else if (ext === "png" || (bytes[0] === 0x89 && bytes[1] === 0x50)) {
    report.type = "png";
    const bad = pngProblem(bytes);
    if (bad) add("png-corrupt", "error", N_("The PNG image is damaged ({reason})."), { reason: bad });
    report.info.size = pngSize(bytes);
  } else if (ext === "jpg" || ext === "jpeg") {
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) add("jpeg-corrupt", "error", N_("The file is not a JPEG image."));
    else if (!(bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9)) add("jpeg-truncated", "warning", N_("The JPEG image is truncated; the bottom of the picture may be missing."));
  } else if (ext === "pdf") {
    const head = dec(bytes.subarray(0, 8));
    const tail = dec(bytes.subarray(Math.max(0, bytes.length - 1024)));
    if (!head.startsWith("%PDF-")) add("pdf-corrupt", "error", N_("The file is not a PDF."));
    else if (!tail.includes("%%EOF")) add("pdf-truncated", "warning", N_("The PDF has no end marker; it may be truncated."));
  } else if (["svg", "txt", "md", "markdown", "csv", "tsv", "html", "htm", "css", "js", "xml", "rtf"].includes(ext)) {
    try {
      const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (ext === "svg" && !/<svg[\s>]/i.test(s)) add("svg-invalid", "error", N_("The file contains no <svg> element."));
    } catch {
      add("not-utf8", "warning", N_("The text is not valid UTF-8; some characters may show incorrectly."));
    }
  } else add("not-checked", "info", N_("The Doctor has no checks for this file type; only its size was read."));
  sortFindings(findings);
  report.counts = countFindings(findings);
  report.ok = findings.every((f) => f.severity !== "error" || f.fixed);
  report.applied = applied;
  return { report, out };
}

// ------------------------------------------------------------------------------------------- public API

/** True when the name or bytes look like an .ofini project. */
export const isOfiniName = (name) => /\.ofini$/i.test(String(name || ""));

/**
 * Checks a file. Never throws for bad input.
 * @param {Uint8Array} bytes
 * @param {{ name?: string, limits?: object }} [o]
 * @returns {{ name, size, type, container: "ok"|"recovered"|"broken", ok: boolean, findings: object[], counts: object, info: object|null }}
 */
export function diagnoseFile(bytes, { name = "document.ofini", limits = DOCTOR_LIMITS } = {}) {
  const ofini = isOfiniName(name) || (looksLikeZip(bytes) && !ZIP_EXTS.has(extOf(name)) && hasOfiniMarker(bytes));
  if (!ofini) return analyzeOther(bytes, name, { limits }).report;
  return analyze(bytes, { name, limits }).report;
}

function hasOfiniMarker(bytes) {
  // "mimetype" stored first with the OpenFini type, or a document.json name anywhere in the first 64 KiB
  const head = dec(bytes.subarray(0, Math.min(bytes.length, 65536)));
  return head.includes(OFINI_MIME) || head.includes("document.json");
}

/**
 * Selects fixes: "safe" (default), "all", or a list of fix ids.
 * @param {"safe"|"all"|string[]} mode
 */
export function fixSelector(mode = "safe") {
  if (Array.isArray(mode)) {
    const set = new Set(mode);
    return (id) => set.has(id);
  }
  if (mode === "all") return () => true;
  return (id, fix) => !!fix?.safe;
}

/**
 * Repairs a file. Returns the repaired bytes (null when nothing was changed), the fixes applied, the report before
 * the repair (with `fixed` flags) and the report of the repaired file.
 * @param {Uint8Array} bytes
 * @param {{ name?: string, fixes?: "safe"|"all"|string[], limits?: object }} [o]
 */
export function repairFile(bytes, { name = "document.ofini", fixes = "safe", limits = DOCTOR_LIMITS } = {}) {
  const apply = fixSelector(fixes);
  const ofini = isOfiniName(name) || (looksLikeZip(bytes) && !ZIP_EXTS.has(extOf(name)) && hasOfiniMarker(bytes));
  if (!ofini) {
    const { report, out } = analyzeOther(bytes, name, { apply, limits });
    if (!out) return { bytes: null, applied: [], before: report, after: report };
    const repaired = zipSync(out.files);
    return { bytes: repaired, applied: report.applied, before: report, after: analyzeOther(repaired, name, { limits }).report };
  }
  const { report, state } = analyze(bytes, { name, limits, apply });
  if (!report.applied.length || (!state.jsonDirty && !state.entriesDirty)) return { bytes: null, applied: [], before: report, after: report };
  const entries = {};
  for (const k of state.order) if (state.entries[k] && k !== "mimetype") entries[k] = state.entries[k];
  if (state.json && state.jsonDirty) entries["document.json"] = enc(JSON.stringify(state.json));
  const repaired = writeOfiniZip(entries, OFINI_MIME);
  return { bytes: repaired, applied: report.applied, before: report, after: analyze(repaired, { name, limits }).report };
}

/** Plain-text report (English or translated), e.g. for "Copy report". Contains no file contents. */
export function reportText(report, { translate = null, title = "" } = {}) {
  const T = (s, p) => (translate ? translate(s, p) : formatMessage(s, p));
  const lines = [];
  if (title) lines.push(title);
  lines.push(`${report.name}: ${T(report.ok ? "no errors" : "errors found")} (${report.counts.error} ${T("errors")}, ${report.counts.warning} ${T("warnings")}, ${report.counts.info} ${T("notes")})`);
  for (const f of report.findings) lines.push(`  [${f.severity}] ${findingText(f, translate)}${f.fixed ? ` (${T("fixed")})` : f.fix ? ` (${T("fix")}: ${T(f.fix.label)})` : ""}`);
  return lines.join("\n");
}
