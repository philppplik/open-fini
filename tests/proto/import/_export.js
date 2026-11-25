// A minimal HTML exporter for the import round-trip tests: the canvas CSS of engine/proto/css.js as style attributes,
// with data-proto-id on every element (what T7's HTML export and the Code studio live link write).
import { createResolver } from "../../../app/src/engine/proto/resolve.js";
import { treeCss } from "../../../app/src/engine/proto/css.js";
import { topLevel } from "../../../app/src/engine/proto/tree.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const style = (decls) => decls.map(([k, v]) => `${k}: ${v}`).join("; ");

export function exportHtml(model, page = Object.keys(model.pages)[0]) {
  const resolver = createResolver(model);
  const out = [];
  for (const id of topLevel(model, page) || []) {
    const root = resolver.tree(id);
    const css = treeCss(root, { model, vars: "value", root: "canvas" });
    const el = (r) => {
      const c = css.get(r.key);
      const attrs = ` data-proto-id="${esc(r.id)}" style="${esc(style(c.decls))}"`;
      if (c.text) return `<div${attrs}>${c.text.runs.map((run) => `<span${run.decls.length ? ` style="${esc(style(run.decls))}"` : ""}>${esc(run.text)}</span>`).join("")}</div>`;
      return `<div${attrs}>${r.children.map(el).join("")}</div>`;
    };
    out.push(el(root));
  }
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin: 0">${out.join("")}</body></html>`;
}
