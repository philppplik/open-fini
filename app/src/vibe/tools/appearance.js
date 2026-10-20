// Tools for appearance and help: color themes, tours and the command list. They never run commands on the user's
// behalf (there is deliberately no generic "run_command"): the assistant can only tell the user what exists.
import { tool, S } from "./helpers.js";
import { listThemes, getTheme } from "../../ui/themes.js";
import { ACCENTS } from "../../ui/appearance.js";
import { rankCommands } from "../../ui/command-search.js";
import { TOURS } from "../../ui/tour-steps.js";

export function appearanceTools(app) {
  const state = () => ({
    theme: app.prefs.themeId || "default",
    mode: app.prefs.theme,
    accent: app.prefs.accent === "custom" ? app.prefs.accentCustom : app.prefs.accent || "violet",
    highContrast: !!app.prefs.highContrast,
  });
  return [
    tool("list_themes", "Lists the color themes of the interface (each has a light and a dark variant), the available accent colors and what is currently selected. Call before set_theme.", {}, [], () => ({
      themes: listThemes().map((t) => ({ id: t.id, name: t.name, group: t.group, description: t.description })),
      accents: ACCENTS.map((a) => ({ id: a.id, label: a.label, color: a.color })),
      modes: ["dark", "light", "auto"],
      current: state(),
    }), { readOnly: true }),

    tool("set_theme", "Changes how OpenFini itself looks: color theme, dark/light/auto mode and accent color. Only affects the interface, never the document. Omit what should stay unchanged.", {
      theme: S.str("Theme id from list_themes"),
      mode: S.str("dark, light or auto (follow the system)", { enum: ["dark", "light", "auto"] }),
      accent: S.str("An accent id from list_themes (use \"violet\" for the theme's own accent) or a #rrggbb color"),
    }, [], (a) => {
      if (a.theme == null && a.mode == null && a.accent == null) throw new Error("Pass at least one of theme, mode or accent.");
      if (a.theme != null) {
        if (!getTheme(a.theme)) throw new Error(`Unknown theme “${a.theme}”. Available: ${listThemes().map((t) => t.id).join(", ")}.`);
        app.setPref("themeId", a.theme);
      }
      if (a.mode != null) app.setPref("theme", a.mode);
      if (a.accent != null) {
        if (/^#[0-9a-f]{6}$/i.test(a.accent)) {
          app.setPref("accentCustom", a.accent);
          app.setPref("accent", "custom");
        } else if (ACCENTS.some((x) => x.id === a.accent)) app.setPref("accent", a.accent);
        else throw new Error(`Unknown accent “${a.accent}”. Use one of ${ACCENTS.map((x) => x.id).join(", ")} or a #rrggbb color.`);
      }
      return { ok: true, current: state() };
    }),

    tool("start_tour", "Opens a guided tour of the interface for the user (coach marks on the real buttons and panels). Use it when the user is new or asks where something is.", {
      tour: S.str("welcome (the interface), or the studio to tour: vector, pixel, layout, code, vibe. Default: the current studio.", { enum: Object.keys(TOURS) }),
    }, [], async (a) => {
      const key = a.tour || (TOURS[app.studio] ? app.studio : "welcome");
      if (!TOURS[key]) throw new Error(`Unknown tour “${key}”. Available: ${Object.keys(TOURS).join(", ")}.`);
      const m = await import("../../ui/onboarding.js");
      m.runTour(app, key); // runs in the background; the user steps through it
      return { ok: true, tour: key, note: "The tour is now showing. The user can skip it with Esc." };
    }, { readOnly: true }),

    tool("list_commands", "Lists the commands of OpenFini that can run right now with their keyboard shortcuts, optionally filtered by a search phrase. Use it to tell users what exists and how to reach it (menu, shortcut, or Ctrl+K command palette). You cannot run them yourself.", {
      query: S.str("Search phrase, for example \"export\" or \"align\""),
      limit: S.num("Maximum number of results (default 25)", { minimum: 1, maximum: 100 }),
    }, [], async (a) => {
      const { paletteEntries } = await import("../../ui/command-palette.js");
      const ranked = rankCommands(paletteEntries(app), a.query || "", { studio: app.studio, recent: app.prefs.recentCommands || [], limit: Math.min(100, a.limit || 25) });
      return { studio: app.studio, commands: ranked.map((c) => ({ id: c.id, label: c.label, section: c.section, shortcut: c.shortcut || null })), note: "The user can press Ctrl+K (Cmd+K on macOS) or F1 to search and run any command." };
    }, { readOnly: true }),
  ];
}
