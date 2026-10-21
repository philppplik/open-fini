// Context menu providers of the Code studio: the editor, editor tabs and the website designer's elements.
import * as CM from "../../../vendor/codemirror/codemirror.js";
import { registerContextProvider, openContextMenu } from "../context-menu/index.js";
import { transformMenuItems } from "./text-tools.js";

/** Registers the code editor's providers. Safe to call again (providers are replaced by id). */
export function registerCodeContext(editors) {
  const app = editors.app;
  const mine = (c) => c.data?.editors === editors;

  registerContextProvider({
    id: "code.editor",
    priority: 50,
    matches: (c) => c.kind === "code-editor" && mine(c),
    items: (c) => {
      const view = c.data.view;
      const has = !view.state.selection.main.empty;
      return [
        { label: "Cut", icon: "scissors", shortcut: "Mod+X", disabled: !has, run: () => (view.focus(), document.execCommand("cut")) },
        { label: "Copy", icon: "clipboard", shortcut: "Mod+C", disabled: !has, run: () => (view.focus(), document.execCommand("copy")) },
        { label: "Paste", icon: "clipboard-plus", shortcut: "Mod+V", run: async () => { const t = await navigator.clipboard.readText().catch(() => ""); if (t) view.dispatch(view.state.replaceSelection(t)); } },
        { label: "Select all", shortcut: "Mod+A", run: () => CM.selectAll(view) },
        "-",
        { label: "Format document", icon: "text-indent-left", shortcut: "Shift+Alt+F", run: () => editors.format() },
        { label: "Toggle comment", shortcut: "Mod+/", run: () => CM.toggleComment(view) },
      ];
    },
  });

  registerContextProvider({
    id: "code.transform",
    priority: 40,
    matches: (c) => c.kind === "code-editor" && mine(c),
    items: (c) => [{ label: "Transform", icon: "magic", items: transformMenuItems(editors) }],
  });

  registerContextProvider({
    id: "code.ai",
    priority: -20,
    matches: (c) => c.kind === "code-editor" && mine(c) && !!app.prefs.aiEnabled,
    items: (c) => {
      const view = c.data.view;
      const ctx = () => {
        const d = view.state.doc;
        const s = view.state.selection.main;
        const a = d.lineAt(s.from);
        const b = d.lineAt(s.to);
        return { path: editors.active, fromLine: a.number, toLine: b.number, text: s.empty ? d.sliceString(a.from, a.to) : d.sliceString(s.from, s.to) };
      };
      const ai = app.aiQuick?.codeAiItems(app, ctx) || [];
      return ai.length ? [{ label: "AI", icon: "stars", items: ai }] : [];
    },
  });

  registerContextProvider({
    id: "code.editor-tab",
    priority: 50,
    matches: (c) => c.kind === "editor-tab" && mine(c),
    items: (c) => {
      const path = c.data.path;
      const open = editors.open.slice();
      const i = open.indexOf(path);
      return [
        { label: "Close", icon: "x-lg", shortcut: "Mod+W", run: () => editors.close(path) },
        { label: "Close others", disabled: open.length < 2, run: () => open.filter((p) => p !== path).forEach((p) => editors.close(p)) },
        { label: "Close to the right", disabled: i < 0 || i >= open.length - 1, run: () => open.slice(i + 1).forEach((p) => editors.close(p)) },
        { label: "Close all", run: () => editors.closeAll?.() },
        "-",
        { label: "Copy path", icon: "link-45deg", run: () => navigator.clipboard?.writeText(path) },
        { label: "Reveal in explorer", icon: "files", run: () => app.codeUI?.showSide?.("explorer") },
      ];
    },
  });

  registerContextProvider({
    id: "code.ai.element",
    priority: -20,
    matches: (c) => c.kind === "web-element" && !!app.prefs.aiEnabled,
    items: (c) => {
      const ai = app.aiQuick?.elementAiItems(app, c.data.ws) || [];
      return ai.length ? [{ label: "AI", icon: "stars", items: ai }] : [];
    },
  });
}

/** Opens the editor's context menu at a mouse event; moves the caret to the click when it is outside the selection. */
export function openEditorMenu(editors, e, view) {
  const sel = view.state.selection.main;
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos != null && (sel.empty || pos < sel.from || pos > sel.to)) view.dispatch({ selection: { anchor: pos } });
  const s = view.state.selection.main;
  return openContextMenu(editors.app, { kind: "code-editor", x: e.clientX, y: e.clientY, event: e, selection: view.state.sliceDoc(s.from, s.to), data: { view, editors } });
}
