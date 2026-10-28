// Office Suite app registry: the single list of Office apps (Document, and the Spreadsheet / Presentation /
// Whiteboard apps that register themselves the same way). Pure: no DOM, no app state; unit-tested in
// tests/office/suite.test.js. Contract and worked example: docs/office-suite.md.
//
// Two levels keep start-up small:
//   * a MANIFEST (plain data + one `load()` function) is registered eagerly by office/index.js when the suite first
//     loads (still lazy relative to app start-up): kind, label, icon, extensions, formats, templates, AI note;
//   * the IMPLEMENTATION (`load()` → module with `default` or `app` export) is imported only when a document of that
//     kind is opened, created or exported. It provides create/open/save/mount and the optional adapters.
//
// Public API
//   registerOfficeApp(manifest) → manifest          throws on an invalid or duplicate kind
//   officeApps() → manifest[]                        in launcher order (`order`, then registration order)
//   officeApp(kind) → manifest | null
//   appForFile(name) → { app, format } | null        by extension (content sniffing is the app's `sniff`)
//   loadOfficeApp(kind) → Promise<impl>              cached; the impl is validated once
//   loadedOfficeApp(kind) → impl | null              synchronous, only when already loaded
//   officeKindOf(doc) → "document" | "sheet" | "slides" | "board" | string   (doc.office.kind, default "document")
//   unregisterOfficeApp(kind)                        tests only
// Invariants: kinds are `[a-z][a-z0-9-]{1,23}`; an extension belongs to at most one app's `open` formats; a manifest
// is frozen after registration; nothing here touches the DOM, so engines and Vibe tools may import it.

/** Kinds the suite knows by name (others may register too; these get stable ids in files and docs). */
export const OFFICE_KINDS = Object.freeze(["document", "sheet", "slides", "board"]);
export const DEFAULT_KIND = "document";

const KIND_RE = /^[a-z][a-z0-9-]{1,23}$/;
const apps = new Map(); // kind → manifest
const impls = new Map(); // kind → Promise<impl>
const loaded = new Map(); // kind → impl
let seq = 0;

/**
 * @typedef {Object} OfficeFormat
 * @property {string} id        stable id ("docx", "xlsx", "csv" …)
 * @property {string} label     English label (translated with t() by the UI)
 * @property {string[]} ext     extensions without dot, lower case
 * @property {string} [mime]
 * @property {boolean} [read]   the app opens it
 * @property {boolean} [write]  the app saves / exports it
 * @property {boolean} [lossy]  saving loses something the model has (warned before "save in original format")
 * @property {boolean} [template]  opening it creates a new untitled document (".dotx", ".xltx", ".potx")
 *
 * @typedef {Object} OfficeTemplate
 * @property {string} id
 * @property {string} label
 * @property {string} [description]
 * @property {string} [icon]
 * @property {string} [category]  "Business", "Personal", "Education" …
 *
 * @typedef {Object} OfficeAppManifest
 * @property {string} kind
 * @property {string} label           "Document", "Spreadsheet" …
 * @property {string} icon            icon name of the app's icon set (`of` library or Bootstrap)
 * @property {string} [blurb]         one line for the launcher
 * @property {number} [order]         launcher order (document 10, sheet 20, slides 30, board 40)
 * @property {OfficeFormat[]} formats
 * @property {OfficeTemplate[]} [templates]
 * @property {string} [aiNote]        one paragraph appended to the Vibe system prompt when a document of this kind is active
 * @property {() => Promise<any>} load  dynamic import of the implementation
 */

/** Registers an Office app manifest. */
export function registerOfficeApp(m) {
  if (!m || typeof m !== "object") throw new TypeError("registerOfficeApp: manifest object expected");
  if (!KIND_RE.test(String(m.kind))) throw new Error(`registerOfficeApp: invalid kind "${m.kind}"`);
  if (apps.has(m.kind)) throw new Error(`registerOfficeApp: kind "${m.kind}" is already registered`);
  if (typeof m.label !== "string" || !m.label) throw new Error(`registerOfficeApp(${m.kind}): label required`);
  if (typeof m.load !== "function") throw new Error(`registerOfficeApp(${m.kind}): load() required (dynamic import of the implementation)`);
  const formats = (m.formats || []).map((f) => {
    if (!f?.id || !Array.isArray(f.ext) || !f.ext.length) throw new Error(`registerOfficeApp(${m.kind}): format needs id and ext[]`);
    return Object.freeze({ ...f, ext: Object.freeze(f.ext.map((e) => String(e).toLowerCase().replace(/^\./, ""))) });
  });
  for (const f of formats) {
    if (!f.read) continue;
    for (const e of f.ext) {
      const other = appForFile(`x.${e}`);
      if (other) throw new Error(`registerOfficeApp(${m.kind}): .${e} is already opened by the ${other.app.kind} app`);
    }
  }
  const manifest = Object.freeze({
    icon: "office",
    blurb: "",
    order: 100,
    templates: [],
    aiNote: "",
    ...m,
    formats: Object.freeze(formats),
    templates: Object.freeze((m.templates || []).map((t) => Object.freeze({ ...t }))),
    _seq: seq++,
  });
  apps.set(m.kind, manifest);
  return manifest;
}

export function unregisterOfficeApp(kind) {
  apps.delete(kind);
  impls.delete(kind);
  loaded.delete(kind);
}

export function officeApps() {
  return [...apps.values()].sort((a, b) => a.order - b.order || a._seq - b._seq);
}

export function officeApp(kind) {
  return apps.get(kind) || null;
}

const extOf = (name) => (/\.([^./\\]+)$/.exec(String(name || ""))?.[1] || "").toLowerCase();

/** The app and format that open a file name (by extension), or null. */
export function appForFile(name) {
  const ext = extOf(name);
  if (!ext) return null;
  for (const app of apps.values()) {
    const format = app.formats.find((f) => f.read && f.ext.includes(ext));
    if (format) return { app, format };
  }
  return null;
}

/** Every extension an Office app opens (for File ▸ Open filters and routing tests). */
export function officeOpenExtensions() {
  return officeApps().flatMap((a) => a.formats.filter((f) => f.read).flatMap((f) => f.ext));
}

const REQUIRED = ["create", "mount"];

/** Validates an implementation module against the contract; returns the impl object. */
export function checkImpl(kind, mod) {
  const impl = mod?.default || mod?.app || mod;
  for (const k of REQUIRED) if (typeof impl?.[k] !== "function") throw new Error(`Office app "${kind}": ${k}() missing`);
  for (const k of ["open", "save", "describe"]) if (impl[k] !== undefined && typeof impl[k] !== "function") throw new Error(`Office app "${kind}": ${k} must be a function`);
  if (impl.collabAdapter) for (const k of ["records", "applyRecords"]) if (typeof impl.collabAdapter[k] !== "function") throw new Error(`Office app "${kind}": collabAdapter.${k}() missing`);
  if (impl.aiAdapter && impl.aiAdapter.tools !== undefined && typeof impl.aiAdapter.tools !== "function") throw new Error(`Office app "${kind}": aiAdapter.tools must be (app) => Tool[]`);
  return impl;
}

/** Loads (once) and returns the implementation of an app. */
export function loadOfficeApp(kind) {
  const m = apps.get(kind);
  if (!m) return Promise.reject(new Error(`No Office app is registered for "${kind}".`));
  if (!impls.has(kind)) {
    const p = Promise.resolve()
      .then(() => m.load())
      .then((mod) => {
        const impl = checkImpl(kind, mod);
        loaded.set(kind, impl);
        return impl;
      });
    p.catch(() => impls.delete(kind)); // a failed chunk load may be retried
    impls.set(kind, p);
  }
  return impls.get(kind);
}

export function loadedOfficeApp(kind) {
  return loaded.get(kind) || null;
}

/** The Office kind of a document (null when it is not an Office document). */
export function officeKindOf(doc) {
  if (!doc?.office) return null;
  return doc.office.kind || DEFAULT_KIND;
}
