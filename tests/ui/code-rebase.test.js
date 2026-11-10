import test from "node:test";
import assert from "node:assert/strict";
import { rebaseChanges } from "../../app/src/ui/code/util.js";
import { applyChanges } from "../../app/src/engine/web/edit.js";

test("rebaseChanges: offsets of a CRLF project text apply to the editor's \\n text", () => {
  // regression: inserting an element into a Windows (CRLF) HTML file threw CodeMirror's
  // "Invalid change range 2399 to 2399 (in doc of length 2372)": the editor stores line breaks as "\n"
  const base = "<body>\r\n  <main>\r\n    <p>Hi</p>\r\n  </main>\r\n</body>\r\n";
  const doc = base.replace(/\r\n/g, "\n");
  const at = base.indexOf("  </main>");
  const changes = [{ from: at, to: at, insert: "    <img src=\"a.png\">\r\n" }];
  assert.ok(at > doc.length - 20, "the offset is past where it belongs in the editor text");
  const rebased = rebaseChanges(doc, base, changes);
  assert.equal(rebased.length, 1);
  const out = applyChanges(doc, rebased);
  assert.equal(out, "<body>\n  <main>\n    <p>Hi</p>\n    <img src=\"a.png\">\n  </main>\n</body>\n");
  assert.ok(rebased[0].from <= doc.length && rebased[0].to <= doc.length);
});

test("rebaseChanges: identical texts keep the changes; no-op edits become empty", () => {
  const ch = [{ from: 1, to: 2, insert: "x" }];
  assert.equal(rebaseChanges("abc", "abc", ch), ch);
  assert.deepEqual(rebaseChanges("a\nb", "a\r\nb", [{ from: 0, to: 0, insert: "" }]), []);
});

test("rebaseChanges: a stale editor text is brought to the project text plus the edit", () => {
  const base = "<p>new text</p>";
  const out = applyChanges("<p>old</p>", rebaseChanges("<p>old</p>", base, [{ from: 3, to: 3, insert: "brand " }]));
  assert.equal(out, "<p>brand new text</p>");
});
