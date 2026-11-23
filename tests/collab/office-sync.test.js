// Live editing of record-based documents (Office Suite apps, Scene Studio) between in-memory peers: the gaps found in
// the audit (docs/collaboration.md ▸ Live editing) reproduced and fixed in collab/office-sync.js.
import test from "node:test";
import assert from "node:assert/strict";
import { OfficeSync, BLOB_CHUNK } from "../../app/src/collab/office-sync.js";
import { validateRecordOp } from "../../app/src/collab/office-records.js";
import { DocRecords, remapBlockIndex } from "../../app/src/collab/doc-records.js";
import { liveKindOf, canShareLive } from "../../app/src/core/live-kinds.js";
import { Doc } from "../../app/src/core/doc.js";
import { OfficeProject, commitOffice } from "../../app/src/core/office.js";
import sheetApp from "../../app/src/office/sheet/app.js";
import boardApp from "../../app/src/office/board/app.js";
import slidesApp from "../../app/src/office/slides/app.js";
import documentApp from "../../app/src/office/document/app.js";
import * as Sheet from "../../app/src/office/sheet/model.js";
import * as Board from "../../app/src/office/board/model.js";
import * as Slides from "../../app/src/office/slides/model.js";
import * as Office from "../../app/src/engine/office/model.js";
import * as Scene from "../../app/src/scene/model.js";
import { sceneCollabAdapter } from "../../app/src/scene/collab.js";

/** A replica: its model, its sync engine and an outbox. Ops travel through JSON like on the wire. */
class Peer {
  constructor(adapter, model, site, state = null) {
    this.adapter = adapter;
    this.model = model;
    this.site = site;
    this.sync = new OfficeSync(adapter, model, { site, state });
    if (state) this.model = this.sync.replaceState(state, model);
    this.out = [];
  }
  edit(fn) {
    this.model = fn(this.model);
    this.flush();
  }
  flush() {
    const ops = this.sync.local(this.model);
    if (ops.length) this.out.push(JSON.parse(JSON.stringify(ops)));
  }
  receive(batch) {
    this.flush(); // like the binding: pending local edits first
    const r = this.sync.remote(batch.map(validateRecordOp), this.model);
    this.model = r.model;
    return r;
  }
}

/** Delivers every outbox to every other peer (optionally reversed / shuffled), until quiet. */
function deliver(peers, order = (x) => x) {
  for (let round = 0; round < 10; round++) {
    const msgs = [];
    for (const p of peers) {
      for (const b of p.out) msgs.push({ from: p, b });
      p.out = [];
    }
    if (!msgs.length) return;
    for (const { from, b } of order(msgs)) for (const p of peers) if (p !== from) p.receive(b);
  }
  throw new Error("no quiescence");
}

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const shuffle = (r) => (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const recs = (p) => JSON.parse(JSON.stringify(p.sync.a.records(p.model)));

test("share live is offered for every studio that has a live model", () => {
  assert.equal(liveKindOf({ pages: [] }), "tree"); // Vector, Pixel, Layout
  assert.equal(liveKindOf({ web: {} }), "text");
  for (const kind of ["document", "sheet", "slides", "board", "scene"]) assert.equal(liveKindOf({ office: { kind } }), "office", kind);
  assert.equal(liveKindOf({ office: {} }), "office", "an office project without kind is a word-processing document");
  assert.equal(canShareLive({ office: { kind: "some-extension-app" } }), false);
  assert.equal(canShareLive(null), false);
  for (const app of [sheetApp, boardApp, slidesApp, documentApp]) assert.ok(app.collabAdapter, "every Office app has a collabAdapter");
});

test("whiteboard: an element that arrives before its page is not lost, and the next edit does not delete it everywhere", () => {
  const base = Board.normalizeBoard(Board.emptyModel({ title: "B" }));
  const a = new Peer(boardApp.collabAdapter, base, "a");
  const b = new Peer(boardApp.collabAdapter, base, "b");
  const c = new Peer(boardApp.collabAdapter, base, "c");
  // A adds a page, then (separate message) a sticky on it
  a.edit((m) => ({ ...m, pages: [...m.pages, { id: "p9", name: "Two", z: "z", paper: "plain" }] }));
  a.edit((m) => Board.addElements(m, [Board.makeElement("sticky", { page: "p9", x: 10, y: 10, w: 100, h: 100, text: "hi" })]));
  // the network delivers the element first
  deliver([a, b, c], (msgs) => [...msgs].reverse());
  // B edits something unrelated: before the fix this sent "delete the sticky" (it had been dropped from B's model)
  b.edit((m) => ({ ...m, title: "Renamed" }));
  deliver([a, b, c]);
  for (const p of [a, b, c]) {
    assert.equal(p.model.title, "Renamed");
    assert.equal(Object.values(p.model.elements).filter((e) => e.page === "p9").length, 1, `${p.site} keeps the sticky`);
  }
  assert.deepEqual(recs(a), recs(b));
  assert.deepEqual(recs(b), recs(c));
});

test("spreadsheet: cells of a new sheet delivered before the sheet; concurrent cell edits merge", () => {
  const base = Sheet.newWorkbook({ sheets: ["S1"] });
  const sid = base.sheets[0].id;
  const a = new Peer(sheetApp.collabAdapter, base, "a");
  const b = new Peer(sheetApp.collabAdapter, base, "b");
  a.edit((m) => ({ ...m, sheets: [...m.sheets, { ...Sheet.newSheet("S2", "s2x", 2) }] }));
  a.edit((m) => Sheet.inputCell(m, "s2x", "B3", "42"));
  b.edit((m) => Sheet.inputCell(m, sid, "A1", "left"));
  a.edit((m) => Sheet.inputCell(m, sid, "A2", "right"));
  deliver([a, b], (msgs) => [...msgs].reverse());
  b.edit((m) => Sheet.inputCell(m, sid, "C1", "later"));
  deliver([a, b]);
  for (const p of [a, b]) {
    const s2 = p.model.sheets.find((s) => s.id === "s2x");
    assert.ok(s2, `${p.site} has the new sheet`);
    assert.equal(s2.cells.B3?.v, 42);
    const s1 = p.model.sheets.find((s) => s.id === sid);
    assert.equal(s1.cells.A1?.v, "left");
    assert.equal(s1.cells.A2?.v, "right");
    assert.equal(s1.cells.C1?.v, "later");
  }
  assert.deepEqual(recs(a), recs(b));
});

test("random concurrent spreadsheet edits converge on three peers with shuffled delivery", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed);
    const base = Sheet.newWorkbook({ sheets: ["S1"] });
    const sid = base.sheets[0].id;
    const peers = ["a", "b", "c"].map((s) => new Peer(sheetApp.collabAdapter, base, s));
    for (let step = 0; step < 30; step++) {
      const p = peers[Math.floor(r() * 3)];
      const cell = "ABC"[Math.floor(r() * 3)] + (1 + Math.floor(r() * 3));
      if (r() < 0.2) p.edit((m) => Sheet.clearRange(m, sid, Sheet.parseRange ? Sheet.parseRange(cell) : { r0: 0, c0: 0, r1: 0, c1: 0 }, { all: true }));
      else p.edit((m) => Sheet.inputCell(m, sid, cell, String(Math.floor(r() * 100))));
      if (r() < 0.3) deliver(peers, shuffle(r));
    }
    deliver(peers, shuffle(r));
    assert.deepEqual(recs(peers[0]), recs(peers[1]), `seed ${seed}`);
    assert.deepEqual(recs(peers[1]), recs(peers[2]), `seed ${seed}`);
  }
});

test("undo after a remote edit reverts only my step (core/office.js commitOffice + rebase)", () => {
  const base = Sheet.newWorkbook({ sheets: ["S1"] });
  const sid = base.sheets[0].id;
  const docA = new Doc({ name: "W", studio: "office" });
  docA.office = new OfficeProject(base, "sheet");
  const a = new Peer(sheetApp.collabAdapter, base, "a");
  const b = new Peer(sheetApp.collabAdapter, base, "b");
  const prj = docA.office;
  prj.rebase = (cur, from, to) => a.sync.rebase(cur, from, to);
  const sync = () => {
    a.model = prj.model;
    a.flush();
  };
  commitOffice(docA, "Type", Sheet.inputCell(prj.model, sid, "A1", "mine"));
  sync();
  b.edit((m) => Sheet.inputCell(m, sid, "B1", "theirs"));
  deliver([a, b]);
  prj.set(a.model, { origin: "collab" }); // the binding shows the remote edit (outside the history)
  docA.undo();
  sync();
  deliver([a, b]);
  for (const m of [prj.model, b.model]) {
    const s = m.sheets[0];
    assert.equal(s.cells.A1, undefined, "my edit is undone");
    assert.equal(s.cells.B1?.v, "theirs", "their edit survives my undo");
  }
  docA.redo();
  sync();
  deliver([a, b]);
  assert.equal(b.model.sheets[0].cells.A1?.v, "mine");
  assert.equal(b.model.sheets[0].cells.B1?.v, "theirs");
});

const para = (text) => ({ type: "paragraph", style: "Normal", runs: [{ text }] });
const texts = (m) => m.blocks.map((b) => b.runs?.map((r) => r.text).join("") ?? b.type);

test("word processor: different paragraphs merge, inserts at one place keep one order, late joiners get the state", () => {
  const base = Office.normalizeDoc({ ...Office.createDocument({ title: "Doc" }), blocks: [para("one"), para("two"), para("three")] });
  const a = new Peer(documentApp.collabAdapter, base, "a");
  const b = new Peer(documentApp.collabAdapter, base, "b");
  // the sharer's state lets B start from the same ids
  const joined = new Peer(documentApp.collabAdapter, base, "b2", a.sync.stateJSON());
  assert.deepEqual(texts(joined.model), ["one", "two", "three"]);
  const b2 = new Peer(documentApp.collabAdapter, a.model, "b", a.sync.stateJSON());
  a.edit((m) => ({ ...m, blocks: m.blocks.map((x, i) => (i === 0 ? para("ONE") : x)) }));
  b2.edit((m) => ({ ...m, blocks: m.blocks.map((x, i) => (i === 2 ? para("THREE") : x)) }));
  // both insert after "two"
  a.edit((m) => ({ ...m, blocks: [...m.blocks.slice(0, 2), para("from a"), ...m.blocks.slice(2)] }));
  b2.edit((m) => ({ ...m, blocks: [...m.blocks.slice(0, 2), para("from b"), ...m.blocks.slice(2)] }));
  deliver([a, b2], (msgs) => [...msgs].reverse());
  assert.deepEqual(texts(a.model), texts(b2.model));
  assert.deepEqual(texts(a.model).filter((x) => !x.startsWith("from")), ["ONE", "two", "THREE"]);
  assert.equal(texts(a.model).length, 5);
  void b;
});

test("word processor: splitting a paragraph and deleting one converge; undo restores my paragraph only", () => {
  const base = Office.normalizeDoc({ ...Office.createDocument({ title: "Doc" }), blocks: [para("alpha beta"), para("gamma"), para("delta")] });
  const docA = new Doc({ name: "D", studio: "office" });
  docA.office = new OfficeProject(base, "document");
  const a = new Peer(documentApp.collabAdapter, base, "a");
  const b = new Peer(documentApp.collabAdapter, base, "b", a.sync.stateJSON());
  const prj = docA.office;
  prj.rebase = (cur, from, to) => a.sync.rebase(cur, from, to);
  const sync = () => {
    a.model = prj.model;
    a.flush();
  };
  // A splits the first paragraph
  commitOffice(docA, "Split", { ...prj.model, blocks: [para("alpha"), para("beta"), ...prj.model.blocks.slice(1)] });
  sync();
  // B deletes "delta" and edits "gamma"
  b.edit((m) => ({ ...m, blocks: [m.blocks[0], para("GAMMA")] }));
  deliver([a, b]);
  prj.set(a.model, { origin: "collab" });
  assert.deepEqual(texts(prj.model), ["alpha", "beta", "GAMMA"]);
  assert.deepEqual(texts(b.model), texts(prj.model));
  docA.undo();
  sync();
  deliver([a, b]);
  assert.deepEqual(texts(prj.model), ["alpha beta", "GAMMA"], "undo reverts the split, keeps B's edits");
  assert.deepEqual(texts(b.model), texts(prj.model));
});

test("word processor: the caret's paragraph is found again after remote inserts above it", () => {
  const p = [para("a"), para("b"), para("c")];
  const next = [para("new"), p[0], p[1], p[2]];
  assert.equal(remapBlockIndex(p, next, 2), 3);
  const edited = [para("new"), p[0], para("B!"), p[2]];
  assert.equal(remapBlockIndex(p, edited, 1), 2, "an edited block maps by its unchanged neighbor");
  const d = new DocRecords();
  const r1 = d.records({ blocks: p });
  const r2 = d.records({ blocks: [p[0], para("x"), p[1], p[2]] });
  const ids = (r) => Object.keys(r).filter((k) => k.startsWith("blk:"));
  assert.equal(ids(r2).length, 4);
  for (const k of ids(r1)) assert.equal(r2[k], r1[k], "unchanged blocks keep id, key and record identity");
});

test("presentation and scene: concurrent edits of different objects merge", () => {
  const deck = Slides.createDeck({ template: "blank", title: "Deck" });
  const a = new Peer(slidesApp.collabAdapter, deck, "a");
  const b = new Peer(slidesApp.collabAdapter, deck, "b");
  a.edit((m) => Slides.addSlide(m, { layout: "title-content" }).deck);
  b.edit((m) => ({ ...m, slides: m.slides.map((s, i) => (i === 0 ? { ...s, notes: "speaker" } : s)) }));
  deliver([a, b], (msgs) => [...msgs].reverse());
  assert.equal(a.model.slides.length, 2);
  assert.equal(b.model.slides.length, 2);
  assert.equal(a.model.slides[0].notes, "speaker");
  assert.deepEqual(recs(a), recs(b));

  const scene = Scene.emptyScene({ title: "S" });
  const v = scene.tracks.find((t) => t.kind === "video").id;
  const sa = new Peer(sceneCollabAdapter, scene, "a");
  const sb = new Peer(sceneCollabAdapter, scene, "b", sa.sync.stateJSON());
  sa.edit((m) => ({ ...m, clips: { ...m.clips, c1: Scene.normalizeClip(m, { id: "c1", type: "solid", track: v, start: 0, dur: 2, color: "#ff0000" }) } }));
  sb.edit((m) => ({ ...m, markers: [{ id: "m1", t: 1, name: "Beat", color: "#f59e0b" }] }));
  deliver([sa, sb]);
  for (const p of [sa, sb]) {
    assert.ok(p.model.clips.c1, `${p.site} has the clip`);
    assert.equal(p.model.markers.length, 1);
  }
  assert.deepEqual(recs(sa), recs(sb));
});

test("large images travel as chunks and are assembled; the snapshot state carries no chunks", () => {
  const big = new Uint8Array(BLOB_CHUNK * 3 + 17).map((_, i) => (i * 31) & 255);
  const base = Board.normalizeBoard(Board.emptyModel({ title: "B" }));
  const a = new Peer(boardApp.collabAdapter, base, "a");
  const b = new Peer(boardApp.collabAdapter, base, "b");
  a.edit((m) => ({ ...m, media: { ...m.media, img1: { id: "img1", mime: "image/png", name: "x.png", w: 10, h: 10, bytes: big } } }));
  deliver([a, b], (msgs) => [...msgs].reverse());
  assert.ok(b.model.media.img1?.bytes instanceof Uint8Array, "B has the bytes");
  assert.deepEqual([...b.model.media.img1.bytes], [...big]);
  const state = a.sync.stateJSON();
  assert.ok(!Object.keys(state.map).some((k) => k.startsWith("blob:")), "chunks are not in the snapshot state");
  // a late joiner from the snapshot (bytes in the model) and the state: nothing to send back
  const c = new Peer(boardApp.collabAdapter, a.model, "c", JSON.parse(JSON.stringify(state)));
  c.flush();
  assert.equal(c.out.length, 0);
});

test("a value too large for one record is kept back instead of breaking the whole message", () => {
  const base = Board.normalizeBoard(Board.emptyModel({ title: "B" }));
  const a = new Peer(boardApp.collabAdapter, base, "a");
  const b = new Peer(boardApp.collabAdapter, base, "b");
  const page = base.pages[0].id;
  const pts = Array.from({ length: 9000 }, (_, i) => [i, Math.sin(i) * 100]);
  a.edit((m) => Board.addElements(m, [Board.makeElement("pen", { page, x: 0, y: 0, w: 10, h: 10, points: pts }), Board.makeElement("sticky", { page, x: 5, y: 5, w: 50, h: 50, text: "small" })]));
  assert.ok(a.sync.skipped >= 1);
  deliver([a, b]);
  assert.ok(Object.values(b.model.elements).some((e) => e.type === "sticky"), "the small element still arrives");
});

test("non-editors: rollback restores the shared values without sending", () => {
  const base = Sheet.newWorkbook({ sheets: ["S1"] });
  const sid = base.sheets[0].id;
  const v = new Peer(sheetApp.collabAdapter, Sheet.inputCell(base, sid, "A1", "shared"), "v");
  const local = Sheet.inputCell(v.model, sid, "A1", "mine");
  assert.ok(v.sync.dirty(local));
  const back = v.sync.rollback(local);
  assert.equal(back.sheets[0].cells.A1.v, "shared");
  assert.equal(v.sync.dirty(back), false);
});
