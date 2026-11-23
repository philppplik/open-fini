// Text and code files that open in the Code studio as a one-file project (File ▸ Open, drag and drop).
// Markdown and LaTeX get a live preview; the others are shown as highlighted text. SVG stays a vector document.

import { TEXT_FILE_EXTS, TEXT_FILE_NAMES } from "../engine/web/code-langs.js";

// Every text and source-code type of engine/web/code-langs.js except SVG (it opens as a vector document) and the
// XML-based formats other studios own. Exact names (Dockerfile, .gitignore, Makefile) are in TEXT_DOC_NAMES.
const NOT_TEXT_DOCS = new Set(["svg"]);
export const TEXT_DOC_EXTS = TEXT_FILE_EXTS.filter((e) => !NOT_TEXT_DOCS.has(e));
export const TEXT_DOC_NAMES = TEXT_FILE_NAMES;

// the dot MUST be escaped (a regex literal needs no template-string escaping): with a bare "." the pattern matched
// "<any char>ini", so every ".ofini" document was treated as a text file and refused as "binary"
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE = new RegExp("\\.(" + TEXT_DOC_EXTS.map(esc).join("|") + ")$", "i");
const NAMES = new Set(TEXT_DOC_NAMES);

/** Is this file name one that opens as a text document in the Code studio? */
export function isTextDocumentName(name = "") {
  if (RE.test(name)) return true;
  const base = String(name).replace(/\\/g, "/").split("/").pop().toLowerCase();
  if (NAMES.has(base)) return true;
  // "Dockerfile.dev", ".env.local", "Makefile.win": a known name followed by a variant suffix
  const stem = base.startsWith(".") ? "." + base.slice(1).split(".")[0] : base.split(".")[0];
  return stem !== base && NAMES.has(stem);
}

/** The file to show first when a folder without web pages is opened (README, main.tex, the first Markdown file …). */
export function pickDocumentEntry(paths) {
  const lower = (p) => p.toLowerCase();
  const find = (re) => paths.filter((p) => re.test(p)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];
  return (
    paths.find((p) => ["readme.md", "index.md", "main.tex", "document.tex"].includes(lower(p))) || find(/(^|\/)main\.tex$/i) || find(/\.tex$/i) || find(/\.(md|markdown|mdx)$/i) || find(RE) || null
  );
}
