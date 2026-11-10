// Scripting and checks (group "Scripting and checks"). See docs/adr/0028-vibe-code-mode.md.
//   run_script     code mode: a JavaScript function body in a locked-down worker; openfini.<tool>(args) runs tools,
//                  all document edits fold into ONE undo step; dryRun reverts them and returns the structural diff
//   find_tools     tool search with TypeScript-like signatures (the typed API of run_script)
//   checkpoint / restore_checkpoint   named states of the document: save, list, diff, delete; undo back to one
//   visual_diff    pixel comparison of a checkpoint's render with the page now (changed regions in page px)
//   measure_layers bounds, gaps, overlaps, shared edges, equal spacing and text contrast
//   find_replace   text, colors and fonts across one page or the whole document, formatting kept
// Pure logic lives in ../script-lib.js. The session supplies ctx.lookup, ctx.allowed, ctx.toolNames (see power.js).
import { tool, S, nodesById, requireDoc, cssToHex } from "./helpers.js";
import { pageBounds } from "../../core/transform.js";
import { validateSchema } from "../../ai/agent.js";
import { historyMark, mergeSince } from "../../extensions/history.js";
import { resultValue, nearest, queryFacts } from "../query.js";
import { pageFacts } from "./power.js";

const r1 = (n) => Math.round(n * 10) / 10;

/** Tools a script may never call: nested code, user prompts and orchestration. */
export const SCRIPT_BLOCKED = new Set(["run_script", "run_plan", "evaluate", "run_code", "create_tool", "create_skill", "ask_user", "spawn_agent", "wait_agent", "cancel_agent", "plan_work", "work_task"]);
/** Groups whose write tools record everything in the document history, so a dry run can revert them exactly. */
export const DRY_RUN_GROUPS = ["Layers and vector", "Tables and charts", "Power tools", "Scripting and checks"];
const DRY_RUN_BLOCKED = new Set(["add_page", "reorder_pages", "import_svg"]);

function b64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Flat facts of every page of the document, with the page id on each fact. */
function docFacts(app, doc, opts) {
  return doc.pages.flatMap((pg) => pageFacts(app, pg, opts).flat.map((f) => ({ ...f, page: pg.id })));
}

/** Position in the history after `entry` (0 for the start), or -1 when the entry was trimmed away. */
function historyPos(history, entry) {
  if (!entry) return 0;
  const i = history.entries.indexOf(entry);
  return i < 0 ? -1 : i + 1;
}

export function scriptTools(app, ctx) {
  const lookup = (name) => {
    const t = ctx.lookup?.(name);
    if (!t) throw new Error(`Unknown tool “${name}”.${ctx.toolNames ? ` Did you mean: ${nearest(name, ctx.toolNames()).join(", ")}? find_tools lists what exists.` : ""}`);
    return t;
  };
  const lib = () => import("../script-lib.js");
  // index.js imports this file, so the group table is read lazily (no static import cycle)
  const toolGroups = async () => (await import("./index.js")).TOOL_GROUPS;
  const groupOf = async () => {
    const m = new Map();
    for (const [g, names] of Object.entries(await toolGroups())) for (const n of names) m.set(n, g);
    return m;
  };
  const checkpoints = () => (ctx.checkpoints ||= new Map());
  const renderPage = async (pg, area, maxSize = 640) => {
    const { exportRaster } = await import("../../core/io.js");
    const k = Math.min(2, maxSize / Math.max(area.w, area.h));
    const r = await exportRaster(app, { page: pg, format: "png", scale: k, area });
    return { bytes: r.bytes, width: r.width, height: r.height, area, page: pg.id, scale: k };
  };

  /** The gate every openfini.call of a script goes through. */
  const scriptCall = (c, { dryRun, groups }) => async (name, args) => {
    if (c?.signal?.aborted) throw new Error("Aborted.");
    if (SCRIPT_BLOCKED.has(name)) throw new Error(`${name} cannot run inside run_script.`);
    if (ctx.allowed && !ctx.allowed(name)) throw new Error(`“${name}” is not allowed while the active skill restricts tools.`);
    const t = lookup(name);
    const problems = validateSchema(args || {}, t.inputSchema, "args");
    if (problems.length) throw new Error(`Invalid args for ${name}: ${problems.slice(0, 4).join("; ")}`);
    if (!t.readOnly) {
      if (t.alwaysAsk || t.needsApproval?.(args || {})) throw new Error(`“${name}” needs the user's approval for each call, so it cannot run inside a script. Return the values and call ${name} directly.`);
      if (dryRun && (!DRY_RUN_GROUPS.includes(groups.get(name)) || DRY_RUN_BLOCKED.has(name))) throw new Error(`“${name}” cannot be dry-run (its changes are not recorded in the document history). Dry runs cover layer, table, chart and layout tools.`);
    }
    return resultValue(await t.run(args || {}, { ...(c || {}), id: `${c?.id || "script"}.${name}`, name }));
  };

  return [
    tool("run_script", "Code mode: runs a JavaScript function body that drives OpenFini, for work that needs loops, conditions or computed values (hundreds of precise edits in one call). Inside, `await openfini.<tool_name>(args)` (or openfini.call(name, args)) runs any tool and returns its parsed result; `args` holds your args; console.log output is returned; `return` gives the result (JSON). The script runs in an isolated worker: no network, no DOM, no storage, no imports, stopped when it computes longer than the time limit. All document edits fold into ONE undo step. dryRun: true runs it, returns the structural diff (layers added, removed, changed) and reverts everything; use it before large changes. Tools that ask the user every time (web, local files, terminal, publishing) and nested scripts are refused inside. Use find_tools for the signatures. Example: const { ids } = await openfini.query_layers({ type: \"text\" }); for (const id of ids) await openfini.set_style({ ids: [id], fontSize: 18 }); return ids.length;", {
      code: S.str("Function body. `args` and `openfini` are in scope; use await and return."),
      args: { type: "object", description: "Values passed to the script as `args`" },
      dryRun: S.bool("Run, report the diff, then revert every change (layer, table, chart and layout tools only)"),
      label: S.str("Undo label, e.g. “Renumber cards”"),
      timeoutSeconds: S.num("Compute time limit, tool time not counted (default 10, max 60)", { minimum: 1, maximum: 60 }),
    }, ["code"], async (a, c) => {
      if (typeof Worker === "undefined" && !ctx.createWorker) throw new Error("run_script needs Web Workers, which are not available here.");
      const { runScript, diffFacts } = await lib();
      const doc0 = app.doc;
      const mark = doc0 ? historyMark(doc0.history) : null;
      const before = a.dryRun && doc0?.pages ? docFacts(app, doc0) : null;
      if (a.dryRun && !before) throw new Error("dryRun needs an open canvas document.");
      let out = null;
      let error = null;
      try {
        out = await runScript(a.code, { args: a.args || {}, timeoutMs: (a.timeoutSeconds || 10) * 1000, call: scriptCall(c, { dryRun: !!a.dryRun, groups: await groupOf() }), createWorker: ctx.createWorker });
      } catch (err) {
        error = err;
      }
      const calls = out?.calls || error?.calls || [];
      const summary = { toolCalls: calls.length, failedCalls: calls.filter((x) => !x.ok).length, byTool: Object.entries(calls.reduce((m, x) => ((m[x.name] = (m[x.name] || 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join(", ") || "none" };
      let undo = "nothing changed";
      let diff = null;
      if (doc0 && app.doc === doc0) {
        const h = doc0.history;
        if (a.dryRun) {
          diff = diffFacts(before, docFacts(app, doc0));
          const start = historyPos(h, mark.before);
          if (start < 0) undo = "could not revert: the history was trimmed; use undo";
          else {
            while (h.index > start && doc0.undo()) { /* revert the script's entries */ }
            for (const e of h.entries.splice(h.index)) h.bytes -= e.bytes || 0;
            h.emit?.("change", h);
            app.emit("render");
            undo = "reverted (dry run)";
          }
        } else if (h.index > historyPos(h, mark.before) && historyPos(h, mark.before) >= 0) {
          const merged = mergeSince(h, mark, a.label || "AI: Script");
          const top = h.entries[h.index - 1];
          if (top && h.tag && !top.tag) top.tag = h.tag;
          undo = merged || top ? "one history step" : "per step";
        }
      } else if (doc0 !== app.doc) undo = "the script switched documents; undo per document";
      if (error) {
        const kept = a.dryRun ? "" : summary.toolCalls ? ` ${summary.toolCalls - summary.failedCalls} tool call(s) had already succeeded and stay applied as ${undo}; call undo to revert them.` : "";
        throw new Error(`The script failed: ${String(error.message).replace(/\.?$/, ".")}${kept}`);
      }
      return { ok: true, result: out.result, ...(out.logs.length ? { logs: out.logs.slice(0, 100) } : {}), ...summary, ms: out.ms, undo, ...(diff ? { dryRun: true, diff } : {}) };
    }),

    tool("find_tools", "Searches the tool set by what you want to do and returns matching tools as TypeScript-like signatures (parameter names, types, enums, required marks), the reference for run_script and run_plan. Give a query, a group, or exact names; without arguments it lists the groups with their tool names.", {
      query: S.str("What you want to do, e.g. “align text”, “spreadsheet formula”"),
      group: S.str("Only this group (part of its name is enough), e.g. Whiteboard"),
      names: { type: "array", items: { type: "string" }, description: "Exact tool names to describe in full" },
      limit: S.num("Max results (default 12)", { minimum: 1, maximum: 40 }),
    }, [], async (a) => {
      const { tsSignature, searchTools } = await lib();
      const TOOL_GROUPS = await toolGroups();
      const all = (ctx.toolNames?.() || []).map((n) => ctx.lookup(n)).filter(Boolean);
      if (a.names?.length) return { tools: a.names.map((n) => tsSignature(lookup(n), { full: true })).join("\n\n") };
      if (!a.query && !a.group) return { groups: Object.fromEntries(Object.entries(TOOL_GROUPS).map(([g, names]) => [g, names.join(", ")])), note: "Call find_tools with a query, a group or names for signatures." };
      const hits = searchTools(all, a.query, { group: a.group, groups: TOOL_GROUPS, limit: a.limit || 12 });
      if (!hits.length) return { tools: "", note: "Nothing matched. Call find_tools without arguments to see the groups." };
      return { count: hits.length, tools: hits.map((h) => `/* ${h.group}${h.tool.readOnly ? ", read-only" : ""} */ ${tsSignature(h.tool)}`).join("\n") };
    }, { readOnly: true }),

    tool("checkpoint", "Named states of the open document. save remembers the current state (and a render of the active page); diff lists what changed since (layers added, removed, changed fields); list and delete manage them. Save one before risky work, then diff or visual_diff to prove what changed, or restore_checkpoint to go back. Checkpoints live in this chat and rely on the undo history: a checkpoint older than the history limit can no longer be restored.", {
      action: S.str("save, list, diff or delete", { enum: ["save", "list", "diff", "delete"] }),
      name: S.str("Checkpoint name (default “checkpoint”)"),
    }, ["action"], async (a) => {
      const { diffFacts } = await lib();
      const cps = checkpoints();
      const key = a.name || "checkpoint";
      if (a.action === "list") return { checkpoints: [...cps.entries()].map(([name, cp]) => ({ name, document: cp.docName, layers: cp.facts.length, secondsAgo: Math.round((Date.now() - cp.time) / 1000), restorable: app.docs?.includes(cp.doc) !== false && historyPos(cp.doc.history, cp.entry) >= 0 })) };
      if (a.action === "delete") return { deleted: cps.delete(key) };
      const doc = requireDoc(app);
      if (a.action === "save") {
        if (!doc.pages) throw new Error("Checkpoints work for canvas documents (Vector, Pixel, Layout).");
        const cp = { doc, docName: doc.name, entry: doc.history.entries[doc.history.index - 1] || null, facts: docFacts(app, doc), time: Date.now(), shot: null };
        try {
          const pg = app.page;
          cp.shot = await renderPage(pg, { x: 0, y: 0, w: pg.w, h: pg.h });
        } catch {
          /* no renderer here (tests, headless): structural checkpoints still work */
        }
        cps.set(key, cp);
        if (cps.size > 12) cps.delete(cps.keys().next().value);
        return { saved: key, layers: cp.facts.length, render: !!cp.shot };
      }
      const cp = cps.get(key);
      if (!cp) throw new Error(`No checkpoint “${key}”. Saved: ${[...cps.keys()].join(", ") || "none"}.`);
      if (cp.doc !== doc) throw new Error(`Checkpoint “${key}” belongs to the document “${cp.docName}”, which is not the active one.`);
      return { since: key, ...diffFacts(cp.facts, docFacts(app, doc)) };
    }, { readOnly: true, exclusive: true }),

    tool("restore_checkpoint", "Returns the document to a state saved with checkpoint by undoing every later edit (the user can redo them). Use it when an approach failed and you want to start over from a known good state.", {
      name: S.str("Checkpoint name (default “checkpoint”)"),
    }, [], async (a) => {
      const doc = requireDoc(app);
      const key = a.name || "checkpoint";
      const cp = checkpoints().get(key);
      if (!cp) throw new Error(`No checkpoint “${key}”. Saved: ${[...checkpoints().keys()].join(", ") || "none"}.`);
      if (cp.doc !== doc) throw new Error(`Checkpoint “${key}” belongs to the document “${cp.docName}”, which is not the active one.`);
      const pos = historyPos(doc.history, cp.entry);
      if (pos < 0) throw new Error(`Checkpoint “${key}” is older than the undo history and can no longer be restored.`);
      if (doc.history.index < pos) throw new Error(`The document was undone to before checkpoint “${key}”. Call redo first.`);
      const steps = doc.history.index - pos;
      doc.history.goto(pos);
      app.emit("render");
      return { restored: key, undoneSteps: steps, note: steps ? "The undone steps can be redone." : "The document already was at this checkpoint." };
    }, { needsApproval: (a) => `Restore the document to the checkpoint “${a.name || "checkpoint"}”? Later edits are undone (redo brings them back).` }),

    tool("visual_diff", "Compares the render saved with a checkpoint to the page now, pixel by pixel: percent changed and the changed regions in page coordinates, plus the current render with the regions outlined. Proves that an edit changed what it should and nothing else.", {
      checkpoint: S.str("Checkpoint name (default “checkpoint”)"),
      threshold: S.num("Channel difference that counts as changed, 1-255 (default 24)", { minimum: 1, maximum: 255 }),
      image: S.bool("Return the outlined image (default true)"),
    }, [], async (a) => {
      const doc = requireDoc(app);
      const key = a.checkpoint || "checkpoint";
      const cp = checkpoints().get(key);
      if (!cp) throw new Error(`No checkpoint “${key}”. Call checkpoint with action “save” before your edits.`);
      if (!cp.shot) throw new Error("That checkpoint has no render (saved where rendering was unavailable).");
      const pg = doc.page(cp.shot.page);
      if (!pg) throw new Error("The page of that checkpoint no longer exists.");
      if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") throw new Error("visual_diff needs the app window.");
      const now = await renderPage(pg, cp.shot.area);
      const { diffPixels } = await lib();
      const w = cp.shot.width;
      const h = cp.shot.height;
      const pixels = async (shot) => {
        const bmp = await createImageBitmap(new Blob([shot.bytes], { type: "image/png" }));
        const cv = new OffscreenCanvas(w, h);
        const g = cv.getContext("2d", { willReadFrequently: true });
        g.drawImage(bmp, 0, 0, w, h);
        return { cv, g, data: g.getImageData(0, 0, w, h).data };
      };
      const p0 = await pixels(cp.shot);
      const p1 = await pixels(now);
      const d = diffPixels(p0.data, p1.data, w, h, { threshold: a.threshold || 24 });
      const k = cp.shot.scale;
      const regions = d.regions.map((r) => ({ x: r1(cp.shot.area.x + r.x / k), y: r1(cp.shot.area.y + r.y / k), w: r1(r.w / k), h: r1(r.h / k), pixels: r.pixels }));
      const report = { since: key, changedPercent: d.percent, regions, ...(d.moreRegions ? { moreRegions: d.moreRegions } : {}), note: d.changed ? "Regions are in page px." : "No visible change." };
      if (a.image === false || !d.changed) return report;
      p1.g.strokeStyle = "#ff2d55";
      p1.g.lineWidth = 2;
      for (const r of d.regions) p1.g.strokeRect(r.x + 1, r.y + 1, Math.max(1, r.w - 2), Math.max(1, r.h - 2));
      const blob = await p1.cv.convertToBlob({ type: "image/png" });
      return [{ type: "text", text: JSON.stringify(report) }, { type: "image", mime: "image/png", data: b64(new Uint8Array(await blob.arrayBuffer())) }];
    }, { readOnly: true, exclusive: true }),

    tool("measure_layers", "Measures layers exactly instead of judging by eye: each layer's bounds, the union, pairwise gaps (horizontal, vertical, center distance), overlaps, shared edges and centers (alignment), equal spacing per axis, and for text layers the WCAG contrast against what lies behind them (4.5:1 is the minimum for body text, 3:1 for large text).", {
      ids: S.ids("Layers to measure (2-40 for pair measurements)"),
      tolerance: S.num("Px within which edges count as aligned (default 0.5)", { minimum: 0, maximum: 20 }),
    }, ["ids"], async (a) => {
      const { measure, contrastRatio } = await lib();
      const nodes = nodesById(app, a.ids.slice(0, 40));
      const doc = app.doc;
      const boxes = nodes.map((n) => {
        let b = null;
        try {
          b = pageBounds(n);
        } catch {
          /* no geometry */
        }
        return b ? { id: n.id, x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) } : { id: n.id };
      });
      const m = measure(boxes, { tolerance: a.tolerance ?? 0.5 });
      const contrast = [];
      for (const n of nodes.filter((x) => x.type === "text")) {
        const pg = doc.pageOf(n) || app.page;
        const flat = pageFacts(app, pg).flat;
        const me = flat.find((f) => f.id === n.id);
        const color = doc.stories[n.storyId]?.defaults?.char?.color || "#000000";
        if (!me || me.w == null) continue;
        const cx = me.x + me.w / 2;
        const cy = me.y + me.h / 2;
        // flat is top-most first within each parent; the first solid shape after the text that covers its center is the backdrop
        const after = flat.slice(flat.indexOf(me) + 1);
        const behind = after.find((f) => f.visible && f.type !== "text" && f.type !== "group" && /^#/.test(f.fill || "") && f.w != null && cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h);
        const bg = behind ? behind.fill.slice(0, 7) : pg.bg || "#ffffff";
        const ratio = contrastRatio(color, bg);
        const size = doc.stories[n.storyId]?.defaults?.char?.fontSize || 12;
        if (ratio != null) contrast.push({ id: n.id, color, background: bg, backdrop: behind ? behind.id : "page", ratio, passes: ratio >= (size >= 24 ? 3 : 4.5) });
      }
      return { layers: boxes, ...m, ...(contrast.length ? { contrast } : {}) };
    }, { readOnly: true }),

    tool("find_replace", "Finds and replaces across a page or the whole document in one undo step. kind text: plain text or a regular expression inside text layers, character formatting around the match is kept. kind color: an exact solid fill, stroke or text color. kind font: a font family. dryRun returns the matches without changing anything. For Office documents use office_replace_text, for website files file_search and edit_file.", {
      kind: S.str("text, color or font", { enum: ["text", "color", "font"] }),
      find: S.str("Text, regular expression source, #rrggbb color or font family to find"),
      replace: S.str("Replacement (text may use $1 with regex)"),
      scope: S.str("page (active page) or document (every page); default document", { enum: ["page", "document"] }),
      regex: S.bool("Treat find as a regular expression (kind text)"),
      caseSensitive: S.bool("Match case (kind text; default false)"),
      wholeWord: S.bool("Only whole words (kind text)"),
      within: { type: "object", properties: { selector: { type: "string" }, name: { type: "string" }, parent: { type: "string" }, type: { type: "string" } }, description: "Only layers matching this query_layers query" },
      dryRun: S.bool("Only report the matches"),
    }, ["kind", "find", "replace"], async (a) => {
      const doc = requireDoc(app);
      if (!doc.pages) throw new Error("find_replace works on canvas documents. Use office_replace_text or edit_file for other documents.");
      const T = await import("../../engine/layout/text-model.js");
      const pages = a.scope === "page" ? [app.page] : doc.pages;
      const targets = [];
      for (const pg of pages) {
        let flat = pageFacts(app, pg, { maxText: 1e6 }).flat;
        if (a.within && Object.keys(a.within).length) flat = queryFacts(flat, a.within);
        for (const f of flat) targets.push({ f, node: doc.find(f.id), page: pg.id });
      }
      const matches = [];
      const edits = [];
      if (a.kind === "text") {
        const esc = a.regex ? a.find : a.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let re;
        try {
          re = new RegExp(a.wholeWord ? `\\b(?:${esc})\\b` : esc, a.caseSensitive ? "g" : "gi");
        } catch (err) {
          throw new Error(`Invalid regular expression: ${err.message}`);
        }
        for (const t of targets) {
          if (t.node?.type !== "text" || t.node.locked) continue;
          const entry = doc.stories[t.node.storyId];
          if (!entry) continue;
          const text = T.plainText(entry.story);
          const found = [...text.matchAll(re)].filter((m) => m[0].length);
          if (!found.length) continue;
          matches.push({ id: t.f.id, page: t.page, count: found.length, sample: text.slice(Math.max(0, found[0].index - 20), found[0].index + found[0][0].length + 20) });
          edits.push(() => {
            let story = entry.story;
            // back to front so earlier offsets stay valid
            for (const m of found.reverse()) {
              const rep = a.regex ? m[0].replace(new RegExp(re.source, re.flags.replace("g", "")), a.replace) : a.replace;
              const attrs = T.getAttrsAt(story, m.index + 1);
              story = T.deleteRange(story, m.index, m.index + m[0].length);
              if (rep) story = T.insertText(story, m.index, rep, attrs);
            }
            doc.setStory(t.node.storyId, story, "AI: Replace text");
          });
        }
      } else if (a.kind === "color") {
        const from = cssToHex(a.find).slice(0, 7);
        const to = cssToHex(a.replace).slice(0, 7);
        for (const t of targets) {
          const n = t.node;
          if (!n || n.locked) continue;
          const where = [];
          if (n.fill?.type === "solid" && String(n.fill.color).toLowerCase().slice(0, 7) === from) where.push("fill");
          if (n.stroke?.fill?.type === "solid" && String(n.stroke.fill.color).toLowerCase().slice(0, 7) === from) where.push("stroke");
          const entry = n.type === "text" ? doc.stories[n.storyId] : null;
          const json = entry ? JSON.stringify(T.storyToJSON(entry.story)) : "";
          const inRuns = entry && json.toLowerCase().includes(`"color":"${from}`);
          const inDefault = entry && String(entry.defaults?.char?.color || "").toLowerCase().slice(0, 7) === from;
          if (inRuns || inDefault) where.push("text");
          if (!where.length) continue;
          matches.push({ id: t.f.id, page: t.page, in: where });
          edits.push(() => {
            const patch = {};
            if (where.includes("fill")) patch.fill = { ...n.fill, color: to };
            if (where.includes("stroke")) patch.stroke = { ...n.stroke, fill: { ...n.stroke.fill, color: to } };
            if (Object.keys(patch).length) doc.set(n, patch, "AI: Replace color");
            if (inRuns) doc.setStory(n.storyId, T.storyFromJSON(JSON.parse(json.replace(new RegExp(`"color":"${from}`, "gi"), `"color":"${to}`))), "AI: Replace color");
            if (inDefault) doc.setStoryDefaults(n.storyId, { char: { ...entry.defaults.char, color: to }, para: entry.defaults.para || {} });
          });
        }
      } else {
        const from = a.find.trim().toLowerCase();
        for (const t of targets) {
          const n = t.node;
          if (n?.type !== "text" || n.locked) continue;
          const entry = doc.stories[n.storyId];
          if (!entry) continue;
          const json = T.storyToJSON(entry.story);
          let runs = 0;
          for (const p of json.paragraphs) for (const r of p.runs) if (String(r.attrs?.fontFamily || "").toLowerCase() === from) runs++;
          const inDefault = String(entry.defaults?.char?.fontFamily || "").toLowerCase() === from;
          if (!runs && !inDefault) continue;
          matches.push({ id: t.f.id, page: t.page, runs, default: inDefault });
          edits.push(() => {
            if (runs) {
              for (const p of json.paragraphs) for (const r of p.runs) if (String(r.attrs?.fontFamily || "").toLowerCase() === from) r.attrs.fontFamily = a.replace;
              doc.setStory(n.storyId, T.storyFromJSON(json), "AI: Replace font");
            }
            if (inDefault) doc.setStoryDefaults(n.storyId, { char: { ...entry.defaults.char, fontFamily: a.replace }, para: entry.defaults.para || {} });
          });
        }
      }
      const total = matches.reduce((s, m) => s + (m.count || 1), 0);
      if (a.dryRun || !edits.length) return { matches: total, layers: matches.length, found: matches.slice(0, 80), ...(edits.length ? { dryRun: true } : { note: "Nothing matched." }) };
      doc.tx(`AI: Replace ${a.kind}`, () => edits.forEach((fn) => fn()));
      app.emit("render");
      return { replaced: total, layers: matches.length, ids: matches.slice(0, 200).map((m) => m.id) };
    }),
  ];
}
