// "Blank <studio>" commands: one click makes a truly empty document of a studio (no starter content), from File >
// New Blank and the command palette. The start pages offer the same choice as their first card.
import { listStudios, onStudioRegistered, studioIconSpec } from "../studios/registry.js";
import { N_ } from "../i18n/index.js";

/** Texts of the commands (N_ marks them for extraction; the palette and menus translate them when shown). */
const LABELS = {
  vector: N_("Blank Vector"),
  pixel: N_("Blank Pixel"),
  layout: N_("Blank Layout"),
  code: N_("Blank Code"),
  vibe: N_("Blank Vibe"),
  scene: N_("Blank Scene"),
};

/** Office apps with a blank command: [kind, label, icon]. The apps themselves load on first use. */
export const OFFICE_BLANK = [
  ["document", N_("Blank Document"), "file-earmark-text"],
  ["sheet", N_("Blank Spreadsheet"), "table"],
  ["slides", N_("Blank Presentation"), "easel"],
  ["board", N_("Blank Whiteboard"), "easel2"],
];

/** Opens the Vibe workspace and starts an empty chat once the workspace has mounted. */
function blankVibe(app) {
  app.setStudio("vibe", { user: true });
  let tries = 0;
  const go = () => {
    const s = app.vibe?.session;
    if (s?.newChat) return s.newChat();
    if (++tries < 60) setTimeout(go, 50);
  };
  go();
}

/** The blank action of a studio, or null when it has none. A studio may bring its own `newBlank(app)`. */
export function blankAction(s) {
  if (typeof s.newBlank === "function") return s.newBlank;
  if (s.document) {
    return async (app) => {
      const { blankDocument } = await import("../ui/dialogs.js");
      const doc = blankDocument(app, s.id);
      app.setStudio(s.id);
      app.openDoc(doc);
      requestAnimationFrame(() => app.cv?.fitPage());
    };
  }
  if (s.id === "code") return (app) => import("../ui/code/start.js").then((m) => m.newEmptyWebsite(app));
  if (s.id === "scene") return (app) => import("../scene/host.js").then((m) => m.newScene(app, { template: "blank" }));
  if (s.id === "vibe") return blankVibe;
  return null;
}

/** Command ids and labels for the studios in `studios` (pure; the menu and the tests use it). */
export function blankEntries(studios) {
  const out = [];
  for (const s of studios) {
    if (s.id === "office") out.push(...OFFICE_BLANK.map(([kind, label, icon]) => ({ id: `file.newBlank.office.${kind}`, label, icon, kind })));
    else if (blankAction(s)) out.push({ id: `file.newBlank.${s.id}`, label: LABELS[s.id] || `Blank ${s.label}`, studio: s.id });
  }
  return out;
}

export function registerNewBlankCommands(app) {
  const fail = (e) => app.toast(e?.message || String(e), "danger", 5000);
  let ids = [];
  const define = () => {
    const studios = listStudios();
    const entries = blankEntries(studios);
    for (const e of entries) {
      const s = studios.find((x) => x.id === e.studio);
      const run = e.kind
        ? () => import("../ui/office/open.js").then((m) => m.createOfficeDocument(app, e.kind, { template: "blank" }))
        : (a) => blankAction(s)(a);
      app.commands.set(e.id, { id: e.id, label: e.label, icon: e.icon || studioIconSpec(s), run: (a) => Promise.resolve(run(a)).catch(fail), enabled: () => true });
    }
    ids = entries.map((e) => e.id);
  };
  define();
  app.menuProviders = app.menuProviders || {};
  app.menuProviders.newBlank = () => ids.slice();
  onStudioRegistered(() => {
    define();
    app.emit("commands");
  });
}
