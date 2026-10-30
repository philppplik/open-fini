// Whiteboard app (Office Suite kind "board"): model operations, connectors, collaboration records, templates and the
// Excalidraw / tldraw codecs (round trips and hostile input).
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/office/board/model.js";
import { readExcalidraw, writeExcalidraw, readTldraw, writeTldraw, parseJson } from "../../app/src/office/board/formats.js";
import { pageDisplayList, inkOutline, wrapText } from "../../app/src/office/board/render.js";
import { BOARD_APP } from "../../app/src/office/board/manifest.js";
import { officeApp, appForFile, checkImpl } from "../../app/src/office/index.js";

const board = () => {
  let m = M.emptyModel({ title: "T" });
  const a = M.makeElement("rect", { id: "a", x: 0, y: 0, w: 100, h: 60, text: "A" });
  const b = M.makeElement("ellipse", { id: "b", x: 300, y: 0, w: 100, h: 60 });
  const c = M.makeElement("arrow", { id: "c", points: [[50, 30], [350, 30]], start: { id: "a" }, end: { id: "b" } });
  m = M.addElements(m, [a, b, c]);
  return m;
};

test("manifest registers the board app for .excalidraw and .tldraw", async () => {
  assert.equal(officeApp("board")?.label, "Whiteboard");
  assert.equal(appForFile("x.excalidraw").app.kind, "board");
  assert.equal(appForFile("x.tldraw").format.id, "tldraw");
  assert.ok(BOARD_APP.templates.some((t) => t.id === "kanban"));
  const impl = checkImpl("board", await BOARD_APP.load());
  for (const t of ["blank", "brainstorm", "kanban", "flowchart", "notebook"]) assert.ok(Object.keys(impl.create({ template: t }).pages).length, t);
});

test("connectors attach to the outline and follow moved shapes", () => {
  let m = board();
  let c = m.elements.c;
  const [s, e] = M.absPoints(c);
  assert.ok(s[0] > 100 && s[0] < 110, `start on the rect edge: ${s}`);
  assert.ok(e[0] < 300 && e[0] > 290, `end on the ellipse edge: ${e}`);
  m = M.moveElements(m, ["b"], 0, 200);
  c = m.elements.c;
  const end = M.absPoints(c)[1];
  assert.ok(end[1] > 150, "the arrow end moved with the ellipse");
  m = M.removeElements(m, ["b"]);
  assert.equal(m.elements.c.end, null, "binding dropped with its target");
});

test("z-order, grouping, alignment, distribution, duplication and arrange", () => {
  let m = board();
  const top = () => M.pageElements(m, "p1").at(-1).id;
  m = M.reorderElements(m, ["a"], "front");
  assert.equal(top(), "a");
  m = M.reorderElements(m, ["a"], "back");
  assert.equal(M.pageElements(m, "p1")[0].id, "a");
  m = M.groupElements(m, ["a", "b"]);
  assert.ok(m.elements.a.group && m.elements.a.group === m.elements.b.group);
  assert.deepEqual(M.expandSelection(m, ["a"]).sort(), ["a", "b"]);
  m = M.ungroupElements(m, ["a"]);
  assert.equal(m.elements.b.group, null);
  m = M.updateElements(m, { b: { y: 40 } });
  m = M.alignElements(m, ["a", "b"], "top");
  assert.equal(m.elements.b.y, 0);
  const d = M.duplicateElements(m, ["a", "b", "c"]);
  assert.equal(d.ids.length, 3);
  const copyArrow = d.ids.map((id) => d.model.elements[id]).find((e) => e.type === "arrow");
  assert.ok(d.ids.includes(copyArrow.start.id), "copied arrow binds to the copied shape");
  let n = M.addElements(M.emptyModel(), [0, 1, 2].map((i) => M.makeElement("rect", { id: `r${i}`, x: i * 10, y: 0, w: 50, h: 50 })));
  n = M.distributeElements(n, ["r0", "r1", "r2"], "horizontal");
  n = M.arrangeElements(n, ["r0", "r1", "r2"], { layout: "row", gap: 10 });
  assert.deepEqual(["r0", "r1", "r2"].map((id) => n.elements[id].x), [0, 60, 120]);
  const f = M.arrangeElements(board(), ["a", "b"], { layout: "flow" });
  assert.ok(f.elements.b.x > f.elements.a.x + f.elements.a.w, "flow puts the target right of the source");
});

test("resize, rotate, hit testing and frames", () => {
  let m = board();
  const r = M.resizeElement(m.elements.a, { x: 0, y: 0, w: 200, h: 120 });
  assert.equal(r.w, 200);
  const pen = M.makeElement("pen", { points: [[0, 0, 0.5], [10, 10, 1]] });
  const pr = M.resizeElement(pen, { x: pen.x, y: pen.y, w: 20, h: 20 });
  assert.deepEqual(pr.points[1].slice(0, 2), [20, 20]);
  m = M.rotateElements(m, ["a"], M.center(m.elements.a), Math.PI / 2);
  assert.ok(Math.abs(m.elements.a.angle - Math.PI / 2) < 1e-3);
  assert.ok(M.hitTest(m.elements.a, 50, 30));
  assert.equal(M.elementAt(m, "p1", 1000, 1000), null);
  m = M.addElements(m, [M.makeElement("frame", { id: "f", x: -50, y: -50, w: 600, h: 200 })]);
  m = M.assignFrames(m, ["a", "b"]);
  assert.equal(m.elements.a.frame, "f");
  const moved = M.moveElements(m, M.expandSelection(m, ["f"]), 10, 0);
  assert.equal(moved.elements.b.x, m.elements.b.x + 10, "frame children move with it");
});

test("pages: add, move, remove", () => {
  let m = board();
  const r = M.addPage(m, { name: "Two", paper: "lines" });
  m = M.addElements(r.model, [M.makeElement("sticky", { page: r.page, text: "hi" })]);
  assert.deepEqual(M.sortedPages(m).map((p) => p.name), ["Page 1", "Two"]);
  m = M.movePage(m, r.page, -1);
  assert.equal(M.sortedPages(m)[0].id, r.page);
  m = M.removePage(m, r.page);
  assert.equal(m.pages.length, 1);
  assert.ok(!Object.values(m.elements).some((e) => e.page === r.page));
});

test("collaboration records round trip and apply per element", () => {
  const m = board();
  m.media = { m1: { id: "m1", mime: "image/png", bytes: new Uint8Array([1, 2, 3]) } };
  const rec = M.boardRecords(m);
  assert.ok(rec["el:a"] && rec["page:p1"] && rec["media:m1"].data);
  const back = M.applyBoardRecords(M.emptyModel(), rec);
  assert.deepEqual(Object.keys(back.elements).sort(), ["a", "b", "c"]);
  assert.deepEqual([...back.media.m1.bytes], [1, 2, 3]);
  const next = M.applyBoardRecords(back, { "el:a": null, "el:b": { ...back.elements.b, x: 999 } });
  assert.equal(next.elements.a, undefined);
  assert.equal(next.elements.b.x, 999);
  for (const v of Object.values(rec)) assert.ok(JSON.stringify(v).length < 64 * 1024);
});

test("describe lists ids, texts and connections", () => {
  const d = M.describeBoard(board());
  assert.equal(d.elements, 3);
  assert.equal(d.items.find((i) => i.id === "c").to, "b");
  assert.equal(d.items.find((i) => i.id === "a").text, "A");
});

test("render: display lists, ink outline and wrapping", () => {
  const m = M.templateBoard("flowchart");
  const dl = pageDisplayList(m, "p1");
  assert.ok(dl.width > 0 && dl.items.length >= 2);
  const poly = inkOutline([[0, 0, 0.5], [10, 0, 0.5], [20, 0, 1]], 4);
  assert.ok(poly.length > 6 && poly.every((p) => p.every(Number.isFinite)));
  assert.deepEqual(wrapText("aa bb cc", 25, 10, (s) => s.length * 6), ["aa", "bb", "cc"]);
});

test("Excalidraw: read, write and round trip", () => {
  const src = {
    type: "excalidraw",
    version: 2,
    elements: [
      { id: "r", type: "rectangle", x: 0, y: 0, width: 100, height: 50, strokeColor: "#1971c2", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 2, roughness: 1, opacity: 100, groupIds: [], boundElements: [{ id: "t", type: "text" }] },
      { id: "t", type: "text", x: 10, y: 10, width: 80, height: 25, text: "Hello", fontSize: 20, fontFamily: 1, textAlign: "center", containerId: "r" },
      { id: "e", type: "ellipse", x: 300, y: 0, width: 80, height: 80 },
      { id: "ar", type: "arrow", x: 100, y: 25, width: 200, height: 0, points: [[0, 0], [200, 0]], startBinding: { elementId: "r" }, endBinding: { elementId: "e" }, endArrowhead: "arrow" },
      { id: "fd", type: "freedraw", x: 0, y: 200, width: 20, height: 20, points: [[0, 0], [10, 10], [20, 5]], pressures: [0.2, 0.5, 0.9], simulatePressure: false },
      { id: "x", type: "embeddable", x: 0, y: 0, width: 10, height: 10 },
      { id: "gone", type: "rectangle", isDeleted: true },
    ],
    appState: { viewBackgroundColor: "#fafafa" },
    files: {},
  };
  const notes = [];
  const report = { kept() {}, simplified() {}, dropped: (w) => notes.push(w) };
  const m = readExcalidraw(src, report);
  assert.equal(m.background, "#fafafa");
  assert.equal(m.elements.r.text, "Hello");
  assert.equal(m.elements.ar.start.id, "r");
  assert.equal(m.elements.fd.type, "pen");
  assert.equal(m.elements.fd.points[2][2], 0.9);
  assert.ok(!m.elements.gone && !m.elements.t);
  assert.ok(notes.some((n) => /embeddable/.test(n)));
  const out = writeExcalidraw(m).json;
  assert.equal(out.type, "excalidraw");
  assert.ok(out.elements.find((e) => e.id === "e").boundElements.some((b) => b.id === "ar"), "arrows register on targets");
  const again = readExcalidraw(JSON.parse(JSON.stringify(out)));
  assert.equal(again.elements.r.text, "Hello");
  assert.equal(again.elements.ar.end.id, "e");
  assert.equal(Object.keys(again.elements).length, Object.keys(m.elements).length);
});

test("Excalidraw: several pages become frames; stickies become rectangles", () => {
  let m = M.templateBoard("notebook");
  m = M.addElements(m, [M.makeElement("sticky", { page: "p2", text: "note" })]);
  const { json, notes } = writeExcalidraw(m);
  assert.equal(json.elements.filter((e) => e.type === "frame").length, 3);
  assert.ok(notes.some((n) => /Sticky/.test(n)) && notes.some((n) => /Pages/.test(n)));
});

test("tldraw: write and read back", () => {
  let m = board();
  m = M.addElements(m, [M.makeElement("sticky", { id: "s", x: 0, y: 200, text: "Note" }), M.makeElement("text", { id: "tx", x: 0, y: 500, text: "Words" }), M.makeElement("pen", { id: "p", points: [[0, 0, 0.3], [5, 5, 0.6]] })]);
  m.media = { im: { id: "im", mime: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) } };
  m = M.addElements(m, [M.makeElement("image", { id: "i", x: 0, y: 0, w: 10, h: 10, media: "im" })]);
  const { json } = writeTldraw(m);
  assert.equal(json.tldrawFileFormatVersion, 1);
  assert.ok(json.records.some((r) => r.typeName === "binding" && r.toId === "shape:b"));
  const back = readTldraw(JSON.parse(JSON.stringify(json)));
  const els = Object.values(back.elements);
  const arrow = els.find((e) => e.type === "arrow");
  assert.equal(arrow.end.id, "b");
  assert.equal(els.find((e) => e.type === "sticky").text, "Note");
  assert.equal(els.find((e) => e.type === "text").text, "Words");
  assert.equal(els.find((e) => e.type === "rect").text, "A");
  assert.ok(Math.abs(els.find((e) => e.type === "rect").x - m.elements.a.x) < 0.01);
  assert.deepEqual([...Object.values(back.media)[0].bytes], [137, 80, 78, 71]);
});

test("tldraw: rich text and unknown shapes", () => {
  const notes = [];
  const json = {
    tldrawFileFormatVersion: 1,
    records: [
      { id: "page:a", typeName: "page", name: "P", index: "a1" },
      { id: "shape:1", typeName: "shape", type: "geo", parentId: "page:a", x: 0, y: 0, rotation: 0, index: "a1", props: { geo: "star", w: 10, h: 10, richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] } } },
      { id: "shape:2", typeName: "shape", type: "embed", parentId: "page:a", x: 0, y: 0, index: "a2", props: {} },
    ],
  };
  const m = readTldraw(json, { kept() {}, simplified: (w) => notes.push(w), dropped: (w) => notes.push(w) });
  assert.equal(Object.values(m.elements)[0].text, "Hi");
  assert.ok(notes.some((n) => /rectangles/.test(n)) && notes.some((n) => /embed/.test(n)));
});

test("hostile input is rejected or contained", () => {
  assert.throws(() => parseJson(new TextEncoder().encode("{not json")), /JSON/);
  assert.throws(() => readExcalidraw({ nope: 1 }), /Excalidraw/);
  assert.throws(() => readTldraw({}), /tldraw/);
  const m = readExcalidraw({ elements: [{ id: "../x", type: "rectangle", x: "NaN", y: Infinity, width: -5 }, null, 7, { type: "line", points: "x" }] });
  const el = Object.values(m.elements)[0];
  assert.match(el.id, /^[\w-]+$/);
  assert.ok([el.x, el.y, el.w].every(Number.isFinite));
  const n = M.normalizeBoard({ pages: "x", elements: { a: { type: "evil" }, b: { type: "pen", points: [] } } });
  assert.equal(Object.keys(n.elements).length, 0);
});
