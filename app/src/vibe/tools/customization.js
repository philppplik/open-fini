// Tools for customizing OpenFini itself: settings, keyboard shortcuts and profiles.
// Only portable settings (customize/schema.js) are reachable; security switches, API keys and tokens never are.
import { tool, S } from "./helpers.js";
import { SETTING_KEYS } from "../../customize/schema.js";
import { effective, isOverridden, conflictsFor, filterEntries } from "../../customize/keymap.js";
import { normalizeChord } from "../../customize/chords.js";

const SECTIONS = ["general", "appearance", "accessibility", "canvas", "code", "keyboard", "toolbox", "layout", "defaults"];

export function customizationTools(app) {
  const cz = () => app.customize;
  return [
    tool("get_settings", "Reads OpenFini's interface settings (appearance, interface scale and text size, density, fonts, canvas colors, layout, defaults) with their allowed values and defaults. Secrets, API keys and security switches are not included. Call before set_setting.", {
      section: S.str("Limit to one section", { enum: SECTIONS }),
      keys: { type: "array", items: { type: "string" }, description: "Only these setting keys" },
    }, [], (a) => ({ settings: cz().describe({ section: a.section || "", keys: a.keys || null }), sections: SECTIONS }), { readOnly: true }),

    tool("set_setting", "Changes one interface setting after validating it against the schema (for example uiScale 125, uiFontSize 15, density compact, uiRadius round, theme dark). Returns what changed. Use get_settings to see valid keys and values.", {
      key: S.str("Setting key from get_settings", { enum: SETTING_KEYS }),
      value: { description: "New value; its type must match the setting (boolean, number, string, or JSON for structured settings)" },
    }, ["key", "value"], (a) => {
      const from = app.prefs[a.key];
      const r = cz().set(a.key, a.value);
      if (!r.ok) throw new Error(r.error);
      return { ok: true, changes: [{ key: a.key, from, to: a.value }] };
    }),

    tool("list_shortcuts", "Lists keyboard shortcuts (commands and tools) with the effective shortcut, the default and whether the user changed it. Filter by a search phrase or studio.", {
      query: S.str("Search phrase, for example \"undo\" or \"Ctrl+Z\""),
      studio: S.str("Only shortcuts active in this studio", { enum: ["vector", "pixel", "layout", "code", "vibe"] }),
      changed: S.bool("Only shortcuts the user changed"),
    }, [], (a) => {
      const ov = cz().shortcutOverrides;
      const list = filterEntries(cz().entries(), ov, { query: a.query || "", studio: a.studio || "", changed: !!a.changed }).slice(0, 200);
      return { count: list.length, shortcuts: list.map((e) => ({ id: e.id, label: e.label, kind: e.kind, shortcut: effective(e, ov), default: e.defaults, changed: isOverridden(e, ov), studios: e.studios })) };
    }, { readOnly: true }),

    tool("set_shortcut", "Rebinds a command or tool to a new shortcut, or removes it. Chords look like Ctrl+Shift+Z (write Mod for Ctrl/Cmd); tools take a single key such as B. If the chord is taken, conflict decides: swap, unassign (the other loses it) or cancel.", {
      command: S.str("Command or tool id from list_shortcuts"),
      shortcut: S.str("The new chord, or an empty string to remove the shortcut"),
      conflict: S.str("What to do when another command uses the chord (default cancel)", { enum: ["cancel", "swap", "unassign"] }),
    }, ["command", "shortcut"], (a) => {
      const entry = cz().entries().find((e) => e.id === a.command);
      if (!entry) throw new Error(`Unknown command “${a.command}”. Use list_shortcuts.`);
      const chord = a.shortcut === "" ? null : normalizeChord(a.shortcut);
      if (a.shortcut !== "" && !chord) throw new Error(`“${a.shortcut}” is not a valid shortcut.`);
      const ov = cz().shortcutOverrides;
      if (chord) {
        const others = conflictsFor(cz().entries(), ov, a.command, chord);
        if (others.length && (a.conflict || "cancel") === "cancel") throw new Error(`${a.shortcut} is already used by ${others.map((o) => o.label).join(", ")}. Choose another key or pass conflict: swap or unassign.`);
      }
      const r = cz().setShortcut(a.command, chord ? [chord] : [], { conflict: a.conflict === "swap" ? "swap" : "unassign" });
      if (r.error) throw new Error(r.error);
      return { ok: true, command: a.command, shortcut: effective(entry, cz().shortcutOverrides), affected: r.affected };
    }, { needsApproval: (a) => `Change the shortcut of “${a.command}” to ${a.shortcut || "none"}?` }),

    tool("export_profile", "Returns the user's customization profile as JSON text (appearance, shortcuts, toolbox, menus, layout, workspaces, defaults). Contains no secrets, keys, tokens or documents. The user can save it as a .ofprofile file in Settings > Profiles.", {
      name: S.str("Profile name"),
    }, [], (a) => ({ format: "openfini-profile", json: cz().exportProfile(a.name || "My profile") }), { readOnly: true }),
  ];
}
