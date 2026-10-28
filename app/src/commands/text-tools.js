// Command palette entries for the code editor's text tools (`code.encodeEntitiesDecimal`, `code.sortLinesAsc`, ...).
// The transforms live in engine/web/texttools.js; the editor side (one undoable transaction) in ui/code/text-tools.js,
// which loads on first use. Each command works on the selection or, with an empty selection, on the word, line or file.
// Only the catalog (ids and labels) is imported here: the transforms and the character codec stay out of start-up.
import { TRANSFORM_INFO as TRANSFORMS } from "../engine/web/texttools-catalog.js";

const GROUP_LABEL = { encode: "Encode", decode: "Decode", convert: "Convert", case: "Case", lines: "Lines", wrap: "Wrap", json: "JSON", color: "Color" };

export function registerTextToolCommands(app) {
  const live = (a) => a.studio === "code" && !!a.codeUI?.built && !!a.codeUI.editors?.view;
  const tools = () => import("../ui/code/text-tools.js");
  for (const t of TRANSFORMS) {
    if (t.fileOnly) continue;
    app.registerCommand(`code.${t.id}`, {
      label: `${GROUP_LABEL[t.group]}: ${t.label}`,
      studios: ["code"],
      enabled: live,
      run: async (a) => (await tools()).runTransform(a.codeUI.editors, t.id),
    });
  }
  app.registerCommand("code.encodeChooser", { label: "Encode: Choose format and mode…", studios: ["code"], enabled: live, run: async (a) => (await tools()).encodeChooser(a.codeUI.editors) });
  app.registerCommand("code.unicodeInfo", { label: "Show Unicode info for the character at the cursor", studios: ["code"], enabled: live, run: async (a) => (await tools()).showUnicodeInfo(a.codeUI.editors) });
}
