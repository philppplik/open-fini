import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTrigger, fuzzyMatch, rankItems, groupResults, highlightParts, buildContextBlocks, composeMessage, parseContextBlocks, chipLabel, CONTEXT_MARKER } from "../../app/src/ui/vibe/mentions.js";

test("detectTrigger: at line start, after whitespace, never mid-word", () => {
  assert.deepEqual(detectTrigger("@ind", 4), { trigger: "@", query: "ind", start: 0, end: 4 });
  assert.deepEqual(detectTrigger("fix @css/sty please", 12), { trigger: "@", query: "css/sty", start: 4, end: 11 + 1 });
  assert.equal(detectTrigger("mail@example.com", 16), null);
  assert.equal(detectTrigger("Hello!", 6), null);
  assert.deepEqual(detectTrigger("first line\n/sk", 14), { trigger: "/", query: "sk", start: 11, end: 14 });
  assert.deepEqual(detectTrigger("use !add_sh", 11), { trigger: "!", query: "add_sh", start: 4, end: 11 });
  assert.deepEqual(detectTrigger("go @", 4), { trigger: "@", query: "", start: 3, end: 4 });
});

test("detectTrigger: IME composition, paths and doubled triggers do not open the menu", () => {
  assert.equal(detectTrigger("@ab", 3, { composing: true }), null);
  assert.equal(detectTrigger("see /usr/bin", 12), null);
  assert.equal(detectTrigger("!!", 2), null);
  assert.equal(detectTrigger("plain text", 5), null);
  assert.equal(detectTrigger("", 0), null);
  assert.equal(detectTrigger("@x", 2, { triggers: ["/"] }), null);
});

test("detectTrigger: caret in the middle of a token reports the whole token end", () => {
  const r = detectTrigger("@index.html rest", 3);
  assert.equal(r.query, "in");
  assert.equal(r.end, 11);
});

test("fuzzyMatch: substring beats subsequence, word starts beat inner matches", () => {
  const sub = fuzzyMatch("style", "css/style.css");
  const seq = fuzzyMatch("stc", "css/style.css");
  assert.ok(sub && seq);
  assert.ok(sub.score > seq.score);
  assert.deepEqual(sub.ranges, [[4, 9]]);
  assert.equal(fuzzyMatch("zz", "abc"), null);
  const ws = fuzzyMatch("as", "add_shape");
  assert.deepEqual(ws.ranges, [[0, 1], [4, 5]]);
  assert.deepEqual(fuzzyMatch("", "abc"), { score: 0, ranges: [] });
});

test("rankItems orders by score and keeps the input order for ties", () => {
  const items = [{ label: "query_layers" }, { label: "add_shape" }, { label: "add_text" }, { label: "set_fill" }];
  assert.deepEqual(rankItems("add", items).map((r) => r.item.label), ["add_text", "add_shape"]); // shorter wins a tie of equal prefixes
  assert.deepEqual(rankItems("", items).map((r) => r.item.label), ["query_layers", "add_shape", "add_text", "set_fill"]);
  assert.equal(rankItems("a", items, { limit: 2 }).length, 2);
});

test("groupResults keeps the order without a query and sorts by best score with one", () => {
  const ranked = [{ item: { g: "files" }, score: 10 }, { item: { g: "layers" }, score: 50 }];
  assert.deepEqual(groupResults(ranked, (x) => x.g, ["files", "layers"]).map((g) => g.group), ["files", "layers"]);
  assert.deepEqual(groupResults(ranked, (x) => x.g, ["files", "layers"], "q").map((g) => g.group), ["layers", "files"]);
});

test("highlightParts splits text around matched ranges", () => {
  assert.deepEqual(highlightParts("add_shape", [[0, 1], [4, 5]]), [{ text: "a", hit: true }, { text: "dd_", hit: false }, { text: "s", hit: true }, { text: "hape", hit: false }]);
});

test("buildContextBlocks: files with capped excerpts, layers with bounds, tools as MUST lines", () => {
  const out = buildContextBlocks([
    { kind: "file", path: "index.html", content: "x".repeat(50) },
    { kind: "layer", id: "n1", name: "Hero", type: "rect", bounds: { x: 10.4, y: 20, w: 100, h: 50.6 } },
    { kind: "tool", name: "add_shape" },
    { kind: "skill", name: "logo", args: { brand: "Ember" } },
    { kind: "selection", layers: [{ id: "n2", name: "", type: "text" }] },
    { kind: "attachment", index: 1, name: "a.png" },
  ], { maxFileChars: 20 });
  assert.match(out, /^\[@file: index\.html\]\n```\nx{20}\n```\n\(excerpt: first 20 of 50 characters/);
  assert.match(out, /\[@layer: id n1 “Hero” rect at 10,20 size 100×51\]/);
  assert.match(out, /\[!tool: add_shape\] You MUST call the tool “add_shape” first/);
  assert.match(out, /\[\/skill: logo args \{"brand":"Ember"\}\]/);
  assert.match(out, /\[@selection: id n2 “text” text\]/);
  assert.match(out, /\[@attachment: 1\. a\.png\]/);
});

test("buildContextBlocks escapes code fences inside excerpts and respects the total budget", () => {
  const out = buildContextBlocks([{ kind: "file", path: "a.md", content: "```js\n```" }, { kind: "file", path: "b.md", content: "yyyy" }], { maxTotalChars: 9 });
  assert.equal(out.split("\n").filter((l) => l === "```").length, 2);
  assert.match(out, /\[@file: b\.md\]$/);
});

test("composeMessage and parseContextBlocks round-trip the chips", () => {
  const chips = [{ kind: "file", path: "css/style.css", content: "body{}\n[@layer: fake] inside fence" }, { kind: "layer", id: "n1", name: "Hero", type: "rect" }, { kind: "tool", name: "query_layers" }, { kind: "skill", name: "poster" }];
  const msg = composeMessage("Make it blue", chips);
  assert.ok(msg.startsWith(`Make it blue\n\n${CONTEXT_MARKER}\n`));
  const p = parseContextBlocks(msg);
  assert.equal(p.text, "Make it blue");
  assert.deepEqual(p.chips.map((c) => [c.kind, c.label]), [["file", "css/style.css"], ["layer", "Hero"], ["tool", "query_layers"], ["skill", "poster"]]);
  assert.equal(composeMessage("  hi ", []), "hi");
  assert.deepEqual(parseContextBlocks("no context"), { text: "no context", chips: [] });
  assert.match(composeMessage("", [{ kind: "tool", name: "x" }]), /^See the context below\./);
});

test("chipLabel uses the trigger of the chip kind", () => {
  assert.equal(chipLabel({ kind: "file", path: "a.css" }), "@a.css");
  assert.equal(chipLabel({ kind: "tool", name: "add_shape" }), "!add_shape");
  assert.equal(chipLabel({ kind: "skill", name: "logo" }), "/logo");
  assert.equal(chipLabel({ kind: "selection" }), "@selection");
});
