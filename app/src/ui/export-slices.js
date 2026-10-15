// Slices tab of the export popup: list, create and export slices (each slice becomes its own file).
import { h, empty, uid, downloadName, formatBytes } from "../core/util.js";
import { zipSync } from "../../vendor/fflate/fflate.js";
import { button, iconButton, selectField } from "./controls.js";
import { exportRaster, RASTER_FORMATS } from "../core/io.js";
import { pageBoundsOf } from "../core/transform.js";
import { platform } from "../platform/index.js";
import { topLevelSelection } from "../core/ops.js";

export async function exportSlices(app, slices) {
  const doc = app.doc;
  if (!slices.length) return app.toast("Add a slice first.", "warning");
  app.status("Exporting slices…");
  try {
    const files = [];
    for (const s of slices) {
      const page = doc.page(s.page) || app.page;
      const fmt = RASTER_FORMATS[s.format] || RASTER_FORMATS.png;
      const r = await exportRaster(app, { page, format: s.format, scale: s.scale, quality: s.quality ?? 0.9, area: { x: s.x, y: s.y, w: s.w, h: s.h } });
      const suffix = s.scale !== 1 ? `@${s.scale}x` : "";
      files.push({ name: `${s.name.replace(/[\\/:*?"<>|]+/g, "_")}${suffix}.${fmt.ext}`, bytes: r.bytes, mime: fmt.mime, fmt });
    }
    if (files.length === 1) {
      const f = files[0];
      const res = await platform.saveFile({ suggestedName: f.name, bytes: f.bytes, mime: f.mime, filters: [{ name: f.fmt.label, extensions: [f.fmt.ext] }] });
      if (res) app.toast(`Exported ${res.name} (${formatBytes(f.bytes.length)})`, "success");
      return;
    }
    const zip = {};
    const seen = new Set();
    for (const f of files) {
      let name = f.name;
      for (let i = 2; seen.has(name); i++) name = f.name.replace(/(\.[a-z0-9]+)$/i, `-${i}$1`);
      seen.add(name);
      zip[name] = [f.bytes, { level: 0 }];
    }
    const bytes = zipSync(zip);
    const res = await platform.saveFile({ suggestedName: downloadName(`${doc.name}-slices`, "zip"), bytes, mime: "application/zip", filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
    if (res) app.toast(`Exported ${files.length} slices (${formatBytes(bytes.length)})`, "success");
  } catch (err) {
    app.toast(err.message || "Export failed.", "danger", 6000);
  } finally {
    app.status("");
  }
}

/** Builds the slices tab. `run()` exports every slice; `dispose()` hides the canvas highlights again. */
export function createSlicesTab(app) {
  const list = h("div.of-slices");
  const doc = () => app.doc;

  function addSlice(page, r, name) {
    const s = { id: uid("sl"), name, page: page.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)), format: "png", scale: 1, quality: 0.9 };
    doc().arrayInsert(doc().slices, s, doc().slices.length, "Add Slice");
    return s;
  }
  function fromSelection() {
    const sel = topLevelSelection(app);
    if (!sel.length) return app.toast("Select an object first.", "warning");
    const b = pageBoundsOf(sel);
    app.sliceSel = addSlice(app.page, b, sel.length === 1 ? sel[0].name : "Selection").id;
    render();
    app.requestOverlay();
  }
  function fromLayers() {
    const page = app.page;
    doc().tx("Slices from Layers", () => {
      for (const n of page.root.children) {
        if (!n.visible) continue;
        const b = pageBoundsOf([n]);
        if (b) addSlice(page, b, n.name);
      }
    });
    render();
    app.requestOverlay();
  }

  function render() {
    empty(list);
    const d = doc();
    if (!d) return;
    if (!d.slices.length) list.append(h("div.of-empty", "No slices yet."));
    for (const s of d.slices) {
      const name = h("input.of-slice__name", { value: s.name, "aria-label": "Slice name", spellcheck: false });
      name.addEventListener("change", () => d.set(s, { name: name.value || s.name }, "Rename Slice"));
      name.addEventListener("keydown", (e) => e.stopPropagation());
      const fmt = selectField({ label: "", value: s.format, options: Object.entries(RASTER_FORMATS).map(([value, f]) => ({ value, label: f.label })), onChange: (v) => d.set(s, { format: v }, "Slice Format") });
      const scale = selectField({ label: "", value: String(s.scale), options: [0.5, 1, 2, 3, 4].map((v) => ({ value: String(v), label: `${v}×` })), onChange: (v) => d.set(s, { scale: Number(v) }, "Slice Scale") });
      const row = h(
        "div.of-slice",
        { class: s.id === app.sliceSel ? "active" : "" },
        h("div.of-row", name, iconButton({ icon: "trash3", label: "Delete slice", onClick: () => {
          d.arrayRemove(d.slices, s, "Delete Slice");
          render();
          app.requestOverlay();
        } })),
        h("div.of-row", fmt.el, scale.el, h("span.of-hint", `${Math.round(s.w * s.scale)} × ${Math.round(s.h * s.scale)} px`)),
      );
      row.addEventListener("click", () => {
        app.sliceSel = s.id;
        app.requestOverlay();
        list.querySelectorAll(".of-slice").forEach((r) => r.classList.toggle("active", r === row));
      });
      list.append(row);
    }
  }
  render();

  app.sliceShow = true; // draw the slices on the canvas while the popup is open
  app.requestOverlay();

  const el = h(
    "div.of-form.of-slicestab",
    h("p.of-hint", "Draw slices with the Slice tool (S), or create them from your selection or layers. Each slice exports as its own file; several slices are bundled into one ZIP archive."),
    h("div.of-row", button("From selection", fromSelection), button("From layers", fromLayers)),
    list,
    h("div.of-row", button("Export selected slice", () => {
      const s = doc().slices.find((x) => x.id === app.sliceSel);
      if (s) exportSlices(app, [s]);
      else app.toast("Select a slice first.", "warning");
    })),
  );
  return {
    el,
    count: () => doc().slices.length,
    run: () => exportSlices(app, doc().slices),
    dispose() {
      app.sliceShow = false;
      app.requestOverlay();
    },
  };
}
