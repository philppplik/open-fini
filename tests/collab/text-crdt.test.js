// "Edit together" for text: the RGA sequence CRDT (property-based convergence with a seeded RNG, out-of-order and
// duplicate delivery), the change lists it reports for editors, serialization and validation of hostile ops.
import test from "node:test";
import assert from "node:assert/strict";
import { TextCRDT, textDiff, validateTextOp } from "../../app/src/collab/text-crdt.js";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const site = (i) => String.fromCharCode(65 + i).repeat(22);
const applyChanges = (text, changes) => changes.reduce((s, c) => s.slice(0, c.from) + c.insert + s.slice(c.to), text);

test("text CRDT: local edits, reported changes and a mirror editor stay identical", () => {
  const a = TextCRDT.fromText("hello world", site(0));
  const b = TextCRDT.fromText("hello world", site(1));
  let mirror = b.text();
  const ops = [a.insert(5, ","), a.remove(0, 1), a.insert(0, "H"), a.insert(a.length, "!")];
  assert.equal(a.text(), "Hello, world!");
  for (const op of ops) {
    const { changes } = b.apply(validateTextOp(JSON.parse(JSON.stringify(op))), site(0));
    mirror = applyChanges(mirror, changes);
  }
  assert.equal(b.text(), "Hello, world!");
  assert.equal(mirror, b.text());
});

test("text CRDT: concurrent inserts at the same place never interleave and converge", () => {
  const a = TextCRDT.fromText("ab", site(0));
  const b = TextCRDT.fromText("ab", site(1));
  const oa = a.insert(1, "XXX");
  const ob = b.insert(1, "yyy");
  a.apply(ob, site(1));
  b.apply(oa, site(0));
  assert.equal(a.text(), b.text());
  assert.ok(["aXXXyyyb", "ayyyXXXb"].includes(a.text()), a.text());
  // typing inside text someone else deletes survives (no silent loss)
  const c = TextCRDT.fromText("delete me", site(2));
  const d = TextCRDT.fromText("delete me", site(3));
  const del = c.remove(0, 9);
  const ins = d.insert(6, " not");
  c.apply(ins, site(3));
  d.apply(del, site(2));
  assert.equal(c.text(), " not");
  assert.equal(d.text(), " not");
});

test("text CRDT: N replicas, random edits, shuffled and duplicated delivery converge; mirrors follow the changes", () => {
  for (let it = 0; it < 1500; it++) {
    const r = rng(42 + it);
    const n = 2 + Math.floor(r() * 3);
    const base = "The quick brown fox".slice(0, Math.floor(r() * 19));
    const reps = Array.from({ length: n }, (_, i) => TextCRDT.fromText(base, site(i)));
    const mirrors = reps.map((x) => x.text());
    const inbox = reps.map(() => []);
    const steps = 5 + Math.floor(r() * 20);
    const deliver = (i, m) => {
      const { changes } = reps[i].apply(validateTextOp(m.op), m.site);
      mirrors[i] = applyChanges(mirrors[i], changes);
    };
    for (let s = 0; s < steps; s++) {
      const i = Math.floor(r() * n);
      for (let d = Math.floor(r() * (inbox[i].length + 1)); d > 0; d--) {
        const m = inbox[i].splice(Math.floor(r() * inbox[i].length), 1)[0];
        deliver(i, m);
        if (r() < 0.1) inbox[i].push(m);
      }
      const t = reps[i];
      let op;
      if (r() < 0.6 || !t.length) {
        const pos = Math.floor(r() * (t.length + 1));
        const str = "abcdefgh".slice(0, 1 + Math.floor(r() * 4)) + s;
        op = t.insert(pos, str);
        mirrors[i] = mirrors[i].slice(0, pos) + str + mirrors[i].slice(pos);
      } else {
        const pos = Math.floor(r() * t.length);
        const len = 1 + Math.floor(r() * Math.min(5, t.length - pos));
        op = t.remove(pos, len);
        mirrors[i] = mirrors[i].slice(0, pos) + mirrors[i].slice(pos + len);
      }
      assert.equal(mirrors[i], t.text());
      for (let j = 0; j < n; j++) if (j !== i) inbox[j].push({ site: site(i), op: JSON.parse(JSON.stringify(op)) });
    }
    for (let i = 0; i < n; i++) while (inbox[i].length) deliver(i, inbox[i].splice(Math.floor(r() * inbox[i].length), 1)[0]);
    const first = reps[0].text();
    for (let i = 0; i < n; i++) {
      assert.equal(reps[i].text(), first, `iteration ${it}: replica ${i}`);
      assert.equal(mirrors[i], first, `iteration ${it}: mirror ${i}`);
      assert.equal(reps[i].pending.length, 0);
    }
    const copy = TextCRDT.fromJSON(JSON.parse(JSON.stringify(reps[0].toJSON())), site(9));
    assert.equal(copy.text(), first);
  }
});

test("text CRDT: large inserts and deletes stay fast", () => {
  const a = TextCRDT.fromText("x".repeat(200_000), site(0));
  const b = TextCRDT.fromText("x".repeat(200_000), site(1));
  const t0 = Date.now();
  const op1 = a.insert(100_000, "y".repeat(60_000));
  const op2 = a.remove(10, 50_000);
  b.apply(op1, site(0));
  b.apply(op2, site(0));
  assert.equal(b.text(), a.text());
  assert.ok(Date.now() - t0 < 3000);
});

test("textDiff gives one minimal replace", () => {
  assert.equal(textDiff("abc", "abc"), null);
  assert.deepEqual(textDiff("hello world", "hello brave world"), { from: 6, to: 6, insert: "brave " });
  assert.deepEqual(textDiff("abcdef", "abef"), { from: 2, to: 4, insert: "" });
});

test("text ops: hostile input is rejected", () => {
  const bad = [
    null,
    { o: "ins", a: null, l: 0, t: "x" },
    { o: "ins", a: null, l: 1, t: "" },
    { o: "ins", a: null, l: 1, t: "x".repeat(70_000) },
    { o: "ins", a: [1, "bad site!"], l: 2, t: "x" },
    { o: "ins", a: null, l: 1, t: "x", s: "AAAAAAAAAAAAAAAAAAAAAA" },
    { o: "del", r: [] },
    { o: "del", r: [[1, "", 0]] },
    { o: "del", r: [[1, ""]] },
    { o: "zap" },
  ];
  for (const op of bad) assert.throws(() => validateTextOp(op), JSON.stringify(op)?.slice(0, 60));
  // an insert that is not newer than its origin is refused (it would break the ordering invariant)
  const t = TextCRDT.fromText("abc", site(0));
  assert.throws(() => t.apply({ o: "ins", a: [3, ""], l: 2, t: "x" }, site(1)));
  assert.throws(() => TextCRDT.fromJSON({ v: 1, l: 1, r: [[1, "", "a", 0], [1, "", "b", 0]] }));
});
