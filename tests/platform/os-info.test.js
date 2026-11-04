import test from "node:test";
import assert from "node:assert/strict";
import { materialChoices, MATERIALS, loadMaterials, materialsNow, osInfo } from "../../app/src/platform/os-info.js";

test("material choices follow what the desktop shell reports", () => {
  assert.deepEqual(materialChoices(null), [], "browser / PWA: no picker");
  assert.deepEqual(materialChoices([]), []);
  assert.deepEqual(materialChoices(["acrylic", "mica", "bogus"]).map((m) => m.id), ["none", "mica", "acrylic"], "known ids in display order, none first");
  assert.deepEqual(materialChoices(["transparent"]).map((m) => m.id), ["none", "transparent"]);
  assert.equal(new Set(MATERIALS.map((m) => m.id)).size, MATERIALS.length);
});

test("outside the desktop app there are no materials", async () => {
  assert.equal(await loadMaterials(), null);
  assert.equal(materialsNow(), null);
  assert.equal(osInfo().desktop, false);
  assert.ok(["windows", "macos", "linux"].includes(osInfo().os));
});
