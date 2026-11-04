// Vibe tools for LaTeX projects in the Code studio (group "LaTeX"): outline, compile with a TeX engine (approval),
// snippets, tables, figures, bibliography and error help from the compile log. See docs/latex.md.
import { tool, S } from "./helpers.js";
import * as E from "../../engine/web/index.js";

export function latexTools(app) {
  const web = () => {
    const w = app.doc?.web;
    if (!w) throw new Error("The active document has no project. Open a folder with .tex files or call create_website first.");
    return w;
  };
  const texPath = (w, path) => {
    const p = path ? E.normalizePath(path) : app.codeUI?.editors?.active && /\.(tex|latex)$/i.test(app.codeUI.editors.active) ? app.codeUI.editors.active : E.findMainTex(w.paths, (x) => w.text(x));
    if (!p || w.text(p) == null) throw new Error(path ? `“${path}” is not a text file in the project. Call list_files.` : "The project has no .tex file.");
    return p;
  };
  /** Inserts `snippet` at a 1-based line, else before \end{document}, else at the end. */
  const insert = (a, snippet) => {
    const w = web();
    const path = texPath(w, a.path);
    const text = w.text(path);
    const lines = text.split("\n");
    let at;
    if (a.line > 0) at = Math.min(lines.length, a.line - 1);
    else {
      const end = lines.findIndex((l) => /\\end\{document\}/.test(l));
      at = end >= 0 ? end : lines.length;
    }
    lines.splice(at, 0, snippet.replace(/\n$/, ""));
    w.setText(path, lines.join("\n"), "api");
    return { path, line: at + 1, inserted: snippet };
  };
  const line = S.num("1-based line to insert before (default: before \\end{document})");
  const path = S.str("Project path of the .tex file (default: the open or main .tex file)");

  return [
    tool("latex_outline", "Outline of a LaTeX document: sections with line numbers, labels, citation keys used and the keys available in the project's .bib files, plus the main file.", { path }, [], async (a) => {
      const w = web();
      const p = texPath(w, a.path);
      const text = w.text(p);
      const r = E.convertLatex(text, { readFile: (f) => w.text(E.joinPath(E.dirname(p), f)) ?? w.text(f) });
      const cited = [...new Set([...text.matchAll(/\\\w*cite\w*(?:\[[^\]]*\])*\{([^}]+)\}/g)].flatMap((m) => m[1].split(",").map((s) => s.trim())))];
      const bib = E.bibKeys(w.paths.filter((x) => /\.bib$/i.test(x)).map((x) => w.text(x)), [text]);
      return { path: p, main: E.findMainTex(w.paths, (x) => w.text(x)), sections: r.outline.map((o) => ({ level: o.level, number: o.number, title: o.title, line: o.line })), labels: E.latexLabels(text), cited, bibliography: bib.slice(0, 300), missingKeys: cited.filter((k) => !bib.some((b) => b.key === k)) };
    }, { readOnly: true }),

    tool("latex_compile", "Compiles the LaTeX project to PDF with the TeX engine installed on this computer (desktop app) or the remote service set in the settings. Returns errors and warnings from the log with file and line. Optionally adds the PDF to the project.", {
      path, add_pdf: S.bool("Also add the PDF to the project next to the main file"),
    }, [], async (a) => {
      const w = web();
      const { compileLatex } = await import("../../ui/code/latex-compile.js");
      const r = await compileLatex(app, w, a.path ? texPath(w, a.path) : null);
      if (app.codeUI?.docPreview) app.codeUI.docPreview.lastCompile = r;
      let pdfPath = null;
      if (a.add_pdf && r.pdf) {
        pdfPath = r.main.replace(/\.(tex|latex)$/i, ".pdf");
        w.put(pdfPath, r.pdf);
      }
      return { ok: r.ok, engine: r.engine, via: r.via, main: r.main, timedOut: r.timedOut, pdfBytes: r.pdf?.length || 0, pdfPath, problems: r.problems.slice(0, 40), logTail: r.log.slice(-3000) };
    }, { needsApproval: () => "Run the TeX engine on this project (or send it to the configured remote compile service)?" }),

    tool("latex_insert_snippet", "Inserts a ready-made LaTeX snippet (itemize, enumerate, equation, align, theorem, beamer frame, or a whole article or beamer skeleton) into a .tex file.", {
      path, line, snippet: S.str("Snippet name", { enum: Object.keys(E.LATEX_SNIPPETS) }),
    }, ["snippet"], async (a) => insert(a, E.LATEX_SNIPPETS[a.snippet])),

    tool("latex_insert_table", "Inserts a LaTeX table (table + tabular with caption and label) into a .tex file.", {
      path, line, rows: S.num("Rows including the header row"), cols: S.num("Columns"), caption: S.str("Caption"), label: S.str("Label, e.g. tab:results"),
      header: { type: "array", items: { type: "string" }, description: "Header cells" },
    }, [], async (a) => insert(a, E.tableSnippet(a))),

    tool("latex_insert_figure", "Inserts a LaTeX figure (includegraphics with caption and label) into a .tex file. The image should be a project file.", {
      path, line, file: S.str("Image path relative to the .tex file"), caption: S.str("Caption"), label: S.str("Label, e.g. fig:overview"), width: S.str("Width, e.g. 0.8\\linewidth"),
    }, ["file"], async (a) => insert(a, E.figureSnippet(a))),

    tool("latex_insert_bibliography", "Adds BibTeX bibliography commands before \\end{document} and, when asked, creates the .bib file with the given entries.", {
      path, file: S.str("Bibliography file name, e.g. references.bib"), style: S.str("BibTeX style, e.g. plain, alpha, abbrvnat"), entries: S.str("BibTeX entries to add to the .bib file"),
    }, [], async (a) => {
      const w = web();
      const bib = E.normalizePath(a.file || "references.bib").replace(/(\.bib)?$/i, ".bib");
      const p = texPath(w, a.path);
      const target = E.joinPath(E.dirname(p), bib);
      if (a.entries) w.has(target) ? w.setText(target, `${w.text(target).replace(/\s*$/, "")}\n\n${a.entries.trim()}\n`, "api") : w.create(target, `${a.entries.trim()}\n`);
      else if (!w.has(target)) w.create(target, "");
      const already = /\\bibliography\{/.test(w.text(p));
      const res = already ? { path: p, inserted: "" } : insert({ path: p }, E.bibliographySnippet({ file: bib, style: a.style || "plain" }));
      return { ...res, bibFile: target, keys: E.bibKeys([w.text(target)]).map((k) => k.key) };
    }),

    tool("latex_fix_errors", "Reads the errors of the last compile (or a log you pass) and returns each with its file, line, the source lines around it and a hint. Then fix them with edit_file and compile again.", {
      log: S.str("Compile log text (default: the last latex_compile result)"),
    }, [], async (a) => {
      const w = web();
      const last = app.codeUI?.docPreview?.lastCompile;
      const log = a.log ?? last?.log;
      if (!log) throw new Error("No compile log yet. Call latex_compile first (or pass the log).");
      const main = last?.main || E.findMainTex(w.paths, (x) => w.text(x)) || "main.tex";
      const hint = (m) =>
        /Undefined control sequence/.test(m) ? "A command is misspelled or its package is missing (\\usepackage)." :
        /Missing \$ inserted/.test(m) ? "Math (_ ^ \\alpha …) outside $…$, or an unescaped _ in text (write \\_)." :
        /File `([^']+)' not found/.test(m) ? "A package or file is missing: check the name or add the file to the project." :
        /Environment .* undefined/.test(m) ? "The environment needs a package (amsthm, algorithm …) or is misspelled." :
        /Extra }|Missing }|Runaway argument/.test(m) ? "Unbalanced braces near this line." :
        /\\begin\{[^}]+\} .*ended by \\end/.test(m) ? "\\begin and \\end do not match." :
        /Citation .* undefined/.test(m) ? "The key is not in the .bib file, or BibTeX/biber has not run (latexmk runs it)." :
        /Reference .* undefined/.test(m) ? "No \\label with this key, or one more compile run is needed." : "";
      return E.parseLatexLog(log, main).slice(0, 40).map((p) => {
        const file = w.has(p.file) ? p.file : main;
        const lines = (w.text(file) || "").split("\n");
        const from = Math.max(0, (p.line || 1) - 3);
        return { ...p, file, hint: hint(p.message), context: lines.slice(from, from + 5).map((l, i) => `${from + i + 1}: ${l}`).join("\n") };
      });
    }, { readOnly: true }),
  ];
}
