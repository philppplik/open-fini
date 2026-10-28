// Office Toolkit pure modules: selection model, virtualization, find/replace, delimited text, number formats, rough.
import test from "node:test";
import assert from "node:assert/strict";
import * as Sel from "../../app/src/office/toolkit/selection.js";
import { createAxis } from "../../app/src/office/toolkit/virtual.js";
import { findMatches, replaceMatches, compileQuery } from "../../app/src/office/toolkit/find.js";
import { parseDelimited, toDelimited, sniffSeparator, rowsToHtml } from "../../app/src/office/toolkit/clipboard.js";
import { formatValue, normalizeFormat, NUMBER_FORMATS } from "../../app/src/office/toolkit/numfmt.js";
import { roughLine, roughRect, roughEllipse, hachure, strokesToPath, rng } from "../../app/src/office/toolkit/rough.js";

test("selection: A1 references and ranges", () => {
  assert.equal(Sel.colName(0), "A");
  assert.equal(Sel.colName(25), "Z");
  assert.equal(Sel.colName(26), "AA");
  assert.equal(Sel.colName(16383), "XFD");
  assert.equal(Sel.colIndex("XFD"), 16383);
  assert.deepEqual(Sel.parseRef("$B$3"), { r: 2, c: 1 });
  assert.equal(Sel.parseRef("3B"), null);
  assert.deepEqual(Sel.parseRange("C4:A1"), { r0: 0, c0: 0, r1: 3, c1: 2 });
  assert.equal(Sel.formatRange({ r0: 3, c0: 2, r1: 0, c1: 0 }), "A1:C4");
  assert.equal(Sel.formatRange(Sel.parseRange("B2")), "B2");
  assert.deepEqual(Sel.rangeSize(Sel.parseRange("A1:C4")), { rows: 4, cols: 3, cells: 12 });
  assert.deepEqual(Sel.moveCell({ r: 0, c: 0 }, "up", { rows: 10, cols: 10 }), { r: 0, c: 0 });
  assert.deepEqual(Sel.moveCell({ r: 2, c: 2 }, "end", { rows: 10, cols: 5 }), { r: 2, c: 4 });
  const s = Sel.createItemSelection(["a"]);
  s.toggle("b");
  s.toggle("a");
  assert.deepEqual(s.ids, ["b"]);
});

test("virtual axis: offsets, custom sizes and the visible window", () => {
  const ax = createAxis({ count: 1_000_000, size: 20 });
  assert.equal(ax.total, 20_000_000);
  assert.equal(ax.indexAt(39), 1);
  ax.setSize(0, 100);
  assert.equal(ax.offsetOf(1), 100);
  assert.equal(ax.indexAt(99), 0);
  assert.equal(ax.indexAt(100), 1);
  assert.equal(ax.total, 20_000_080);
  const v = ax.visible(500_000, 400, 2);
  assert.ok(v.start <= ax.indexAt(500_000) && v.end - v.start <= 25);
  ax.setSize(0, 20);
  assert.equal(ax.total, 20_000_000);
  ax.setCount(0);
  assert.deepEqual(ax.visible(0, 100), { start: 0, end: 0 });
});

test("find / replace across items", () => {
  const items = [{ id: "A1", text: "Total cost" }, { id: "A2", text: "subtotal" }, { id: "A3", text: "x+y" }];
  assert.equal(findMatches(items, "total").length, 2);
  assert.equal(findMatches(items, "total", { wholeWord: true }).length, 1);
  assert.equal(findMatches(items, "Total", { caseSensitive: true }).length, 1);
  assert.equal(compileQuery("(", { regex: true }), null);
  assert.equal(findMatches(items, "x+y")[0].id, "A3", "plain text is escaped");
  assert.deepEqual([...replaceMatches(items, "(\\w+) cost", "$1 price", { regex: true })], [["A1", "Total price"]]);
  assert.equal(replaceMatches(items, "x", "$1").get("A3"), "$1+y", "$ is literal outside regex mode");
});

test("delimited text: quotes, line endings, round trip", () => {
  assert.deepEqual(parseDelimited('a,"b,c","d ""q"""\r\n1,2,3', ","), [["a", "b,c", 'd "q"'], ["1", "2", "3"]]);
  assert.deepEqual(parseDelimited("a\tb\n\nc"), [["a", "b"], [""], ["c"]]);
  const rows = [["x", "tab\there", "line\nbreak", ' "q" '], ["", "2"]];
  assert.deepEqual(parseDelimited(toDelimited(rows)), rows);
  assert.equal(sniffSeparator("a;b;c\n1;2;3"), ";");
  assert.equal(parseDelimited("a\nb\nc", "\t", { maxRows: 2 }).length, 2);
  assert.equal(rowsToHtml([["<b>"]]), "<table><tr><td>&lt;b&gt;</td></tr></table>");
});

test("number formats", () => {
  assert.equal(formatValue(1234.5, { type: "number", decimals: 2, grouping: true }), "1,234.50");
  assert.equal(formatValue(0.256, { type: "percent", decimals: 1 }), "25.6%");
  assert.equal(formatValue(-5, { type: "currency", currency: "USD", negativeParens: true }), "($5.00)");
  assert.equal(formatValue(45658, { type: "date" }), "01/01/2025");
  assert.equal(formatValue(0.1 + 0.2), "0.3");
  assert.equal(formatValue("text", { type: "number" }), "text");
  assert.deepEqual(normalizeFormat({ type: "evil", decimals: 99, code: "x" }), { type: "general", decimals: 10 });
  assert.ok(NUMBER_FORMATS.every((f) => f.id && f.label && f.fmt.type));
});

test("rough strokes are deterministic, finite and straight at roughness 0", () => {
  assert.deepEqual(roughLine(0, 0, 100, 0, { seed: 7 }), roughLine(0, 0, 100, 0, { seed: 7 }));
  assert.notDeepEqual(roughLine(0, 0, 100, 0, { seed: 7 }), roughLine(0, 0, 100, 0, { seed: 8 }));
  assert.deepEqual(roughLine(0, 0, 100, 0, { roughness: 0 }), [[[0, 0], [100, 0]]]);
  const all = [...roughRect(0, 0, 50, 30), ...roughEllipse(0, 0, 40, 20), ...hachure([[0, 0], [100, 0], [100, 100], [0, 100]], { gap: 10 })];
  assert.ok(all.length > 10);
  assert.ok(all.flat().every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  assert.match(strokesToPath([[[0, 0], [1.234, 2]]]), /^M0 0 L1\.23 2$/);
  const r = rng(1);
  assert.ok(r() >= 0 && r() < 1);
});
