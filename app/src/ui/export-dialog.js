// Export popup (File → Export…, header button): image and PDF output, slices, and — for website
// projects — the published site. Export is a popup, not a studio, so it is reachable from every studio.
import { h, formatBytes, downloadName } from "../core/util.js";
import { zipSync } from "../../vendor/fflate/fflate.js";
import { openDialog } from "./dialogs.js";
import { numField, selectField, segmented, switchField } from "./controls.js";
import { exportRaster, exportSvg, exportPdf, RASTER_FORMATS } from "../core/io.js";
import { platform } from "../platform/index.js";
import { pageBoundsOf } from "../core/transform.js";
import { createSlicesTab } from "./export-slices.js";
import { createWebsiteTab } from "./export-website.js";

const FORMATS = [
  { value: "png", label: "PNG — lossless, transparency" },
  { value: "jpeg", label: "JPEG — photos, small files" },
  { value: "webp", label: "WebP — modern, small files" },
  { value: "svg", label: "SVG — scalable vector" },
  { value: "pdf", label: "PDF — print and share" },
];

export function exportDialog(app, preset = {}) {
  const doc = app.doc;
  const st = { format: preset.format || "png", scope: "page", scale: 1, quality: 0.9, transparent: false, bleed: false, marks: false, rasterDpi: 200 };
  const info = h("div.of-hint");
  const rasterBox = h("div.of-form");
  const pdfBox = h("div.of-form");

  const fmt = selectField({ label: "Format", value: st.format, options: FORMATS, onChange: (v) => { st.format = v; render(); } });
  const hasSel = app.selection.length > 0;
  const scopeOpts = [
    { value: "page", label: "Current page" },
    { value: "all", label: `All pages (${doc.pages.length})`, disabled: doc.pages.length < 2 },
    ...(hasSel ? [{ value: "selection", label: "Selection only" }] : []),
  ];
  const scope = selectField({ label: "Area", value: st.scope, options: scopeOpts, onChange: (v) => { st.scope = v; render(); } });
  const scale = segmented([0.5, 1, 2, 3, 4].map((v) => ({ value: v, label: `${v}×`, text: `${v}×` })), st.scale, (v) => { st.scale = v; render(); });
  const quality = numField({ label: "Quality", value: 90, min: 1, max: 100, unit: "%", precision: 0, wide: true, onChange: (v) => (st.quality = v / 100) });
  const transparent = switchField({ label: "Transparent background", value: false, onChange: (v) => { st.transparent = v; } });
  const bleed = switchField({ label: "Include bleed", value: false, onChange: (v) => (st.bleed = v) });
  const marks = switchField({ label: "Crop marks", value: false, onChange: (v) => (st.marks = v) });
  const rdpi = numField({ label: "Effects resolution", value: 200, min: 72, max: 600, unit: "dpi", precision: 0, wide: true, onChange: (v) => (st.rasterDpi = v) });

  rasterBox.append(h("div.of-row", h("span.of-slider__label", "Scale"), scale.el), quality.el, transparent.el);
  pdfBox.append(bleed.el, marks.el, rdpi.el, h("p.of-hint", "Live effects, masks and adjustments are flattened to images at this resolution; everything else stays vector."));

  function sizeOf() {
    const p = app.page;
    let w = p.w;
    let hh = p.h;
    if (st.scope === "selection") {
      const b = pageBoundsOf(app.selection);
      if (b) [w, hh] = [b.w, b.h];
    }
    return [Math.round(w * st.scale), Math.round(hh * st.scale)];
  }

  function render() {
    const raster = RASTER_FORMATS[st.format];
    rasterBox.classList.toggle("hidden", !raster);
    pdfBox.classList.toggle("hidden", st.format !== "pdf");
    quality.el.classList.toggle("hidden", st.format === "png" || !raster);
    transparent.el.classList.toggle("hidden", !raster?.alpha);
    const [w, hh] = sizeOf();
    info.textContent = raster ? `Output: ${w} × ${hh} px` : st.format === "svg" ? "Vector output; effects and adjustments are flattened where SVG cannot express them." : `${st.scope === "all" ? doc.pages.length : 1} page(s)`;
  }
  render();

  const imageTab = h("div.of-form", fmt.el, scope.el, rasterBox, pdfBox, info);
  const slicesTab = createSlicesTab(app);
  // each tab: label of the primary button and what it does
  const tabs = [
    { id: "image", label: "Image & PDF", action: "Export", el: imageTab, run: () => runExport(app, st) },
    { id: "slices", label: "Slices", action: "Export slices", el: slicesTab.el, run: () => slicesTab.run() },
  ];
  if (doc.web) tabs.push(createWebsiteTab(app, doc.web)); // website projects of the Code studio
  let active = tabs.find((t) => t.id === preset.tab) || (app.studio === "code" && tabs.find((t) => t.id === "website")) || tabs[0];

  const group = h(
    "sl-tab-group",
    { class: "of-exporttabs" },
    tabs.map((t) => h("sl-tab", { slot: "nav", panel: t.id, active: t === active || undefined }, t.label)),
    tabs.map((t) => h("sl-tab-panel", { name: t.id, active: t === active || undefined }, t.el)),
  );
  const { dlg } = openDialog({
    title: "Export",
    body: group,
    width: 540,
    cls: "of-exportdialog",
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: active.action,
        variant: "primary",
        onClick: async (close) => {
          if (active === tabs[1] && !slicesTab.count()) return app.toast("Add a slice first.", "warning");
          close();
          try {
            await active.run();
          } catch (err) {
            console.error(err);
            app.toast(err.message || "Export failed.", "danger", 6000);
          }
        },
      },
    ],
    onClose: () => slicesTab.dispose(),
  });
  // the lazily loaded tab group can upgrade after its children were attached; make sure the first panel shows
  Promise.all([customElements.whenDefined("sl-tab-group"), customElements.whenDefined("sl-tab-panel")]).then(async () => {
    await group.updateComplete;
    const panels = [...group.querySelectorAll("sl-tab-panel")];
    await Promise.all(panels.map((p) => p.updateComplete));
    for (const p of panels) p.active = p.getAttribute("name") === active.id;
  });
  const primary = dlg.querySelector('[slot="footer"]')?.lastElementChild;
  group.addEventListener("sl-tab-show", (e) => {
    if (e.target !== group) return;
    active = tabs.find((t) => t.id === e.detail.name) || active;
    if (primary) primary.textContent = active.action;
  });
}

/** Runs an export with the given settings and hands the file(s) to the platform bridge. */
export async function runExport(app, st) {
  const doc = app.doc;
  const pages = st.scope === "all" ? doc.pages : [app.page];
  const base = doc.name || "Untitled";
  app.status("Exporting…");
  try {
    if (st.format === "pdf") {
      const bytes = await exportPdf(app, pages, { bleed: st.bleed, cropMarks: st.marks, rasterDpi: st.rasterDpi });
      const r = await platform.saveFile({ suggestedName: downloadName(base, "pdf"), bytes, mime: "application/pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (r) app.toast(`Exported ${r.name} (${formatBytes(bytes.length)})`, "success");
      return;
    }
    if (st.format === "svg") {
      const files = pages.map((p, i) => {
        const { svg, warnings } = exportSvg(app, p);
        if (warnings.length) app.toast(warnings.join(" "), "warning", 5000);
        return { name: pages.length > 1 ? `${base}-${i + 1}.svg` : downloadName(base, "svg"), bytes: new TextEncoder().encode(svg) };
      });
      return await saveFiles(app, base, files, "image/svg+xml", [{ name: "SVG", extensions: ["svg"] }]);
    }
    const fmt = RASTER_FORMATS[st.format];
    const files = [];
    for (const [i, p] of pages.entries()) {
      let area;
      if (st.scope === "selection") {
        const b = pageBoundsOf(app.selection);
        if (b) area = b;
      }
      const r = await exportRaster(app, { page: p, format: st.format, scale: st.scale, quality: st.quality, background: st.transparent && fmt.alpha ? null : undefined, area });
      files.push({ name: pages.length > 1 ? `${base}-${i + 1}.${fmt.ext}` : downloadName(base, fmt.ext), bytes: r.bytes });
    }
    return await saveFiles(app, base, files, fmt.mime, [{ name: fmt.label, extensions: [fmt.ext] }]);
  } finally {
    app.status("");
  }
}

async function saveFiles(app, base, files, mime, filters) {
  if (files.length === 1) {
    const r = await platform.saveFile({ suggestedName: files[0].name, bytes: files[0].bytes, mime, filters });
    if (r) app.toast(`Exported ${r.name} (${formatBytes(files[0].bytes.length)})`, "success");
    return;
  }
  const zip = {};
  for (const f of files) zip[f.name] = [f.bytes, { level: 0 }];
  const bytes = zipSync(zip);
  const r = await platform.saveFile({ suggestedName: `${base}.zip`, bytes, mime: "application/zip", filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
  if (r) app.toast(`Exported ${files.length} files to ${r.name}`, "success");
}
