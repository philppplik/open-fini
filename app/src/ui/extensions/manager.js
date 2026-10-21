// Studio ▸ Extensions…: install from file, folder or URL (with a consent dialog), enable/disable, permissions,
// settings, logs, and developer mode (Load unpacked, hot reload, new extension).
import { h, empty } from "../../core/util.js";
import { openDialog, confirmDialog, promptDialog } from "../dialogs.js";
import { button } from "../controls.js";
import { platform } from "../../platform/index.js";
import { describePermission } from "../../extensions/manifest.js";
import { consentDialog } from "./dialogs.js";

const STATE = { active: ["Running", "ok"], inactive: ["Idle", "dim"], activating: ["Starting…", "dim"], disabled: ["Disabled", "dim"], error: ["Stopped", "bad"], invalid: ["Invalid", "bad"] };

async function hostOf(app) {
  await app.extensionsReady;
  if (!app.extensions) throw new Error("Extensions are not running (safe mode, or they failed to load).");
  return app.extensions;
}

async function run(app, fn) {
  try {
    return await fn();
  } catch (err) {
    app.toast(err.message, "danger", 8000);
    return null;
  }
}

export async function installFromFile(app) {
  const host = await hostOf(app);
  const files = await platform.openFiles({ accept: [{ description: "OpenFini extension", extensions: ["ofext", "zip"] }], multiple: false });
  if (!files.length) return;
  const { unpackExtension } = await import("../../extensions/zip.js");
  const done = await run(app, () => host.install({ files: unpackExtension(files[0].bytes), source: { type: "file", name: files[0].name } }, consentDialog));
  if (done) app.toast(done.updated ? "Extension updated." : "Extension installed.", "success", 2200);
}

export async function installFromFolder(app, { dev = false } = {}) {
  const host = await hostOf(app);
  let files;
  let handle = null;
  let name;
  if (dev && window.showDirectoryPicker) {
    try {
      handle = await window.showDirectoryPicker({ mode: "read" });
    } catch {
      return; // cancelled
    }
    name = handle.name;
    files = await run(app, async () => (await import("../../extensions/host.js")).readDirHandle(handle));
    if (!files) return;
  } else {
    const { pickFiles, entriesFromPicked } = await import("../code/import.js");
    const picked = await pickFiles({ directory: true });
    if (!picked.length) return;
    files = {};
    for (const e of entriesFromPicked(picked, { directory: true })) files[e.path] = new Uint8Array(await e.file.arrayBuffer());
    name = picked[0].webkitRelativePath?.split("/")[0] || "folder";
  }
  const done = await run(app, () => host.install({ files, source: { type: dev ? "unpacked" : "file", name }, dirHandle: handle }, consentDialog));
  if (done) app.toast(done.updated ? "Extension reloaded." : handle ? "Loaded unpacked. Changes in the folder reload it automatically." : "Extension installed.", "success", 3000);
  if (done && handle) host.watch(done.id, true);
}

export async function installFromUrl(app, url) {
  const host = await hostOf(app);
  url ??= await promptDialog({ title: "Install extension from URL", label: "Address of a .ofext file (https only)", ok: "Download" });
  if (!url) return null;
  return run(app, async () => host.install(await host.fetchPackage(url.trim()), consentDialog));
}

export async function newExtension(app) {
  const host = await hostOf(app);
  const name = await promptDialog({ title: "New extension", label: "Name", value: "My Extension", ok: "Create" });
  if (!name) return;
  const { buildScaffold } = await import("../../extensions/scaffold.js");
  const s = buildScaffold({ name, hostVersion: host.hostVersion });
  const files = Object.fromEntries(Object.entries(s.files).map(([k, t]) => [k, new TextEncoder().encode(t)]));
  const done = await run(app, () => host.install({ files, source: { type: "assistant", name } }, consentDialog));
  if (done) app.toast("Created. Open it from Studio ▸ Extension Commands.", "success", 3000);
}

const toggle = (checked, label, onChange) => {
  const s = h("sl-switch", { size: "small", "aria-label": label });
  s.checked = checked;
  s.addEventListener("sl-change", () => onChange(s.checked));
  return s;
};

function details(app, host, ext) {
  const m = ext.manifest;
  const [stLabel, stCls] = STATE[ext.state] || ["", "dim"];
  const box = h("div.of-ext-detail");
  box.append(
    h("div.of-ext-detail__head", h("div", h("h2", ext.name), h("small", `${ext.id}${m ? ` · v${m.version}` : ""} · ${ext.rec.source?.type === "url" ? "from URL" : ext.rec.source?.type === "unpacked" ? "unpacked folder" : ext.rec.source?.type === "assistant" ? "written by Vibe" : ext.rec.source?.type === "bundled" ? "bundled with OpenFini" : "from file"}`)), h("div.of-ext-detail__ctl", h("span", { class: `of-ext-badge ${stCls}` }, stLabel), ext.valid ? toggle(ext.rec.enabled !== false, `Enable ${ext.name}`, (on) => run(app, () => host.setEnabled(ext.id, on))) : null)),
  );
  if (m?.description) box.append(h("p", m.description));
  if (ext.error) box.append(h("pre.of-ext-error", ext.error));
  const actions = h("div.of-ext-actions");
  if (ext.valid) actions.append(button("Restart", () => run(app, () => host.reload(ext.id)), { icon: "arrow-repeat" }));
  if (ext.dirHandle) actions.append(toggle(!!ext.watching, "Hot reload", (on) => host.watch(ext.id, on)), h("span.of-hint", "Hot reload"));
  if (ext.rec.source?.type === "url") actions.append(button("Check for update", async () => (await installFromUrl(app, ext.rec.source.url)) && app.toast("Checked.", "success", 1500), { icon: "cloud-arrow-down" }));
  actions.append(button("Uninstall", async () => { if (await confirmDialog({ title: "Uninstall extension", message: `Remove “${ext.name}” and its stored data?`, ok: "Uninstall", danger: true })) await host.uninstall(ext.id); }, { variant: "danger" }));
  box.append(actions);

  if (m) {
    box.append(h("h3", "Permissions"));
    if (!m.permissions.length) box.append(h("p.of-hint", "This extension asks for no permissions."));
    for (const p of m.permissions) {
      const d = describePermission(p);
      box.append(h("div.of-ext-permrow", h("div", h("strong", d.label), h("small", d.text)), toggle(ext.rec.granted.includes(p), d.label, (on) => host.setGranted(ext.id, on ? [...new Set([...ext.rec.granted, p])] : ext.rec.granted.filter((x) => x !== p)))));
    }
    const c = m.contributes;
    const rows = [["Commands", c.commands.map((x) => x.title)], ["Panels", c.panels.map((x) => x.title)], ["Themes", c.themes.map((x) => x.label)], ["Templates", c.templates.map((x) => x.label)], ["File importers", c.importers.map((x) => x.title)], ["File exporters", c.exporters.map((x) => x.title)], ["Vibe tools", c.vibeTools.map((x) => x.name)], ["Vibe skills", c.vibeSkills.map((x) => x.name || x.file)], ["Code snippets", c.snippets.map((x) => x.label)]].filter(([, l]) => l.length);
    box.append(h("h3", "What it adds"), rows.length ? h("dl.of-ext-adds", rows.flatMap(([k, l]) => [h("dt", k), h("dd", l.slice(0, 12).join(", ") + (l.length > 12 ? ` … (+${l.length - 12})` : ""))])) : h("p.of-hint", "Nothing yet."));
    const props = Object.entries(c.settings?.properties || {});
    if (props.length) {
      const vals = host.settingsOf(ext);
      box.append(h("h3", "Settings"));
      for (const [k, def] of props) {
        const set = (val) => run(app, () => host.setSetting(ext.id, k, val));
        let ctl;
        if (def.type === "boolean") ctl = toggle(!!vals[k], def.title, set);
        else if (def.enum) {
          ctl = h("sl-select", { size: "small", value: String(vals[k]), hoist: true, "aria-label": def.title }, def.enum.map((o) => h("sl-option", { value: String(o) }, String(o))));
          ctl.addEventListener("sl-change", () => set(def.type === "number" ? Number(ctl.value) : ctl.value));
        } else {
          ctl = h("sl-input", { size: "small", type: def.type === "number" ? "number" : "text", value: String(vals[k] ?? ""), min: def.min, max: def.max, "aria-label": def.title });
          ctl.addEventListener("sl-change", () => set(def.type === "number" ? Number(ctl.value) : ctl.value));
          ctl.addEventListener("keydown", (e) => e.stopPropagation());
        }
        box.append(h("div.of-ext-permrow", h("div", h("strong", def.title), def.description ? h("small", def.description) : null), ctl));
      }
    }
    const main = ext.rec.files[m.main];
    if (main) box.append(h("details.of-ext-src", h("summary", `Source: ${m.main} (${main.length} bytes)`), h("pre", new TextDecoder().decode(main.slice(0, 24000)))));
  }
  const logs = h("pre.of-ext-log", ext.logs.length ? ext.logs.slice(-60).map((l) => `${new Date(l.t).toLocaleTimeString("en-US")} ${l.level.toUpperCase().padEnd(5)} ${l.text}`).join("\n") : "No log entries.");
  box.append(h("h3", "Log"), logs);
  return box;
}

export function openExtensionManager(app, { select } = {}) {
  const listEl = h("div.of-ext-list", { role: "listbox", "aria-label": "Installed extensions" });
  const detailEl = h("div.of-ext-pane");
  const toolbar = h("div.of-ext-toolbar");
  const galleryEl = h("div.of-ext-gallery", { hidden: true });
  const vscodeEl = h("div.of-ext-vscode", { hidden: true }); // VS Code extensions (./vscode.js, lazy)
  let vscodeTab = null;
  const bodyEl = h("div.of-ext-body", listEl, detailEl);
  let view = select === "vscode" ? "vscode" : "installed"; // "installed" | "gallery" | "vscode"
  let drawGallery = null;
  let host = null;
  let current = select && select !== "vscode" ? select : null;
  let off = null;

  const render = () => {
    if (!host) return;
    const list = host.list();
    if (!list.some((e) => e.id === current)) current = list[0]?.id || null;
    empty(listEl);
    for (const ext of list) {
      const [stLabel, stCls] = STATE[ext.state] || ["", "dim"];
      const b = h("button.of-ext-item", { type: "button", role: "option", "aria-selected": String(ext.id === current), class: ext.id === current ? "active" : "" }, h("strong", ext.name), h("small", ext.manifest?.description || ext.error || ext.id), h("span", { class: `of-ext-badge ${stCls}` }, stLabel));
      b.addEventListener("click", () => {
        current = ext.id;
        render();
      });
      listEl.append(b);
    }
    if (!list.length) listEl.append(h("div.of-empty", "No extensions installed yet. Browse the extensions that ship with OpenFini under Available extensions, install one from a file or a link, or write your own (see the SDK in the sdk folder of the OpenFini repository)."));
    const scroll = detailEl.scrollTop;
    empty(detailEl);
    const ext = host.get(current);
    detailEl.append(ext ? details(app, host, ext) : h("div.of-empty", "Select an extension."));
    detailEl.scrollTop = scroll;
    renderToolbar();
    drawGallery?.();
  };

  const showView = async (next) => {
    view = next;
    bodyEl.hidden = view !== "installed";
    galleryEl.hidden = view !== "gallery";
    vscodeEl.hidden = view !== "vscode";
    if (view === "vscode" && !vscodeTab) vscodeTab = (await import("./vscode.js")).renderVscodeTab(app, vscodeEl);
    if (view === "gallery" && !drawGallery && host) {
      const { renderGallery } = await import("./gallery.js");
      drawGallery = renderGallery(app, host, galleryEl);
    }
    renderToolbar();
  };

  function renderToolbar() {
    empty(toolbar);
    const dev = !!app.prefs.extDeveloper;
    toolbar.append(...[
      button(view === "gallery" ? "Installed extensions" : "Available extensions", () => showView(view === "gallery" ? "installed" : "gallery"), { icon: view === "gallery" ? "list-ul" : "grid" }),
      button(view === "vscode" ? "OpenFini extensions" : "VS Code", () => showView(view === "vscode" ? "installed" : "vscode"), { icon: view === "vscode" ? "puzzle" : "code-square", title: "VS Code extensions from Open VSX or a .vsix file" }),
      button("Install from file…", () => installFromFile(app), { icon: "file-earmark-zip" }),
      button("From URL…", () => installFromUrl(app), { icon: "link-45deg" }),
      button("From folder…", () => installFromFolder(app), { icon: "folder2-open" }),
      h("span.of-ext-toolbar__sp"),
      dev ? button("Load unpacked…", () => installFromFolder(app, { dev: true }), { icon: "braces" }) : null,
      dev ? button("New extension…", () => newExtension(app), { icon: "plus-lg" }) : null,
      toggle(dev, "Developer mode", (on) => {
        app.setPref("extDeveloper", on);
        renderToolbar();
      }),
      h("span.of-hint", "Developer mode"),
    ].filter(Boolean));
  }

  hostOf(app).then((hst) => {
    host = hst;
    const rerender = () => document.body.contains(listEl) && render();
    const a = host.on("change", rerender);
    const b = host.on("log", () => document.body.contains(listEl) && !detailEl.querySelector("sl-select[open]") && render());
    off = () => {
      a();
      b();
    };
    render();
  }).catch((err) => detailEl.replaceChildren(h("div.of-empty", err.message)));
  renderToolbar();
  openDialog({
    title: "Extensions",
    body: h("div.of-ext", toolbar, bodyEl, galleryEl, vscodeEl),
    width: 980,
    cls: "of-ext-manager",
    buttons: [{ label: "Done", variant: "primary", onClick: (c) => c() }],
    onClose: () => (off?.(), vscodeTab?.dispose()),
  });
  if (view === "vscode") showView("vscode");
}

/** The Settings ▸ Extensions section. */
export function extensionsSettingsPane(app) {
  const el = h("div.of-set__group");
  const draw = () => {
    const count = app.extensions?.list().length ?? 0;
    el.replaceChildren(
      h("div.of-set__row", h("div", h("div.of-set__label", "Installed extensions"), h("div.of-set__hint", app.extensions ? `${count} installed. Extensions add commands, panels, themes, templates and Vibe tools. They run in sandboxes and only get the permissions you approve.` : "Loading…")), h("div.of-set__ctl", button("Manage…", () => openExtensionManager(app), { icon: "puzzle" }))),
      h("div.of-set__row", h("div", h("div.of-set__label", "Run extensions"), h("div.of-set__hint", "Turn this off to start OpenFini without any extension (safe mode). Takes effect after a reload.")), h("div.of-set__ctl", toggle(app.prefs.extensionsEnabled !== false, "Run extensions", (on) => app.setPref("extensionsEnabled", on)))),
      h("div.of-set__row", h("div", h("div.of-set__label", "Developer mode"), h("div.of-set__hint", "Adds Load unpacked, hot reload and New extension to the manager.")), h("div.of-set__ctl", toggle(!!app.prefs.extDeveloper, "Developer mode", (on) => app.setPref("extDeveloper", on)))),
      h("div.of-set__row", h("div", h("div.of-set__label", "Network access"), h("div.of-set__hint", "Extensions can only reach addresses they declared and you approved, and never while offline mode is on.")), h("div.of-set__ctl")),
    );
  };
  draw();
  app.extensionsReady?.then(draw).catch(() => {});
  return el;
}

