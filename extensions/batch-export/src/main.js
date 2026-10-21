// Batch Export & Rename: commands. lib.js (prepended by the packer) holds the logic.
const t = (key, vars = {}) => String(STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

async function activate(openfini) {
  await openfini.commands.register("open", () => openfini.ui.openPanel("batch"));

  await openfini.commands.register("export", async (args) => {
    const v = args?.source
      ? args
      : await openfini.ui.form({
          title: "Batch export",
          description: "Every selected layer (or page) is exported in every size and format, then saved as one ZIP.",
          ok: "Export",
          fields: [
            { name: "source", label: "What to export", type: "select", default: "selection", options: [{ value: "selection", label: "Selected layers" }, { value: "page", label: "Current page" }, { value: "pages", label: "All pages" }] },
            { name: "s1", label: "1x", type: "boolean", default: true },
            { name: "s2", label: "2x", type: "boolean", default: true },
            { name: "s3", label: "3x", type: "boolean", default: false },
            { name: "png", label: "PNG", type: "boolean", default: true },
            { name: "jpg", label: "JPG", type: "boolean", default: false },
            { name: "webp", label: "WebP", type: "boolean", default: false },
            { name: "svg", label: "SVG", type: "boolean", default: false },
            { name: "template", label: "File name template", type: "text", default: DEFAULT_TEMPLATE, hint: "{name} {scale} {format} {index} {page}" },
          ],
        });
    if (!v) return null;
    const opts = args?.source
      ? { ...v, scales: v.scales || [1], formats: v.formats || ["png"] }
      : { source: v.source, template: v.template, scales: [v.s1 && 1, v.s2 && 2, v.s3 && 3].filter(Boolean), formats: FORMATS.filter((f) => v[f]) };
    if (!opts.scales.length || !opts.formats.length) return openfini.ui.showMessage("Choose at least one size and one format.", "warning");
    const res = await runExport(openfini, { ...opts, zip: true, folders: false });
    if (res.empty) return openfini.ui.showMessage(t("nothing"), "warning");
    if (res.saved) await openfini.ui.showMessage(t("exported", { n: res.files.length }), "success");
    return { files: res.files.map((f) => f.file), saved: res.saved };
  });

  await openfini.commands.register("rename", async (args) => {
    const v = args?.find !== undefined || args?.prefix !== undefined || args?.number !== undefined
      ? args
      : await openfini.ui.form({
          title: "Rename selected layers",
          ok: "Rename",
          fields: [
            { name: "find", label: "Find", type: "text", default: "" },
            { name: "replace", label: "Replace with", type: "text", default: "" },
            { name: "regex", label: "Find is a regular expression", type: "boolean", default: false },
            { name: "prefix", label: "Prefix", type: "text", default: "" },
            { name: "suffix", label: "Suffix", type: "text", default: "" },
            { name: "caseMode", label: "Case", type: "select", default: "keep", options: ["keep", "lower", "upper", "title", "kebab", "snake"] },
            { name: "number", label: "Add a number", type: "boolean", default: false },
            { name: "start", label: "Start at", type: "number", default: 1, min: 0, max: 99999 },
          ],
        });
    if (!v) return null;
    const plan = await runRename(openfini, v);
    const n = plan.filter((p) => p.changed).length;
    await openfini.ui.showMessage(n ? t("renamed", { n }) : t("noRename"), n ? "success" : "warning");
    return { renamed: n, plan };
  });
}
