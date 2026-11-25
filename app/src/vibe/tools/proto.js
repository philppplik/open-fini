// Vibe tools of the Proto Studio, group "Proto" (docs/proto-studio.md ▸ Assistant, concept §7, task T11): read the
// design, build and change layers with auto layout, components, variables, styles and tokens, look at frames, lint
// and fix. Static definitions; the logic loads on the first call (proto/ai-ops.js and engine/proto/lint.js, pure and
// unit-tested; proto/ai-runtime.js for the undo step, images and attachments). Every write tool is ONE undoable step
// ("Vibe: …") through engine/proto/ops.js, validated by the engine, and recorded in the AI log like every tool call.
// Names match the MCP tools of the concept (§8) where they overlap. proto_write_html, proto_to_code and
// proto_interaction arrive with T8, T7 and T9.
import { tool, S } from "./helpers.js";

const ops = () => import("../../proto/ai-ops.js");
const rt = () => import("../../proto/ai-runtime.js");
const lintMod = () => import("../../engine/proto/lint.js");

const OBJ = (d, extra = {}) => ({ type: "object", description: d, ...extra });
const ARR = (d, items = {}) => ({ type: "array", description: d, items });
const ID = (d = "Layer id from proto_describe") => S.str(d);
const IDS = (d = "Layer ids from proto_describe") => ({ type: "array", items: { type: "string" }, minItems: 1, description: d });

/** A text measurer with the app's fonts in the window; the solver's own metrics in Node. */
async function measurer() {
  if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") return undefined;
  try {
    return (await import("../../core/fonts.js")).measurer;
  } catch {
    return undefined;
  }
}

/** Runs `fn(model, target, ai)` → { ops, result, label? } on the active design and commits the ops as one step. */
async function edit(app, label, fn) {
  const [R, A] = await Promise.all([rt(), ops()]);
  const target = R.protoTarget(app);
  const out = await fn(target.model(), target, A);
  if (!out.ops?.length) return { ok: true, changed: false, ...(out.result || {}) };
  const res = target.run(out.ops, out.label || label);
  return { ok: true, changed: !!res, ...(res?.ids && !out.result?.ids ? { ids: res.ids.slice(0, 200) } : {}), ...(out.result || {}), ...(res?.report ? { report: res.report } : {}) };
}

export function protoTools(app, ctx = {}) {
  return [
    tool("proto_describe", "Outline of the active Proto design (Proto Studio): pages, one line per layer (id, type, name, size w×h as px/hug/fill/%, @x,y for absolute layers, flex/grid with gap, pad, align, justify, fill, stroke, radius, text with size/weight/color, instance values, style references, modes, $variable bindings), components with variants and properties, variable collections with their modes and values, styles. Call it first and after edits; pass root for a subtree.", {
      page: S.str("Page id (default: the page on screen)"),
      root: S.str("Only this layer and its subtree"),
      depth: S.num("Levels to list (default 6)", { minimum: 1, maximum: 64 }),
      maxLines: S.num("Most layer lines (default 400)", { minimum: 10, maximum: 4000 }),
    }, [], async (a) => {
      const [R, A] = await Promise.all([rt(), ops()]);
      const t = R.protoTarget(app);
      return { ...A.describe(t.model(), { page: a.page || t.page, root: a.root, depth: a.depth, maxLines: a.maxLines }), selection: t.selection, readOnly: t.info.readOnly || undefined };
    }, { readOnly: true }),

    tool("proto_get_node", "Full JSON of layers: stored (raw fields, bindings as { $var }) or resolved (styles, component properties, overrides and variable values applied, instance contents expanded; `bound` lists the bound fields).", {
      ids: IDS(), resolved: S.bool("Resolved instead of stored JSON"),
    }, ["ids"], async (a) => {
      const [R, A] = await Promise.all([rt(), ops()]);
      return { nodes: A.getNodes(R.protoTarget(app).model(), a.ids.slice(0, 50), { resolved: !!a.resolved }) };
    }, { readOnly: true }),

    tool("proto_search", "Finds layers by name or text (query), type, instances of a component, layers bound to a variable, or layers with literal (unbound) colors or spacing. Returns one describe line per match.", {
      query: S.str("Text in the layer name or text content"), type: S.str("Layer type", { enum: ["frame", "rect", "ellipse", "line", "vector", "text", "image", "instance", "component", "componentSet", "slot"] }),
      component: S.str("Component name or id: its instances"), variable: S.str("Variable name or id: layers bound to it"),
      unbound: S.str("color or spacing: layers with literal values of that kind", { enum: ["color", "spacing"] }), page: S.str("Page id"),
      limit: S.num("Most matches (default 100)", { minimum: 1, maximum: 1000 }),
    }, [], async (a) => {
      const [R, A] = await Promise.all([rt(), ops()]);
      return A.search(R.protoTarget(app).model(), a);
    }, { readOnly: true }),

    tool("proto_screenshot", "Renders a frame or layer to a PNG so you can SEE the design (approximate: the pure layout solver painted with the app's fonts). Default: the selection, else the first frame of the page. compare: an image layer id or media id (the reference from proto_from_screenshot) puts the reference next to the render and reports the mean pixel difference.", {
      id: S.str("Layer id (default: the selection or the first frame)"), scale: S.num("Scale (default 1)", { minimum: 0.05, maximum: 4 }),
      maxSize: S.num("Longest side in px (default 1200)", { minimum: 100, maximum: 2400 }), compare: S.str("Image layer id or media id to compare with"),
    }, [], async (a) => {
      const R = await rt();
      const t = R.protoTarget(app);
      const m = t.model();
      const id = a.id || t.selection[0] || Object.values(m.nodes).find((n) => n.parent == null && n.page === t.page)?.id;
      if (!id || !m.nodes[id]) throw new Error(a.id ? `There is no layer “${a.id}”. Call proto_describe for the ids.` : "The page is empty; create a frame with proto_create first.");
      return R.renderImage(t, id, { scale: a.scale || 1, maxSize: a.maxSize || 1200, compare: a.compare || null });
    }, { readOnly: true, exclusive: true }),

    tool("proto_new", "Creates a new Proto design and opens it in the Proto Studio: an empty page, or one desktop (1440 × 1024) or phone (390 × 844) frame. Needs the Labs switch Settings ▸ Labs ▸ Proto Studio.", {
      starter: S.str("blank (default), desktop or phone", { enum: ["blank", "desktop", "phone"] }), title: S.str("Design name"),
    }, [], async (a) => {
      if (!app.prefs?.labsProto) throw new Error("Proto Studio is a Labs preview. Ask the user to turn it on under Settings ▸ Labs ▸ Proto Studio.");
      const { newProto } = await import("../../proto/host.js");
      const doc = newProto(app, { starter: a.starter || "blank", title: a.title || "" });
      const A = await ops();
      return { ok: true, name: doc.name, ...A.describe(doc.office.model, {}) };
    }),

    tool("proto_create", "Creates layers from compact nested JSON specs, as one undo step: a whole screen or component at once, with auto layout (flex rows and columns, grids), sizes (px, hug, fill, %), fills, strokes, radius, shadows, text, instances of components and variable bindings ({ \"$var\": \"color/primary\" }). Top-level frames go to the right of the page's frames unless x, y are given; children of flex and grid frames flow in the layout. Returns the ids (refs maps each spec's ref to its id). Build structure with auto layout, not absolute positions.", {
      nodes: ARR("Layer specs. A layer spec is { type, name?, ref?, …fields, children? }; see the tool description of proto_create and the studio guide for the shorthands.", OBJ("Layer spec", { properties: { type: S.str("frame, text, rect, ellipse, line, vector, image, slot, component or instance (aliases: row, column, stack, box, div)") } })),
      parent: S.str("Container layer id (default: the top level of the page)"), page: S.str("Page id (top level; default: the page on screen)"),
      index: S.num("Position among the parent's children (default: last)", { minimum: 0 }), before: S.str("Insert before this sibling id"), after: S.str("Insert after this sibling id"),
      select: S.bool("Select the created top-level layers (default true)"),
    }, ["nodes"], async (a) => {
      const r = await edit(app, "Create layers", async (m, t, A) => {
        const c = A.createOps(m, a.nodes, { parent: a.parent ?? null, page: a.page || t.page, index: a.index, before: a.before, after: a.after });
        return { ops: c.ops, result: { ids: c.ids.slice(0, 200), created: c.ids.length, refs: c.refs, roots: c.ops.filter((o) => o.parent === (a.parent ?? null)).map((o) => o.id) } };
      });
      if (a.select !== false && r.roots?.length) app.protoUI?.select?.(r.roots);
      return r;
    }),

    tool("proto_update", "Changes fields of layers as one undo step. set takes the proto_create shorthands (w, h, layout, gap, pad, align, justify, fill, stroke, radius, shadow, text, size, weight, color, name, tag, opacity, visible…) and dotted paths (\"layout.gap\", \"text.style.size\", \"fills.0.color\"); layout keys merge into the existing layout. unset removes fields; bind maps field paths to variable names (null unbinds and keeps the value).", {
      updates: ARR("One entry per layer", OBJ("{ id, set?, unset?, bind? }", { properties: { id: ID(), set: OBJ("Fields to set"), unset: ARR("Fields to remove", { type: "string" }), bind: OBJ("Field path → variable name or id, or null") }, required: ["id"] })),
    }, ["updates"], (a) => edit(app, "Update layers", async (m, t, A) => ({ ops: A.updateOps(m, a.updates), result: { ids: a.updates.map((u) => u.id) } }))),

    tool("proto_move", "Moves layers into another container or page, reorders them (index, before, after) or wraps siblings in a new auto layout frame (wrap: flex guesses direction, order and gap from their positions; grid; none).", {
      ids: IDS(), parent: S.str("New container id; empty string for the top level"), page: S.str("Page id (top level)"),
      index: S.num("Position among the new siblings", { minimum: 0 }), before: S.str("Place before this sibling id"), after: S.str("Place after this sibling id"),
      wrap: S.str("Wrap the layers in a new frame instead of moving them", { enum: ["flex", "grid", "none"] }), name: S.str("Name of the wrapping frame"),
    }, ["ids"], (a) => edit(app, a.wrap ? "Wrap layers" : "Move layers", async (m, t) => {
      for (const id of a.ids) if (!m.nodes[id]) throw new Error(`There is no layer “${id}”. Call proto_describe for the ids.`);
      if (a.wrap) return { ops: [{ op: "node.wrap", ids: a.ids, layout: a.wrap, ...(a.name ? { fields: { name: a.name } } : {}) }], label: "Wrap layers", result: { ids: a.ids } };
      const parent = a.parent === undefined ? m.nodes[a.ids[0]].parent : a.parent || null;
      const pos = { ...(a.index !== undefined ? { index: a.index } : {}), ...(a.before ? { before: a.before } : {}), ...(a.after ? { after: a.after } : {}) };
      return { ops: [{ op: "node.move", ids: a.ids, parent, ...(parent == null ? { page: a.page || m.nodes[a.ids[0]].page || t.page } : {}), ...pos }], result: { ids: a.ids } };
    })),

    tool("proto_delete", "Deletes layers with everything inside them (one undo step). A component that instances still use cannot be deleted; detach or delete the instances first.", { ids: IDS() }, ["ids"], (a) =>
      edit(app, "Delete layers", async (m) => {
        for (const id of a.ids) if (!m.nodes[id]) throw new Error(`There is no layer “${id}”. Call proto_describe for the ids.`);
        return { ops: [{ op: "node.delete", ids: a.ids }], result: { deleted: a.ids } };
      })),

    tool("proto_duplicate", "Duplicates layers right after themselves (absolute layers move by offset). count makes several copies; returns the new ids.", {
      ids: IDS(), offset: ARR("[dx, dy] for absolute layers (default [16, 16]; flowing layers just follow)", { type: "number" }), count: S.num("Copies (default 1)", { minimum: 1, maximum: 50 }),
    }, ["ids"], async (a) => {
      const R = await rt();
      const t = R.protoTarget(app);
      for (const id of a.ids) if (!t.model().nodes[id]) throw new Error(`There is no layer “${id}”. Call proto_describe for the ids.`);
      const n = a.count || 1;
      const copies = Array.from({ length: n }, () => ({ op: "node.duplicate", ids: a.ids, ...(a.offset ? { offset: a.offset } : {}) }));
      const res = t.run(copies, "Duplicate layers");
      return { ok: true, ids: res?.ids || [] };
    }),

    tool("proto_component", "Components, variants and instances, one undo step per call. actions: create (ids → a component; a frame becomes one in place), combine (components → a set; names like \"size=md, state=hover\" become variant properties), addVariant (set, from?, variant), defineProp (id, name, def: { type: text|bool|number|swap|slot|variant, default, options? }), renameProp (id, name, to), deleteProp (id, name), bindProp (id = component, layer, field such as text or visible, prop), instance (of, parent?, page?, index?, variant?, props?, fields?), set (id, variant?, props?), swap (id, of), override (id, path \"n31/n22\" of source ids inside the instance, fields, unset?), reset (id, paths?, resetProps?), detach (ids).", {
      action: S.str("What to do", { enum: ["create", "combine", "addVariant", "defineProp", "renameProp", "deleteProp", "bindProp", "instance", "set", "swap", "override", "reset", "detach"] }),
      ids: IDS("Layer ids (create, combine, detach)"), id: S.str("Component, set or instance id"), name: S.str("Component or property name"),
      to: S.str("New property name (renameProp)"), of: S.str("Component name or id (instance, swap)"), set: S.str("Component set id (addVariant)"),
      from: S.str("Variant to copy (addVariant)"), variant: OBJ("Variant values { axis: option }"), props: OBJ("Property values { name: value }"),
      def: OBJ("Property definition { type, default?, options?, preferred? }"), layer: S.str("Layer id inside the component (bindProp)"),
      field: S.str("Field of that layer: text, visible, of, opacity… (bindProp)"), prop: S.str("Property name, or empty to unbind (bindProp)"),
      path: S.str("Source-id path inside the instance (override), e.g. n31/n22"), fields: OBJ("Fields: of the new instance (instance) or the overridden layer (override; shorthands work)"),
      unset: ARR("Override fields to remove", { type: "string" }), paths: ARR("Override paths to reset (default all)", { type: "string" }), resetProps: S.bool("Also reset property values (reset)"),
      parent: S.str("Container for a new instance"), page: S.str("Page for a new top-level instance"), index: S.num("Position among the siblings", { minimum: 0 }),
    }, ["action"], (a) => edit(app, `Component: ${a.action}`, async (m, t, A) => {
      const N = A.names(m);
      const need = (k) => {
        if (a[k] == null || a[k] === "") throw new Error(`action ${a.action} needs ${k}.`);
        return a[k];
      };
      const shortFields = (type) => (a.fields ? A.fieldsOf(m, { type, ...a.fields }, { type }) : undefined);
      let op;
      switch (a.action) {
        case "create": op = { op: "component.create", ids: need("ids"), ...(a.name ? { name: a.name } : {}) }; break;
        case "combine": op = { op: "component.combine", ids: need("ids"), ...(a.name ? { name: a.name } : {}) }; break;
        case "addVariant": op = { op: "component.addVariant", set: N.component(need("set")), ...(a.from ? { from: N.component(a.from) } : {}), ...(a.variant ? { variant: a.variant } : {}), ...(a.name ? { name: a.name } : {}) }; break;
        case "defineProp": op = { op: "prop.define", id: N.component(need("id")), name: need("name"), def: need("def") }; break;
        case "renameProp": op = { op: "prop.rename", id: N.component(need("id")), name: need("name"), to: need("to") }; break;
        case "deleteProp": op = { op: "prop.delete", id: N.component(need("id")), name: need("name") }; break;
        case "bindProp": op = { op: "prop.bind", id: N.component(need("id")), layer: need("layer"), field: need("field"), prop: a.prop || null }; break;
        case "instance": {
          const parent = a.parent || null;
          const page = parent ? m.nodes[parent]?.page : a.page || t.page;
          const c = A.createOps(m, [{ type: "instance", of: need("of"), ...(a.variant ? { variant: a.variant } : {}), ...(a.props ? { props: a.props } : {}), ...(a.fields || {}) }], { parent, page, index: a.index });
          return { ops: c.ops, result: { ids: c.ids } };
        }
        case "set": op = { op: "instance.set", id: need("id"), ...(a.variant ? { variant: a.variant } : {}), ...(a.props ? { props: a.props } : {}) }; break;
        case "swap": op = { op: "instance.swap", id: need("id"), of: N.component(need("of")) }; break;
        case "override": op = { op: "instance.override", id: need("id"), path: need("path"), set: shortFields(m.nodes[String(a.path).split("/").pop()]?.type || "frame") || {}, ...(a.unset ? { unset: a.unset } : {}) }; break;
        case "reset": op = { op: "instance.reset", id: need("id"), ...(a.paths ? { paths: a.paths } : {}), ...(a.resetProps ? { props: true } : {}) }; break;
        case "detach": op = { op: "instance.detach", ids: need("ids") }; break;
        default: throw new Error(`Unknown action “${a.action}”.`);
      }
      return { ops: [op], result: {} };
    })),

    tool("proto_variables", "Variables (design tokens) and modes, one undo step per call. actions: collection (name, modes: [\"Light\", \"Dark\"], extends?), mode (coll, name, from?), renameMode (coll, mode, name), deleteMode (coll, mode), create (coll, items: [{ name, type: color|number|string|bool, value? | values: { modeName: value }, scopes?, alias? }]), set (items: [{ name, value? | values? | alias? }]), delete (names, detach?), bind (id = layer, path such as fills.0.color or layout.gap, var: name or null), setMode (id = layer or page, coll, mode: name or null). Names may contain slashes for groups (color/bg/surface).", {
      action: S.str("What to do", { enum: ["collection", "deleteCollection", "mode", "renameMode", "deleteMode", "create", "set", "delete", "bind", "setMode"] }),
      name: S.str("Collection or mode name"), coll: S.str("Collection name or id"), mode: S.str("Mode name or id"), from: S.str("Mode to copy values from (mode)"),
      modes: ARR("Mode names of a new collection", { type: "string" }), extends: S.str("Base collection of an extending collection (brands)"),
      items: ARR("Variables to create or change", OBJ("{ name, type?, value?, values?, alias?, scopes?, description? }", { properties: { name: S.str("Variable name") }, required: ["name"] })),
      names: ARR("Variable names or ids (delete)", { type: "string" }), detach: S.bool("Replace bindings by their values instead of refusing (delete)"),
      id: S.str("Layer id (bind, setMode) or page id (setMode)"), path: S.str("Field path (bind)"), var: S.str("Variable name or id; empty to unbind (bind)"), force: S.bool("Bind outside the variable's scopes"),
    }, ["action"], (a) => edit(app, `Variables: ${a.action}`, async (m, t, A) => {
      const { newId } = await import("../../engine/proto/ids.js");
      const N = A.names(m);
      const out = [];
      // variables created earlier in this call can be aliased by name
      const local = new Map();
      const localType = new Map();
      const varId = (name) => local.get(name) ?? N.variable(name);
      const valueOf = (v, type) => (type === "color" && typeof v === "string" ? A.hexColor(v) : v);
      const modeValues = (coll, it, type) => {
        if (it.alias) return Object.fromEntries((m.vars.collections[coll]?.modes || []).map((md) => [md.id, { $var: varId(it.alias) }]));
        if (!it.values) return undefined;
        return Object.fromEntries(Object.entries(it.values).map(([k, v]) => [N.mode(coll, k), isObjLike(v) && v.$var ? { $var: varId(v.$var) } : valueOf(v, type)]));
      };
      switch (a.action) {
        case "collection":
          out.push({ op: "collection.create", name: a.name || "Tokens", ...(a.extends ? { extends: N.collection(a.extends) } : { modes: (a.modes?.length ? a.modes : ["Default"]).map((x) => ({ name: x })) }) });
          break;
        case "deleteCollection": out.push({ op: "collection.delete", id: N.collection(a.coll || a.name), ...(a.detach ? { detach: true } : {}) }); break;
        case "mode": {
          const coll = N.collection(a.coll);
          out.push({ op: "mode.create", coll, name: a.name || "Mode", ...(a.from ? { from: N.mode(coll, a.from) } : {}) });
          break;
        }
        case "renameMode": {
          const coll = N.collection(a.coll);
          out.push({ op: "mode.update", coll, id: N.mode(coll, a.mode), name: a.name });
          break;
        }
        case "deleteMode": {
          const coll = N.collection(a.coll);
          out.push({ op: "mode.delete", coll, id: N.mode(coll, a.mode) });
          break;
        }
        case "create": {
          const coll = N.collection(a.coll);
          for (const it of a.items || []) {
            const aliased = it.alias ? varId(it.alias) : null;
            const type = it.type || (aliased ? localType.get(aliased) || m.vars?.items?.[aliased]?.type : null) || (typeof it.value === "number" ? "number" : typeof it.value === "boolean" ? "bool" : /^#|^rgb/.test(String(it.value ?? Object.values(it.values || {})[0] ?? "")) ? "color" : "string");
            const values = modeValues(coll, it, type);
            const id = newId("v", (x) => !!m.vars?.items?.[x] || [...local.values()].includes(x));
            local.set(it.name, id);
            localType.set(id, type);
            out.push({ op: "var.create", id, coll, name: it.name, type, ...(values ? { values } : {}), ...(it.value !== undefined ? { value: valueOf(it.value, type) } : {}), ...(it.scopes ? { scopes: it.scopes } : {}), ...(it.description ? { description: it.description } : {}) });
          }
          if (!out.length) throw new Error("Pass items to create.");
          break;
        }
        case "set":
          for (const it of a.items || []) {
            const id = N.variable(it.name);
            const item = m.vars.items[id];
            const set = {};
            if (it.value !== undefined) for (const md of m.vars.collections[item.coll]?.modes || []) set[`values.${md.id}`] = valueOf(it.value, item.type);
            for (const [k, v] of Object.entries(modeValues(item.coll, it, item.type) || {})) set[`values.${k}`] = v;
            if (it.newName) set.name = it.newName;
            if (it.scopes) set.scopes = it.scopes;
            if (it.description !== undefined) set.description = it.description;
            out.push({ op: "var.update", id, set });
          }
          break;
        case "delete": out.push({ op: "var.delete", ids: (a.names || []).map((x) => N.variable(x)), ...(a.detach ? { detach: true } : {}) }); break;
        case "bind": {
          if (!m.nodes[a.id]) throw new Error(`There is no layer “${a.id}”.`);
          out.push({ op: "node.bind", id: a.id, path: a.path, var: a.var ? N.variable(a.var) : null, ...(a.force ? { force: true } : {}) });
          break;
        }
        case "setMode": {
          const coll = N.collection(a.coll);
          const mode = a.mode ? N.mode(coll, a.mode) : null;
          if (m.pages[a.id]) out.push({ op: "page.update", id: a.id, ...(mode ? { set: { [`modes.${coll}`]: mode } } : { unset: [`modes.${coll}`] }) });
          else if (m.nodes[a.id]) out.push({ op: "node.update", id: a.id, ...(mode ? { set: { [`modes.${coll}`]: mode } } : { unset: [`modes.${coll}`] }) });
          else throw new Error(`There is no layer or page “${a.id}”.`);
          break;
        }
        default: throw new Error(`Unknown action “${a.action}”.`);
      }
      return { ops: out, result: {} };
    })),

    tool("proto_styles", "Shared styles (text, effect, fill, grid), one undo step per call. actions: create (name, kind, value | from = a layer whose values become the style and use it), update (style, value?, newName?), delete (style, detach?), apply (ids, slot: text|effect|fill|stroke|grid, style: name or empty to remove), detach (ids, slot?: bake the values into the layers).", {
      action: S.str("What to do", { enum: ["create", "update", "delete", "apply", "detach"] }),
      name: S.str("Style name (create)"), kind: S.str("Style kind (create)", { enum: ["text", "effect", "fill", "grid"] }),
      value: { description: "Style value: text { font, size, weight, lineHeight, tracking, color… }, effect [shadows], fill [fills], grid { cols, rows, gap }" },
      from: S.str("Layer id to take the values from (create)"), style: S.str("Style name or id"), newName: S.str("New name (update)"),
      ids: IDS("Layer ids (apply, detach)"), slot: S.str("Style slot", { enum: ["text", "effect", "fill", "stroke", "grid"] }), detach: S.bool("Keep the values on the layers that use it (delete)"),
    }, ["action"], (a) => edit(app, `Styles: ${a.action}`, async (m, t, A) => {
      const N = A.names(m);
      let op;
      const val = (v) => (a.kind === "text" && v && typeof v === "object" && !Array.isArray(v) ? { ...v, ...(typeof v.color === "string" ? { color: A.hexColor(v.color) } : {}) } : v);
      switch (a.action) {
        case "create": op = { op: "style.create", name: a.name || "Style", kind: a.kind, ...(a.from ? { from: a.from } : { value: val(a.value) }) }; break;
        case "update": op = { op: "style.update", id: N.style(a.style), set: { ...(a.value !== undefined ? { value: a.value } : {}), ...(a.newName ? { name: a.newName } : {}) } }; break;
        case "delete": op = { op: "style.delete", ids: [N.style(a.style)], ...(a.detach ? { detach: true } : {}) }; break;
        case "apply": op = { op: "style.apply", ids: a.ids, slot: a.slot, style: a.style ? N.style(a.style) : null }; break;
        case "detach": op = { op: "style.detach", ids: a.ids, ...(a.slot ? { slot: a.slot } : {}) }; break;
        default: throw new Error(`Unknown action “${a.action}”.`);
      }
      if (!op.kind && a.action === "create") throw new Error("create needs kind.");
      return { ops: [op], result: {} };
    })),

    tool("proto_tokens", "Design tokens in and out. export: the design's variables and styles as DTCG JSON (modes in $extensions), CSS custom properties, Tailwind v4 @theme or Swift. import: DTCG JSON (an object or JSON text, for example from local_read_file) into variables and styles as one undo step; returns a report of what was converted or skipped.", {
      action: S.str("export or import", { enum: ["export", "import"] }), format: S.str("Export format (default dtcg)", { enum: ["dtcg", "css", "tailwind", "swift"] }),
      tokens: { description: "DTCG tokens to import: a JSON object or JSON text" }, collection: S.str("Collection to import into (default Tokens)"), mode: S.str("Mode name the imported values belong to"),
    }, ["action"], async (a) => {
      if (a.action === "export") {
        const [R, T] = await Promise.all([rt(), import("../../engine/proto/tokens.js")]);
        const m = R.protoTarget(app).model();
        const f = a.format || "dtcg";
        const out = f === "css" ? T.tokensCss(m) : f === "tailwind" ? T.tokensTailwind(m) : f === "swift" ? T.tokensSwift(m) : T.exportTokens(m);
        return { format: f, tokens: out };
      }
      let json = a.tokens;
      if (typeof json === "string") {
        try {
          json = JSON.parse(json);
        } catch (e) {
          throw new Error(`tokens is not valid JSON: ${e.message}`);
        }
      }
      if (!json || typeof json !== "object") throw new Error("Pass tokens (DTCG JSON).");
      return edit(app, "Import tokens", async () => ({ ops: [{ op: "tokens.import", tokens: json, ...(a.collection ? { collection: a.collection } : {}), ...(a.mode ? { mode: a.mode } : {}) }], result: {} }));
    }),

    tool("proto_lint", "Checks the design: text contrast (WCAG), touch targets, colors and spacing that equal a variable but are not bound, spacing off the 4 px grid, local values that equal a style, overrides of layers a component no longer has, frames named like a component (detached copies), empty frames, default layer names, cut-off or clipped text, unused variables and styles. Each issue has an id, a severity, the layer and, where it can be repaired mechanically, a fix (apply with proto_fix).", {
      ids: IDS("Only these layers and their contents"), page: S.str("Only this page (default: every page)"),
      rules: ARR("Only these rules", { type: "string", enum: ["contrast", "touch-target", "unbound-color", "unbound-spacing", "off-grid", "detached-style", "inactive-override", "detached-instance", "empty-frame", "naming", "overflow-text", "unused-token"] }),
      severity: S.str("Lowest severity to list (default info)", { enum: ["error", "warning", "info"] }), limit: S.num("Most issues listed (default 100)", { minimum: 1, maximum: 2000 }),
    }, [], async (a) => {
      const [R, L] = await Promise.all([rt(), lintMod()]);
      const m = R.protoTarget(app).model();
      const r = L.lint(m, { ids: a.ids, page: a.page, rules: a.rules, measurer: await measurer() });
      const rank = { error: 0, warning: 1, info: 2 };
      const list = r.issues.filter((i) => rank[i.severity] <= rank[a.severity || "info"]).sort((x, y) => rank[x.severity] - rank[y.severity]);
      const lim = a.limit || 100;
      return { counts: r.counts, approximate: true, issues: list.slice(0, lim).map((i) => ({ id: i.id, severity: i.severity, layer: i.node, message: i.message, ...(i.fix ? { fix: `${i.fix.label}${i.fix.safe ? "" : " (only when named)"}` } : {}) })), ...(list.length > lim ? { more: list.length - lim } : {}) };
    }, { readOnly: true }),

    tool("proto_fix", "Applies lint fixes as one undo step: the issues named by id (from proto_lint), or every safe fix of some rules or of the whole design. Fixes that change structure or delete tokens (replace a detached copy with an instance, delete unused variables) run only when their issue id is named. Returns what was fixed and the new counts.", {
      issues: ARR("Issue ids from proto_lint", { type: "string" }), rules: ARR("Fix every safe issue of these rules", { type: "string" }),
      ids: IDS("Only issues of these layers and their contents"), page: S.str("Only this page"),
    }, [], (a) => edit(app, "Fix design issues", async (m) => {
      const L = await lintMod();
      const mm = await measurer();
      const r = L.lint(m, { ids: a.ids, page: a.page, measurer: mm });
      const known = new Set(r.issues.map((i) => i.id));
      const missing = (a.issues || []).filter((x) => !known.has(x));
      if (missing.length) throw new Error(`Unknown or already fixed issue ids: ${missing.slice(0, 10).join(", ")}. Run proto_lint again.`);
      const list = L.fixOps(r.issues, { ids: a.issues?.length ? a.issues : null, rules: a.rules?.length ? a.rules : null });
      const fixed = r.issues.filter((i) => i.fix && (a.issues?.length ? a.issues.includes(i.id) : (!a.rules?.length || a.rules.includes(i.rule)) && i.fix.safe)).map((i) => `${i.id}: ${i.fix.label}`);
      return { ops: list, result: { fixed } };
    })),

    tool("proto_responsive", "Lays a frame out at several widths (default: the design's breakpoints and the frame's own width) and reports layers that overflow the frame horizontally and text that is cut off. Use it after building a screen with fill and hug sizes.", {
      id: ID("Frame id"), widths: ARR("Widths in px", { type: "number" }),
    }, ["id"], async (a) => {
      const [R, A] = await Promise.all([rt(), ops()]);
      return { approximate: true, widths: A.responsive(R.protoTarget(app).model(), a.id, { widths: a.widths, measurer: await measurer() }) };
    }, { readOnly: true }),

    tool("proto_content", "Fills text layers with realistic content as one undo step: the given text layers and the text inside given frames, with values (in order, for example a sheet range read with sheet_read_range) or generated data of a kind (auto guesses per layer: name, email, price, date, time, city, company, title, sentence, number, percent, phone, url, username).", {
      ids: IDS("Text layers or frames"), kind: S.str("Kind of content (default auto)"), values: ARR("Texts in layer order", { type: "string" }), seed: S.num("Different seed, different picks", { minimum: 0 }),
    }, ["ids"], (a) => edit(app, "Fill content", async (m, t, A) => {
      const c = A.contentOps(m, a.ids, { kind: a.kind || "auto", values: a.values || null, seed: a.seed || 0 });
      return { ops: c.ops, result: { filled: c.filled.slice(0, 100) } };
    })),

    tool("proto_rename", "Gives layers semantic names (from their text and structure) and HTML tags (button, nav, header, h1, p, img…) for better code export; default names only unless force. One undo step; returns the changes.", {
      ids: IDS("Layers (default: every top-level layer of the page)"), deep: S.bool("Include their contents (default true)"), tags: S.bool("Also set tags (default true)"), force: S.bool("Rename layers that already have a name"),
    }, [], (a) => edit(app, "Rename layers", async (m, t, A) => {
      const ids = a.ids?.length ? a.ids : Object.values(m.nodes).filter((n) => n.parent == null && n.page === t.page).map((n) => n.id);
      const r = A.renameOps(m, ids, { deep: a.deep !== false, tags: a.tags !== false, force: !!a.force });
      return { ops: r.ops, result: { changes: r.changes.slice(0, 200) } };
    })),

    tool("proto_from_screenshot", "Starts rebuilding a screenshot or picture attached in this chat as an editable design: places it as a locked, half-transparent reference layer, adds an empty frame of the same size next to it to build into, and returns its dominant colors and recognized text (local text recognition engine where installed) as hints. Then build the structure with proto_create (auto layout, real text) inside that frame and compare with proto_screenshot compare=<reference id>. One undo step.", {
      attachment: S.str("Name of an attached image (default: the only one)"), index: S.num("Number of the attachment (1 = first)", { minimum: 1 }),
      width: S.num("Design width of the frame in px (for example 390 for a 3x phone screenshot); default: the image width", { minimum: 16, maximum: 10000 }),
      frame: S.bool("Also create the empty frame to build into (default true)"),
    }, [], async (a) => {
      const list = ctx.attachments?.() || [];
      const imgs = list.filter((f) => /^image\/(png|jpeg|gif|webp|avif)/.test(f.type || "") || /\.(png|jpe?g|gif|webp|avif)$/i.test(f.name || ""));
      if (!imgs.length) throw new Error("No image is attached in this chat. Ask the user to attach the screenshot with the paperclip button.");
      const f = a.index ? list[a.index - 1] : a.attachment ? imgs.find((x) => x.name === a.attachment) || imgs.find((x) => x.name.toLowerCase().includes(String(a.attachment).toLowerCase())) : imgs.length === 1 ? imgs[0] : null;
      if (!f) throw new Error(`Several images are attached: ${imgs.map((x) => x.name).join(", ")}. Pass attachment.`);
      const R = await rt();
      const img = await R.readImage(f);
      if (!img.w || !img.h) throw new Error(`“${img.name}” is not a PNG, JPEG or GIF image this tool can read.`);
      const k = a.width ? a.width / img.w : 1;
      const W = Math.round(img.w * k);
      const H = Math.round(img.h * k);
      const hints = await R.imageHints(img.bytes, img.mime);
      const r = await edit(app, "Reference from screenshot", async (m, t, A) => {
        const { newId } = await import("../../engine/proto/ids.js");
        const mediaId = newId("m", m.media || {});
        const page = t.page;
        const specs = [{ type: "image", name: `Reference: ${img.name}`.slice(0, 120), w: W, h: H, locked: true, opacity: 0.5, alt: "Reference screenshot", fills: [{ type: "image", media: mediaId, fit: "fill" }] }];
        if (a.frame !== false) specs.push({ type: "frame", name: "Rebuilt screen", w: W, h: H, layout: { type: "flex", dir: "column" }, fill: hints.palette?.[0]?.color || "#ffffff" });
        const c = A.createOps(m, specs, { page });
        return { ops: [{ op: "media.put", id: mediaId, media: { mime: img.mime, name: img.name, w: img.w, h: img.h, bytes: img.bytes } }, ...c.ops], result: { reference: c.ids[0], frame: a.frame !== false ? c.ids[1] : null, media: mediaId, size: `${W} × ${H}` } };
      });
      return { ...r, ...hints, next: "Look at the attached image, build the screen inside the frame with proto_create (auto layout, real text, these colors), then proto_screenshot with compare set to the reference id, and correct. Delete the reference layer when done." };
    }),
  ];
}

const isObjLike = (v) => !!v && typeof v === "object" && !Array.isArray(v);
