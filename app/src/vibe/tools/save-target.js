// Vibe tool: which file File ▸ Save would write for the active document (core/source-format.js). Read only.
import { tool } from "./helpers.js";
import { canSaveAsSource, saveTarget } from "../../core/source-format.js";

export function saveTargetTools(app) {
  return [
    tool("get_save_target", "Tells which file type File ▸ Save (Ctrl+S) would write for the active document: the format it was opened from (for example .txt, .md, .docx, .svg) or .ofini. Returns the source format, whether Save would write it in that format, and the reason when it would not (for example a second file or a design page was added, so only .ofini keeps everything). Reading only: nothing is saved.", {}, [], async () => {
      const doc = app.doc;
      if (!doc) return { error: "No document is open." };
      const enabled = app.prefs.saveOriginalFormat !== false;
      const d = canSaveAsSource(doc, { enabled });
      const target = saveTarget(doc, { enabled });
      return {
        document: doc.name,
        sourceFormat: doc.source?.format || null,
        sourceFile: doc.source?.name || null,
        savesInSourceFormat: d.ok,
        saveWrites: target.name || `${doc.name}.ofini`,
        saveFormat: target.label,
        willAskBeforeSwitching: d.ask,
        reason: d.ok ? "" : d.reason,
        settingOn: enabled,
      };
    }, { readOnly: true }),
  ];
}
