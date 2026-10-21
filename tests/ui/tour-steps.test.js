import test from "node:test";
import assert from "node:assert/strict";
import { TOURS, validateTours } from "../../app/src/ui/tour-steps.js";
import { WHATS_NEW, whatsNewFor } from "../../app/src/ui/whats-new.js";
import { TOOL_HELP, PANEL_HELP, STUDIO_HELP } from "../../app/src/ui/help-content.js";

test("tour definitions are well formed", () => {
  assert.deepEqual(validateTours(TOURS), []);
  for (const k of ["welcome", "vector", "pixel", "layout", "code", "vibe"]) assert.ok(TOURS[k], k);
});

test("tour selectors are plain CSS selectors", () => {
  for (const t of Object.values(TOURS)) for (const s of t.steps) assert.match(s.target, /^[.#\[a-z][\w\-.#\[\]="':>() ]*$/i, s.id);
});

test("validateTours catches mistakes", () => {
  const bad = { x: { title: "T", steps: [{ id: "a", target: "", placement: "nowhere", title: "", body: "" }, { id: "a", target: ".x", placement: "top", title: "t", body: "b", when: "later" }] } };
  assert.ok(validateTours(bad).length >= 5);
});

test("what's new entries have content; help text exists for the studios", () => {
  assert.ok(whatsNewFor(WHATS_NEW[0].version));
  for (const e of WHATS_NEW) for (const i of e.items) assert.ok(i.title && i.text && i.icon);
  for (const id of ["vector", "pixel", "layout", "code", "vibe"]) assert.ok(STUDIO_HELP[id]);
  assert.ok(Object.keys(TOOL_HELP).length >= 35 && Object.keys(PANEL_HELP).length >= 12);
  for (const v of [...Object.values(TOOL_HELP), ...Object.values(PANEL_HELP)]) assert.ok(v.length > 20 && v.length < 140);
});
