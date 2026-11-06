// Export popup (File → Export…, header button): image, vector and PDF output, slices, and — for website projects — the
// published site. Export is a popup, not a studio, so it is reachable from every studio.
//
// The Image & PDF tab is generated from the options schema (engine/export/options.js): the basic options of the
// chosen format first, the rest under "Advanced", and only options that change the output of the current settings.
// Presets (built-in and the user's, stored in the exportPresets preference) fill every option at once; the last
// settings are remembered per studio (exportLast). Rendering and saving live in core/export-run.js. See docs/export.md.
import { h, empty } from "../core/util.js";
import { t } from "../i18n/index.js";
import { openDialog, isDialogOpen, promptDialog, confirmDialog } from "./dialogs.js";
import { numField, selectField, switchField, colorField, iconButton } from "./controls.js";
import { platform } from "../platform/index.js";
import { createSlicesTab } from "./export-slices.js";
import { createWebsiteTab } from "./export-website.js";
import { createPublishTab } from "./export-publish.js";
import { EXPORT_GROUPS, BUILTIN_PRESETS, availableFormats, visibleOptions, choicesOf, normalizeExportSettings, changedSettings, planExport, presetFile, readPresetFile, validPresetList } from "../engine/export/options.js";
import { detectEncoders, exportEnv, exportInfo, runExport } from "../core/export-run.js";

export { runExport };

/** Start settings: explicit preset > last used in this studio > Settings ▸ Defaults > the studio's natural format. */
function startSettings(app, preset, env) {
  const last = (app.prefs.exportLast || {})[app.studio];
  const base = last || { ...(app.prefs.exportDefaults || {}), ...(app.studio === "layout" && !app.prefs.exportDefaults?.format ? { format: "pdf" } : {}) };
  const st = normalizeExportSettings({ ...base, ...(preset.format ? { format: preset.format } : {}) }, env);
  if (st.scope === "selection" && !env.hasSelection) st.scope = "page";
  return st;
}

function textField(def, value, onChange) {
  const input = h("sl-input", { size: "small", value, placeholder: def.placeholder ? t(def.placeholder) : "", "aria-label": t(def.label), clearable: true });
  input.addEventListener("keydown", (e) => e.stopPropagation()); // typing must not trigger tool shortcuts
  input.addEventListener("sl-input", () => onChange(input.value, false));
  input.addEventListener("sl-change", () => onChange(input.value, true));
  return { el: h("div.of-select", h("span.of-num__label", t(def.label)), input) };
}

/** One control for one schema option. */
function control(def, st, env, set) {
  if (def.type === "enum") return selectField({ label: def.label, value: st[def.key], options: choicesOf(def, st, env), onChange: (v) => set(def.key, v, true) });
  if (def.type === "bool") return switchField({ label: def.label, value: st[def.key], onChange: (v) => set(def.key, v, true) });
  if (def.type === "number") return numField({ label: def.label, value: st[def.key], min: def.min, max: def.max, step: def.step || 1, unit: def.unit || "", precision: def.precision ?? 0, wide: true, onChange: (v) => set(def.key, v, true) });
  if (def.type === "color") return colorField({ label: def.label, value: st[def.key], alpha: false, onChange: (v) => set(def.key, String(v).slice(0, 7), true) });
  return textField(def, st[def.key], (v, structural) => set(def.key, v, structural));
}

export async function exportDialog(app, preset = {}) {
  if (isDialogOpen("export")) return; // already showing: never stack a second popup
  await detectEncoders(); // WebP / AVIF availability decides the format list
  if (isDialogOpen("export")) return;
  const doc = app.doc;
  const env = exportEnv(app);
  let st = startSettings(app, preset, env);
  let presetId = "";

  const presetRow = h("div.of-row.of-exportpresets");
  const formBox = h("div.of-form");
  const info = h("div.of-hint", { role: "status" });

  const userPresets = () => (validPresetList(app.prefs.exportPresets) ? app.prefs.exportPresets : []);

  function set(key, value, structural) {
    st = normalizeExportSettings({ ...st, [key]: value }, env);
    presetId = "";
    if (structural) render();
    else updateInfo();
  }

  function renderPresets() {
    empty(presetRow);
    const opts = [
      { value: "", label: t("Custom settings") },
      ...BUILTIN_PRESETS.map((p) => ({ value: `b:${p.id}`, label: t(p.name) })),
      ...userPresets().map((p, i) => ({ value: `u:${i}`, label: p.name })),
    ];
    const sel = selectField({
      label: "Preset",
      value: presetId,
      options: opts,
      onChange: (v) => {
        const p = v.startsWith("b:") ? BUILTIN_PRESETS.find((x) => `b:${x.id}` === v) : userPresets()[Number(v.slice(2))];
        if (!p) return;
        st = normalizeExportSettings(p.settings, env);
        presetId = v;
        render();
      },
    });
    const save = iconButton({ icon: "save2", label: "Save settings as preset", onClick: async () => {
      const name = (await promptDialog({ title: t("Save export preset"), label: t("Preset name"), value: "" }))?.trim();
      if (!name) return;
      const list = userPresets().filter((p) => p.name !== name).concat({ name: name.slice(0, 80), settings: changedSettings(st, env) });
      app.setPref("exportPresets", list.slice(-100));
      presetId = `u:${list.length - 1}`;
      renderPresets();
      app.toast(t("Preset “{name}” saved.", { name }), "success", 2000);
    } });
    const del = iconButton({ icon: "trash3", label: "Delete preset", disabled: !presetId.startsWith("u:"), onClick: async () => {
      const i = Number(presetId.slice(2));
      const p = userPresets()[i];
      if (!p || !(await confirmDialog({ title: t("Delete preset"), message: t("Delete the preset “{name}”?", { name: p.name }), ok: t("Delete"), danger: true }))) return;
      app.setPref("exportPresets", userPresets().filter((_, k) => k !== i));
      presetId = "";
      renderPresets();
    } });
    const imp = iconButton({ icon: "box-arrow-in-right", label: "Import presets…", onClick: async () => {
      const [file] = await platform.openFiles({ accept: [{ name: t("Export presets"), extensions: ["json"] }], multiple: false });
      if (!file) return;
      try {
        const text = new TextDecoder().decode(file.bytes);
        const list = readPresetFile(text);
        const names = new Set(list.map((p) => p.name));
        app.setPref("exportPresets", userPresets().filter((p) => !names.has(p.name)).concat(list).slice(-100));
        renderPresets();
        app.toast(t("Imported {n, plural, one {# preset} other {# presets}}.", { n: list.length }), "success", 2000);
      } catch (err) {
        app.toast(err.i18n ? t(...err.i18n) : err.message, "danger", 5000);
      }
    } });
    const exp = iconButton({ icon: "box-arrow-up", label: "Export presets…", disabled: !userPresets().length, onClick: async () => {
      const bytes = new TextEncoder().encode(presetFile(userPresets()));
      await platform.saveFile({ suggestedName: "openfini-export-presets.json", bytes, mime: "application/json", filters: [{ name: t("Export presets"), extensions: ["json"] }] });
    } });
    presetRow.append(sel.el, save, del, imp, exp);
  }

  function render() {
    empty(formBox);
    const fmt = selectField({ label: "Format", value: st.format, options: availableFormats(env).map((f) => ({ value: f.id, label: f.label })), onChange: (v) => set("format", v, true) });
    formBox.append(fmt.el);
    const visible = visibleOptions(st, env);
    const basic = visible.filter((d) => !d.advanced);
    const advanced = visible.filter((d) => d.advanced);
    const withHint = (def, el) => (def.hint ? h("div", el, h("p.of-hint", t(def.hint))) : el);
    for (const def of basic) formBox.append(withHint(def, control(def, st, env, set).el));
    if (advanced.length) {
      const body = h("div.of-form");
      for (const g of EXPORT_GROUPS) {
        const defs = advanced.filter((d) => d.group === g.id);
        if (!defs.length) continue;
        body.append(h("h4.of-exportgroup", t(g.label)));
        for (const def of defs) body.append(withHint(def, control(def, st, env, set).el));
      }
      const det = h("sl-details", { summary: t("Advanced"), class: "of-exportadvanced" }, body);
      det.open = !!app.prefs.exportAdvancedOpen;
      det.addEventListener("sl-show", (e) => e.target === det && app.setPref("exportAdvancedOpen", true));
      det.addEventListener("sl-hide", (e) => e.target === det && app.setPref("exportAdvancedOpen", false));
      formBox.append(det);
    }
    if (st.format === "pdf") formBox.append(h("p.of-hint", t("PDF/X output converts colors with the document's Color Settings and is checked by OpenFini's preflight, not by a certified validator.")));
    if (st.format === "psd") formBox.append(h("p.of-hint", t("Every top-level layer becomes a Photoshop layer (groups are merged into one). Live effects are baked in.")));
    updateInfo();
  }

  /** Live summary: files, pixel size and the first file name, or the reason the export cannot run. */
  function updateInfo() {
    try {
      const plan = planExport(st, exportInfo(app));
      const j = plan.jobs[0];
      const ext = availableFormats(env).find((f) => f.id === st.format)?.ext || st.format;
      const parts = [];
      if (plan.files > 1) parts.push(t("{n} files in a ZIP archive", { n: plan.files }));
      if (j.size) parts.push(plan.files > 1 ? t("first: {w} × {h} px", { w: j.size.width, h: j.size.height }) : t("{w} × {h} px at {ppi} ppi", { w: j.size.width, h: j.size.height, ppi: Math.round(j.size.ppi) }));
      if (st.format === "pdf") parts.push(t("{n, plural, one {# page} other {# pages}}", { n: j.pages.length }));
      parts.push(`${j.name}.${ext}`);
      info.textContent = parts.join(" · ") + (plan.warningKeys.length ? ` — ${plan.warningKeys.map(([k, p]) => t(k, p)).join(" ")}` : "");
      info.classList.toggle("of-hint--warn", plan.warnings.length > 0);
    } catch (err) {
      info.textContent = err.i18n ? t(...err.i18n) : err.message;
      info.classList.add("of-hint--warn");
    }
  }

  renderPresets();
  render();

  const remember = () => app.setPref("exportLast", { ...(app.prefs.exportLast || {}), [app.studio]: changedSettings(st, env) });
  const imageTab = h("div.of-form", presetRow, formBox, info);
  const slicesTab = createSlicesTab(app);
  // each tab: label of the primary button and what it does
  const tabs = [
    { id: "image", label: "Image & PDF", action: "Export", el: imageTab, run: () => (remember(), runExport(app, st)) },
    { id: "slices", label: "Slices", action: "Export slices", el: slicesTab.el, run: () => slicesTab.run() },
  ];
  if (doc.web) tabs.push(createWebsiteTab(app, doc.web), createPublishTab(app, doc.web)); // website projects of the Code studio
  let active = tabs.find((t) => t.id === preset.tab) || (app.studio === "code" && tabs.find((t) => t.id === "website")) || tabs[0];

  const group = h(
    "sl-tab-group",
    { class: "of-exporttabs" },
    tabs.map((t) => h("sl-tab", { slot: "nav", panel: t.id, active: t === active || undefined }, t.label)),
    tabs.map((t) => h("sl-tab-panel", { name: t.id, active: t === active || undefined }, t.el)),
  );
  let submitted = false; // a double click on the primary button must start one export, not two
  const { dlg } = openDialog({
    key: "export",
    title: "Export",
    body: group,
    width: 560,
    cls: "of-exportdialog",
    buttons: [
      {
        // mails the Image & PDF export (built-in SMTP client of the desktop app; the browser shows how to attach it instead)
        label: "Send by email…",
        variant: "text",
        onClick: async (close) => {
          if (active !== tabs[0]) return app.toast("Send by email uses the Image & PDF settings: switch to that tab first.", "warning", 3500);
          if (submitted) return;
          submitted = true;
          close();
          remember();
          try {
            const { sendByEmailDialog } = await import("./send-email.js");
            await runExport(app, { ...st, deliver: (files) => sendByEmailDialog(app, files, { fallbackSave: () => runExport(app, st) }) });
          } catch (err) {
            app.toast(err.i18n ? t(...err.i18n) : err.message || "Export failed.", "danger", 6000);
          }
        },
      },
      { label: "Cancel", onClick: (c) => c() },
      {
        label: active.action,
        variant: "primary",
        onClick: async (close) => {
          if (active === tabs[1] && !slicesTab.count()) return app.toast("Add a slice first.", "warning");
          if (submitted) return;
          submitted = true;
          close();
          try {
            await active.run();
          } catch (err) {
            console.error(err);
            app.toast(err.i18n ? t(...err.i18n) : err.message || "Export failed.", "danger", 6000);
          }
        },
      },
    ],
    onClose: () => slicesTab.dispose(),
  });
  // the lazily loaded tab group can upgrade after its children were attached; make sure the first panel shows
  Promise.all([customElements.whenDefined("sl-tab-group"), customElements.whenDefined("sl-tab-panel")]).then(async () => {
    await group.updateComplete;
    const panels = [...group.querySelectorAll("sl-tab-panel")];
    await Promise.all(panels.map((p) => p.updateComplete));
    for (const p of panels) p.active = p.getAttribute("name") === active.id;
  });
  const primary = dlg.querySelector('[slot="footer"]')?.lastElementChild;
  group.addEventListener("sl-tab-show", (e) => {
    if (e.target !== group) return;
    active = tabs.find((t) => t.id === e.detail.name) || active;
    if (primary) primary.textContent = t(active.action);
  });
}
