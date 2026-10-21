// Lorem & Data Filler: commands. lib.js (prepended by the packer) holds the logic.
const t = (key, vars = {}) => String(STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

async function activate(openfini) {
  await openfini.commands.register("open", () => openfini.ui.openPanel("filler"));

  await openfini.commands.register("fill", async (args) => {
    const v = args?.kind
      ? args
      : await openfini.ui.form({
          title: "Fill selected text layers",
          ok: "Fill",
          fields: [
            { name: "kind", label: "Content", type: "select", default: "auto", options: [{ value: "auto", label: "Smart (by layer name)" }, ...Object.entries(KINDS).map(([value, d]) => ({ value, label: d[0] }))] },
            { name: "seed", label: "Seed", type: "number", default: 1, min: 0, max: 99999, hint: "The same seed always gives the same text." },
          ],
        });
    if (!v) return null;
    const n = await fillSelection(openfini, v);
    if (!n) return openfini.ui.showMessage(t("noText"), "warning");
    await openfini.ui.showMessage(t("filled", { n }), "success");
    return { filled: n };
  });

  await openfini.commands.register("avatars", async (args) => {
    const v = args?.count ? args : await openfini.ui.form({ title: "Insert initials avatars", ok: "Insert", fields: [{ name: "count", label: "How many", type: "number", default: 4, min: 1, max: 12 }, { name: "seed", label: "Seed", type: "number", default: 1, min: 0, max: 99999 }] });
    if (!v) return null;
    return { inserted: await insertAvatars(openfini, v) };
  });

  for (const block of Object.keys(HTML_BLOCKS)) {
    await openfini.commands.register(`html-${block}`, async (args) => {
      const v = args?.count ? args : await openfini.ui.form({ title: `Insert ${block} with fake data`, ok: "Insert", fields: [{ name: "count", label: "Items", type: "number", default: block === "cards" ? 6 : 8, min: 1, max: 60 }, { name: "seed", label: "Seed", type: "number", default: 1, min: 0, max: 99999 }] });
      if (!v) return null;
      const n = await insertHtmlBlock(openfini, { block, count: v.count, seed: v.seed });
      await openfini.ui.showMessage(t("inserted", { n }), "success");
      return { inserted: n };
    });
  }
}
