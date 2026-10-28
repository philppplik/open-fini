// Comment tools for the Vibe assistant (group "Comments"): read the comments of the open document together with the
// exact place they point at, add / reply / resolve. Comments work without any collaboration room and are saved in the
// document, so these tools only use the small comments host (ui/collab/comments-host.js), never the room runtime.
//
//   list_comments        every thread with status, author, messages and the RESOLVED target (layer id / name / type /
//                        bounds, code file + lines + excerpt, website element + outer HTML, Office paragraph + quoted text)
//   get_comment_context  one thread with a richer context: a cropped screenshot of the commented region (canvas anchors),
//                        surrounding lines (code) or the paragraph and its neighbours (Office)
//   add_comment / reply_comment / resolve_comment
// Resolution logic is pure and unit tested: collab/comment-context.js. This file only builds its `env` from the app.
// Approval: add/reply ask only while the user is in a room (the text is shared with others); resolve_comment is a
// normal write tool, so the "Careful" mode asks like for every other write.
import { tool, S, requireDoc, nodeInfo } from "./helpers.js";
import { describeThread, excerptLines } from "../../collab/comment-context.js";
import { filterThreads } from "../../collab/comments.js";

const inRoom = (app) => !!app.collab?.session && app.collab.session.state === "open";
const host = async (app) => (await import("../../ui/collab/comments-host.js")).getComments(app);

/** Builds the lookups comment-context.js needs from the open document (no studio switching, no UI). */
export async function commentEnv(app, doc) {
  const { pageBounds } = await import("../../core/transform.js");
  const html = await import("../../engine/web/html.js");
  const M = doc.office ? await import("../../engine/office/model.js") : null;
  const pages = [...doc.pages, ...(doc.masters || [])];
  const lineOf = (text, off) => text.slice(0, off).split("\n").length;
  return {
    findNode: (id) => doc.find(id) || null,
    pageName: (id) => pages.find((p) => p.id === id)?.name ?? null,
    nodeBounds: (n) => {
      try {
        return pageBounds(n);
      } catch {
        return null;
      }
    },
    nodeInfo: (n) => {
      const { id, type, name, children, ...rest } = nodeInfo(app, n, { maxDepth: 0 });
      return { type, ...rest };
    },
    fileText: (path) => (doc.web ? doc.web.text(path) ?? null : null),
    elementAt: (path, sel) => {
      const src = doc.web?.text(path || doc.web.entry);
      if (src == null) return null;
      const idx = String(sel).split("/").map(Number);
      if (!idx.length || idx.some((n) => !Number.isInteger(n))) return null;
      const parsed = html.parseHtml(src);
      const el = html.elementAtPath(parsed, idx);
      if (!el) return null;
      return { tag: el.tag, outerHtml: src.slice(el.start, el.end), startLine: lineOf(src, el.start), endLine: lineOf(src, el.end), text: html.elementText(parsed, el) };
    },
    blockText: (path) => {
      const model = doc.office?.model;
      const b = model && M ? M.getBlock(model, path) : null;
      return b ? M.paraText(b) : null;
    },
  };
}

const findThread = (c, doc, id) => {
  const th = c.threads(doc).find((t) => t.id === id);
  if (!th) throw new Error(`There is no comment thread “${id}”. Call list_comments first.`);
  return th;
};

export function commentTools(app) {
  return [
    tool("list_comments", "Lists the comment threads of the active document (comments on layers, pages, text, code lines and website elements; they work in every studio and are saved in the document). For every thread you get the status, the author, all messages AND the exact target the comment points at: layer id/name/type/bounds, code file and line range with the code, website element selector and its HTML, Office paragraph with the quoted text. Use it to go through open comments and make precise edits.", {
      status: S.str("Which threads (default open)", { enum: ["open", "resolved", "all"] }),
    }, [], async (a) => {
      const doc = requireDoc(app);
      const c = await host(app);
      const env = await commentEnv(app, doc);
      const threads = filterThreads(c.threads(doc), { status: a.status || "open" }).sort((x, y) => x.ts - y.ts);
      return { document: doc.name, count: threads.length, threads: threads.slice(0, 100).map((th) => describeThread(th, env)) };
    }, { readOnly: true }),

    tool("get_comment_context", "Returns the full context of ONE comment thread: the thread, the resolved target and more around it: for layer/region anchors a cropped screenshot of the commented area (with the layer's details), for code the surrounding lines, for Office the paragraph and its neighbours, for website elements the element's HTML. Call it before editing so the change is precise.", {
      thread_id: S.str("Thread id from list_comments"),
      lines: S.num("Code: how many lines of context above and below (default 8, max 40)", { minimum: 0, maximum: 40 }),
      maxSize: S.num("Screenshot: longest side in px (default 512, max 1024)", { minimum: 64, maximum: 1024 }),
    }, ["thread_id"], async (a) => {
      const doc = requireDoc(app);
      const c = await host(app);
      const th = findThread(c, doc, a.thread_id);
      const env = await commentEnv(app, doc);
      const out = describeThread(th, env);
      const tg = out.target;
      if (tg.type === "code" && tg.exists) {
        const n = Math.min(40, Math.max(0, a.lines ?? 8));
        out.target.context = excerptLines(doc.web.text(tg.path), tg.line, tg.endLine, { before: n, after: n, maxChars: 6000 }).text;
      }
      if (tg.type === "text" && tg.exists) {
        const model = doc.office.model;
        const [top] = tg.blockPath;
        const M = await import("../../engine/office/model.js");
        const near = [];
        for (let i = Math.max(0, top - 2); i <= Math.min(model.blocks.length - 1, top + 2); i++) {
          const b = model.blocks[i];
          if (b?.runs) near.push({ index: i, text: M.paraText(b).slice(0, 400), current: i === top });
        }
        out.target.neighbors = near;
      }
      const shot = await regionShot(app, doc, th, tg, a.maxSize || 512);
      if (!shot) return out;
      return [{ type: "text", text: JSON.stringify(out) }, shot];
    }, { readOnly: true }),

    tool("add_comment", "Adds a comment thread to the active document, anchored to a layer (layer_id), a place on the page (x, y), a code line or range (path, line), a website element (path = HTML file, element_id) or the current selection. Comments are saved in the document (visible to everyone who opens the file) and shared with the room when the user is in one.", {
      text: S.str("The comment text (plain text; @Name mentions a room member)"),
      layer_id: S.str("Optional layer id from list_layers to anchor the comment to"),
      at: {
        type: "object",
        description: "Optional precise anchor: page coordinates (x, y; together with layer_id the pin follows that layer), a code line/range (path, line, end_line) or an Office paragraph (block_index, from, to)",
        properties: { x: S.num("Page x (px) of the pin"), y: S.num("Page y (px) of the pin"), page_id: S.str("Optional page id (default: the current page)"), path: S.str("Code studio: file path"), line: S.num("Code studio: 1-based line"), end_line: S.num("Code studio: last line of a range"), block_index: S.num("Office: paragraph (block) index from office_read_document"), from: S.num("Office: start offset in the paragraph"), to: S.num("Office: end offset in the paragraph") },
        additionalProperties: false,
      },
    }, ["text"], async (a) => {
      const doc = requireDoc(app);
      const c = await host(app);
      const { canvasAnchor, codeAnchor, officeAnchor } = await import("../../collab/anchors.js");
      const { pageBounds } = await import("../../core/transform.js");
      let anchor = c.currentAnchor();
      const at = a.at || {};
      const node = a.layer_id ? doc.find(a.layer_id) : null;
      if (a.layer_id && !node) throw new Error(`There is no layer with id “${a.layer_id}”. Call list_layers to see the current ids.`);
      if (at.path && at.line) {
        const src = doc.web?.text(at.path);
        if (src == null) throw new Error(`There is no text file “${at.path}” in the project. Call list_files.`);
        const first = src.split("\n")[Math.min(at.line, src.split("\n").length) - 1] || "";
        anchor = codeAnchor({ path: at.path, from: { line: at.line, col: 0 }, to: at.end_line ? { line: at.end_line, col: 1e6 } : null, quote: at.end_line ? "" : first.trim() });
      } else if (Number.isInteger(at.block_index) && doc.office) {
        const M = await import("../../engine/office/model.js");
        const b = M.getBlock(doc.office.model, [at.block_index]);
        if (!b?.runs) throw new Error(`Block ${at.block_index} is not a paragraph. Call office_read_document for the indexes.`);
        const full = M.paraText(b);
        const from = Math.max(0, Math.min(at.from ?? 0, full.length));
        const to = Math.max(from, Math.min(at.to ?? full.length, full.length));
        anchor = officeAnchor({ path: [at.block_index], from, to, quote: full.slice(from, to).slice(0, 200) });
      } else if (Number.isFinite(at.x) && Number.isFinite(at.y)) {
        const page = (at.page_id && doc.pages.find((p) => p.id === at.page_id)) || node?._page || app.page;
        if (!page) throw new Error("There is no page to place the comment on.");
        anchor = canvasAnchor({ pageId: page.id, node, bounds: node ? pageBounds(node) : null, point: { x: at.x, y: at.y } });
      } else if (node) {
        anchor = { kind: "node", node: node.id, page: node._page?.id, quote: String(node.name || node.type).slice(0, 200) };
      }
      const th = c.addThread(doc, anchor, a.text);
      return { added: th.id, anchor: th.anchor.kind, shared: inRoom(app) };
    }, { needsApproval: (a) => (inRoom(app) ? `Add the comment “${String(a.text).slice(0, 80)}” (it is shared with the room)?` : false) }),

    tool("reply_comment", "Replies to a comment thread of the active document (thread ids from list_comments). Use it to say what you changed or to answer a question. Replying to a resolved thread reopens it.", {
      thread_id: S.str("Thread id from list_comments"),
      text: S.str("Reply text"),
    }, ["thread_id", "text"], async (a) => {
      const doc = requireDoc(app);
      const c = await host(app);
      findThread(c, doc, a.thread_id);
      c.reply(doc, a.thread_id, a.text);
      return { replied: a.thread_id, shared: inRoom(app) };
    }, { needsApproval: (a) => (inRoom(app) ? `Reply “${String(a.text).slice(0, 80)}” to the comment thread (it is shared with the room)?` : false) }),

    tool("resolve_comment", "Marks a comment thread as resolved (or reopens it with reopen: true). Do this after you made the requested change and replied what you did.", {
      thread_id: S.str("Thread id from list_comments"),
      reopen: S.bool("Reopen instead of resolve"),
    }, ["thread_id"], async (a) => {
      const doc = requireDoc(app);
      const c = await host(app);
      findThread(c, doc, a.thread_id);
      const changed = c.setResolved(doc, a.thread_id, !a.reopen);
      return { thread: a.thread_id, resolved: !a.reopen, changed };
    }),
  ];
}

/** A cropped PNG of the commented area for canvas anchors (layer bounds with padding, or a window around the pin). */
async function regionShot(app, doc, th, tg, maxSize) {
  if (!["layer", "region"].includes(tg.type) || tg.exists === false) return null;
  const page = [...doc.pages].find((p) => p.id === th.anchor.page) || app.page;
  if (!page) return null;
  const pad = 24;
  let area;
  if (tg.type === "layer" && tg.bounds) area = { x: tg.bounds.x - pad, y: tg.bounds.y - pad, w: tg.bounds.w + 2 * pad, h: tg.bounds.h + 2 * pad };
  else if (tg.point) area = { x: tg.point.x - 200, y: tg.point.y - 150, w: 400, h: 300 };
  if (!area) return null;
  const x0 = Math.max(0, area.x);
  const y0 = Math.max(0, area.y);
  const w = Math.min(page.w - x0, area.w - (x0 - area.x));
  const h = Math.min(page.h - y0, area.h - (y0 - area.y));
  if (!(w > 1 && h > 1)) return null;
  try {
    const { exportRaster } = await import("../../core/io.js");
    const k = Math.min(1, maxSize / Math.max(w, h));
    const r = await exportRaster(app, { page, format: "png", scale: k, area: { x: x0, y: y0, w, h } });
    let bin = "";
    for (let i = 0; i < r.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, r.bytes.subarray(i, i + 0x8000));
    return { type: "image", mime: "image/png", data: btoa(bin) };
  } catch {
    return null; // e.g. no renderer in tests: the structured context is still returned
  }
}

