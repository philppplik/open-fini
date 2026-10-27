// Records what every mutating Vibe tool call changed, for the chat's "View changes" buttons, the run summary card,
// the diff drawer and the Canvas before/after view. App-bound counterpart of the pure changes.js.
//
// How it hooks in: VibeSession#wrap (app/src/vibe/session.js) calls `hub.changeProbe.before({ session, id, name,
// input, doc, run })` after taking the write lock and before running a mutating tool, then `probe.after(app.doc)`
// when the call ends. That is the only engine hook; the session's public events are unchanged.
//
// Public API (getChangeRecorder(app, hub) → singleton)
//   rec.on("change", record)          a mutating call finished with changes ({ id, run, session, doc, raw, set, stat })
//   rec.call(toolCallId)              → record | null
//   rec.run(runId)                    → { id, doc, calls, set, stat, beforeThumb, afterThumb } | null (aggregated)
//   rec.lastRun(sessionId)            → the newest run of a chat with changes
//   rec.afterThumb(runId)             → Promise<url|null> (renders the current page once and caches it)
//   rec.revertLayer(doc, change) / rec.revertFile(doc, file) / rec.revertHunk(doc, file, k) / rec.revertOffice(doc, office)
//
// Invariants
//   - Snapshots are bounded (MAX_LAYERS nodes, MAX_DIFF_CHARS per file); binary data is never copied.
//   - Records live in memory only (bounded to the last MAX_CALLS calls); chats loaded from storage have no diffs.
//   - Every revert is one undoable step (doc.tx / one editor transaction / one Office commit).
import { Emitter } from "../../core/util.js";
import { exportRaster } from "../../core/io.js";
import { commitOffice } from "../../core/office.js";
import { snapshotNodes, touchedOnly, sameLayer, computeSet, combineCalls, statOf, officeParagraphs, revertPatch, revertBlock, MAX_LAYERS } from "./changes.js";

const MAX_CALLS = 400;
const THUMB = 360;

let instance = null;

function capture(doc) {
  const out = { layers: new Map(), files: new Map(), office: null, truncated: false };
  if (!doc) return out;
  if (doc.pages?.length) {
    const s = snapshotNodes(doc.pages.map((p) => p.root), { limit: MAX_LAYERS });
    out.layers = s.map;
    out.truncated = s.truncated;
  }
  if (doc.web?.files) {
    for (const [path, f] of doc.web.files) out.files.set(path, typeof f.text === "string" ? f.text : { binary: true, size: f.bytes?.length || 0, rev: f.bytes });
  }
  if (doc.office?.model) out.office = { paras: officeParagraphs(doc.office.model), model: doc.office.model };
  return out;
}

const hasDesign = (doc, page) => !!(doc && page && page.root?.children?.length && !doc.office);

async function thumbOf(app, doc, page) {
  if (!hasDesign(doc, page) || app.doc !== doc) return null;
  try {
    const k = Math.min(1, THUMB / Math.max(page.w, page.h));
    const r = await exportRaster(app, { page, format: "png", scale: k });
    return URL.createObjectURL(new Blob([r.bytes], { type: "image/png" }));
  } catch {
    return null;
  }
}

export function getChangeRecorder(app, hub) {
  if (instance) return instance;
  const em = new Emitter();
  const calls = new Map(); // tool call id → record
  const runs = new Map(); // run id → { id, sessionId, doc, page, calls: [], beforeThumb, afterThumb, afterRev }

  const runOf = (id, session, doc) => {
    if (!runs.has(id)) runs.set(id, { id, sessionId: session.id, doc, page: app.page, calls: [], beforeThumb: null, beforeThumbP: null, afterThumb: null, afterRev: -1 });
    return runs.get(id);
  };

  hub.changeProbe = {
    async before({ session, id, name, doc, run }) {
      if (!run) return null;
      const snap = capture(doc);
      const r = runOf(run, session, doc);
      // the run's "before" picture: rendered once, before its first mutating call
      if (!r.beforeThumbP && doc === app.doc) r.beforeThumbP = thumbOf(app, doc, app.page).then((u) => (r.beforeThumb = u));
      if (r.beforeThumbP) await r.beforeThumbP;
      return {
        after(now) {
          const target = now || doc;
          const base = target === doc ? snap : capture(null); // a call that created or opened a document starts empty
          const next = capture(target);
          const raw = {
            layers: touchedOnly(base.layers, next.layers, sameLayer),
            files: touchedOnly(base.files, next.files, (a, b) => a === b || (typeof a === "object" && typeof b === "object" && a.rev === b.rev)),
            office: base.office && next.office && base.office.model !== next.office.model ? { before: base.office.paras, after: next.office.paras, model: base.office.model } : null,
          };
          const set = computeSet(raw);
          const stat = statOf(set);
          if (stat.empty) return;
          const rec = { id, name, run, sessionId: session.id, doc: target, raw, set, stat, truncated: next.truncated, time: Date.now() };
          calls.set(id, rec);
          const rr = runOf(run, session, target);
          rr.doc = target;
          rr.calls.push(rec);
          rr.afterThumb = null;
          if (calls.size > MAX_CALLS) {
            const old = calls.keys().next().value;
            calls.delete(old);
          }
          if (runs.size > 60) {
            const [oldId, old] = runs.entries().next().value;
            for (const u of [old.beforeThumb, old.afterThumb]) if (u) URL.revokeObjectURL(u);
            runs.delete(oldId);
          }
          em.emit("change", rec);
        },
      };
    },
  };

  const api = {
    on: (ev, fn) => em.on(ev, fn),
    call: (id) => calls.get(id) || null,
    run(id) {
      const r = runs.get(id);
      if (!r || !r.calls.length) return null;
      const set = computeSet(combineCalls(r.calls.map((c) => c.raw)));
      return { ...r, set, stat: statOf(set) };
    },
    lastRun(sessionId) {
      let last = null;
      for (const r of runs.values()) if (r.sessionId === sessionId && r.calls.length) last = r;
      return last ? api.run(last.id) : null;
    },
    async afterThumb(runId) {
      const r = runs.get(runId);
      if (!r) return null;
      if (r.afterThumb && r.afterRev === r.doc?.rev) return r.afterThumb;
      if (r.afterThumb) URL.revokeObjectURL(r.afterThumb);
      r.afterThumb = await thumbOf(app, r.doc, r.page && r.doc?.pages?.includes(r.page) ? r.page : app.page);
      r.afterRev = r.doc?.rev;
      return r.afterThumb;
    },

    /** Restores one layer change (property values, a deleted layer, or removes an added one) as one undo step. */
    revertLayer(doc, c) {
      doc.tx(`Revert AI change: ${c.name || c.type}`, () => {
        if (c.kind === "changed") {
          const node = doc.find(c.id);
          if (!node) throw new Error("This layer no longer exists.");
          doc.set(node, revertPatch(c));
        } else if (c.kind === "added") {
          const node = doc.find(c.id);
          if (node) doc.remove(node);
        } else if (c.kind === "removed") {
          const node = c.before?.ref;
          if (!node || doc.find(c.id)) return;
          const parent = doc.find(c.before.parentId) || doc.pages.find((p) => p.root.id === c.before.parentId)?.root;
          if (!parent) throw new Error("The layer's parent no longer exists.");
          const prev = c.before.prevId ? parent.children.findIndex((x) => x.id === c.before.prevId) : -1;
          doc.insert(node, parent, prev + 1);
        }
      });
      app.emit("docchange", {});
    },

    async setFileText(doc, path, text) {
      const ws = app.codeUI;
      if (ws?.doc === doc && ws.editors?.applyChanges && doc.web.has(path)) {
        const { trimmedChange } = await import("../code/util.js");
        ws.editors.applyChanges(path, [trimmedChange(doc.web.text(path) ?? "", text)], { userEvent: "input.revert" });
      } else if (doc.web.has(path)) doc.web.setText(path, text);
      else doc.web.create(path, text);
    },

    /** Restores a whole file to its content before the change (removes a file the AI created). */
    async revertFile(doc, f) {
      if (!doc?.web) throw new Error("The website project is no longer open.");
      if (f.binary) throw new Error("Binary files cannot be restored from the chat.");
      if (f.kind === "added") {
        if (doc.web.has(f.path)) doc.web.remove(f.path);
      } else await api.setFileText(doc, f.path, f.before);
      app.emit("docchange", {});
    },

    /** Reverts the k-th change block of a file when the file still has the content the AI left. */
    async revertHunk(doc, f, k) {
      const cur = doc?.web?.text(f.path);
      if (cur !== f.after) throw new Error("The file changed after this AI edit. Revert the whole file or edit it by hand.");
      const next = revertBlock(f.before ?? "", f.after ?? "", k);
      await api.setFileText(doc, f.path, next);
      f.after = next;
      app.emit("docchange", {});
      return next;
    },

    /** Restores the Office document text as it was before the change (one undo step). */
    revertOffice(doc, office) {
      if (!doc?.office || !office?.model) throw new Error("The Office document is no longer open.");
      commitOffice(doc, "Revert AI change", office.model);
      app.emit("docchange", {});
    },
  };
  instance = api;
  return api;
}
