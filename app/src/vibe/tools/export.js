// Vibe tools for File ▸ Export of design documents (Vector, Pixel, Layout): the same options schema as the Export
// dialog (engine/export/options.js), so the assistant can do everything the dialog does. See docs/export.md.
import { tool, S, requireDoc } from "./helpers.js";

const schema = () => import("../../engine/export/options.js");
const runner = () => import("../../core/export-run.js");

function designDoc(app) {
  const doc = requireDoc(app);
  if (doc.office) throw new Error("This is an Office document: use office_export.");
  if (doc.web && !doc.pages?.length) throw new Error("Website projects are published with publish_site.");
  return doc;
}

export function exportTools(app) {
  return [
    tool("list_export_options", "Lists the export formats this browser can write, the export options that apply to a format for the active design document (with type, allowed values, range, default and the current value of the given settings), the built-in and the user's presets, and the files the export would produce (names, pixel sizes). Reading only.", {
      format: S.str("png, jpeg, webp, avif, tiff, svg, pdf or psd (default png)"),
      settings: { type: "object", description: "Settings to evaluate (same keys as export_document settings); options shown or hidden depend on them" },
    }, [], async (a) => {
      designDoc(app);
      const O = await schema();
      const R = await runner();
      await R.detectEncoders();
      const env = R.exportEnv(app);
      const st = O.normalizeExportSettings({ ...(a.settings || {}), ...(a.format ? { format: a.format } : {}) }, env);
      let plan = null;
      try {
        const p = O.planExport(st, R.exportInfo(app));
        plan = { files: p.files, names: p.jobs.slice(0, 20).map((j) => j.name), firstSize: p.jobs[0]?.size ? { width: p.jobs[0].size.width, height: p.jobs[0].size.height, ppi: p.jobs[0].size.ppi } : null, warnings: p.warnings };
      } catch (err) {
        plan = { error: err.message };
      }
      return {
        formats: O.availableFormats(env).map((f) => ({ id: f.id, label: f.label, extension: f.ext })),
        format: st.format,
        options: O.visibleOptions(st, env).map((d) => ({
          key: d.key, type: d.type, label: d.label, group: d.group, advanced: !!d.advanced, value: st[d.key],
          ...(d.type === "enum" ? { values: O.choicesOf(d, st, env).map((c) => c.value) } : {}),
          ...(d.type === "number" ? { min: d.min, max: d.max, unit: d.unit || "" } : {}),
          ...(d.hint ? { hint: d.hint } : {}),
        })),
        presets: [...O.BUILTIN_PRESETS.map((p) => ({ name: p.name, id: p.id, builtIn: true })), ...((Array.isArray(app.prefs.exportPresets) ? app.prefs.exportPresets : []).map((p) => ({ name: p.name, builtIn: false })))],
        plan,
        note: "Naming tokens: {name} {page} {pageName} {layer} {size} {w} {h} {date}. sizes: \"1x, 2x, 512w, 64h, 300ppi\". range: \"1-3, 5, 8-\".",
      };
    }, { readOnly: true }),

    tool("export_document", "Exports the active design document with full control: any format the Export dialog offers (png, jpeg, webp, avif, tiff, svg, pdf, psd) and any option from list_export_options (pages, range, spreads, size/scale/resolution, several sizes, background, color mode, quality, compression, color profile, bleed, printer marks, PDF/X, image downsampling, fonts, naming, metadata). A preset (built-in id or the user's preset name) fills the options first; settings override it. One file is saved directly, several as a ZIP; a save dialog opens for the user. Office documents use office_export.", {
      format: S.str("png, jpeg, webp, avif, tiff, svg, pdf or psd (optional when a preset gives it)"),
      preset: S.str("Preset id or name from list_export_options (optional)"),
      settings: { type: "object", description: "Option values by key, e.g. { scope: \"all\", standard: \"x4\", bleed: \"document\", cropMarks: true }" },
    }, [], async (a) => {
      designDoc(app);
      const O = await schema();
      let base = {};
      if (a.preset) {
        const p = O.BUILTIN_PRESETS.find((x) => x.id === a.preset || x.name === a.preset) || (Array.isArray(app.prefs.exportPresets) ? app.prefs.exportPresets : []).find((x) => x.name === a.preset);
        if (!p) throw new Error(`Unknown preset "${a.preset}". list_export_options lists the presets.`);
        base = p.settings;
      }
      const settings = { ...base, ...(a.settings || {}), ...(a.format ? { format: a.format } : {}) };
      const r = await (await runner()).runExport(app, settings);
      return r.saved ? { exported: r.saved, files: r.files, bytes: r.bytes } : { exported: null, note: "The user cancelled the save dialog." };
    }, { needsApproval: (a) => `Export the document${a.format ? ` as ${String(a.format).toUpperCase()}` : a.preset ? ` with the preset "${a.preset}"` : ""} (a save dialog opens)?` }),
  ];
}
