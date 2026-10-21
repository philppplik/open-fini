import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPopoutUrl, createPopoutRegistry, handoffKey, isMessage, makeEnvelope, nextWindowLabel, parsePopoutParams, readEnvelope, sessionKey } from "../../app/src/platform/popout.js";

describe("popout params and urls", () => {
  it("returns null for a normal window", () => assert.equal(parsePopoutParams("?studio=pixel"), null));
  it("parses studio, doc and pid", () => {
    assert.deepEqual(parsePopoutParams("?popout=pixel&doc=abc123&pid=w1"), { id: "w1", studio: "pixel", doc: "abc123" });
  });
  it("rejects unsafe values", () => {
    const p = parsePopoutParams("?popout=../x&doc=a/b&pid=<script>");
    assert.equal(p.studio, "");
    assert.equal(p.doc, null);
    assert.match(p.id, /^[a-z0-9]+$/);
  });
  it("builds a url that round-trips", () => {
    const u = buildPopoutUrl("index.html?old=1", { studio: "code", doc: "d1", pid: "p1" });
    assert.equal(u, "index.html?popout=code&doc=d1&pid=p1");
    assert.deepEqual(parsePopoutParams(u.slice(u.indexOf("?"))), { id: "p1", studio: "code", doc: "d1" });
  });
});

describe("handoff envelope", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  it("makes and reads an envelope", () => {
    const e = makeEnvelope({ id: "x1", name: "A", bytes, studio: "pixel", saved: true });
    assert.equal(e.mode, "move");
    assert.equal(readEnvelope(e).name, "A");
    assert.equal(handoffKey("x1"), "popout:x1");
    assert.equal(sessionKey("x1"), "popout-session:x1");
  });
  it("copy mode is kept, unknown modes fall back to move", () => {
    assert.equal(makeEnvelope({ id: "x", bytes, mode: "copy" }).mode, "copy");
    assert.equal(makeEnvelope({ id: "x", bytes, mode: "zzz" }).mode, "move");
  });
  it("refuses bad input", () => {
    assert.throws(() => makeEnvelope({ id: "bad id", bytes }));
    assert.throws(() => makeEnvelope({ id: "x", bytes: new Uint8Array() }));
    assert.equal(readEnvelope({ v: 2, id: "x", bytes }), null);
    assert.equal(readEnvelope(null), null);
    assert.equal(readEnvelope({ v: 1, id: "x", bytes: [1] }), null);
  });
  it("validates channel messages", () => {
    assert.ok(isMessage({ type: "adopted", id: "a1" }));
    assert.ok(isMessage({ type: "ping" }));
    assert.ok(!isMessage({ type: "adopted" }));
    assert.ok(!isMessage({ type: "evil", id: "a" }));
  });
});

describe("registry", () => {
  it("tracks windows and documents", () => {
    const r = createPopoutRegistry();
    r.add({ id: "w1", label: "popout-1", studio: "pixel" });
    r.add({ id: "w2", label: "popout-3", studio: "code" });
    r.attachDoc("w1", "d1");
    r.attachDoc("w1", "d1");
    assert.equal(r.get("w1").docs.length, 1);
    assert.equal(r.byDoc("d1").id, "w1");
    assert.equal(r.byDoc("nope"), null);
    assert.equal(nextWindowLabel(r.labels()), "popout-2");
    r.remove("w1");
    assert.equal(r.size, 1);
  });
});
