import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotNodes, diffLayers, describeLayerChange, describeProp, diffFiles, officeParagraphs, diffParagraphs, revertBlock, textBlocks, combineCalls, touchedOnly, sameLayer, computeSet, statOf, badgeText, canRevertLayer, revertPatch, propJson, MAX_PROP_JSON } from "../../app/src/ui/vibe/changes.js";

const solid = (color) => ({ type: "solid", color, alpha: 1 });
const page = (children) => ({ id: "root", type: "group", children });
const rect = (id, o = {}) => ({ id, type: "rect", name: "Hero", m: [1, 0, 0, 1, 40, 10], fill: solid("#ffffff"), opacity: 1, _rev: 3, ...o });

test("snapshot ignores children, internal fields and binary values", () => {
  const { map } = snapshotNodes([page([rect("a", { _cache: 1, pixelsBuf: new Uint8Array(4), children: [rect("b")] })])]);
  assert.deepEqual([...map.keys()], ["a", "b"]);
  const a = map.get("a");
  assert.equal(a.props._cache, undefined);
  assert.equal(a.props.pixelsBuf, undefined);
  assert.equal(a.props.children, undefined);
  assert.equal(map.get("b").parentId, "a");
  assert.equal(propJson(undefined), null);
  assert.match(propJson("x".repeat(MAX_PROP_JSON + 5)), /^#hash:/);
});

test("snapshot limit reports truncation", () => {
  const { map, truncated } = snapshotNodes([page([rect("a"), rect("b"), rect("c")])], { limit: 2 });
  assert.equal(map.size, 2);
  assert.ok(truncated);
});

test("diffLayers: property changes, added and removed layers, readable lines", () => {
  const before = snapshotNodes([page([rect("a"), rect("gone", { name: "Old" })])]).map;
  const after = snapshotNodes([page([rect("a", { fill: solid("#0a84ff"), m: [1, 0, 0, 1, 80, 10] }), { id: "n", type: "text", name: "Title", m: [1, 0, 0, 1, 0, 0] }])]).map;
  const d = diffLayers(before, after);
  const byId = Object.fromEntries(d.map((c) => [c.id, c]));
  assert.equal(byId.a.kind, "changed");
  assert.equal(describeLayerChange(byId.a), "Rectangle “Hero”: x 40 → 80, fill #ffffff → #0a84ff");
  assert.equal(byId.n.kind, "added");
  assert.equal(describeLayerChange(byId.n), "Text “Title”: added");
  assert.equal(byId.gone.kind, "removed");
  assert.ok(canRevertLayer(byId.a) && canRevertLayer(byId.gone) && canRevertLayer(byId.n));
  assert.deepEqual(revertPatch(byId.a), { fill: solid("#ffffff"), m: [1, 0, 0, 1, 40, 10] });
});

test("diffLayers: a new neighbour is not reported as a move, a real reorder is", () => {
  const before = snapshotNodes([page([rect("a"), rect("b")])]).map;
  const inserted = snapshotNodes([page([rect("a"), rect("new"), rect("b")])]).map;
  assert.deepEqual(diffLayers(before, inserted).map((c) => c.id), ["new"]);
  const swapped = snapshotNodes([page([rect("b"), rect("a")])]).map;
  assert.ok(diffLayers(before, swapped).every((c) => c.moved));
});

test("describeProp formats opacity, booleans, strokes, pixels and unknown shapes", () => {
  assert.deepEqual(describeProp("opacity", "1", "0.5"), ["opacity 100% → 50%"]);
  assert.deepEqual(describeProp("visible", "true", "false"), ["visible on → off"]);
  assert.deepEqual(describeProp("pixels", "1", "2"), ["pixels changed"]);
  assert.deepEqual(describeProp("path", "[]", "[1]"), ["shape changed"]);
  assert.deepEqual(describeProp("name", null, '"X"'), ["name set to “X”"]);
  assert.deepEqual(describeProp("m", "[1,0,0,1,0,0]", "[0,1,-1,0,0,0]"), ["rotation 0° → 90°"]);
  assert.deepEqual(describeProp("stroke", JSON.stringify({ fill: solid("#000000"), width: 1 }), JSON.stringify({ fill: solid("#ff0000"), width: 2 })), ["stroke #000000 1 px → #ff0000 2 px"]);
});

test("pixel layers record their revision: pixel edits are visible but not revertible", () => {
  const before = snapshotNodes([page([{ id: "p", type: "pixel", name: "Paint", _rev: 1 }])]).map;
  const after = snapshotNodes([page([{ id: "p", type: "pixel", name: "Paint", _rev: 2 }])]).map;
  const [c] = diffLayers(before, after);
  assert.equal(describeLayerChange(c), "Pixel layer “Paint”: pixels changed");
  assert.equal(canRevertLayer(c), false);
});

test("diffFiles: added, removed, modified, binary and too-large files", () => {
  const before = new Map([["a.css", "a{}\n"], ["gone.js", "x\n"], ["img.png", { binary: true, size: 3, rev: 1 }], ["big.txt", "1\n"]]);
  const after = new Map([["a.css", "a{}\nb{}\n"], ["new.html", "<p>\n"], ["img.png", { binary: true, size: 4, rev: 2 }], ["big.txt", "x\n".repeat(30)]]);
  const d = diffFiles(before, after, { maxChars: 20 });
  const by = Object.fromEntries(d.map((f) => [f.path, f]));
  assert.deepEqual([by["a.css"].kind, by["a.css"].add, by["a.css"].del], ["modified", 1, 0]);
  assert.deepEqual([by["gone.js"].kind, by["gone.js"].del], ["removed", 1]);
  assert.deepEqual([by["new.html"].kind, by["new.html"].add], ["added", 1]);
  assert.ok(by["img.png"].binary);
  assert.ok(by["big.txt"].tooLarge);
  assert.equal(by["big.txt"].add, 30);
});

test("revertBlock restores one change block and keeps the others", () => {
  const a = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
  const b = "1\nTWO\n3\n4\n5\n6\n7\nEIGHT\n9\n";
  assert.equal(textBlocks(a, b).length, 2);
  assert.equal(revertBlock(a, b, 0), "1\n2\n3\n4\n5\n6\n7\nEIGHT\n9\n");
  assert.equal(revertBlock(a, b, 1), "1\nTWO\n3\n4\n5\n6\n7\n8\n9\n");
  assert.equal(revertBlock(a, b, 5), b);
});

test("officeParagraphs and diffParagraphs give a paragraph-level diff", () => {
  const m1 = { blocks: [{ type: "paragraph", runs: [{ text: "Hello " }, { text: "world" }] }, { type: "paragraph", runs: [{ text: "Bye" }] }] };
  const m2 = { blocks: [{ type: "paragraph", runs: [{ text: "Hello world" }] }, { type: "paragraph", runs: [{ text: "See you" }] }] };
  const a = officeParagraphs(m1);
  assert.deepEqual(a, ["Hello world", "Bye"]);
  const d = diffParagraphs(a, officeParagraphs(m2));
  assert.deepEqual(d.rows.map((r) => r.t), ["ctx", "del", "add"]);
  assert.deepEqual([d.add, d.del], [1, 1]);
});

test("combineCalls keeps the earliest before and the latest after; add-then-remove cancels out", () => {
  const s = (o) => ({ id: o.id, type: "rect", name: "", parentId: "root", prevId: null, props: o.props });
  const call1 = { layers: { before: new Map([["a", s({ id: "a", props: { x: "1" } })]]), after: new Map([["a", s({ id: "a", props: { x: "2" } })], ["t", s({ id: "t", props: {} })]]) }, files: { before: new Map([["f", "1\n"]]), after: new Map([["f", "2\n"]]) } };
  const call2 = { layers: { before: new Map([["a", s({ id: "a", props: { x: "2" } })], ["t", s({ id: "t", props: {} })]]), after: new Map([["a", s({ id: "a", props: { x: "3" } })]]) }, files: { before: new Map([["f", "2\n"]]), after: new Map([["f", "3\n"]]) } };
  const run = computeSet(combineCalls([call1, call2]));
  assert.deepEqual(run.layers.map((c) => [c.id, c.kind, c.props[0]?.before, c.props[0]?.after]), [["a", "changed", "1", "3"]]);
  assert.deepEqual(run.files.map((f) => [f.before, f.after]), [["1\n", "3\n"]]);
  const st = statOf(run);
  assert.deepEqual([st.add, st.del, st.layers, st.files, st.empty], [1, 1, 1, 1, false]);
  assert.equal(badgeText(st), "+1 −1 · 1 layer");
  assert.ok(statOf(computeSet({})).empty);
});

test("touchedOnly keeps only differing keys", () => {
  const s = (x) => ({ parentId: "r", prevId: null, props: { x } });
  const t = touchedOnly(new Map([["a", s("1")], ["b", s("1")]]), new Map([["a", s("1")], ["b", s("2")], ["c", s("0")]]), sameLayer);
  assert.deepEqual([...t.before.keys()], ["b"]);
  assert.deepEqual([...t.after.keys()], ["b", "c"]);
});
