// Explorer: the project's file tree (create, rename, move, duplicate, delete, upload, import, drag & drop).
import { h, empty, formatBytes } from "../../core/util.js";
import { dirname, basename, sanitizeFileName } from "../../engine/web/index.js";
import { iconButton } from "../controls.js";
import { promptDialog, confirmDialog } from "../dialogs.js";
import { showContextMenu } from "../menus.js";
import { platform } from "../../platform/index.js";
import { fileIcon } from "./util.js";
import { pickFiles, entriesFromPicked, entriesFromDrop, importInto } from "./import.js";

export function createExplorer(ws) {
  const { app, web } = ws;
  const expanded = new Set(web.settings.expanded || []);
  let selected = null;
  let renaming = null;
  const list = h("div.of-tree", { role: "tree", tabindex: "0", "aria-label": "Project files" });
  const head = h("div.of-side__head", h("span.of-side__title", "Explorer"));
  const actions = h(
    "div.of-side__actions",
    iconButton({ icon: "file-earmark-plus", label: "New file…", onClick: () => newFile(currentDir()) }),
    iconButton({ icon: "folder-plus", label: "New folder…", onClick: () => newFolder(currentDir()) }),
    iconButton({ icon: "upload", label: "Upload files…", onClick: () => upload(currentDir()) }),
    iconButton({ icon: "folder2-open", label: "Import folder…", onClick: () => importFolder() }),
    iconButton({ icon: "arrows-collapse", label: "Collapse all", onClick: () => {
      expanded.clear();
      persist();
      render();
    } }),
  );
  head.append(actions);
  const info = h("div.of-side__foot");
  const el = h("div.of-side__pane.of-explorer", head, list, info);

  const persist = () => (web.settings.expanded = [...expanded]);
  const isDir = (p) => web.folders().includes(p) || (web.extraFolders || new Set()).has(p);
  const currentDir = () => (!selected ? "" : web.has(selected) ? dirname(selected) : selected);

  // ------------------------------------------------------------ rendering

  function treeWithExtras() {
    const tree = web.tree();
    const extras = [...(web.extraFolders || [])].filter((f) => !web.folders().includes(f));
    for (const f of extras) {
      let level = tree;
      let acc = "";
      for (const part of f.split("/")) {
        acc = acc ? `${acc}/${part}` : part;
        let node = level.find((n) => n.type === "dir" && n.name === part);
        if (!node) {
          node = { name: part, path: acc, type: "dir", children: [] };
          level.push(node);
          level.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, "en-US", { numeric: true }) : a.type === "dir" ? -1 : 1));
        }
        level = node.children;
      }
    }
    return tree;
  }

  /** Git status badge (A, M, D, U) for a file, or a dot for a folder that contains changes. */
  const gitBadge = (n) => {
    const d = n.type === "file" ? ws.git?.decoration(n.path) : ws.git?.folderDecorated(n.path) ? { letter: "●", kind: "modified", title: "Contains changes" } : null;
    return d ? h("span.of-git__badge.of-tree__git", { "data-k": d.letter === "●" ? "M" : d.letter, title: d.title }, d.letter) : null;
  };

  function render() {
    empty(list);
    const tree = treeWithExtras();
    const add = (nodes, depth) => {
      for (const n of nodes) {
        list.append(row(n, depth));
        if (n.type === "dir" && expanded.has(n.path)) add(n.children, depth + 1);
      }
    };
    add(tree, 0);
    if (!tree.length) list.append(h("div.of-empty", "This project has no files yet."));
    info.textContent = `${web.files.size} file${web.files.size === 1 ? "" : "s"} · ${formatBytes(web.totalBytes())}`;
  }

  function row(n, depth) {
    const isActive = n.type === "file" && n.path === ws.editors.active;
    const nameEl =
      renaming === n.path
        ? renameInput(n)
        : h("span.of-tree__name", n.name, n.type === "file" && n.path === web.entry ? h("sl-icon.of-tree__home", { name: "house-door-fill", "data-tip": "Home page (entry)" }) : null);
    const r = h(
      "div.of-tree__row",
      {
        role: "treeitem",
        class: `${n.path === selected ? "selected" : ""} ${isActive ? "active" : ""}`.trim(),
        style: { paddingLeft: `${8 + depth * 14}px` },
        draggable: renaming === n.path ? "false" : "true",
        "data-path": n.path,
        "aria-expanded": n.type === "dir" ? String(expanded.has(n.path)) : undefined,
        title: n.path,
      },
      n.type === "dir" ? h("sl-icon.of-tree__chev", { name: expanded.has(n.path) ? "chevron-down" : "chevron-right" }) : h("span.of-tree__chev"),
      n.type === "dir" ? h("sl-icon.of-fileicon", { name: expanded.has(n.path) ? "folder2-open" : "folder" }) : fileIcon(n.path),
      nameEl,
      gitBadge(n),
    );
    r.addEventListener("click", () => {
      selected = n.path;
      if (n.type === "dir") {
        if (expanded.has(n.path)) expanded.delete(n.path);
        else expanded.add(n.path);
        persist();
      } else ws.openFile(n.path);
      render();
    });
    r.addEventListener("dblclick", () => n.type === "file" && ws.openFile(n.path, { focus: true }));
    r.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      selected = n.path;
      render();
      showContextMenu(app, e.clientX, e.clientY, menuFor(n));
    });
    r.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/x-of-path", n.path);
      e.dataTransfer.effectAllowed = "copyMove";
    });
    if (n.type === "dir") {
      r.addEventListener("dragover", (e) => {
        e.preventDefault();
        r.classList.add("drop");
      });
      r.addEventListener("dragleave", () => r.classList.remove("drop"));
      r.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        r.classList.remove("drop");
        dropOn(e, n.path);
      });
    }
    return r;
  }

  function renameInput(n) {
    const input = h("input.of-tree__rename", { value: n.name, spellcheck: false, "aria-label": "New name" });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      renaming = null;
      const name = sanitizeFileName(input.value);
      if (commit && name && name !== n.name) {
        const dir = dirname(n.path);
        try {
          doRename(n.path, dir ? `${dir}/${name}` : name);
        } catch (err) {
          app.toast(err.message, "warning");
        }
      }
      render();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (e) => e.stopPropagation());
    requestAnimationFrame(() => {
      input.focus();
      const dot = n.name.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 && n.type === "file" ? dot : n.name.length);
    });
    return input;
  }

  function menuFor(n) {
    const file = n.type === "file";
    const items = [];
    if (file) items.push({ label: "Open", icon: "file-earmark-code", run: () => ws.openFile(n.path, { focus: true }) });
    if (file && /\.html?$/i.test(n.path)) items.push({ label: "Preview this page", icon: "eye", run: () => ws.showPage(n.path) }, { label: "Set as home page", icon: "house-door", run: () => web.setEntry(n.path), disabled: n.path === web.entry });
    items.push("-");
    const dir = file ? dirname(n.path) : n.path;
    items.push({ label: "New file…", icon: "file-earmark-plus", run: () => newFile(dir) }, { label: "New folder…", icon: "folder-plus", run: () => newFolder(dir) }, { label: "Upload here…", icon: "upload", run: () => upload(dir) });
    items.push("-", { label: "Rename", icon: "pencil", run: () => startRename(n.path) });
    if (file) items.push({ label: "Duplicate", icon: "files", run: () => ws.openFile(web.duplicate(n.path).path) }, { label: "Download", icon: "download", run: () => download(n.path) });
    items.push({ label: "Copy path", icon: "link-45deg", run: () => navigator.clipboard?.writeText(n.path) }, "-", { label: "Delete", icon: "trash3", run: () => remove(n) });
    return items;
  }

  // ------------------------------------------------------------ actions

  function startRename(path) {
    renaming = path;
    render();
  }

  function doRename(from, to) {
    const pairs = web.rename(from, to);
    ws.afterRename?.(pairs);
    if (expanded.has(from)) {
      expanded.delete(from);
      expanded.add(to);
    }
    selected = to;
    persist();
  }

  async function newFile(dir) {
    const value = await promptDialog({ title: "New file", label: "File name (folders allowed, e.g. css/about.css)", value: dir ? `${dir}/` : "", ok: "Create" });
    if (!value) return;
    try {
      const path = value
        .split("/")
        .map((s) => sanitizeFileName(s))
        .filter(Boolean)
        .join("/");
      const f = web.create(path);
      selected = f.path;
      for (let d = dirname(f.path); d; d = dirname(d)) expanded.add(d);
      persist();
      ws.openFile(f.path, { focus: true });
      render();
    } catch (err) {
      app.toast(err.message, "warning");
    }
  }

  async function newFolder(dir) {
    const value = await promptDialog({ title: "New folder", label: "Folder name", value: dir ? `${dir}/` : "", ok: "Create" });
    if (!value) return;
    const path = value
      .split("/")
      .map((s) => sanitizeFileName(s))
      .filter(Boolean)
      .join("/");
    if (!path) return;
    if (web.has(path)) return app.toast(`“${path}” is a file.`, "warning");
    (web.extraFolders ||= new Set()).add(path);
    for (let d = path; d; d = dirname(d)) expanded.add(d);
    selected = path;
    persist();
    render();
  }

  async function remove(n) {
    const count = n.type === "dir" ? [...web.files.keys()].filter((p) => p.startsWith(`${n.path}/`)).length : 1;
    const ok = await confirmDialog({ title: n.type === "dir" ? "Delete folder" : "Delete file", message: n.type === "dir" ? `Delete “${n.path}” and the ${count} file${count === 1 ? "" : "s"} inside it? You can undo this with Edit → Undo only for open text files.` : `Delete “${n.path}”?`, ok: "Delete", danger: true });
    if (!ok) return;
    web.remove(n.path);
    web.extraFolders?.delete(n.path);
    if (selected === n.path) selected = null;
    render();
  }

  async function upload(dir) {
    const files = await pickFiles({});
    if (files.length) await importFiles(entriesFromPicked(files), dir);
  }
  async function importFolder() {
    const files = await pickFiles({ directory: true });
    if (!files.length) return;
    const entries = entriesFromPicked(files, { directory: true });
    if (!entries.length) return app.toast("That folder has no importable files.", "warning");
    await importFiles(entries, "");
  }
  async function importFiles(entries, dir) {
    try {
      const res = await importInto(web, entries, {
        prefix: dir,
        confirmReplace: (paths) => confirmDialog({ title: "Replace files?", message: `${paths.length} file${paths.length === 1 ? "" : "s"} already exist${paths.length === 1 ? "s" : ""} (${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ", …" : ""}). Replace ${paths.length === 1 ? "it" : "them"}?`, ok: "Replace", cancel: "Keep existing" }),
      });
      app.toast(`Imported ${res.added + res.replaced} file${res.added + res.replaced === 1 ? "" : "s"}${res.skipped ? ` (${res.skipped} skipped)` : ""}.`, "success");
      if (dir) expanded.add(dir);
      ws.afterImport?.(entries);
    } catch (err) {
      app.toast(err.message, "danger", 6000);
    }
  }

  async function download(path) {
    const bytes = web.bytes(path);
    const f = web.get(path);
    if (bytes) await platform.saveFile({ suggestedName: basename(path), bytes, mime: f.mime, filters: [] });
  }

  async function dropOn(e, dir) {
    const from = e.dataTransfer.getData("text/x-of-path");
    if (from) {
      if (from === dir || dirname(from) === dir) return;
      try {
        doRename(from, dir ? `${dir}/${basename(from)}` : basename(from));
        render();
      } catch (err) {
        app.toast(err.message, "warning");
      }
      return;
    }
    if (e.dataTransfer.types.includes("Files")) await importFiles(await entriesFromDrop(e.dataTransfer), dir);
  }

  // dropping on empty space = project root
  list.addEventListener("dragover", (e) => e.preventDefault());
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    dropOn(e, "");
  });
  list.addEventListener("keydown", (e) => {
    if (!selected) return;
    if (e.key === "F2") startRename(selected);
    else if (e.key === "Delete") remove({ path: selected, type: web.has(selected) ? "file" : "dir" });
    else if (e.key === "Enter" && web.has(selected)) ws.openFile(selected, { focus: true });
  });

  web.on("tree", render);
  ws.git?.on("change", render);
  ws.editors.on("active", render);
  render();
  return {
    el,
    render,
    reveal(path) {
      for (let d = dirname(path); d; d = dirname(d)) expanded.add(d);
      selected = path;
      render();
      list.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" });
    },
    newFile: () => newFile(currentDir()),
    upload: () => upload(currentDir()),
    importFolder,
    importFiles,
  };
}
