// OpenFini tools for the Code studio: website files, HTML elements, styles, problems.
import { tool, S } from "./helpers.js";
import { Doc } from "../../core/doc.js";
import { ensureWeb } from "../../core/web.js";
import * as E from "../../engine/web/index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function webTools(app) {
  /** The Code studio workspace of the active document (built), or a helpful error. */
  async function workspace({ show = true } = {}) {
    const doc = app.doc;
    if (!doc?.web) throw new Error("The active document has no website project. Use create_website first.");
    const home = app.studio;
    // the website editor lives in the Code studio; from Vibe Studio it is built there and the user is sent back
    const needsSwitch = home !== "code" && (show || home === "vibe");
    if (needsSwitch && !(app.codeUI?.built && app.codeUI.doc === doc)) app.setStudio("code");
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
  const el = (ws, id) => {
    const parsed = ws.model.html(ws.page);
    const e = parsed?.elements[id];
    if (!e) throw new Error(`There is no element with id ${id} on ${ws.page}. Call get_page_outline for current ids (ids change after structural edits).`);
    return e;
  };
  const brief = (parsed, e) => {
    const cls = E.classList(e);
    const text = (e.children.find((c) => c.type === "text" && c.text.trim())?.text || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${e.tag}${E.getAttr(e, "id") ? `#${E.getAttr(e, "id")}` : ""}${cls.length ? `.${cls.join(".")}` : ""}${text ? ` “${text}”` : ""}`;
  };

  return [
    tool("create_website", "Creates a new website project (in a new document) from a template or from your own files, and opens the Code studio. Templates: blank, landing, portfolio, blog, docs, link-in-bio.", {
      name: S.str("Project name"), template: S.str("Template id", { enum: E.TEMPLATES.map((t) => t.id) }),
      files: { type: "object", description: "Optional { path: text } files that replace/extend the template (e.g. {'index.html': '…', 'css/style.css': '…'})", additionalProperties: { type: "string" } },
    }, [], async (a) => {
      const t = E.TEMPLATES.find((x) => x.id === (a.template || "blank")) || E.TEMPLATES[0];
      const files = { ...t.files, ...(a.files || {}) };
      const doc = new Doc({ name: a.name || t.name, width: 1280, height: 800, studio: "code" });
      ensureWeb(doc, files);
      doc.history.clear();
      doc.saved = false;
      app.openDoc(doc);
      if (app.studio !== "vibe") app.setStudio("code");
      const ws = await workspace();
      return { template: t.id, files: [...ws.web.files.keys()], entry: ws.web.entry };
    }),

    tool("list_files", "Lists the files of the website project.", {}, [], async () => {
      const ws = await workspace({ show: false });
      return { entry: ws.web.entry, files: ws.web.paths.map((p) => ({ path: p, bytes: ws.web.bytes(p)?.length ?? 0, text: ws.web.isText(p) })) };
    }, { readOnly: true }),

    tool("read_file", "Reads a text file of the project (optionally a line range). Line numbers are 1-based.", {
      path: S.str("File path, e.g. css/style.css"), startLine: S.num("First line", { minimum: 1 }), endLine: S.num("Last line", { minimum: 1 }),
    }, ["path"], async (a) => {
      const ws = await workspace({ show: false });
      const text = ws.web.text(a.path);
      if (text == null) throw new Error(`“${a.path}” does not exist or is not a text file. Call list_files.`);
      const lines = text.split("\n");
      const s = (a.startLine || 1) - 1;
      const e = a.endLine || lines.length;
      return `${a.path} (${lines.length} lines)\n${lines.slice(s, e).map((l, i) => `${s + i + 1}\t${l}`).join("\n")}`;
    }, { readOnly: true }),

    tool("write_file", "Creates or fully replaces a text file (HTML, CSS, JS, JSON, SVG, Markdown). The preview updates live. For small changes prefer edit_file.", {
      path: S.str("File path, folders allowed (css/theme.css)"), content: S.str("The complete new file content"),
    }, ["path", "content"], async (a) => {
      const ws = await workspace();
      const path = E.normalizePath(a.path);
      if (!E.isTextPath(path)) throw new Error("Only text files can be written. Use SVG for images.");
      if (!ws.web.has(path)) ws.web.create(path, a.content);
      else {
        const old = ws.web.text(path);
        const { trimmedChange } = await import("../../ui/code/util.js");
        ws.editors.applyChanges(path, [trimmedChange(old, a.content)], { userEvent: "input.ai" });
      }
      if (/\.html?$/i.test(path) && !ws.page) ws.showPage(path);
      return { ok: true, path, lines: a.content.split("\n").length };
    }),

    tool("edit_file", "Replaces exact text in a file. oldText must match exactly once (unless replaceAll).", {
      path: S.str("File path"), oldText: S.str("Exact text to find"), newText: S.str("Replacement"), replaceAll: S.bool("Replace every occurrence"),
    }, ["path", "oldText", "newText"], async (a) => {
      const ws = await workspace();
      const text = ws.web.text(a.path);
      if (text == null) throw new Error(`“${a.path}” does not exist. Call list_files.`);
      const count = text.split(a.oldText).length - 1;
      if (!count) throw new Error("oldText was not found. Read the file again and copy the exact text including whitespace.");
      if (count > 1 && !a.replaceAll) throw new Error(`oldText matches ${count} places; make it longer to be unique or set replaceAll.`);
      const changes = [];
      let from = 0;
      for (let i = text.indexOf(a.oldText); i >= 0 && (a.replaceAll || !changes.length); i = text.indexOf(a.oldText, from)) {
        changes.push({ from: i, to: i + a.oldText.length, insert: a.newText });
        from = i + a.oldText.length;
      }
      ws.editors.applyChanges(a.path, changes, { userEvent: "input.ai" });
      return { ok: true, replaced: changes.length };
    }),

    tool("delete_file", "Deletes a project file or folder.", { path: S.str("Path") }, ["path"], async (a) => {
      const ws = await workspace();
      return { deleted: ws.web.remove(a.path) };
    }, { needsApproval: (a) => `Delete “${a.path}” from the website project?` }),

    tool("rename_file", "Renames or moves a file or folder and updates links to it.", { from: S.str("Current path"), to: S.str("New path") }, ["from", "to"], async (a) => {
      const ws = await workspace();
      const pairs = ws.web.rename(a.from, a.to);
      ws.afterRename(pairs);
      return { moved: pairs.length };
    }),

    tool("get_page_outline", "Returns the element tree of the page shown in the Code studio (tag, id, classes, text, element ids). Element ids are valid until the next structural edit.", {
      page: S.str("HTML file (default: the page in the preview)"), maxDepth: S.num("Depth limit (default 6)"),
    }, [], async (a) => {
      const ws = await workspace({ show: false });
      if (a.page) ws.showPage(a.page);
      const parsed = ws.model.html(ws.page);
      const lines = [`${ws.page}`];
      const walk = (nodes, depth) => {
        for (const e of nodes) {
          if (e.type !== "element" || e.tag === "script" || e.tag === "style") continue;
          if (depth > (a.maxDepth ?? 6) || (e.tag === "svg")) {
            if (e.tag === "svg") lines.push(`${"  ".repeat(depth)}[${e.id}] svg`);
            continue;
          }
          lines.push(`${"  ".repeat(depth)}[${e.id}] ${brief(parsed, e)}`);
          walk(e.children, depth + 1);
        }
      };
      walk(parsed.children.filter((c) => c.type === "element").flatMap((c) => (c.tag === "html" ? c.children : [c])).filter((c) => c.tag !== "head"), 0);
      return lines.slice(0, 400).join("\n");
    }, { readOnly: true }),

    tool("select_element", "Selects an element in the designer (so the user sees it).", { id: S.num("Element id from get_page_outline") }, ["id"], async (a) => {
      const ws = await workspace();
      el(ws, a.id);
      ws.selectElement(a.id, { scroll: true });
      return { ok: true };
    }),

    tool("inspect_element", "Returns computed styles and the rendered size of an element in the live preview at the current breakpoint — use it to check spacing and layout.", {
      id: S.num("Element id"), props: { type: "array", items: { type: "string" }, description: "CSS properties (default: layout basics)" },
    }, ["id"], async (a) => {
      const ws = await workspace();
      el(ws, a.id);
      const r = await ws.preview.computed(a.id, a.props?.length ? a.props : ["display", "position", "width", "height", "margin", "padding", "font-size", "font-weight", "color", "background-color", "flex-direction", "justify-content", "align-items", "gap"]);
      if (!r) throw new Error("The preview is not ready or the element is not rendered.");
      return { tag: r.tag, rect: r.rect, values: r.values, breakpoint: ws.preview.bp.label };
    }, { readOnly: true }),

    tool("list_elements", "Lists the insertable ready-made elements and sections (hero, feature grid, pricing, FAQ, form fields, …).", {}, [], () => E.ELEMENT_CATEGORIES.map((c) => ({ category: c.label, items: c.items.map((i) => `${i.id} — ${i.label}`) })), { readOnly: true }),

    tool("insert_element", "Inserts a ready-made element/section (see list_elements) into the page, with its CSS.", {
      elementId: S.str("Catalog id, e.g. hero, feature-grid, faq"), parentId: S.num("Parent element id (default: after the selection / end of body)"), index: S.num("Position among the parent's element children"),
    }, ["elementId"], async (a) => {
      const ws = await workspace();
      let def = null;
      for (const c of E.ELEMENT_CATEGORIES) def ||= c.items.find((i) => i.id === a.elementId);
      if (!def) throw new Error(`Unknown element “${a.elementId}”. Call list_elements.`);
      if (a.parentId != null) el(ws, a.parentId);
      const ok = ws.insertElement(def, a.parentId ?? undefined, a.index);
      return { ok, selected: ws.selection?.id ?? null };
    }),

    tool("insert_html", "Inserts custom HTML markup as a child of an element (or at the top level of the body). Include classes; add the CSS with edit_file/write_file.", {
      html: S.str("HTML fragment"), parentId: S.num("Parent element id; omit for the body"), index: S.num("Position among element children (default: end)"),
    }, ["html"], async (a) => {
      const ws = await workspace();
      if (a.parentId != null) el(ws, a.parentId);
      const ok = ws.editElement((p) => E.insertHtml(p, a.parentId ?? null, a.index ?? Number.MAX_SAFE_INTEGER, a.html), { select: "new" });
      if (!ok) throw new Error("The markup could not be inserted (it may be invalid HTML).");
      return { selected: ws.selection?.id ?? null };
    }),

    tool("set_element_style", "Styles an element through its class at a breakpoint (writes the CSS rule and @media block for you). A class is created when the element has none.", {
      id: S.num("Element id"), props: { type: "object", description: "CSS declarations as { 'font-size': '48px', 'background-color': '#111' }; null removes one", additionalProperties: { type: ["string", "null"] } },
      breakpoint: S.str("Breakpoint", { enum: ["desktop-2xl", "desktop-xl", "desktop", "tablet", "mobile-landscape", "mobile-portrait"] }), className: S.str("Class to style (default: the element's last class)"),
    }, ["id", "props"], async (a) => {
      const ws = await workspace();
      el(ws, a.id);
      ws.selectElement(a.id);
      if (a.breakpoint) ws.preview.setBreakpoint(a.breakpoint);
      if (a.className) ws.setStyleSelector(`.${a.className.replace(/^\./, "")}`);
      const ok = ws.setStyle(a.props);
      const t = ws.styleTarget();
      return { ok, selector: t?.selector || "(inline)", breakpoint: ws.preview.bp.label };
    }),

    tool("set_element_attributes", "Sets or removes attributes (href, src, alt, id, class, aria-*, …) of an element. Value null removes the attribute.", {
      id: S.num("Element id"), attributes: { type: "object", additionalProperties: { type: ["string", "null"] } }, text: S.str("Replace the element's text content"),
    }, ["id"], async (a) => {
      const ws = await workspace();
      el(ws, a.id);
      ws.selectElement(a.id);
      for (const [k, v] of Object.entries(a.attributes || {})) ws.setAttribute(k, v);
      if (a.text != null) ws.applyTextEdit(a.id, a.text, false);
      return { ok: true };
    }),

    tool("set_page_meta", "Sets the page title, meta description and language of the current page.", { title: S.str("Title"), description: S.str("Meta description"), lang: S.str("Language code, e.g. en-US") }, [], async (a) => {
      const ws = await workspace();
      ws.setPageMeta(a);
      return ws.pageMeta();
    }),

    tool("show_page", "Shows another HTML page of the project in the designer and, with breakpoint, switches the preview width.", { path: S.str("HTML file"), breakpoint: S.str("Breakpoint id") }, [], async (a) => {
      const ws = await workspace();
      if (a.path) ws.showPage(a.path);
      if (a.breakpoint) ws.preview.setBreakpoint(a.breakpoint);
      return { page: ws.page, breakpoint: ws.preview.bp.id };
    }),

    tool("check_problems", "Runs the HTML/CSS/JS/JSON checks and the preview's missing-file checks; also returns recent console output of the page. Fix what it reports.", {}, [], async () => {
      const ws = await workspace({ show: false });
      ws.computeProblems();
      return { problems: ws._problems.slice(0, 40).map((p) => `${p.severity} ${p.path}: ${p.message}`), console: ws.consoleLines.slice(-15).map((l) => `${l.level}: ${l.text}`) };
    }, { readOnly: true }),
  ];
}
