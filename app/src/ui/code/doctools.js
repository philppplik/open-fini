// Formatting toolbars for Markdown and LaTeX files (shown above the editor) and the outline of such files.
import { h, empty } from "../../core/util.js";
import { docKind } from "./docpreview.js";
import { renderMarkdown, convertLatex } from "../../engine/web/index.js";

// ------------------------------------------------------------ editing helpers (CodeMirror view)

function wrap(view, before, after, placeholder) {
  const s = view.state.selection.main;
  const text = view.state.sliceDoc(s.from, s.to) || placeholder;
  // toggle: unwrap when the selection is already wrapped
  const a = view.state.sliceDoc(Math.max(0, s.from - before.length), s.from);
  const b = view.state.sliceDoc(s.to, s.to + after.length);
  if (!s.empty && a === before && b === after) {
    view.dispatch({ changes: [{ from: s.from - before.length, to: s.from, insert: "" }, { from: s.to, to: s.to + after.length, insert: "" }], selection: { anchor: s.from - before.length, head: s.to - before.length }, userEvent: "input.format" });
  } else {
    view.dispatch({ changes: { from: s.from, to: s.to, insert: before + text + after }, selection: { anchor: s.from + before.length, head: s.from + before.length + text.length }, userEvent: "input.format" });
  }
  view.focus();
}

function linePrefix(view, prefix, { toggle = true, numbered = false } = {}) {
  const { state } = view;
  const s = state.selection.main;
  const first = state.doc.lineAt(s.from).number;
  const last = state.doc.lineAt(s.to).number;
  const changes = [];
  let n = 1;
  const re = /^(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/;
  for (let i = first; i <= last; i++) {
    const line = state.doc.line(i);
    const p = numbered ? `${n++}. ` : prefix;
    const m = re.exec(line.text);
    if (toggle && line.text.startsWith(p)) changes.push({ from: line.from, to: line.from + p.length, insert: "" });
    else changes.push({ from: line.from, to: line.from + (m && prefix.startsWith("#") === /^#/.test(m[0]) ? m[0].length : 0), insert: p });
  }
  view.dispatch({ changes, userEvent: "input.format" });
  view.focus();
}

function insertBlock(view, text, cursorOffset = null) {
  const s = view.state.selection.main;
  const line = view.state.doc.lineAt(s.from);
  const atStart = s.from === line.from && line.text.trim() === "";
  const insert = (atStart ? "" : "\n\n") + text + "\n";
  const from = atStart ? s.from : line.to;
  view.dispatch({ changes: { from: atStart ? s.from : line.to, to: atStart ? s.to : line.to, insert }, selection: { anchor: from + (atStart ? 0 : 2) + (cursorOffset ?? text.length) }, userEvent: "input.format" });
  view.focus();
}

function insertText(view, text, cursorBack = 0) {
  const s = view.state.selection.main;
  view.dispatch({ changes: { from: s.from, to: s.to, insert: text }, selection: { anchor: s.from + text.length - cursorBack }, userEvent: "input.format" });
  view.focus();
}

// ------------------------------------------------------------ toolbars

const MD = (ws) => {
  const v = () => ws.editors.view;
  return [
    { label: "B", title: "Bold", cls: "b", run: () => wrap(v(), "**", "**", "bold") },
    { label: "I", title: "Italic", cls: "i", run: () => wrap(v(), "*", "*", "italic") },
    { label: "S", title: "Strikethrough", cls: "s", run: () => wrap(v(), "~~", "~~", "text") },
    { label: "</>", title: "Inline code", run: () => wrap(v(), "`", "`", "code") },
    "-",
    { label: "H1", title: "Heading 1", run: () => linePrefix(v(), "# ") },
    { label: "H2", title: "Heading 2", run: () => linePrefix(v(), "## ") },
    { label: "H3", title: "Heading 3", run: () => linePrefix(v(), "### ") },
    "-",
    { icon: "list-ul", title: "Bulleted list", run: () => linePrefix(v(), "- ") },
    { icon: "list-ol", title: "Numbered list", run: () => linePrefix(v(), "1. ", { numbered: true }) },
    { icon: "check2", title: "Task list", run: () => linePrefix(v(), "- [ ] ") },
    { label: "”", title: "Quote", run: () => linePrefix(v(), "> ") },
    "-",
    { icon: "link-45deg", title: "Link", run: () => linkCommand(v()) },
    { icon: "image", title: "Image", run: () => wrap(v(), "![", "](images/picture.png)", "description") },
    { icon: "table", title: "Table", run: () => insertBlock(v(), "| Column | Column |\n| --- | --- |\n| Cell | Cell |", 2) },
    { icon: "code-slash", title: "Code block", run: () => insertBlock(v(), "```js\n\n```", 6) },
    { icon: "hr", title: "Horizontal rule", run: () => insertBlock(v(), "---") },
    { label: "[^1]", title: "Footnote", run: () => insertFootnote(v()) },
    { label: "∑", title: "Math ($…$)", run: () => wrap(v(), "$", "$", "x^2") },
  ];
};

function linkCommand(view) {
  const s = view.state.selection.main;
  const text = view.state.sliceDoc(s.from, s.to) || "text";
  view.dispatch({ changes: { from: s.from, to: s.to, insert: `[${text}](https://)` }, selection: { anchor: s.from + text.length + 4, head: s.from + text.length + 12 }, userEvent: "input.format" });
  view.focus();
}

function insertFootnote(view) {
  const doc = view.state.doc.toString();
  let n = 1;
  while (doc.includes(`[^${n}]`)) n++;
  const s = view.state.selection.main;
  view.dispatch({ changes: [{ from: s.to, insert: `[^${n}]` }, { from: doc.length, insert: `${doc.endsWith("\n") ? "" : "\n"}\n[^${n}]: Footnote text.\n` }], selection: { anchor: s.to + `[^${n}]`.length }, userEvent: "input.format" });
  view.focus();
}

const TEX = (ws) => {
  const v = () => ws.editors.view;
  const cmd = (name, ph) => () => wrap(v(), `\\${name}{`, "}", ph);
  const env = (name, body = "  ") => () => insertBlock(v(), `\\begin{${name}}\n${body}\n\\end{${name}}`, `\\begin{${name}}\n`.length + body.length);
  return [
    { label: "B", title: "Bold (\\textbf)", cls: "b", run: cmd("textbf", "bold") },
    { label: "I", title: "Italic (\\emph)", cls: "i", run: cmd("emph", "text") },
    { label: "T", title: "Typewriter (\\texttt)", run: cmd("texttt", "code") },
    "-",
    { label: "§", title: "Section", run: () => insertBlock(v(), "\\section{Title}\n", 9) },
    { label: "§§", title: "Subsection", run: () => insertBlock(v(), "\\subsection{Title}\n", 12) },
    "-",
    { icon: "list-ul", title: "Itemize", run: env("itemize", "  \\item First\n  \\item Second") },
    { icon: "list-ol", title: "Enumerate", run: env("enumerate", "  \\item First\n  \\item Second") },
    { icon: "table", title: "Table", run: () => insertBlock(v(), "\\begin{tabular}{ll}\n  A & B \\\\\n  C & D \\\\\n\\end{tabular}") },
    { icon: "image", title: "Figure", run: () => insertBlock(v(), "\\begin{figure}\n  \\centering\n  \\includegraphics[width=0.6\\textwidth]{images/picture.png}\n  \\caption{Caption}\n  \\label{fig:one}\n\\end{figure}") },
    "-",
    { label: "$x$", title: "Inline math", run: () => wrap(v(), "$", "$", "x^2") },
    { label: "∑", title: "Equation", run: env("equation", "  E = mc^2") },
    { label: "cite", title: "Citation (\\cite)", run: () => insertText(v(), "\\cite{key}", 1) },
    { label: "ref", title: "Reference (\\ref)", run: () => insertText(v(), "\\ref{label}", 1) },
    { label: "fn", title: "Footnote", run: cmd("footnote", "note") },
  ];
};

/** Fills the format bar for the active file (hidden for other file types). */
export function createDocTools(ws) {
  const bar = ws.editors.fmtbar;
  function render() {
    const kind = docKind(ws.editors.active);
    empty(bar);
    bar.classList.toggle("hidden", !(kind === "markdown" || kind === "latex"));
    if (kind !== "markdown" && kind !== "latex") return;
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", kind === "markdown" ? "Markdown formatting" : "LaTeX commands");
    for (const item of kind === "markdown" ? MD(ws) : TEX(ws)) {
      if (item === "-") {
        bar.append(h("span.of-fmtbar__sep"));
        continue;
      }
      const btn = h("button.of-fmtbtn", { type: "button", title: item.title, "aria-label": item.title.replace(/\s*\(.*\)$/, ""), class: item.cls || "" }, item.icon ? h("sl-icon", { name: item.icon }) : item.label);
      btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor selection
      btn.addEventListener("click", () => item.run());
      bar.append(btn);
    }
  }
  ws.editors.on("active", render);
  render();
  return { render };
}

// ------------------------------------------------------------ outline of documents

/** Heading outline of a Markdown or LaTeX file: [{ level, title, line }] (level 1 = top). */
export function documentOutline(path, text) {
  const kind = docKind(path);
  if (kind === "markdown") {
    const r = renderMarkdown(text, { math: false, headingIds: true });
    return r.headings.map((x) => ({ level: x.level, title: x.text, line: x.line || 1 }));
  }
  if (kind === "latex") {
    const r = convertLatex(text, { today: "" });
    return r.outline.map((o) => ({ level: Math.max(1, o.level - 1), title: `${o.number ? `${o.number} ` : ""}${o.title}`, line: o.line }));
  }
  return [];
}
