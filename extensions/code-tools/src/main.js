// Code Tools: commands. lib.js and lib-format.js (prepended by the packer) hold the logic.
const t = (key, vars = {}) => String(STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

/** Picks the file to work on: args.path, or a form listing the project's formattable files. */
async function pickFile(openfini, args, { only, title }) {
  if (args?.path) return args.path;
  let files;
  try {
    files = (await projectFiles(openfini)).filter((f) => !only || only.includes(f.lang));
  } catch {
    await openfini.ui.showMessage(t("noProject"), "warning");
    return null;
  }
  if (!files.length) {
    await openfini.ui.showMessage("The project has no files this command can process.", "warning");
    return null;
  }
  const info = await openfini.document.info();
  const entry = info.activeDocument?.websiteProject?.entry;
  const v = await openfini.ui.form({ title, ok: "Run", fields: [{ name: "path", label: "File", type: "select", default: files.find((f) => f.path === entry)?.path || files[0].path, options: files.map((f) => f.path) }] });
  return v?.path || null;
}

async function run(openfini, args, mode, only, title, done) {
  const path = await pickFile(openfini, args, { only, title });
  if (!path) return null;
  try {
    const r = await processFile(openfini, path, mode);
    await openfini.ui.showMessage(done(r), "success");
    return r;
  } catch (e) {
    await openfini.ui.showMessage(t("failed", { path, error: e.message }), "error");
    return null;
  }
}

async function activate(openfini) {
  await openfini.commands.register("open", () => openfini.ui.openPanel("tools"));
  await openfini.commands.register("format", (args) => run(openfini, args, "format", null, "Format document", (r) => t(r.changed ? "formatted" : "unchanged", r)));
  await openfini.commands.register("minify", (args) => run(openfini, args, "minify", null, "Minify file (writes name.min.ext)", (r) => t("minified", { path: r.target, before: r.before, after: r.after })));
  await openfini.commands.register("sort-css", (args) => run(openfini, args, "sort", ["css"], "Sort CSS properties", (r) => t("sorted", r)));
}
