// Global keyboard shortcuts: tools get first refusal, then commands, then single-key tool selection.
import { isMac } from "../core/util.js";
import { STUDIOS } from "../studios/index.js";
import { eventKey } from "../customize/chords.js";

// The key of an event as the table matches it: punctuation and digits by physical key (so Shift+] still means "]"),
// letters by their character. Shared with the shortcut editor so recorded chords always fire.
const normalize = eventKey;

function parse(sc) {
  const parts = sc.split("+");
  // a trailing '+' key ("Mod++")
  let key = parts.pop();
  if (key === "" && parts.length) key = "+";
  const mods = new Set(parts);
  return { mod: mods.has("Mod"), shift: mods.has("Shift"), alt: mods.has("Alt"), key: key.length === 1 ? key.toUpperCase() : key };
}

export function installShortcuts(app) {
  const table = [];
  const rebuild = () => {
    table.length = 0;
    for (const c of app.commands.values()) {
      for (const sc of [c.shortcut, c.altShortcut]) if (sc) table.push({ ...parse(sc), id: c.id, studios: c.studios });
    }
    // studio-scoped commands win over general ones with the same shortcut
    table.sort((a, b) => (b.studios ? 1 : 0) - (a.studios ? 1 : 0));
  };
  // The Code studio has no canvas selection: only these general commands apply there.
  const generalInCode = /^(file|studio|help|vibe)\.|^edit\.(preferences)$|^view\.(theme|lowPower)$/;
  rebuild();
  app.on("commands", rebuild);

  const typing = (e) => {
    const t = e.target;
    if (!t) return false;
    const tag = t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable || tag === "SL-INPUT" || tag === "SL-TEXTAREA" || tag === "SL-SELECT" || tag === "SL-COLOR-PICKER";
  };

  /** Runs the shortcut handling for a key event. `force` ignores the "typing in a field" guard (used by the text editor). */
  function dispatch(ev, force = false) {
    if (ev.defaultPrevented && !force) return false;
    if (document.querySelector("sl-dialog[open]")) return false;
    const mod = isMac ? ev.metaKey : ev.ctrlKey;
    if (!force && typing(ev)) return false;
    const key = normalize(ev);

    if (!force && app.studio !== "code" && app.studio !== "vibe" && !mod && !ev.altKey && app.tool?.keyDown?.(ev)) {
      ev.preventDefault();
      return true;
    }
    // commands
    for (const t of table) {
      if (t.studios && !t.studios.includes(app.studio)) continue;
      if (!t.studios && (app.studio === "code" || app.studio === "vibe") && !generalInCode.test(t.id)) continue;
      if (t.key === key && t.mod === mod && t.alt === ev.altKey && t.shift === ev.shiftKey) {
        if (app.isEnabled(t.id)) {
          ev.preventDefault();
          app.run(t.id);
        } else if (app.commands.has(t.id)) ev.preventDefault();
        return true;
      }
    }
    // Mod+Plus on layouts where '+' needs shift
    if (mod && !ev.altKey && (key === "+" || key === "=")) {
      ev.preventDefault();
      app.run("view.zoomIn");
      return true;
    }
    if (force || mod || ev.altKey || !app.doc) return false;
    // pixel studio color shortcuts
    if (app.studio === "pixel" && !ev.shiftKey) {
      if (key === "X") {
        [app.style.primary, app.style.secondary] = [app.style.secondary, app.style.primary];
        app.emit("colors");
        return true;
      }
      if (key === "D") {
        app.style.primary = "#000000";
        app.style.secondary = "#ffffff";
        app.emit("colors");
        return true;
      }
    }
    // single-key tool selection for the current studio
    const studio = STUDIOS[app.studio];
    const ids = studio.tools.flat();
    const matches = ids.filter((id) => {
      const C = app.toolClasses.get(id);
      return C && C.shortcut && C.shortcut.toUpperCase() === key && C.studios.includes(app.studio);
    });
    if (matches.length) {
      const i = matches.indexOf(app.tool?.id);
      app.setTool(matches[(i + 1) % matches.length]);
      ev.preventDefault();
      return true;
    }
    return false;
  }

  window.addEventListener("keydown", (ev) => {
    dispatch(ev);
  });
  /** Used by the in-canvas text editor to let app-level shortcuts (save, zoom, ...) through. */
  app.handleShortcut = (ev) => dispatch(ev, true);
}
