import test from "node:test";
import assert from "node:assert/strict";
import { MINIMAL_MENUS, isMinimalMenubar, menuVisible } from "../../app/src/ui/menubar-select.js";

const E = (label, studios) => ({ label, studios });

test("start page: only File, View, Studio, Help", () => {
  const s = { doc: null, studio: "vector" };
  assert.ok(isMinimalMenubar(s));
  const menus = [E("File"), E("Edit", ["vector"]), E("Layer", ["vector"]), E("View", ["vector"]), E("View", ["code"]), E("Studio"), E("Help")];
  assert.deepEqual(menus.filter((m) => menuVisible(m, s)).map((m) => m.label), ["File", "View", "Studio", "Help"]);
  assert.deepEqual([...MINIMAL_MENUS], ["File", "View", "Studio", "Help"]);
});

test("a document restores the full menus; Vibe keeps its own", () => {
  assert.ok(menuVisible(E("Edit", ["vector"]), { doc: {}, studio: "vector" }));
  assert.ok(!menuVisible(E("Edit", ["vector"]), { doc: {}, studio: "code" }));
  assert.ok(!isMinimalMenubar({ doc: null, studio: "vibe" }));
  assert.ok(menuVisible(E("Edit", ["vibe"]), { doc: null, studio: "vibe" }));
});
