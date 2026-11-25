// Live collaboration of Proto designs (task T10): the records adapter (app/src/proto/collab.js) through the record
// engine of collab/office-sync.js between two and three in-memory peers. Edits go through the real operation layer
// and the real controller (undo steps replayed through inverses), messages travel as JSON and are delivered in
// shuffled order; late joiners start from the CRDT state.
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../../app/src/engine/proto/schema.js";
import { apply, applyAll } from "../../app/src/engine/proto/ops.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { indexOf, Index } from "../../app/src/engine/proto/tree.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { createController } from "../../app/src/proto/controller.js";
import { protoCollabAdapter, protoRecords, applyProtoRecords, COLLECTIONS, GROUPS } from "../../app/src/proto/collab.js";
import { OfficeSync } from "../../app/src/collab/office-sync.js";
import { validateRecordOp } from "../../app/src/collab/office-records.js";
import { liveKindOf, canShareLive } from "../../app/src/core/live-kinds.js";

const PAGE = "p1";

function design() {
  let m = S.emptyDocument({ title: "T", created: "2026-01-01T00:00:00Z", pageId: PAGE });
  m = applyAll(m, [
    { op: "node.create", type: "frame", page: PAGE, id: "nA", fields: { name: "A", layout: { type: "flex", dir: "row", gap: 8 } }, children: [{ type: "rect", id: "nA1" }, { type: "frame", id: "nA2", children: [{ type: "text", id: "nA3" }] }] },
    { op: "node.create", type: "frame", page: PAGE, id: "nB", fields: { name: "B", x: 500 } },
  ]).model;
  return m;
}

/** A replica: model, sync engine, controller with a history (like the workspace) and an outbox. */
class Peer {
  constructor(model, site, state = null) {
    this.site = site;
    this.model = model;
    this.sync = new OfficeSync(protoCollabAdapter, model, { site, state });
    if (state) this.model = this.sync.replaceState(state, model);
    this.out = [];
    this.undoStack = [];
    this.redoStack = [];
    this.random = seededRandom(site.charCodeAt(0) * 7919);
    this.ctl = createController({
      model: () => this.model,
      page: PAGE,
      commit: (step, label) => {
        this.model = step.redo(this.model);
        this.undoStack.push({ step, label });
        this.redoStack.length = 0;
        this.flush();
      },
    });
  }
  run(op) {
    // ids from a seeded source per site, so concurrent creations never collide and runs repeat
    return this.ctl.run({ ...op, ...(op.op === "node.create" && !op.id ? { id: `n${this.site}${this.undoStack.length}x${Math.floor(this.random() * 1e6)}` } : {}) });
  }
  undo() {
    const s = this.undoStack.pop();
    this.model = s.step.undo(this.model);
    this.redoStack.push(s);
    this.flush();
  }
  redo() {
    const s = this.redoStack.pop();
    this.model = s.step.redo(this.model);
    this.undoStack.push(s);
    this.flush();
  }
  edit(fn) {
    this.model = fn(this.model);
    this.flush();
  }
  flush() {
    const ops = this.sync.local(this.model);
    if (ops.length) this.out.push(JSON.parse(JSON.stringify(ops)));
  }
  receive(batch) {
    this.flush();
    const r = this.sync.remote(batch.map(validateRecordOp), this.model);
    this.model = r.model;
    return r;
  }
  state() {
    return JSON.parse(JSON.stringify(this.sync.stateJSON()));
  }
}

function deliver(peers, order = (x) => x) {
  for (let round = 0; round < 20; round++) {
    const msgs = [];
    for (const p of peers) {
      for (const b of p.out) msgs.push({ from: p, b });
      p.out = [];
    }
    if (!msgs.length) return;
    for (const { from, b } of order(msgs)) for (const p of peers) if (p !== from) p.receive(b);
  }
  throw new Error("no quiescence");
}

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const shuffle = (r) => (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const recs = (p) => JSON.parse(JSON.stringify(protoRecords(p.model)));
/** The model as a comparable value (records are canonical; children lists checked through the index). */
const shape = (m) => ({ recs: JSON.parse(JSON.stringify(protoRecords(m))), tree: Object.fromEntries([...Index.build(m.nodes).map].map(([k, v]) => [k, v.join(",")]).sort()) });
const converged = (peers) => {
  const a = shape(peers[0].model);
  for (const p of peers.slice(1)) assert.deepEqual(shape(p.model), a, `${p.site} differs from ${peers[0].site}`);
};
/** The cached index must match a fresh build (applyRecords updates it incrementally). */
const indexOk = (m) => {
  const fresh = Index.build(m.nodes);
  const ix = indexOf(m);
  const keys = new Set([...fresh.map.keys(), ...ix.map.keys()]);
  for (const k of keys) assert.deepEqual(ix.get(k), fresh.get(k), `index of ${k}`);
};

test("Proto designs are shared live as records", () => {
  assert.equal(liveKindOf({ office: { kind: "proto" } }), "office");
  assert.equal(canShareLive({ office: { kind: "proto" } }), true);
  assert.equal(typeof protoCollabAdapter.records, "function");
  assert.equal(protoCollabAdapter.inlineMedia, 0, "media bytes travel as chunk records");
});

test("records: the field groups of section 13, canonical values, and a lossless round trip", () => {
  const m = design();
  const r = protoRecords(m);
  assert.deepEqual(r["n:nA"], { type: "frame", page: PAGE, parent: null, ord: m.nodes.nA.ord, name: "A" });
  assert.deepEqual(r["n:nA/lay"].layout, { dir: "row", gap: 8, type: "flex" }, "nested keys are sorted");
  assert.ok(r["n:nA/look"].fills, "fills are in the look record");
  assert.ok(r["n:nA3/text"].text, "text content has its own record");
  assert.ok(r["p:p1"] && !("id" in r["p:p1"]), "pages, without the id (it is the key)");
  assert.ok(r["meta:meta"] && r["meta:breakpoints"] && r["meta:code"], "the other top-level values");
  assert.ok(!("meta:vars" in r), "vars are synced per collection and variable");
  assert.ok(!("meta:schema" in r) && !("meta:nodes" in r));
  // every node field belongs to exactly one group
  const all = Object.values(GROUPS).flat();
  for (const f of S.NODE_FIELDS) if (!["id", "type", "page", "parent", "ord", "name", "visible", "locked"].includes(f)) assert.equal(all.filter((x) => x === f).length, 1, f);
  // a model rebuilt from its records only has the same records
  const empty = { ...S.emptyDocument({ pageId: "p0" }), pages: {}, meta: {} };
  const built = applyProtoRecords(empty, r);
  assert.deepEqual(JSON.parse(JSON.stringify(protoRecords(built))), JSON.parse(JSON.stringify(r)));
  assert.ok(validate(built).ok, JSON.stringify(validate(built).errors.slice(0, 3)));
  indexOk(built);
  // unchanged layers reuse their record objects (records are cached per node object)
  const m2 = apply(m, { op: "node.update", id: "nB", set: { x: 1 } }).model;
  const r2 = protoRecords(m2);
  assert.equal(r2["n:nA/look"], r["n:nA/look"]);
  assert.notEqual(r2["n:nB/geo"], r["n:nB/geo"]);
});

test("unknown fields and unknown top-level values travel too (forward compatibility)", () => {
  const base = design();
  const a = new Peer(base, "a");
  const b = new Peer(base, "b");
  a.edit((m) => ({ ...m, nodes: { ...m.nodes, nA1: { ...m.nodes.nA1, future: { k: 1 } } }, later: { x: [1, 2] } }));
  deliver([a, b]);
  assert.deepEqual(b.model.nodes.nA1.future, { k: 1 });
  assert.deepEqual(b.model.later, { x: [1, 2] });
  converged([a, b]);
});

test("concurrent edits of different fields of one layer and of different layers both win", () => {
  const base = design();
  const peers = ["a", "b", "c"].map((s) => new Peer(base, s));
  const [a, b, c] = peers;
  a.run({ op: "node.update", id: "nA1", set: { fills: [{ type: "solid", color: "#ff0000" }] } });
  b.run({ op: "node.update", id: "nA1", set: { x: 40, y: 12 } });
  c.run({ op: "node.update", id: "nB", set: { name: "Renamed" } });
  c.run({ op: "node.update", id: "nA", set: { "layout.gap": 24 } });
  deliver(peers, shuffle(rng(3)));
  for (const p of peers) {
    assert.equal(p.model.nodes.nA1.fills[0].color, "#ff0000", p.site);
    assert.equal(p.model.nodes.nA1.x, 40, p.site);
    assert.equal(p.model.nodes.nB.name, "Renamed", p.site);
    assert.equal(p.model.nodes.nA.layout.gap, 24, p.site);
  }
  converged(peers);
});

test("concurrent edits of the same record resolve to one value everywhere", () => {
  const base = design();
  const peers = ["a", "b", "c"].map((s) => new Peer(base, s));
  peers[0].run({ op: "node.update", id: "nA1", set: { x: 1 } });
  peers[1].run({ op: "node.update", id: "nA1", set: { x: 2 } });
  peers[2].run({ op: "node.update", id: "nA1", set: { y: 3 } });
  deliver(peers, shuffle(rng(11)));
  converged(peers);
  // x and y share the geometry record: one of the three writes wins as a whole
  const g = peers[0].model.nodes.nA1;
  assert.ok((g.x === 1 && g.y === undefined) || (g.x === 2 && g.y === undefined) || (g.x === undefined && g.y === 3), JSON.stringify(g));
});

test("out of order: a layer that arrives before its page and its parent is placed when they come", () => {
  const base = design();
  const a = new Peer(base, "a");
  const b = new Peer(base, "b");
  const c = new Peer(base, "c");
  const pg = a.run({ op: "page.create", name: "Two" }).ids[0];
  const frame = a.run({ op: "node.create", type: "frame", page: pg, fields: { name: "F" } }).ids[0];
  const msgs = a.out.splice(0);
  for (const m of msgs) b.receive(m);
  // B adds a child to the new frame; C receives it before A's page and frame
  const kid = b.run({ op: "node.create", type: "rect", parent: frame }).ids[0];
  c.receive(b.out[0]);
  assert.ok(!c.model.nodes[kid], "not shown before its page exists");
  c.receive(msgs[1]);
  c.receive(msgs[0]);
  assert.equal(c.model.nodes[kid]?.parent, frame, "placed under its parent once page and frame arrived");
  assert.equal(c.model.nodes[frame]?.page, pg);
  for (const m of msgs) b.receive(m); // duplicates are harmless
  deliver([a, b, c]);
  converged([a, b, c]);
  indexOk(c.model);
  assert.ok(validate(c.model).ok);
});

test("a layer moved into a frame that someone else deletes stays visible at the top level", () => {
  const base = design();
  const a = new Peer(base, "a");
  const b = new Peer(base, "b");
  a.run({ op: "node.delete", ids: ["nA2"] });
  b.run({ op: "node.move", ids: ["nA1"], parent: "nA2" });
  deliver([a, b], (x) => x.reverse());
  for (const p of [a, b]) {
    assert.ok(!p.model.nodes.nA2 && !p.model.nodes.nA3, p.site);
    assert.equal(p.model.nodes.nA1?.parent, null, `${p.site}: lifted to the top level`);
    indexOk(p.model);
    assert.ok(validate(p.model).ok, `${p.site}: ${JSON.stringify(validate(p.model).errors.slice(0, 2))}`);
  }
  converged([a, b]);
});

test("concurrent moves that would form a parent cycle are broken the same way everywhere", () => {
  let base = design();
  base = apply(base, { op: "node.create", type: "frame", page: PAGE, id: "nC" }).model;
  const a = new Peer(base, "a");
  const b = new Peer(base, "b");
  a.run({ op: "node.move", ids: ["nB"], parent: "nC" });
  b.run({ op: "node.move", ids: ["nC"], parent: "nB" });
  deliver([a, b], shuffle(rng(5)));
  converged([a, b]);
  for (const p of [a, b]) {
    assert.equal(p.model.nodes.nB.parent, null, "the smallest id on the cycle goes to the top level");
    assert.equal(p.model.nodes.nC.parent, "nB");
    indexOk(p.model);
    assert.ok(validate(p.model).ok);
  }
});

test("Undo through the controller reverts only my step; remote edits made since stay", () => {
  const base = design();
  const a = new Peer(base, "a");
  const b = new Peer(base, "b");
  a.run({ op: "node.update", id: "nA1", set: { fills: [{ type: "solid", color: "#00ff00" }] } });
  deliver([a, b]);
  b.run({ op: "node.update", id: "nA1", set: { x: 77 } });
  b.run({ op: "node.update", id: "nB", set: { name: "From B" } });
  const added = b.run({ op: "node.create", type: "ellipse", parent: "nA" }).ids[0];
  deliver([a, b]);
  a.undo();
  deliver([a, b]);
  for (const p of [a, b]) {
    assert.equal(p.model.nodes.nA1.fills[0].color, "#d4d4d8", `${p.site}: my fill reverted`);
    assert.equal(p.model.nodes.nA1.x, 77, `${p.site}: B's move kept`);
    assert.equal(p.model.nodes.nB.name, "From B");
    assert.ok(p.model.nodes[added], "B's new layer kept");
  }
  a.redo();
  deliver([a, b]);
  assert.equal(b.model.nodes.nA1.fills[0].color, "#00ff00");
  assert.equal(b.model.nodes.nA1.x, 77);
  converged([a, b]);
  // undo of a deletion restores the layers on every replica
  b.ctl.select(["nA2"]);
  b.ctl.deleteSelection();
  deliver([a, b]);
  assert.ok(!a.model.nodes.nA3);
  b.undo();
  deliver([a, b]);
  assert.ok(a.model.nodes.nA2 && a.model.nodes.nA3?.parent === "nA2");
  converged([a, b]);
  indexOk(a.model);
});

test("a late joiner starts from the CRDT state and then edits along", () => {
  const base = design();
  const a = new Peer(base, "a");
  const b = new Peer(base, "b");
  a.run({ op: "node.update", id: "nA", set: { name: "Hero" } });
  b.run({ op: "page.create", name: "Second" });
  deliver([a, b]);
  // C opens the snapshot (a's model as saved, so far behind a concurrent edit) with a's state
  const snapshot = a.model;
  const state = a.state();
  b.run({ op: "node.update", id: "nB", set: { opacity: 0.5 } });
  const c = new Peer(snapshot, "c", state);
  deliver([a, b, c]);
  assert.equal(c.model.nodes.nA.name, "Hero");
  assert.equal(c.model.nodes.nB.opacity, 0.5);
  c.run({ op: "node.update", id: "nA1", set: { radius: 6 } });
  deliver([a, b, c]);
  assert.equal(a.model.nodes.nA1.radius, 6);
  converged([a, b, c]);
});

test("variables, collections and styles sync per entry; a new collection map needs no code (meta record)", () => {
  assert.deepEqual(COLLECTIONS.map((c) => c.prefix), ["p", "vc", "v", "s", "media"]);
  const base = design();
  const a = new Peer(base, "a");
  const b = new Peer(base, "b");
  a.edit((m) => ({ ...m, vars: { collections: { c1: { id: "c1", name: "Color", modes: [{ id: "light", name: "Light" }], default: "light" } }, items: { v1: { id: "v1", name: "brand", coll: "c1", type: "color", values: { light: "#4f46e5" } } } } }));
  b.edit((m) => ({ ...m, styles: { s1: { id: "s1", name: "Body", kind: "text", value: { font: "Inter", size: 16 } } } }));
  deliver([a, b], (x) => x.reverse());
  for (const p of [a, b]) {
    assert.equal(p.model.vars.items.v1?.values.light, "#4f46e5", p.site);
    assert.equal(p.model.styles.s1?.name, "Body", p.site);
  }
  // concurrent edits of two variables both win
  a.edit((m) => ({ ...m, vars: { ...m.vars, items: { ...m.vars.items, v1: { ...m.vars.items.v1, name: "brand/primary" } } } }));
  b.edit((m) => ({ ...m, vars: { ...m.vars, items: { ...m.vars.items, v2: { id: "v2", name: "space", coll: "c1", type: "number", values: { light: 4 } } } } }));
  deliver([a, b], shuffle(rng(9)));
  assert.equal(b.model.vars.items.v1.name, "brand/primary");
  assert.equal(a.model.vars.items.v2.values.light, 4);
  converged([a, b]);
  assert.ok(validate(a.model).ok, JSON.stringify(validate(a.model).errors.slice(0, 3)));
});

test("media bytes travel as chunk records and arrive in any order", () => {
  const base = design();
  const a = new Peer(base, "a");
  const b = new Peer(base, "b");
  const bytes = new Uint8Array(120 * 1024).map((_, i) => (i * 31) & 255);
  a.edit((m) => ({ ...m, media: { m1: { id: "m1", mime: "image/png", name: "big.png", w: 10, h: 10, bytes } } }));
  a.run({ op: "node.update", id: "nA1", set: { fills: [{ type: "image", media: "m1", fit: "cover" }] } });
  const msgs = a.out.splice(0);
  for (const m of msgs.reverse()) for (const op of shuffle(rng(2))(m)) b.receive([op]);
  assert.equal(b.model.media.m1?.name, "big.png");
  assert.ok(b.model.media.m1.bytes instanceof Uint8Array);
  assert.deepEqual(b.model.media.m1.bytes, bytes);
  assert.equal(b.model.nodes.nA1.fills[0].media, "m1");
});

test("malformed records are rejected and do not reach the model", () => {
  const base = design();
  const b = new Peer(base, "b");
  const before = b.model;
  const bad = [
    { k: "n:nA1/look", v: { fills: "red" }, c: 50, s: "z" },
    { k: "n:nA1", v: { type: "script", page: PAGE, parent: null, ord: "V" }, c: 51, s: "z" },
    { k: "n:nEvil/geo", v: { x: "1e999" }, c: 52, s: "z" },
    { k: "n:nX", v: { type: "rect", page: PAGE, parent: null, ord: "V0" }, c: 53, s: "z" },
    { k: "p:p1", v: { name: 42, ord: "V" }, c: 54, s: "z" },
    { k: "v:v9", v: { name: "x", coll: "c1", type: "evil", values: {} }, c: 55, s: "z" },
    { k: "meta:meta", v: { unit: "em" }, c: 56, s: "z" },
    { k: "n:nA1/x", v: { __proto__: { polluted: true }, ["constructor"]: 1 }, c: 57, s: "z" },
    { k: "meta:__proto__", v: { polluted: true }, c: 58, s: "z" },
    { k: "n:nA1/unknowngroup", v: { x: 1 }, c: 59, s: "z" },
  ];
  b.receive(bad);
  assert.equal(b.model.nodes.nA1.fills[0].color, before.nodes.nA1.fills[0].color);
  assert.equal(b.model.nodes.nA1.type, "rect");
  assert.ok(!b.model.nodes.nX, "a bad order key is refused");
  assert.equal(b.model.pages.p1.name, "Page 1");
  assert.ok(!b.model.vars.items.v9);
  assert.equal(b.model.meta.unit, "px");
  assert.equal({}.polluted, undefined);
  assert.ok(validate(b.model).ok);
  // a valid record for the same key later fixes it
  b.receive([{ k: "n:nA1/look", v: { fills: [{ type: "solid", color: "#123456" }] }, c: 60, s: "z" }]);
  assert.equal(b.model.nodes.nA1.fills[0].color, "#123456");
  // the envelope checks of the record engine still apply
  assert.throws(() => validateRecordOp({ k: "n:nA1", v: { name: "x".repeat(70 * 1024) }, c: 1, s: "z" }));
});

test("convergence: seeded random concurrent histories through the adapter", () => {
  const SEEDS = Number(process.env.PROTO_COLLAB_SEEDS) || 300;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed);
    const base = design();
    const peers = ["a", "b", "c"].map((s) => new Peer(base, s));
    for (let step = 0; step < 30; step++) {
      const p = peers[Math.floor(r() * 3)];
      const ids = Object.keys(p.model.nodes);
      const pick = () => ids[Math.floor(r() * ids.length)];
      const containers = ids.filter((id) => S.isContainer(p.model.nodes[id].type));
      const kind = r();
      try {
        if (kind < 0.25 && containers.length) p.run({ op: "node.create", type: r() < 0.5 ? "rect" : "frame", parent: containers[Math.floor(r() * containers.length)] });
        else if (kind < 0.45 && ids.length) p.run({ op: "node.update", id: pick(), set: { x: Math.round(r() * 100), name: `s${seed}-${step}` } });
        else if (kind < 0.6 && ids.length) p.run({ op: "node.update", id: pick(), set: { opacity: Math.round(r() * 10) / 10 } });
        else if (kind < 0.72 && ids.length > 2) p.run({ op: "node.delete", ids: [pick()] });
        else if (kind < 0.85 && ids.length && containers.length) {
          const target = r() < 0.3 ? null : containers[Math.floor(r() * containers.length)];
          p.run({ op: "node.move", ids: [pick()], parent: target, page: PAGE });
        } else if (kind < 0.88) {
          const pages = Object.keys(p.model.pages);
          if (r() < 0.5 || pages.length < 2) p.run({ op: "page.create", name: `P${step}` });
          else p.run({ op: "page.delete", id: pages.filter((x) => x !== PAGE)[0] });
        } else if (kind < 0.91 && ids.length) {
          const other = Object.keys(p.model.pages).find((x) => x !== PAGE);
          if (other) p.run({ op: "node.move", ids: [pick()], parent: null, page: other });
        } else if (kind < 0.93 && p.redoStack.length) p.redo();
        else if (p.undoStack.length) p.undo();
      } catch {
        /* an operation that is impossible here (a move into its own subtree) */
      }
      if (r() < 0.3) deliver(peers, shuffle(r));
    }
    deliver(peers, shuffle(r));
    // one more round: placements that were local are retried with the next message
    peers[0].run({ op: "meta.update", set: { title: `done ${seed}` } });
    deliver(peers, shuffle(r));
    converged(peers);
    for (const p of peers) {
      indexOk(p.model);
      const v = validate(p.model);
      assert.ok(v.ok, `seed ${seed} ${p.site}: ${JSON.stringify(v.errors.slice(0, 2))}`);
    }
  }
});

test("components, instances, overrides, variables and styles of T5 sync through the operations", () => {
  const base = design();
  const a = new Peer(base, "a");
  const b = new Peer(base, "b");
  a.run({ op: "collection.create", id: "c1", name: "Color", modes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }] });
  a.run({ op: "var.create", id: "v1", coll: "c1", name: "brand", type: "color", values: { light: "#4f46e5", dark: "#818cf8" } });
  a.run({ op: "component.create", ids: ["nA2"], name: "Card" });
  deliver([a, b], (x) => x.reverse());
  assert.equal(b.model.nodes.nA2.type, "component");
  assert.equal(b.model.vars.items.v1.values.dark, "#818cf8");
  // B places an instance and overrides a layer inside it; A binds the component's fill to the variable meanwhile
  b.run({ op: "instance.create", of: "nA2", page: PAGE, id: "nI1", fields: { x: 900 } });
  b.run({ op: "instance.override", id: "nI1", path: "nA3", set: { visible: false } });
  a.run({ op: "node.update", id: "nA2", set: { fills: [{ type: "solid", color: "#ffffff" }] } });
  a.run({ op: "node.bind", id: "nA2", path: "fills.0.color", var: "v1", force: true });
  a.run({ op: "style.create", id: "s1", name: "Body", kind: "text", value: { font: "Inter", size: 16 } });
  deliver([a, b], shuffle(rng(21)));
  for (const p of [a, b]) {
    assert.equal(p.model.nodes.nI1?.of, "nA2", p.site);
    assert.equal(p.model.nodes.nI1.over.nA3.visible, false, p.site);
    assert.deepEqual(p.model.nodes.nA2.fills[0].color, { $var: "v1" }, p.site);
    assert.equal(p.model.styles.s1?.name, "Body", p.site);
    const v = validate(p.model);
    assert.ok(v.ok, `${p.site}: ${JSON.stringify(v.errors.slice(0, 2))}`);
  }
  converged([a, b]);
  // Undo of B's override (a T5 operation with a `restore` inverse) keeps A's later edit of another layer
  a.run({ op: "node.update", id: "nB", set: { y: 40 } });
  deliver([a, b]);
  b.undo();
  deliver([a, b]);
  for (const p of [a, b]) {
    assert.ok(!p.model.nodes.nI1.over?.nA3, `${p.site}: override undone`);
    assert.equal(p.model.nodes.nB.y, 40, `${p.site}: A's edit kept`);
  }
  converged([a, b]);
});
