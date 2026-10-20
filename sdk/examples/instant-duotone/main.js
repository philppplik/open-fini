// Instant Duotone: adds a gradient-map adjustment layer (shadow color -> highlight color).
const PRESETS = {
  midnight: { shadow: "#0b1030", highlight: "#7de2ff" },
  sunset: { shadow: "#2a0a3d", highlight: "#ffb86b" },
  forest: { shadow: "#0a2418", highlight: "#d7f5a8" },
  mono: { shadow: "#000000", highlight: "#ffffff" },
};

async function duotone(openfini, colors) {
  const layer = await openfini.document.callTool("apply_adjustment", {
    kind: "adjustment",
    id: "gradient-map",
    params: { shadow: colors.shadow, highlight: colors.highlight, useMidtone: false, amount: 100 },
  });
  await openfini.storage.set("last", colors);
  return layer;
}

async function activate(openfini) {
  await openfini.commands.register("apply", async () => {
    const preset = PRESETS[openfini.settings.get("preset")] || PRESETS.midnight;
    await duotone(openfini, preset);
    await openfini.ui.showMessage("Duotone added. Open the Adjust panel to fine-tune it.", "success");
  });
  await openfini.commands.register("choose", async () => {
    const last = await openfini.storage.get("last", PRESETS.midnight);
    const v = await openfini.ui.form({
      title: "Duotone colors",
      ok: "Apply",
      fields: [
        { name: "shadow", label: "Shadows", type: "text", default: last.shadow, hint: "A hex color such as #0b1030" },
        { name: "highlight", label: "Highlights", type: "text", default: last.highlight },
      ],
    });
    if (!v) return;
    const hex = /^#[0-9a-fA-F]{6}$/;
    if (!hex.test(v.shadow) || !hex.test(v.highlight)) return openfini.ui.showMessage("Use colors like #112233.", "warning");
    await duotone(openfini, v);
  });
}
