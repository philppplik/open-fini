// Doctor: diagnose and repair (docs/doctor.md). One pure module behind two surfaces: the in-app Doctor dialog
// (ui/doctor-dialog.js, lazy) and `ofini doctor` (cli/). Nothing here touches the DOM, storage or the network.
//
// Public API
//   diagnoseFile(bytes, { name }) → report             .ofini projects in depth, other files briefly (file.js)
//   repairFile(bytes, { name, fixes }) → { bytes, applied, before, after }
//   evaluateEnvironment(status) → findings              app checks (env.js)
//   doctorReport({ app, env, doc }) → string            plain-text report without file contents, keys or paths
export { diagnoseFile, repairFile, reportText, findingText, countFindings, fixSelector, FIXES, LARGE_PART, MAX_DEPTH, OFINI_MIME, pngProblem, pngSize, isOfiniName } from "./file.js";
export { evaluateEnvironment, checkPrefs, providerUrlOk, ENV_FIXES } from "./env.js";
export { readZipStrict, scanLocalHeaders, safeEntryName, crc32, writeOfiniZip, DOCTOR_LIMITS, looksLikeZip } from "./zip.js";
import { formatMessage } from "../../i18n/format.js";

const PATHS = /([A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\s"']+|\/(?:home|Users)\/[^/\s"']+)/g;

/** Removes user names from paths in a line of text ("C:\Users\ana\x" → "C:\Users\…\x"). */
export const redactPaths = (s) => String(s ?? "").replace(PATHS, (m) => m.replace(/([\\/])[^\\/]+$/, "$1…"));

/**
 * The text of "Copy report": app facts, environment findings and document findings. Document findings carry layer and
 * asset names, which can be personal; `names: false` (the default) replaces them with their kind.
 * @param {{ app?: { version?: string, platform?: string }, env?: object[], doc?: object|null, translate?: Function, names?: boolean }} o
 */
export function doctorReport({ app = {}, env = [], doc = null, translate = null, names = false } = {}) {
  const T = (s, p) => (translate ? translate(s, p || {}) : formatMessage(s, p || {}));
  const scrub = (p) => {
    if (names) return p;
    const out = {};
    for (const [k, v] of Object.entries(p || {})) out[k] = ["layer", "asset", "file", "list", "style", "comp", "provider", "where"].includes(k) ? "…" : v;
    return out;
  };
  const lines = [`OpenFini Doctor ${app.version || ""}`.trim(), `${T("Platform")}: ${app.platform || "?"}`, ""];
  lines.push(`## ${T("App")}`);
  for (const f of env) lines.push(`[${f.severity}] ${T(f.area)}: ${T(f.message, f.params)}`);
  if (doc) {
    lines.push("", `## ${T("Document")}`);
    lines.push(`${T("errors")}: ${doc.counts?.error || 0}, ${T("warnings")}: ${doc.counts?.warning || 0}, ${T("notes")}: ${doc.counts?.info || 0}`);
    for (const f of doc.findings || []) lines.push(`[${f.severity}] ${f.code}: ${T(f.message, scrub(f.params))}`);
  }
  return redactPaths(lines.join("\n"));
}
