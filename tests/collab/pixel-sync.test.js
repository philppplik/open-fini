// Live pixel layers: tiles of a bitmap converge between in-memory peers (collab/pixel-sync.js). Pixel strokes used
// not to travel at all (only the layer structure was live).
import test from "node:test";
import assert from "node:assert/strict";
import { PixelSync, TILE, validatePixelOp, decodeTile, tileHashes } from "../../app/src/collab/pixel-sync.js";

const img = (w, h, fill = 0) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(fill) });
const paint = (im, x, y, w, h, v) => {
  for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) im.data.fill(v, (r * im.width + c) * 4, (r * im.width + c) * 4 + 4);
};

/** A replica of one layer: the image plays the canvas. */
class Peer {
  constructor(site, w, h) {
    this.px = new PixelSync(site);
    this.img = img(w, h);
    this.px.baseline("L", this.img);
    this.out = [];
  }
  stroke(x, y, w, h, v) {
    paint(this.img, x, y, w, h, v);
    this.out.push(...JSON.parse(JSON.stringify(this.px.local("L", this.img))));
  }
  resize(w, h) {
    const next = img(w, h);
    for (let r = 0; r < Math.min(h, this.img.height); r++) next.data.set(this.img.data.subarray(r * this.img.width * 4, (r * this.img.width + Math.min(w, this.img.width)) * 4), r * w * 4);
    this.img = next;
    this.out.push(...JSON.parse(JSON.stringify(this.px.local("L", this.img))));
  }
  receive(raw) {
    const op = validatePixelOp(raw);
    const r = this.px.remote(op);
    if (!r.apply) return;
    if (r.resize) {
      const next = img(op.W, op.H);
      for (let row = 0; row < Math.min(op.H, this.img.height); row++) next.data.set(this.img.data.subarray(row * this.img.width * 4, (row * this.img.width + Math.min(op.W, this.img.width)) * 4), row * op.W * 4);
      this.img = next;
    }
    const tile = decodeTile(op);
    for (let row = 0; row < op.h; row++) this.img.data.set(tile.subarray(row * op.w * 4, (row + 1) * op.w * 4), ((op.y + row) * this.img.width + op.x) * 4);
    this.px.applied(op, tile);
  }
}

function exchange(peers, order = (x) => x) {
  const msgs = [];
  for (const p of peers) {
    for (const op of p.out) msgs.push({ p, op });
    p.out = [];
  }
  for (const { p, op } of order(msgs)) for (const q of peers) if (q !== p) q.receive(op);
}
const same = (a, b) => a.img.width === b.img.width && a.img.height === b.img.height && Buffer.compare(Buffer.from(a.img.data), Buffer.from(b.img.data)) === 0;

test("strokes in different tiles merge; only changed tiles are sent", () => {
  const a = new Peer("a", 300, 200);
  const b = new Peer("b", 300, 200);
  a.stroke(5, 5, 10, 10, 200);
  assert.equal(a.out.length, 1, "one tile");
  b.stroke(250, 150, 20, 20, 90);
  exchange([a, b]);
  assert.ok(same(a, b));
  assert.equal(a.img.data[(6 * 300 + 6) * 4], 200);
  assert.equal(a.img.data[(160 * 300 + 260) * 4], 90);
  // receiving does not make a peer send the tile back
  a.out.push(...a.px.local("L", a.img));
  assert.equal(a.out.length, 0);
});

test("the same tile goes to the later stroke on every replica, in any delivery order", () => {
  for (const reverse of [false, true]) {
    const a = new Peer("a", 256, 256);
    const b = new Peer("b", 256, 256);
    a.stroke(0, 0, 50, 50, 10);
    b.stroke(10, 10, 50, 50, 20);
    exchange([a, b], reverse ? (m) => [...m].reverse() : undefined);
    assert.ok(same(a, b), `reverse=${reverse}`);
  }
});

test("a resize wins over concurrent strokes on the old size, on every replica", () => {
  const a = new Peer("a", 256, 256);
  const b = new Peer("b", 256, 256);
  a.resize(300, 140);
  b.stroke(0, 0, 10, 10, 77);
  exchange([a, b], (m) => [...m].reverse());
  assert.equal(b.img.width, 300);
  assert.ok(same(a, b));
  assert.equal(TILE, 128);
  assert.equal(tileHashes(a.img).size, 6);
});

test("hostile pixel ops are refused", () => {
  const good = { o: "px", id: "L", W: 10, H: 10, s: [0, ""], x: 0, y: 0, w: 10, h: 10, d: "", c: [1, "a"] };
  assert.ok(validatePixelOp(good));
  for (const bad of [{ ...good, x: 5 }, { ...good, w: 11 }, { ...good, W: 1e6 }, { ...good, d: "<script>" }, { ...good, c: [1] }, { ...good, id: "__proto__" }, { ...good, s: null }]) assert.throws(() => validatePixelOp(bad));
  assert.throws(() => decodeTile({ ...good, d: Buffer.from("junk").toString("base64") }));
});
