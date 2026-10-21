// Generates wiki/Keyboard-Shortcuts.md from the command registry and the tool classes.
//
//   npm run wiki:shortcuts            rewrite wiki/Keyboard-Shortcuts.md
//   npm run wiki:shortcuts -- --check exit 1 when the committed page is out of date (used by the tests)
//
// How it works: the command modules in app/src/commands/ only need an object with `registerCommand`, so a
// stub App (everything else is a no-op proxy) is enough to collect every command definition and its
// default shortcut in Node. Tool shortcuts are read from `static id / label / shortcut / studios` of the
// tool classes in app/src/studios. Nothing here touches the DOM.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "wiki", "Keyboard-Shortcuts.md");

const noop = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : noop), apply: () => noop });

/** Collect `{ id, label, shortcut, altShortcut }` for every registered command. */
export async function collectCommands() {
  const commands = new Map();
  const base = {
    commands,
    registerCommand: (id, def) => commands.set(id, { id, ...def }),
    prefs: {},
    platform: {},
  };
  const app = new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop) });
  // A few command modules read `window` while registering (feature checks); an inert proxy satisfies them.
  globalThis.window ??= noop;
  // Call every register*Commands() function on its own, so one that needs a DOM cannot hide the others.
  const index = readFileSync(join(root, "app/src/commands/index.js"), "utf8");
  for (const m of index.matchAll(/import \{ (register\w+Commands) \} from "\.\/([\w-]+)\.js";/g)) {
    try {
      const mod = await import(pathToFileURL(join(root, "app/src/commands", m[2] + ".js")).href);
      mod[m[1]](app);
    } catch (err) {
      console.warn(`wiki-shortcuts: ${m[1]} was skipped: ${err.message}`);
    }
  }
  return [...commands.values()].map((c) => ({ id: c.id, label: typeof c.label === "string" ? c.label : String(c.label ?? c.id), shortcut: c.shortcut || "", altShortcut: c.altShortcut || "" }));
}

function groupOf(id) {
  const g = id.split(".")[0];
  return g.startsWith("ext:") ? "extension" : g;
}

const GROUP_TITLES = {
  edit: "Edit, arrange and view",
  file: "File and documents",
  studio: "Studios",
  pixel: "Pixel studio",
  layout: "Layout studio",
  data: "Tables and charts",
  code: "Code studio",
  vibe: "Vibe studio",
  office: "Office studio",
  window: "Windows",
  collab: "Collaboration",
  help: "Help and onboarding",
  histogram: "Pixel studio: histogram",
  pdf: "PDF",
  extensions: "Extensions",
  text: "Text tools",
  view: "View",
};

function fmt(s) {
  return s ? "`" + s.replace(/\|/g, "\\|") + "`" : "";
}

/** Static tool shortcuts per studio, read from the tool classes. */
async function collectTools() {
  const rows = [];
  const seen = new Set();
  const add = (T) => {
    if (!T || !T.shortcut || !T.id) return;
    const key = T.id + "|" + T.shortcut;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ id: T.id, label: T.label || T.id, shortcut: T.shortcut, studios: T.studios ? [].concat(T.studios).join(", ") : "all" });
  };
  const files = ["move", "node", "pen", "shapes", "paint", "text", "nav", "pixel-select", "pixel-paint", "pixel-retouch", "pixel-misc", "layout", "data"];
  for (const f of files) {
    try {
      const m = await import(pathToFileURL(join(root, "app/src/studios/tools", f + ".js")).href);
      for (const v of Object.values(m)) {
        if (typeof v === "function") add(v);
        else if (Array.isArray(v)) v.forEach(add);
      }
    } catch (err) {
      console.warn(`wiki-shortcuts: could not load tools/${f}.js: ${err.message}`);
    }
  }
  return rows;
}

export async function buildPage() {
  const cmds = (await collectCommands()).filter((c) => c.shortcut || c.altShortcut);
  const tools = await collectTools();
  const groups = new Map();
  for (const c of cmds) {
    const g = groupOf(c.id);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const out = [];
  out.push("# Keyboard Shortcuts", "");
  out.push("This page lists the default keyboard shortcuts of OpenFini. It is generated from the command registry (`app/src/commands/*`) and the tool classes (`app/src/studios/tools/*`) by `npm run wiki:shortcuts`, so it matches the code at the time of the last wiki update. `Mod` means `Ctrl` on Windows and Linux and `Cmd` on macOS. Every shortcut can be rebound in *Settings ▸ Keyboard shortcuts* (see [[Customization and Profiles]]).", "");
  out.push("> In a normal browser tab a few combinations (for example `Ctrl+N`, `Ctrl+W`, `Ctrl+T`) are reserved by the browser. Install the PWA or use the desktop app for the full set; every action is also in the menus and the command palette (`Ctrl+K`).", "");
  out.push("## Tool shortcuts", "", "A tool key is a single letter pressed while the canvas has focus. Several tools can share a key; the Studio column shows where each one is available.", "");
  out.push("| Key | Tool | Studio |", "| --- | --- | --- |");
  for (const t of tools.sort((a, b) => a.shortcut.localeCompare(b.shortcut) || a.label.localeCompare(b.label))) out.push(`| ${fmt(t.shortcut)} | ${t.label} | ${t.studios} |`);
  out.push("");
  const order = ["edit", "file", "studio", "window", "pixel", "histogram", "layout", "data", "code", "office", "vibe", "collab", "pdf", "help", "extensions", "text", "view"];
  const keys = [...groups.keys()].sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)) || a.localeCompare(b));
  out.push("## Command shortcuts", "");
  for (const g of keys) {
    out.push(`### ${GROUP_TITLES[g] || g[0].toUpperCase() + g.slice(1)}`, "", "| Command | Shortcut | Alternative | Id |", "| --- | --- | --- | --- |");
    for (const c of groups.get(g).sort((a, b) => a.label.localeCompare(b.label))) out.push(`| ${c.label} | ${fmt(c.shortcut)} | ${fmt(c.altShortcut)} | \`${c.id}\` |`);
    out.push("");
  }
  out.push("## Not in the registry", "", "Studio switching (`Alt+1` to `Alt+5`, following the order of the studios in the header) is derived from the studio registry at run time, not from a command table. Some keys belong to the code editor (CodeMirror) or to text editing and are not commands. They are listed on [[Code Studio]] and [[Office Studio]].", "");
  out.push("## See also", "", "- [[Customization and Profiles]]", "- [[Studio Overview]]", "- [[Settings Reference]]", "");
  return out.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const page = await buildPage();
  if (process.argv.includes("--check")) {
    const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (cur.replace(/\r\n/g, "\n") !== page) {
      console.error("wiki/Keyboard-Shortcuts.md is out of date. Run: npm run wiki:shortcuts");
      process.exit(1);
    }
    console.log("wiki/Keyboard-Shortcuts.md is up to date.");
  } else {
    writeFileSync(OUT, page);
    console.log("Wrote " + OUT);
  }
}
