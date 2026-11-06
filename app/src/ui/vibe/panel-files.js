// Settings ▸ Artificial intelligence ▸ Local files: master switch (off by default, desktop app only), the granted
// folders with their scope (read only / read and write), "Add folder…" (native folder picker opened by the desktop
// side), revoke, and the audit log. Native side: src-tauri/src/fileaccess.rs; tools: ../../vibe/tools/local-files.js.
import { h, empty } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { vibeStore } from "../../vibe/store.js";
import { iconEl } from "../toolbox.js";
import { confirmDialog } from "../dialogs.js";
import { filesInvoke, normalizeLocalFiles, DEFAULT_LOCAL_FILES } from "../../vibe/tools/local-files.js";

const OPS = { list: N_("listed"), read: N_("read"), write: N_("wrote"), "grant-read": N_("granted (read)"), "grant-write": N_("granted (read and write)"), "scope-read": N_("set to read only"), "scope-write": N_("set to read and write"), revoke: N_("revoked") };

export function createFilesPanel(vs) {
  const { app } = vs;
  const el = h("div.of-vweb");
  const get = () => normalizeLocalFiles(vibeStore.settings.localFiles);
  const save = (patch) => vibeStore.saveSettings({ localFiles: { ...get(), ...patch } });
  const desktop = !!globalThis.window?.__TAURI__?.core?.invoke;
  const fail = (err) => app.toast(err?.message || String(err), "danger", 4000);

  async function render() {
    empty(el);
    const p = get();
    const on = h("sl-switch", { size: "small", disabled: !desktop }, t("Allow the assistant to use local files"));
    on.checked = !!p.enabled && desktop;
    on.addEventListener("sl-change", () => save({ enabled: on.checked }).then(render));
    el.append(h("div.of-vcard", h("strong", t("Local files")),
      h("p.of-hint", t("Lets the assistant list, read and write files in folders you grant (tools local_list_folders, local_list_files, local_read_file, local_write_file). Off by default and only in the desktop app. Each folder is read only or read and write; paths outside a granted folder, also through “..” or symbolic links, are refused by the desktop app itself. Every listing, read and write asks for your approval, and every access is recorded in the audit log below. File contents go to the model you chose.")),
      desktop ? on : h("p.of-hint", t("Not available in the browser: a web page cannot open folders on its own. Use the desktop app."))));
    if (!desktop || !p.enabled) return;

    const list = h("div.of-vmem__list", { role: "list" });
    const addRead = h("button.of-btn", { type: "button" }, iconEl("folder-plus"), t("Add folder (read only)…"));
    const addWrite = h("button.of-btn", { type: "button" }, iconEl("folder-plus"), t("Add folder (read and write)…"));
    const add = (write) => filesInvoke("files_grant_pick", { write }).then(render, fail);
    addRead.addEventListener("click", () => add(false));
    addWrite.addEventListener("click", () => add(true));
    el.append(h("div.of-vcard", h("strong", t("Granted folders")), list, h("div.of-vmem__row", addRead, addWrite)));
    try {
      const grants = await filesInvoke("files_grants");
      for (const g of grants) {
        const scope = h("select.of-vfield__in", { "aria-label": t("Access") }, h("option", { value: "r", selected: !g.write }, t("Read only")), h("option", { value: "rw", selected: g.write }, t("Read and write")));
        scope.addEventListener("change", () => filesInvoke("files_grant_set_write", { id: g.id, write: scope.value === "rw" }).then(render, fail));
        const revoke = h("button.of-btn.of-btn--sm", { type: "button", "aria-label": t("Revoke access to {path}", { path: g.path }) }, iconEl("x-lg"), t("Revoke"));
        revoke.addEventListener("click", () => filesInvoke("files_grant_revoke", { id: g.id }).then(render, fail));
        list.append(h("div.of-vmem__item", { role: "listitem" }, iconEl("folder2"), h("div.of-vmem__text", h("code", g.path.replace(/^\\\\\?\\/, "")), h("small", t("Granted {date}", { date: new Date(g.created).toLocaleDateString(app.i18n?.locale?.() || undefined) }))), h("div.of-vmem__acts", scope, revoke)));
      }
      if (!grants.length) list.append(h("div.of-empty", t("No folders granted yet.")));
    } catch (err) {
      list.append(h("div.of-empty", err?.message || String(err)));
    }

    const max = h("input.of-vfield__in", { value: String(Math.round(p.maxReadBytes / 1024)), inputmode: "numeric", "aria-label": t("Largest read (KiB)") });
    max.addEventListener("keydown", (e) => e.stopPropagation());
    max.addEventListener("change", () => Number(max.value) >= 4 && Number(max.value) <= 20480 && save({ maxReadBytes: Number(max.value) * 1024 }));
    el.append(h("div.of-vcard", h("strong", t("Limits")), h("label.of-vfield", h("span", t("Largest read (KiB)")), max, h("small", t("Longer files are cut. Writes are limited to 20 MiB."))),
      h("button.of-btn", { type: "button", onclick: () => save({ ...DEFAULT_LOCAL_FILES(), enabled: true }).then(render) }, t("Reset to defaults"))));

    const log = h("div.of-ailog__list");
    const clear = h("button.of-btn", { type: "button" }, iconEl("trash3"), t("Clear audit log…"));
    clear.addEventListener("click", async () => {
      if (await confirmDialog({ title: t("Clear audit log"), message: t("Delete the record of every file access by the assistant?"), ok: t("Delete"), danger: true })) filesInvoke("files_audit_clear").then(render, fail);
    });
    el.append(h("div.of-vcard", h("strong", t("Audit log")), h("p.of-hint", t("Every grant, listing, read and write, newest first. File contents are never recorded.")), log, h("div.of-vmem__row", clear)));
    try {
      const rows = (await filesInvoke("files_audit", { limit: 200 })).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
      for (const r of rows) log.append(h("div.of-ailog__row", { "data-status": r.ok ? "ok" : "error" }, h("span", new Date(r.time).toLocaleString(app.i18n?.locale?.() || undefined)), h("span", OPS[r.op] ? t(OPS[r.op]) : r.op), h("span", { title: r.path }, r.path), h("span", r.bytes != null ? String(r.bytes) : ""), h("span", r.ok ? "" : r.error || t("failed"))));
      if (!rows.length) log.append(h("div.of-empty", t("Nothing recorded yet.")));
    } catch (err) {
      log.append(h("div.of-empty", err?.message || String(err)));
    }
  }
  render();
  return { el, show: render };
}
