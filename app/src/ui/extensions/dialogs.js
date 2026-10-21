// Dialogs of the extension system: the install consent (permissions are always shown) and the form dialog
// behind `openfini.ui.form`.
import { h } from "../../core/util.js";
import { openDialog } from "../dialogs.js";
import { describePermission } from "../../extensions/manifest.js";

const RISK = { low: "Low", medium: "Medium", high: "High" };

/** Shows what an extension is and what it may do. Resolves true only when the user presses Install/Update. */
export function consentDialog({ manifest, existing, warnings = [], source = {}, newPermissions = [] }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const perms = manifest.permissions.length
      ? manifest.permissions.map((p) => {
          const d = describePermission(p);
          return h("li.of-ext-perm", { class: `risk-${d.risk}` }, h("span.of-ext-perm__risk", RISK[d.risk]), h("div", h("strong", d.label), h("small", d.text)));
        })
      : [h("li.of-ext-perm.risk-low", h("span.of-ext-perm__risk", "None"), h("div", h("strong", "No special permissions"), h("small", "It can only add the things listed under “What it adds”.")))];
    const c = manifest.contributes;
    const adds = [["command", c.commands], ["panel", c.panels], ["theme", c.themes], ["template", c.templates], ["file importer", c.importers], ["file exporter", c.exporters], ["Vibe tool", c.vibeTools], ["Vibe skill", c.vibeSkills], ["snippet", c.snippets]]
      .filter(([, l]) => l.length)
      .map(([n, l]) => `${l.length} ${n}${l.length === 1 ? "" : "s"}`);
    const src = source.type === "url" ? `Downloaded from ${source.url}` : source.type === "unpacked" ? `Unpacked folder “${source.name}” (developer mode)` : source.type === "assistant" ? "Written by the Vibe assistant for you" : source.type === "bundled" ? "Ships with OpenFini (not installed by default)" : source.name ? `File ${source.name}` : "Local package";
    const body = h(
      "div.of-ext-consent",
      h("div.of-ext-consent__head", h("h3", manifest.name), h("small", `${manifest.id} · version ${manifest.version}`)),
      manifest.description ? h("p", manifest.description) : null,
      h("p.of-ext-consent__src", src),
      adds.length ? h("p", h("strong", "What it adds: "), adds.join(", "), ".") : null,
      h("h4", existing ? `Permissions${newPermissions.length ? ` (${newPermissions.length} new)` : ""}` : "Permissions it asks for"),
      h("ul.of-ext-perms", perms),
      warnings.length ? h("p.of-ext-warn", `Notes: ${warnings.join(" ")}`) : null,
      h("p.of-ext-consent__warn", "Extensions run code that someone else wrote. They live in a sandbox and can only do what is listed above, but you should install only extensions you trust. You can switch off any permission later."),
    );
    openDialog({
      title: existing ? `Update “${existing.name}”?` : "Install extension?",
      body,
      width: 560,
      cls: "of-ext-dialog",
      buttons: [
        { label: "Cancel", onClick: (close) => (finish(false), close()) },
        { label: existing ? "Update" : "Install", variant: "primary", onClick: (close) => (finish(true), close()) },
      ],
      onClose: () => finish(false),
    });
  });
}

/** `openfini.ui.form({title, fields})`: resolves with { name: value } or null when cancelled. */
export function formDialog({ title, description = "", ok = "OK", fields }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const inputs = [];
    for (const f of fields) {
      if (!f || typeof f.name !== "string" || typeof f.label !== "string") continue;
      const label = String(f.label).slice(0, 80);
      const hint = f.hint ? String(f.hint).slice(0, 160) : "";
      let el;
      if (f.type === "boolean") {
        el = h("sl-switch", { size: "small" }, label);
        el.checked = f.default === true;
      } else if (f.type === "select") {
        el = h("sl-select", { label, size: "small", hoist: true, "help-text": hint });
        const opts = (Array.isArray(f.options) ? f.options : []).slice(0, 60).map((o) => (typeof o === "object" ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) }));
        for (const o of opts) el.append(h("sl-option", { value: o.value }, o.label));
        el.value = String(f.default ?? opts[0]?.value ?? "");
      } else if (f.type === "number") {
        el = h("sl-input", { type: "number", label, size: "small", value: String(f.default ?? 0), min: f.min, max: f.max, step: f.step ?? 1, "help-text": hint });
      } else el = h("sl-input", { type: "text", label, size: "small", value: String(f.default ?? ""), "help-text": hint });
      el.addEventListener("keydown", (e) => e.stopPropagation());
      inputs.push({ f, el });
    }
    const collect = () => {
      const out = {};
      for (const { f, el } of inputs) {
        if (f.type === "boolean") out[f.name] = !!el.checked;
        else if (f.type === "number") {
          let n = Number(el.value);
          if (!Number.isFinite(n)) n = Number(f.default) || 0;
          out[f.name] = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));
        } else out[f.name] = String(el.value ?? "");
      }
      return out;
    };
    const { dlg } = openDialog({
      title,
      body: h("form.of-ext-form", { onsubmit: (e) => e.preventDefault() }, description ? h("p.of-hint", description) : null, ...inputs.map((i) => i.el)),
      width: 420,
      buttons: [
        { label: "Cancel", onClick: (close) => (finish(null), close()) },
        { label: ok, variant: "primary", onClick: (close) => (finish(collect()), close()) },
      ],
      onClose: () => finish(null),
    });
    dlg.addEventListener("sl-after-show", () => inputs[0]?.el.focus?.());
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName !== "SL-SELECT") {
        finish(collect());
        dlg.hide();
      }
    });
  });
}
