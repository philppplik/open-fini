// `ofini proto <command>`: Proto designs from the terminal (docs/cli.md ▸ Proto, docs/concepts/proto-studio.md §9,
// task T13). Every command reads a design from an `.ofini` file, its `document.json` or a bare model (`*.json`) and
// works through the engine's pure modules (app/src/engine/proto/): the outline, validation, design lint, an SVG render
// through the pure layout solver (approximate), SVG and media assets, design tokens, a structural diff and scripted
// operations. Commands that write never replace a file without --force (or --in-place for the design itself).
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename, dirname, extname, sep } from "node:path";
import { strFromU8 } from "../../app/vendor/fflate/fflate.js";
import { apply, applyAll, OpError } from "../../app/src/engine/proto/ops.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { summarize, children } from "../../app/src/engine/proto/tree.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";
import { layout } from "../../app/src/engine/proto/layout.js";
import { treeCss } from "../../app/src/engine/proto/css.js";
import { exportTokens, tokensCss, tokensTailwind, tokensSwift } from "../../app/src/engine/proto/tokens.js";
import { exportCode, FORMATS as CODE_FORMATS } from "../../app/src/engine/proto/codegen/index.js";
import { variableValue } from "../../app/src/engine/proto/variables.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { flowGraph, describe as describeInteraction, interactionProblems } from "../../app/src/engine/proto/interactions.js";
import { UsageError } from "./args.mjs";
import { table, bytes as fmtBytes, sev } from "./term.mjs";
import { expandAll } from "./glob.mjs";
import { CliError, EXIT } from "./project.mjs";
import { plural, withoutExt, readInput, writeOutput, replaceFile, needArgs, eachFile, safeFileName } from "./io.mjs";
import { readProto, assertWritable, protoBytes, pagesOf, findPage, topLayers, topOf, findNodes, parseModes, sizeText, fmtNum, withModes } from "./proto-model.mjs";
import { renderSvg } from "./proto-svg.mjs";
import { LINT_RULES, lintModel, applyFixes, resolveRules, RULE_ALIASES } from "./proto-lint.mjs";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg" };
const PNG_NEEDS_APP = "PNG needs the app's renderer: render SVG here (--format svg) or export PNG from the Proto Studio.";
const isDirOut = (p) => typeof p === "string" && (p.endsWith("/") || p.endsWith(sep));

function openDesign(ctx, path, flags = {}) {
  const input = readInput(ctx, path, { name: flags.name });
  return { input, state: readProto(input.bytes, input.name) };
}

/** Where a changed design goes: --in-place (atomic), --out <file>, or a default name; null for --dry-run. */
function saveDesign(ctx, flags, input, state, model, { defaultSuffix = null } = {}) {
  if (flags["dry-run"]) return null;
  if (flags["in-place"] && flags.out) throw new UsageError("Use either --in-place or --out, not both.");
  if (flags["in-place"]) {
    if (input.path === "-") throw new UsageError("--in-place cannot be used with standard input; use --out.");
    return replaceFile(ctx, input.path, protoBytes(state, model, input.path));
  }
  let target = flags.out;
  if (!target && defaultSuffix) target = input.path === "-" ? "-" : `${withoutExt(input.path)}${defaultSuffix}${extname(input.path) || ".ofini"}`;
  if (!target) throw new UsageError("Choose where the changed design goes: --out <file>, --in-place, or --dry-run to only check.");
  return writeOutput(ctx, target, protoBytes(state, model, target), { force: !!flags.force });
}

const loadNotes = (ctx, state) => {
  for (const n of state.load.notes || []) ctx.out.warn(`${state.name}: ${n}`);
};

// ------------------------------------------------------------------------------------------------ info

function designInfo(state) {
  const { model, load } = state;
  const s = summarize(model);
  const pages = pagesOf(model).map((p) => ({ ...p, frames: topLayers(model, p.id).filter((n) => n.type === "frame").map((n) => ({ id: n.id, name: n.name || "", size: sizeText(n) })) }));
  const nodes = Object.values(model.nodes || {}).filter(isObj);
  const components = nodes
    .filter((n) => n.type === "componentSet" || (n.type === "component" && model.nodes[n.parent]?.type !== "componentSet"))
    .map((n) => ({ id: n.id, name: n.name || "", type: n.type, variants: n.type === "componentSet" ? (children(model, n.id) || []).filter((c) => model.nodes[c]?.type === "component").length : 0, instances: nodes.filter((i) => i.type === "instance" && (i.of === n.id || model.nodes[i.of]?.parent === n.id)).length }));
  const colls = model.vars?.collections || {};
  const items = Object.values(model.vars?.items || {});
  const collections = Object.entries(colls).map(([id, c]) => ({ id, name: c.name || id, modes: (c.modes || []).map((m) => m.name || m.id), ...(c.extends ? { extends: c.extends } : {}), variables: items.filter((v) => v.coll === id).length }));
  const styles = {};
  for (const st of Object.values(model.styles || {})) styles[st.kind] = (styles[st.kind] || 0) + 1;
  const media = Object.entries(model.media || {}).map(([id, m]) => ({ id, name: m.name || "", mime: m.mime, bytes: m.bytes?.length ?? null }));
  const flows = [];
  for (const p of Object.values(model.pages || {})) for (const fl of p.flows || []) flows.push({ page: p.id, id: fl.id, name: fl.name || fl.id, start: fl.start });
  return { title: model.meta?.title || "", schema: model.schema, readOnly: !!load.readOnly, summary: s, pages, components, collections, styles, media, flows, errors: load.errors.length, warnings: load.warnings.length };
}

function infoText(c, file, i) {
  const rows = [];
  rows.push(["pages", i.pages.map((p) => `${p.name} (${p.id}${p.frames.length ? `, ${plural(p.frames.length, "frame")}` : ""})`).join(", ")]);
  const byType = Object.entries(i.summary.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(", ");
  rows.push(["layers", i.summary.nodes ? `${i.summary.nodes}: ${byType}` : "0"]);
  const frames = i.pages.flatMap((p) => p.frames);
  if (frames.length) rows.push(["frames", `${frames.slice(0, 8).map((f) => `${f.name || f.id} ${c.dim(f.size)}`).join(", ")}${frames.length > 8 ? ", …" : ""}`]);
  rows.push(["components", i.components.length ? i.components.map((x) => `${x.name || x.id}${x.variants ? c.dim(` (${plural(x.variants, "variant")})`) : ""}${x.instances ? c.dim(` ×${x.instances}`) : ""}`).join(", ") : "0"]);
  rows.push(["variables", i.collections.length ? `${i.summary.variables} in ${i.collections.map((x) => `${x.name} ${c.dim(`(${x.modes.join(", ")})`)}`).join(", ")}` : "0"]);
  rows.push(["styles", Object.keys(i.styles).length ? Object.entries(i.styles).map(([k, v]) => `${v} ${k}`).join(", ") : "0"]);
  const stored = i.media.filter((m) => m.bytes !== null);
  rows.push(["media", i.media.length ? `${i.media.length}${stored.length ? ` (${fmtBytes(stored.reduce((s, m) => s + m.bytes, 0))})` : ""}${stored.length < i.media.length ? c.yellow(` ${i.media.length - stored.length} without bytes`) : ""}` : "0"]);
  if (i.flows.length) rows.push(["flows", i.flows.map((f) => `${f.name} → ${f.start}`).join(", ")]);
  rows.push(["health", `${i.errors ? c.red(plural(i.errors, "error")) : c.green("no errors")}${i.warnings ? `, ${c.yellow(plural(i.warnings, "warning"))}` : ""}${i.readOnly ? c.yellow(" (read-only)") : ""}`]);
  return [`${c.bold(file)}${i.title ? `  ${c.dim("“")}${i.title}${c.dim("”")}` : ""}  ${c.dim(`Proto schema ${i.schema}`)}`, ...rows.map(([k, v]) => `  ${c.dim(k.padEnd(10))} ${v}`)].join("\n");
}

async function cmdInfo(flags, args, ctx) {
  needArgs(args, 1, "file");
  const files = expandAll(args, ctx.cwd);
  const { worst, results } = await eachFile(ctx, files, async (f) => {
    const { state } = openDesign(ctx, f, flags);
    const i = designInfo(state);
    if (!ctx.out.json) ctx.out.result(infoText(ctx.out.c, f, i) + (files.length > 1 ? "\n" : ""));
    return { code: 0, result: { file: f, ...i } };
  });
  if (ctx.out.json) ctx.out.data(files.length === 1 ? results[0] : results);
  return worst;
}

// ------------------------------------------------------------------------------------------------ tree

function describeNode(model, n) {
  const parts = [];
  const L = isObj(n.layout) ? n.layout : null;
  if (L && L.type === "flex") parts.push(`flex ${L.dir || "row"}${L.wrap ? " wrap" : ""}${L.gap !== undefined ? ` gap ${isObj(L.gap) ? "$" : ""}${isObj(L.gap) ? varName(model, L.gap.$var) : fmtNum(L.gap)}` : ""}`);
  else if (L && L.type === "grid") parts.push(`grid ${Array.isArray(L.grid?.cols) ? L.grid.cols.length : 1}×${Array.isArray(L.grid?.rows) ? L.grid.rows.length : 1}`);
  if (n.pos === "abs" && n.parent != null) parts.push("absolute");
  if (n.type === "text") {
    const t = (n.text?.runs || []).map((r) => r?.t ?? "").join("").replace(/\s+/g, " ").trim();
    parts.push(`“${t.length > 40 ? `${t.slice(0, 39)}…` : t}”`);
  }
  if (n.type === "instance") parts.push(`of ${n.of}${isObj(n.variant) && Object.keys(n.variant).length ? ` {${Object.entries(n.variant).map(([k, v]) => `${k}=${v}`).join(", ")}}` : ""}${isObj(n.over) && Object.keys(n.over).length ? ` ${plural(Object.keys(n.over).length, "override")}` : ""}`);
  const bound = JSON.stringify(n).match(/"\$var":"[^"]+"/g);
  if (bound) parts.push(`${plural(bound.length, "binding")}`);
  if (isObj(n.style) && Object.keys(n.style).length) parts.push(`style ${Object.values(n.style).join(",")}`);
  if (isObj(n.modes)) parts.push(`modes ${Object.entries(n.modes).map(([k, v]) => `${k}=${v}`).join(",")}`);
  if (Array.isArray(n.proto) && n.proto.length) parts.push(plural(n.proto.length, "interaction"));
  if (n.visible === false) parts.push("hidden");
  if (n.locked) parts.push("locked");
  return parts;
}
const varName = (model, id) => model.vars?.items?.[id]?.name || id;

async function cmdTree(flags, args, ctx) {
  needArgs(args, 1, "file");
  const { state } = openDesign(ctx, args[0], flags);
  const { model } = state;
  const depth = flags.depth !== undefined ? Number(flags.depth) : Infinity;
  if (!(depth >= 0)) throw new UsageError("--depth needs a number (0 for the top level only).");
  const modes = parseModes(model, flags.mode);
  let roots;
  if (flags.node) roots = findNodes(model, flags.node).map((id) => id.split("/")[0]);
  const pages = flags.node ? [...new Set(roots.map((id) => model.nodes[id].page))].map((id) => pagesOf(model).find((p) => p.id === id)) : flags.page ? [findPage(model, flags.page)] : pagesOf(model);
  // solver boxes per top-level layer (--boxes)
  const boxes = new Map();
  if (flags.boxes) {
    for (const p of pages) for (const top of topLayers(model, p.id)) {
      const r = createResolver(withModes(model, top.id, modes), modes ? { modes } : {}).tree(top.id);
      if (r) for (const [k, b] of layout(r).boxes) boxes.set(k, b);
    }
  }
  const lines = [];
  const data = [];
  const { c } = ctx.out;
  const node = (id, d) => {
    const n = model.nodes[id];
    const b = boxes.get(id);
    const desc = describeNode(model, n);
    if (b) desc.unshift(`@${fmtNum(b.x)},${fmtNum(b.y)} ${fmtNum(b.w)}×${fmtNum(b.h)}`);
    lines.push(`${"  ".repeat(d + 1)}${c.dim(id)} ${n.type} ${c.bold(`“${n.name || ""}”`)} ${sizeText(n)}${desc.length ? `  ${c.dim(desc.join(" · "))}` : ""}`);
    const kids = d < depth ? children(model, id) || [] : [];
    const more = d >= depth ? (children(model, id) || []).length : 0;
    if (more) lines.push(`${"  ".repeat(d + 2)}${c.dim(`… ${plural(more, "layer")}`)}`);
    const o = { id, type: n.type, name: n.name || "", size: sizeText(n), info: desc };
    if (b) o.box = { x: b.x, y: b.y, w: b.w, h: b.h, approximate: true };
    o.children = kids.map((k) => node(k, d + 1));
    if (more) o.more = more;
    return o;
  };
  for (const p of pages) {
    lines.push(`${c.bold(p.name)} ${c.dim(`(${p.id})`)}`);
    const ids = flags.node ? roots.filter((id) => model.nodes[id].page === p.id) : topLayers(model, p.id).map((n) => n.id);
    data.push({ page: p.id, name: p.name, layers: ids.map((id) => node(id, 0)) });
    if (!ids.length) lines.push(c.dim("  (empty)"));
  }
  if (ctx.out.json) ctx.out.data({ file: args[0], ...(flags.boxes ? { approximate: true } : {}), pages: data });
  else ctx.out.result(lines.join("\n"));
  return 0;
}

// ------------------------------------------------------------------------------------------------ inspect

async function cmdInspect(flags, args, ctx) {
  needArgs(args, 1, "file");
  if (!flags.node) throw new UsageError("Name the layers with --node <id[,id…]> (ofini proto tree lists them).");
  const { state } = openDesign(ctx, args[0], flags);
  const { model } = state;
  const keys = findNodes(model, flags.node);
  const modes = parseModes(model, flags.mode);
  const out = [];
  for (const key of keys) {
    const real = key.split("/")[0];
    const topId = topOf(model, real);
    const mm = withModes(model, topId, modes);
    const resolver = createResolver(mm, modes ? { modes } : {});
    const top = resolver.tree(topId);
    let r = null;
    const stack = top ? [top] : [];
    while (stack.length && !r) {
      const x = stack.pop();
      if (x.key === key) r = x;
      else stack.push(...x.children);
    }
    if (!r && key !== real) throw new UsageError(`No layer “${key}” inside the instance.`);
    const L = top ? layout(top) : null;
    const b = r && L ? L.boxes.get(r.key) : null;
    const item = { key, node: model.nodes[key.split("/").pop()] || null };
    item.box = b ? { x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot, approximate: true } : null;
    if ((flags.resolved || key !== real) && r) item.resolved = r.node;
    if (flags.css && r) {
      const css = treeCss(top, { resolver, model: mm }).get(r.key);
      item.css = Object.fromEntries(css.decls);
      if (css.text) item.text = css.text.runs.map((x) => ({ text: x.text, css: Object.fromEntries(x.decls) }));
    }
    out.push(item);
  }
  if (ctx.out.json) ctx.out.data(out.length === 1 ? out[0] : out);
  else {
    const { c } = ctx.out;
    for (const it of out) {
      ctx.out.result(`${c.bold(it.key)}${it.node?.name ? ` “${it.node.name}”` : ""}${it.box ? c.dim(`  @${fmtNum(it.box.x)},${fmtNum(it.box.y)} ${fmtNum(it.box.w)}×${fmtNum(it.box.h)} (approximate)`) : c.dim("  (hidden)")}`);
      ctx.out.result(JSON.stringify(it.resolved || it.node, null, 2));
      if (it.css) ctx.out.result(`${c.dim("css:")} ${Object.entries(it.css).map(([k, v]) => `${k}: ${v};`).join(" ")}`);
    }
  }
  return 0;
}

// ------------------------------------------------------------------------------------------------ validate

const problemText = (p) => `${p.message}${p.path ? ` (${p.path})` : ""}`;

async function cmdValidate(flags, args, ctx) {
  needArgs(args, 1, "file");
  const files = expandAll(args, ctx.cwd);
  const { c } = ctx.out;
  const { worst, results } = await eachFile(ctx, files, async (f) => {
    const { state } = openDesign(ctx, f, flags);
    const { errors, warnings, newer, notes } = state.load;
    const bad = errors.length > 0 || newer || (flags.strict && warnings.length > 0);
    if (!ctx.out.json) {
      ctx.out.result(`${bad ? c.red("FAIL") : c.green("ok  ")}  ${f}  ${c.dim(newer ? `made by a newer OpenFini (schema ${state.model.schema})` : `${plural(errors.length, "error")}, ${plural(warnings.length, "warning")}`)}`);
      const shown = [...errors, ...(bad || flags.verbose ? warnings : [])];
      if (shown.length && !ctx.out.quiet) ctx.out.print(shown.slice(0, 200).map((p) => `      ${sev(c, errors.includes(p) ? "error" : "warning")} ${c.dim(p.code)} ${problemText(p)}`).join("\n"));
    }
    return { code: bad ? EXIT.PROBLEMS : 0, result: { file: f, ok: !bad, schema: state.model.schema, newer, notes, errors, warnings } };
  });
  if (ctx.out.json) ctx.out.data(files.length === 1 ? results[0] : results);
  return worst;
}

// ------------------------------------------------------------------------------------------------ lint

function sarif(runs) {
  const rules = Object.entries(LINT_RULES).map(([id, r]) => ({ id, shortDescription: { text: r.summary }, defaultConfiguration: { level: r.severity === "note" ? "note" : r.severity } }));
  const results = [];
  for (const { file, findings } of runs)
    for (const x of findings)
      results.push({
        ruleId: x.rule,
        level: x.severity === "note" ? "note" : x.severity,
        message: { text: x.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: file.replace(/\\/g, "/") } }, ...(x.key || x.id ? { logicalLocations: [{ name: x.key || x.id, kind: "element", ...(x.path ? { fullyQualifiedName: x.path } : {}) }] } : {}) }],
        properties: { code: x.code, ...(x.approximate ? { approximate: true } : {}), ...(x.fix ? { fixable: true } : {}) },
      });
  return { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ tool: { driver: { name: "ofini proto lint", informationUri: "https://github.com/philppplik/open-fini/blob/main/docs/cli.md", rules } }, results }] };
}

async function cmdLint(flags, args, ctx) {
  needArgs(args, 1, "file");
  const format = String(flags.format || (ctx.out.json ? "json" : "text")).toLowerCase();
  if (!["text", "json", "sarif"].includes(format)) throw new UsageError(`Unknown format “${flags.format}”. Formats: text, json, sarif.`);
  let rules = Object.keys(LINT_RULES);
  if (flags.rules) {
    const res = resolveRules(String(flags.rules).split(",").map((s) => s.trim()).filter(Boolean));
    if (res.unknown.length) throw new UsageError(`Unknown rule “${res.unknown.join(", ")}”. Rules: ${Object.keys(LINT_RULES).join(", ")}.`);
    rules = res.rules;
  }
  if (!flags.fix && (flags["in-place"] || flags.out)) throw new UsageError("--in-place and --out need --fix.");
  const files = expandAll(args, ctx.cwd);
  if (flags.fix && flags.out && files.length > 1) throw new UsageError("--out works with one file; use --in-place or the default “.fixed” copies for several.");
  const { c } = ctx.out;
  const runs = [];
  const { worst } = await eachFile(ctx, files, async (f) => {
    const { input, state } = openDesign(ctx, f, flags);
    loadNotes(ctx, state);
    let findings = lintModel(state.model, { rules });
    let fixed = null;
    if (flags.fix && findings.some((x) => x.fix)) {
      assertWritable(state);
      const res = applyFixes(state.model, findings);
      if (res.applied.length) {
        const written = saveDesign(ctx, flags, input, state, res.model, { defaultSuffix: ".fixed" });
        const after = lintModel(res.model, { rules });
        fixed = { written, applied: res.applied.length, failed: res.failed.map((x) => ({ code: x.finding.code, id: x.finding.id, error: x.error })) };
        for (const x of findings) if (x.fix && res.applied.includes(x)) x.fixed = true;
        findings = [...findings.filter((x) => x.fixed), ...after];
      }
    }
    const open = findings.filter((x) => !x.fixed);
    const errors = open.filter((x) => x.severity === "error").length;
    const warnings = open.filter((x) => x.severity === "warning").length;
    const bad = errors > 0 || (flags.strict && warnings > 0);
    runs.push({ file: f, ok: !bad, counts: { error: errors, warning: warnings, note: open.length - errors - warnings, fixable: open.filter((x) => x.fix).length }, findings, ...(fixed ? { fixed } : {}) });
    if (format === "text") {
      ctx.out.result(`${c.bold(f)}  ${errors ? c.red(plural(errors, "error")) : c.green("no errors")}, ${plural(warnings, "warning")}, ${plural(open.length - errors - warnings, "note")}`);
      if (!ctx.out.quiet) {
        const rows = findings.map((x) => [x.fixed ? c.green("fixed") : sev(c, x.severity === "note" ? "info" : x.severity), c.dim(x.rule), `${x.message}${x.approximate ? c.dim(" ~") : ""}`]);
        if (rows.length) ctx.out.print(table([], rows, { max: 0 }).replace(/^/gm, "  "));
        if (fixed) ctx.out.result(`  ${c.green("wrote")} ${fixed.written}: ${plural(fixed.applied, "fix", "fixes")} applied`);
        else if (!flags.fix && runs[runs.length - 1].counts.fixable) ctx.out.print(c.dim(`  ${plural(runs[runs.length - 1].counts.fixable, "finding")} can be fixed: ofini proto lint --fix ${f}`));
      }
    }
    return { code: bad ? EXIT.PROBLEMS : 0, result: null };
  });
  if (format === "sarif") ctx.out.raw(`${JSON.stringify(sarif(runs), null, 2)}\n`);
  else if (format === "json") ctx.out.data(files.length === 1 ? runs[0] || null : runs);
  else if (runs.some((r) => r.findings.some((x) => x.approximate)) && !ctx.out.quiet) ctx.out.print(c.dim("~ geometry from the pure layout solver (approximate)"));
  return worst;
}

// ------------------------------------------------------------------------------------------------ render

function renderFormat(flags) {
  const fmt = String(flags.format || (flags.out && !isDirOut(flags.out) && flags.out !== "-" ? extname(flags.out).slice(1) : "svg") || "svg").toLowerCase();
  if (fmt === "png") throw new CliError(PNG_NEEDS_APP, EXIT.UNSUPPORTED);
  if (fmt !== "svg") throw new UsageError(`Unknown format “${fmt}”. Formats: svg (png needs the app).`);
  return fmt;
}

function renderOpts(flags, model) {
  const media = String(flags.media || "embed");
  if (!["embed", "link", "none"].includes(media)) throw new UsageError("--media takes embed, link or none.");
  const scale = flags.scale !== undefined ? Number(flags.scale) : 1;
  if (!(scale > 0 && scale <= 64)) throw new UsageError("--scale needs a number between 0 and 64.");
  return { modes: parseModes(model, flags.mode), media, scale, background: flags.background || null };
}

async function cmdRender(flags, args, ctx) {
  needArgs(args, 1, "file");
  renderFormat(flags);
  const { input, state } = openDesign(ctx, args[0], flags);
  const { model } = state;
  const opts = renderOpts(flags, model);
  const keys = flags.node ? findNodes(model, flags.node) : topLayers(model, findPage(model, flags.page).id).filter((n) => n.visible !== false).map((n) => n.id);
  if (!keys.length) throw new CliError("Nothing to render: the page has no visible layers.", EXIT.PROBLEMS);
  if (keys.length > 1 && flags.out && !isDirOut(flags.out) && !(existsSync(resolve(ctx.cwd, flags.out)) && statSync(resolve(ctx.cwd, flags.out)).isDirectory())) throw new UsageError(`${plural(keys.length, "layer")} to render: --out must be a folder (end it with /), or choose one layer with --node.`);
  const base = basename(withoutExt(input.path === "-" ? "design" : input.path));
  const used = new Set();
  const results = [];
  for (const key of keys) {
    let res;
    try {
      res = renderSvg(model, key, opts);
    } catch (e) {
      throw new CliError(e.message, EXIT.PROBLEMS);
    }
    for (const n of res.notes) ctx.out.warn(`${key}: ${n}`);
    let name = `${base}-${safeFileName(model.nodes[key.split("/")[0]]?.name || key, key.replace(/\//g, "-"))}`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base}-${safeFileName(model.nodes[key.split("/")[0]]?.name, "layer")}-${i}`;
    used.add(name.toLowerCase());
    let target;
    if (keys.length === 1 && flags.out && !isDirOut(flags.out) && !(existsSync(resolve(ctx.cwd, flags.out)) && statSync(resolve(ctx.cwd, flags.out)).isDirectory())) target = flags.out;
    else target = join(flags.out || (input.path === "-" ? "." : dirname(input.path)), `${name}.svg`);
    const r = { key, width: res.width, height: res.height, approximate: true, notes: res.notes };
    if (target === "-" && ctx.out.json) r.svg = res.svg;
    else r.written = writeOutput(ctx, target, res.svg, { force: !!flags.force });
    results.push(r);
  }
  if (ctx.out.json) ctx.out.data({ file: args[0], format: "svg", approximate: true, renders: results });
  else if (!results.some((r) => r.written === "-")) ctx.out.result(results.map((r) => `${ctx.out.c.green("wrote")} ${r.written} ${ctx.out.c.dim(`(${fmtNum(r.width)}×${fmtNum(r.height)}, approximate)`)}`).join("\n"));
  return 0;
}

// ------------------------------------------------------------------------------------------------ assets

async function cmdAssets(flags, args, ctx) {
  needArgs(args, 1, "file");
  const fmt = String(flags.format || "svg").toLowerCase();
  if (fmt === "png") throw new CliError(PNG_NEEDS_APP, EXIT.UNSUPPORTED);
  if (fmt !== "svg") throw new UsageError(`Unknown format “${fmt}”. Formats: svg (png needs the app).`);
  const { input, state } = openDesign(ctx, args[0], flags);
  const { model } = state;
  const opts = renderOpts({ ...flags, media: "embed" }, model);
  const dir = flags.out || `${withoutExt(input.path === "-" ? "design" : input.path)}-assets`;
  const absDir = resolve(ctx.cwd, dir);
  if (existsSync(absDir) && readdirSync(absDir).length && !flags.force) throw new CliError(`${dir} is not empty. Use --force to write into it.`, EXIT.IO);
  const keys = flags.node ? findNodes(model, flags.node) : Object.values(model.nodes).filter((n) => isObj(n) && n.type === "vector" && n.visible !== false).map((n) => n.id).sort();
  const used = new Set();
  const uniq = (p) => {
    let q = p;
    for (let i = 2; used.has(q.toLowerCase()); i++) q = `${withoutExt(p)}-${i}${extname(p)}`;
    used.add(q.toLowerCase());
    return q;
  };
  const written = [];
  const skipped = [];
  for (const key of keys) {
    let res;
    try {
      res = renderSvg(model, key, opts);
    } catch (e) {
      skipped.push({ key, reason: e.message });
      continue;
    }
    const p = uniq(`${safeFileName(model.nodes[key.split("/")[0]]?.name || key, key.replace(/\//g, "-"))}.svg`);
    writeOutput(ctx, join(dir, p), res.svg, { force: true });
    written.push({ file: p, key, kind: "svg" });
  }
  if (!flags.node && !flags["no-media"]) {
    for (const [id, m] of Object.entries(model.media || {})) {
      if (!(m?.bytes instanceof Uint8Array)) {
        skipped.push({ key: id, reason: "the media bytes are not stored in the file" });
        continue;
      }
      const ext = MIME_EXT[m.mime] || "bin";
      const nm = m.name ? (extname(m.name) ? safeFileName(m.name, id) : `${safeFileName(m.name, id)}.${ext}`) : `${id}.${ext}`;
      const p = uniq(`media/${nm}`);
      writeOutput(ctx, join(dir, p), m.bytes, { force: true });
      written.push({ file: p, key: id, kind: "media" });
    }
  }
  for (const s of skipped) ctx.out.warn(`${s.key}: ${s.reason}`);
  if (ctx.out.json) ctx.out.data({ file: args[0], dir, files: written, skipped });
  else ctx.out.result(written.length ? `${ctx.out.c.green("wrote")} ${plural(written.length, "file")} to ${dir}` : "The design has no vector layers or embedded media (choose layers with --node).");
  return 0;
}

// ------------------------------------------------------------------------------------------------ tokens

const TOKEN_FORMATS = ["dtcg", "css", "tailwind", "swift", "json"];

/** Plain values per variable name in the chosen (or default) modes: { "color/bg": "#ffffff" }. */
function flatTokens(model, modes) {
  const out = {};
  const items = model.vars?.items || {};
  for (const id of Object.keys(items).sort((a, b) => String(items[a].name).localeCompare(String(items[b].name)))) {
    const v = variableValue(model, id, modes || {});
    const it = items[id];
    out[it.name || id] = it.type === "number" && it.unit ? `${v}${it.unit}` : v;
  }
  return out;
}

async function cmdTokens(flags, args, ctx) {
  if (args[0] === "import") return tokensImport(flags, args.slice(1), ctx);
  needArgs(args, 1, "file");
  if (flags.collection || flags["in-place"] || flags["dry-run"]) throw new UsageError("--collection, --in-place and --dry-run belong to “ofini proto tokens import”.");
  const fmt = String(flags.format || "dtcg").toLowerCase();
  if (!TOKEN_FORMATS.includes(fmt)) throw new UsageError(`Unknown token format “${flags.format}”. Formats: ${TOKEN_FORMATS.join(", ")}.`);
  const { state } = openDesign(ctx, args[0], flags);
  const { model } = state;
  const modes = parseModes(model, flags.mode);
  if (modes && ["css", "tailwind", "swift"].includes(fmt)) ctx.out.warn(`--mode is ignored for ${fmt}: the output carries every mode.`);
  let text;
  if (fmt === "dtcg") text = `${JSON.stringify(exportTokens(model, { mode: modes }), null, 2)}\n`;
  else if (fmt === "json") text = `${JSON.stringify(flatTokens(model, modes), null, 2)}\n`;
  else if (fmt === "css") text = tokensCss(model);
  else if (fmt === "tailwind") text = tokensTailwind(model);
  else text = tokensSwift(model);
  if (!text.endsWith("\n")) text += "\n";
  if (flags.out && flags.out !== "-") {
    writeOutput(ctx, flags.out, text, { force: !!flags.force });
    if (ctx.out.json) ctx.out.data({ file: args[0], format: fmt, written: flags.out, bytes: Buffer.byteLength(text) });
    else ctx.out.result(`${ctx.out.c.green("wrote")} ${flags.out}`);
  } else if (ctx.out.json) ctx.out.data({ file: args[0], format: fmt, tokens: fmt === "dtcg" || fmt === "json" ? JSON.parse(text) : text });
  else ctx.out.raw(text);
  return 0;
}

async function tokensImport(flags, args, ctx) {
  needArgs(args, 2, "design and token file (ofini proto tokens import <file> <tokens.json>)");
  if (args[0] === "-" && args[1] === "-") throw new UsageError("Only one of the design and the token file can come from standard input.");
  const { input, state } = openDesign(ctx, args[0], flags);
  assertWritable(state);
  const tok = readInput(ctx, args[1], { name: "tokens.json" });
  let json;
  try {
    json = JSON.parse(strFromU8(tok.bytes));
  } catch (e) {
    throw new CliError(`${args[1]} is not valid JSON (${e.message}).`, EXIT.PROBLEMS);
  }
  if (flags.mode === true || flags.collection === true) throw new UsageError("--mode and --collection need a name.");
  let res;
  try {
    res = apply(state.model, { op: "tokens.import", tokens: json, ...(flags.collection ? { collection: String(flags.collection) } : {}), ...(flags.mode ? { mode: String(flags.mode) } : {}) });
  } catch (e) {
    if (e instanceof OpError) throw new CliError(`${args[1]}: ${e.message}`, EXIT.PROBLEMS);
    throw e;
  }
  const v = validate(res.model);
  if (!v.ok) throw new CliError(`The import would make the design invalid: ${v.errors.slice(0, 3).map(problemText).join("; ")}`, EXIT.PROBLEMS);
  const written = saveDesign(ctx, flags, input, state, res.model);
  const rep = res.report;
  for (const s of rep.skipped) ctx.out.warn(`skipped ${s.path}: ${s.reason}`);
  for (const w of rep.warnings) ctx.out.warn(w);
  if (ctx.out.json) ctx.out.data({ file: args[0], tokens: args[1], written, report: rep });
  else ctx.out.result(`${written ? `${ctx.out.c.green("wrote")} ${written}: ` : `${ctx.out.c.dim("dry run:")} `}${plural(rep.created, "variable")} created, ${rep.updated} updated, ${plural(rep.styles, "style")}${rep.skipped.length ? `, ${rep.skipped.length} skipped` : ""}${rep.converted.length ? ctx.out.c.dim(` (converted: ${rep.converted.slice(0, 3).join(", ")}${rep.converted.length > 3 ? ", …" : ""})`) : ""}`);
  return 0;
}

// ------------------------------------------------------------------------------------------------ export

async function cmdExport(flags, args, ctx) {
  needArgs(args, 1, "file");
  const format = String(flags.format || flags.target || "html").toLowerCase();
  if (!CODE_FORMATS.includes(format)) throw new UsageError(`Unknown export format “${flags.format || flags.target}”. Formats: ${CODE_FORMATS.join(", ")}.`);
  if (flags.node && flags.page) throw new UsageError("Use either --node or --page, not both.");
  const { input, state } = openDesign(ctx, args[0], flags);
  const { model } = state;
  const modes = parseModes(model, flags.mode);
  const ids = flags.node ? findNodes(model, flags.node).map((k) => k.split("/")[0]) : null;
  const page = flags.page ? findPage(model, flags.page).id : null;
  const res = await exportCode(model, { format, ids, page, modes: modes || undefined, ts: !flags.js, dataIds: !!flags["data-ids"], collapse: !flags["keep-wrappers"] });
  for (const w of res.warnings) ctx.out.warn(`${w.key}: ${w.message}`);
  if (!res.files.some((f) => typeof f.text === "string" && !/^(styles\.css|src\/(tokens|styles)\.css|src\/cx\.[jt]s|src\/index\.[jt]s|Tokens\.swift)$/.test(f.path)))
    ctx.out.warn("Nothing to export besides the variables: the selection has no visible layers or components.");
  const dir = flags.out || `${withoutExt(input.path === "-" ? "design" : input.path)}-${format}`;
  if (dir === "-") {
    // one stream: every text file with a header line
    ctx.out.raw(res.files.filter((f) => typeof f.text === "string").map((f) => `/* ===== ${f.path} ===== */\n${f.text}`).join("\n"));
    return 0;
  }
  const absDir = resolve(ctx.cwd, dir);
  if (existsSync(absDir) && readdirSync(absDir).length && !flags.force) throw new CliError(`${dir} is not empty. Use --force to write into it.`, EXIT.IO);
  for (const f of res.files) writeOutput(ctx, join(dir, f.path), typeof f.text === "string" ? f.text : f.bytes, { force: true });
  if (ctx.out.json) ctx.out.data({ file: args[0], format, dir, entry: res.entry, files: res.files.map((f) => ({ path: f.path, bytes: typeof f.text === "string" ? Buffer.byteLength(f.text) : f.bytes.length })), warnings: res.warnings });
  else ctx.out.result(`${ctx.out.c.green("wrote")} ${plural(res.files.length, "file")} to ${dir} ${ctx.out.c.dim(`(${format}; start with ${res.entry})`)}`);
  return 0;
}

// ------------------------------------------------------------------------------------------------ diff

/** Top-level field names whose JSON differs. */
function changedFields(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])).sort();
}

export function diffModels(A, B) {
  const changes = [];
  const add = (kind, what, id, detail = "") => changes.push({ kind, what, id, detail });
  const label = (n) => `${n?.type || ""} “${n?.name || ""}”`.trim();
  for (const k of changedFields(A.meta, B.meta)) add("~", "meta", k, `${JSON.stringify(A.meta?.[k]) ?? "–"} → ${JSON.stringify(B.meta?.[k]) ?? "–"}`);
  const section = (what, a = {}, b = {}, name, opts = {}) => {
    for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!(id in a)) add("+", what, id, name(b[id]));
      else if (!(id in b)) add("-", what, id, name(a[id]));
      else {
        const fields = changedFields(opts.strip ? opts.strip(a[id]) : a[id], opts.strip ? opts.strip(b[id]) : b[id]);
        if (fields.length) add("~", what, id, `${name(b[id])}: ${fields.join(", ")}`);
      }
    }
  };
  section("page", A.pages, B.pages, (p) => `“${p?.name || ""}”`);
  section("layer", A.nodes, B.nodes, label);
  section("collection", A.vars?.collections, B.vars?.collections, (c) => `“${c?.name || ""}”`);
  section("variable", A.vars?.items, B.vars?.items, (v) => `“${v?.name || ""}”`);
  section("style", A.styles, B.styles, (s) => `${s?.kind || ""} “${s?.name || ""}”`);
  const mediaHash = (m) => (m ? { ...m, bytes: m.bytes ? Buffer.from(m.bytes).toString("base64").length + ":" + Buffer.from(m.bytes).subarray(0, 64).toString("hex") : null } : m);
  section("media", A.media, B.media, (m) => `“${m?.name || ""}”`, { strip: mediaHash });
  for (const k of ["breakpoints", "code"]) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) add("~", k, "", "changed");
  return changes;
}

async function cmdDiff(flags, args, ctx) {
  needArgs(args, 2, "two designs");
  const a = openDesign(ctx, args[0], flags).state;
  const b = openDesign(ctx, args[1], flags).state;
  const changes = diffModels(a.model, b.model);
  const counts = { added: changes.filter((x) => x.kind === "+").length, removed: changes.filter((x) => x.kind === "-").length, changed: changes.filter((x) => x.kind === "~").length };
  if (ctx.out.json) ctx.out.data({ a: args[0], b: args[1], same: !changes.length, counts, changes });
  else if (!changes.length) ctx.out.result(ctx.out.c.green("The designs are the same."));
  else {
    const { c } = ctx.out;
    const col = { "+": c.green, "-": c.red, "~": c.yellow };
    ctx.out.result(table([], changes.map((x) => [col[x.kind](x.kind), x.what, c.dim(x.id), x.detail]), { max: 0 }));
    ctx.out.print(c.dim(`${counts.added} added, ${counts.removed} removed, ${counts.changed} changed`));
  }
  return changes.length ? EXIT.PROBLEMS : 0;
}

// ------------------------------------------------------------------------------------------------ apply

async function cmdApply(flags, args, ctx) {
  needArgs(args, 1, "file");
  if (!flags.ops && args.length < 2) throw new UsageError("Give the operations as a JSON file, - for standard input, or --ops '<json>'.");
  if (flags.ops && args.length > 1) throw new UsageError("Use either an operations file or --ops, not both.");
  if (args[0] === "-" && args[1] === "-") throw new UsageError("Only one of the design and the operations can come from standard input.");
  const { input, state } = openDesign(ctx, args[0], flags);
  assertWritable(state);
  let text;
  if (flags.ops) text = String(flags.ops);
  else text = strFromU8(readInput(ctx, args[1], { name: "ops.json" }).bytes);
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new CliError(`The operations are not valid JSON (${e.message}).`, EXIT.PROBLEMS);
  }
  const ops = Array.isArray(json) ? json : isObj(json) && Array.isArray(json.ops) ? json.ops : isObj(json) ? [json] : null;
  if (!ops || !ops.length) throw new CliError("Expected an operation object, an array of operations or { \"ops\": [...] }.", EXIT.PROBLEMS);
  const seed = flags.seed !== undefined ? Number(flags.seed) : null;
  if (seed !== null && !Number.isInteger(seed)) throw new UsageError("--seed needs an integer.");
  let res;
  try {
    res = ops.length === 1 ? apply(state.model, ops[0], seed !== null ? { random: seededRandom(seed) } : {}) : applyAll(state.model, ops, seed !== null ? { random: seededRandom(seed) } : {});
  } catch (e) {
    if (e instanceof OpError) throw new CliError(`Operation failed (${e.code || "error"}): ${e.message}`, EXIT.PROBLEMS);
    throw e;
  }
  const v = validate(res.model);
  if (!v.ok) throw new CliError(`The result is not a valid design: ${v.errors.slice(0, 3).map(problemText).join("; ")}`, EXIT.PROBLEMS);
  const changed = res.model !== state.model;
  const written = changed ? saveDesign(ctx, flags, input, state, res.model) : null;
  const out = { file: args[0], ops: ops.length, changed, ids: res.ids || [], ...(res.map ? { map: res.map } : {}), ...(res.report ? { report: res.report } : {}), written, warnings: v.warnings.length };
  if (ctx.out.json) ctx.out.data(out);
  else if (written !== "-") {
    const { c } = ctx.out;
    ctx.out.result(!changed ? c.dim("No change (the operations left the design as it was).") : `${written ? `${c.green("wrote")} ${written}` : c.dim("dry run: valid")}: ${plural(ops.length, "operation")}, ${plural(out.ids.length, "layer")} touched${out.ids.length ? c.dim(` (${out.ids.slice(0, 8).join(", ")}${out.ids.length > 8 ? ", …" : ""})`) : ""}`);
  }
  return 0;
}

// ------------------------------------------------------------------------------------------------ flows

/** Prototype flows of a design: start frames, the screens each flow reaches, and their interactions. */
function designFlows(model, pageSpec) {
  const pages = pageSpec !== undefined ? [findPage(model, pageSpec)] : pagesOf(model);
  const name = (id) => model.nodes[id]?.name || model.vars?.items?.[id]?.name || id;
  const out = [];
  const problems = [];
  for (const p of pages) {
    for (const f of model.pages[p.id]?.flows || []) {
      if (!isObj(f)) continue;
      const g = flowGraph(model, f);
      if (!model.nodes[f.start]) problems.push({ flow: f.id, message: `The flow “${f.name || f.id}” starts at “${f.start}”, which does not exist.` });
      for (const id of g.missing) problems.push({ flow: f.id, message: `The flow “${f.name || f.id}” leads to “${id}”, which does not exist.` });
      const screens = g.screens.map((id) => {
        const layers = [];
        const visit = (nid, depth) => {
          const n = model.nodes[nid];
          if (!n || depth > 64) return;
          if (Array.isArray(n.proto) && n.proto.length) layers.push({ id: n.id, name: n.name || "", interactions: n.proto.map((it) => ({ text: describeInteraction(it, name), ...(interactionProblems(model, it).length ? { problems: interactionProblems(model, it) } : {}) })) });
          for (const c of children(model, nid) || []) visit(c, depth + 1);
        };
        visit(id, 0);
        return { id, name: name(id), layers };
      });
      out.push({ page: p.id, pageName: p.name, id: f.id, name: f.name || f.id, start: f.start, ...(f.description ? { description: f.description } : {}), screens, edges: g.edges.map((e) => ({ ...e, fromName: name(e.from), toName: name(e.to) })) });
    }
  }
  return { flows: out, problems };
}

async function cmdFlows(flags, args, ctx) {
  needArgs(args, 1, "file");
  const files = expandAll(args, ctx.cwd);
  const { worst, results } = await eachFile(ctx, files, async (f) => {
    const { state } = openDesign(ctx, f, flags);
    const r = designFlows(state.model, flags.page);
    if (!ctx.out.json) {
      const { c } = ctx.out;
      const lines = [c.bold(f)];
      if (!r.flows.length) lines.push(c.dim("  No flows. Add one in the Pages panel (Prototype mode) or with flow.create."));
      for (const fl of r.flows) {
        lines.push(`  ${c.bold(fl.name)} ${c.dim(`(${fl.id}, page ${fl.pageName})`)}  starts at ${fl.screens[0]?.name || fl.start}, ${plural(fl.screens.length, "screen")}`);
        for (const sc of fl.screens) {
          lines.push(`    ${sc.name} ${c.dim(sc.id)}`);
          for (const l of sc.layers) for (const it of l.interactions) lines.push(`      ${c.dim(`${l.name || l.id}:`)} ${it.text}${it.problems ? c.yellow(` (${it.problems[0]})`) : ""}`);
        }
      }
      for (const pr of r.problems) lines.push(c.yellow(`  ${pr.message}`));
      ctx.out.result(lines.join("\n") + (files.length > 1 ? "\n" : ""));
    }
    return { code: r.problems.length ? EXIT.PROBLEMS : 0, result: { file: f, ...r } };
  });
  if (ctx.out.json) ctx.out.data(files.length === 1 ? results[0] : results);
  return worst;
}

// ------------------------------------------------------------------------------------------------ command table

const IO = { name: { type: "string", desc: "File name to assume for standard input (-)" } };
const FORCE = { force: { type: "bool", short: "f", desc: "Overwrite existing files" } };
const MODE = { mode: { type: "string", desc: "Variable modes, e.g. Theme=dark,Density=compact" } };
const WRITE = { out: { type: "string", short: "o", desc: "Write the changed design here (.ofini, or .json for the bare model)" }, "in-place": { type: "bool", desc: "Replace the design file (atomically)" }, "dry-run": { type: "bool", short: "n", desc: "Check only; write nothing" }, ...FORCE };

export const PROTO_SUMMARY = "Proto designs: outline, lint, render, assets, tokens, code export, diff, scripted edits (Labs)";

export const PROTO_COMMANDS = {
  info: { summary: "Pages, frames, layers, components, variables, styles, media and flows", usage: "ofini proto info <file...>", flags: { ...IO }, run: cmdInfo, examples: ["ofini proto info app.ofini", "ofini proto info 'designs/*.ofini' --json"] },
  tree: { summary: "The layer outline (ids, types, names, sizes, layout, bindings)", usage: "ofini proto tree <file> [--page <p>] [--node <ids>] [--depth <n>] [--boxes]", flags: { ...IO, ...MODE, page: { type: "string", short: "p", desc: "Page id, name or number (default: every page)" }, node: { type: "string", desc: "Only these layers and what they contain (ids or names, comma-separated)" }, depth: { type: "string", short: "d", desc: "Levels below the starting layers (0: only them)" }, boxes: { type: "bool", short: "b", desc: "Add positions and sizes from the pure layout solver (approximate)" } }, run: cmdTree, examples: ["ofini proto tree app.ofini", "ofini proto tree app.ofini --page Screens --depth 1", "ofini proto tree app.ofini --node n1 --boxes --json"] },
  inspect: { summary: "Full JSON of layers, resolved values, CSS and solver boxes", usage: "ofini proto inspect <file> --node <ids> [--resolved] [--css]", flags: { ...IO, ...MODE, node: { type: "string", desc: "Layer ids, names or instance-inner keys such as n5/n22 (comma-separated)" }, resolved: { type: "bool", short: "r", desc: "Show the resolved layer (instances expanded, variables replaced, styles applied)" }, css: { type: "bool", desc: "Add the CSS declarations the canvas and code export use" } }, run: cmdInspect, examples: ["ofini proto inspect app.ofini --node n5 --resolved", "ofini proto inspect app.ofini --node n5/n22 --css --json"] },
  validate: { summary: "Check designs against the schema; exit code 1 on errors", usage: "ofini proto validate <file...> [--strict]", flags: { ...IO, strict: { type: "bool", desc: "Treat warnings as errors" }, verbose: { type: "bool", short: "v", desc: "Also list warnings of valid designs" } }, run: cmdValidate, examples: ["ofini proto validate 'designs/*.ofini'", "ofini proto validate --strict --json app.ofini"] },
  lint: {
    summary: "Design lint (the assistant's design rules plus schema checks); exit code 1 on errors",
    usage: "ofini proto lint <file...> [--rules <ids>] [--format text|json|sarif] [--fix [--in-place | --out <file>]]",
    flags: { ...IO, ...FORCE, rules: { type: "string", desc: `Rules to run (default all): ${Object.keys(LINT_RULES).join(", ")}` }, format: { type: "string", short: "t", desc: "text (default), json or sarif (for CI annotations)" }, strict: { type: "bool", desc: "Exit code 1 also for warnings" }, fix: { type: "bool", desc: "Apply machine-applicable fixes (default: writes <name>.fixed.ofini)" }, "in-place": { type: "bool", desc: "With --fix: replace the design file" }, out: { type: "string", short: "o", desc: "With --fix: write the fixed design here" } },
    details: [...Object.entries(LINT_RULES).map(([k, v]) => `${k.padEnd(17)} ${v.severity.padEnd(8)} ${v.summary}${v.fixable ? " (fixable)" : ""}`), ...Object.entries(RULE_ALIASES).map(([k, v]) => `${k.padEnd(17)} alias of ${v}`)],
    run: cmdLint,
    examples: ["ofini proto lint app.ofini", "ofini proto lint 'designs/*.ofini' --format sarif > proto.sarif", "ofini proto lint app.ofini --rules schema,inactive-override --fix --in-place"],
  },
  render: {
    summary: "Render layers to SVG through the pure layout solver (approximate)",
    usage: "ofini proto render <file> [--node <ids> | --page <p>] [--out <file|folder/>] [--mode <modes>]",
    flags: { ...IO, ...FORCE, ...MODE, node: { type: "string", desc: "Layers to render (ids, names or n5/n22 keys); default: the top-level layers of the page" }, page: { type: "string", short: "p", desc: "Page id, name or number (default: the first page)" }, out: { type: "string", short: "o", desc: "Output file, folder (ending in /) or - for standard output" }, format: { type: "string", short: "t", desc: "svg (png needs the app: exit code 4)" }, scale: { type: "string", desc: "Size factor of the SVG (default 1)" }, background: { type: "string", desc: "Background color behind the layer, e.g. #ffffff" }, media: { type: "string", desc: "Images: embed (default), link (media/<id>.<ext>) or none" } },
    run: cmdRender,
    examples: ["ofini proto render app.ofini", "ofini proto render app.ofini --node n1 -o checkout.svg", "ofini proto render app.ofini --page 2 -o shots/ --mode Theme=dark", "ofini proto render app.ofini --node Checkout -o - > checkout.svg"],
  },
  assets: { summary: "Export vector layers (or chosen layers) as SVG and embedded media as files", usage: "ofini proto assets <file> [--node <ids>] [--out <folder>]", flags: { ...IO, ...FORCE, ...MODE, node: { type: "string", desc: "Layers to export as SVG instead of every vector layer (media are then left out)" }, out: { type: "string", short: "o", desc: "Output folder (default: <name>-assets)" }, format: { type: "string", short: "t", desc: "svg (png needs the app: exit code 4)" }, "no-media": { type: "bool", desc: "Leave embedded images out" } }, run: cmdAssets, examples: ["ofini proto assets app.ofini", "ofini proto assets app.ofini --node Logo,Icons -o icons"] },
  tokens: {
    summary: "Export design tokens (DTCG, CSS, Tailwind, Swift, JSON) or import DTCG tokens",
    usage: "ofini proto tokens <file> [--format dtcg|css|tailwind|swift|json] [--mode <modes>] [--out <file>]\n        ofini proto tokens import <file> <tokens.json|-> [--collection <name>] [--mode <name>] (--out <file> | --in-place | --dry-run)",
    flags: { ...IO, ...WRITE, format: { type: "string", short: "t", desc: "Export format: dtcg (default), css, tailwind, swift or json (plain values)" }, mode: { type: "string", desc: "Export: Collection=Mode pairs (dtcg and json); import: the mode the values go to" }, collection: { type: "string", desc: "Import: the collection the tokens go to (default: from the file, else Tokens)" } },
    run: cmdTokens,
    examples: ["ofini proto tokens app.ofini > tokens.json", "ofini proto tokens app.ofini -t css -o tokens.css", "ofini proto tokens app.ofini -t json --mode Theme=dark", "ofini proto tokens import app.ofini brand.tokens.json --in-place", "ofini proto tokens import app.ofini dark.tokens.json --mode Dark -o themed.ofini"],
  },
  export: {
    summary: "Export layers as code: HTML + CSS, React (CSS Modules or Tailwind), HTML + Tailwind or SwiftUI",
    usage: "ofini proto export <file> [--format html|react|react-tailwind|tailwind|swiftui] [--node <ids> | --page <p>] [--out <folder>|-]",
    flags: { ...IO, ...FORCE, ...MODE, format: { type: "string", short: "t", desc: `${CODE_FORMATS.join(", ")} (default html)` }, target: { type: "string", desc: "Same as --format" }, node: { type: "string", desc: "Layers or components to export (ids or names, comma-separated); default: every top-level layer" }, page: { type: "string", short: "p", desc: "Only this page (id, name or number)" }, out: { type: "string", short: "o", desc: "Output folder (default: <name>-<format>), or - to print the text files" }, js: { type: "bool", desc: "React: JavaScript (.jsx) instead of TypeScript" }, "data-ids": { type: "bool", desc: "Mark elements with data-proto-id (layer ids)" }, "keep-wrappers": { type: "bool", desc: "Keep frames that only wrap one layer" } },
    run: cmdExport,
    examples: ["ofini proto export app.ofini", "ofini proto export app.ofini -t react -o web/", "ofini proto export app.ofini -t react-tailwind --node Button,Card", "ofini proto export app.ofini -t swiftui --page Screens -o ios/", "ofini proto export app.ofini --node Checkout -o - | less"],
  },
  flows: { summary: "Prototype flows: start frames, the screens each flow reaches and their interactions; exit code 1 when a target is missing", usage: "ofini proto flows <file...> [--page <p>]", flags: { ...IO, page: { type: "string", short: "p", desc: "Page id, name or number (default: every page)" } }, run: cmdFlows, examples: ["ofini proto flows app.ofini", "ofini proto flows app.ofini --page Screens --json"] },
  diff: { summary: "Structural diff of two designs; exit code 1 when they differ", usage: "ofini proto diff <a> <b>", flags: { ...IO }, run: cmdDiff, examples: ["ofini proto diff v1.ofini v2.ofini", "ofini proto diff main.ofini feature.ofini --json"] },
  apply: {
    summary: "Apply operations from JSON (one undoable step in the app's terms) for scripting",
    usage: "ofini proto apply <file> <ops.json|-> (--out <file> | --in-place | --dry-run) [--seed <n>]",
    flags: { ...IO, ...WRITE, ops: { type: "string", desc: "The operations as a JSON string instead of a file" }, seed: { type: "string", desc: "Seed for new ids (reproducible scripts)" } },
    details: ["Operations are the engine's (node.create, node.update, node.move, node.delete, component.create, instance.create, var.create, …;", "docs/concepts/proto-studio.md ▸ T1 and T5). One object, an array, or { \"ops\": [...] }; several run as one batch, all or nothing."],
    run: cmdApply,
    examples: ["ofini proto apply app.ofini ops.json --in-place", "ofini proto apply app.ofini --ops '{\"op\":\"node.update\",\"id\":\"n2\",\"set\":{\"name\":\"Title\"}}' -o out.ofini", "generate-ops | ofini proto apply app.ofini - --dry-run --json"],
  },
};

export { describeNode, flatTokens, designFlows };
