import test from "node:test";
import assert from "node:assert/strict";
import { bridgeSource } from "../../app/src/ui/code/bridge.js";

test("the preview bridge compiles and carries the measure kit", () => {
  assert.doesNotThrow(() => new Function(bridgeSource));
  assert.match(bridgeSource, /gapGuides/);
  assert.match(bridgeSource, /type: "measureInfo"/);
  assert.match(bridgeSource, /case "probe"/);
  assert.match(bridgeSource, /Invalid CSS selector/, "the probe kit is injected");
});

test("the bridge only accepts messages from the parent and validates measure options", () => {
  assert.match(bridgeSource, /e\.source !== TOP/);
  assert.match(bridgeSource, /kit\.UNITS\.indexOf\(m\.unit\)/);
  assert.match(bridgeSource, /\^#\[0-9a-f\]\{3,8\}\$/);
});

test("probe replies from the frame are reduced to plain, limited JSON", async () => {
  const { sanitizeProbe, probeKit, PROBE_ACTIONS } = await import("../../app/src/ui/code/probe.js");
  const evil = { a: "x".repeat(5000), list: Array.from({ length: 200 }, (_, i) => i), fn: () => 1, n: Infinity, deep: { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } } };
  Object.defineProperty(evil, "__proto__", { value: { polluted: true }, enumerable: true });
  const s = sanitizeProbe(evil);
  assert.equal(s.a.length, 2100);
  assert.equal(s.list.length, 60);
  assert.equal(s.fn, null);
  assert.equal(s.n, null);
  assert.equal(JSON.stringify(s).includes("polluted"), false);
  assert.equal(JSON.stringify(s.deep).includes('"h"'), false, "depth is limited");
  // the kit must be self-contained: it is injected with Function#toString
  assert.doesNotThrow(() => new Function(`return (${probeKit.toString()})`));
  assert.ok(!/\b(import|require)\s*\(/.test(probeKit.toString()));
  assert.ok(!/\beval\s*\(|new Function/.test(probeKit.toString()), "the probe never evaluates code");
  assert.ok(PROBE_ACTIONS.includes("click"));
});
