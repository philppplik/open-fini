// Live preview of local folders and files (lazy; see docs/code-studio.md "Local folders and Open in Browser").
//
// - Disk watcher: a project opened from a folder (desktop: by path; web: a File System Access directory handle) is
//   re-read when files change on disk (desktop: the preview_dir_stamps command; web: polling the handle). A changed
//   file replaces the project copy only when it has no unsaved edits, so the in-app preview reloads live.
// - Open in Browser: the desktop app serves the project through the local preview server (src-tauri/src/
//   preview_server.rs, loopback only unless the user opts in to LAN preview), with unsaved edits pushed as an
//   overlay and live reload. The web build opens the page in a new tab inside a sandboxed frame.
// - Preview File…: shows Markdown, SVG, images, PDF, JSON, CSV, text or HTML files that are not part of the project.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { buildPreview, diffStamps, isTextPath, mimeOf, renderMarkdown, standaloneKind, csvToHtml, jsonToHtml, rewriteRefs, fetchShim, validPort, buildDocumentPage, normalizePath } from "../../engine/web/index.js";
import { invokeNet, nativeNetAvailable, bytesToBase64 } from "../../platform/native-net.js";
import { localSources } from "../open-folder.js";
import { confirmDialog, openDialog } from "../dialogs.js";
import { toDataUrl } from "./preview.js";

const scriptUrl = (code) => `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
const SKIP = /(^|\/)(\.[^/]*|node_modules|target)(\/|$)/;

/** Walks a FileSystemDirectoryHandle: { path: File } (dot entries and node_modules skipped, at most `max` files). */
export async function walkHandle(dir, prefix = "", out = {}, max = 5000) {
  for await (const [name, handle] of dir.entries()) {
    if (Object.keys(out).length >= max) break;
    const path = prefix ? `${prefix}/${name}` : name;
    if (SKIP.test(path)) continue;
    if (handle.kind === "directory") await walkHandle(handle, path, out, max);
    else out[path] = await handle.getFile();
  }
  return out;
}

export class LocalPreview {
  constructor(ws) {
    this.ws = ws;
    this.app = ws.app;
    this.web = ws.web;
    this.source = null;
    this.synced = new Map(); // project path → text as last read from disk
    for (const p of this.web.paths) if (this.web.isText(p)) this.synced.set(p, this.web.text(p));
    this.stamps = null;
    this.prefix = null;
    this.busy = false;
    this.warned = new Set();
    this.server = null;
    this.pushTimer = 0;
    this.pending = new Set();
    this.attach(localSources.get(this.web));
    this.offText = this.web.on("text", ({ path }) => this.#queuePush(path));
    this.offTree = this.web.on("tree", ({ path, paths }) => (paths || [path]).forEach((p) => p && this.#queuePush(p)));
  }

  /** Starts watching the folder the project was opened from. */
  attach(source) {
    if (!source || this.source) return;
    this.source = source;
    this.timer = setInterval(() => this.tick(), source.kind === "path" ? 1500 : 2000);
    this.tick();
  }

  get diskPath() {
    return this.source?.kind === "path" ? this.source.path : null;
  }

  // ------------------------------------------------------------ disk watcher

  async #snapshot() {
    if (this.source.kind === "path") {
      const list = await invokeNet("preview_dir_stamps", { root: this.source.path });
      return { stamps: Object.fromEntries(list), files: null };
    }
    const files = await walkHandle(this.source.handle);
    return { stamps: Object.fromEntries(Object.entries(files).map(([p, f]) => [p, `${f.lastModified}:${f.size}`])), files };
  }

  /** Disk path → project path (a folder whose files all sat in one sub-folder was opened without that folder). */
  #toProject(rel) {
    if (this.prefix == null) return rel;
    return rel.startsWith(this.prefix) ? rel.slice(this.prefix.length) : null;
  }

  async #read(rel, files) {
    if (files) return new Uint8Array(await files[rel].arrayBuffer());
    const sep = this.source.path.includes("\\") ? "\\" : "/";
    const full = this.source.path.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
    return new Uint8Array(await window.__TAURI__.fs.readFile(full));
  }

  async tick() {
    if (this.busy || document.hidden || !this.source) return;
    this.busy = true;
    try {
      const { stamps, files } = await this.#snapshot();
      if (!this.stamps) {
        this.stamps = stamps;
        const first = Object.keys(stamps).find((p) => !this.web.has(p));
        const known = Object.keys(stamps).some((p) => this.web.has(p));
        this.prefix = !known && first?.includes("/") ? `${first.split("/")[0]}/` : "";
        return;
      }
      const { changed, added, removed } = diffStamps(this.stamps, stamps);
      this.stamps = stamps;
      let n = 0;
      for (const rel of [...changed, ...added]) {
        const path = this.#toProject(rel);
        if (!path || !normalizePath(path)) continue;
        const bytes = await this.#read(rel, files);
        const text = isTextPath(path) ? new TextDecoder().decode(bytes) : null;
        if (this.web.has(path) && text != null && this.web.text(path) !== this.synced.get(path)) {
          if (!this.warned.has(path)) this.app.toast(t("“{path}” changed on disk. Your unsaved edits were kept.", { path }), "warning", 5000);
          this.warned.add(path);
          continue;
        }
        if (text != null && this.web.has(path)) this.web.setText(path, text, "disk");
        else this.web.put(path, bytes);
        if (text != null) this.synced.set(path, text);
        n++;
      }
      for (const rel of removed) {
        const path = this.#toProject(rel);
        if (path && this.web.has(path) && (!this.web.isText(path) || this.web.text(path) === this.synced.get(path))) this.web.remove(path), n++;
      }
      if (n) this.app.toast(t("{n, plural, one {# file reloaded from disk} other {# files reloaded from disk}}", { n }), "neutral", 1500);
    } catch (err) {
      console.warn("OpenFini: disk watcher", err);
    } finally {
      this.busy = false;
    }
  }

  // ------------------------------------------------------------ local server (desktop)

  #queuePush(path) {
    if (!this.server) return;
    this.pending.add(path);
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.#push().catch((err) => console.warn("OpenFini: preview push", err)), 250);
  }

  /** Files the server must get from memory: everything without a disk folder, else only files with unsaved edits. */
  #overlayFor(paths) {
    const files = [];
    const remove = [];
    for (const p of paths) {
      if (!this.web.has(p)) {
        remove.push(p);
        continue;
      }
      const text = this.web.isText(p) ? this.web.text(p) : null;
      if (this.diskPath && text != null && text === this.synced.get(p)) remove.push(p);
      else if (this.diskPath && text == null) continue;
      else files.push({ path: p, data: bytesToBase64(text != null ? new TextEncoder().encode(text) : this.web.bytes(p)) });
    }
    return { files, remove };
  }

  async #push() {
    const paths = [...this.pending];
    this.pending.clear();
    if (paths.length) await invokeNet("preview_server_put", this.#overlayFor(paths));
  }

  async startServer() {
    const prefs = this.app.prefs;
    if (prefs.codePreviewLan) {
      const ok = await confirmDialog({
        title: "Network preview",
        message: "LAN preview is on: every device in your network that knows the address can open this project while the preview runs. Only continue on a network you trust.",
        ok: "Allow network access",
        danger: true,
      });
      if (!ok) return null;
    }
    const status = await invokeNet("preview_server_start", { root: this.diskPath, port: validPort(prefs.codePreviewPort) || null, lan: !!prefs.codePreviewLan, spa: !!prefs.codePreviewSpa, entry: this.web.entry });
    this.server = status;
    await invokeNet("preview_server_put", { ...this.#overlayFor(this.web.paths), clear: true });
    return status;
  }

  /** The page currently shown in the in-app preview. */
  #page() {
    return this.ws.preview?.page || this.web.entry || "index.html";
  }

  async openInBrowser() {
    const page = this.#page();
    if (nativeNetAvailable()) {
      const st = await this.startServer();
      if (!st) return;
      const url = st.url + page.split("/").map(encodeURIComponent).join("/");
      const { platform } = await import("../../platform/index.js");
      await platform.openExternal(url);
      this.app.toast(st.lan ? t("Preview running at {url} (also reachable from your network).", { url }) : t("Preview running at {url}", { url }), "success", 5000);
      return url;
    }
    // web build: a new tab with the page in a sandboxed frame (it cannot reach OpenFini's storage)
    const res = buildPreview(this.web.source, page, { makeScriptUrl: (code) => scriptUrl(code), makeAssetUrl: toDataUrl, annotate: false });
    const table = {};
    for (const p of this.web.paths) if (/\.(json|txt|csv|md|xml|svg)$/i.test(p)) table[p] = toDataUrl(p, this.web.bytes(p), mimeOf(p));
    const shim = fetchShim(table, page).replace(/^<script>([\s\S]*)<\/script>$/, (m, code) => `<script src="${scriptUrl(code)}"></script>`);
    const html = res.html.replace(/<head([^>]*)>/i, (m) => m + shim);
    const wrapper = `<!doctype html><meta charset="utf-8"><title>${page.replace(/</g, "")}</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style><iframe sandbox="allow-scripts allow-forms allow-modals allow-popups" srcdoc="${html.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>`;
    const url = URL.createObjectURL(new Blob([wrapper], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return url;
  }

  async stopServer() {
    if (!this.server) return;
    this.server = null;
    await invokeNet("preview_server_stop").catch(() => {});
  }

  destroy() {
    clearInterval(this.timer);
    clearTimeout(this.pushTimer);
    this.offText?.();
    this.offTree?.();
    this.stopServer();
  }
}

// ------------------------------------------------------------ Preview File…

/** HTML for a standalone preview of one file (plus optional sibling files for an HTML page's assets). */
export function standaloneHtml(name, bytes, siblings = {}) {
  const kind = standaloneKind(name);
  const text = () => new TextDecoder().decode(bytes);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  switch (kind) {
    case "markdown":
      return buildDocumentPage({ html: renderMarkdown(text()).html, title: name });
    case "csv":
      return `<style>table{border-collapse:collapse;font:13px system-ui}td,th{border:1px solid #ccc;padding:2px 6px}</style>${csvToHtml(text(), name)}`;
    case "json":
      return jsonToHtml(text());
    case "text":
      return `<pre>${esc(text())}</pre>`;
    case "html": {
      const urlFor = (p) => (siblings[p] ? toDataUrl(p, siblings[p], mimeOf(p)) : null);
      return rewriteRefs(text(), name, urlFor);
    }
    default:
      return null;
  }
}

/** File ▸ Preview File…: pick one file (HTML: also pick its images and stylesheets) and show it in a dialog. */
export async function previewFileDialog(app) {
  const { pickFiles } = await import("./import.js");
  const picked = await pickFiles({ multiple: true });
  if (!picked.length) return;
  const main = picked.find((f) => standaloneKind(f.name) === "html") || picked[0];
  const kind = standaloneKind(main.name);
  if (!kind) return app.toast(t("OpenFini cannot preview “{name}”.", { name: main.name }), "warning");
  const bytes = new Uint8Array(await main.arrayBuffer());
  let body;
  if (kind === "image" || kind === "svg" || kind === "pdf") {
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(main.name) }));
    body = kind === "pdf" ? h("iframe.of-filepreview__frame", { src: url, title: main.name }) : h("img.of-filepreview__img", { src: url, alt: main.name });
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60000);
  } else {
    const siblings = {};
    for (const f of picked) if (f !== main) siblings[normalizePath(f.name)] = new Uint8Array(await f.arrayBuffer());
    const html = standaloneHtml(main.name, bytes, siblings);
    const sandbox = kind === "html" ? "allow-scripts" : "";
    body = h("iframe.of-filepreview__frame", { sandbox, srcdoc: `<!doctype html><meta charset="utf-8">${html}`, title: main.name });
  }
  body.style.cssText = "width:100%;height:65vh;border:0;object-fit:contain;background:#fff";
  openDialog({ title: t("Preview: {name}", { name: main.name }), body, width: 900, buttons: [{ label: "Close", variant: "primary", onClick: (close) => close() }] });
}
