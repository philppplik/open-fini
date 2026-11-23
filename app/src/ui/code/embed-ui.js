// Explorer ▸ "Embed in current file", "Copy relative path", "Inline as data URI" and drag and drop of a project file
// into the editor: inserts the reference engine/web/embed.js picks for the two file types at the caret (or the drop
// point). One undo step per insertion; block snippets (<link>, <script>, imports …) go on a line of their own.
// Docs: docs/code-studio.md ▸ "Embedding files".
import { t } from "../../i18n/index.js";
import { embedSnippet, relativeRef, canInline, dataUriFor, INLINE_LIMIT } from "../../engine/web/index.js";

/** The path of the file open in the editor that a reference would go into, or null. */
const activeTarget = (ws) => {
  const p = ws.editors?.active;
  return p && ws.web.isText(p) && ws.editors.view ? p : null;
};

/**
 * Context-menu entries of the Explorer for a file.
 * @param {object} ws Code studio workspace
 * @param {string} path the file that was right-clicked
 */
export function embedMenuItems(ws, path) {
  const target = activeTarget(ws);
  const size = ws.web.get(path)?.bytes?.length ?? ws.web.bytes(path)?.length ?? 0;
  const items = [];
  const self = target === path;
  items.push({
    label: t("Embed in current file"),
    icon: "box-arrow-in-down",
    disabled: !target || self,
    run: () => insertEmbed(ws, path),
  });
  items.push({
    label: t("Inline as data URI"),
    icon: "file-earmark-code",
    disabled: !target || self || !canInline(size),
    run: () => insertEmbed(ws, path, { inline: true }),
  });
  items.push({
    label: t("Copy relative path"),
    icon: "link-45deg",
    disabled: !target || self,
    run: () => copyRelative(ws, path),
  });
  return items;
}

function copyRelative(ws, path) {
  const target = activeTarget(ws);
  if (!target) return;
  const rel = relativeRef(target, path);
  navigator.clipboard?.writeText(rel).then(
    () => ws.app.toast(t("Copied {path}", { path: rel }), "success", 2500),
    () => ws.app.toast(t("Could not copy to the clipboard."), "warning"),
  );
}

/**
 * Inserts the embed snippet for `asset` into the active editor.
 * @param {object} ws
 * @param {string} asset
 * @param {{ inline?: boolean, pos?: number }} [o] pos: document offset (drop point); default: the caret
 */
export function insertEmbed(ws, asset, o = {}) {
  const target = activeTarget(ws);
  const view = ws.editors.view;
  if (!target || !view || target === asset) return false;
  let dataUri;
  if (o.inline) {
    const bytes = ws.web.bytes(asset);
    if (!bytes || !canInline(bytes.length)) {
      ws.app.toast(t("Only files up to {size} KB can be inlined as a data URI.", { size: Math.round(INLINE_LIMIT / 1024) }), "warning");
      return false;
    }
    dataUri = dataUriFor(bytes, asset);
  }
  const snip = embedSnippet(target, asset, { dataUri });
  const state = view.state;
  const at = o.pos ?? state.selection.main.head;
  const from = o.pos == null ? state.selection.main.from : at;
  const to = o.pos == null ? state.selection.main.to : at;
  let insert = snip.text;
  let anchor = from;
  if (snip.block) {
    // a line of its own, indented like the line it lands on
    const line = state.doc.lineAt(from);
    const indent = /^\s*/.exec(line.text)[0];
    if (line.text.trim() === "") {
      insert = indent + snip.text.replace(/\n/g, `\n${indent}`);
      return dispatch(view, line.from, line.to, insert, line.from);
    }
    insert = `\n${indent}${snip.text.replace(/\n/g, `\n${indent}`)}`;
    anchor = line.to;
    return dispatch(view, line.to, line.to, insert, anchor);
  }
  return dispatch(view, from, to, insert, anchor);
}

function dispatch(view, from, to, insert, start) {
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: start + insert.length }, userEvent: "input.embed", scrollIntoView: true });
  view.focus();
  return true;
}

/**
 * CodeMirror DOM handlers for dropping an Explorer file into the editor (the Explorer sets text/x-of-path).
 * @param {object} ws
 */
export function embedDropHandlers(ws) {
  const hasPath = (e) => [...(e.dataTransfer?.types || [])].includes("text/x-of-path");
  return {
    dragover(e) {
      if (!hasPath(e)) return false;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      return false; // keep CodeMirror's drop cursor
    },
    drop(e, view) {
      if (!hasPath(e)) return false;
      const path = e.dataTransfer.getData("text/x-of-path");
      if (!path || !ws.web.has(path)) return false;
      e.preventDefault();
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
      // Alt (Option) while dropping inlines a small file as a data URI
      insertEmbed(ws, path, { pos, inline: e.altKey && canInline(ws.web.bytes(path)?.length ?? Infinity) });
      return true;
    },
  };
}
