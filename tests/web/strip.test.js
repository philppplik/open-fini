// Markup removal for plain text (engine/web/strip.js) and the places that use it: nested fragments must not
// reassemble into a tag or comment after one pass (CodeQL js/incomplete-multi-character-sanitization).
import test from "node:test";
import assert from "node:assert/strict";
import { replaceUntilStable, stripComments, stripElements, stripTags } from "../../app/src/engine/web/strip.js";
import { localRefsOfHtml } from "../../app/src/engine/web/open-plan.js";
import { minifyText } from "../../app/src/engine/web/format.js";
import { summarizeNotes } from "../../app/src/core/update-policy.js";
import { extractReadable } from "../../app/src/vibe/web-access.js";
import * as Board from "../../app/src/office/board/model.js";

test("replaceUntilStable repeats until nothing changes", () => {
  assert.equal(replaceUntilStable("aaab", /ab/g, "b"), "b");
  assert.equal(replaceUntilStable(null, /x/g), "");
});

test("stripTags: nested fragments cannot rebuild a tag", () => {
  assert.equal(stripTags("<scr<script>ipt>alert(1)</scr</script>ipt>"), "alert(1)");
  assert.equal(stripTags("<<b>script>x"), "x");
  assert.equal(stripTags("a <b>bold</b> text"), "a bold text");
  assert.equal(stripTags("1 < 2 and 3 > 2"), "1 < 2 and 3 > 2", "comparison signs stay");
  assert.equal(stripTags("tail <script"), "tail script", "an unclosed tag start is defused");
  assert.ok(!/<[a-z!/?]/i.test(stripTags("<<<scr<x>ipt>>><!<!---->--><img src=x onerror=1>")));
});

test("stripComments and stripElements", () => {
  assert.equal(stripComments("a<!<!-- x -->-- y -->b"), "ab");
  assert.equal(stripComments("a<!-- open"), "a", "an unclosed comment runs to the end, as in HTML");
  assert.equal(stripElements("x<scr<script>a</script>ipt>b</script>y", ["script"]), "xy");
  assert.equal(stripElements("x<script>a</script\t\n bar>y", ["script"]), "xy", "closing tags with junk");
  assert.equal(stripElements("<STYLE>a</style>z", ["style"]), "z");
  assert.equal(stripElements("keep", ["bad name"]), "keep");
});

test("callers: readable text, release notes, dependency scan, minifier, board tables", () => {
  const page = extractReadable("<p>a</p><scr<script>x</script>ipt>alert(1)</script><!<!---->--><p>b</p>");
  assert.ok(!/<script/i.test(page.text), page.text);
  assert.equal(summarizeNotes("## Notes\n- <scr<script>ipt>fix</scr</script>ipt> & more"), "Notes\n• fix & more");
  assert.deepEqual(localRefsOfHtml('<!<!-- --><script src="a.js"></script><!-- <img src="hidden.png"> -->'), ["a.js"]);
  assert.deepEqual(localRefsOfHtml('<img src="a.png"><!-- unclosed <img src="b.png">'), ["a.png"]);
  const min = minifyText("html", "<script>\n  const a = 1 ;\n</script\t >").text;
  assert.ok(!/\n\s+const/.test(min), min);
  const m = Board.addElements(Board.emptyModel({ title: "T" }), [Board.makeElement("table", { x: 0, y: 0, w: 100, h: 50, rows: [["a\\|b", "c|d"]] })]);
  const md = Board.boardToMarkdown(m).markdown;
  assert.ok(md.includes("a\\\\\\|b"), md);
  assert.ok(md.includes("c\\|d"), md);
});
