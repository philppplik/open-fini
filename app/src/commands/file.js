// File and document commands: new, open, save, export, place, paste, close, document setup.
import { confirmDialog, openDialog, toPx, fromPx, UNITS } from "../ui/dialogs.js";
import { exportDialog, runExport } from "../ui/export-dialog.js";
import { numField, selectField } from "../ui/controls.js";
import { h, downloadName } from "../core/util.js";
import { platform } from "../platform/index.js";
import { saveOfini, loadOfini, OFINI_MIME } from "../core/ofini.js";
import { OPEN_FILTERS, PLACE_FILTERS, sniffMime, placeFile, placeSvg, openImageAsDocument } from "../core/io.js";
import { addRecent, getRecents, getRecentBytes, saveSession, loadSession } from "../core/storage.js";
import { pick } from "../engine/hit.js";
import { foreignFormatInfo } from "../core/foreign.js";
import { isTextDocumentName } from "../core/text-docs.js";
import { markUntrusted } from "../core/security.js";
import { log } from "../core/log.js";
import { singleFlight } from "../core/single-flight.js";

const SAVE_FILTERS = [{ name: "OpenFini document", extensions: ["ofini"] }];

export function registerFileCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });
  const hasDoc = (a) => !!a.doc;

  def("file.new", "New…", (a) => a.emit("dialog", { id: "new" }), { shortcut: "Mod+N", icon: "file-earmark-plus" });

  async function openFile(file) {
    if (await app.importWithExtension?.(file)) return null; // a file type an installed extension imports
    // Photoshop and InDesign files have public specifications: PSD / PSB and IDML open as documents
    if (/.(psd|psb|idml)$/i.test(file.name) || (file.bytes[0] === 0x38 && file.bytes[1] === 0x42 && file.bytes[2] === 0x50 && file.bytes[3] === 0x53)) {
      const { sniffFormat } = await import("../engine/formats/index.js");
      const kind = sniffFormat(file.bytes, file.name);
      const imp = await import("../core/import-formats.js");
      if (kind === "psd" || kind === "psb") return imp.openPsd(app, file);
      if (kind === "idml") return imp.openIdml(app, file);
    }
    // PDF, Illustrator, Sketch and the "convert this first" guidance for Affinity, InDesign, Figma, XD ... (core/open-foreign.js)
    const fb = file.bytes;
    if (/\.(pdf|ai|eps|sketch|afdesign|afphoto|afpub|aftemplate|afpackage|indd|indt|fig|xd|cdr|pxd|kra|xcf)$/i.test(file.name) || (fb[0] === 0x25 && fb[1] === 0x50 && fb[2] === 0x44 && fb[3] === 0x46)) {
      const r = await (await import("../core/open-foreign.js")).openForeign(app, file);
      if (r !== undefined) return r;
    }
    const foreign = foreignFormatInfo(file.name);
    if (foreign) {
      openDialog({ title: foreign.title, body: h("p.of-dialog__text", foreign.message), width: 480, buttons: [{ label: "OK", variant: "primary", onClick: (c) => c() }] });
      return null;
    }
    // Markdown, LaTeX, JSON, YAML, TypeScript … open as a one-file project in the Code studio
    if (isTextDocumentName(file.name)) return (await import("../ui/code/open-document.js")).openTextDocument(app, file);
    const mime = sniffMime(file.bytes, file.name);
    if (mime === OFINI_MIME || /\.ofini$/i.test(file.name)) {
      const doc = await loadOfini(file.bytes);
      if (!doc.name || doc.name === "Untitled") doc.name = file.name.replace(/\.ofini$/i, "");
      doc.path = file.path || null;
      doc.saved = true;
      markUntrusted(app.prefs, doc); // protected mode: website scripts stay off in the preview until enabled
      app.setStudio(["pixel", "layout", "code"].includes(doc.studio) ? doc.studio : "vector");
      app.openDoc(doc);
      requestAnimationFrame(() => app.cv?.fitPage());
      addRecent({ name: file.name, bytes: file.bytes, path: file.path }).then((r) => app.emit("recents", r));
      return doc;
    }
    if (mime === "image/svg+xml") {
      app.setStudio("vector");
      return placeSvg(app, new TextDecoder().decode(file.bytes), file.name, { asNewDoc: true });
    }
    if (mime.startsWith("image/")) return openImageAsDocument(app, file);
    throw new Error(`“${file.name}” is not a file OpenFini can open.`);
  }
  app.openFile = openFile;

  def("file.open", "Open…", async (a) => {
    const files = await platform.openFiles({ accept: OPEN_FILTERS, multiple: true });
    for (const f of files) {
      try {
        await openFile(f);
      } catch (err) {
        a.toast(err.message, "danger", 6000);
      }
    }
  }, { shortcut: "Mod+O", icon: "folder2-open" });

  def("file.openRecent", "Open Recent", async (a, rec) => {
    if (!rec) return;
    try {
      // Desktop recents keep only the path (the OS file dialog is the way to read it again).
      if (rec.path) return a.run("file.open");
      const bytes = await getRecentBytes(rec.id);
      if (!bytes) return a.toast("That recent file is no longer stored on this device.", "warning");
      await openFile({ name: rec.name, bytes, mime: OFINI_MIME });
    } catch (err) {
      a.toast(err.message, "danger");
    }
  });

  // One save per document at a time: a second trigger while the first is still waiting for its file dialog
  // (key auto-repeat, shortcut plus click) joins it instead of opening another dialog.
  const save = singleFlight(saveDoc, (a) => a.doc);
  async function saveDoc(a, forceDialog) {
    const doc = a.doc;
    if (!doc) return;
    if (a.studio === "code" && a.prefs.codeFormatOnSave && a.codeUI?.built) a.codeUI.editors.format();
    a.status("Saving…");
    try {
      const bytes = await saveOfini(doc);
      let res;
      if (doc.path && platform.isDesktop && !forceDialog) res = await platform.saveFileTo(doc.path, bytes);
      else res = await platform.saveFile({ suggestedName: downloadName(doc.name, "ofini"), bytes, mime: OFINI_MIME, filters: SAVE_FILTERS });
      if (!res) return;
      if (res.path) doc.path = res.path;
      doc.name = res.name.replace(/\.ofini$/i, "") || doc.name;
      doc.saved = true;
      a.emit("saved");
      a.emit("docchange", {});
      addRecent({ name: res.name, bytes, path: res.path }).then((r) => a.emit("recents", r));
      a.toast(`Saved ${res.name}`, "success", 1800);
    } finally {
      a.status("");
    }
  }
  def("file.save", "Save", (a) => save(a, false), { shortcut: "Mod+S", enabled: hasDoc, icon: "save" });
  def("file.saveAll", "Save All", async (a) => {
    const keep = a.doc;
    let n = 0;
    for (const d of [...a.docs]) {
      if (d.saved) continue;
      a.activateDoc(d);
      await save(a, false);
      if (d.saved) n++;
    }
    if (keep && a.docs.includes(keep)) a.activateDoc(keep);
    a.toast(n ? `Saved ${n} document${n === 1 ? "" : "s"}.` : "Everything is already saved.", n ? "success" : "primary", 1800);
  }, { shortcut: "Mod+Alt+S", enabled: (a) => a.docs.length > 0, icon: "save2" });
  def("file.saveAs", "Save As…", (a) => save(a, true), { shortcut: "Mod+Shift+S", enabled: hasDoc });

  def("file.export", "Export…", (a) => exportDialog(a), { shortcut: "Mod+Shift+E", enabled: hasDoc, icon: "box-arrow-up" });
  for (const [fmt, label] of [["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"], ["svg", "SVG"], ["pdf", "PDF"]]) {
    def(`file.export${fmt === "jpeg" ? "JPG" : fmt.toUpperCase()}`, `Export as ${label}`, (a) => runExport(a, { format: fmt, scope: "page", scale: 1, quality: 0.9, transparent: false, bleed: false, marks: false, rasterDpi: 200 }).catch((e) => a.toast(e.message, "danger", 6000)), { enabled: hasDoc });
  }

  def("file.openFolder", "Open Folder…", async (a) => (await import("../ui/open-folder.js")).openFolderDialog(a), { shortcut: "Mod+Shift+O", icon: "folder-symlink" });

  def("file.place", "Place Image…", async (a) => {
    const files = await platform.openFiles({ accept: PLACE_FILTERS, multiple: true });
    for (const f of files) {
      try {
        await placeFile(a, f);
      } catch (err) {
        a.toast(err.message, "danger", 6000);
      }
    }
  }, { shortcut: "Mod+Shift+P", enabled: hasDoc, icon: "image" });

  def("file.placeFiles", "Place Files", async (a, { files, x, y }) => {
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const named = { name: f.name, bytes, mime: f.type };
        if (!a.doc) await openFile(named);
        else if (/\.(ofini|pdf|ai|psd|psb|idml|sketch|afdesign|afphoto|afpub|indd|fig|xd)$/i.test(f.name)) await openFile(named); // documents of other apps open as documents; they are not placed
        else {
          // dropping onto an image frame fills that frame
          const hit = x != null ? pick(a.context, x, y, 4 / a.view.zoom, { deep: true }) : null;
          if (hit?.imageFrame) a.select([hit]);
          await placeFile(a, named, { x, y });
        }
      } catch (err) {
        a.toast(err.message, "danger", 6000);
      }
    }
  });
  app.on("dropfiles", (d) => app.run("file.placeFiles", d));

  def("file.pasteSystem", "Paste from Clipboard", async (a) => {
    try {
      const blob = await platform.clipboardReadImage?.();
      if (blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return placeFile(a, { name: "Pasted image", bytes, mime: blob.type });
      }
      const text = await navigator.clipboard?.readText?.();
      if (text && text.trim().startsWith("<svg")) return placeSvg(a, text, "Pasted SVG");
      if (text && a.doc && a.studio === "layout") {
        const { pasteTextAsTable } = await import("./data.js");
        if (pasteTextAsTable(a, text)) return;
      }
      if (text && a.doc) {
        const { addTextNode } = await import("../core/text-ops.js");
        return addTextNode(a, { text, x: a.page.w / 2 - 100, y: a.page.h / 2 - 20, w: 400 });
      }
    } catch {
      a.toast("Nothing to paste.", "warning");
    }
  });
  // images pasted with the browser's own paste event
  window.addEventListener("paste", async (e) => {
    if (!app.doc || e.defaultPrevented) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item && !app.clip) {
      e.preventDefault();
      const f = item.getAsFile();
      placeFile(app, { name: "Pasted image", bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type }).catch((err) => app.toast(err.message, "danger"));
    }
  });

  const closeDoc = singleFlight(async (a, doc) => {
    const d = doc && doc.pages ? doc : a.doc;
    if (!d) return;
    if (!d.saved && app.prefs.confirmClose !== false) {
      const r = await confirmDialog({ title: "Close document", message: `“${d.name}” has unsaved changes.`, ok: "Save", extra: "Don’t Save", cancel: "Cancel" });
      if (r === false) return;
      if (r === true) {
        a.activateDoc(d);
        await save(a, false);
        if (!d.saved) return;
      }
    }
    a.closeDoc(d);
  }, (a, doc) => (doc && doc.pages ? doc : a.doc));
  // Quitting (desktop window close, Alt+F4, Cmd+Q): every unsaved document goes through the same
  // "Save / Don't Save / Cancel" confirmation as closing its tab. Resolves false when the user cancels.
  app.confirmQuit = async () => {
    if (app.prefs.confirmClose === false) return true;
    for (const d of [...app.docs]) {
      if (d.saved) continue;
      await closeDoc(app, d);
      if (app.docs.includes(d)) return false; // cancelled (or the save was cancelled)
    }
    return true;
  };
  def("file.close", "Close", (a, doc) => closeDoc(a, doc), { shortcut: "Mod+W", enabled: hasDoc });

  def("file.docSetup", "Document Setup…", (a) => documentSetupDialog(a), { enabled: hasDoc });

  // ---- help
  def("help.shortcuts", "Keyboard Shortcuts", (a) => a.emit("dialog", { id: "shortcuts" }), { shortcut: "Mod+/" });
  def("help.about", "About OpenFini", (a) => a.emit("dialog", { id: "about" }));
  def("help.issues", "Report an Issue…", async (a) => (await import("../ui/diagnostics-dialog.js")).reportIssueDialog(a));
  def("help.docs", "Documentation", async (a) => (await import("../ui/links.js")).openLink("https://github.com/philppplik/open-fini#readme", { app: a }));
  // troubleshooting and security (docs/troubleshooting.md, docs/security.md)
  def("help.troubleshoot", "Troubleshooting…", async (a, o) => (await import("../ui/diagnostics-dialog.js")).troubleshootingDialog(a, o?.tab), { shortcut: "Mod+Shift+F1", icon: "bug" });
  def("help.copyReport", "Copy Diagnostic Report", async (a) => (await import("../ui/diagnostics-dialog.js")).copyReport(a));
  def("help.saveBundle", "Save Diagnostic Bundle…", async (a) => (await import("../ui/diagnostics-dialog.js")).saveBundle(a));
  def("help.safeMode", "Restart in Safe Mode…", async (a) => {
    if (a.docs.some((d) => !d.saved) && !(await confirmDialog({ title: "Restart in safe mode", message: "Unsaved changes stay in the autosaved copy on this device but will not be restored in safe mode. Restart now?", ok: "Restart" }))) return;
    if (a.prefs.autosave) await a.autosaveNow?.();
    (await import("../ui/diagnostics-dialog.js")).restartInSafeMode();
  });
  def("help.resetData", "Reset App Data…", async (a) => (await import("../ui/diagnostics-dialog.js")).resetAppDataDialog(a));
  def("help.security", "Security Check…", (a) => a.emit("dialog", { id: "preferences", section: "security" }), { icon: "shield-lock" });
  def("file.lock", "Lock OpenFini", async (a) => (await import("../ui/app-lock.js")).lockNow(a), { shortcut: "Mod+Alt+L", icon: "lock" });
  def("security.offline", "Offline Mode", (a) => a.setPref("offlineMode", !a.prefs.offlineMode), { checked: (a) => !!a.prefs.offlineMode, icon: "wifi-off" });

  // ---- recent files menu
  let recents = [];
  getRecents().then((r) => {
    recents = r;
    app.emit("recents", r);
  });
  app.on("recents", (r) => (recents = r));
  app.menuProviders = app.menuProviders || {};
  app.menuProviders.recent = () => (recents.length ? recents.slice(0, 8).map((r) => ({ label: r.name, run: () => app.run("file.openRecent", r) })) : [{ label: "No recent files", disabled: true, run() {} }]);

  // ---- autosave + restore
  let saveTimer = 0;
  const schedule = () => {
    if (!app.prefs.autosave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, Math.max(1, Number(app.prefs.autosaveSeconds) || 4) * 1000);
  };
  async function autosave() {
    if (!app.docs.length) return;
    try {
      const entries = [];
      for (const d of app.docs) entries.push({ name: d.name, studio: d.studio, saved: d.saved, path: d.path || null, untrusted: !!d.untrusted && !d.scriptsOk, bytes: await saveOfini(d) });
      await saveSession(entries, app.docs.indexOf(app.doc));
    } catch (err) {
      log.warn("storage", "Autosave failed", err);
    }
  }
  app.autosaveNow = autosave;
  app.on("docchange", schedule);
  app.on("docs", schedule);
  app.restoreSession = async () => {
    const s = await loadSession();
    if (!s?.docs?.length) return false;
    let n = 0;
    for (const e of s.docs) {
      try {
        const doc = await loadOfini(e.bytes);
        doc.path = e.path;
        doc.saved = e.saved;
        if (e.untrusted) doc.untrusted = true; // still protected: the user has not enabled its scripts
        app.openDoc(doc, { activate: false });
        n++;
      } catch {
        /* skip a corrupt entry */
      }
    }
    if (n) {
      app.activateDoc(app.docs[Math.min(s.active ?? 0, app.docs.length - 1)] || app.docs[0]);
      app.setStudio(["pixel", "layout", "code"].includes(app.doc.studio) ? app.doc.studio : "vector");
      requestAnimationFrame(() => app.cv?.fitPage());
      app.toast("Restored your previous session.", "success", 2200);
    }
    return n > 0;
  };
}

function documentSetupDialog(app) {
  const doc = app.doc;
  const page = app.page;
  const st = { name: doc.name, unit: "px", w: page.w, h: page.h, dpi: doc.dpi, bleed: page.bleed || 0, mt: page.margins.top, mr: page.margins.right, mb: page.margins.bottom, ml: page.margins.left, cols: page.columns, gutter: page.gutter };
  const name = h("sl-input", { value: st.name, label: "Name", size: "small" });
  name.addEventListener("sl-input", () => (st.name = name.value));
  const unit = selectField({ label: "Unit", value: "px", options: UNITS, onChange: (u) => { st.unit = u; fw.set(fromPx(st.w, u, st.dpi)); fh.set(fromPx(st.h, u, st.dpi)); } });
  const fw = numField({ label: "Width", value: st.w, min: 1, precision: 2, wide: true, onChange: (v) => (st.w = toPx(v, st.unit, st.dpi)) });
  const fh = numField({ label: "Height", value: st.h, min: 1, precision: 2, wide: true, onChange: (v) => (st.h = toPx(v, st.unit, st.dpi)) });
  const dpi = numField({ label: "DPI", value: st.dpi, min: 1, max: 2400, precision: 0, wide: true, onChange: (v) => (st.dpi = v) });
  const bleed = numField({ label: "Bleed", value: st.bleed, min: 0, precision: 1, unit: "px", wide: true, onChange: (v) => (st.bleed = v) });
  const m = (label, key) => numField({ label, value: st[key], min: 0, precision: 1, unit: "px", onChange: (v) => (st[key] = v) });
  const cols = numField({ label: "Columns", value: st.cols, min: 1, max: 24, precision: 0, wide: true, onChange: (v) => (st.cols = Math.round(v)) });
  const gutter = numField({ label: "Gutter", value: st.gutter, min: 0, precision: 1, unit: "px", wide: true, onChange: (v) => (st.gutter = v) });
  const body = h(
    "div.of-form",
    name,
    h("div.of-row", fw.el, fh.el),
    h("div.of-row", unit.el, dpi.el),
    bleed.el,
    h("div.of-form__group", "Margins (all pages)"),
    h("div.of-row", m("Top", "mt").el, m("Bottom", "mb").el),
    h("div.of-row", m("Left", "ml").el, m("Right", "mr").el),
    h("div.of-row", cols.el, gutter.el),
  );
  openDialog({
    title: "Document Setup",
    body,
    width: 480,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Apply",
        variant: "primary",
        onClick: (close) => {
          doc.tx("Document Setup", () => {
            doc.set(doc, { name: st.name, dpi: st.dpi });
            for (const p of doc.pages) {
              doc.set(p, { w: Math.round(st.w), h: Math.round(st.h), bleed: st.bleed, margins: { top: st.mt, right: st.mr, bottom: st.mb, left: st.ml }, columns: st.cols, gutter: st.gutter });
            }
          });
          app.emit("saved");
          app.cv?.fitPage();
          close();
        },
      },
    ],
  });
}
