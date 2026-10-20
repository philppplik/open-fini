// Palette Pro background script: commands. Pure helpers come from lib.js (prepended by the packer).
const t = (key, vars = {}) => String(STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

async function selectionColors() {
  const { selection } = await openfini.document.readSelection();
  return { selection, colors: colorsFromLayers(selection) };
}

async function activate(openfini) {
  await openfini.commands.register("open", () => openfini.ui.openPanel("palette"));

  await openfini.commands.register("swatches", async (args) => {
    const sel = await selectionColors();
    const values = args?.base
      ? args
      : await openfini.ui.form({
          title: "Insert palette swatches",
          description: "Adds a row of color squares to the page.",
          ok: "Insert",
          fields: [
            { name: "base", label: "Base color", type: "text", default: sel.colors[0] || "#3b82f6" },
            { name: "kind", label: "Harmony", type: "select", default: "analogous", options: Object.keys(HARMONIES) },
            { name: "size", label: "Swatch size (px)", type: "number", default: 120, min: 16, max: 800 },
          ],
        });
    if (!values) return null;
    const colors = harmony(values.base, values.kind, 5);
    if (!colors.length) return openfini.ui.showMessage("That is not a valid color.", "error");
    const info = await openfini.document.pageInfo();
    const size = values.size || 120;
    const x0 = Math.max(0, ((info?.width || 800) - colors.length * (size + 12)) / 2);
    const y0 = Math.max(0, ((info?.height || 600) - size) / 2);
    for (const [i, fill] of colors.entries()) await openfini.document.callTool("add_shape", { type: "rect", x: x0 + i * (size + 12), y: y0, w: size, h: size, fill, name: `Swatch ${fill}` });
    return { colors };
  });

  await openfini.commands.register("contrast", async () => {
    const { selection } = await openfini.document.readSelection();
    const fills = selection.map((l) => l.fill).filter((f) => parseColor(f || ""));
    if (fills.length < 2) return openfini.ui.showMessage("Select two layers with solid colors (for example a text layer and the shape behind it).", "warning");
    const ratio = contrastRatio(fills[0], fills[1]);
    const w = wcagLevel(ratio);
    await openfini.ui.showMessage(t("contrastResult", { ratio: ratio.toFixed(2), level: w.level }), w.aa ? "success" : "warning");
    return { ratio, ...w, suggestions: suggestFix(fills[0], fills[1]) };
  });

  await openfini.commands.register("from-selection", async () => {
    const { colors } = await selectionColors();
    if (!colors.length) return openfini.ui.showMessage(t("noColors"), "warning");
    await openfini.storage.set("source", colors.slice(0, 24));
    await openfini.ui.openPanel("palette");
    return { colors };
  });
}
