// Color management commands: color settings, CMYK conversion, soft proof, gamut warning and print preflight.
// Everything heavy (ICC engine, dialogs, proof tables) is imported on first use (docs/color-management.md).
const hasDoc = (a) => !!a.doc;
const design = (a) => !!a.doc && a.studio !== "code" && a.studio !== "office";
const ui = () => import("../ui/color-settings.js");

export function registerColorCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });
  def("color.settings", "Color Settings…", async (a) => (await ui()).colorSettingsDialog(a), { enabled: hasDoc, icon: "palette" });
  def("color.toCmyk", "Convert Colors to CMYK", async (a) => (await ui()).convertCommand(a, "cmyk"), { enabled: design });
  def("color.toRgb", "Convert Colors to RGB", async (a) => (await ui()).convertCommand(a, "rgb"), { enabled: design });
  def("file.preflight", "Print Preflight…", async (a) => (await ui()).preflightDialog(a), { enabled: design });
  def("view.proofColors", "Proof Colors (CMYK)", async (a) => (await ui()).toggleProof(a, "proof"), { enabled: design, checked: (a) => !!a.proofState?.proof });
  def("view.gamutWarning", "Gamut Warning", async (a) => (await ui()).toggleProof(a, "warn"), { enabled: design, checked: (a) => !!a.proofState?.warn });
}
