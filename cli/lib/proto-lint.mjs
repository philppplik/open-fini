// Design lint for `ofini proto lint` (docs/cli.md ▸ Proto). Pure: a model in, findings out.
//
// Rules (ids for --rules). The design rules are engine/proto/lint.js, the same code the assistant's proto_lint and
// proto_fix tools run, so the CLI, the assistant and (later) the MCP server report the same findings:
//   contrast, touch-target, unbound-color, unbound-spacing, off-grid, detached-style, inactive-override,
//   detached-instance, empty-frame, naming, overflow-text, unused-token          (engine/proto/lint.js ▸ RULES)
// and three checks of the file itself that only the CLI runs:
//   schema          validation errors and warnings of engine/proto/validate.js (broken references, limits, …)
//   unresolved      variables, components or modes the resolver could not find (resolve.js warnings)
//   clipped         a layer that sticks out of a parent that clips its content (approximate)
// The rule names of 1.3.0 still work as aliases: stale-override = inactive-override, text-overflow = overflow-text.
// Engine severities map to SARIF levels (info → note). A finding is fixable when the engine marks its fix safe (the
// fix is the engine's operations, one batch); unsafe fixes (deleting unused tokens, replacing detached copies) are
// listed as `suggestion` and never applied by --fix. The geometry rules use the pure layout solver
// (engine/proto/layout.js, base-14 font metrics) and are approximate.
//
// Public API
//   LINT_RULES                         { id: { severity, summary, fixable? } }
//   RULE_ALIASES                       { oldId: id }
//   resolveRules(list) → { rules, unknown }   rule ids with aliases resolved
//   lintModel(model, { rules?, measurer? }) → Finding[]
//       Finding { rule, severity: "error"|"warning"|"note", code, message, id?, key?, path?, approximate?, fix?: op,
//                 suggestion? }
//   applyFixes(model, findings) → { model, applied: Finding[], failed: [{ finding, error }] }
import { validate } from "../../app/src/engine/proto/validate.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";
import { layout } from "../../app/src/engine/proto/layout.js";
import { field } from "../../app/src/engine/proto/schema.js";
import { apply } from "../../app/src/engine/proto/ops.js";
import { pageList, topLevel } from "../../app/src/engine/proto/tree.js";
import { lint as designLint, RULES as DESIGN_RULES } from "../../app/src/engine/proto/lint.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const round = (n) => Math.round(n * 10) / 10;
const TOL = 0.5;
const DESIGN_SUMMARIES = {
  contrast: ["error", "Text contrast below WCAG 2 AA against its background (approximate)", true],
  "touch-target": ["warning", "Interactive layers smaller than 24 px (warning) or 44 px (note) (approximate)", true],
  "unbound-color": ["warning", "Literal colors while color variables exist; fix binds a variable of the same value", true],
  "unbound-spacing": ["warning", "Literal gaps and padding while number variables exist; fix binds a matching variable", true],
  "off-grid": ["note", "Gaps and padding off the 4 px grid", true],
  "detached-style": ["warning", "Local values that equal a style without using it", true],
  "inactive-override": ["warning", "Instance overrides of layers the main component no longer has", true],
  "detached-instance": ["note", "Frames named like a component that are not instances of it", false],
  "empty-frame": ["warning", "Frames without layers, fills, strokes or effects", true],
  naming: ["note", "Layers with default names such as “Frame 3”", true],
  "overflow-text": ["warning", "Text that does not fit its box or runs past a clipping container (approximate)", true],
  "unused-token": ["note", "Variables and styles nobody uses", false],
};
const APPROXIMATE = new Set(["contrast", "touch-target", "overflow-text"]);

export const LINT_RULES = Object.freeze({
  schema: { severity: "error", summary: "Validation errors and warnings (references, limits, types)" },
  unresolved: { severity: "warning", summary: "Variables, components or modes that cannot be resolved" },
  clipped: { severity: "note", summary: "Layers partly hidden by a parent that clips its content (approximate)" },
  ...Object.fromEntries(DESIGN_RULES.map((id) => [id, { severity: DESIGN_SUMMARIES[id]?.[0] || "warning", summary: DESIGN_SUMMARIES[id]?.[1] || id, ...(DESIGN_SUMMARIES[id]?.[2] ? { fixable: true } : {}) }])),
});

/** Rule names of 1.3.0 that the design linter renamed. */
export const RULE_ALIASES = Object.freeze({ "stale-override": "inactive-override", "text-overflow": "overflow-text" });

/** Rule ids with aliases resolved; `unknown` lists the names that are neither. */
export function resolveRules(list) {
  const rules = [];
  const unknown = [];
  for (const r of list) {
    const id = RULE_ALIASES[r] || r;
    if (LINT_RULES[id]) rules.includes(id) || rules.push(id);
    else unknown.push(r);
  }
  return { rules, unknown };
}

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
        if (rules.has("clipped") && parent && field(parent.node, "clip") === true && field(parent.node, "scroll") === "none") {
          const pb = L.boxes.get(parent.key);
          if (pb && (b.x < pb.x - TOL || b.y < pb.y - TOL || b.x + b.w > pb.x + pb.w + TOL || b.y + b.h > pb.y + pb.h + TOL) && !field(r.node, "rot")) {
            out.push({ rule: "clipped", severity: "note", code: "clipped", id, key: r.key, approximate: true, message: `${label} sticks out of ${nameOf(model, parent.key.split("/").pop())}, which clips it.` });
          }
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
  const on = new Set(resolveRules(rules).rules);
  const out = [];
  const v = validate(model);
  if (on.has("schema")) {
    for (const p of v.errors) out.push({ rule: "schema", severity: "error", code: p.code, path: p.path, ...(idOfPath(p.path) ? { id: idOfPath(p.path) } : {}), message: p.message });
    for (const p of v.warnings) out.push({ rule: "schema", severity: "warning", code: p.code, path: p.path, ...(idOfPath(p.path) ? { id: idOfPath(p.path) } : {}), message: p.message });
  }
  // the other rules need a model the engine can read
  if (!v.ok) return out;
  const design = DESIGN_RULES.filter((r) => on.has(r));
  if (design.length) {
    const { issues } = designLint(model, { rules: design, measurer });
    for (const i of issues) {
      const key = String(i.node);
      const id = key.split("/")[0];
      const f = { rule: i.rule, severity: i.severity === "info" ? "note" : i.severity, code: i.rule, id, ...(key !== id ? { key } : {}), message: `${nameOf(model, id)}: ${i.message}` };
      if (APPROXIMATE.has(i.rule)) f.approximate = true;
      if (i.rule === "inactive-override") f.path = `nodes.${id}.over`;
      if (i.fix?.safe && i.fix.ops?.length) f.fix = i.fix.ops.length === 1 ? i.fix.ops[0] : { op: "batch", ops: i.fix.ops };
      else if (i.fix) f.suggestion = i.fix.label;
      out.push(f);
    }
  }
  if (["clipped", "unresolved"].some((r) => on.has(r))) geometry(model, on, measurer, out);
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
