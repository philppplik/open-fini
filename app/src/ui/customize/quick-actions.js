// The header's quick actions: which buttons are shown and in which order (pref `quickActions`).
// Built-in ids: undo, redo, theme, export, panels. Any other id is a command id and becomes an icon button.
import { iconButton } from "../controls.js";

/** Commands behind the built-in buttons: their tooltip shows the effective (possibly rebound) shortcut. */
const BUILTIN_COMMAND = { undo: "edit.undo", redo: "edit.redo", theme: "view.theme", export: "file.export" };

export const BUILTIN_LABELS = { undo: "Undo", redo: "Redo", theme: "Toggle light / dark", export: "Export", panels: "Show / hide panels (narrow windows)" };

export function mountQuickActions(app, host, builtin) {
  const extra = new Map(); // command id → button

  function commandButton(id) {
    let b = extra.get(id);
    const c = app.commands.get(id);
    if (!c) return null;
    if (!b) {
      const [lib, name] = c.icon?.includes(":") ? c.icon.split(":") : [undefined, c.icon];
      b = iconButton({ icon: name || "lightning-charge", lib: lib === "of" ? "of" : undefined, label: c.label, shortcut: c.shortcut, onClick: () => app.run(id) });
      b.dataset.cmd = id;
      extra.set(id, b);
    }
    b.setAttribute("data-tip", c.label);
    if (c.shortcut) b.setAttribute("data-shortcut", c.shortcut);
    else b.removeAttribute("data-shortcut");
    b.disabled = !app.isEnabled(id);
    return b;
  }

  function sync() {
    const ids = Array.isArray(app.prefs.quickActions) ? app.prefs.quickActions : [];
    const els = [];
    for (const id of ids) {
      const el = builtin[id] || commandButton(id);
      if (el && !els.includes(el)) els.push(el);
    }
    // built-in buttons keep their own enabled state (shell.js); only the tooltips follow the shortcut editor
    for (const [name, cmd] of Object.entries(BUILTIN_COMMAND)) {
      const el = builtin[name];
      const sc = app.commands.get(cmd)?.shortcut;
      if (el && sc) el.setAttribute("data-shortcut", sc);
      else if (el && name !== "theme") el.removeAttribute("data-shortcut");
    }
    host.replaceChildren(...els);
    host.classList.toggle("of-header__actions--empty", !els.length);
  }
  for (const ev of ["quickactions", "commands", "shortcuts", "studio", "doc", "docs", "docchange", "selection"]) app.on(ev, sync);
  sync();
  return { sync };
}
