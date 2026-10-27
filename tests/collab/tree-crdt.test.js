// "Edit together" for design documents: fractional keys, the tree CRDT (property-based convergence with a seeded RNG),
// validation of hostile ops, and the full binding path on real core/doc.js documents (flatten → diff → ops → applyView).
import test from "node:test";
import assert from "node:assert/strict";
import { keyBetween, keysBetween, initialKey, isKey } from "../../app/src/collab/fractional.js";
import { TreeCRDT, flattenDoc, diffOps, validateTreeOp, ROOTS, DOC_ID } from "../../app/src/collab/tree-crdt.js";
import { applyView } from "../../app/src/collab/tree-apply.js";
import { Doc } from "../../app/src/core/doc.js";
import { createNode } from "../../app/src/core/nodes.js";

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
const pick = (r, list) => list[Math.floor(r() * list.length)];
const site = (i) => String.fromCharCode(65 + i).repeat(22);

test("fractional keys: ordering, density, determinism", () => {
  const r = rng(7);
  let keys = [keyBetween(null, null)];
  for (let i = 0; i < 3000; i++) {
    const at = Math.floor(r() * (keys.length + 1));
    const k = keyBetween(at ? keys[at - 1] : null, at < keys.length ? keys[at] : null);
    assert.ok(isKey(k), k);
    keys.splice(at, 0, k);
  }
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i]);
  const ks = keysBetween("a", "b", 50);
  assert.equal(ks.length, 50);
  for (let i = 1; i < ks.length; i++) assert.ok(ks[i - 1] < ks[i] && ks[0] > "a" && ks[49] < "b");
  const init = Array.from({ length: 100 }, (_, i) => initialKey(i, 100));
  for (let i = 1; i < init.length; i++) assert.ok(init[i - 1] < init[i]);
  assert.throws(() => keyBetween("b", "a"));
  assert.equal(isKey("a0"), false);
  assert.equal(isKey("a$"), false);
});

// ---------------------------------------------------------------- pure CRDT convergence

/** A canonical, comparable materialization of a replica (what the document would look like). */
function canonical(t) {
  const V = t.view();
  const node = (id) => {
    const props = Object.fromEntries([...t.propsOf(id)].sort());
    const m = V.mask(id);
    return { id, props, kids: V.kids(id).map(node), ...(m ? { mask: node(m) } : {}) };
  };
  const pages = (root) => V.kids(root).map((p) => ({ id: p, props: Object.fromEntries([...t.propsOf(p)].sort()), root: V.root(p) ? node(V.root(p)) : null }));
  return JSON.stringify({ doc: Object.fromEntries([...t.propsOf(DOC_ID)].sort()), pages: pages(ROOTS.pages), masters: pages(ROOTS.masters), stories: V.kids(ROOTS.stories).map((s) => [s, Object.fromEntries(t.propsOf(s))]) });
}

function baseFlat() {
  const flat = new Map();
  flat.set(DOC_ID, { parent: null, slot: "none", index: 0, props: new Map([["name", '"Poster"']]) });
  flat.set("p1", { parent: ROOTS.pages, slot: "order", index: 0, props: new Map([["name", '"Page 1"'], ["w", "100"]]) });
  flat.set("r1", { parent: "p1", slot: "root", index: 0, props: new Map([["type", '"group"'], ["children", "[]"]]) });
  for (let i = 0; i < 4; i++) flat.set(`n${i}`, { parent: "r1", slot: "order", index: i, props: new Map([["type", '"rect"'], ["x", String(i)]]) });
  flat.set("g1", { parent: "r1", slot: "order", index: 4, props: new Map([["type", '"group"'], ["children", "[]"]]) });
  return flat;
}

/** A random local edit on replica `t`, expressed as unstamped ops (what diffOps would produce for a user action). */
function randomOps(r, t, counter) {
  const V = t.view();
  const nodes = [...V.visible].filter((id) => id !== DOC_ID && !String(V.parent.get(id)).startsWith("#") && V.keyOf.get(id) !== "#root");
  const containers = [...V.visible].filter((id) => t.propsOf(id).has("children"));
  const kind = r();
  if (kind < 0.25 || !nodes.length) {
    const p = pick(r, containers);
    const kids = V.kids(p);
    const at = Math.floor(r() * (kids.length + 1));
    const lo = at ? V.keyOf.get(kids[at - 1]) : null;
    const hi = at < kids.length ? V.keyOf.get(kids[at]) : null;
    if (lo !== null && hi !== null && lo >= hi) return [];
    const group = r() < 0.3;
    return [{ o: "add", id: `x${counter}`, p, k: keyBetween(lo, hi), v: group ? { type: "group", children: [] } : { type: "rect", x: Math.round(r() * 100) } }];
  }
  const id = pick(r, nodes);
  if (kind < 0.55) return [{ o: "set", id, f: pick(r, ["x", "y", "fill", "name"]), v: Math.round(r() * 1000) }];
  if (kind < 0.62) return [{ o: "set", id, f: "x" }];
  if (kind < 0.75) return [{ o: "del", id }];
  if (kind < 0.8) return [{ o: "set", id: DOC_ID, f: "name", v: `Doc ${counter}` }];
  if (kind < 0.85) return [{ o: "add", id, p: V.parent.get(id), k: V.keyOf.get(id), v: { type: "rect", x: 1 } }]; // restore / re-add
  const p = pick(r, containers);
  if (p === id) return [];
  const kids = V.kids(p).filter((k) => k !== id);
  const at = Math.floor(r() * (kids.length + 1));
  const lo = at ? V.keyOf.get(kids[at - 1]) : null;
  const hi = at < kids.length ? V.keyOf.get(kids[at]) : null;
  if (lo !== null && hi !== null && lo >= hi) return [];
  return [{ o: "mv", id, p, k: keyBetween(lo, hi), q: V.parent.get(id), qk: V.keyOf.get(id) }];
}

test("tree CRDT: N replicas, random concurrent ops, random delivery order (with duplicates) converge", () => {
  const ITER = 3000;
  for (let it = 0; it < ITER; it++) {
    const r = rng(1000 + it);
    const n = 2 + Math.floor(r() * 3);
    const reps = Array.from({ length: n }, (_, i) => TreeCRDT.fromFlat(baseFlat(), site(i)));
    const inbox = reps.map(() => []);
    let counter = 0;
    const steps = 4 + Math.floor(r() * 16);
    for (let s = 0; s < steps; s++) {
      const i = Math.floor(r() * n);
      // deliver a random part of the inbox first (causal order is NOT guaranteed: messages are shuffled)
      const box = inbox[i];
      for (let d = Math.floor(r() * (box.length + 1)); d > 0; d--) {
        const m = box.splice(Math.floor(r() * box.length), 1)[0];
        for (const op of m.ops) reps[i].apply(validateTreeOp(op), m.site);
        if (r() < 0.1) box.push(m); // duplicate delivery later
      }
      const ops = reps[i].applyLocal(randomOps(r, reps[i], `${i}_${counter++}`));
      for (let j = 0; j < n; j++) if (j !== i && ops.length) inbox[j].push({ site: site(i), ops: JSON.parse(JSON.stringify(ops)) });
    }
    for (let i = 0; i < n; i++) {
      const box = inbox[i];
      while (box.length) {
        const m = box.splice(Math.floor(r() * box.length), 1)[0];
        for (const op of m.ops) reps[i].apply(op, m.site);
      }
    }
    const first = canonical(reps[0]);
    for (let i = 1; i < n; i++) assert.equal(canonical(reps[i]), first, `iteration ${it}: replica ${i} diverged`);
    // the serialized state round-trips
    assert.equal(canonical(TreeCRDT.fromJSON(JSON.parse(JSON.stringify(reps[0].toJSON())))), first);
  }
});

test("tree CRDT: conflict policy (LWW per field, delete wins over edits, restore after delete, move cycles)", () => {
  const a = TreeCRDT.fromFlat(baseFlat(), site(0));
  const b = TreeCRDT.fromFlat(baseFlat(), site(1));
  const sync = () => {
    const ja = JSON.parse(JSON.stringify(a.toJSON()));
    const jb = JSON.parse(JSON.stringify(b.toJSON()));
    for (const t of [a, b]) for (const j of [ja, jb]) for (const [id, , , props] of j.e) for (const [f, v, l, s] of props) t.apply({ o: "set", id, f, ...(v === null ? {} : { v: JSON.parse(v) }), c: l }, s);
  };
  // same field: higher lamport wins, then site
  const oa = a.applyLocal([{ o: "set", id: "n0", f: "x", v: 10 }]);
  const ob = b.applyLocal([{ o: "set", id: "n0", f: "x", v: 20 }]);
  a.apply(ob[0], site(1));
  b.apply(oa[0], site(0));
  assert.equal(a.propsOf("n0").get("x"), "20"); // equal lamport → site B > site A
  assert.equal(b.propsOf("n0").get("x"), "20");
  // delete wins over a concurrent edit
  const d = a.applyLocal([{ o: "del", id: "n1" }]);
  const e = b.applyLocal([{ o: "set", id: "n1", f: "x", v: 99 }]);
  a.apply(e[0], site(1));
  b.apply(d[0], site(0));
  assert.equal(a.view().visible.has("n1"), false);
  assert.equal(b.view().visible.has("n1"), false);
  // a restore after seeing the delete brings it back
  const back = b.applyLocal([{ o: "add", id: "n1", p: "r1", k: b.entries.get("n1").pos.key, v: { type: "rect", x: 1 } }]);
  a.apply(back[0], site(1));
  assert.ok(a.view().visible.has("n1"));
  // concurrent moves into each other: no cycle, both replicas agree
  a.applyLocal([{ o: "add", id: "g2", p: "r1", k: "zz", v: { type: "group", children: [] } }]).forEach((op) => b.apply(op, site(0)));
  const m1 = a.applyLocal([{ o: "mv", id: "g1", p: "g2", k: "V", q: "r1", qk: a.view().keyOf.get("g1") }]);
  const m2 = b.applyLocal([{ o: "mv", id: "g2", p: "g1", k: "V", q: "r1", qk: b.view().keyOf.get("g2") }]);
  a.apply(m2[0], site(1));
  b.apply(m1[0], site(0));
  assert.equal(canonical(a), canonical(b));
  assert.ok(a.view().visible.has("g1") && a.view().visible.has("g2"));
  sync();
  assert.equal(canonical(a), canonical(b));
});

test("tree ops: hostile input is rejected", () => {
  const bad = [
    null,
    { o: "set", id: "n1", f: "__proto__", v: 1, c: 1 },
    { o: "set", id: "n1", f: "_parent", v: 1, c: 1 },
    { o: "set", id: "n1", f: "constructor", v: 1, c: 1 },
    { o: "set", id: "#doc", f: "comments", v: [], c: 1 },
    { o: "set", id: "n1", f: "x", v: { __proto__: null, constructor: 1 }, c: 1 },
    { o: "set", id: "n1", f: "x", v: "y".repeat(200 * 1024), c: 1 },
    { o: "add", id: "n1", p: "n1", k: "V", v: {}, c: 1 },
    { o: "add", id: "n1", p: "r1", k: "a0", v: {}, c: 1 },
    { o: "mv", id: "#doc", p: "r1", k: "V", c: 1 },
    { o: "del", id: "n1", c: 0 },
    { o: "del", id: "n1", c: 2 ** 60 },
    { o: "del", id: "../x", c: 1 },
    { o: "del", id: "n1", c: 1, extra: true },
    { o: "eval", id: "n1", c: 1 },
  ];
  for (const op of bad) assert.throws(() => validateTreeOp(op), JSON.stringify(op)?.slice(0, 60));
  let deep = 1;
  for (let i = 0; i < 40; i++) deep = [deep];
  assert.throws(() => validateTreeOp({ o: "set", id: "n1", f: "x", v: deep, c: 1 }));
  assert.deepEqual(validateTreeOp({ o: "set", id: "n_1", f: "fill", v: { color: "#fff" }, c: 3 }), { o: "set", id: "n_1", f: "fill", v: { color: "#fff" }, c: 3 });
  assert.throws(() => TreeCRDT.fromJSON({ v: 1, l: 1, e: [["n1", ["r1", "a0", 1, "x"], 0, []]] }));
});

// ---------------------------------------------------------------- the binding path on real documents

function replicaOf(json, i) {
  const doc = Doc.fromJSON(JSON.parse(JSON.stringify(json)));
  const crdt = TreeCRDT.fromFlat(flattenDoc(doc), site(i));
  return { doc, crdt, prev: new Set(flattenDoc(doc).keys()), graveyard: new Map(), cache: new WeakMap() };
}
function localStep(r) {
  const flat = flattenDoc(r.doc, r.cache);
  const ops = r.crdt.applyLocal(diffOps(r.crdt, flat, r.prev));
  r.prev = new Set(flat.keys());
  return ops;
}
function remoteStep(r, ops, from) {
  for (const op of ops) r.crdt.apply(validateTreeOp(JSON.parse(JSON.stringify(op))), from);
  applyView(r.doc, r.crdt, { graveyard: r.graveyard });
  r.prev = new Set(flattenDoc(r.doc).keys());
}
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const docState = (d) => {
  const j = d.toJSON();
  delete j.modifiedAt;
  return JSON.stringify(sorted(j)); // field order of objects created by a remote add may differ; content may not
};

test("binding: edits made through the document API reach the other replica exactly, with no echo", () => {
  const base = new Doc({ name: "Poster", pages: 2 });
  for (let i = 0; i < 3; i++) base.insert(createNode("rect", { name: `R${i}` }), base.pages[0].root);
  base.insert(createNode("group", { name: "G" }), base.pages[0].root);
  const json = base.toJSON();
  const A = replicaOf(json, 0);
  const B = replicaOf(json, 1);
  assert.equal(docState(A.doc), docState(B.doc));
  const [r0, r1, r2, g] = A.doc.pages[0].root.children;
  A.doc.set(r0, { fill: { type: "solid", color: "#ff0000" }, name: "Red" });
  A.doc.move(r2, g, 0);
  A.doc.move(r1, A.doc.pages[0].root, 0);
  A.doc.insert(createNode("ellipse", { name: "E" }), A.doc.pages[1].root);
  A.doc.remove(A.doc.pages[0].root.children.find((n) => n.name === "Red"));
  A.doc.addPage({ name: "Third" });
  A.doc.set(A.doc, { name: "Poster v2" });
  A.doc.setMask(g, createNode("rect", { name: "Mask" }));
  const ops = localStep(A);
  assert.ok(ops.length > 5);
  remoteStep(B, ops, site(0));
  assert.equal(docState(B.doc), docState(A.doc));
  // no echo: B's diff after applying is empty, and so is A's
  assert.deepEqual(diffOps(B.crdt, flattenDoc(B.doc), B.prev), []);
  assert.deepEqual(diffOps(A.crdt, flattenDoc(A.doc), A.prev), []);
  // local undo on A reverts only A's step and travels as new ops
  A.doc.undo();
  remoteStep(B, localStep(A), site(0));
  assert.equal(docState(B.doc), docState(A.doc));
  // remote edits do not enter B's undo history
  assert.equal(B.doc.history.entries.length, 0);
});

test("binding: random concurrent edits on two to three documents converge (property test)", () => {
  for (let it = 0; it < 500; it++) {
    const r = rng(500 + it);
    const base = new Doc({ name: "D", pages: 1 });
    for (let i = 0; i < 4; i++) base.insert(createNode(i === 3 ? "group" : "rect", { name: `N${i}` }), base.pages[0].root);
    const json = base.toJSON();
    const n = 2 + Math.floor(r() * 2);
    const reps = Array.from({ length: n }, (_, i) => replicaOf(json, i));
    const inbox = reps.map(() => []);
    for (let s = 0; s < 10; s++) {
      const i = Math.floor(r() * n);
      const R = reps[i];
      // deliver some pending messages (FIFO per sender, as relays and BroadcastChannel do)
      while (inbox[i].length && r() < 0.6) {
        const m = inbox[i].shift();
        remoteStep(R, m.ops, m.site);
      }
      const all = [];
      R.doc.walkAll((x) => x._parent && all.push(x));
      const groups = all.filter((x) => x.type === "group");
      const k = r();
      if (k < 0.3 || !all.length) R.doc.insert(createNode(r() < 0.3 ? "group" : "rect", { name: `A${it}${s}` }), pick(r, [R.doc.pages[0].root, ...groups]), 0);
      else if (k < 0.6) R.doc.set(pick(r, all), { opacity: Math.round(r() * 100) / 100 });
      else if (k < 0.75) R.doc.remove(pick(r, all));
      else {
        const node = pick(r, all);
        const target = pick(r, [R.doc.pages[0].root, ...groups]);
        let ok = target !== node;
        for (let p = target; p; p = p._parent) if (p === node) ok = false;
        if (ok) R.doc.move(node, target, Math.floor(r() * (target.children.length + 1)));
      }
      const ops = localStep(R);
      if (ops.length) for (let j = 0; j < n; j++) if (j !== i) inbox[j].push({ site: site(i), ops });
    }
    for (let i = 0; i < n; i++) while (inbox[i].length) {
      const m = inbox[i].shift();
      remoteStep(reps[i], m.ops, m.site);
    }
    const first = docState(reps[0].doc);
    for (let i = 1; i < n; i++) assert.equal(docState(reps[i].doc), first, `iteration ${it}`);
  }
});
