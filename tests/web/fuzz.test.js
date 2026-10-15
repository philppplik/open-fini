// Fuzz tests: random truncations and mutations of the templates must never throw, must keep ranges in bounds, nested and
// ordered, and every edit must produce text that re-parses without new errors.
import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES } from "../../app/src/engine/web/templates.js";
import { ELEMENT_CATEGORIES } from "../../app/src/engine/web/elements.js";
import { parseHtml, childElements, isInside } from "../../app/src/engine/web/html.js";
import { parseCss, flattenRules, formatCss, minifyCss } from "../../app/src/engine/web/css.js";
import {
  applyChanges, setAttribute, setClasses, setInlineStyle, setTag, setText, setInnerHtml, insertHtml, deleteElement, duplicateElement,
  moveElement, wrapElement, unwrapElement, setDeclarations, deleteRule, renameSelector, renameClass, appendRulesIfMissing, mapOffset,
} from "../../app/src/engine/web/edit.js";
import { rng, mutate, checkHtml, checkCss, errorCount } from "./_helpers.js";

const SEED = Number(process.env.FUZZ_SEED || 0);
const HTML_SEEDS = [];
const CSS_SEEDS = [];
for (const t of TEMPLATES) {
  for (const [p, s] of Object.entries(t.files)) {
    if (p.endsWith(".html")) HTML_SEEDS.push(s);
    if (p.endsWith(".css")) CSS_SEEDS.push(s);
  }
}
for (const c of ELEMENT_CATEGORIES) for (const i of c.items) {
  HTML_SEEDS.push(i.html);
  if (i.css) CSS_SEEDS.push(i.css);
}

const EXPECTED = /cannot|invalid|itself|descendants|void|not allowed|unknown element/i;
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

function mutated(seeds, rand, maxMutations = 3) {
  let s = pick(rand, seeds);
  const n = 1 + Math.floor(rand() * maxMutations);
  for (let i = 0; i < n; i++) s = mutate(s, rand);
  return s;
}

function checkChanges(src, changes) {
  const sorted = changes.slice().sort((a, b) => a.from - b.from || a.to - b.to);
  let prev = 0;
  for (const c of sorted) {
    assert.ok(c.from >= 0 && c.from <= c.to && c.to <= src.length, "change in bounds");
    assert.ok(c.from >= prev, "changes do not overlap");
    assert.equal(typeof c.insert, "string");
    prev = c.to;
  }
  const out = applyChanges(src, changes);
  // text outside of the changes is byte identical
  let pos = 0;
  let outPos = 0;
  for (const c of sorted) {
    assert.equal(out.slice(outPos, outPos + (c.from - pos)), src.slice(pos, c.from));
    outPos += c.from - pos + c.insert.length;
    pos = c.to;
  }
  assert.equal(out.slice(outPos), src.slice(pos));
  // mapOffset is monotonic
  let last = -1;
  for (let o = 0; o <= src.length; o += Math.max(1, Math.floor(src.length / 40))) {
    const m = mapOffset(o, changes);
    assert.ok(m >= last, "mapOffset monotonic");
    last = m;
  }
  return out;
}

test("parseHtml: random truncations and mutations keep every invariant", () => {
  const rand = rng(1234 + SEED);
  for (let i = 0; i < 700; i++) {
    const src = mutated(HTML_SEEDS, rand, 4);
    const p = parseHtml(src);
    checkHtml(p);
  }
  for (const seed of HTML_SEEDS.slice(0, 12)) {
    for (let cut = 0; cut <= seed.length; cut += Math.max(1, Math.floor(seed.length / 90))) checkHtml(parseHtml(seed.slice(0, cut)));
  }
});

test("parseCss, formatCss and minifyCss: random truncations and mutations", () => {
  const rand = rng(4321 + SEED);
  for (let i = 0; i < 500; i++) {
    const src = mutated(CSS_SEEDS, rand, 4);
    const p = parseCss(src);
    checkCss(p);
    const f = formatCss(src);
    const m = minifyCss(src);
    assert.equal(typeof f, "string");
    assert.equal(typeof m, "string");
    // well-formed input keeps its structure through formatting and minifying
    if (p.errors.length === 0) {
      const shape = (parsed) => JSON.stringify(parsed.rules.map(function walk(r) { return r.type === "style" ? [r.selector.replace(/\s+/g, ""), r.decls.map((d) => d.prop + ":" + d.value.replace(/\s+/g, "") + d.important), r.rules.map(walk)] : [r.name, r.decls.map((d) => d.prop + ":" + d.value.replace(/\s+/g, "") + d.important), r.rules.map(walk)]; }));
      for (const [label, out] of [["format", f], ["minify", m]]) {
        const a = shape(parseCss(out));
        const b = shape(p);
        if (a !== b) {
          let k = 0;
          while (a[k] === b[k]) k++;
          assert.fail(`${label} changed the structure near: ${JSON.stringify(b.slice(Math.max(0, k - 60), k + 60))} vs ${JSON.stringify(a.slice(Math.max(0, k - 60), k + 60))}
source: ${JSON.stringify(src.slice(0, 400))}`);
        }
      }
    }
  }
  for (const seed of CSS_SEEDS.slice(0, 8)) {
    for (let cut = 0; cut <= seed.length; cut += Math.max(1, Math.floor(seed.length / 80))) {
      checkCss(parseCss(seed.slice(0, cut)));
      formatCss(seed.slice(0, cut));
      minifyCss(seed.slice(0, cut));
    }
  }
});

const SNIPPETS = ["<b>x</b>", '<section class="s">\n  <h2>T</h2>\n  <p>Text &amp; more</p>\n</section>', "<br>", '<img src="a.png" alt="">', "<ul><li>a</li><li>b</li></ul>"];

function applyHtmlEdit(src, p, rand) {
  const els = p.elements;
  if (!els.length) return { changes: insertHtml(p, null, 0, pick(rand, SNIPPETS)).changes, name: "insertHtml" };
  const el = pick(rand, els);
  const names = ["setAttribute", "setClasses", "setInlineStyle", "setTag", "setText", "setInnerHtml", "insertHtml", "deleteElement", "duplicateElement", "moveElement", "wrapElement", "unwrapElement"];
  const name = pick(rand, names);
  switch (name) {
    case "setAttribute": return { name, changes: setAttribute(p, el.id, pick(rand, ["class", "id", "title", "data-x", "hidden", "href", "alt"]), pick(rand, ["v", 'a "quoted" & value', "", null, "it's"])) };
    case "setClasses": return { name, changes: setClasses(p, el.id, pick(rand, [[], ["a"], ["a", "b c"], ["x", "x"]])) };
    case "setInlineStyle": return { name, changes: setInlineStyle(p, el.id, pick(rand, [{ color: "red" }, { color: null }, { margin: "0 auto", padding: null }, { "font-family": '"A B", serif' }])) };
    case "setTag": return { name, changes: setTag(p, el.id, pick(rand, ["div", "section", "span", "h2", "p"])) };
    case "setText": return { name, changes: setText(p, el.id, pick(rand, ["Hello", "a < b & c", ""])) };
    case "setInnerHtml": return { name, changes: setInnerHtml(p, el.id, pick(rand, ["<b>x</b>", "", "plain"])) };
    case "insertHtml": {
      const parent = rand() < 0.3 ? null : pick(rand, els).id;
      return { name, changes: insertHtml(p, parent, Math.floor(rand() * 4), pick(rand, SNIPPETS)).changes };
    }
    case "deleteElement": return { name, changes: deleteElement(p, el.id) };
    case "duplicateElement": return { name, changes: duplicateElement(p, el.id).changes, allow: p.errors.filter((d) => d.severity === "error" && d.start >= el.start && d.start < el.end).length };
    case "moveElement": {
      const parent = rand() < 0.2 ? null : pick(rand, els).id;
      return { name, changes: moveElement(p, el.id, parent, Math.floor(rand() * 4)).changes };
    }
    case "wrapElement": return { name, changes: wrapElement(p, el.id, "div", { class: "wrap" }).changes };
    default: return { name, changes: unwrapElement(p, el.id) };
  }
}

test("HTML edits on random documents: no throw, ranges valid, no new errors", () => {
  const rand = rng(99 + SEED);
  let applied = 0;
  let skipped = 0;
  let strict = 0;
  const perEdit = {};
  for (let i = 0; i < 900; i++) {
    // a third of the inputs are intact templates, the rest are broken in random ways
    const src = i % 3 === 0 ? pick(rand, HTML_SEEDS) : mutated(HTML_SEEDS, rand, 2);
    const p = parseHtml(src);
    const before = errorCount(p);
    let r;
    try {
      r = applyHtmlEdit(src, p, rand);
    } catch (err) {
      assert.ok(EXPECTED.test(err.message), `unexpected error: ${err.message}`);
      skipped++;
      continue;
    }
    const out = checkChanges(src, r.changes);
    const re = parseHtml(out);
    checkHtml(re);
    const after = errorCount(re);
    perEdit[r.name] = (perEdit[r.name] || 0) + 1;
    // error-free documents must stay error-free; documents that were already broken may only get a little worse
    // (an edit next to a half-written tag can change where the parser recovers)
    const limit = before === 0 ? 0 : before + (r.allow || 0) + 2;
    if (before === 0) strict++;
    assert.ok(after <= limit, `${r.name}: errors ${before} -> ${after}\n--- source ---\n${src.slice(0, 3000)}\n--- result ---\n${out.slice(0, 3000)}`);
    applied++;
  }
  assert.ok(applied > 400, `only ${applied} edits were applied (${skipped} skipped)`);
  assert.ok(strict > 250, `${strict} edits ran on error-free documents`);
  for (const k of ["setAttribute", "insertHtml", "moveElement", "wrapElement", "unwrapElement", "deleteElement"]) assert.ok(perEdit[k] > 10, `${k} was exercised ${perEdit[k]} times`);
});

test("HTML edits are idempotent where they should be", () => {
  const rand = rng(7 + SEED);
  for (let i = 0; i < 300; i++) {
    const src = pick(rand, HTML_SEEDS);
    const p = parseHtml(src);
    if (!p.elements.length) continue;
    const el = pick(rand, p.elements);
    const value = pick(rand, ["v1", 'q"uote & amp']);
    const ch = setAttribute(p, el.id, "data-fuzz", value);
    const out = applyChanges(src, ch);
    const p2 = parseHtml(out);
    assert.deepEqual(setAttribute(p2, el.id, "data-fuzz", value), [], "same attribute value is a no-op");
    const c2 = setClasses(p2, el.id, ["alpha", "beta"]);
    const out2 = applyChanges(out, c2);
    assert.deepEqual(setClasses(parseHtml(out2), el.id, ["alpha", "beta"]), []);
    const s1 = applyChanges(out2, setInlineStyle(parseHtml(out2), el.id, { color: "red" }));
    assert.deepEqual(setInlineStyle(parseHtml(s1), el.id, { color: "red" }), []);
    // removing what was added restores the original text for plain attributes
    assert.equal(applyChanges(out, setAttribute(p2, el.id, "data-fuzz", null)), src);
  }
});

const SELECTORS = [".hero", ".btn", "body", ".container", ".nope", ":root", ".card:hover", "h1, h2"];
const MEDIAS = [null, null, "(max-width: 991px)", "(max-width: 767px)", "(max-width: 478px)", "(min-width: 1440px)", "(prefers-reduced-motion: reduce)"];

function applyCssEdit(src, p, rand) {
  const target = { selector: pick(rand, SELECTORS), media: pick(rand, MEDIAS) };
  const name = pick(rand, ["set", "set", "set", "remove", "deleteRule", "renameSelector", "renameClass", "append", "setImportant"]);
  switch (name) {
    case "set": return { name, changes: setDeclarations(p, target, pick(rand, [{ color: "red" }, { margin: "0 auto", padding: "4px" }, { "--x": "1" }, { display: "grid", gap: "8px", color: null }])) };
    case "setImportant": return { name, changes: setDeclarations(p, target, { color: { value: "blue", important: true } }) };
    case "remove": {
      const rules = flattenRules(p);
      const r = rules.length ? pick(rand, rules) : null;
      const props = {};
      if (r) for (const d of r.decls.slice(0, 2)) props[d.prop] = null;
      return { name, changes: setDeclarations(p, r ? { selector: r.selector, media: null } : target, props) };
    }
    case "deleteRule": return { name, changes: deleteRule(p, target) };
    case "renameSelector": return { name, changes: renameSelector(p, target.selector, ".renamed") };
    case "renameClass": return { name, changes: renameClass(p, "hero", "banner") };
    default: return { name, changes: appendRulesIfMissing(src, pick(rand, CSS_SEEDS)) };
  }
}

test("CSS edits on random stylesheets: no throw, ranges valid, no new errors", () => {
  const rand = rng(2024 + SEED);
  let applied = 0;
  const perEdit = {};
  for (let i = 0; i < 900; i++) {
    const src = i % 3 === 0 ? pick(rand, CSS_SEEDS) : mutated(CSS_SEEDS, rand, 2);
    const p = parseCss(src);
    const before = errorCount(p);
    let r;
    try {
      r = applyCssEdit(src, p, rand);
    } catch (err) {
      assert.ok(EXPECTED.test(err.message), `unexpected error: ${err.message}`);
      continue;
    }
    const out = checkChanges(src, r.changes);
    const re = parseCss(out);
    checkCss(re);
    assert.ok(errorCount(re) <= before, `${r.name}: errors ${before} -> ${errorCount(re)}\n--- source ---\n${src.slice(0, 500)}\n--- result ---\n${out.slice(0, 700)}`);
    perEdit[r.name] = (perEdit[r.name] || 0) + 1;
    applied++;
  }
  assert.ok(applied > 800, `${applied} edits applied`);
  for (const k of ["set", "remove", "deleteRule", "renameClass", "append"]) assert.ok(perEdit[k] > 20, `${k}: ${perEdit[k]}`);
});

test("CSS edits are idempotent: applying the same declarations twice changes nothing the second time", () => {
  const rand = rng(31 + SEED);
  for (let i = 0; i < 300; i++) {
    const src = pick(rand, CSS_SEEDS);
    const target = { selector: pick(rand, SELECTORS), media: pick(rand, MEDIAS) };
    const props = pick(rand, [{ color: "red" }, { margin: "0 auto", padding: "4px" }, { "z-index": "3" }]);
    const once = applyChanges(src, setDeclarations(parseCss(src), target, props));
    assert.deepEqual(setDeclarations(parseCss(once), target, props), [], `second application on ${JSON.stringify(target)}`);
    assert.deepEqual(appendRulesIfMissing(applyChanges(src, appendRulesIfMissing(src, ".fuzz-a { color: red; }\n@media (max-width: 767px) { .fuzz-a { color: blue; } }")), ".fuzz-a { color: red; }\n@media (max-width: 767px) { .fuzz-a { color: blue; } }"), []);
  }
});

test("moveElement never loses or duplicates elements", () => {
  const rand = rng(555 + SEED);
  for (let i = 0; i < 200; i++) {
    const src = pick(rand, HTML_SEEDS.filter((s) => s.includes("<div") || s.includes("<section")));
    const p = parseHtml(src);
    const els = p.elements.filter((e) => !e.void);
    if (els.length < 3) continue;
    const el = pick(rand, p.elements);
    const parent = pick(rand, els);
    if (isInside(parent, el)) continue;
    const kids = childElements(parent).filter((k) => k !== el).length;
    let res;
    try {
      res = moveElement(p, el.id, parent.id, Math.floor(rand() * (kids + 1)));
    } catch (err) {
      assert.ok(EXPECTED.test(err.message), err.message);
      continue;
    }
    const out = applyChanges(src, res.changes);
    const re = parseHtml(out);
    assert.equal(re.elements.length, p.elements.length, "same number of elements");
    const tags = (x) => x.elements.map((e) => e.tag).sort().join(",");
    assert.equal(tags(re), tags(p));
    if (res.changes.length) assert.equal(re.elements.find((e) => e.start === res.at)?.tag, el.tag);
  }
});
