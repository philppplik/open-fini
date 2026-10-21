import test from "node:test";
import assert from "node:assert/strict";
import { createDispatcher, measure, v, RpcError, PROTOCOL } from "../../app/src/extensions/rpc.js";

const req = (m, p, id = 1) => ({ ofx: PROTOCOL, t: "req", id, m, p });
const mk = (over = {}) => {
  const calls = [];
  const d = createDispatcher({
    granted: ["ui", "storage"],
    handlers: {
      "ui.showMessage": (p) => (calls.push(p), null),
      "storage.get": (p) => ({ key: v.str(p.key, "key", { max: 10 }) }),
      "storage.set": () => {
        throw new Error("disk full");
      },
      "ui.prompt": Object.assign(() => new Promise((r) => setTimeout(() => r("late"), 30)), { interactive: true }),
      "ui.confirm": () => new Promise(() => {}),
      "studio.current": () => "vector",
      "document.callTool": () => "ran",
    },
    ...over,
  });
  return { d, calls };
};

test("a permitted call returns its result", async () => {
  const { d, calls } = mk();
  const r = await d.dispatch(req("ui.showMessage", { text: "hi" }));
  assert.deepEqual(r, { ofx: 1, t: "res", id: 1, ok: true, r: null });
  assert.deepEqual(calls, [{ text: "hi" }]);
});

test("calls without the permission are rejected before the handler runs", async () => {
  const { d, calls } = mk({ granted: [] });
  const r = await d.dispatch(req("ui.showMessage", { text: "hi" }));
  assert.equal(r.ok, false);
  assert.equal(r.e.code, "PERMISSION_DENIED");
  assert.match(r.e.message, /“ui” permission/);
  assert.equal(calls.length, 0);
});

test("permissions can be revoked at runtime", async () => {
  const { d } = mk();
  assert.equal((await d.dispatch(req("storage.get", { key: "a" }))).ok, true);
  d.setGranted([]);
  assert.equal((await d.dispatch(req("storage.get", { key: "a" }))).e.code, "PERMISSION_DENIED");
});

test("foreign or malformed messages are ignored or rejected", async () => {
  const { d } = mk();
  assert.equal(await d.dispatch(null), null);
  assert.equal(await d.dispatch({ type: "other" }), null);
  assert.equal(await d.dispatch({ ofx: 1, t: "req", id: {}, m: "ui.x" }), null);
  assert.equal((await d.dispatch(req("../etc", {}))).e.code, "BAD_REQUEST");
  assert.equal((await d.dispatch(req("nope.method", {}))).e.code, "UNKNOWN_METHOD");
  assert.equal((await d.dispatch(req("storage.get", [1]))).e.code, "BAD_REQUEST");
});

test("handler validation errors and exceptions become structured errors", async () => {
  const { d } = mk();
  const bad = await d.dispatch(req("storage.get", { key: 5 }));
  assert.equal(bad.e.code, "BAD_REQUEST");
  assert.match(bad.e.message, /key must be a string/);
  const boom = await d.dispatch(req("storage.set", { key: "a", value: 1 }));
  assert.equal(boom.e.code, "HANDLER_ERROR");
  assert.equal(boom.e.message, "disk full");
});

test("oversized and non-cloneable payloads are refused and reported", async () => {
  const seen = [];
  const { d } = mk({ limits: { maxRequestBytes: 100 }, onViolation: (k) => seen.push(k) });
  const r = await d.dispatch(req("ui.showMessage", { text: "x".repeat(500) }));
  assert.equal(r.e.code, "TOO_LARGE");
  const f = await d.dispatch(req("ui.showMessage", { fn() {} }, 2));
  assert.equal(f.e.code, "BAD_VALUE");
  assert.deepEqual(seen, ["size", "value"]);
});

test("rate limiting: burst, refill, and flood kill", async () => {
  let t = 0;
  const seen = [];
  const { d } = mk({ now: () => t, limits: { burst: 3, perSecond: 1, floodKillAfter: 4 }, onViolation: (k) => seen.push(k) });
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await d.dispatch(req("studio.current", {}, i))).ok);
  assert.deepEqual(codes, [true, true, true, false]);
  t += 2000;
  assert.equal((await d.dispatch(req("studio.current", {}, 9))).ok, true);
  for (let i = 0; i < 10; i++) await d.dispatch(req("studio.current", {}, 20 + i));
  assert.ok(seen.includes("flood"));
});

test("timeouts: normal calls time out, interactive calls get longer", async () => {
  const { d } = mk({ limits: { callTimeoutMs: 20, interactiveTimeoutMs: 500 } });
  const slow = await d.dispatch(req("ui.confirm", { text: "x" }));
  assert.equal(slow.e.code, "TIMEOUT");
  const ok = await d.dispatch(req("ui.prompt", { label: "x" }, 2));
  assert.equal(ok.r, "late");
});

test("document.callTool is checked against the tool kind", async () => {
  const kinds = { add_shape: "write", list_layers: "read", generate_image: "denied" };
  const { d } = mk({ granted: ["document.read"], toolKind: async (n) => kinds[n] || "denied" });
  assert.equal((await d.dispatch(req("document.callTool", { name: "list_layers" }))).ok, true);
  assert.equal((await d.dispatch(req("document.callTool", { name: "add_shape" }, 2))).e.code, "PERMISSION_DENIED");
  assert.match((await d.dispatch(req("document.callTool", { name: "generate_image" }, 3))).e.message, /not available to extensions/);
  d.setGranted(["document.write"]);
  assert.equal((await d.dispatch(req("document.callTool", { name: "add_shape" }, 4))).ok, true);
});

test("measure counts typed arrays and rejects exotic values", () => {
  assert.equal(measure(new Uint8Array(10)), 10);
  assert.ok(measure({ a: [1, 2, "abc"] }) > 0);
  assert.throws(() => measure(() => 1), RpcError);
  assert.throws(() => measure(new Map()), /cannot be sent/);
  assert.throws(() => measure("x".repeat(100), 10), /larger than/);
  let deep = {};
  for (let i = 0; i < 40; i++) deep = { deep };
  assert.throws(() => measure(deep), /nested too deeply/);
});

test("validators", () => {
  assert.throws(() => v.str(1, "n"), /n must be a string/);
  assert.equal(v.str(undefined, "n", { optional: true }), undefined);
  assert.throws(() => v.num(5, "n", { max: 3 }), /between/);
  assert.throws(() => v.num(1.5, "n", { int: true }), /integer/);
  assert.equal(v.oneOf("a", "n", ["a", "b"]), "a");
  assert.throws(() => v.arr([1, 2, 3], "n", { max: 2 }), /at most 2/);
  assert.deepEqual(v.obj(undefined), {});
  assert.throws(() => v.obj([1]), /must be an object/);
});
