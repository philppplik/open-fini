// Text and code files that open in the Code studio as a one-file project (File ▸ Open, drag and drop).
// Markdown and LaTeX get a live preview; the others are shown as highlighted text. SVG stays a vector document.

export const TEXT_DOC_EXTS = [
  "md", "markdown", "mdx", "tex", "latex", "bib", "sty", "cls", "txt", "json", "jsonc", "yaml", "yml", "xml", "csv", "tsv", "toml", "ini", "conf",
  "properties", "log", "ts", "tsx", "jsx", "js", "mjs", "css", "html", "htm",
];

const RE = new RegExp(`\.(${TEXT_DOC_EXTS.join("|")})$`, "i");

/** Is this file name one that opens as a text document in the Code studio? */
export function isTextDocumentName(name = "") {
  return RE.test(name);
}

/** The file to show first when a folder without web pages is opened (README, main.tex, the first Markdown file …). */
export function pickDocumentEntry(paths) {
  const lower = (p) => p.toLowerCase();
  const find = (re) => paths.filter((p) => re.test(p)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];
  return (
    paths.find((p) => ["readme.md", "index.md", "main.tex", "document.tex"].includes(lower(p))) || find(/(^|\/)main\.tex$/i) || find(/\.tex$/i) || find(/\.(md|markdown|mdx)$/i) || find(RE) || null
  );
}
