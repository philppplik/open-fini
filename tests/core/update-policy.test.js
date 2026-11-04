import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoCheck, shouldPrompt, summarizeNotes } from "../../app/src/core/update-policy.js";
import { compareVersions } from "../../app/src/core/updates.js";
import { fitSteps } from "../../app/src/core/header-plan.js";

const DAY = 86400000;
test("auto check: off by default, once a day, never offline", () => {
  const now = 10 * DAY;
  assert.equal(shouldAutoCheck({ auto: false, now }), false);
  assert.equal(shouldAutoCheck({ auto: true, lastCheck: 0, now }), true);
  assert.equal(shouldAutoCheck({ auto: true, lastCheck: now - 1000, now }), false);
  assert.equal(shouldAutoCheck({ auto: true, lastCheck: now - DAY, now }), true);
  assert.equal(shouldAutoCheck({ auto: true, now, offline: true }), false);
  assert.equal(shouldAutoCheck({ auto: true, now, safeMode: true }), false);
  assert.equal(shouldAutoCheck({ auto: true, now, dev: true }), false);
});

test("prompt: newer, not skipped, not a pre-release", () => {
  const r = (version, extra) => ({ version, ...extra });
  const p = (release, skipped = "") => shouldPrompt({ release, current: "1.0.0", skipped, compare: compareVersions });
  assert.equal(p(r("1.1.0")), true);
  assert.equal(p(r("1.0.0")), false);
  assert.equal(p(r("0.9.0")), false);
  assert.equal(p(r("1.1.0"), "1.1.0"), false);
  assert.equal(p(r("1.2.0"), "1.1.0"), true);
  assert.equal(p(r("1.1.0", { prerelease: true })), false);
  assert.equal(p(null), false);
});

test("notes summary strips Markdown and is bounded", () => {
  const md = "## What's new\r\n- **Fast** [docs](https://x.y)\n* Second\n\nFull Changelog: a...b";
  assert.equal(summarizeNotes(md), "What's new\n• Fast docs\n• Second");
  const long = Array.from({ length: 20 }, (_, i) => `- item ${i}`).join("\n");
  assert.equal(summarizeNotes(long).split("\n").length, 9);
  assert.ok(summarizeNotes("x".repeat(2000)).length <= 601);
  assert.equal(summarizeNotes(null), "");
});

test("header fitting sheds the minimum number of steps and takes them back", () => {
  let width = 100;
  const state = [false, false, false, false];
  const cost = [10, 20, 30, 40]; // width saved by each step
  const ops = state.map((_, i) => ({ set: (on) => (state[i] = on) }));
  const overflows = () => width - state.reduce((a, on, i) => a + (on ? cost[i] : 0), 0) > 60;
  let n = fitSteps(ops, overflows, 0);
  assert.equal(n, 3); // 100-10-20-30 = 40 fits; 100-10-20 = 70 overflows
  width = 150;
  n = fitSteps(ops, overflows, n);
  assert.equal(n, 4);
  width = 50;
  n = fitSteps(ops, overflows, n);
  assert.equal(n, 0);
  assert.deepEqual(state, [false, false, false, false]);
  n = fitSteps(ops, () => true, 0);
  assert.equal(n, 4); // never fits: everything is shed, no loop
});
