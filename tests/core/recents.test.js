import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampRecentLimit, dropRecent, pushRecent, visibleRecents } from "../../app/src/core/recents.js";

const e = (name, path) => ({ id: path || `${name}:1`, name, path, time: 1 });
describe("recents", () => {
  it("clamps the limit to 0..50", () => {
    assert.equal(clampRecentLimit(-3), 0);
    assert.equal(clampRecentLimit(99), 50);
    assert.equal(clampRecentLimit("7"), 7);
    assert.equal(clampRecentLimit("x"), 12);
  });
  it("puts the newest first and de-duplicates by path or name", () => {
    let l = pushRecent([], e("a"), 5);
    l = pushRecent(l, e("b"), 5);
    l = pushRecent(l, { ...e("a"), id: "a:2" }, 5);
    assert.deepEqual(l.map((r) => r.name), ["a", "b"]);
    l = pushRecent(l, e("c", "C:/c.ofini"), 5);
    l = pushRecent(l, { ...e("c2", "C:/c.ofini") }, 5);
    assert.equal(l.filter((r) => r.path === "C:/c.ofini").length, 1);
  });
  it("caps and honors 0", () => {
    let l = [];
    for (const n of "abcde") l = pushRecent(l, e(n), 3);
    assert.deepEqual(l.map((r) => r.name), ["e", "d", "c"]);
    assert.deepEqual(pushRecent(l, e("z"), 0), []);
  });
  it("does not mutate and drops by id", () => {
    const l = Object.freeze([e("a"), e("b")]);
    assert.equal(dropRecent(l, "a:1").length, 1);
    assert.equal(l.length, 2);
  });
  it("hides the list when the pref is off", () => {
    assert.deepEqual(visibleRecents([e("a")], false), []);
    assert.equal(visibleRecents([1, 2, 3, 4, 5, 6, 7, 8].map((n) => e(`n${n}`)), true, 6).length, 6);
  });
});
