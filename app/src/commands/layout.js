// Layout-studio commands: pages, linked text frames, fields, tables, table of contents.
import { h, clone, uid } from "../core/util.js";
import { createNode, walk } from "../core/nodes.js";
import { addNodes } from "../core/ops.js";
import * as T from "../engine/layout/text-model.js";
import { getStoryLayout } from "../engine/dl.js";
import { addTextNode } from "../core/text-ops.js";
import { installSliceOverlay } from "../studios/tools/layout.js";
import { dataMergeDialog } from "../ui/data-merge.js";
import { remapLinks } from "../core/data-nodes.js";

const hasDoc = (a) => !!a.doc;
const textFrames = (a) => a.selection.filter((n) => n.type === "text" && a.doc.stories[n.storyId]);

/** Duplicates a page with all of its content (text stories are copied so edits stay independent). */
export function duplicatePage(app, page = app.page) {
  const doc = app.doc;
  let np;
  doc.tx("Duplicate Page", () => {
    const idx = doc.pages.indexOf(page);
    np = doc.addPage({ w: page.w, h: page.h, bg: page.bg, margins: { ...page.margins }, columns: page.columns, gutter: page.gutter, bleed: page.bleed, masterId: page.masterId, name: `${page.name} copy` }, idx + 1);
    const storyMap = new Map();
    for (const n of page.root.children) {
      const c = doc.cloneNode(n);
      walk(c, (t) => {
        if (t.type === "text" && t.storyId) {
          if (!storyMap.has(t.storyId)) {
            const src = doc.stories[t.storyId];
            const sid = doc.createStory(clone(src.story));
            if (src.defaults) doc.stories[sid].defaults = clone(src.defaults);
            storyMap.set(t.storyId, sid);
          }
          t.storyId = storyMap.get(t.storyId);
          t.linked = false;
          t.flowIndex = 0;
        }
      });
      doc.insert(c, np.root, np.root.children.length);
    }
    remapLinks(page.root.children, np.root.children);
    doc.relayoutPages(doc.settings.facing);
  });
  return np;
}

function reindex(doc, sid) {
  const chain = doc.framesOfStory(sid);
  chain.forEach((f, i) => doc.set(f, { flowIndex: i, linked: chain.length > 1 }));
}

export function registerLayoutCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });
  installSliceOverlay(app);

  def("doc.duplicatePage", "Duplicate Page", (a) => {
    const p = duplicatePage(a);
    if (p) {
      a.setActivePage(p);
      a.cv?.fitPage(p);
    }
  }, { enabled: (a) => !!a.doc && !a.doc.masters.includes(a.page) });

  // ---- linked frames
  def("layout.linkFrames", "Link Text Frames", (a) => {
    const frames = textFrames(a).filter((n) => n.w != null);
    if (frames.length < 2) return a.toast("Select two or more text frames to link.", "warning");
    const doc = a.doc;
    const sid = frames[0].storyId;
    doc.tx("Link Frames", () => {
      let story = doc.stories[sid].story;
      for (const f of frames.slice(1)) {
        if (f.storyId === sid) continue;
        const other = doc.stories[f.storyId]?.story;
        if (other && T.plainText(other).trim()) story = T.insertStory(story, T.storyLength(story), other);
        doc.set(f, { storyId: sid, mode: "frame" });
      }
      doc.setStory(sid, story, "Link Frames");
      // new frames go after the existing chain, in selection order
      const existing = doc.framesOfStory(sid).filter((f) => !frames.includes(f) || f === frames[0]);
      const order = [...new Set([...existing, ...frames])];
      order.forEach((f, i) => doc.set(f, { flowIndex: i, linked: true }));
    });
    a.toast(`Linked ${frames.length} frames — text now flows through them.`, "success");
  }, { enabled: (a) => textFrames(a).length >= 2 });

  def("layout.unlinkFrames", "Unlink Text Frame", (a) => {
    const doc = a.doc;
    const frames = textFrames(a).filter((n) => n.linked);
    if (!frames.length) return;
    doc.tx("Unlink Frame", () => {
      for (const f of frames) {
        const old = f.storyId;
        const sid = doc.createStory(T.emptyStory());
        const entry = doc.stories[old];
        if (entry?.defaults) doc.stories[sid].defaults = clone(entry.defaults);
        doc.set(f, { storyId: sid, flowIndex: 0, linked: false });
        reindex(doc, old);
      }
    });
  }, { enabled: (a) => textFrames(a).some((n) => n.linked) });

  const addFlow = (a, f) => {
    const doc = a.doc;
    let node;
    doc.tx("Flow into New Frame", () => {
      const page = f._page;
      let idx = doc.pages.indexOf(page);
      if (idx < 0) idx = 0;
      let target = doc.pages[idx + 1];
      if (!target) {
        target = doc.addPage({}, idx + 1);
        doc.relayoutPages(doc.settings.facing);
      }
      const chain = doc.framesOfStory(f.storyId);
      node = createNode("text", {
        name: "Text Frame",
        storyId: f.storyId,
        w: f.w,
        h: f.h,
        mode: "frame",
        columns: f.columns,
        gutter: f.gutter,
        insets: clone(f.insets),
        vAlign: f.vAlign,
        m: f.m.slice(),
        fill: clone(f.fill),
        linked: true,
        flowIndex: chain.length,
      });
      doc.insert(node, target.root, target.root.children.length);
      if (!f.linked) doc.set(f, { linked: true });
    });
    return node;
  };

  def("layout.addFlowFrame", "Flow Text into a New Frame", (a) => {
    const f = textFrames(a).find((n) => n.w != null);
    if (!f) return a.toast("Select a text frame first.", "warning");
    const node = addFlow(a, f);
    a.setActivePage(node._page);
    a.select([node]);
    a.cv?.fitPage(node._page);
  }, { enabled: (a) => textFrames(a).some((n) => n.w != null) });

  def("layout.autoflow", "Autoflow Text into New Pages", (a) => {
    let f = textFrames(a).find((n) => n.w != null);
    if (!f) return a.toast("Select the last text frame of a story.", "warning");
    let guard = 0;
    while (guard++ < 60) {
      const chain = a.doc.framesOfStory(f.storyId);
      const last = chain[chain.length - 1];
      getStoryLayout(a.doc, last);
      if (!last._overflow) break;
      f = addFlow(a, last);
      getStoryLayout(a.doc, f);
    }
    a.toast(`Story now spans ${a.doc.framesOfStory(f.storyId).length} frame(s).`, "success");
  }, { enabled: (a) => textFrames(a).some((n) => n.w != null) });

  // ---- fields
  const insertField = (field, label) => (a) => {
    const ed = a.textEditor;
    if (ed) {
      const doc = a.doc;
      const story = doc.stories[ed.node.storyId].story;
      const at = Math.min(ed.caret, ed.anchor);
      const next = T.insertText(T.deleteRange(story, at, Math.max(ed.caret, ed.anchor)), at, field === "date" ? "00/00/0000" : "#", { field });
      doc.setStory(ed.node.storyId, next, `Insert ${label}`);
      ed.caret = ed.anchor = at + (field === "date" ? 10 : 1);
      a.emit("textcaret");
      return;
    }
    const p = a.page;
    const node = addTextNode(a, { text: "#", x: p.w / 2 - 20, y: p.h - (p.margins.bottom || 40) - 24, w: 60, h: 28, defaults: { char: { fontSize: 14 }, para: { align: "center" } }, label: `Insert ${label}` });
    const entry = a.doc.stories[node.storyId];
    a.doc.setStory(node.storyId, T.applyCharAttrs(entry.story, 0, T.storyLength(entry.story), { field }), `Insert ${label}`);
  };
  def("text.insertPageNumber", "Insert Page Number", insertField("pageNumber", "Page Number"), { enabled: hasDoc });
  def("text.insertPageCount", "Insert Page Count", insertField("pageCount", "Page Count"), { enabled: hasDoc });
  def("text.insertDate", "Insert Date", insertField("date", "Date"), { enabled: hasDoc });

  // tables and charts: see commands/data.js

  // ---- table of contents
  def("layout.toc", "Generate Table of Contents", (a) => generateToc(a), { enabled: hasDoc });

  // ---- data merge
  def("layout.dataMerge", "Data Merge…", (a) => dataMergeDialog(a), { enabled: hasDoc });
}

function generateToc(app) {
  const doc = app.doc;
  const headings = Object.entries(doc.styles.paragraph).filter(([, s]) => /^heading\s*[1-3]$/i.test(s.name));
  if (!headings.length) return app.toast("Define paragraph styles named “Heading 1–3” first (Styles panel ▸ Add defaults).", "warning", 6000);
  const level = new Map(headings.map(([id, s]) => [id, parseInt(s.name.replace(/\D/g, ""), 10)]));
  const entries = [];
  const seen = new Set();
  doc.pages.forEach((page, pi) => {
    walk(page.root, (n) => {
      if (n.type !== "text" || !n.storyId || seen.has(n.storyId) || n.toc) return;
      seen.add(n.storyId);
      const entry = doc.stories[n.storyId];
      if (!entry) return;
      const lay = getStoryLayout(doc, n, pi + 1);
      entry.story.paragraphs.forEach((p, i) => {
        const lv = level.get(p.styleId);
        if (!lv) return;
        const title = p.runs.map((r) => r.text).join("").trim();
        if (!title) return;
        let pageNo = pi + 1;
        if (lay) {
          for (const fr of lay.result.frames) {
            const line = fr.lines.find((l) => l.para === i);
            if (line) {
              const node = lay.frames[fr.index];
              pageNo = doc.pages.indexOf(node?._page) + 1 || pageNo;
              break;
            }
          }
        }
        entries.push({ title, level: lv, page: pageNo });
      });
    });
  });
  if (!entries.length) return app.toast("No headings found in the document.", "warning");
  const page = app.page;
  const m = page.margins || {};
  const width = page.w - (m.left || 40) - (m.right || 40);
  const paragraphs = entries.map((e) => ({
    runs: [{ text: e.title, attrs: e.level === 1 ? { fontWeight: 650 } : {} }, { text: "\t" }, { text: String(e.page) }],
    attrs: { indentLeft: (e.level - 1) * 20, tabs: [{ pos: width, align: "right", leader: "." }], lineHeight: 1.5, align: "left" },
  }));
  doc.tx("Table of Contents", () => {
    for (const n of [...page.root.children]) if (n.toc) doc.remove(n);
    const title = { runs: [{ text: "Contents", attrs: { fontSize: 32, fontWeight: 700 } }], attrs: { spaceAfter: 14 } };
    const node = addTextNode(app, { text: "", x: m.left || 40, y: m.top || 40, w: width, h: page.h - (m.top || 40) - (m.bottom || 40), label: "Table of Contents", defaults: { char: { fontSize: 15 }, para: { align: "left" } } });
    doc.setStory(node.storyId, { paragraphs: [title, ...paragraphs] }, "Table of Contents");
    doc.set(node, { toc: true, name: "Table of Contents" });
  });
  app.toast(`Table of contents with ${entries.length} entries created.`, "success");
}

export { uid };
