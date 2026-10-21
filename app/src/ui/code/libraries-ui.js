// Libraries panel of the Code studio: installed libraries (update, download into the project, remove), a catalog of
// popular libraries, search in npm and cdnjs, and a Google Fonts helper. The panel lives in the sidebar; the same view
// opens as a dialog from the command palette.
import { h, empty } from "../../core/util.js";
import { openDialog } from "../dialogs.js";
import { button } from "../controls.js";
import { libraryManager } from "./libraries.js";
import { isPrerelease } from "../../engine/web/index.js";

const TABS = [
  { id: "installed", label: "Installed" },
  { id: "popular", label: "Popular" },
  { id: "search", label: "Search" },
];

const KIND_LABEL = { script: "script", module: "module", style: "stylesheet", importmap: "import map", import: "import" };

/** Builds the view into `root` and returns { refresh }. */
export function mountLibraries(ws, root) {
  const mgr = libraryManager(ws);
  const app = ws.app;
  let tab = "installed";
  let vendorOnAdd = false;
  let updates = {};
  let busy = "";
  const status = h("div.of-lib__status", { role: "status", "aria-live": "polite" });
  const tabs = h("div.of-lib__tabs", { role: "tablist", "aria-label": "Libraries" });
  const body = h("div.of-lib__body");
  empty(root);
  root.classList.add("of-lib");
  root.append(
    h("div.of-side__head", h("span.of-side__title", "Libraries")),
    h("p.of-lib__intro", "Add frameworks, icons and fonts without a build step. Libraries load from jsDelivr, cdnjs or unpkg; “Download into project” stores a copy in vendor/ so the exported site works offline."),
    tabs,
    status,
    body,
  );

  const say = (text, kind = "") => {
    status.textContent = text || "";
    status.className = `of-lib__status ${kind}`;
  };
  const fail = (err) => {
    busy = "";
    say(err?.message || String(err), "error");
    renderBody();
  };

  function renderTabs() {
    empty(tabs);
    for (const t of TABS) {
      const b = h("button.of-lib__tab", { type: "button", role: "tab", "aria-selected": String(t.id === tab), class: t.id === tab ? "active" : "" }, t.label);
      b.addEventListener("click", () => {
        tab = t.id;
        say("");
        renderTabs();
        renderBody();
      });
      tabs.append(b);
    }
  }

  const row = (title, subtitle, badges, actions) =>
    h("div.of-lib__row", h("div.of-lib__main", h("strong", title), h("span.of-lib__sub", subtitle)), h("div.of-lib__badges", badges.map((b) => h("span.of-lib__badge", b))), h("div.of-lib__actions", actions));

  // ------------------------------------------------------------ installed

  function renderInstalled() {
    const libs = mgr.list();
    const head = h("div.of-lib__toolbar");
    const check = button("Check for updates", async () => {
      busy = "check";
      say("Checking for newer versions…");
      try {
        updates = await mgr.checkUpdates(libs);
        busy = "";
        say(Object.keys(updates).length ? `${Object.keys(updates).length} update${Object.keys(updates).length === 1 ? "" : "s"} available.` : "Everything is up to date.", "ok");
        renderBody();
      } catch (err) {
        fail(err);
      }
    }, { icon: "arrow-repeat" });
    head.append(check);
    body.append(head);
    if (!libs.length) {
      body.append(h("div.of-empty", "No libraries yet. Add one from Popular or Search."));
      return;
    }
    for (const lib of libs) {
      const actions = [];
      if (updates[lib.id]) {
        const up = button(`Update to ${updates[lib.id]}`, () => {
          try {
            mgr.update(lib, updates[lib.id]);
            delete updates[lib.id];
            say(`${lib.name} updated.`, "ok");
            renderBody();
          } catch (err) {
            fail(err);
          }
        }, { variant: "primary" });
        actions.push(up);
      }
      if (!lib.vendored && /^https?:/i.test(lib.url)) {
        actions.push(button("Download into project", async () => {
          busy = lib.id;
          say(`Downloading ${lib.name}…`);
          renderBody();
          try {
            const r = await mgr.vendor(lib);
            busy = "";
            say(`${lib.name} is now part of the project (${r.files.length} file${r.files.length === 1 ? "" : "s"} in vendor/).${r.warnings.length ? ` ${r.warnings.length} warning(s): ${r.warnings[0]}` : ""}`, r.warnings.length ? "warn" : "ok");
            renderBody();
          } catch (err) {
            fail(err);
          }
        }, { icon: "download", title: "Stores a copy in vendor/ and points the page at it" }));
      }
      if (lib.kind !== "import") {
        actions.push(button("Remove", () => {
          try {
            mgr.remove(lib);
            renderBody();
          } catch (err) {
            fail(err);
          }
        }, { icon: "trash3" }));
      }
      const where = lib.kind === "import" ? lib.file : `${lib.file}${lib.specifier ? ` · “${lib.specifier}”` : ""}`;
      body.append(row(`${lib.name}${lib.version ? ` ${lib.version}` : ""}`, where, [KIND_LABEL[lib.kind] || lib.kind, lib.vendored ? "in project" : lib.cdn], actions));
    }
    if (busy && busy !== "check") body.classList.add("busy");
    else body.classList.remove("busy");
  }

  // ------------------------------------------------------------ popular

  function pageSelect() {
    const pages = ws.web.pages();
    const sel = h("select.of-lib__select", { "aria-label": "Add to page" }, pages.map((p) => h("option", { value: p, selected: p === (ws.page || pages[0]) }, p)));
    return sel;
  }

  function renderPopular() {
    const pages = ws.web.pages();
    if (!pages.length) {
      body.append(h("div.of-empty", "Create an HTML page first."));
      return;
    }
    const sel = pageSelect();
    const dl = h("input", { type: "checkbox", id: "of-lib-dl", checked: vendorOnAdd });
    dl.addEventListener("change", () => (vendorOnAdd = dl.checked));
    body.append(h("div.of-lib__toolbar", h("label", "Page ", sel), h("label.of-lib__check", dl, " Download into project")));
    const groups = new Map();
    for (const c of mgr.catalog) (groups.get(c.group) || groups.set(c.group, []).get(c.group)).push(c);
    for (const [group, items] of groups) {
      body.append(h("h3.of-lib__group", group));
      for (const c of items) {
        const add = button("Add", async () => {
          try {
            const r = mgr.addCatalog(c.id, { page: sel.value });
            if (!r.added) return say(`${c.name} is already on ${r.page}.`);
            say(`${c.name} added to ${r.page}.${c.note ? ` ${c.note}` : ""}`, "ok");
            if (vendorOnAdd) {
              const lib = mgr.list().find((l) => l.file === r.page && (l.specifier === c.specifier || l.name === c.pkg));
              if (lib) {
                say(`Downloading ${c.name}…`);
                const v = await mgr.vendor(lib);
                say(`${c.name} added and downloaded (${v.files.length} file${v.files.length === 1 ? "" : "s"}).`, "ok");
              }
            }
          } catch (err) {
            fail(err);
          }
        }, { icon: "plus-lg" });
        body.append(row(`${c.name} ${c.version}`, c.description, [KIND_LABEL[c.kind]], [add]));
      }
    }
    // Google Fonts
    const fam = h("input.of-lib__input", { type: "text", placeholder: "Font family, e.g. Inter", "aria-label": "Google Fonts family" });
    const wts = h("input.of-lib__input.narrow", { type: "text", value: "400;700", "aria-label": "Weights", title: "Weights separated by semicolons" });
    const addFont = button("Add font", () => {
      try {
        const r = mgr.addGoogleFont(fam.value, wts.value, sel.value);
        say(r.added ? `Added ${fam.value} to ${r.page}. Use it with font-family: "${fam.value}".` : "That font is already linked.", "ok");
      } catch (err) {
        fail(err);
      }
    });
    body.append(h("h3.of-lib__group", "Google Fonts"), h("div.of-lib__toolbar", fam, wts, addFont), h("p.of-lib__sub", "The font is loaded from fonts.googleapis.com (not stored in the project)."));
  }

  // ------------------------------------------------------------ search

  let searchState = { source: "npm", q: "", results: null, picked: null };

  function renderSearch() {
    const src = h("select.of-lib__select", { "aria-label": "Source" }, [h("option", { value: "npm", selected: searchState.source === "npm" }, "npm packages"), h("option", { value: "cdnjs", selected: searchState.source === "cdnjs" }, "cdnjs")]);
    const input = h("input.of-lib__input", { type: "search", placeholder: "Search packages, e.g. chart or lodash", value: searchState.q, "aria-label": "Search libraries" });
    const go = button("Search", doSearch, { variant: "primary", icon: "search" });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") doSearch();
    });
    async function doSearch() {
      searchState = { source: src.value, q: input.value.trim(), results: null, picked: null };
      if (!searchState.q) return;
      say("Searching…");
      try {
        searchState.results = await mgr.search(searchState.q, searchState.source);
        say(searchState.results.length ? "" : "No packages found.");
        renderBody();
      } catch (err) {
        fail(err);
      }
    }
    body.append(h("div.of-lib__toolbar", src, input, go));
    if (searchState.picked) return renderPicked();
    for (const r of searchState.results || []) {
      const pick = button("Choose", () => {
        searchState.picked = r;
        renderBody();
      });
      body.append(row(`${r.name} ${r.version}`, r.description || "No description", [r.source], [pick]));
    }
  }

  function renderPicked() {
    const r = searchState.picked;
    const box = h("div.of-lib__picked", h("h3.of-lib__group", `${r.name}`), h("p.of-lib__sub", r.description));
    const verSel = h("select.of-lib__select", { "aria-label": "Version" });
    const fileSel = h("select.of-lib__select.wide", { "aria-label": "File" });
    const kindSel = h("select.of-lib__select", { "aria-label": "Use as" }, [h("option", { value: "script" }, "Script tag"), h("option", { value: "module" }, "ES module (import map)"), h("option", { value: "style" }, "Stylesheet")]);
    const spec = h("input.of-lib__input", { type: "text", value: r.name.replace(/^@[^/]+\//, ""), "aria-label": "Import specifier", title: "Name used in import statements" });
    const dl = h("input", { type: "checkbox", checked: vendorOnAdd });
    const pageSel = pageSelect();
    let suggestions = null;
    const fillFiles = () => {
      empty(fileSel);
      const kind = kindSel.value;
      const list = kind === "style" ? suggestions?.styles : kind === "module" ? suggestions?.modules : suggestions?.scripts;
      for (const f of list || []) fileSel.append(h("option", { value: f.path }, f.path));
      if (!fileSel.children.length) fileSel.append(h("option", { value: "" }, suggestions ? "No matching file found" : "Loading files…"));
    };
    kindSel.addEventListener("change", fillFiles);
    const loadFiles = async () => {
      try {
        say("Loading files…");
        suggestions = await mgr.files(r.name, verSel.value);
        say("");
        if (suggestions.default && /\.(css)$/i.test(suggestions.default)) kindSel.value = "style";
        else if (suggestions.modules[0] && /esm|mjs|module/.test(suggestions.modules[0].path)) kindSel.value = "module";
        fillFiles();
      } catch (err) {
        fail(err);
      }
    };
    verSel.addEventListener("change", loadFiles);
    const add = button("Add to page", async () => {
      if (!fileSel.value) return say("Choose a file first.", "error");
      try {
        const url = `https://cdn.jsdelivr.net/npm/${r.name}@${verSel.value}${fileSel.value}`;
        const res = await mgr.install({ kind: kindSel.value, url, specifier: kindSel.value === "module" ? spec.value.trim() : undefined, page: pageSel.value, defer: true }, { vendor: dl.checked });
        say(res.added ? `${r.name} ${verSel.value} added to ${res.page}${res.vendored ? ` and downloaded (${res.vendored.files.length} files)` : ""}.` : "Already on the page.", "ok");
      } catch (err) {
        fail(err);
      }
    }, { variant: "primary", icon: "plus-lg" });
    const back = button("Back to results", () => {
      searchState.picked = null;
      renderBody();
    });
    box.append(
      h("div.of-lib__form", h("label", "Version ", verSel), h("label", "Use as ", kindSel), h("label", "File ", fileSel), h("label", "Import name ", spec), h("label", "Page ", pageSel), h("label.of-lib__check", dl, " Download into project")),
      h("div.of-lib__toolbar", add, back),
    );
    body.append(box);
    verSel.append(h("option", { value: r.version }, `${r.version} (loading versions…)`));
    mgr
      .versions(r.name, r.source === "cdnjs" ? "cdnjs" : "npm")
      .then((v) => {
        empty(verSel);
        const stable = v.versions.filter((x) => !isPrerelease(x)).slice(0, 40);
        for (const x of [v.latest, ...stable.filter((y) => y !== v.latest)]) verSel.append(h("option", { value: x }, x === v.latest ? `${x} (latest)` : x));
        return loadFiles();
      })
      .catch(fail);
  }

  function renderBody() {
    empty(body);
    if (tab === "installed") renderInstalled();
    else if (tab === "popular") renderPopular();
    else renderSearch();
  }

  // keep the list current while the project changes (not while a field in the panel has focus)
  let timer = 0;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => root.isConnected && tab === "installed" && !busy && !body.contains(document.activeElement) && renderBody(), 400);
  };
  ws.web.on("tree", soon);
  ws.web.on("text", soon);
  renderTabs();
  renderBody();
  return { refresh: renderBody };
}

/** The panel as a dialog (command palette). */
export function openLibrariesDialog(ws) {
  const root = h("div.of-lib.of-lib--dialog");
  mountLibraries(ws, root);
  return openDialog({ title: "Libraries", body: root, width: 640, buttons: [{ label: "Close", onClick: (c) => c() }] });
}
