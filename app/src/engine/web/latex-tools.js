// Pure LaTeX helpers for the Code studio: completions (commands, environments, \ref labels, \cite keys), compile-log
// parsing, snippets (table, figure, bibliography) and the engine argument allow-list shared with the desktop app
// (src-tauri/src/latex.rs builds the same arguments; keep both in sync). See docs/latex.md.
import { parseBib } from "./latex.js";

/** Common commands: [name, snippet body (CodeMirror snippet syntax), detail]. */
export const LATEX_COMMANDS = [
  ["section", "section{${title}}", "Section"], ["subsection", "subsection{${title}}", "Subsection"], ["subsubsection", "subsubsection{${title}}", "Subsubsection"],
  ["chapter", "chapter{${title}}", "Chapter"], ["paragraph", "paragraph{${title}}", "Paragraph heading"],
  ["textbf", "textbf{${text}}", "Bold"], ["textit", "textit{${text}}", "Italic"], ["emph", "emph{${text}}", "Emphasis"], ["underline", "underline{${text}}", "Underline"],
  ["texttt", "texttt{${text}}", "Monospace"], ["label", "label{${key}}", "Label for \\ref"], ["ref", "ref{${key}}", "Reference"], ["eqref", "eqref{${key}}", "Equation reference"],
  ["cite", "cite{${key}}", "Citation"], ["citep", "citep{${key}}", "Citation (natbib)"], ["citet", "citet{${key}}", "Citation (natbib)"],
  ["footnote", "footnote{${text}}", "Footnote"], ["url", "url{${address}}", "URL"], ["href", "href{${address}}{${text}}", "Link"],
  ["includegraphics", "includegraphics[width=\\linewidth]{${file}}", "Image"], ["usepackage", "usepackage{${package}}", "Package"],
  ["documentclass", "documentclass{${article}}", "Document class"], ["title", "title{${title}}", "Title"], ["author", "author{${name}}", "Author"],
  ["maketitle", "maketitle", "Title block"], ["tableofcontents", "tableofcontents", "Contents"], ["frac", "frac{${a}}{${b}}", "Fraction"],
  ["sqrt", "sqrt{${x}}", "Square root"], ["sum", "sum_{${i=1}}^{${n}}", "Sum"], ["int", "int_{${a}}^{${b}}", "Integral"],
  ["item", "item ${text}", "List item"], ["caption", "caption{${text}}", "Caption"], ["centering", "centering", "Center"],
  ["bibliography", "bibliography{${refs}}", "BibTeX file"], ["bibliographystyle", "bibliographystyle{${plain}}", "BibTeX style"],
  ["newcommand", "newcommand{\\\\${name}}[${1}]{${body}}", "Define a macro"], ["input", "input{${file}}", "Include a file"],
  ["frametitle", "frametitle{${title}}", "Beamer frame title"], ["hline", "hline", "Table rule"], ["today", "today", "Date"],
];

/** Common environments for \begin{…}. */
export const LATEX_ENVIRONMENTS = [
  "document", "itemize", "enumerate", "description", "figure", "table", "tabular", "center", "equation", "equation*", "align", "align*",
  "abstract", "quote", "verbatim", "theorem", "lemma", "proof", "minipage", "frame", "columns", "thebibliography", "lstlisting",
];

const LABEL_RE = /\\label\s*\{([^}]+)\}/g;

/** Every \label{key} in the texts (deduplicated, in order). */
export function latexLabels(...texts) {
  const out = new Set();
  for (const t of texts) for (const m of String(t ?? "").matchAll(LABEL_RE)) out.add(m[1].trim());
  return [...out];
}

/** Every BibTeX key (with title) in the .bib texts and \bibitem keys in the .tex texts. */
export function bibKeys(bibTexts = [], texTexts = []) {
  const out = new Map();
  for (const b of bibTexts) {
    for (const e of parseBib(b)) if (e.key) out.set(e.key, e.fields?.title || e.type || "");
  }
  for (const t of texTexts) for (const m of String(t ?? "").matchAll(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g)) out.set(m[1].trim(), "bibitem");
  return [...out].map(([key, title]) => ({ key, title }));
}

/**
 * What to complete at the end of `before` (the text left of the cursor):
 * { kind: "ref"|"cite"|"env"|"command"|"file", prefix } or null.
 */
export function latexCompletionContext(before) {
  let m = /\\(?:[a-zA-Z]*ref|autoref|cref|Cref|pageref)\{([^{}]*)$/.exec(before);
  if (m) return { kind: "ref", prefix: m[1] };
  m = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)(?:\[[^\]]*\])*\{(?:[^{}]*,)?\s*([^{},]*)$/.exec(before);
  if (m) return { kind: "cite", prefix: m[1] };
  m = /\\(?:begin|end)\{([^{}]*)$/.exec(before);
  if (m) return { kind: "env", prefix: m[1] };
  m = /\\(?:input|include|includegraphics(?:\[[^\]]*\])?|bibliography|addbibresource)\{([^{}]*)$/.exec(before);
  if (m) return { kind: "file", prefix: m[1] };
  m = /\\([a-zA-Z]*)$/.exec(before);
  if (m) return { kind: "command", prefix: m[1] };
  return null;
}

/**
 * Parses a TeX/LaTeX compile log into problems: [{ severity: "error"|"warning", file, line, message }].
 * Understands `-file-line-error` lines (./main.tex:12: Undefined control sequence), classic "! message" errors with
 * their "l.12" line, LaTeX/package warnings with "on input line N", undefined references and citations, and
 * overfull/underfull boxes (as warnings).
 */
export function parseLatexLog(log, mainFile = "main.tex") {
  const out = [];
  const lines = String(log ?? "").split(/\r?\n/);
  const files = [];
  const current = () => files[files.length - 1] || mainFile;
  const clean = (f) => f.replace(/^\.\//, "");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(/\((\.?\.?\/?[^\s()]+\.(?:tex|sty|cls|bib|bbl))/g)) files.push(clean(m[1]));
    let m = /^(\.?\/?[^:\s]+\.(?:tex|sty|cls|bbl)):(\d+):\s*(.*)$/.exec(line);
    if (m) {
      out.push({ severity: "error", file: clean(m[1]), line: +m[2], message: m[3].trim() });
      continue;
    }
    if (line.startsWith("! ")) {
      let ln = 0;
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const l = /^l\.(\d+)/.exec(lines[j]);
        if (l) {
          ln = +l[1];
          break;
        }
      }
      if (!out.some((p) => p.severity === "error" && p.line === ln && p.message === line.slice(2).trim())) out.push({ severity: "error", file: current(), line: ln, message: line.slice(2).trim() });
      continue;
    }
    m = /^(?:LaTeX|Package [\w-]+|Class [\w-]+) Warning:\s*(.*)$/.exec(line);
    if (m) {
      let msg = m[1];
      for (let j = i + 1; j < lines.length && /^\(\w+\)\s|^\s{4,}\S/.test(lines[j]) && j < i + 6; j++) msg += " " + lines[j].replace(/^\(\w+\)\s*/, "").trim();
      const ln = /on input line (\d+)/.exec(msg);
      out.push({ severity: "warning", file: current(), line: ln ? +ln[1] : 0, message: msg.replace(/\s+/g, " ").trim() });
      continue;
    }
    m = /^(Overfull|Underfull) \\[hv]box .*? (?:in paragraph |detected )?at lines? (\d+)/.exec(line);
    if (m) out.push({ severity: "warning", file: current(), line: +m[2], message: line.trim() });
  }
  return out;
}

/** Supported engines and their allow-listed arguments (no shell escape, non-interactive, stop on the first error). */
export const LATEX_ENGINES = ["latexmk", "pdflatex", "xelatex", "lualatex", "tectonic"];

/** True for a safe main file name: a relative .tex path without "..", not starting with "-". */
export function safeMainFile(main) {
  const m = String(main ?? "");
  return /^[A-Za-z0-9_./ -]+\.tex$/.test(m) && !m.startsWith("-") && !m.startsWith("/") && !m.split("/").includes("..");
}

/** Command-line arguments for an engine (mirrors latex.rs). Throws for unknown engines or unsafe file names. */
export function engineArgs(engine, main) {
  if (!LATEX_ENGINES.includes(engine)) throw new Error(`Unknown TeX engine “${engine}”.`);
  if (!safeMainFile(main)) throw new Error(`Unsafe main file name “${main}”.`);
  if (engine === "tectonic") return ["-X", "compile", "--keep-logs", "--untrusted", main];
  const common = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape"];
  if (engine === "latexmk") return ["-pdf", ...common, main];
  return [...common, main];
}

/** A table snippet with `rows` × `cols` cells (header row first). */
export function tableSnippet({ rows = 3, cols = 3, caption = "Caption", label = "tab:table", header = [] } = {}) {
  rows = Math.max(1, Math.min(50, rows | 0));
  cols = Math.max(1, Math.min(20, cols | 0));
  const head = Array.from({ length: cols }, (_, i) => header[i] ?? `Column ${i + 1}`).join(" & ");
  const body = Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, () => " ").join(" & ").trim() + " \\\\").join("\n    ");
  return `\\begin{table}[htbp]\n  \\centering\n  \\caption{${caption}}\n  \\label{${label}}\n  \\begin{tabular}{${"l".repeat(cols)}}\n    \\hline\n    ${head} \\\\\n    \\hline\n    ${body}\n    \\hline\n  \\end{tabular}\n\\end{table}\n`;
}

/** A figure snippet. */
export function figureSnippet({ file = "image.png", caption = "Caption", label = "fig:figure", width = "0.8\\linewidth" } = {}) {
  return `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=${width}]{${file}}\n  \\caption{${caption}}\n  \\label{${label}}\n\\end{figure}\n`;
}

/** Bibliography commands for a .bib file (BibTeX style). */
export function bibliographySnippet({ file = "references", style = "plain" } = {}) {
  return `\\bibliographystyle{${style}}\n\\bibliography{${file.replace(/\.bib$/i, "")}}\n`;
}

/** Named snippets for latex_insert_snippet. */
export const LATEX_SNIPPETS = {
  itemize: "\\begin{itemize}\n  \\item \n\\end{itemize}\n",
  enumerate: "\\begin{enumerate}\n  \\item \n\\end{enumerate}\n",
  equation: "\\begin{equation}\n  \n  \\label{eq:}\n\\end{equation}\n",
  align: "\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}\n",
  theorem: "\\begin{theorem}\n  \n\\end{theorem}\n",
  frame: "\\begin{frame}{Title}\n  \\begin{itemize}\n    \\item \n  \\end{itemize}\n\\end{frame}\n",
  article: "\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\title{Title}\n\\author{Author}\n\\begin{document}\n\\maketitle\n\\section{Introduction}\n\n\\end{document}\n",
  beamer: "\\documentclass{beamer}\n\\title{Title}\n\\author{Author}\n\\begin{document}\n\\frame{\\titlepage}\n\\begin{frame}{First slide}\n  \\begin{itemize}\n    \\item Point\n  \\end{itemize}\n\\end{frame}\n\\end{document}\n",
};

/** The main .tex file of a project: the one with \documentclass (prefers main.tex), else the first .tex. */
export function findMainTex(paths, textOf) {
  const tex = paths.filter((p) => /\.tex$/i.test(p));
  const withClass = tex.filter((p) => /\\documentclass/.test(textOf(p) || ""));
  return withClass.find((p) => /(^|\/)main\.tex$/i.test(p)) || withClass[0] || tex[0] || null;
}
