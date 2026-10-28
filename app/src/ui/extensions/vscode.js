// The "VS Code" tab of the extension manager (Studio ▸ Extensions… ▸ VS Code): search Open VSX, install from
// Open VSX or a local .vsix (file picker or drag and drop), and manage installed VS Code extensions (enable/disable,
// update, uninstall, compatibility report, contributions, settings, network origins, README, license, output, log).
// Lazy: loaded only when the tab is opened or a .vsix is opened/dropped. See docs/vscode-extensions.md.
//
// Public API
//   renderVscodeTab(app, container)  draws the tab into `container`; returns { refresh, dispose }
//   installVsixFile(app, {name, bytes})   install flow for a .vsix handed over by the OS or a drop (consent first)
//   pickAndInstallVsix(app)          file picker flow
import { h, empty, optVal, optDecode } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { button } from "../controls.js";
import { confirmDialog } from "../dialogs.js";
import { platform } from "../../platform/index.js";
import { vscodeConsent, compatBadge, contributionSummary } from "./vscode-dialogs.js";

const STATE = { idle: ["Idle", "dim"], active: ["Running", "ok"], activating: ["Starting…", "dim"], error: ["Stopped", "bad"], disabled: ["Disabled", "dim"], declarative: ["Contributions only", "dim"] };
const compact = (n) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);

async function hostOf(app) {
  if (typeof app.vscodeHost !== "function") throw new Error(t("Extensions are not running (safe mode, or they failed to load)."));
  return app.vscodeHost();
}

async function guard(app, fn) {
  try {
    return await fn();
  } catch (err) {
    app.toast(err.message, "danger", 8000);
    return null;
  }
}

function afterInstall(app, done) {
  if (!done) return;
  const extra = done.compat.runsCode ? t("Its commands are in the Code studio command palette (Ctrl+Shift+P).") : done.compat.level === "none" ? t("Nothing of it can run in OpenFini.") : t("Its themes are in Settings ▸ Appearance, its snippets in the Code studio's completions.");
  app.toast(`${done.updated ? t("VS Code extension updated.") : t("VS Code extension installed.")} ${extra}`, done.compat.level === "none" ? "warning" : "success", 5000);
}

export async function installVsixFile(app, file) {
  return !!(await guard(app, async () => {
    const host = await hostOf(app);
    const done = await host.install({ bytes: file.bytes, source: { type: "file", name: file.name } }, vscodeConsent);
    afterInstall(app, done);
    return done;
  }));
}

export async function pickAndInstallVsix(app) {
  const files = await platform.openFiles({ accept: [{ description: "VS Code extension", extensions: ["vsix"] }], multiple: false });
  if (files.length) await installVsixFile(app, files[0]);
}

/** Sanitized README/Markdown with no remote images; links open outside the app. */
async function markdownBlock(text) {
  const { renderMarkdown } = await import("../../engine/web/markdown.js");
  const el = h("div.of-vsx-readme");
  el.innerHTML = renderMarkdown(String(text).slice(0, 200_000), { resolveUrl: (u, kind) => (kind === "image" && !/^data:/i.test(u) ? null : u) }).html; // allowlist-sanitized
  el.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    e.preventDefault();
    if (/^https?:/i.test(a.getAttribute("href"))) window.open(a.href, "_blank", "noopener,noreferrer");
  });
  return el;
}

const fileText = (files, re) => {
  const key = Object.keys(files || {}).find((k) => re.test(k));
  return key ? new TextDecoder().decode(files[key]) : null;
};

function settingControl(def, value, onSet) {
  const label = def.description?.split("\n")[0]?.slice(0, 160) || "";
  if (def.type === "boolean") {
    const s = h("sl-switch", { size: "small", "aria-label": label });
    s.checked = !!value;
    s.addEventListener("sl-change", () => onSet(s.checked));
    return s;
  }
  if (def.enum?.length) {
    const sel = h("sl-select", { size: "small", value: optVal(value ?? ""), hoist: true, "aria-label": label }, def.enum.map((o) => h("sl-option", { value: optVal(o) }, String(o))));
    sel.addEventListener("sl-change", () => onSet(def.enum.find((o) => String(o) === optDecode(sel.value)) ?? optDecode(sel.value)));
    return sel;
  }
  if (def.type === "array" || def.type === "object") {
    const ta = h("sl-textarea", { size: "small", rows: 2, value: JSON.stringify(value ?? def.default ?? null), "aria-label": label });
    ta.addEventListener("keydown", (e) => e.stopPropagation());
    ta.addEventListener("sl-change", () => {
      try {
        onSet(JSON.parse(ta.value));
      } catch {
        ta.setCustomValidity?.(t("Not valid JSON"));
      }
    });
    return ta;
  }
  const num = def.type === "number" || def.type === "integer";
  const inp = h("sl-input", { size: "small", type: num ? "number" : "text", value: String(value ?? ""), min: def.minimum, max: def.maximum, "aria-label": label });
  inp.addEventListener("keydown", (e) => e.stopPropagation());
  inp.addEventListener("sl-change", () => onSet(num ? Number(inp.value) : inp.value));
  return inp;
}

async function installedDetails(app, host, ext) {
  const m = ext.manifest;
  const [stLabel, stCls] = STATE[ext.state] || ["", "dim"];
  const box = h("div.of-ext-detail");
  const sw = h("sl-switch", { size: "small", "aria-label": t("Enable {name}", { name: m.displayName }) });
  sw.checked = ext.rec.enabled !== false;
  sw.addEventListener("sl-change", () => guard(app, () => host.setEnabled(ext.id, sw.checked)));
  const src = ext.rec.source?.type === "openvsx" ? t("from Open VSX") : t("from file {name}", { name: ext.rec.source?.name || "" });
  box.append(h("div.of-ext-detail__head", h("div", h("h2", m.displayName), h("small", `${ext.id} · v${m.version} · ${src}`)), h("div.of-ext-detail__ctl", h("span", { class: `of-ext-badge ${stCls}` }, t(stLabel)), sw)));
  if (m.description) box.append(h("p", m.description));
  box.append(h("p", compatBadge(ext.compat)));
  if (ext.compat.reasons.length) box.append(h("ul.of-vsx-reasons", ext.compat.reasons.map((r) => h("li", r))));
  if (!ext.compat.engineOk) box.append(h("p.of-hint", t("It asks for VS Code {range}; OpenFini implements the API of VS Code {v} (subset).", { range: m.engine, v: "1.95" })));
  if (ext.error) box.append(h("pre.of-ext-error", ext.error));
  const actions = h("div.of-ext-actions");
  if (ext.compat.runsCode && ext.rec.enabled !== false) actions.append(button(ext.state === "active" ? "Restart" : "Start", () => guard(app, () => host.restart(ext.id)), { icon: "arrow-repeat" }));
  if (ext.rec.source?.type === "openvsx")
    actions.append(
      button("Check for update", () =>
        guard(app, async () => {
          const r = await host.checkUpdate(ext.id, vscodeConsent);
          app.toast(r.updated ? t("Updated to {v}.", { v: r.latest }) : r.latest === r.current ? t("{name} is up to date ({v}).", { name: m.displayName, v: r.current }) : t("Update skipped."), "primary", 3000);
        }),
      { icon: "cloud-arrow-down" }),
    );
  actions.append(button("Uninstall", async () => (await confirmDialog({ title: "Uninstall VS Code extension", message: t("Remove “{name}” and its stored data?", { name: m.displayName }), ok: "Uninstall", danger: true })) && guard(app, () => host.uninstall(ext.id)), { variant: "danger" }));
  box.append(actions);

  // contributions
  box.append(h("h3", t("What it adds")));
  const rows = [];
  if (ext.themes.length)
    rows.push([
      t("Color themes"),
      h("div.of-vsx-chips", ext.themes.map((th) => {
        const b = button(th.label, () => {
          app.setPref("themeId", th.id);
          app.setPref("theme", th.mode);
          app.toast(t("Theme “{name}” applied.", { name: th.label }), "success", 1800);
        }, { icon: "palette", title: th.adjusted.length ? t("{n} colors adjusted for contrast", { n: th.adjusted.length }) : t("Use this theme") });
        return b;
      })),
    ]);
  if (ext.snippets.length) {
    const by = {};
    for (const s of ext.snippets) for (const l of s.languages) by[l] = (by[l] || 0) + 1;
    rows.push([t("Snippets"), Object.entries(by).map(([l, n]) => `${l === "*" ? t("all languages") : l} (${n})`).join(", ")]);
  }
  if (ext.languages.length) rows.push([t("Languages"), ext.languages.map((l) => `${l.aliases[0] || l.id}${l.extensions.length ? ` (${l.extensions.slice(0, 4).join(" ")})` : ""}${Object.keys(l.data).length ? "" : ` · ${t("no configuration")}`}`).join(", ")]);
  if (m.contributes.commands.length)
    rows.push([
      t("Commands"),
      ext.compat.runsCode
        ? h("div.of-vsx-chips", m.contributes.commands.slice(0, 30).map((c) => button(c.category ? `${c.category}: ${c.title}` : c.title, () => host.runCommand(ext.id, c.command), { icon: "play-circle" })))
        : `${m.contributes.commands.map((c) => c.title).slice(0, 12).join(", ")} · ${t("cannot run (no web code)")}`,
    ]);
  if (m.contributes.keybindings.length) rows.push([t("Key bindings"), m.contributes.keybindings.slice(0, 10).map((k) => `${k.key} → ${k.command}`).join(", ") + (ext.compat.runsCode ? "" : ` · ${t("not used")}`)]);
  if (ext.providers.size) rows.push([t("Providers"), [...new Set([...ext.providers.values()].map((p) => p.kind))].join(", ")]);
  if (ext.compat.unsupportedContributions.length) rows.push([t("Not supported"), ext.compat.unsupportedContributions.join(", ")]);
  if (ext.compat.apis.length) rows.push([t("Unsupported APIs"), ext.compat.apis.join(", ")]);
  box.append(rows.length ? h("dl.of-ext-adds", rows.flatMap(([k, val]) => [h("dt", k), h("dd", val)])) : h("p.of-hint", t("Nothing OpenFini can use.")));

  const props = Object.entries(m.contributes.configuration);
  if (props.length) {
    const vals = host.settingsOf(ext);
    box.append(h("h3", t("Settings")));
    for (const [k, def] of props.slice(0, 80)) box.append(h("div.of-ext-permrow", h("div", h("strong", k), def.description ? h("small", def.description.slice(0, 300)) : null), settingControl(def, vals[k], (val) => guard(app, () => host.setSetting(ext.id, k, val)))));
  }
  if (ext.compat.runsCode) {
    box.append(h("h3", t("Network access")));
    const ta = h("sl-textarea", { size: "small", rows: 2, value: (ext.rec.network || []).join("\n"), placeholder: "https://api.example.com", "help-text": t("Origins this extension may reach (one per line). Empty: no network. Offline mode always blocks it.") });
    ta.addEventListener("keydown", (e) => e.stopPropagation());
    box.append(ta, h("div.of-ext-actions", button("Save network access", () => guard(app, async () => {
      await host.setNetwork(ext.id, String(ta.value || "").split(/\s+/).map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean));
      app.toast(t("Saved. Restart the extension to apply it."), "success", 2500);
    }))));
  }
  const readme = fileText(ext.rec.files, /^readme(\.(md|markdown|txt))?$/i);
  if (readme) box.append(h("h3", "README"), await markdownBlock(readme));
  const license = fileText(ext.rec.files, /^licen[cs]e(\.(md|txt))?$/i);
  box.append(h("h3", t("License")), h("p", m.license || t("Not declared")));
  if (license) box.append(h("details.of-ext-src", h("summary", t("License text")), h("pre", license.slice(0, 40_000))));
  for (const [ch, text] of ext.output) box.append(h("h3", t("Output: {name}", { name: ch })), h("pre.of-ext-log", text.slice(-20_000) || " "));
  box.append(h("h3", t("Log")), h("pre.of-ext-log", ext.logs.length ? ext.logs.slice(-60).map((l) => `${new Date(l.t).toLocaleTimeString("en-US")} ${l.level.toUpperCase().padEnd(5)} ${l.text}`).join("\n") : t("No log entries.")));
  return box;
}

async function registryDetails(app, host, item, onInstalled) {
  const box = h("div.of-ext-detail", h("p.of-hint", t("Loading details from Open VSX…")));
  const d = await host.openVsx.details(item.namespace, item.name);
  let compat = null;
  if (d.files.manifest) {
    try {
      const [{ normalizePackage, compatibility }, pkgText] = await Promise.all([import("../../vscode/manifest.js"), host.openVsx.text(d.files.manifest)]);
      const norm = normalizePackage(JSON.parse(pkgText));
      if (norm.ok) compat = { ...compatibility(norm.manifest), adds: contributionSummary(norm.manifest) };
    } catch {
      /* the badge is computed after download then */
    }
  }
  empty(box);
  const installed = host.get(d.id);
  box.append(h("div.of-ext-detail__head", h("div", h("h2", d.displayName), h("small", `${d.id} · v${d.version} · ${t("by {p}", { p: d.namespace })}${d.verified ? ` · ${t("verified publisher")}` : ""}`))));
  box.append(h("p.of-vsx-meta", `${compact(d.downloads)} ${t("downloads")}`, d.rating !== null ? ` · ★ ${d.rating} (${d.reviews})` : "", ` · ${t("License")}: ${d.license || t("not declared")}`, d.categories.length ? ` · ${d.categories.join(", ")}` : ""));
  if (d.description) box.append(h("p", d.description));
  if (compat) box.append(h("p", compatBadge(compat), " ", h("span.of-hint", t("(from its manifest; the code is checked again after download)"))), compat.adds.length ? h("p", h("strong", t("What it adds: ")), compat.adds.join(", ")) : null, compat.reasons.length ? h("ul.of-vsx-reasons", compat.reasons.map((r) => h("li", r))) : null);
  if (d.deprecated) box.append(h("p.of-ext-warn", t("This extension is marked as deprecated on Open VSX.")));
  const actions = h("div.of-ext-actions");
  actions.append(
    button(installed ? "Reinstall / update" : "Install", () =>
      guard(app, async () => {
        app.status(t("Downloading {name}…", { name: d.displayName }));
        const done = await host.installFromOpenVsx(d.namespace, d.name, vscodeConsent);
        app.status("");
        afterInstall(app, done);
        if (done) onInstalled(done.id);
      }),
    { variant: "primary", icon: "cloud-arrow-down" }),
  );
  if (d.repository) actions.append(button("Repository", () => window.open(d.repository, "_blank", "noopener,noreferrer"), { icon: "box-arrow-up-right" }));
  box.append(actions);
  if (d.files.readme) {
    try {
      box.append(h("h3", "README"), await markdownBlock(await host.openVsx.text(d.files.readme)));
    } catch (err) {
      box.append(h("p.of-hint", t("The README could not be loaded: {msg}", { msg: err.message })));
    }
  }
  if (d.files.license) {
    const det = h("details.of-ext-src", h("summary", t("License text")));
    det.addEventListener("toggle", async () => {
      if (det.open && det.children.length === 1) det.append(h("pre", (await host.openVsx.text(d.files.license).catch((e) => e.message)).slice(0, 40_000)));
    }, { once: false });
    box.append(det);
  }
  return box;
}

export function renderVscodeTab(app, container) {
  let host = null;
  let view = "installed"; // "installed" | "registry"
  let current = null;
  let results = [];
  let searching = false;
  let token = 0;
  const listEl = h("div.of-ext-list", { role: "listbox", "aria-label": t("VS Code extensions") });
  const pane = h("div.of-ext-pane", { "aria-live": "polite" });
  const query = h("sl-input", { size: "small", placeholder: t("Search Open VSX (e.g. theme, snippets, prettier)"), clearable: true, "aria-label": t("Search Open VSX") });
  query.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") search();
  });
  const category = h("sl-select", { size: "small", value: "", hoist: true, "aria-label": t("Category"), placeholder: t("Any category") }, h("sl-option", { value: "" }, t("Any category")), ...["Themes", "Snippets", "Programming Languages", "Formatters", "Linters", "Keymaps", "Other"].map((c) => h("sl-option", { value: optVal(c) }, c)));
  category.addEventListener("sl-change", () => search());
  const seg = h("div.of-seg", { role: "group" });
  const segBtn = (value, label) => {
    const b = h("button.of-seg__btn", { type: "button", "aria-pressed": String(view === value) }, t(label));
    b.addEventListener("click", () => {
      view = value;
      current = null;
      if (value === "registry" && !results.length) search();
      draw();
    });
    return b;
  };
  const bar = h("div.of-ext-toolbar.of-vsx-bar");
  const note = h("details.of-vsx-note", h("summary", t("VS Code extensions were written for VS Code: OpenFini runs only the declarative parts and a subset of the web extension API.")), h("p", t("Themes, snippets and language settings work for every extension. The code of web extensions runs in a sandbox against a subset of the VS Code API; extensions that need Node.js only add their declarative parts. Extensions come from Open VSX (open-vsx.org), not the Visual Studio Marketplace, whose terms allow its extensions only in Microsoft's products. Drop a .vsix file here to install it.")));
  const body = h("div.of-ext-body", listEl, pane);
  const root = h("div.of-vsx", note, bar, body);
  container.replaceChildren(root);

  root.addEventListener("dragover", (e) => {
    if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) {
      e.preventDefault();
      root.classList.add("drop");
    }
  });
  root.addEventListener("dragleave", () => root.classList.remove("drop"));
  root.addEventListener("drop", async (e) => {
    root.classList.remove("drop");
    const f = [...(e.dataTransfer?.files || [])].find((x) => /\.vsix$/i.test(x.name));
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    await installVsixFile(app, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  });

  async function search() {
    if (!host) return;
    view = "registry";
    const my = ++token;
    searching = true;
    draw();
    const res = await guard(app, () => host.openVsx.search({ query: String(query.value || "").trim(), category: optDecode(category.value), size: 30 }));
    if (my !== token) return;
    searching = false;
    results = res?.items || [];
    current = null;
    draw();
  }

  function drawBar() {
    empty(seg);
    seg.append(segBtn("installed", `Installed (${host?.list().length ?? 0})`), segBtn("registry", "Open VSX"));
    bar.replaceChildren(seg, query, category, button("Search", () => search(), { icon: "search" }), h("span.of-ext-toolbar__sp"), button("Install .vsix…", () => pickAndInstallVsix(app), { icon: "file-earmark-zip" }));
  }

  async function draw() {
    drawBar();
    if (!host) return;
    empty(listEl);
    const scroll = pane.scrollTop;
    if (view === "installed") {
      const list = host.list();
      if (!list.some((e) => e.id === current)) current = list[0]?.id || null;
      for (const ext of list) {
        const [stLabel, stCls] = STATE[ext.state] || ["", "dim"];
        const b = h("button.of-ext-item", { type: "button", role: "option", "aria-selected": String(ext.id === current), class: ext.id === current ? "active" : "" }, h("strong", ext.manifest.displayName), h("small", ext.compat.label), h("span", { class: `of-ext-badge ${stCls}` }, t(stLabel)));
        b.addEventListener("click", () => ((current = ext.id), draw()));
        listEl.append(b);
      }
      if (!list.length) listEl.append(h("div.of-empty", t("No VS Code extensions installed. Search Open VSX or drop a .vsix file here.")));
      const ext = current && host.get(current);
      pane.replaceChildren(ext ? await installedDetails(app, host, ext) : h("div.of-empty", t("Select an extension.")));
    } else {
      if (searching) listEl.append(h("div.of-empty", t("Searching Open VSX…")));
      for (const it of results) {
        const b = h("button.of-ext-item", { type: "button", role: "option", "aria-selected": String(it.id === current?.id), class: it.id === current?.id ? "active" : "" }, h("strong", it.displayName), h("small", `${it.namespace} · v${it.version} · ${compact(it.downloads)} ↓${it.rating !== null ? ` · ★ ${it.rating}` : ""}`), h("small", it.description));
        b.addEventListener("click", () => ((current = it), draw()));
        listEl.append(b);
      }
      if (!searching && !results.length) listEl.append(h("div.of-empty", t("No results. Try another search.")));
      if (current) {
        const it = current;
        pane.replaceChildren(h("p.of-hint", t("Loading…")));
        const el = await guard(app, () => registryDetails(app, host, it, (id) => ((view = "installed"), (current = id), draw())));
        if (current === it) pane.replaceChildren(el || h("div.of-empty", t("Could not load the details.")));
      } else pane.replaceChildren(h("div.of-empty", t("Select a search result to see its details and compatibility.")));
    }
    pane.scrollTop = scroll;
  }

  let off = () => {};
  hostOf(app)
    .then((hst) => {
      host = hst;
      const a = host.on("change", () => document.body.contains(root) && draw());
      const b = host.on("log", () => document.body.contains(root) && view === "installed" && !pane.querySelector("sl-select[open], sl-input:focus-within, sl-textarea:focus-within") && draw());
      off = () => (a(), b());
      if (!host.list().length) {
        view = "registry";
        search();
      } else draw();
    })
    .catch((err) => pane.replaceChildren(h("div.of-empty", err.message)));
  drawBar();
  return { refresh: () => draw(), dispose: () => off() };
}
