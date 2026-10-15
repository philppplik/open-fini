// "Website" tab of the export popup: publishes the Code studio project as a static site (ZIP, single-file pages or
// a folder on disk). The site builder (engine) is loaded only when the export runs.
import { h, formatBytes, downloadName } from "../core/util.js";
import { zipSync } from "../../vendor/fflate/fflate.js";
import { selectField, switchField } from "./controls.js";
import { platform } from "../platform/index.js";

const FORMATS = [
  { value: "zip", label: "ZIP archive — upload to any web host" },
  { value: "single", label: "Single-file pages — everything inlined" },
  { value: "folder", label: "Folder on this computer", needsPicker: true },
];

async function writeToFolder(files) {
  const root = await window.showDirectoryPicker({ mode: "readwrite" });
  for (const f of files) {
    const parts = f.path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(f.bytes);
    await w.close();
  }
  return root.name;
}

/** @returns an export-popup tab: { id, label, action, el, run } */
export function createWebsiteTab(app, web) {
  const st = { format: "zip", minify: true, sitemap: false, siteUrl: web.settings.siteUrl || "" };
  const canFolder = typeof window.showDirectoryPicker === "function";
  const info = h("div.of-hint");
  const warnings = h("div.of-exportwarn.hidden");
  const fmt = selectField({ label: "Format", value: st.format, options: FORMATS.filter((f) => !f.needsPicker || canFolder), onChange: (v) => (st.format = v) });
  const minify = switchField({ label: "Minify HTML and CSS", value: st.minify, onChange: (v) => (st.minify = v) });
  const urlInput = h("sl-input", { size: "small", label: "Site address", placeholder: "https://example.com", value: st.siteUrl, class: "hidden", "help-text": "Used for sitemap.xml and robots.txt." });
  urlInput.addEventListener("sl-input", () => {
    st.siteUrl = urlInput.value.trim();
    web.settings.siteUrl = st.siteUrl;
  });
  const sitemap = switchField({ label: "Generate sitemap.xml and robots.txt", value: st.sitemap, onChange: (v) => {
    st.sitemap = v;
    urlInput.classList.toggle("hidden", !v);
  } });
  const el = h("div.of-form", info, fmt.el, minify.el, sitemap.el, urlInput, warnings);

  const pages = web.pages().length;
  info.textContent = `${pages} page${pages === 1 ? "" : "s"} · ${web.files.size} file${web.files.size === 1 ? "" : "s"} · ${formatBytes(web.totalBytes())}. The exported site contains only your project files — no editor code.`;

  async function run() {
    const { buildSite } = await import("../engine/web/index.js");
    app.status("Building site…");
    try {
      if (web.flush) web.flush();
      const site = buildSite(web.source, { minify: st.minify, singleFile: st.format === "single", siteUrl: st.sitemap && st.siteUrl ? st.siteUrl : undefined, entry: web.entry });
      if (site.warnings.length) app.toast(`${site.warnings.length} warning${site.warnings.length === 1 ? "" : "s"}: ${site.warnings.slice(0, 2).join(" ")}`, "warning", 6000);
      const base = (app.doc.name || "website").replace(/[\\/:*?"<>|]+/g, "_");
      if (st.format === "folder") {
        const name = await writeToFolder(site.files);
        app.toast(`Wrote ${site.files.length} files to “${name}”.`, "success", 3500);
        return;
      }
      if (st.format === "single" && site.files.length === 1) {
        const f = site.files[0];
        const r = await platform.saveFile({ suggestedName: f.path.split("/").pop(), bytes: f.bytes, mime: "text/html", filters: [{ name: "HTML", extensions: ["html"] }] });
        if (r) app.toast(`Exported ${r.name} (${formatBytes(f.bytes.length)})`, "success");
        return;
      }
      const zip = {};
      for (const f of site.files) zip[f.path] = [f.bytes, { level: /\.(png|jpe?g|gif|webp|avif|woff2?|mp4|webm|mp3)$/i.test(f.path) ? 0 : 6 }];
      const bytes = zipSync(zip);
      const r = await platform.saveFile({ suggestedName: downloadName(`${base}-site`, "zip"), bytes, mime: "application/zip", filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
      if (r) app.toast(`Exported ${site.files.length} files (${formatBytes(bytes.length)})`, "success");
    } finally {
      app.status("");
    }
  }

  return { id: "website", label: "Website", action: "Export website", el, run };
}
