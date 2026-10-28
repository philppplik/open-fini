// Office Suite ↔ Vibe: the one-line "Current document" summary of an Office document for the system prompt
// (vibe/session.js ▸ buildSystemPrompt doc). Synchronous and DOM-free: it uses only the registered manifests and,
// when the app is already loaded, its aiAdapter.describe(model). The app's `aiNote` (manifest) travels with it so the
// model knows which tools fit this kind.
//
// Public API: officeSummary(doc) → string | undefined
import { officeApp, officeKindOf, loadedOfficeApp } from "./index.js";

export function officeSummary(doc) {
  const kind = officeKindOf(doc);
  if (!kind) return undefined;
  const m = officeApp(kind);
  if (!m) return `kind ${kind} (no app for it in this version; the document is kept unchanged)`;
  let detail = "";
  try {
    const impl = loadedOfficeApp(kind);
    const d = (impl?.aiAdapter?.describe || impl?.describe)?.(doc.office.model);
    if (d) detail = ` ${JSON.stringify(d).slice(0, 500)}`;
  } catch {
    /* a describe failure must not break the prompt */
  }
  return `${m.label} (kind ${kind}).${detail}${m.aiNote ? ` ${m.aiNote}` : ""}`;
}
