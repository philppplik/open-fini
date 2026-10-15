// Shared helpers for the web engine tests (not a test file itself).
import assert from "node:assert/strict";

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Map-backed FileSource. Values are strings or Uint8Array. */
export function makeFiles(obj) {
  const m = new Map(Object.entries(obj));
  const enc = new TextEncoder();
  return {
    list: () => [...m.keys()],
    readText: (p) => {
      const v = m.get(p);
      if (v == null) return null;
      return typeof v === "string" ? v : null;
    },
    readBytes: (p) => {
      const v = m.get(p);
      if (v == null) return null;
      return typeof v === "string" ? enc.encode(v) : v;
    },
  };
}

/** Random mutation of a source string: truncation, deletion, insertion of markup-significant characters. */
export function mutate(src, rand) {
  const kind = Math.floor(rand() * 6);
  const pos = Math.floor(rand() * (src.length + 1));
  const junk = ["<", ">", "\"", "'", "/", "=", "<!--", "-->", "</", "{", "}", ";", "/*", "*/", "(", ")", "&", "\\", "<div", "</div>", "<script>", "@media"];
  switch (kind) {
    case 0: return src.slice(0, pos);
    case 1: return src.slice(pos);
    case 2: { const len = Math.floor(rand() * 40); return src.slice(0, pos) + src.slice(pos + len); }
    case 3: return src.slice(0, pos) + junk[Math.floor(rand() * junk.length)] + src.slice(pos);
    case 4: { const a = Math.floor(rand() * src.length); const b = Math.min(src.length, a + Math.floor(rand() * 200)); return src.slice(0, pos) + src.slice(a, b) + src.slice(pos); }
    default: return src.slice(0, pos) + junk[Math.floor(rand() * junk.length)] + src.slice(pos + 1);
  }
}

/** Asserts the structural invariants of a ParsedHtml: ranges in bounds, nested, ordered, slicing back. */
export function checkHtml(parsed) {
  const { source: s } = parsed;
  const n = s.length;
  const inB = (a, b) => assert.ok(a >= 0 && a <= b && b <= n, `range ${a}..${b} outside 0..${n}`);
  const walkList = (list, from, to, owner) => {
    let prev = from;
    for (const node of list) {
      inB(node.start, node.end);
      assert.ok(node.start >= prev, `node at ${node.start} overlaps previous end ${prev}`);
      assert.ok(node.end <= to, `node ${node.start}..${node.end} exceeds container end ${to}`);
      prev = node.end;
      if (node.type === "text") assert.equal(node.text, s.slice(node.start, node.end));
      if (node.type === "element") {
        assert.equal(node.parent, owner);
        assert.equal(node.start, node.open.start);
        inB(node.open.start, node.open.end);
        assert.equal(s[node.open.start], "<");
        assert.ok(node.end >= node.open.end);
        if (node.close) {
          inB(node.close.start, node.close.end);
          assert.equal(node.close.end, node.end);
          assert.ok(node.close.start >= node.open.end);
        }
        if (node.void || node.selfClosing) {
          assert.equal(node.children.length, 0);
          assert.equal(node.end, node.open.end);
        }
        for (const a of node.attrs) {
          assert.ok(a.start >= node.open.start && a.end <= node.open.end, "attr outside start tag");
          assert.ok(a.start <= a.valueStart && a.valueStart <= a.valueEnd && a.valueEnd <= a.end, "attr value range");
          assert.equal(s.slice(a.start, a.start + a.name.length).toLowerCase(), a.name);
          if (a.value === null) assert.equal(a.valueEnd, a.end);
          else assert.equal(s.slice(a.valueStart, a.valueEnd), a.value);
        }
        walkList(node.children, node.open.end, node.close ? node.close.start : node.end, node);
      }
    }
  };
  walkList(parsed.children, 0, n, null);
  parsed.elements.forEach((el, i) => {
    assert.equal(el.id, i);
    if (i) assert.ok(el.start > parsed.elements[i - 1].start);
  });
  for (const d of parsed.errors) inB(d.start, d.end);
}

/** Asserts the structural invariants of a ParsedCss. */
export function checkCss(parsed) {
  const { source: s } = parsed;
  const n = s.length;
  const inB = (a, b) => assert.ok(a >= 0 && a <= b && b <= n, `range ${a}..${b} outside 0..${n}`);
  const decls = (list, from, to) => {
    let prev = from;
    for (const d of list) {
      inB(d.start, d.end);
      assert.ok(d.start >= prev && d.end <= to, "decl order/containment");
      prev = d.end;
      assert.ok(d.nameStart >= d.start && d.nameStart <= d.nameEnd && d.nameEnd <= d.end, "decl name range");
      assert.ok(d.valueStart <= d.valueEnd && d.valueEnd <= d.end, "decl value range");
    }
  };
  const walk = (list, from, to, parent) => {
    let prev = from;
    for (const r of list) {
      inB(r.start, r.end);
      assert.ok(r.start >= prev, `rule at ${r.start} overlaps previous end ${prev}`);
      assert.ok(r.end <= to, `rule ${r.start}..${r.end} exceeds container ${to}`);
      prev = r.end;
      if (r.type === "style") {
        inB(r.selectorStart, r.selectorEnd);
        assert.ok(r.selectorStart >= r.start && r.selectorEnd <= r.block.start);
        assert.equal(r.parent, parent && parent.type === "at" ? parent : null);
      } else {
        inB(r.preludeStart, r.preludeEnd);
        assert.ok(r.preludeStart >= r.start);
      }
      if (r.block) {
        inB(r.block.start, r.block.end);
        assert.ok(r.block.start >= r.start && r.block.end <= r.end);
        assert.equal(s[r.block.start - 1], "{");
        decls(r.decls, r.block.start, r.block.end);
        walk(r.rules, r.block.start, r.block.end, r);
      } else {
        assert.equal(r.rules.length, 0);
        assert.equal(r.decls.length, 0);
      }
    }
  };
  walk(parsed.rules, 0, n, null);
  for (const d of parsed.errors) inB(d.start, d.end);
}

export const errorCount = (parsed) => parsed.errors.filter((d) => d.severity === "error").length;
