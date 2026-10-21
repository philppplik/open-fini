import test from "node:test";
import assert from "node:assert/strict";
import { parseSelector, queryFacts, resolveRefs, sceneText, gridCells, distribute, page, nearest, globToRegExp, resultValue } from "../../app/src/vibe/query.js";
import { activityLabel, pillText } from "../../app/src/ui/vibe/activity-label.js";

const facts = [
  { id: "n1", type: "rect", name: "Card A", x: 0, y: 0, w: 200, h: 100, fill: "#3b82f6", visible: true },
  { id: "n2", type: "rect", name: "Card B", x: 300, y: 0, w: 50, h: 50, fill: "#ef4444", visible: false },
  { id: "n3", type: "text", name: "Title", x: 10, y: 10, w: 100, h: 20, text: "Summer SALE now", parentId: "g1", ancestors: ["g1"] },
  { id: "g1", type: "group", name: "Hero", x: 0, y: 0, w: 400, h: 300, childCount: 1 },
];
const ids = (q) => queryFacts(facts, q).map((f) => f.id);

test("query: attributes, globs, bounds, parent", () => {
  assert.deepEqual(ids({ type: "rect" }), ["n1", "n2"]);
  assert.deepEqual(ids({ name: "card*" }), ["n1", "n2"]);
  assert.deepEqual(ids({ fill: "#3B82F6" }), ["n1"]);
  assert.deepEqual(ids({ text: "sale" }), ["n3"]);
  assert.deepEqual(ids({ visible: false }), ["n2"]);
  assert.deepEqual(ids({ within: { x: 0, y: 0, w: 250, h: 150 } }), ["n1", "n3"]);
  assert.deepEqual(ids({ intersects: { x: 320, y: 10, w: 5, h: 5 } }), ["n2", "g1"]);
  assert.deepEqual(ids({ parent: "g1" }), ["n3"]);
  assert.deepEqual(ids({ type: ["text", "group"], minW: 150 }), ["g1"]);
});

test("query: selector mini-language", () => {
  assert.deepEqual(ids({ selector: 'rect[name^="Card"][w>100]' }), ["n1"]);
  assert.deepEqual(ids({ selector: 'text[text*="sale"], group' }), ["n3", "g1"]);
  assert.deepEqual(ids({ selector: "[name=Card?A]" }), ["n1"]);
  assert.deepEqual(ids({ selector: "*[fill!=#3b82f6][type=rect]" }), ["n2"]);
  assert.equal(parseSelector("rect, text").length, 2);
  assert.throws(() => parseSelector("rect[name"), /Cannot parse the selector/);
  assert.ok(globToRegExp("a*b?").test("AxxbZ"));
});

test("run_plan refs: paths, splicing arrays, helpful errors", () => {
  const results = { bg: { id: "n9" }, cards: { ids: ["c1", "c2"] }, 1: { page: { id: "p1" } } };
  assert.deepEqual(resolveRefs({ ids: [{ $ref: "bg.id" }, { $ref: "cards.ids" }], parent: "$ref:1.page.id" }, results), { ids: ["n9", "c1", "c2"], parent: "p1" });
  assert.deepEqual(resolveRefs({ first: { $ref: "cards.ids[1]" } }, results), { first: "c2" });
  assert.throws(() => resolveRefs({ x: { $ref: "nope.id" } }, results), /no earlier step “nope”.*Known steps/);
  assert.throws(() => resolveRefs({ x: { $ref: "bg.missing" } }, results), /has no “missing”.*id/);
  assert.deepEqual(resultValue('{"a":1}'), { a: 1 });
  assert.equal(resultValue([{ type: "text", text: "hi" }, { type: "image", data: "" }]), "hi");
});

test("scene text is compact and complete", () => {
  const tree = [{ ...facts[3], children: [facts[2]] }, facts[0], facts[1]];
  const s = sceneText(tree);
  assert.match(s, /^g1 group "Hero" 0,0 400x300/m);
  assert.match(s, /^ {2}n3 text "Title" 10,10 100x20 text="Summer SALE now"/m);
  assert.match(s, /n2 rect "Card B" 300,0 50x50 fill=#ef4444 hidden/);
  const json = JSON.stringify(tree);
  assert.ok(s.length * 2 < json.length, "scene text is much smaller than JSON");
  assert.match(sceneText(tree, { maxDepth: 0 }), /\+1 children/);
  assert.match(sceneText(tree, { maxLines: 1 }), /more layers/);
});

test("layout helpers: grid cells, distribute, paging, nearest", () => {
  const cells = gridCells({ x: 0, y: 0, w: 320, h: 100, columns: 3, gap: 10, count: 4 });
  assert.equal(cells.length, 4);
  assert.deepEqual(cells[1], { x: 110, y: 0, w: 100, h: 45, row: 0, col: 1 });
  assert.equal(cells[3].row, 1);
  assert.throws(() => gridCells({ w: 10, h: 10, columns: 5, gap: 10 }), /too small/);
  assert.deepEqual(distribute([{ x: 0, w: 10 }, { x: 100, w: 10 }, { x: 30, w: 10 }], "x"), [0, 100, 50]);
  assert.deepEqual(distribute([{ y: 0, h: 10 }, { y: 5, h: 10 }], "y", 4), [0, 14]);
  const p = page([{ a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5 }], { offset: 1, limit: 1, fields: ["a"] });
  assert.deepEqual(p, { items: [{ a: 3 }], total: 3, offset: 1, limit: 1, more: true });
  assert.equal(nearest("add_shap", ["add_text", "add_shape", "set_style"])[0], "add_shape");
});

test("activity labels for the AI pill", () => {
  assert.equal(activityLabel("add_shape"), "adding shapes");
  assert.equal(activityLabel("add_text"), "adding text");
  assert.equal(activityLabel("run_plan"), "running a plan");
  assert.equal(activityLabel("git_commit"), "working with Git");
  assert.equal(activityLabel("mcp_x_y"), "using a connected tool");
  assert.equal(activityLabel(""), "working");
  assert.equal(activityLabel("frobnicate"), "working");
  assert.equal(pillText([]), "");
  assert.equal(pillText([{ activity: "screenshot" }]), "AI is checking the result…");
  assert.equal(pillText([{ activity: "x", waiting: true }]), "AI needs your approval");
  assert.equal(pillText([{}, {}]), "2 AI tasks running");
});
