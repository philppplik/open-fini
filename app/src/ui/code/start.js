// Start screen of the Code studio (a document without a website project yet) and the "New website" dialog.
import { h } from "../../core/util.js";
import { TEMPLATES, STARTERS, STARTER_CATEGORIES, loadStarter, isTextPath } from "../../engine/web/index.js";
import { t as tr, N_ } from "../../i18n/index.js"; // `t` names templates in this file
import { Doc } from "../../core/doc.js";
import { ensureWeb } from "../../core/web.js";
import { openDialog } from "../dialogs.js";
import { iconEl } from "../toolbox.js";
import { pickFiles, entriesFromPicked, MAX_IMPORT_BYTES } from "./import.js";

function thumb(t) {
  const bar = (w, o = 1) => h("i", { style: { width: `${w}%`, opacity: o } });
  return h(
    "div.of-tpl__thumb",
    { style: { "--tpl": t.accent } },
    h("div.of-tpl__nav", h("b"), bar(16, 0.5), bar(12, 0.5), h("em")),
    h("div.of-tpl__hero", bar(62), bar(44, 0.6), h("span")),
    h("div.of-tpl__cards", h("u"), h("u"), h("u")),
  );
}

/** Files of a template or starter (starters load their files on demand). */
export async function templateFiles(t) {
  if (t.files) return { ...t.files };
  const full = await loadStarter(t.id);
  if (!full) throw new Error(tr(N_("That template is not available.")));
  return full.files;
}

const GROUPS = { "Basic websites": N_("Basic websites"), "Frameworks, Markdown and PWA": N_("Frameworks, Markdown and PWA"), "Static sites": N_("Static sites"), "Apps and PWAs": N_("Apps and PWAs"), Games: N_("Games"), Libraries: N_("Libraries") };
const groupLabel = (g) => (GROUPS[g] ? tr(GROUPS[g]) : g);

/** Template gallery; calls onPick(template) on selection and onCreate(template) on double click. */
export function templateGallery({ onPick, onCreate, selected = "landing-page" } = {}) {
  const grid = h("div.of-tpls");
  const cards = new Map();
  const select = (t) => {
    for (const [id, c] of cards) c.classList.toggle("selected", id === t.id);
    onPick?.(t);
  };
  let lastGroup = "";
  // plain HTML templates first, then framework, Markdown and PWA starters, then the starters loaded on demand
  const order = (c) => STARTER_CATEGORIES.indexOf(c);
  const all = [...TEMPLATES.map((t) => ({ t, group: t.framework ? "Frameworks, Markdown and PWA" : "Basic websites" })), ...[...STARTERS].sort((a, b) => order(a.category) - order(b.category)).map((t) => ({ t, group: t.category }))];
  for (const { t, group } of all) {
    if (group !== lastGroup) {
      grid.append(h("h3.of-tpls__group", groupLabel(group)));
      lastGroup = group;
    }
    const c = h("button.of-tpl", { type: "button", "aria-pressed": "false" }, thumb(t), h("strong", t.name), h("span", t.description), t.libs?.length ? h("em.of-tpl__libs", tr(N_("Uses {libs}"), { libs: t.libs.join(", ") })) : null);
    c.addEventListener("click", () => select(t));
    c.addEventListener("dblclick", () => onCreate?.(t));
    cards.set(t.id, c);
    grid.append(c);
  }
  select(TEMPLATES.find((t) => t.id === selected) || TEMPLATES[0]);
  return grid;
}

async function filesFromPicked(files, directory) {
  const entries = entriesFromPicked(files, { directory });
  let total = 0;
  for (const e of entries) total += e.file.size;
  if (total > MAX_IMPORT_BYTES) throw new Error("That folder is too large (over 200 MB).");
  const out = {};
  for (const e of entries) {
    const bytes = new Uint8Array(await e.file.arrayBuffer());
    out[e.path] = isTextPath(e.path) ? new TextDecoder().decode(bytes) : bytes;
  }
  return out;
}

/** Start screen shown in the Code studio for a document that has no website project. */
export function createStart(ws) {
  let chosen = TEMPLATES[1] || TEMPLATES[0];
  const create = async (t = chosen) => {
    try {
      ws.createProject(await templateFiles(t), { name: t.name });
    } catch (err) {
      ws.app.toast(err.message, "danger", 6000);
    }
  };
  const importFolder = async () => {
    const picked = await pickFiles({ directory: true });
    if (!picked.length) return;
    try {
      const files = await filesFromPicked(picked, true);
      if (!Object.keys(files).length) return ws.app.toast("That folder has no importable files.", "warning");
      ws.createProject(files, { name: picked[0].webkitRelativePath?.split("/")[0] || "Website" });
    } catch (err) {
      ws.app.toast(err.message, "danger", 6000);
    }
  };
  const importFiles = async () => {
    const picked = await pickFiles({ accept: ".html,.htm,.css,.js,.mjs,.json,.svg,.png,.jpg,.jpeg,.gif,.webp,.avif,.woff,.woff2,.ttf,.otf,.txt,.md" });
    if (!picked.length) return;
    try {
      ws.createProject(await filesFromPicked(picked, false), { name: picked[0].name.replace(/\.[^.]+$/, "") });
    } catch (err) {
      ws.app.toast(err.message, "danger", 6000);
    }
  };
  return h(
    "div.of-start",
    h(
      "div.of-start__inner",
      h("div.of-start__icon", iconEl("of:code")),
      h("h1", "Build a website"),
      h("p", "Write HTML, CSS and JavaScript with a real code editor, or design visually on a live canvas — both edit the same files. Everything stays in this document."),
      templateGallery({ onPick: (t) => (chosen = t), onCreate: create, selected: chosen.id }),
      h(
        "div.of-start__actions",
        h("sl-button", { variant: "primary", onclick: () => create() }, h("sl-icon", { slot: "prefix", name: "magic" }), "Create from template"),
        h("sl-button", { onclick: importFolder }, h("sl-icon", { slot: "prefix", name: "folder2-open" }), "Import a folder…"),
        h("sl-button", { onclick: importFiles }, h("sl-icon", { slot: "prefix", name: "files" }), "Import files…"),
      ),
      h("p.of-hint", "Tip: you can also drop a folder of web files onto the Explorer once a project exists."),
    ),
  );
}

/** File → New website: a template gallery that creates a new document with a project. */
export function newWebsiteDialog(app) {
  let chosen = TEMPLATES[1] || TEMPLATES[0];
  const name = h("sl-input", { value: chosen.name, label: "Project name", size: "small" });
  let nameTouched = false;
  name.addEventListener("sl-input", () => (nameTouched = true));
  const gallery = templateGallery({
    onPick: (t) => {
      chosen = t;
      if (!nameTouched) name.value = t.name;
    },
    onCreate: () => doCreate(),
  });
  const body = h("div.of-newsite", gallery, name);
  const { close } = openDialog({
    title: "New website",
    body,
    width: 760,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      { label: "Create", variant: "primary", onClick: () => doCreate() },
    ],
  });
  async function doCreate() {
    let files;
    try {
      files = await templateFiles(chosen);
    } catch (err) {
      return app.toast(err.message, "danger", 6000);
    }
    const doc = new Doc({ name: name.value.trim() || chosen.name, width: 1280, height: 800, studio: "code" });
    ensureWeb(doc, files);
    doc.history.clear();
    doc.saved = false;
    close();
    app.openDoc(doc);
    app.setStudio("code");
  }
}
