// Performance: a 1 MB HTML file and a 1 MB CSS file must parse quickly. Limits are generous (the target on a laptop is
// well below 150 ms) so the test does not flake on slow CI machines; the measured time is the best of three runs.
import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES } from "../../app/src/engine/web/templates.js";
import { parseHtml, elementAtOffset } from "../../app/src/engine/web/html.js";
import { parseCss, formatCss, minifyCss } from "../../app/src/engine/web/css.js";
import { setAttribute, setDeclarations, insertHtml, applyChanges, moveElement } from "../../app/src/engine/web/edit.js";
import { minifyHtml } from "../../app/src/engine/web/site.js";

const landing = TEMPLATES.find((t) => t.id === "landing").files;
const bodyOf = (html) => html.slice(html.indexOf("<main"), html.indexOf("</main>") + 7);

function build(unit, size) {
  const parts = [];
  let n = 0;
  while (n < size) {
    parts.push(unit);
    n += unit.length;
  }
  return parts.join("\n");
}

const HTML_1MB = `<!doctype html>\n<html lang="en-US"><head><title>Big</title></head><body>\n${build(bodyOf(landing["index.html"]), 1_000_000)}\n</body></html>\n`;
const CSS_1MB = build(landing["css/style.css"], 1_000_000);

function best(fn, runs = 3) {
  let min = Infinity;
  let result;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    result = fn();
    min = Math.min(min, performance.now() - t);
  }
  return { ms: min, result };
}

test("inputs are about 1 MB", () => {
  assert.ok(HTML_1MB.length >= 1_000_000 && HTML_1MB.length < 1_400_000);
  assert.ok(CSS_1MB.length >= 1_000_000 && CSS_1MB.length < 1_400_000);
});

test("parseHtml: 1 MB of HTML", () => {
  const { ms, result } = best(() => parseHtml(HTML_1MB));
  console.log(`  parseHtml 1 MB: ${ms.toFixed(1)} ms, ${result.elements.length} elements`);
  assert.ok(result.elements.length > 5000);
  assert.ok(ms < 400, `parseHtml took ${ms.toFixed(0)} ms`);
  // lookups on the big tree stay fast
  const t = performance.now();
  for (let i = 0; i < 1000; i++) elementAtOffset(result, (i * 997) % HTML_1MB.length);
  assert.ok(performance.now() - t < 200);
});

test("parseCss: 1 MB of CSS", () => {
  const { ms, result } = best(() => parseCss(CSS_1MB));
  console.log(`  parseCss 1 MB: ${ms.toFixed(1)} ms, ${result.rules.length} top-level rules`);
  assert.ok(result.rules.length > 1000);
  assert.ok(ms < 400, `parseCss took ${ms.toFixed(0)} ms`);
});

test("edits, formatting and minifying stay fast on big files", () => {
  const html = parseHtml(HTML_1MB);
  const css = parseCss(CSS_1MB);
  const last = html.elements[html.elements.length - 1];
  let r = best(() => setAttribute(html, last.id, "data-x", "1"), 3);
  assert.ok(r.ms < 50, `setAttribute ${r.ms.toFixed(1)} ms`);
  r = best(() => insertHtml(html, null, 100000, "<p>x</p>"), 1);
  assert.ok(r.ms < 1500, `insertHtml ${r.ms.toFixed(1)} ms`);
  r = best(() => setDeclarations(css, { selector: ".new-rule", media: "(max-width: 991px)" }, { color: "red" }), 3);
  assert.ok(r.ms < 400, `setDeclarations ${r.ms.toFixed(1)} ms`);
  assert.ok(applyChanges(CSS_1MB, r.result).length > CSS_1MB.length);
  r = best(() => formatCss(CSS_1MB), 1);
  console.log(`  formatCss 1 MB: ${r.ms.toFixed(1)} ms`);
  assert.ok(r.ms < 3000, `formatCss ${r.ms.toFixed(0)} ms`);
  r = best(() => minifyCss(CSS_1MB), 1);
  console.log(`  minifyCss 1 MB: ${r.ms.toFixed(1)} ms`);
  assert.ok(r.ms < 3000, `minifyCss ${r.ms.toFixed(0)} ms`);
  assert.ok(r.result.length < CSS_1MB.length * 0.95);
  r = best(() => minifyHtml(HTML_1MB), 1);
  assert.ok(r.ms < 3000, `minifyHtml ${r.ms.toFixed(0)} ms`);
  r = best(() => moveElement(html, html.elements[10].id, null, 5), 1);
  assert.ok(r.ms < 3000, `moveElement ${r.ms.toFixed(0)} ms`);
});

test("no catastrophic backtracking on pathological input", () => {
  const cases = [
    ["parseHtml quotes", () => parseHtml("<a " + 'b="'.repeat(60000))],
    ["parseHtml unclosed", () => parseHtml("<div>".repeat(60000))],
    ["parseHtml comments", () => parseHtml("<!--".repeat(60000))],
    ["parseHtml lt", () => parseHtml("<".repeat(200000))],
    ["parseCss braces", () => parseCss("{".repeat(100000))],
    ["parseCss parens", () => parseCss("a{b:" + "(".repeat(100000))],
    ["parseCss strings", () => parseCss("a{b:" + '"x'.repeat(50000))],
    ["parseCss comments", () => parseCss("/*".repeat(100000))],
    ["formatCss", () => formatCss("a{b:c;".repeat(30000))],
    ["minifyCss", () => minifyCss("a { b : c ; } ".repeat(30000))],
  ];
  for (const [name, fn] of cases) {
    const t = performance.now();
    fn();
    const ms = performance.now() - t;
    assert.ok(ms < 2000, `${name}: ${ms.toFixed(0)} ms`);
  }
});
