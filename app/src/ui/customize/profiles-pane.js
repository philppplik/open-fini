// Settings > Profiles and backup: export / import .ofprofile files with a preview, named profiles, reset everything.
import { h } from "../../core/util.js";
import { platform } from "../../platform/index.js";
import { button } from "../controls.js";
import { openDialog, confirmDialog, promptDialog } from "../dialogs.js";
import { PROFILE_TEMPLATES, PROFILE_EXT, summarizeValue, validateProfile } from "../../customize/profile.js";

export function profilesPane(app) {
  const cz = app.customize;
  const root = h("div.of-cz");
  const status = h("div.of-kb__status", { role: "status", "aria-live": "polite" });
  const say = (m) => (status.textContent = m);

  async function exportFile() {
    const name = (await promptDialog({ title: "Export profile", label: "Profile name", value: app.prefs.profileActive || "My profile", ok: "Export" }));
    if (name == null) return;
    const bytes = new TextEncoder().encode(cz.exportProfile(name.trim() || "My profile"));
    const r = await platform.saveFile({ suggestedName: `${(name.trim() || "profile").replace(/[^\w.-]+/g, "-")}${PROFILE_EXT}`, bytes, mime: "application/json", filters: [{ name: "OpenFini profile", extensions: ["ofprofile"] }] });
    if (r) say(`Saved ${r.name}. It contains settings only: no keys, tokens or documents.`);
  }

  async function importFile() {
    const [file] = await platform.openFiles({ accept: [{ description: "OpenFini profile", extensions: ["ofprofile", "json"] }] });
    if (!file) return;
    previewDialog(new TextDecoder().decode(file.bytes), file.name);
  }

  function previewDialog(text, fileName) {
    const v = validateProfile(text);
    if (!v.ok) {
      openDialog({ title: "Cannot import this profile", body: h("div", h("p", `${fileName} was not imported:`), h("ul", ...v.errors.slice(0, 8).map((e) => h("li", e)))), buttons: [{ label: "Close", variant: "primary", onClick: (c) => c() }] });
      return;
    }
    let mode = "merge";
    const body = h("div.of-cz__preview");
    const draw = () => {
      const p = cz.previewProfile(text, mode);
      body.replaceChildren(
        h("p", `“${p.profile.name}” from ${fileName}: ${p.diff.length ? `${p.diff.length} setting${p.diff.length === 1 ? "" : "s"} would change.` : "nothing would change."}`),
        h("div.of-seg", { role: "group", "aria-label": "Import mode" }, ...[["merge", "Merge (keep what the file does not mention)"], ["replace", "Replace (everything else returns to the default)"]].map(([m, l]) => { const b = h("button.of-seg__btn", { type: "button", "aria-pressed": String(m === mode) }, l); b.addEventListener("click", () => ((mode = m), draw())); return b; })),
        p.warnings.length ? h("p.of-set__hint", p.warnings.slice(0, 4).join(" ")) : null,
        h("table.of-cz__diff", h("thead", h("tr", h("th", "Setting"), h("th", "Now"), h("th", "After"))), h("tbody", ...p.diff.map((d) => h("tr", h("td", d.label), h("td", summarizeValue(d.key, d.from)), h("td", summarizeValue(d.key, d.to)))))),
      );
    };
    draw();
    openDialog({
      title: "Import profile",
      body,
      width: 640,
      buttons: [
        { label: "Cancel", onClick: (c) => c() },
        { label: "Apply", variant: "primary", onClick: (c) => { const n = cz.applyProfile(v.profile, mode).length; c(); say(`Profile applied (${n} change${n === 1 ? "" : "s"}).`); app.emit("prefs", "*"); } },
      ],
    });
  }

  function render() {
    const stored = cz.storedProfiles();
    const active = app.prefs.profileActive;
    const list = h("ul.of-cz__list", { "aria-label": "Named profiles" });
    for (const name of Object.keys(stored)) {
      list.append(h("li.of-cz__item", { class: name === active ? "active" : "" }, h("div.of-cz__names", h("span", name, name === active ? h("small", " (active)") : null)),
        name === active ? button("Update from current", () => { cz.saveProfile(name); say(`“${name}” updated.`); render(); }, { cls: "of-cz__small" }) : button("Switch", () => { cz.switchProfile(name); say(`Switched to “${name}”.`); render(); }, { cls: "of-cz__small" }),
        button("Delete", async () => { if (await confirmDialog({ title: "Delete profile", message: `Delete the profile “${name}”? Your current settings stay as they are.`, ok: "Delete", danger: true })) { cz.deleteProfile(name); render(); } }, { cls: "of-cz__small" })));
    }
    if (!Object.keys(stored).length) list.append(h("li.of-cz__item", h("span.of-set__hint", "No named profiles yet. Save your current settings, or start from a template.")));
    const tpl = h("select", { "aria-label": "New profile from template" }, h("option", { value: "" }, "New from template…"), ...PROFILE_TEMPLATES.map((t) => h("option", { value: t.id }, `${t.name}: ${t.description}`.slice(0, 90))));
    tpl.addEventListener("change", async () => {
      const t = PROFILE_TEMPLATES.find((x) => x.id === tpl.value);
      if (!t) return;
      const name = await promptDialog({ title: "New profile", label: "Name", value: t.name, ok: "Create" });
      if (name) { cz.createProfileFromTemplate(t.id, name); say(`Profile “${name}” created. Use Switch to apply it.`); }
      render();
    });
    root.replaceChildren(
      h("section.of-set__group", h("h3", "Named profiles"), h("p.of-set__hint", "Switching saves the active profile first, then applies the other one completely. Profiles are stored on this device."), list,
        h("div.of-cz__bar", button("Save current settings as…", async () => { const n = await promptDialog({ title: "Save profile", label: "Name", value: "Work", ok: "Save" }); if (n) { const saved = cz.saveProfile(n); say(saved ? `Saved as “${saved}”.` : "Enter a name."); render(); } }), tpl)),
      h("section.of-set__group", h("h3", "Backup and sharing"), h("p.of-set__hint", `A ${PROFILE_EXT} file holds appearance, shortcuts, toolbox, menus, layout, workspaces and defaults. It never contains API keys, tokens, passwords or documents. Imports are checked strictly and previewed before anything changes.`),
        h("div.of-cz__bar", button("Export profile…", () => exportFile().catch((e) => say(`Export failed: ${e.message}`))), button("Import profile…", () => importFile().catch((e) => say(`Import failed: ${e.message}`))))),
      h("section.of-set__group", h("h3", "Reset"), h("div.of-set__row", h("div", h("div.of-set__label", "Reset everything"), h("div.of-set__hint", "Every setting, shortcut, workspace and named profile on this device returns to the defaults. Documents and AI connections are not touched.")), h("div.of-set__ctl", button("Reset everything…", async () => { if (await confirmDialog({ title: "Reset everything", message: "Reset all settings, shortcuts, workspaces and profiles?", ok: "Reset everything", danger: true })) { cz.resetEverything(); say("Everything was reset."); render(); } }, { variant: "danger" })))),
      status,
    );
  }
  render();
  return root;
}
