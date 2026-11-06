// More starter projects for the Code studio ("New website" and the start screen), loaded on demand: this catalog holds
// only names and descriptions; the files of a starter come from its group module when it is created (loadStarter).
// Static sites, apps and PWAs and games are plain HTML, CSS and JavaScript without external requests; the "Libraries"
// group loads one pinned library from a CDN (listed in `libs`). See docs/frameworks.md.
//
//   STARTERS                 [{ id, name, description, category, accent, libs? }]
//   STARTER_CATEGORIES       display order of the categories
//   loadStarter(id)          Promise<Template | null> (engine/web/templates.js shape, `framework: true` when libs are used)

export const STARTER_CATEGORIES = ["Static sites", "Apps and PWAs", "Games", "Libraries"];

const S = (id, name, description, category, accent, group, libs) => ({ id, name, description, category, accent, group, ...(libs ? { libs } : {}) });

/** @type {{ id: string, name: string, description: string, category: string, accent: string, group: string, libs?: string[] }[]} */
export const STARTERS = [
  S("resume", "Resume", "One-page CV with experience, skills and a print stylesheet.", "Static sites", "#0f766e", "sites"),
  S("restaurant", "Restaurant", "Menu, opening hours, location and a reservation form.", "Static sites", "#b45309", "sites"),
  S("event", "Event", "Conference or meetup page with schedule, speakers and tickets.", "Static sites", "#7c3aed", "sites"),
  S("product", "Product page", "Features, pricing table, FAQ and a call to action.", "Static sites", "#2563eb", "sites"),
  S("coming-soon", "Coming soon", "Countdown and sign-up form for a launch.", "Static sites", "#db2777", "sites"),
  S("gallery", "Photo gallery", "Responsive grid with a keyboard-friendly lightbox.", "Static sites", "#475569", "sites"),
  S("todo-pwa", "To-do app (PWA)", "Installable to-do list that works offline and saves in the browser.", "Apps and PWAs", "#16a34a", "apps"),
  S("notes", "Notes app", "Markdown-lite notes with search, saved in local storage.", "Apps and PWAs", "#ca8a04", "apps"),
  S("calculator", "Calculator", "Keyboard-operable calculator with history.", "Apps and PWAs", "#0891b2", "apps"),
  S("snake", "Snake game", "Canvas game loop with keyboard and touch controls and a high score.", "Games", "#22c55e", "games"),
  S("breakout", "Breakout game", "Paddle, ball and bricks on a canvas, with levels.", "Games", "#ef4444", "games"),
  S("memory", "Memory game", "Card-matching game in plain DOM with moves and a timer.", "Games", "#8b5cf6", "games"),
  S("phaser", "Phaser game", "A platformer starting point with the Phaser game framework.", "Libraries", "#1d4ed8", "libs", ["Phaser"]),
  S("p5", "p5.js sketch", "Creative coding sketch with p5.js.", "Libraries", "#ed225d", "libs", ["p5.js"]),
  S("chartjs", "Chart dashboard", "Dashboard with line, bar and doughnut charts (Chart.js).", "Libraries", "#0ea5e9", "libs", ["Chart.js"]),
  S("leaflet", "Map", "Interactive map with markers and popups (Leaflet, OpenStreetMap tiles).", "Libraries", "#15803d", "libs", ["Leaflet"]),
  S("d3", "Data visualization", "A bar chart drawn from data with D3.", "Libraries", "#f97316", "libs", ["D3"]),
  S("pico", "Pico CSS site", "Classless, semantic HTML styled by Pico CSS.", "Libraries", "#1095c1", "libs", ["Pico CSS"]),
  S("bulma", "Bulma site", "Landing page built with Bulma components.", "Libraries", "#00d1b2", "libs", ["Bulma"]),
  S("mithril", "Mithril app", "A small single-page app with Mithril components and routing.", "Libraries", "#1e5799", "libs", ["Mithril"]),
  S("jquery", "jQuery page", "Tabs, accordion and a filtered list with jQuery.", "Libraries", "#0769ad", "libs", ["jQuery"]),
];

const GROUPS = {
  sites: () => import("./tpl/starters-sites.js"),
  apps: () => import("./tpl/starters-apps.js"),
  games: () => import("./tpl/starters-games.js"),
  libs: () => import("./tpl/starters-libs.js"),
};

/**
 * The full template of a starter (a fresh copy of its files), or null for an unknown id.
 * @param {string} id
 */
export async function loadStarter(id) {
  const meta = STARTERS.find((s) => s.id === id);
  if (!meta) return null;
  const mod = await GROUPS[meta.group]();
  const files = mod.FILES[id];
  if (!files) return null;
  const { group, ...rest } = meta;
  void group;
  return { ...rest, files: { ...files }, ...(meta.libs ? { framework: true } : {}) };
}
