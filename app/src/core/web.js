// Website project model of the Code studio: a flat map of files that lives inside an .ofini document
// (stored as web/files/<path> in the archive). The editor, the preview and the visual tools all read and write
// through this class, so there is exactly one source of truth.
import { Emitter, debounce } from "./util.js";
import { strToU8, strFromU8 } from "../../vendor/fflate/fflate.js";
import { normalizePath, mimeOf, isTextPath, uniquePath, dirname, basename } from "../engine/web/paths.js";

export const DEFAULT_WEB_SETTINGS = () => ({
  breakpoint: "desktop", // desktop | desktop-xl | desktop-2xl | tablet | mobile-landscape | mobile-portrait
  view: "split", // design | split | code
  zoom: "fit", // "fit" or a number
  page: null, // HTML file shown in the preview (null = entry)
  openFiles: [],
  activeFile: null,
  siteUrl: "",
  wordWrap: false,
  tabSize: 2,
});

const NEW_HTML = (title) => `<!doctype html>
<html lang="en-US">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body>
  </body>
</html>
`;

/** Starter content for a new file, by extension. */
export function starterContent(path) {
  const ext = path.split(".").pop().toLowerCase();
  if (ext === "html" || ext === "htm") return NEW_HTML(basename(path, `.${ext}`).replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
  if (ext === "json") return "{}\n";
  if (ext === "svg") return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">\n</svg>\n`;
  return "";
}

export class WebProject extends Emitter {
  /** @param {{entry?: string, settings?: object}} [opts] */
  constructor(opts = {}) {
    super();
    this.entry = opts.entry || "index.html";
    /** @type {Map<string, {path: string, mime: string, text?: string, bytes?: Uint8Array}>} */
    this.files = new Map();
    this.settings = { ...DEFAULT_WEB_SETTINGS(), ...(opts.settings || {}) };
    this.rev = 0;
    /** The `.git` folder of the project (Source Control): Map<path under .git, bytes>, or null without a repository. Stored as web/git/<path> in the archive. */
    this.gitFiles = null;
    this.onDirty = null; // set by ensureWeb: marks the owning document as modified
    this._dirtySoon = debounce(() => this.onDirty?.(), 400);
    const self = this;
    /** Read access for the pure web engine (preview, site export). */
    this.source = {
      list: () => [...self.files.keys()],
      readText: (p) => self.files.get(normalizePath(p))?.text ?? null,
      readBytes: (p) => self.bytes(p),
    };
  }

  // ------------------------------------------------------------ reading

  get paths() {
    return [...this.files.keys()].sort(comparePaths);
  }
  has(path) {
    return this.files.has(normalizePath(path));
  }
  get(path) {
    return this.files.get(normalizePath(path)) || null;
  }
  isText(path) {
    return typeof this.get(path)?.text === "string";
  }
  text(path) {
    return this.get(path)?.text ?? null;
  }
  bytes(path) {
    const f = this.get(path);
    if (!f) return null;
    return f.bytes ?? (typeof f.text === "string" ? strToU8(f.text) : null);
  }
  /** HTML files (the project's pages), entry first. */
  pages() {
    const list = this.paths.filter((p) => /\.html?$/i.test(p));
    const i = list.indexOf(this.entry);
    if (i > 0) list.unshift(...list.splice(i, 1));
    return list;
  }
  totalBytes() {
    let n = 0;
    for (const f of this.files.values()) n += f.bytes ? f.bytes.length : f.text.length;
    return n;
  }

  // ------------------------------------------------------------ writing

  #touch(kind, detail) {
    this.rev++;
    this.emit(kind, detail);
    this.emit("change", { kind, ...detail });
    this._dirtySoon();
  }

  /** Replaces the text of a file. `origin` is "editor", "visual" or "api" (listeners may ignore their own writes). */
  setText(path, text, origin = "api") {
    const f = this.get(path);
    if (!f || typeof f.text !== "string") throw new Error(`“${path}” is not a text file.`);
    if (f.text === text) return false;
    f.text = text;
    this.#touch("text", { path: f.path, origin });
    return true;
  }

  /** Adds a text file (string) or binary file (Uint8Array). Throws when the path exists. */
  create(path, content = starterContent(path), { mime } = {}) {
    path = normalizePath(path);
    if (!path) throw new Error("Enter a file name.");
    if (this.files.has(path) || [...this.files.keys()].some((p) => p.startsWith(`${path}/`))) throw new Error(`“${path}” already exists.`);
    if ([...this.files.keys()].some((p) => path.startsWith(`${p}/`))) throw new Error(`“${path}” is inside a file.`);
    const m = mime || mimeOf(path);
    const f = typeof content === "string" && isTextPath(path) ? { path, mime: m, text: content } : { path, mime: m, bytes: typeof content === "string" ? strToU8(content) : content };
    this.files.set(path, f);
    this.#touch("tree", { kind: "add", path });
    return f;
  }

  /** Adds or replaces a file (used by uploads and drops). Text files are decoded as UTF-8. */
  put(path, bytes, { mime } = {}) {
    path = normalizePath(path);
    const ex = this.files.get(path);
    if (ex) {
      if (typeof ex.text === "string") this.setText(path, strFromU8(bytes), "api");
      else {
        ex.bytes = bytes;
        this.#touch("tree", { kind: "replace", path });
      }
      return ex;
    }
    return this.create(path, isTextPath(path) ? strFromU8(bytes) : bytes, { mime });
  }

  /** Picks a free path next to `path` (a-2.css …) and adds the file. */
  createUnique(path, content, opts) {
    return this.create(uniquePath(normalizePath(path), this.files.keys()), content, opts);
  }

  /** Removes a file or a whole folder. Returns the removed paths. */
  remove(path) {
    path = normalizePath(path);
    const gone = [...this.files.keys()].filter((p) => p === path || p.startsWith(`${path}/`));
    for (const p of gone) this.files.delete(p);
    if (gone.length) {
      if (gone.includes(this.entry)) this.entry = this.pages()[0] || "index.html";
      this.#touch("tree", { kind: "remove", path, paths: gone });
    }
    return gone;
  }

  /** Renames or moves a file or folder. Returns the [from, to] pairs. */
  rename(from, to) {
    from = normalizePath(from);
    to = normalizePath(to);
    if (!to || from === to) return [];
    const moving = [...this.files.keys()].filter((p) => p === from || p.startsWith(`${from}/`));
    if (!moving.length) throw new Error(`“${from}” does not exist.`);
    if (to.startsWith(`${from}/`)) throw new Error("A folder cannot be moved into itself.");
    const pairs = moving.map((p) => [p, to + p.slice(from.length)]);
    for (const [, t] of pairs) if (this.files.has(t) && !moving.includes(t)) throw new Error(`“${t}” already exists.`);
    const entries = pairs.map(([p, t]) => {
      const f = this.files.get(p);
      return [p, { ...f, path: t, mime: mimeOf(t) === "application/octet-stream" ? f.mime : mimeOf(t) }];
    });
    for (const [p] of entries) this.files.delete(p);
    for (const [p, f] of entries) {
      this.files.set(f.path, f);
      if (p === this.entry) this.entry = f.path;
    }
    this.#touch("tree", { kind: "rename", from, to, pairs });
    return pairs;
  }

  duplicate(path) {
    const f = this.get(path);
    if (!f) throw new Error(`“${path}” does not exist.`);
    const dir = dirname(f.path);
    const base = basename(f.path);
    const dot = base.lastIndexOf(".");
    const name = dot > 0 ? `${base.slice(0, dot)}-copy${base.slice(dot)}` : `${base}-copy`;
    return this.createUnique(dir ? `${dir}/${name}` : name, f.text ?? f.bytes.slice(), { mime: f.mime });
  }

  setEntry(path) {
    if (!this.has(path)) return;
    this.entry = normalizePath(path);
    this.#touch("tree", { kind: "entry", path: this.entry });
  }

  // ------------------------------------------------------------ tree view

  /** Nested tree, folders first: [{ name, path, type: "dir"|"file", children? }] */
  tree() {
    const root = { name: "", path: "", type: "dir", children: [] };
    const dirs = new Map([["", root]]);
    const ensureDir = (p) => {
      if (dirs.has(p)) return dirs.get(p);
      const parent = ensureDir(dirname(p));
      const d = { name: basename(p), path: p, type: "dir", children: [] };
      parent.children.push(d);
      dirs.set(p, d);
      return d;
    };
    for (const p of this.paths) ensureDir(dirname(p)).children.push({ name: basename(p), path: p, type: "file" });
    const sort = (n) => {
      n.children?.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, "en-US", { numeric: true }) : a.type === "dir" ? -1 : 1));
      n.children?.forEach(sort);
    };
    sort(root);
    return root.children;
  }
  /** Folder paths that exist implicitly (including empty ones created through `folders`). */
  folders() {
    const set = new Set(this.extraFolders || []);
    for (const p of this.files.keys()) for (let d = dirname(p); d; d = dirname(d)) set.add(d);
    return [...set].sort();
  }

  // ------------------------------------------------------------ persistence

  /** JSON part stored in document.json (file contents are separate archive entries). */
  manifest() {
    const { openFiles, activeFile, ...rest } = this.settings;
    return {
      entry: this.entry,
      files: this.paths.map((p) => {
        const f = this.files.get(p);
        return { path: p, mime: f.mime, binary: typeof f.text !== "string" };
      }),
      settings: { ...rest, openFiles: openFiles.filter((p) => this.files.has(p)), activeFile: this.files.has(activeFile) ? activeFile : null },
    };
  }
  /** Archive entries: { "web/files/<path>": Uint8Array } */
  entries() {
    const out = {};
    for (const [p, f] of this.files) out[`web/files/${p}`] = f.bytes ?? strToU8(f.text);
    return out;
  }

  /** Archive entries of the Git repository: { "web/git/<path>": Uint8Array } (already compressed objects). */
  gitEntries() {
    const out = {};
    if (this.gitFiles) for (const [p, b] of this.gitFiles) out[`web/git/${p}`] = b;
    return out;
  }

  static fromManifest(manifest, readFile) {
    const web = new WebProject({ entry: manifest?.entry, settings: manifest?.settings });
    for (const f of manifest?.files || []) {
      const bytes = readFile(f.path);
      if (!bytes) continue;
      web.files.set(f.path, f.binary ? { path: f.path, mime: f.mime, bytes } : { path: f.path, mime: f.mime, text: strFromU8(bytes) });
    }
    if (!web.files.has(web.entry)) web.entry = web.pages()[0] || web.entry;
    return web;
  }

  /** New project from a { path: text } map (templates). */
  static fromFiles(files, { entry = "index.html", settings } = {}) {
    const web = new WebProject({ entry, settings });
    for (const [path, content] of Object.entries(files)) {
      const p = normalizePath(path);
      web.files.set(p, typeof content === "string" ? { path: p, mime: mimeOf(p), text: content } : { path: p, mime: mimeOf(p), bytes: content });
    }
    if (!web.files.has(web.entry)) web.entry = web.pages()[0] || web.entry;
    return web;
  }
}

/** Gives a document a website project (and wires its dirty flag to the document). */
export function ensureWeb(doc, files = null, opts = {}) {
  if (!doc.web) doc.web = files ? WebProject.fromFiles(files, opts) : new WebProject(opts);
  attachWeb(doc);
  return doc.web;
}

export function attachWeb(doc) {
  if (!doc.web) return;
  doc.web.onDirty = () => {
    doc.saved = false;
    doc.modifiedAt = Date.now();
    doc.emit("change", { web: true });
  };
}

function comparePaths(a, b) {
  const da = a.includes("/");
  const db = b.includes("/");
  if (da !== db) return da ? -1 : 1;
  return a.localeCompare(b, "en-US", { numeric: true });
}
