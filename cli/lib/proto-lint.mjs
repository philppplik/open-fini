// Design lint for `ofini proto lint` (docs/cli.md ▸ Proto). Pure: a model in, findings out.
//
// Rules (ids for --rules):
//   schema          validation errors and warnings of engine/proto/validate.js (broken references, limits, …)
//   unresolved      variables, components or modes the resolver could not find (resolve.js warnings)
//   stale-override  instance overrides whose layer no longer exists in the main component; fix: reset those paths
//   text-overflow   text taller than its fixed box, or a word wider than a wrapping box (pure solver, approximate)
//   clipped         a layer that sticks out of a parent that clips its content (approximate)
//   touch-target    a layer that reacts to click or press smaller than 24 × 24 px (WCAG 2.2, 2.5.8; approximate)
//   empty-frame     a frame without layers, fills, strokes or effects
// The geometry rules lay out every top-level layer with engine/proto/layout.js; results are approximate like the
// solver (base-14 font metrics). Design rules of the assistant's linter (T11: contrast, unbound values, naming) join
// this table when engine/proto/lint.js lands.
//
// Public API
//   LINT_RULES                         { id: { severity, summary, fixable? } }
//   lintModel(model, { rules?, measurer? }) → Finding[]
//       Finding { rule, severity: "error"|"warning"|"note", code, message, id?, key?, path?, approximate?, fix?: op }
//   applyFixes(model, findings) → { model, applied: Finding[], failed: [{ finding, error }] }
import { validate } from "../../app/src/engine/proto/validate.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";
import { layout } from "../../app/src/engine/proto/layout.js";
import { overridePaths } from "../../app/src/engine/proto/components.js";
import { field } from "../../app/src/engine/proto/schema.js";
import { apply } from "../../app/src/engine/proto/ops.js";
import { pageList, topLevel, children } from "../../app/src/engine/proto/tree.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const round = (n) => Math.round(n * 10) / 10;
const TOL = 0.5;
const MIN_TARGET = 24;
const TAP_TRIGGERS = new Set(["click", "doubleClick", "press"]);

export const LINT_RULES = Object.freeze({
  schema: { severity: "error", summary: "Validation errors and warnings (references, limits, types)" },
  unresolved: { severity: "warning", summary: "Variables, components or modes that cannot be resolved" },
  "stale-override": { severity: "warning", summary: "Instance overrides of layers the main component no longer has", fixable: true },
  "text-overflow": { severity: "warning", summary: "Text that does not fit its box (approximate)" },
  clipped: { severity: "note", summary: "Layers partly hidden by a parent that clips its content (approximate)" },
  "touch-target": { severity: "warning", summary: "Click or press targets smaller than 24 × 24 px (approximate)" },
  "empty-frame": { severity: "note", summary: "Frames without layers, fills, strokes or effects" },
});

/** The layer id in a validation path such as "nodes.n5.proto[0].do[0].to". */
const idOfPath = (path) => /^nodes\.([^.[\]]+)/.exec(path || "")?.[1] || null;
const nameOf = (model, id) => (model.nodes?.[id]?.name ? `“${model.nodes[id].name}” (${id})` : id);

function geometry(model, rules, measurer, out) {
  const resolver = createResolver(model);
  for (const page of pageList(model)) {
    for (const topId of topLevel(model, page.id) || []) {
      const root = resolver.tree(topId);
      if (!root) continue;
      const L = layout(root, { measurer });
      const visit = (r, parent) => {
        const b = L.boxes.get(r.key);
        if (!b) return;
        const id = r.key.split("/")[0];
        const label = r.key === r.id ? nameOf(model, r.id) : `${nameOf(model, id)} ▸ ${r.node?.name ? `“${r.node.name}”` : r.key}`;
        if (rules.has("text-overflow") && r.type === "text" && Array.isArray(b.lines) && b.lines.length) {
          const last = b.lines[b.lines.length - 1];
          const contentH = last.y + last.h;
          const widest = Math.max(...b.lines.map((l) => l.w));
          const wraps = (r.node.text?.autoSize || "width") !== "width";
          if (contentH > b.h + TOL) out.push({ rule: "text-overflow", severity: "warning", code: "text-overflow", id, key: r.key, approximate: true, message: `The text of ${label} needs ${round(contentH)} px but its box is ${round(b.h)} px high.` });
          else if (wraps && widest > b.w + TOL) out.push({ rule: "text-overflow", severity: "warning", code: "text-too-wide", id, key: r.key, approximate: true, message: `A word in ${label} is ${round(widest)} px wide; the box is ${round(b.w)} px.` });
        }
        if (rules.has("clipped") && parent && field(parent.node, "clip") === true && field(parent.node, "scroll") === "none") {
          const pb = L.boxes.get(parent.key);
          if (pb && (b.x < pb.x - TOL || b.y < pb.y - TOL || b.x + b.w > pb.x + pb.w + TOL || b.y + b.h > pb.y + pb.h + TOL) && !field(r.node, "rot")) {
            out.push({ rule: "clipped", severity: "note", code: "clipped", id, key: r.key, approximate: true, message: `${label} sticks out of ${nameOf(model, parent.key.split("/").pop())}, which clips it.` });
          }
        }
        if (rules.has("touch-target") && r.key === r.id && Array.isArray(r.node.proto) && r.node.proto.some((i) => TAP_TRIGGERS.has(i?.on?.type)) && (b.w < MIN_TARGET - TOL || b.h < MIN_TARGET - TOL)) {
          out.push({ rule: "touch-target", severity: "warning", code: "touch-target", id, key: r.key, approximate: true, message: `${label} reacts to clicks but is ${round(b.w)} × ${round(b.h)} px (at least ${MIN_TARGET} × ${MIN_TARGET} px).` });
        }
        for (const c of r.children) visit(c, r);
      };
      visit(root, null);
    }
  }
  if (rules.has("unresolved")) {
    const seen = new Set();
    for (const w of resolver.warnings) {
      const k = `${w.code}|${w.message}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ rule: "unresolved", severity: "warning", code: w.code, ...(w.key ? { id: String(w.key).split("/")[0], key: w.key } : {}), message: w.message });
    }
  }
}

/**
 * Lints a model.
 * @param {object} model
 * @param {{ rules?: Iterable<string>, measurer?: object }} [opts]
 */
export function lintModel(model, { rules = Object.keys(LINT_RULES), measurer } = {}) {
  const on = new Set(rules);
  const out = [];
  const v = validate(model);
  if (on.has("schema")) {
    for (const p of v.errors) out.push({ rule: "schema", severity: "error", code: p.code, path: p.path, ...(idOfPath(p.path) ? { id: idOfPath(p.path) } : {}), message: p.message });
    for (const p of v.warnings) out.push({ rule: "schema", severity: "warning", code: p.code, path: p.path, ...(idOfPath(p.path) ? { id: idOfPath(p.path) } : {}), message: p.message });
  }
  // the other rules need a model the engine can read
  if (!v.ok) return out;
  for (const n of Object.values(model.nodes)) {
    if (!isObj(n)) continue;
    if (on.has("stale-override") && n.type === "instance") {
      const { inactive } = overridePaths(model, n.id);
      for (const p of inactive) out.push({ rule: "stale-override", severity: "warning", code: "stale-override", id: n.id, path: `nodes.${n.id}.over.${p}`, message: `${nameOf(model, n.id)} overrides “${p}”, which its main component no longer has.`, fix: { op: "instance.reset", id: n.id, paths: [p] } });
    }
    if (on.has("empty-frame") && n.type === "frame" && !(children(model, n.id) || []).length) {
      const vis = (list) => Array.isArray(list) && list.some((x) => isObj(x) && x.visible !== false);
      if (!vis(n.fills) && !vis(n.strokes) && !vis(n.effects)) out.push({ rule: "empty-frame", severity: "note", code: "empty-frame", id: n.id, message: `The frame ${nameOf(model, n.id)} is empty and draws nothing.` });
    }
  }
  if (["text-overflow", "clipped", "touch-target", "unresolved"].some((r) => on.has(r))) geometry(model, on, measurer, out);
  const rank = { error: 0, warning: 1, note: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.rule.localeCompare(b.rule) || String(a.id || "").localeCompare(String(b.id || "")));
}

/** Applies the machine-applicable fixes of findings, one operation each (a fix that fails is skipped). */
export function applyFixes(model, findings) {
  let m = model;
  const applied = [];
  const failed = [];
  for (const x of findings) {
    if (!x.fix) continue;
    try {
      m = apply(m, x.fix).model;
      applied.push(x);
    } catch (e) {
      failed.push({ finding: x, error: e.message });
    }
  }
  return { model: m, applied, failed };
}
