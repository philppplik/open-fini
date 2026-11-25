// Design lint of the Proto model (docs/concepts/proto-studio.md §7, task T11). Pure: no DOM, imports in plain Node.
//
// Reads the resolved tree (resolve.js) and the pure layout solver (layout.js, approximate boxes), never the canvas, so
// the same report comes from the assistant, the MCP server (T12) and the CLI (T13). Every issue that can be repaired
// mechanically carries a fix: a list of operations (ops.js) that `fixOps` combines into one batch (one undo step).
//
// Public API
//   lint(model, { page?, ids?, rules?, measurer?, modes? }) → { issues, counts, approximate: true }
//       page    lint one page (default: every page); ids: only these layers and their subtrees
//       rules   only these rule ids (RULES)
//   fixOps(issues, { ids?, rules?, unsafe? }) → [op]      the fixes to apply (safe fixes only unless `unsafe`)
//   suggestName(model, id) → string | null                 a semantic layer name (also used by proto_rename)
//   suggestTag(model, id) → string | null                  an HTML tag for code export ("button", "nav", "h1" …)
//   contrastRatio(fg, bg) → number                          WCAG 2 contrast of two hex colors (fg may have alpha)
//
// Issue: { id, rule, severity: "error"|"warning"|"info", node, message, fix?: { label, ops, safe } }
//   `id` is stable across calls for the same problem ("<rule>:<layer key>[:<path>]"), so a client can lint, show the
//   report and fix a chosen subset. `node` is the layer key (a layer inside an instance is "<instance>/<source>").
// Rules (RULES): contrast, touch-target, unbound-color, unbound-spacing, off-grid, detached-style, inactive-override,
//   detached-instance, empty-frame, naming, overflow-text, unused-token.
import { createResolver, walkResolved } from "./resolve.js";
import { layout } from "./layout.js";
import { textStyleOf } from "./css.js";
import { field } from "./schema.js";
import { pageList, indexOf, ancestors } from "./tree.js";
import { overridePaths } from "./components.js";
import { bindingsIn, canBind, isBinding, variableValue } from "./variables.js";

export const RULES = Object.freeze(["contrast", "touch-target", "unbound-color", "unbound-spacing", "off-grid", "detached-style", "inactive-override", "detached-instance", "empty-frame", "naming", "overflow-text", "unused-token"]);

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
const DEFAULT_NAME = /^(Frame|Rectangle|Ellipse|Line|Vector|Text|Image|Instance|Component|Component Set|Slot|Group)( \d+)?$/;
const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea", "summary"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "checkbox", "switch", "tab", "menuitem", "radio", "option"]);
const INTERACTIVE_NAME = /\b(button|btn|link|toggle|checkbox|switch|tab|cta)\b/i;
const TARGET_MIN = 24; // WCAG 2.2 (2.5.8, level AA)
const TARGET_GOOD = 44; // platform guidelines
const GRID = 4;
const stable = (v) => JSON.stringify(v, (k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

// ------------------------------------------------------------------------------------------------- color

function rgba(hex) {
  const m = HEX.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = (c) => {
  const ch = c.slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const toHex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** WCAG 2 contrast ratio of a foreground over a background (hex colors; the foreground may have alpha). */
export function contrastRatio(fg, bg) {
  const b = rgba(bg);
  const f0 = rgba(fg);
  if (!b || !f0) return NaN;
  const f = over(f0, b);
  const [l1, l2] = [lum(f), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** The opaque color a layer paints over `bg` with its solid fills, or null when it has a gradient or image fill. */
function paintOver(node, bg) {
  const fills = (Array.isArray(node.fills) ? node.fills : []).filter((f) => isObj(f) && f.visible !== false);
  let out = bg;
  for (const f of fills) {
    if (f.type !== "solid") return null;
    const c = rgba(f.color);
    if (!c) return null;
    c[3] *= typeof f.opacity === "number" ? f.opacity : 1;
    out = out ? over(c, out) : c[3] >= 1 ? c : null;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- names

const words = (s, n = 4) => String(s || "").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");
const textOf = (node) => (Array.isArray(node?.text?.runs) ? node.text.runs.map((r) => (typeof r?.t === "string" ? r.t : "")).join("") : "");
const firstText = (model, id, depth = 0) => {
  const kids = indexOf(model).get(id);
  for (const k of kids) {
    const n = model.nodes[k];
    if (n?.type === "text" && textOf(n).trim()) return textOf(n);
  }
  if (depth < 3) for (const k of kids) {
    const t = firstText(model, k, depth + 1);
    if (t) return t;
  }
  return "";
};

/** An HTML tag that fits a layer (for code export), or null when a div is right. */
export function suggestTag(model, id) {
  const n = model.nodes[id];
  if (!n) return null;
  if (n.type === "text") {
    const s = textStyleOf(n);
    const size = typeof s.size === "number" ? s.size : 16;
    const weight = typeof s.weight === "number" ? s.weight : 400;
    if (size >= 32) return "h1";
    if (size >= 24) return "h2";
    if (size >= 20 && weight >= 600) return "h3";
    return INTERACTIVE_NAME.test(n.name || "") ? null : "p";
  }
  if (n.type === "image") return "img";
  if (!["frame", "instance", "component"].includes(n.type)) return null;
  const name = `${n.name || ""} ${n.type === "instance" ? model.nodes[n.of]?.name || "" : ""}`;
  if (/\b(button|btn|cta)\b/i.test(name)) return "button";
  if (/\b(input|text ?field|field)\b/i.test(name)) return "input";
  if (/\b(nav|navigation|menu|tabs?)\b/i.test(name)) return "nav";
  if (/\b(header|top ?bar|app ?bar)\b/i.test(name)) return "header";
  if (/\bfooter\b/i.test(name)) return "footer";
  if (/\b(form|login|sign ?in|sign ?up)\b/i.test(name)) return "form";
  if (/\b(link)\b/i.test(name)) return "a";
  if (/\b(list)\b/i.test(name)) return "ul";
  if (/\b(card|section)\b/i.test(name)) return "section";
  return null;
}

/** A semantic name for a layer (from its text, its children and its layout), or null when there is none. */
export function suggestName(model, id) {
  const n = model.nodes[id];
  if (!n) return null;
  if (n.type === "text") {
    const t = words(textOf(n));
    return t ? t.slice(0, 64) : null;
  }
  if (n.type === "instance") return model.nodes[n.of]?.name || null;
  if (n.type === "image") return n.alt ? words(n.alt).slice(0, 64) : "Image";
  if (n.type !== "frame") return null;
  const kids = indexOf(model).get(id);
  const t = words(firstText(model, id), 3);
  const lay = isObj(n.layout) ? n.layout : {};
  const hasStroke = Array.isArray(n.strokes) && n.strokes.length > 0;
  const filled = Array.isArray(n.fills) && n.fills.some((f) => isObj(f) && f.visible !== false);
  const kidTypes = kids.map((k) => model.nodes[k]?.type);
  if (n.parent == null) return t ? `${t} screen`.slice(0, 64) : null;
  if (kids.length === 1 && kidTypes[0] === "text" && filled && lay.type === "flex") return t ? `${t} button`.slice(0, 64) : "Button";
  if (kids.length <= 2 && kidTypes.includes("text") && hasStroke && !filled) return t ? `${t} field`.slice(0, 64) : "Field";
  if (lay.type === "flex" && lay.dir === "row" && kids.length >= 3 && kidTypes.every((x) => x === "text" || x === "instance")) return "Nav";
  if (lay.type === "grid") return t ? `${t} grid`.slice(0, 64) : "Grid";
  if (lay.type === "flex") return t ? `${t} ${lay.dir === "row" ? "row" : "stack"}`.slice(0, 64) : lay.dir === "row" ? "Row" : "Stack";
  return t ? `${t} group`.slice(0, 64) : null;
}

// ------------------------------------------------------------------------------------------------- lint

/**
 * Lints a model. See the header.
 * @param {object} model
 * @param {{ page?: string, ids?: string[], rules?: string[], measurer?: object, modes?: object }} [o]
 */
export function lint(model, { page = null, ids = null, rules = null, measurer = undefined, modes = undefined } = {}) {
  const on = (r) => !rules || rules.includes(r);
  const issues = [];
  const add = (rule, severity, node, message, fix = null, path = "") => issues.push({ id: `${rule}:${node}${path ? `:${path}` : ""}`, rule, severity, node, message, ...(fix ? { fix } : {}) });
  const res = createResolver(model, modes ? { modes } : {});
  const nodes = model.nodes || {};
  const pages = page ? [page] : pageList(model).map((p) => p.id);
  const ix = indexOf(model);
  const within = ids ? new Set(ids.flatMap((id) => [id, ...descendantsOf(ix, id)])) : null;
  const inScope = (id) => !!nodes[id] && pages.includes(nodes[id].page) && (!within || within.has(id));
  const real = (r) => r.key === r.id && !!nodes[r.id] && !insideComponentInstance(r);

  // ---- variables and styles that fixes can bind
  const items = isObj(model.vars?.items) ? model.vars.items : {};
  const colorVars = new Map();
  const numberVars = new Map();
  for (const [vid, v] of Object.entries(items)) {
    if (!isObj(v)) continue;
    const val = variableValue(model, vid, {});
    if (v.type === "color" && typeof val === "string") {
      const k = val.toLowerCase();
      colorVars.set(k, colorVars.has(k) ? null : vid);
    }
    if (v.type === "number" && typeof val === "number") numberVars.set(val, numberVars.has(val) ? null : vid);
  }
  const styles = isObj(model.styles) ? model.styles : {};

  for (const pid of pages) {
    const pg = model.pages?.[pid];
    if (!pg) continue;
    const pageBg = rgba(isBinding(pg.bg) ? res.value(pg.bg, {}) : pg.bg) || [255, 255, 255, 1];
    for (const root of res.page(pid)) {
      if (within && !hasAny(root, within)) continue;
      let boxes = null;
      try {
        boxes = layout(root, { measurer }).boxes;
      } catch {
        boxes = new Map();
      }
      const bgOf = new Map();
      const clipOf = new Map();
      walkResolved(root, (r, parent) => {
        const parentBg = parent ? bgOf.get(parent.key) : pageBg;
        const mine = field(r.node, "visible") === false ? parentBg : parentBg ? paintOver(r.node, parentBg) : null;
        bgOf.set(r.key, mine);
        clipOf.set(r.key, field(r.node, "clip") === true || !parent ? r.key : parent ? clipOf.get(parent.key) : null);
        if (field(r.node, "visible") === false) return false;
        if (within && !within.has(r.id) && !within.has(r.key.split("/")[0])) return;
        const box = boxes.get(r.key);
        const n = r.node;

        // contrast
        if (on("contrast") && r.type === "text" && parentBg && textOf(n).trim()) {
          const s = textStyleOf(n);
          const colors = new Set([s.color, ...(n.text?.runs || []).map((x) => x?.s?.color).filter(Boolean)]);
          const size = typeof s.size === "number" ? s.size : 16;
          const weight = typeof s.weight === "number" ? s.weight : 400;
          const large = size >= 24 || (size >= 18.66 && weight >= 700);
          const need = large ? 3 : 4.5;
          const bg = parentBg;
          for (const c of colors) {
            const ratio = contrastRatio(c, toHex(bg));
            if (!(ratio < need)) continue;
            const black = contrastRatio("#18181b", toHex(bg));
            const white = contrastRatio("#ffffff", toHex(bg));
            const better = black >= white ? "#18181b" : "#ffffff";
            const runColors = (n.text?.runs || []).some((x) => x?.s?.color);
            const fixable = real(r) && !r.bound?.["text.style.color"] && !runColors;
            add("contrast", ratio < 3 ? "error" : "warning", r.key, `Text contrast ${ratio.toFixed(2)}:1 (${c} on ${toHex(bg)}) is below ${need}:1 for ${large ? "large" : "normal"} text.`, fixable ? { label: `Set the text color to ${better}`, ops: [{ op: "node.update", id: r.id, set: { "text.style.color": better } }], safe: true } : null);
            break;
          }
        }

        // touch targets
        if (on("touch-target") && box && isInteractive(r) && (box.w < TARGET_GOOD || box.h < TARGET_GOOD)) {
          const small = box.w < TARGET_MIN || box.h < TARGET_MIN;
          const set = {};
          if (box.h < TARGET_GOOD) set["h.min"] = TARGET_GOOD;
          if (box.w < TARGET_GOOD) set["w.min"] = TARGET_GOOD;
          const fix = real(r) && isObj(nodes[r.id].w) && isObj(nodes[r.id].h) && nodes[r.id].w.mode !== "fixed" && nodes[r.id].h.mode !== "fixed" ? { label: `Give it a minimum size of ${TARGET_GOOD} px`, ops: [{ op: "node.update", id: r.id, set }], safe: true } : real(r) ? { label: `Make it at least ${TARGET_GOOD} px`, ops: [{ op: "node.update", id: r.id, set: sizeSet(nodes[r.id], box) }], safe: true } : null;
          add("touch-target", small ? "warning" : "info", r.key, `Touch target ${Math.round(box.w)} × ${Math.round(box.h)} px is ${small ? `below the WCAG minimum of ${TARGET_MIN} px` : `smaller than the recommended ${TARGET_GOOD} px`}.`, fix);
        }

        // overflowing text
        if (on("overflow-text") && r.type === "text" && box?.lines) {
          const used = box.lines.reduce((s, l) => s + l.h, 0);
          const auto = n.text?.autoSize || "width";
          if (auto === "fixed" && used > box.h + 0.5) add("overflow-text", "warning", r.key, `The text needs ${Math.round(used)} px but its box is ${Math.round(box.h)} px high; it is cut off.`, real(r) ? { label: "Let the box grow with the text", ops: [{ op: "node.update", id: r.id, set: { "text.autoSize": "height", h: { mode: "hug" } } }], safe: true } : null);
          const clipKey = parent ? clipOf.get(parent.key) : null;
          const cb = clipKey ? boxes.get(clipKey) : null;
          if (cb && clipKey !== r.key && box.x + Math.min(box.w, Math.max(0, ...box.lines.map((l) => l.x + l.w))) > cb.x + cb.w + 1) {
            const pflex = parent && isObj(parent.node.layout) && parent.node.layout.type === "flex";
            add("overflow-text", "warning", r.key, "The text runs past the right edge of its container and is clipped.", real(r) && pflex ? { label: "Make the text fill the width and wrap", ops: [{ op: "node.update", id: r.id, set: { w: { mode: "fill" }, "text.autoSize": "height" } }], safe: true } : null, "x");
          }
        }

        if (!real(r)) return;
        const id = r.id;
        const raw = nodes[id];

        // unbound colors
        if (on("unbound-color") && colorVars.size) {
          for (const [path, value] of colorPaths(raw)) {
            const vid = colorVars.get(String(value).toLowerCase());
            if (vid && canBind(items[vid], path)) add("unbound-color", "warning", id, `${value} at ${path} equals the variable “${items[vid].name}” but is not bound to it.`, { label: `Bind to ${items[vid].name}`, ops: [{ op: "node.bind", id, path, var: vid }], safe: true }, path);
            else add("unbound-color", "info", id, `${value} at ${path} is not a variable.`, null, path);
          }
        }
        const lay = isObj(raw.layout) ? raw.layout : null;
        const spacing = lay && lay.type !== "none" ? spacingPaths(lay) : [];
        // spacing bound to variables
        if (on("unbound-spacing") && numberVars.size)
          for (const [path, value] of spacing) {
            const vid = numberVars.get(value);
            if (vid && canBind(items[vid], path) && value !== 0) add("unbound-spacing", "warning", id, `${path} ${value} equals the variable “${items[vid].name}” but is not bound to it.`, { label: `Bind to ${items[vid].name}`, ops: [{ op: "node.bind", id, path, var: vid }], safe: true }, path);
          }
        // spacing on the 4 px grid
        if (on("off-grid")) {
          const off = spacing.filter(([, v]) => v % GRID !== 0);
          if (off.length) {
            const set = {};
            for (const [path, v] of off) {
              const [, key, i] = path.split(".");
              if (key === "pad") set["layout.pad"] = (set["layout.pad"] || lay.pad.slice()).map((x, k) => (k === Number(i) ? Math.round(v / GRID) * GRID : x));
              else set[`layout.${key}`] = Math.round(v / GRID) * GRID;
            }
            add("off-grid", "info", id, `Spacing off the ${GRID} px grid: ${off.map(([p, v]) => `${p} ${v}`).join(", ")}.`, { label: `Round to multiples of ${GRID} px`, ops: [{ op: "node.update", id, set }], safe: true });
          }
        }

        // local values that equal a style
        if (on("detached-style"))
          for (const [slot, kind, value] of [["text", "text", raw.text?.style], ["effect", "effect", raw.effects], ["fill", "fill", raw.fills]]) {
            if (value === undefined || (Array.isArray(value) && !value.length) || (isObj(raw.style) && raw.style[slot])) continue;
            const key = stable(value);
            const sid = Object.keys(styles).find((s) => styles[s]?.kind === kind && stable(styles[s].value) === key);
            if (sid) add("detached-style", "warning", id, `The ${slot} values equal the style “${styles[sid].name}” but do not use it.`, { label: `Use the style ${styles[sid].name}`, ops: [{ op: "style.apply", ids: [id], slot, style: sid }], safe: true }, slot);
          }

        // overrides of layers the component no longer has
        if (on("inactive-override") && raw.type === "instance") {
          const { inactive } = overridePaths(model, id);
          if (inactive.length) add("inactive-override", "warning", id, `${inactive.length} override${inactive.length === 1 ? "" : "s"} point at layers the component no longer has (${inactive.slice(0, 5).join(", ")}).`, { label: "Remove the stale overrides", ops: [{ op: "instance.reset", id, paths: inactive }], safe: true });
        }

        // a frame that looks like a detached copy of a component
        if (on("detached-instance") && raw.type === "frame" && raw.name && !DEFAULT_NAME.test(raw.name) && !inComponent(model, id)) {
          const comp = Object.values(nodes).find((c) => (c?.type === "component" || c?.type === "componentSet") && c.name?.trim().toLowerCase() === raw.name.trim().toLowerCase() && !(c.type === "component" && nodes[c.parent]?.type === "componentSet"));
          if (comp) {
            const fields = { name: raw.name };
            for (const k of ["x", "y", "pos", "cx", "cy", "cell"]) if (raw[k] !== undefined) fields[k] = raw[k];
            add("detached-instance", "info", id, `This frame is named like the component “${comp.name}” but is not an instance of it (detached copy?).`, { label: `Replace it with an instance of ${comp.name}`, ops: [{ op: "instance.create", of: comp.id, parent: raw.parent, page: raw.page, before: id, fields }, { op: "node.delete", ids: [id] }], safe: false });
          }
        }

        // empty frames
        if (on("empty-frame") && raw.type === "frame" && !ix.get(id).length) {
          const paints = (raw.fills || []).some((f) => f?.visible !== false) || (raw.strokes || []).length || (raw.effects || []).length || (isObj(raw.style) && (raw.style.fill || raw.style.effect));
          if (!paints) add("empty-frame", "warning", id, "The frame is empty and paints nothing.", { label: "Delete it", ops: [{ op: "node.delete", ids: [id] }], safe: true });
        }

        // default names
        if (on("naming") && DEFAULT_NAME.test(raw.name || "")) {
          const name = suggestName(model, id);
          add("naming", "info", id, `“${raw.name || raw.type}” is a default name; name layers by what they are.`, name && !DEFAULT_NAME.test(name) ? { label: `Rename to “${name}”`, ops: [{ op: "node.update", id, set: { name } }], safe: true } : null);
        }
      });
    }
  }

  // unused variables and styles (whole document)
  if (on("unused-token") && !ids) {
    const used = new Set();
    const usedStyles = new Set();
    for (const n of Object.values(nodes)) {
      if (!isObj(n)) continue;
      for (const k of Object.keys(n)) if (!["id", "type", "page", "parent", "ord"].includes(k)) for (const [, v] of bindingsIn(n[k])) used.add(v);
      if (isObj(n.style)) for (const s of Object.values(n.style)) if (typeof s === "string") usedStyles.add(s);
    }
    for (const p of Object.values(model.pages || {})) for (const [, v] of bindingsIn(p?.bg)) used.add(v);
    for (const s of Object.values(styles)) for (const [, v] of bindingsIn(s?.value)) used.add(v);
    for (const [vid, v] of Object.entries(items)) for (const [, a] of bindingsIn([v?.values, v?.ext])) if (a !== vid) used.add(a);
    for (const [vid, v] of Object.entries(items)) if (!used.has(vid)) add("unused-token", "info", vid, `The variable “${v?.name}” is not used by any layer, style or variable.`, { label: "Delete the variable", ops: [{ op: "var.delete", ids: [vid] }], safe: false });
    for (const [sid, s] of Object.entries(styles)) if (!usedStyles.has(sid)) add("unused-token", "info", sid, `The style “${s?.name}” is not used by any layer.`, { label: "Delete the style", ops: [{ op: "style.delete", ids: [sid] }], safe: false });
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return { approximate: true, issues, counts };
}

/**
 * The operations that fix `issues` (only issues with a fix; safe fixes unless `unsafe`; filtered by issue ids or
 * rules). Several fixes of one layer are merged where they touch the same fields (last wins).
 */
export function fixOps(issues, { ids = null, rules = null, unsafe = false } = {}) {
  const pick = issues.filter((i) => i.fix && (!ids || ids.includes(i.id)) && (!rules || rules.includes(i.rule)) && (unsafe || i.fix.safe || ids?.includes(i.id)));
  const ops = [];
  const deleted = new Set();
  for (const i of pick)
    for (const op of i.fix.ops) {
      if (op.op === "node.delete") {
        const fresh = op.ids.filter((x) => !deleted.has(x));
        fresh.forEach((x) => deleted.add(x));
        if (fresh.length) ops.push({ ...op, ids: fresh });
      } else if (!(op.id && deleted.has(op.id))) ops.push(op);
    }
  // updates of deleted layers would fail: drop them
  return ops.filter((op) => !(op.op !== "node.delete" && op.op !== "instance.create" && op.id && deleted.has(op.id)));
}

// ------------------------------------------------------------------------------------------------- helpers

function descendantsOf(ix, id, out = []) {
  for (const k of ix.get(id)) {
    out.push(k);
    descendantsOf(ix, k, out);
  }
  return out;
}

function hasAny(root, set) {
  let hit = false;
  walkResolved(root, (r) => {
    if (hit) return false;
    if (set.has(r.id)) hit = true;
  });
  return hit;
}

// layers inside an instance are virtual (their key has a "/"); edits go to the instance, never to them
const insideComponentInstance = (r) => r.key.includes("/");
const inComponent = (model, id) => ancestors(model, id).some((a) => ["component", "componentSet", "instance"].includes(model.nodes[a]?.type));

function isInteractive(r) {
  const n = r.node;
  if (INTERACTIVE_TAGS.has(n.tag)) return true;
  if (isObj(n.a11y) && INTERACTIVE_ROLES.has(n.a11y.role)) return true;
  if (Array.isArray(n.proto) && n.proto.some((p) => ["click", "press", "doubleClick"].includes(p?.on?.type))) return true;
  return ["frame", "instance", "component"].includes(r.type) && INTERACTIVE_NAME.test(n.name || "");
}

function sizeSet(raw, box) {
  const set = {};
  if (box.h < TARGET_GOOD) set.h = raw.h?.mode === "fixed" || !isObj(raw.h) ? { mode: "fixed", value: TARGET_GOOD } : { ...raw.h, min: TARGET_GOOD };
  if (box.w < TARGET_GOOD) set.w = raw.w?.mode === "fixed" || !isObj(raw.w) ? { mode: "fixed", value: TARGET_GOOD } : { ...raw.w, min: TARGET_GOOD };
  return set;
}

/** Literal colors of a stored layer: [[path, hex]] (fills, strokes, shadows, text). */
function colorPaths(n) {
  const out = [];
  (Array.isArray(n.fills) ? n.fills : []).forEach((f, i) => {
    if (f?.type === "solid" && typeof f.color === "string") out.push([`fills.${i}.color`, f.color]);
  });
  (Array.isArray(n.strokes) ? n.strokes : []).forEach((s, i) => {
    if (typeof s?.color === "string") out.push([`strokes.${i}.color`, s.color]);
  });
  (Array.isArray(n.effects) ? n.effects : []).forEach((e, i) => {
    if (e?.type === "shadow" && typeof e.color === "string") out.push([`effects.${i}.color`, e.color]);
  });
  if (n.type === "text" && typeof n.text?.style?.color === "string") out.push(["text.style.color", n.text.style.color]);
  return out;
}

/** Literal spacing values of a layout: [[path, number]]. */
function spacingPaths(lay) {
  const out = [];
  for (const k of ["gap", "rowGap"]) if (typeof lay[k] === "number") out.push([`layout.${k}`, lay[k]]);
  if (Array.isArray(lay.pad)) lay.pad.forEach((v, i) => typeof v === "number" && out.push([`layout.pad.${i}`, v]));
  return out;
}

