// Vibe tools for frameworks, libraries and document files (Markdown, LaTeX) in the Code studio.
import { tool, S } from "./helpers.js";
import * as E from "../../engine/web/index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (text, n = 30000) => (text.length > n ? `${text.slice(0, n)}\n… (${text.length - n} more characters)` : text);

export function frameworkTools(app) {
  /** The built Code studio workspace of the active document (switching to the studio when asked). */
  async function workspace({ show = false } = {}) {
    const doc = app.doc;
    if (!doc?.web) throw new Error("The active document has no website project. Use create_website or create_markdown_document first.");
    const home = app.studio;
    if (home !== "code" && (show || home === "vibe") && !(app.codeUI?.built && app.codeUI.doc === doc)) app.setStudio("code");
    for (let i = 0; i < 100; i++) {
      const ws = app.codeUI;
      if (ws?.built && ws.doc === doc) {
        if (home === "vibe" && app.studio !== "vibe") app.setStudio("vibe");
        return ws;
      }
      await sleep(50);
    }
    if (home === "vibe") app.setStudio("vibe");
    throw new Error("The Code studio did not finish loading.");
  }
  const manager = async () => {
    const ws = await workspace();
    const { libraryManager } = await import("../../ui/code/libraries.js");
    return libraryManager(ws);
  };
  const fileText = async (a) => {
    if (typeof a.text === "string") return { text: a.text, path: a.path || "" };
    if (!a.path) throw new Error("Pass either the text itself or the path of a project file.");
    const ws = await workspace();
    const text = ws.web.text(E.normalizePath(a.path));
    if (text == null) throw new Error(`“${a.path}” does not exist or is not a text file. Call list_files.`);
    return { text, path: E.normalizePath(a.path) };
  };

  return [
    tool("list_templates", "Lists the website templates for create_website: plain HTML starters plus framework starters (Tailwind CSS, Bootstrap, Alpine.js, htmx, Vue, Preact, React, Lit, web components, Three.js), Markdown blog and docs sites, and a PWA. All run without a build step.", {
      framework: S.bool("Only framework, Markdown and PWA templates"),
    }, [], async (a) => E.TEMPLATES.filter((t) => !a.framework || t.framework).map((t) => ({ id: t.id, name: t.name, description: t.description, category: t.category, libraries: t.libs || [], files: Object.keys(t.files).length })), { readOnly: true }),

    tool("list_libraries", "Lists the libraries the website project uses (script and stylesheet tags, import map entries, CDN imports in JavaScript) and the catalog of popular libraries that add_library can add by id.", {
      catalog: S.bool("Also list the catalog entries (default true)"),
    }, [], async (a) => {
      const ws = await workspace();
      const { libraryManager } = await import("../../ui/code/libraries.js");
      const mgr = libraryManager(ws);
      const installed = mgr.list().map((l) => ({ name: l.name, version: l.version, kind: l.kind, file: l.file, specifier: l.specifier, url: l.url, vendored: l.vendored }));
      return a.catalog === false ? { installed } : { installed, catalog: E.CATALOG.map((c) => ({ id: c.id, name: c.name, version: c.version, kind: c.kind, specifier: c.specifier, description: c.description, note: c.note })) };
    }, { readOnly: true }),

    tool("search_packages", "Searches npm packages (or cdnjs libraries) that can be added with add_library. Uses the network.", {
      query: S.str("Search text, e.g. chart or date picker"), source: S.str("Where to search", { enum: ["npm", "cdnjs"] }),
    }, ["query"], async (a) => {
      const mgr = await manager();
      const results = await mgr.search(a.query, a.source || "npm");
      return results.slice(0, 15);
    }, { needsApproval: (a) => `Search ${a.source === "cdnjs" ? "cdnjs" : "the npm registry"} for “${a.query}” (network access)?` }),

    tool("add_library", "Adds a library to an HTML page: a catalog id (see list_libraries), or a package from npm/jsDelivr with an explicit url. Stylesheets and scripts become tags, ES modules become import map entries. With download=true the files are stored in vendor/ so the exported site works offline. Uses the network only for download or when you pass a package that needs lookups.", {
      id: S.str("Catalog id such as tailwind, bootstrap-css, bootstrap-js, alpine, htmx, vue, react, lit, three, chartjs"),
      url: S.str("A jsDelivr, cdnjs or unpkg URL (instead of id)"),
      kind: S.str("For url: how to use it", { enum: ["script", "module", "style"] }),
      specifier: S.str("For modules: the name used in import statements, e.g. lodash-es"),
      page: S.str("HTML file to add it to (default: the current page)"),
      download: S.bool("Download into the project (vendor/) for offline use"),
    }, [], async (a) => {
      if (!a.id && !a.url) throw new Error("Pass a catalog id or a url.");
      if (a.url && !a.kind) throw new Error("A url needs kind: script, module or style.");
      const mgr = await manager();
      const res = await mgr.install(a.id ? { id: a.id, page: a.page } : { kind: a.kind, url: a.url, specifier: a.specifier, page: a.page, defer: true }, { vendor: !!a.download });
      return { added: res.added, page: res.page, vendored: res.vendored ? { entry: res.vendored.entry, files: res.vendored.files.length, warnings: res.vendored.warnings } : null };
    }, { needsApproval: (a) => `Add the library ${a.id || a.url} to the page${a.download ? " and download its files into the project" : " (it loads from a CDN when the page opens)"}? This uses the network.` }),

    tool("render_markdown", "Renders Markdown (CommonMark with tables, task lists, strikethrough, footnotes, front matter) to sanitized HTML and returns headings, title and word count. Pass the text or a project file path. Nothing is changed.", {
      text: S.str("Markdown source"), path: S.str("Project file path (instead of text)"), math: S.bool("Treat $…$ as math placeholders"),
    }, [], async (a) => {
      const { text, path } = await fileText(a);
      const r = E.renderMarkdown(text, { math: !!a.math, mdx: /\.mdx$/i.test(path), idPrefix: "" });
      return { title: r.title, words: r.words, headings: r.headings.map((h) => ({ level: h.level, text: h.text, id: h.id })), meta: r.meta, hasMath: r.hasMath, html: clip(r.html) };
    }, { readOnly: true }),

    tool("convert_latex_preview", "Converts LaTeX source (a practical subset: sections, text styles, lists, tables, figures, theorems, citations, references, footnotes, simple macros, math placeholders) to preview HTML and reports unsupported commands. This is a preview, not a TeX engine. Nothing is changed.", {
      text: S.str("LaTeX source"), path: S.str("Project file path (instead of text), e.g. main.tex"),
    }, [], async (a) => {
      const { text, path } = await fileText(a);
      let readFile;
      let bib = "";
      if (path && app.doc?.web) {
        const web = app.doc.web;
        const dir = E.dirname(path);
        readFile = (p) => web.text(E.joinPath(dir, p)) ?? web.text(p);
        bib = "";
      }
      const r = E.convertLatex(text, { readFile, bib });
      return {
        title: r.title, author: r.author, words: r.stats.words, formulas: r.stats.math, outline: r.outline.map((o) => ({ level: o.level, number: o.number, title: o.title, line: o.line })),
        unsupported: r.unsupported, diagnostics: r.diagnostics.filter((d) => d.severity !== "info").slice(0, 60), citations: r.citations, html: clip(r.html),
      };
    }, { readOnly: true }),

    tool("create_markdown_document", "Creates a Markdown (.md) or LaTeX (.tex) file and opens it in the Code studio with a live preview. Without a website project in the document it opens as a one-file project.", {
      path: S.str("File name, e.g. notes.md or paper.tex"), content: S.str("The complete file content"),
    }, ["path", "content"], async (a) => {
      const path = E.normalizePath(a.path);
      if (!/\.(md|markdown|mdx|tex|latex|bib|txt)$/i.test(path)) throw new Error("Use a .md, .markdown, .mdx, .tex, .bib or .txt file name.");
      if (!app.doc?.web) {
        const { openTextDocument } = await import("../../ui/code/open-document.js");
        await openTextDocument(app, { name: path.split("/").pop(), bytes: new TextEncoder().encode(a.content) });
        const ws = await workspace();
        return { path: ws.web.entry, created: true, project: "one-file" };
      }
      const ws = await workspace({ show: true });
      const f = ws.web.has(path) ? (ws.web.setText(path, a.content, "api"), ws.web.get(path)) : ws.web.create(path, a.content);
      ws.openFile(f.path, { focus: false });
      return { path: f.path, created: true, preview: ws.documentKind || null };
    }),
  ];
}
