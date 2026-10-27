// The dependency-free import graph used by the audit scripts and the architecture guardrails.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph, findCycles, parseModule, pathTo, staticClosure, stripComments } from "../../scripts/lib/import-graph.mjs";

test("stripComments keeps strings and regexes, drops comments", () => {
  const src = 'const a = "assets/*.svg"; // tail\n/* block */ const r = /\\/\\*x/; const u = "https://x";';
  const out = stripComments(src);
  assert.ok(out.includes('"assets/*.svg"'));
  assert.ok(out.includes('"https://x"'));
  assert.ok(out.includes("const r"));
  assert.ok(!out.includes("tail"));
  assert.ok(!out.includes("block"));
});

test("graph: static, dynamic, re-exports, cycles and closure", () => {
  const dir = mkdtempSync(join(tmpdir(), "of-graph-"));
  try {
    const f = (name, code) => writeFileSync(join(dir, name), code);
    f("a.js", 'import { b1, b2 as x } from "./b.js";\nimport "./side.js";\nexport const lazy = () => import("./c.js");\nexport function used() {}\n');
    f("b.js", 'import def from "./a.js";\nexport const b1 = 1;\nexport let b2 = 2;\nexport { b1 as again };\nexport * from "./side.js";\n');
    f("c.js", "// import x from './nope.js'\nexport default 3;\n");
    f("side.js", "export const s = 1;\n");
    const g = buildGraph({ roots: [dir] });
    const p = (n) => join(dir, n).split("\\").join("/");
    const a = g.get(p("a.js"));
    assert.deepEqual([...a.static].sort(), [p("b.js"), p("side.js")]);
    assert.deepEqual([...a.dynamic], [p("c.js")]);
    assert.deepEqual([...a.uses.get(p("b.js"))].sort(), ["b1", "b2"]);
    assert.deepEqual([...a.exports].sort(), ["lazy", "used"]);
    assert.deepEqual([...g.get(p("b.js")).exports].sort(), ["again", "b1", "b2"]);
    assert.equal(g.get(p("c.js")).static.size, 0, "imports in comments are ignored");
    assert.deepEqual(findCycles(g), [[p("a.js"), p("b.js")]]);
    assert.deepEqual([...staticClosure(g, [p("a.js")])].sort(), [p("a.js"), p("b.js"), p("side.js")]);
    assert.deepEqual(pathTo(g, [p("a.js")], p("side.js")), [p("a.js"), p("side.js")]);
    assert.equal(pathTo(g, [p("a.js")], p("c.js")), null, "dynamic imports are not part of the static closure");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseModule ignores specifiers that do not resolve", () => {
  const node = parseModule("/nowhere/x.js", 'import a from "./missing.js"; import b from "pkg";');
  assert.equal(node.static.size, 0);
});
