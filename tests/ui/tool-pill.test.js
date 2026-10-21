import test from "node:test";
import assert from "node:assert/strict";
import { buildPillModel, pillSignature, PIXEL_SELECTION_ACTIONS } from "../../app/src/ui/tool-pill-model.js";

const base = { enabled: true, hasDoc: true, studio: "pixel" };

test("hidden when disabled, without a document or with nothing to act on", () => {
  assert.equal(buildPillModel({ ...base, enabled: false, selectionCount: 3 }), null);
  assert.equal(buildPillModel({ ...base, hasDoc: false, selectionCount: 3 }), null);
  assert.equal(buildPillModel(base), null);
  assert.equal(buildPillModel(), null);
  assert.equal(buildPillModel({ ...base, studio: "code", selectionCount: 2 }), null);
});

test("a pixel selection says its size and offers Deselect, Invert, Feather, layer mask and Fill via existing commands", () => {
  const m = buildPillModel({ ...base, mask: { width: 2000, height: 1500, bounds: { x: 10, y: 10, width: 1240, height: 860 } } });
  assert.equal(m.kind, "pixel-selection");
  assert.equal(m.text, "Selection active · 1,240 × 860 px");
  assert.equal(m.key, "Selection active · {w} × {h} px");
  assert.deepEqual(m.actions.map((a) => a.command), ["select.none", "select.invert", "select.feather", "select.toMask", "pixel.fillForeground"]);
  assert.equal(m.actions[0].key, "Mod+D");
  assert.equal(PIXEL_SELECTION_ACTIONS.filter((a) => a.primary).length, 1);
});

test("an empty selection mask shows nothing; a mask outside the pixel studio is ignored", () => {
  assert.equal(buildPillModel({ ...base, mask: { width: 10, height: 10, bounds: { x: 0, y: 0, width: 0, height: 0 } } }), null);
  assert.equal(buildPillModel({ ...base, studio: "vector", mask: { width: 10, height: 10, bounds: { x: 0, y: 0, width: 5, height: 5 } } }), null);
});

test("a tool in a modal state wins over selections", () => {
  const pill = { key: "Crop · {w} × {h} px", params: { w: 800, h: 600 }, actions: [{ id: "apply", label: "Apply", primary: true }, { id: "cancel", label: "Cancel" }] };
  const m = buildPillModel({ ...base, tool: { id: "crop", label: "Crop", pill }, selectionCount: 2, mask: { width: 9, height: 9, bounds: { x: 0, y: 0, width: 9, height: 9 } } });
  assert.equal(m.kind, "tool");
  assert.equal(m.text, "Crop · 800 × 600 px");
  assert.deepEqual(m.actions.map((a) => a.id), ["apply", "cancel"]);
  // a tool without a pill state falls through
  assert.equal(buildPillModel({ ...base, tool: { id: "move", label: "Move", pill: null } }), null);
  assert.equal(buildPillModel({ ...base, tool: { id: "pen", label: "Pen", pill: { text: "x", actions: [] } } }), null);
});

test("layer selections in Vector and Layout", () => {
  assert.equal(buildPillModel({ ...base, studio: "vector", selectionCount: 1, activeName: "Logo" }).text, "Logo selected");
  assert.equal(buildPillModel({ ...base, studio: "layout", selectionCount: 4 }).text, "4 objects selected");
  assert.equal(buildPillModel({ ...base, studio: "vector", selectionCount: 1 }).text, "1 object selected");
  assert.equal(buildPillModel({ ...base, studio: "vector", selectionCount: 2 }).actions[0].command, "edit.deselect");
});

test("signature changes with kind, text and actions only", () => {
  const a = buildPillModel({ ...base, studio: "vector", selectionCount: 2 });
  const b = buildPillModel({ ...base, studio: "vector", selectionCount: 2 });
  const c = buildPillModel({ ...base, studio: "vector", selectionCount: 3 });
  assert.equal(pillSignature(a), pillSignature(b));
  assert.notEqual(pillSignature(a), pillSignature(c));
  assert.equal(pillSignature(null), "");
});
