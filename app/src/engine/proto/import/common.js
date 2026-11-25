// Shared parts of the Proto importers (docs/concepts/proto-studio.md §10.4 and §11, task T8). Pure: no DOM, imports in
// plain Node (the CLI uses the same importers).
//
// Every importer turns its input into engine operations (ops.js) for a target model, so the editor, the assistant,
// the clipboard and `ofini proto import` apply an import as ONE undo step and the engine validates it:
//   { ops, roots, pages, report, size }
//     ops     [media.put…, page.create…, node.create…] with pre-assigned ids (redo and collaboration replay them)
//     roots   ids of the top-level layers it created (in front-to-back order of the source)
//     pages   ids of pages it created (Sketch and Penpot pages), [] when everything lands on the target page
//     report  an ImportReport (core/import-report.js): what was kept editable, flattened, dropped, notes
//     size    { w, h } of the imported content (for placing it)
//
// Limits: every input is checked against IMPORT_LIMITS before parsing (bytes), ZIP archives are inspected entry by
// entry before anything is inflated (zip bombs), and the builder stops at `maxNodes` layers.
import { unzipSync } from "../../../../vendor/fflate/fflate.js";
import { newId } from "../ids.js";
import { LIMITS, MEDIA_TYPES } from "../schema.js";
import { ImportReport } from "../../../core/import-report.js";
import { parseColor } from "../../web/code-hover.js";

export { ImportReport };

/** Input limits of the importers (bytes, layers, archive entries). */
export const IMPORT_LIMITS = Object.freeze({
  html: 8 * 1048576,
  svg: 16 * 1048576,
  archive: 256 * 1048576,
  entries: 20000,
  entry: 128 * 1048576,
  unpacked: 512 * 1048576,
  /** an archive may unpack to at most this many times its size (and more than `ratioFloor` bytes) */
  ratio: 200,
  ratioFloor: 64 * 1048576,
  json: 64 * 1048576,
  nodes: 50000,
  depth: 48,
});

export class ImportError extends Error {
  constructor(message, code = "import") {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}

const MiB = (n) => `${Math.round(n / 1048576)} MiB`;

/** Throws when `size` bytes of `kind` input exceed the limit. */
export function checkSize(size, kind, limits = IMPORT_LIMITS) {
  const max = limits[kind];
  if (max && size > max) throw new ImportError(`The ${kind.toUpperCase()} input is larger than ${MiB(max)}; it was not imported.`, "limit");
}

/**
 * Unzips an archive within the import limits. Sizes declared in the entry headers are checked before anything is
 * inflated (fflate allocates what a header declares), and the actual sizes after.
 * @param {Uint8Array} bytes
 * @param {{ want?: (name: string) => boolean, limits?: object }} [o]
 * @returns {Record<string, Uint8Array>}
 */
export function safeUnzip(bytes, { want = () => true, limits = IMPORT_LIMITS } = {}) {
  checkSize(bytes.length, "archive", limits);
  let count = 0;
  let total = 0;
  let refused = null;
  const filter = (f) => {
    if (++count > limits.entries) refused ||= `more than ${limits.entries} parts`;
    else if (f.originalSize > limits.entry) refused ||= `a part larger than ${MiB(limits.entry)}`;
    else if (/(^|\/)\.\.(\/|$)/.test(f.name) || f.name.startsWith("/")) return false;
    else if (!want(f.name)) return false;
    else {
      total += f.originalSize;
      if (total > limits.unpacked) refused ||= `more than ${MiB(limits.unpacked)} of data`;
      else if (total > limits.ratioFloor && total > bytes.length * limits.ratio) refused ||= "far more data than its size suggests";
    }
    return !refused;
  };
  let out;
  try {
    out = unzipSync(bytes, { filter });
  } catch (e) {
    if (refused) throw new ImportError(`The archive unpacks to ${refused}; it may be damaged or hostile.`, "limit");
    throw new ImportError(`The file is not a valid ZIP archive (${e.message}).`, "format");
  }
  if (refused) throw new ImportError(`The archive unpacks to ${refused}; it may be damaged or hostile.`, "limit");
  let actual = 0;
  for (const v of Object.values(out)) actual += v.length;
  if (actual > limits.unpacked) throw new ImportError(`The archive unpacks to more than ${MiB(limits.unpacked)} of data.`, "limit");
  return out;
}

/** Parses JSON from archive bytes (null when missing or invalid). */
export function jsonEntry(entries, name, limits = IMPORT_LIMITS) {
  const b = entries[name];
  if (!b) return null;
  if (b.length > limits.json) throw new ImportError(`${name} is larger than ${MiB(limits.json)}.`, "limit");
  try {
    return JSON.parse(new TextDecoder().decode(b));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ values

export const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export const finite = (v) => typeof v === "number" && Number.isFinite(v);
export const num = (v, d = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
/** Rounds to 1/100 px (stable files, no float noise). */
export const r2 = (v) => Math.round(num(v) * 100) / 100 || 0;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const h2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");

/** A CSS color (hex, rgb(a), hsl(a), a named color) → { hex: "#rrggbb", alpha } or null (none, transparent, invalid). */
export function cssColor(value) {
  const s = String(value ?? "").trim();
  if (!s || /^(none|transparent|currentcolor|inherit|initial)$/i.test(s)) return null;
  const c = parseColor(s);
  if (!c) return null;
  return { hex: `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`, alpha: clamp(c.a, 0, 1) };
}

/** A hex color for the schema: "#rrggbb", or "#rrggbbaa" when `alpha` < 1. */
export function hexA(hex, alpha = 1) {
  const a = clamp(num(alpha, 1), 0, 1);
  return a >= 0.999 ? hex.toLowerCase() : `${hex.toLowerCase()}${h2(a * 255)}`;
}

/** { r, g, b } 0..1 channels (Sketch, Penpot gradients) → "#rrggbb". */
export const hexOfUnit = (r, g, b) => `#${h2(r * 255)}${h2(g * 255)}${h2(b * 255)}`;

// ------------------------------------------------------------------------------------------------ media

/** The MIME type of image bytes from their signature (null for anything else). */
export function sniffImage(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && /^avi[fs]$/.test(String.fromCharCode(b[8], b[9], b[10], b[11]))) return "image/avif";
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 512))).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

/** Pixel size from the image header (PNG, JPEG, GIF, WebP); null when unknown. */
export function imageSize(b, mime = sniffImage(b)) {
  try {
    if (mime === "image/png" && b.length > 24) return { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
    if (mime === "image/gif" && b.length > 10) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1];
        const len = (b[i + 2] << 8) | b[i + 3];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
        i += 2 + len;
      }
    }
    if (mime === "image/webp" && b.length > 30) {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (kind === "VP8 ") return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
      if (kind === "VP8L") return { w: 1 + (b[21] | ((b[22] & 0x3f) << 8)), h: 1 + (((b[22] & 0xc0) >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) };
    }
  } catch {
    /* unknown */
  }
  return null;
}

/** Decodes base64 (standard or URL alphabet) without the DOM. */
export function fromBase64(s) {
  const clean = String(s).replace(/[\s]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The bytes of a data: URL ({ mime, bytes }), or null for anything else (remote URLs are never fetched). */
export function dataUrlBytes(url) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/is.exec(String(url || "").trim());
  if (!m) return null;
  try {
    const bytes = m[3] ? fromBase64(m[4]) : new TextEncoder().encode(decodeURIComponent(m[4]));
    return { mime: (m[1] || "").toLowerCase() || sniffImage(bytes) || "application/octet-stream", bytes };
  } catch {
    return null;
  }
}

function hashBytes(b) {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(b.length / 4096));
  for (let i = 0; i < b.length; i += step) h = Math.imul(h ^ b[i], 0x01000193) >>> 0;
  return `${b.length}:${h}`;
}

// ------------------------------------------------------------------------------------------------ builder

/**
 * Collects the operations of one import for `model`: ids that do not collide with the model (or with each other),
 * media items (deduplicated by content), pages and layer trees.
 * @param {object} model the target model
 * @param {{ random?: () => number, maxNodes?: number, report?: ImportReport }} [o]
 */
export function createBuilder(model, { random = Math.random, maxNodes = IMPORT_LIMITS.nodes, report = null } = {}) {
  const taken = new Set([...Object.keys(model?.nodes || {}), ...Object.keys(model?.pages || {}), ...Object.keys(model?.media || {}), ...Object.keys(model?.vars?.collections || {}), ...Object.keys(model?.vars?.items || {}), ...Object.keys(model?.styles || {})]);
  const mediaOps = [];
  const pageOps = [];
  const preOps = [];
  const nodeOps = [];
  const seenMedia = new Map();
  let nodes = 0;
  const b = {
    report,
    random,
    /** A fresh id; `preferred` (a valid, unused id from the source, such as data-proto-id) is kept when free. */
    id(prefix = "n", preferred = null) {
      if (preferred && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(preferred) && !taken.has(preferred)) {
        taken.add(preferred);
        return preferred;
      }
      const id = newId(prefix, taken, random);
      taken.add(id);
      return id;
    },
    /** Counts one layer; throws past the limit. */
    count() {
      if (++nodes > maxNodes) throw new ImportError(`The import has more than ${maxNodes} layers; it was not imported.`, "limit");
    },
    get nodes() {
      return nodes;
    },
    /** Adds an image (bytes) once; returns its media id, or null when it cannot be stored. */
    media({ bytes, mime, name = "", w, h }) {
      if (!(bytes instanceof Uint8Array) || !bytes.length) return null;
      mime = MEDIA_TYPES.includes(mime) ? mime : sniffImage(bytes);
      if (!MEDIA_TYPES.includes(mime)) return null;
      if (bytes.length > LIMITS.mediaBytes) {
        report?.dropped(`An image larger than ${MiB(LIMITS.mediaBytes)} was left out.`);
        return null;
      }
      const key = hashBytes(bytes);
      if (seenMedia.has(key)) return seenMedia.get(key);
      const size = finite(w) && finite(h) ? { w, h } : imageSize(bytes, mime);
      const id = b.id("m");
      seenMedia.set(key, id);
      mediaOps.push({ op: "media.put", id, media: { mime, name: String(name).slice(0, 200), ...(size && size.w > 0 && size.w <= 100000 && size.h <= 100000 ? { w: size.w, h: size.h } : {}), bytes } });
      return id;
    },
    page(name) {
      const id = b.id("p");
      pageOps.push({ op: "page.create", id, name: String(name || "Page").slice(0, 256) });
      return id;
    },
    /** A node.create operation for a layer tree (see spec()). */
    add(tree, { page = null, parent = null } = {}) {
      nodeOps.push({ op: "node.create", type: tree.type, id: tree.id, ...(parent ? { parent } : { page }), fields: tree.fields, ...(tree.children?.length ? { children: tree.children.map(strip) } : {}) });
      return tree.id;
    },
    /** An operation that runs before the layers are created (variables, collections). */
    op(o) {
      preOps.push(o);
    },
    ops: () => [...mediaOps, ...pageOps, ...preOps, ...nodeOps],
    nodeOps: () => nodeOps,
  };
  return b;
}

const strip = (t) => ({ type: t.type, id: t.id, fields: t.fields, ...(t.children?.length ? { children: t.children.map(strip) } : {}) });

/** A layer tree for builder.add: { type, id, fields, children }. */
export function spec(b, type, fields = {}, children = [], preferredId = null) {
  b.count();
  return { type, id: b.id("n", preferredId), fields, children };
}

/** Moves the top-level layers of an import's operations by (dx, dy) (they are created at the origin). */
export function offsetOps(ops, dx, dy) {
  if (!dx && !dy) return ops;
  return ops.map((o) => (o.op === "node.create" && !o.parent && o.fields ? { ...o, fields: { ...o.fields, x: r2(num(o.fields.x) + dx), y: r2(num(o.fields.y) + dy) } } : o));
}

/** Places the top-level layers of an import inside `parent` (as flow children when its layout is flex or grid). */
export function intoParent(ops, parent, flow = false) {
  return ops.map((o) => {
    if (o.op !== "node.create" || o.parent) return o;
    const { page, ...rest } = o;
    const fields = { ...o.fields };
    if (flow) {
      fields.pos = "flow";
      delete fields.x;
      delete fields.y;
    } else fields.pos = "abs";
    return { ...rest, parent, fields };
  });
}

/** Names: trimmed, single-line, at most 120 characters. */
export const cleanName = (s, fallback = "Layer") => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return (t.length > 120 ? `${t.slice(0, 119)}…` : t) || fallback;
};

/** Rotation of a 2D matrix [a, b, c, d, e, f] in degrees (clockwise on screen). */
export const matrixAngle = (m) => r2((Math.atan2(m[1], m[0]) * 180) / Math.PI);
