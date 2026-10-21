// Markdown sites in the Code studio: regenerates the HTML pages when content/, layouts/ or site.json change, and
// creates new Markdown / LaTeX documents. The generator itself is pure (engine/web/ssg.js).
import { buildMarkdownSite, planWrites, usesMarkdownSite, isSiteSource } from "../../engine/web/index.js";

const timers = new WeakMap();

/** Regenerates the pages now. Returns { written, skipped, diagnostics }. */
export function buildNow(ws, { toast = false } = {}) {
  const web = ws.web;
  if (!usesMarkdownSite(web.source)) {
    if (toast) ws.app.toast("This project has no content/ folder with Markdown files and a layouts/ folder.", "warning", 3500);
    return { written: [], skipped: [], diagnostics: [] };
  }
  const build = buildMarkdownSite(web.source);
  const plan = planWrites(build, web.source);
  for (const [path, html] of Object.entries(plan.write)) {
    if (web.has(path)) web.setText(path, html, "api");
    else web.create(path, html);
  }
  const written = Object.keys(plan.write);
  if (toast) {
    const problems = build.diagnostics.filter((d) => d.severity !== "info");
    ws.app.toast(
      `${written.length ? `Updated ${written.length} page${written.length === 1 ? "" : "s"}` : "Pages are up to date"} from Markdown.${plan.skipped.length ? ` Skipped ${plan.skipped.length} hand-written file${plan.skipped.length === 1 ? "" : "s"}: ${plan.skipped.slice(0, 2).join(", ")}.` : ""}${problems.length ? ` ${problems[0].message}` : ""}`,
      problems.length || plan.skipped.length ? "warning" : "success",
      4200,
    );
  }
  return { written, skipped: plan.skipped, diagnostics: build.diagnostics };
}

/** Debounced rebuild after a source file changed. */
export function scheduleBuild(ws) {
  if (ws.web.settings.mdAuto === false) return;
  clearTimeout(timers.get(ws));
  timers.set(
    ws,
    setTimeout(() => {
      try {
        buildNow(ws);
      } catch (err) {
        console.error(err);
      }
    }, 450),
  );
}

export { isSiteSource };

const MD_START = `# Untitled

Start writing. Markdown supports **bold**, *italic*, \`code\`, [links](https://example.com), lists, tables and more.

## A list

- First
- Second

## A table

| Name | Value |
| --- | --- |
| One | 1 |
`;

const TEX_START = String.raw`\documentclass{article}
\title{Untitled}
\author{Your name}
\begin{document}
\maketitle

\section{Introduction}
Write your text here. Inline math looks like $a^2 + b^2 = c^2$.

\begin{equation}
  \int_0^1 x^2\,dx = \frac{1}{3}
\end{equation}

\end{document}
`;

/** Creates and opens a new document file in the project. */
export function newDocument(ws, kind) {
  const name = kind === "tex" ? "document.tex" : "document.md";
  const f = ws.web.createUnique(name, kind === "tex" ? TEX_START : MD_START);
  ws.openFile(f.path, { focus: true });
  return f.path;
}
