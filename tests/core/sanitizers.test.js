// Regression tests for the CodeQL fixes: tag stripping and removal must be stable on nested input, `</script >` closes
// a script, the CSS compactor stays linear on hostile input, and generated ids come from the CSPRNG.
import test from "node:test";
import assert from "node:assert/strict";
import { buildPanelDocument } from "../../app/src/extensions/html.js";
import { parseHtmlTable } from "../../app/src/engine/layout/table-model.js";
import { renderMarkdown } from "../../app/src/engine/web/markdown.js";
import { compactCss } from "../../app/src/engine/web/tpl/shared.js";
import { uid } from "../../app/src/core/util.js";
import { newId } from "../../app/src/platform/popout.js";
import { makeId } from "../../app/src/ai/util.js";

const panel = (html) => buildPanelDocument({ config: { id: "a.b" }, runtimeSrc: "", html, htmlPath: "p/index.html", files: {} });

test("panel documents: nested <base> and refresh tags cannot reassemble", () => {
  const out = panel('<html><head><ba<base href="https://evil.test/">se href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test"></head><body>x</body></html>');
  assert.ok(!/<base\b/i.test(out), out);
  assert.ok(!/http-equiv\s*=\s*["']?refresh/i.test(out));
  const nested = panel('<html><head><me<meta http-equiv="refresh" content="0">ta http-equiv="refresh" content="0"></head></html>');
  assert.ok(!/http-equiv\s*=\s*["']?refresh/i.test(nested), nested);
});

test("panel documents: scripts closed with </script > and mixed case are inlined, never left raw", () => {
  const out = panel('<body><script>alert(1)</script ><SCRIPT>alert(2)</SCRIPT\n></body>');
  assert.ok(!/<script>[^<]/i.test(out), out);
  assert.ok(!/>\s*alert\(/.test(out), "no raw script bodies remain");
});

test("table import: nested tags in a cell are stripped completely", () => {
  const t = parseHtmlTable("<table><tr><td>a<scr<b>ipt>b</td><td><<b>b>x</td></tr></table>");
  const flat = JSON.stringify(t);
  assert.ok(!flat.includes("<script"), flat);
  assert.ok(!/<b>/.test(flat), flat);
});

test("markdown: raw <script> blocks end at </script > like in browsers", () => {
  const html = renderMarkdown("<script>\nalert(1)\n</script >\n\n**bold**", { idPrefix: "" }).html;
  assert.ok(!/<script/i.test(html), html);
  assert.ok(html.includes("<strong>bold</strong>"), html);
});

test("compactCss still compacts and is linear on hostile input", () => {
  assert.equal(compactCss(".a {\n  color: red;\n}\n"), ".a { color: red; }\n");
  const hostile = ".a {\n" + "  \t".repeat(20000) + "x";
  const t0 = Date.now();
  compactCss(hostile);
  compactCss(" ".repeat(50000) + "\n" + ".a, ".repeat(5000));
  assert.ok(Date.now() - t0 < 1500, "no catastrophic backtracking");
});

test("generated ids are well-formed and unique", () => {
  const ids = new Set();
  for (let i = 0; i < 2000; i++) ids.add(uid("t"));
  assert.equal(ids.size, 2000);
  assert.match(uid("t"), /^t_[0-9a-z]{6}[0-9a-z]+$/);
  assert.match(newId(), /^[0-9a-z]+$/);
  assert.notEqual(newId(), newId());
  assert.match(makeId("x"), /^x_[0-9a-z]+$/);
});
