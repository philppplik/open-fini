// Pure anchor resolution (collab/comment-context.js), comment persistence in .ofini and the Vibe comment tools against
// real documents. No DOM, no room: this is the "comments without collaboration" path.
import test from "node:test";
import assert from "node:assert/strict";
import { Doc } from "../../app/src/core/doc.js";
import { saveOfini, loadOfini } from "../../app/src/core/ofini.js";
import { createNode } from "../../app/src/core/nodes.js";
import { newThread, applyCommentOp, normalizeThreads } from "../../app/src/collab/comments.js";
import { resolveTarget, excerptLines, findQuote, describeThread } from "../../app/src/collab/comment-context.js";
import { elementAnchor, codeAnchor } from "../../app/src/collab/anchors.js";
import { parseHtml, elementAtPath, elementPath } from "../../app/src/engine/web/html.js";
import { createOpenFiniTools, TOOL_GROUPS } from "../../app/src/vibe/tools/index.js";
import { fakeApp } from "../vibe/helpers.js";

const ANN = { id: "A".repeat(22), nick: "Ann", color: "#e11d48" };
const BOB = { id: "B".repeat(22), nick: "Bob", color: "#2563eb" };

test("excerptLines marks the commented lines and findQuote follows moved code", () => {
  const text = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
  const ex = excerptLines(text, 4, 4, { before: 1, after: 1 });
  assert.equal(ex.from, 3);
  assert.equal(ex.to, 5);
  assert.match(ex.text, /> 4\td/);
  assert.match(ex.text, /\s 3\tc/);
  assert.equal(findQuote("x\n  hello \ny\nhello", "hello", 4), 4);
  assert.equal(findQuote("x", "nope"), null);
});

test("resolveTarget: code anchors give lines, excerpt and detect drift", () => {
  const files = { "a.js": "one\ntwo\nthree\nfour" };
  const env = { fileText: (p) => files[p] ?? null };
  const ok = resolveTarget(codeAnchor({ path: "a.js", from: { line: 2, col: 0 }, quote: "two" }), env);
  assert.equal(ok.type, "code");
  assert.equal(ok.code, "two");
  assert.equal(ok.stale, undefined);
  files["a.js"] = "zero\none\ntwo\nthree\nfour";
  const moved = resolveTarget(codeAnchor({ path: "a.js", from: { line: 2, col: 0 }, quote: "two" }), env);
  assert.equal(moved.stale, true);
  assert.equal(moved.movedTo, 3);
  const gone = resolveTarget(codeAnchor({ path: "missing.js", from: { line: 1, col: 0 } }), env);
  assert.equal(gone.exists, false);
  const range = resolveTarget(codeAnchor({ path: "a.js", from: { line: 2, col: 0 }, to: { line: 3, col: 5 } }), env);
  assert.equal(range.endLine, 3);
  assert.equal(range.code, "one\ntwo");
});

test("resolveTarget: website elements are found by their element path, Office text by block and quote", () => {
  const src = '<html><body><section><h1 class="t">Hi</h1><p>Body text</p></section></body></html>';
  const parsed = parseHtml(src);
  const p = parsed.elements.find((e) => e.tag === "p");
  const sel = elementPath(p).join("/");
  const el = (path, s) => {
    const e = elementAtPath(parseHtml(src), String(s).split("/").map(Number));
    return e ? { tag: e.tag, outerHtml: src.slice(e.start, e.end), startLine: 1, endLine: 1 } : null;
  };
  const t = resolveTarget(elementAnchor({ elem: String(p.id), sel, path: "index.html", quote: "<p>" }), { elementAt: el });
  assert.equal(t.exists, true);
  assert.equal(t.tag, "p");
  assert.equal(t.outerHtml, "<p>Body text</p>");

  const block = { 3: "The quick brown fox jumps" };
  const env = { blockText: (path) => block[path[0]] ?? null };
  const tx = resolveTarget({ kind: "text", path: "[3]", from: 4, to: 9, quote: "quick" }, env);
  assert.equal(tx.selectedText, "quick");
  assert.equal(tx.stale, undefined);
  const edited = resolveTarget({ kind: "text", path: "[3]", from: 4, to: 9, quote: "slow" }, env);
  assert.equal(edited.stale, true);
  assert.equal(resolveTarget({ kind: "text", path: "[9]", from: 0, to: 1 }, env).exists, false);
});

test("comments survive a save/reload of the .ofini with anchors, replies, resolved state and authors", async () => {
  const doc = new Doc({ name: "Review me", width: 400, height: 300 });
  const page = doc.pages[0];
  const r = createNode("rect", { name: "Hero box" });
  page.root.children.push(r);
  doc.relink();
  const t1 = newThread({ id: "t-node", anchor: { kind: "node", node: r.id, page: page.id, pin: { x: 60, y: 45 }, off: { x: 0.5, y: 0.5 }, quote: "Hero box" }, author: ANN, text: "Make this bigger", ts: 1000 });
  const t2 = newThread({ id: "t-line", anchor: { kind: "line", path: "css/site.css", line: 12, endLine: 14, col: 2, endCol: 4, quote: "color: red;" }, author: BOB, text: "Wrong color", ts: 2000 });
  const t3 = newThread({ id: "t-text", anchor: { kind: "text", path: "[2]", from: 1, to: 6, quote: "hello" }, author: ANN, text: "Typo?", ts: 3000 });
  doc.comments.push(t1, t2, t3);
  assert.ok(applyCommentOp(doc.comments, { op: "reply", threadId: "t-node", msg: { id: "m1", author: BOB.id, nick: "Bob", color: BOB.color, text: "Agreed", ts: 1500 } }, { sender: BOB.id }));
  assert.ok(applyCommentOp(doc.comments, { op: "resolve", threadId: "t-line", text: "Bob" }, { sender: BOB.id }));
  const back = await loadOfini(await saveOfini(doc));
  const threads = normalizeThreads(back.comments);
  assert.equal(threads.length, 3);
  const n = threads.find((t) => t.id === "t-node");
  assert.deepEqual(n.anchor.off, { x: 0.5, y: 0.5 });
  assert.equal(n.anchor.node, r.id);
  assert.equal(n.nick, "Ann");
  assert.equal(n.color, "#e11d48");
  assert.equal(n.messages.length, 2);
  assert.equal(n.messages[1].nick, "Bob");
  const l = threads.find((t) => t.id === "t-line");
  assert.equal(l.resolved, true);
  assert.equal(l.resolvedBy, "Bob");
  assert.equal(l.anchor.endLine, 14);
  assert.equal(threads.find((t) => t.id === "t-text").anchor.quote, "hello");
});

test("an unknown author keeps working: no nick or color is invented, the UI shows 'Unknown author'", () => {
  const th = normalizeThreads([{ id: "x1", anchor: { kind: "doc" }, author: "C".repeat(22), ts: 5, messages: [{ id: "m", author: "C".repeat(22), text: "Hi", ts: 5 }] }])[0];
  assert.ok(th);
  assert.equal(th.nick, undefined);
  const d = describeThread(th);
  assert.equal(d.author, "Unknown author");
  assert.equal(d.messages[0].author, "Unknown author");
});

test("Vibe comment tools: list_comments resolves layers, get_comment_context adds details, reply and resolve work without a room", async () => {
  const app = fakeApp();
  const doc = app.doc;
  const page = doc.pages[0];
  const tools = createOpenFiniTools(app, {});
  const by = (n) => tools.find((t) => t.name === n);
  const made = await by("add_shape").run({ type: "rect", x: 40, y: 50, w: 200, h: 80, name: "Banner" });
  const r = doc.find(made.id);
  doc.comments.push(newThread({ id: "c-1", anchor: { kind: "node", node: r.id, page: page.id, pin: { x: 140, y: 90 }, off: { x: 0.5, y: 0.5 }, quote: "Banner" }, author: ANN, text: "Too small", ts: 10 }));
  assert.ok(TOOL_GROUPS.Comments.includes("get_comment_context"));
  assert.equal(by("get_comment_context").readOnly, true);
  assert.equal(by("resolve_comment").needsApproval, undefined, "resolve only asks through the Careful mode policy");

  const list = await by("list_comments").run({});
  assert.equal(list.count, 1);
  const th = list.threads[0];
  assert.equal(th.target.type, "layer");
  assert.equal(th.target.layerId, r.id);
  assert.equal(th.target.name, "Banner");
  assert.deepEqual(th.target.bounds, { x: 40, y: 50, w: 200, h: 80 });
  assert.equal(th.target.point.x, 140);
  assert.equal(th.author, "Ann");

  const ctx = await by("get_comment_context").run({ thread_id: "c-1" });
  const out = Array.isArray(ctx) ? JSON.parse(ctx[0].text) : ctx; // an image part is added when a renderer exists
  assert.equal(out.id, "c-1");
  assert.equal(out.target.layerId, r.id);
  await assert.rejects(() => by("get_comment_context").run({ thread_id: "nope" }), /no comment thread/);

  await by("reply_comment").run({ thread_id: "c-1", text: "Made it 400 wide" });
  assert.equal((await by("resolve_comment").run({ thread_id: "c-1" })).changed, true);
  assert.equal((await by("list_comments").run({})).count, 0, "resolved threads leave the open list");
  const all = await by("list_comments").run({ status: "all" });
  assert.equal(all.threads[0].messages.length, 2);
  assert.equal(all.threads[0].status, "resolved");
  assert.equal(doc.saved, false, "comment changes mark the document modified");

  const added = await by("add_comment").run({ text: "Check the kerning", layer_id: r.id });
  assert.equal(added.anchor, "node");
  assert.equal((await by("list_comments").run({})).threads[0].target.layerId, r.id);
});

test("Vibe comment tools: code comments return file, lines and the surrounding code", async () => {
  const app = fakeApp();
  const { ensureWeb } = await import("../../app/src/core/web.js");
  const doc = app.doc;
  ensureWeb(doc, { "index.html": '<!doctype html><html><body><h1 id="a">Hello</h1><p>Text</p></body></html>', "css/site.css": "body {\n  color: red;\n  margin: 0;\n}\n" });
  const tools = createOpenFiniTools(app, {});
  const by = (n) => tools.find((t) => t.name === n);
  await by("add_comment").run({ text: "Use the brand color", at: { path: "css/site.css", line: 2 } });
  const list = await by("list_comments").run({});
  const tg = list.threads[0].target;
  assert.equal(tg.type, "code");
  assert.equal(tg.path, "css/site.css");
  assert.equal(tg.code, "  color: red;");
  assert.match(tg.context, /> 2\t {2}color: red;/);
  const ctx = await by("get_comment_context").run({ thread_id: list.threads[0].id, lines: 1 });
  assert.match(ctx.target.context, /margin: 0;/);
  await assert.rejects(() => by("add_comment").run({ text: "x", at: { path: "nope.css", line: 1 } }), /no text file/);
});

test("the Demo provider has a script for 'address the comments' that only uses comment tools", async () => {
  const { planForPrompt } = await import("../../app/src/ai/providers/mock.js");
  const plan = planForPrompt("Please address the comments of this document", { ids: ["cabc123456"], firstId: "cabc123456", called: new Set() });
  assert.deepEqual(plan.flatMap((s) => s.calls.map((c) => c.name)), ["list_comments", "get_comment_context", "reply_comment"]);
  assert.equal(plan[1].calls[0].input.thread_id, "cabc123456");
  assert.equal(planForPrompt("Add comments to this code", { ids: [], called: new Set() }).some((s) => s.calls.some((c) => c.name === "list_comments")), false);
});
