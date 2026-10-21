// Form for a skill's named parameters, shown when the user starts a skill with /name (or "Use" in the Skills panel).
// Resolves to { name: value } or null when cancelled.
import { h } from "../../core/util.js";
import { openDialog } from "../dialogs.js";

export function skillArgsDialog(skill) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const inputs = skill.params.map((p, i) => {
      const id = `of-skarg-${i}`;
      const el = h("input.of-vfield__in", { id, type: "text", value: p.default ?? "", placeholder: p.required ? "Required" : "Optional", "aria-required": p.required ? "true" : "false" });
      el.addEventListener("keydown", (e) => e.stopPropagation());
      return { p, el, row: h("div.of-vfield", h("label", { for: id }, h("strong", p.name), p.description ? h("small", ` — ${p.description}`) : null), el) };
    });
    const err = h("div.of-vstatus.bad", { role: "alert" });
    const body = h("div.of-skillform", h("p.of-dialog__text", skill.description), ...inputs.map((x) => x.row), err);
    const submit = (close) => {
      const out = {};
      const missing = [];
      for (const { p, el } of inputs) {
        const v = el.value.trim();
        if (v) out[p.name] = v;
        else if (p.required) missing.push(p.name);
      }
      if (missing.length) {
        err.textContent = `Please fill in: ${missing.join(", ")}.`;
        return;
      }
      finish(out);
      close();
    };
    openDialog({
      title: `Skill: ${skill.name}`,
      body,
      width: 480,
      buttons: [
        { label: "Cancel", onClick: (close) => (finish(null), close()) },
        { label: "Use skill", variant: "primary", onClick: submit },
      ],
      onClose: () => finish(null),
    });
    setTimeout(() => inputs[0]?.el.focus(), 60);
  });
}
