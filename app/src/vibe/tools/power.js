// Power tools for the Vibe assistant (group "Power tools"): fewer round trips, richer reads, more freedom.
//   run_plan        many tool calls in ONE model turn, with {"$ref":"step.path"} references, one approval, one undo step
//   query_layers    selector/attribute queries over layers -> ids (no list_layers walking)
//   describe_page / describe_selection   natural-language summary + compact scene text, revision-cached ("unchanged")
//   apply_to_many   set_style / transform_layers for every layer a query matches
//   evaluate        sandboxed JavaScript for math, colors and layout computations (read-only openfini.call, no network)
//   screenshot_layers / compare_screenshots     isolated renders and before/after pairs, optional low-res
//   grid_layout / distribute_layers / snap_layers / make_component   layout helpers that replace dozens of calls
// Pure logic lives in ../query.js. The session supplies ctx.lookup (raw tool by name), ctx.policy (approval reason),
// ctx.allowed (skill restriction) and ctx.snapshots (per-chat screenshot store).
import { tool, S, paintSummary, nodeText, nodesById, requireDoc } from "./helpers.js";
import { pageBounds } from "../../core/transform.js";
import { exportRaster } from "../../core/io.js";
import { validateSchema } from "../../ai/agent.js";
import { historyMark, mergeSince } from "../../extensions/history.js";
import { queryFacts, page as pageList, resolveRefs, resultValue, sceneText, gridCells, distribute, nearest } from "../query.js";

const r1 = (n) => Math.round(n * 10) / 10;
const RECT = { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] };
const QUERY_PROPS = {
  selector: S.str('CSS-like selector, e.g. rect[name^="Card"][w>100], text[text*="sale"] (ops = != *= ^= $= > >= < <=; = accepts globs)'),
  type: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Layer type(s): rect, ellipse, polygon, star, path, text, group, image, pixel, table, chart, adjust" },
  name: S.str("Name glob, e.g. “Card*”"),
  fill: S.str("Fill color #rrggbb"),
  text: S.str("Text contains (case-insensitive)"),
  within: { ...RECT, description: "Only layers fully inside this page-space rectangle" },
  intersects: { ...RECT, description: "Only layers overlapping this rectangle" },
  parent: S.str("Only descendants of this group id"),
  visible: S.bool("Only visible (true) or hidden (false) layers"),
  locked: S.bool("Only locked (true) or unlocked (false) layers"),
};
const QUERY_KEYS = Object.keys(QUERY_PROPS);

function b64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Facts of every layer of a page (flat list and tree). */
export function pageFacts(app, page, { maxText = 120 } = {}) {
  const doc = app.doc;
  const flat = [];
  const visit = (n, parent, depth, ancestors) => {
    let b = null;
    try {
      b = pageBounds(n);
    } catch {
      /* no geometry */
    }
    const f = { id: n.id, type: n.type, name: n.name || "", depth, parentId: parent?.id ?? null, ancestors, visible: n.visible !== false, locked: !!n.locked };
    if (b) Object.assign(f, { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) });
    if ("fill" in n && n.fill) f.fill = paintSummary(n.fill);
    if ("stroke" in n && n.stroke?.fill) f.stroke = `${paintSummary(n.stroke.fill)}/${n.stroke.width}`;
    if (n.type === "text") f.text = nodeText(doc, n).slice(0, maxText);
    if (n.opacity != null && n.opacity < 1) f.opacity = n.opacity;
    flat.push(f);
    if (n.children?.length) {
      f.childCount = n.children.length;
      f.children = [...n.children].reverse().map((c) => visit(c, n, depth + 1, [...ancestors, n.id]));
    }
    return f;
  };
  const tree = [...page.root.children].reverse().map((c) => visit(c, null, 0, []));
  return { flat, tree };
}

function strip(f, fields) {
  const { children, ancestors, depth, ...rest } = f;
  void children;
  void ancestors;
  void depth;
  return fields?.length ? Object.fromEntries(fields.filter((k) => k in rest).map((k) => [k, rest[k]])) : rest;
}

function summarize(flat, page) {
  const byType = {};
  const colors = new Map();
  for (const f of flat) {
    byType[f.type] = (byType[f.type] || 0) + 1;
    if (f.fill && /^#/.test(f.fill)) colors.set(f.fill.slice(0, 7), (colors.get(f.fill.slice(0, 7)) || 0) + 1);
  }
  const texts = flat.filter((f) => f.text).slice(0, 6).map((f) => `“${f.text.slice(0, 40)}”`);
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${t}${n === 1 ? "" : "s"}`).join(", ");
  const pal = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]).join(", ");
  const hidden = flat.filter((f) => !f.visible).length;
  const outside = flat.filter((f) => f.w != null && f.depth === 0 && (f.x + f.w < 0 || f.y + f.h < 0 || f.x > page.w || f.y > page.h)).length;
  return [`Page “${page.name}” ${Math.round(page.w)}x${Math.round(page.h)} px${page.bg ? `, background ${page.bg}` : ", transparent"}: ${flat.length ? types : "empty"}.`, pal ? `Main colors: ${pal}.` : "", texts.length ? `Text: ${texts.join(", ")}${flat.filter((f) => f.text).length > 6 ? " …" : ""}.` : "", hidden ? `${hidden} hidden layer(s).` : "", outside ? `${outside} top-level layer(s) lie completely outside the page.` : ""].filter(Boolean).join(" ");
}

export function powerTools(app, ctx) {
  const lookup = (name) => {
    const t = ctx.lookup?.(name);
    if (!t) throw new Error(`Unknown tool “${name}”.${ctx.toolNames ? ` Did you mean: ${nearest(name, ctx.toolNames()).join(", ")}?` : ""}`);
    return t;
  };
  const resolveTargets = (a) => {
    if (a.ids?.length) return nodesById(app, a.ids).map((n) => n.id);
    const q = a.query || {};
    if (!Object.keys(q).length) throw new Error("Give ids or a query (selector, type, name, fill, text, within, parent …).");
    const doc = requireDoc(app);
    const pg = (a.pageId && doc.page(a.pageId)) || app.page;
    return queryFacts(pageFacts(app, pg).flat, q).map((f) => f.id);
  };
  const render = async (area, { maxSize = 768, lowRes = false, pageObj } = {}) => {
    const pg = pageObj || app.page;
    const max = lowRes ? Math.min(maxSize, 320) : maxSize;
    const k = Math.min(4, max / Math.max(area.w, area.h));
    const r = await exportRaster(app, { page: pg, format: lowRes ? "jpeg" : "png", quality: 0.7, scale: k, area });
    return { image: { type: "image", mime: lowRes ? "image/jpeg" : "image/png", data: b64(r.bytes) }, width: r.width, height: r.height };
  };
  const revisionGate = (a, key) => {
    const doc = requireDoc(app);
    const rev = `${doc.id}:${doc.rev}:${key}`;
    if (a.since && a.since === rev) return { unchanged: true, revision: rev, note: "Nothing changed since that revision; reuse your earlier reading." };
    return rev;
  };

  const T = [
    tool("run_plan", 'Runs an ordered list of tool calls in ONE turn (much faster than one call per turn). Later steps can use earlier results with {"$ref": "<step id>.<path>"} (e.g. {"$ref":"bg.id"}, {"$ref":"cards.ids"}; a $ref to an array inside an array of ids splices in). One approval covers the whole plan and the user can undo it as one step. Use it when you already know the steps; inspect results only where you need them.', {
      steps: { type: "array", minItems: 1, maxItems: 60, description: "Steps in order", items: { type: "object", properties: { id: { type: "string", description: "Name for $ref (default: its 1-based index)" }, tool: { type: "string" }, args: { type: "object" } }, required: ["tool"] } },
      stopOnError: S.bool("Stop at the first failing step (default true)"),
      label: S.str("Undo label, e.g. “Build pricing cards”"),
    }, ["steps"], async (a, c) => {
      const results = {};
      const out = [];
      const doc0 = app.doc;
      const mark = doc0 ? historyMark(doc0.history) : null;
      let failed = 0;
      for (let i = 0; i < a.steps.length; i++) {
        const s = a.steps[i];
        const sid = s.id || String(i + 1);
        if (c?.signal?.aborted) {
          out.push({ id: sid, tool: s.tool, ok: false, error: "Aborted." });
          break;
        }
        try {
          if (s.tool === "run_plan" || s.tool === "ask_user") throw new Error(`${s.tool} cannot run inside run_plan.`);
          if (ctx.allowed && !ctx.allowed(s.tool)) throw new Error(`“${s.tool}” is not allowed while the active skill restricts tools.`);
          const t = lookup(s.tool);
          const args = resolveRefs(s.args || {}, results);
          const problems = validateSchema(args, t.inputSchema, "args");
          if (problems.length) throw new Error(`Invalid args for ${s.tool}: ${problems.slice(0, 4).join("; ")}`);
          const r = await t.run(args, { ...(c || {}), id: `${c?.id || "plan"}.${sid}`, name: s.tool });
          const v = resultValue(r);
          results[sid] = v;
          results[String(i + 1)] = v;
          out.push({ id: sid, tool: s.tool, ok: true, result: typeof v === "string" ? v.slice(0, 300) : v });
        } catch (err) {
          failed++;
          out.push({ id: sid, tool: s.tool, ok: false, error: String(err?.message || err) });
          if (a.stopOnError !== false) break;
        }
      }
      let merged = 0;
      if (doc0 && app.doc === doc0) {
        merged = mergeSince(doc0.history, mark, a.label || "AI: Plan");
        const top = doc0.history.entries[doc0.history.index - 1];
        if (merged && top && doc0.history.tag && !top.tag) top.tag = doc0.history.tag;
      }
      const json = JSON.stringify(out);
      const steps = json.length > 30000 ? out.map((x) => ({ id: x.id, tool: x.tool, ok: x.ok, ...(x.error ? { error: x.error } : {}), ...(x.result && typeof x.result === "object" && x.result.id ? { id_: x.result.id } : {}) })) : out;
      return { ok: !failed, completed: out.filter((x) => x.ok).length, of: a.steps.length, failed, steps, undo: merged ? "one history step" : "per step" };
    }, {
      needsApproval: (a) => {
        const needs = [];
        for (const s of a.steps || []) {
          const r = ctx.policy?.(s.tool, s.args || {});
          if (r) needs.push(s.tool);
        }
        if (!needs.length) return false;
        const list = (a.steps || []).slice(0, 20).map((s, i) => `${i + 1}. ${s.tool}`).join("\n");
        return `Run a plan of ${a.steps.length} steps (${[...new Set(needs)].join(", ")} need approval):\n${list}${a.steps.length > 20 ? "\n…" : ""}`;
      },
    }),

    tool("query_layers", "Finds layers by selector or attributes and returns their ids (and requested fields). Far cheaper than list_layers when you know what you are looking for. Results are paged (limit/offset).", {
      ...QUERY_PROPS,
      pageId: S.str("Page id (default: active page)"),
      fields: { type: "array", items: { type: "string", enum: ["id", "type", "name", "x", "y", "w", "h", "fill", "stroke", "text", "visible", "locked", "opacity", "parentId", "childCount"] }, description: "Fields to return (default id, type, name, x, y, w, h)" },
      limit: S.num("Max results (default 50)", { minimum: 1, maximum: 500 }), offset: S.num("Skip this many results", { minimum: 0 }),
    }, [], (a) => {
      const doc = requireDoc(app);
      const pg = (a.pageId && doc.page(a.pageId)) || app.page;
      if (a.pageId && !doc.page(a.pageId)) throw new Error(`No page “${a.pageId}”. Pages: ${doc.pages.map((p) => p.id).join(", ")}.`);
      const q = Object.fromEntries(QUERY_KEYS.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
      const hits = queryFacts(pageFacts(app, pg).flat, q);
      const p = pageList(hits.map((f) => strip(f)), { offset: a.offset, limit: a.limit, fields: a.fields || ["id", "type", "name", "x", "y", "w", "h"] });
      return { total: p.total, ids: p.items.map((x) => x.id).filter(Boolean), layers: p.items, ...(p.more ? { more: true, next: { offset: p.offset + p.limit } } : {}) };
    }, { readOnly: true }),

    tool("describe_page", "Summarizes a page in plain language (layer counts, colors, text, problems) plus a compact scene graph: one line per layer “id type \"name\" x,y wxh fill=… text=…”. Pass `since` with the revision you got last time to get “unchanged” cheaply.", {
      pageId: S.str("Page id (default: active page)"), maxDepth: S.num("Group levels to expand (default 4)", { minimum: 0, maximum: 10 }),
      maxLines: S.num("Max scene lines (default 300)", { minimum: 10, maximum: 2000 }), since: S.str("Revision from an earlier describe_page"),
    }, [], (a) => {
      const doc = requireDoc(app);
      const pg = (a.pageId && doc.page(a.pageId)) || app.page;
      const gate = revisionGate(a, `page:${pg.id}`);
      if (typeof gate === "object") return gate;
      const { flat, tree } = pageFacts(app, pg);
      return { revision: gate, page: { id: pg.id, name: pg.name, width: Math.round(pg.w), height: Math.round(pg.h) }, summary: summarize(flat, pg), layers: flat.length, scene: sceneText(tree, { maxDepth: a.maxDepth ?? 4, maxLines: a.maxLines ?? 300 }) };
    }, { readOnly: true }),

    tool("describe_selection", "Describes the selected layers: summary, union bounds and compact scene lines (see describe_page).", { since: S.str("Revision from an earlier call") }, [], (a) => {
      const doc = requireDoc(app);
      const sel = app.selection;
      const gate = revisionGate(a, `sel:${sel.map((n) => n.id).join(",")}`);
      if (typeof gate === "object") return gate;
      if (!sel.length) return { revision: gate, selection: [], summary: "Nothing is selected." };
      const { flat, tree } = pageFacts(app, app.page);
      const ids = new Set(sel.map((n) => n.id));
      const picked = flat.filter((f) => ids.has(f.id));
      const xs = picked.filter((f) => f.w != null);
      const bounds = xs.length ? { x: Math.min(...xs.map((f) => f.x)), y: Math.min(...xs.map((f) => f.y)) } : null;
      if (bounds) Object.assign(bounds, { w: r1(Math.max(...xs.map((f) => f.x + f.w)) - bounds.x), h: r1(Math.max(...xs.map((f) => f.y + f.h)) - bounds.y) });
      const sub = [];
      const find = (list) => list.forEach((f) => (ids.has(f.id) ? sub.push(f) : f.children && find(f.children)));
      find(tree);
      void doc;
      return { revision: gate, count: sel.length, bounds, summary: summarize(picked, { ...app.page, name: "selection" }).replace(/^Page “selection”[^:]*:/, "Selection:"), scene: sceneText(sub, { maxDepth: 3 }) };
    }, { readOnly: true }),

    tool("apply_to_many", "Applies one style and/or transform to every layer matched by `query` (or listed in `ids`) in a single undo step. style takes set_style fields (fill, stroke, opacity, fontSize, text …); transform takes transform_layers fields (dx, dy, scale, rotate, w, h …).", {
      query: { type: "object", properties: QUERY_PROPS, description: "Same fields as query_layers" },
      ids: S.ids("Layer ids (instead of a query)"),
      style: { type: "object", description: "set_style fields without ids" },
      transform: { type: "object", description: "transform_layers fields without ids" },
      pageId: S.str("Page for the query (default: active)"),
      dryRun: S.bool("Only return the ids that would change"),
    }, [], async (a, c) => {
      const ids = resolveTargets(a);
      if (!ids.length) return { matched: 0, note: "Nothing matched the query; loosen it (check with query_layers)." };
      if (a.dryRun) return { matched: ids.length, ids };
      if (!a.style && !a.transform) throw new Error("Give style and/or transform.");
      const doc = requireDoc(app);
      const run = async () => {
        if (a.style) await lookup("set_style").run({ ...a.style, ids }, c);
        if (a.transform) await lookup("transform_layers").run({ ...a.transform, ids }, c);
      };
      const mark = historyMark(doc.history);
      await run();
      if (app.doc === doc) {
        mergeSince(doc.history, mark, "AI: Apply to many");
        const top = doc.history.entries[doc.history.index - 1];
        if (top && doc.history.tag && !top.tag) top.tag = doc.history.tag;
      }
      return { matched: ids.length, ids: ids.slice(0, 200) };
    }),

    tool("evaluate", "Runs a short JavaScript snippet in a sandbox (no network, no DOM of the app, time-limited) for math, color conversions, layout grids or data shaping. The snippet is an async function body with (args, openfini); `await openfini.call(name, args)` may call READ-ONLY OpenFini tools (e.g. query_layers). Return a JSON-serializable value. Use it instead of doing arithmetic in your head.", {
      code: S.str("Function body, e.g. const cols = 3; return Array.from({length: cols}, (_, i) => 80 + i * 320);"),
      args: { type: "object", description: "Values passed in as `args`" },
      timeoutSeconds: S.num("Time limit (default 5, max 20)", { minimum: 1, maximum: 20 }),
    }, ["code"], async (a) => {
      if (typeof document === "undefined") throw new Error("evaluate needs the app window.");
      const { runCustomTool } = await import("../custom-tools.js");
      const logs = [];
      const result = await runCustomTool({ name: "evaluate", code: a.code }, a.args || {}, async (name, args) => {
        const t = lookup(name);
        if (!t.readOnly) throw new Error(`evaluate may only call read-only tools; “${name}” changes the document. Return the values and call the tool yourself (or use run_plan).`);
        if (ctx.allowed && !ctx.allowed(name)) throw new Error(`“${name}” is not allowed while the active skill restricts tools.`);
        return resultValue(await t.run(args, {}));
      }, { timeoutMs: (a.timeoutSeconds || 5) * 1000, onLog: (s) => logs.length < 50 && logs.push(s), isolated: true });
      return { result, ...(logs.length ? { logs } : {}) };
    }, { readOnly: true }),

    tool("screenshot_layers", "Renders only the given layers (everything else hidden) cropped to their bounds, to check a detail without the rest of the page. lowRes saves tokens.", {
      ids: S.ids(), padding: S.num("Extra space around in px (default 16)", { minimum: 0 }), maxSize: S.num("Longest side (default 512)", { minimum: 64, maximum: 1600 }), lowRes: S.bool("Small JPEG (about 4x cheaper)"),
    }, ["ids"], async (a) => {
      const nodes = nodesById(app, a.ids);
      const doc = app.doc;
      const pg = doc.pageOf(nodes[0]) || app.page;
      const keep = new Set();
      const anc = new Set();
      for (const n of nodes) {
        const stack = [n];
        while (stack.length) {
          const x = stack.pop();
          keep.add(x);
          if (x.children) stack.push(...x.children);
        }
        for (let p = n._parent; p; p = p._parent) anc.add(p);
      }
      const hidden = [];
      const hide = (n) => {
        for (const c of n.children || []) {
          if (keep.has(c)) continue;
          if (anc.has(c)) hide(c);
          else if (c.visible !== false) {
            c.visible = false;
            hidden.push(c);
            doc.touch(c);
          }
        }
      };
      let shot;
      try {
        hide(pg.root);
        const bs = nodes.map((n) => pageBounds(n)).filter(Boolean);
        const pad = a.padding ?? 16;
        const x = Math.min(...bs.map((b) => b.x)) - pad;
        const y = Math.min(...bs.map((b) => b.y)) - pad;
        const area = { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) + pad - x, h: Math.max(...bs.map((b) => b.y + b.h)) + pad - y };
        shot = await render(area, { maxSize: a.maxSize || 512, lowRes: a.lowRes, pageObj: pg });
        shot.area = area;
      } finally {
        for (const c of hidden) {
          c.visible = true;
          doc.touch(c);
        }
        app.emit("render");
      }
      return [{ type: "text", text: `${nodes.length} layer(s) isolated, area ${Math.round(shot.area.w)}x${Math.round(shot.area.h)} at ${Math.round(shot.area.x)},${Math.round(shot.area.y)}, shown at ${shot.width}x${shot.height}.` }, shot.image];
    }, { readOnly: true, exclusive: true }),

    tool("compare_screenshots", "Before/after check: action “save” stores a render of the page (or region) under a name; action “compare” renders it again and returns both images side by side in one result, so you can verify what your edits changed.", {
      action: S.str("save or compare", { enum: ["save", "compare"] }), name: S.str("Snapshot name (default “before”)"),
      x: S.num("Region x"), y: S.num("Region y"), w: S.num("Region width"), h: S.num("Region height"), lowRes: S.bool("Small JPEGs (cheaper)"),
    }, ["action"], async (a) => {
      requireDoc(app);
      const pg = app.page;
      const key = a.name || "before";
      const snaps = (ctx.snapshots ||= new Map());
      const area = a.w && a.h ? { x: a.x ?? 0, y: a.y ?? 0, w: a.w, h: a.h } : snaps.get(key)?.area || { x: 0, y: 0, w: pg.w, h: pg.h };
      const shot = await render(area, { maxSize: 512, lowRes: a.lowRes });
      if (a.action === "save") {
        snaps.set(key, { ...shot, area, page: pg.id, time: Date.now() });
        if (snaps.size > 6) snaps.delete(snaps.keys().next().value);
        return { saved: key, note: "Call compare_screenshots with action “compare” after your edits." };
      }
      const before = snaps.get(key);
      if (!before) throw new Error(`No snapshot “${key}”. Saved: ${[...snaps.keys()].join(", ") || "none"}. Call it with action “save” first.`);
      return [{ type: "text", text: `Before (“${key}”, ${Math.round((Date.now() - before.time) / 1000)} s ago):` }, before.image, { type: "text", text: "After (now):" }, shot.image];
    }, { readOnly: true }),

    tool("grid_layout", "Arranges layers in a grid inside an area (columns, rows, gap) in one undo step: each layer is placed in its cell (fit: center keeps size, stretch fills the cell, fit scales down to fit). Default area: the page minus 64 px margins.", {
      ids: S.ids("Layers in order (row by row)"), query: { type: "object", properties: QUERY_PROPS, description: "Instead of ids (sorted top-to-bottom, left-to-right)" },
      area: { ...RECT, description: "Page-space area" }, columns: S.num("Columns", { minimum: 1, maximum: 50 }), rows: S.num("Rows (default: as needed)", { minimum: 1, maximum: 50 }),
      gap: S.num("Gap px (default 24)", { minimum: 0 }), rowGap: S.num("Row gap px", { minimum: 0 }), fit: S.str("center | stretch | fit (default center)", { enum: ["center", "stretch", "fit"] }),
    }, ["columns"], (a, c) => {
      const doc = requireDoc(app);
      let ids = resolveTargets(a);
      if (!a.ids?.length) {
        const facts = new Map(pageFacts(app, app.page).flat.map((f) => [f.id, f]));
        ids = ids.sort((p, q) => facts.get(p).y - facts.get(q).y || facts.get(p).x - facts.get(q).x);
      }
      const pg = app.page;
      const area = a.area || { x: 64, y: 64, w: pg.w - 128, h: pg.h - 128 };
      const cells = gridCells({ ...area, columns: a.columns, rows: a.rows, gap: a.gap ?? 24, rowGap: a.rowGap, count: ids.length });
      const nodes = nodesById(app, ids);
      const tr = lookup("transform_layers");
      doc.tx("AI: Grid layout", () => {
        nodes.forEach((n, i) => {
          const cell = cells[i];
          const b = pageBounds(n);
          if (!cell || !b) return;
          if (a.fit === "stretch") tr.run({ ids: [n.id], x: cell.x, y: cell.y, w: cell.w, h: cell.h }, c);
          else {
            const k = a.fit === "fit" ? Math.min(1, cell.w / b.w, cell.h / b.h) : 1;
            const w = b.w * k;
            const h = b.h * k;
            tr.run({ ids: [n.id], x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2, w, h }, c);
          }
        });
      });
      return { placed: Math.min(nodes.length, cells.length), cells: cells.slice(0, nodes.length).map((x) => ({ x: r1(x.x), y: r1(x.y), w: r1(x.w), h: r1(x.h) })) };
    }),

    tool("distribute_layers", "Distributes layers along x or y with equal spacing (keeps the first and last in place) or with an exact gap, in one undo step.", {
      ids: S.ids(), axis: S.str("x or y", { enum: ["x", "y"] }), gap: S.num("Exact gap in px (optional)"),
    }, ["ids", "axis"], (a, c) => {
      const nodes = nodesById(app, a.ids);
      const boxes = nodes.map((n) => pageBounds(n));
      const pos = distribute(boxes, a.axis, a.gap);
      const tr = lookup("transform_layers");
      app.doc.tx("AI: Distribute", () => nodes.forEach((n, i) => tr.run({ ids: [n.id], [a.axis]: pos[i] }, c)));
      return { ok: true, positions: pos.map(r1) };
    }),

    tool("snap_layers", "Snaps the position (and optionally the size) of layers to a grid, e.g. 8 px, in one undo step.", {
      ids: S.ids(), grid: S.num("Grid size in px (default 8)", { minimum: 1 }), size: S.bool("Also round width and height"),
    }, ["ids"], (a, c) => {
      const g = a.grid || 8;
      const nodes = nodesById(app, a.ids);
      const tr = lookup("transform_layers");
      const snap = (v) => Math.round(v / g) * g;
      app.doc.tx("AI: Snap", () => nodes.forEach((n) => {
        const b = pageBounds(n);
        if (b) tr.run({ ids: [n.id], x: snap(b.x), y: snap(b.y), ...(a.size ? { w: Math.max(g, snap(b.w)), h: Math.max(g, snap(b.h)) } : {}) }, c);
      }));
      return { ok: true, snapped: nodes.length };
    }),

    tool("make_component", "Turns layers into a named group (a reusable “component”) and optionally makes copies with offsets and overrides in one call. overrides map a child layer NAME to set_style fields (e.g. {\"Title\": {\"text\": \"Pro\"}, \"Bg\": {\"fill\": \"#111827\"}}).", {
      ids: S.ids("Layers that form the component"), name: S.str("Component name"),
      copies: { type: "array", maxItems: 40, items: { type: "object", properties: { dx: { type: "number" }, dy: { type: "number" }, name: { type: "string" }, overrides: { type: "object" } } }, description: "Copies to make, each offset from the original" },
    }, ["ids", "name"], async (a, c) => {
      requireDoc(app);
      const g = await lookup("group_layers").run({ ids: a.ids, name: a.name }, c);
      const gid = g?.id;
      if (!gid) throw new Error("Grouping failed; check that the layers are on the same page and unlocked.");
      const copies = [];
      for (const cp of a.copies || []) {
        const d = await lookup("duplicate_layers").run({ ids: [gid], offset: 0 }, c);
        const cid = d?.ids?.[0];
        if (!cid) continue;
        if (cp.dx || cp.dy) await lookup("transform_layers").run({ ids: [cid], dx: cp.dx || 0, dy: cp.dy || 0 }, c);
        if (cp.name) await lookup("set_style").run({ ids: [cid], name: cp.name }, c);
        const missing = [];
        for (const [child, style] of Object.entries(cp.overrides || {})) {
          const hits = queryFacts(pageFacts(app, app.page).flat, { parent: cid, name: child }).map((f) => f.id);
          if (!hits.length) missing.push(child);
          else await lookup("set_style").run({ ...style, ids: hits }, c);
        }
        copies.push({ id: cid, ...(missing.length ? { missingOverrides: missing } : {}) });
      }
      return { component: gid, copies };
    }),
  ];
  return T;
}
