import test from "node:test";
import assert from "node:assert/strict";
import { shouldAllowNativeContextMenu, isTextEntry } from "../../app/src/ui/context-menu/native-policy.js";

const el = (tagName, props = {}, attrs = []) => ({ tagName, ...props, closest(sel) { return attrs.some((a) => sel.includes(a)) ? this : null; } });
const ev = (target, extra = {}) => ({ composedPath: () => [target], ...extra });

test("app chrome never gets the native menu", () => {
  for (const t of [el("DIV"), el("BUTTON"), el("CANVAS"), el("SL-MENU-ITEM"), el("SPAN"), el("INPUT", { type: "checkbox" }), el("INPUT", { type: "range" })]) {
    assert.equal(shouldAllowNativeContextMenu(t, ev(t)), false, t.tagName);
    assert.equal(shouldAllowNativeContextMenu(t, ev(t, { shiftKey: true })), false, `${t.tagName} + shift`);
  }
  assert.equal(shouldAllowNativeContextMenu(null, {}), false);
  assert.equal(shouldAllowNativeContextMenu(undefined), false);
});

test("editable text only gets the native menu with Shift", () => {
  for (const t of [el("INPUT", { type: "text" }), el("INPUT", {}), el("TEXTAREA"), el("DIV", { isContentEditable: true })]) {
    assert.equal(isTextEntry(t), true);
    assert.equal(shouldAllowNativeContextMenu(t, ev(t)), false);
    assert.equal(shouldAllowNativeContextMenu(t, ev(t, { shiftKey: true })), true);
  }
});

test("a text control inside a shadow root is found through the composed path", () => {
  const input = el("INPUT", { type: "search" });
  const host = el("SL-INPUT");
  assert.equal(shouldAllowNativeContextMenu(host, { shiftKey: true, composedPath: () => [input, host] }), true);
  assert.equal(shouldAllowNativeContextMenu(host, { composedPath: () => [input, host] }), false);
});

test("website previews (iframes) and opted-in elements keep the native menu", () => {
  const frame = el("IFRAME");
  assert.equal(shouldAllowNativeContextMenu(frame, ev(frame)), true);
  const optIn = el("P", {}, ["data-native-menu"]);
  assert.equal(shouldAllowNativeContextMenu(optIn, ev(optIn)), true);
});

test("a throwing composedPath does not break the policy", () => {
  const t = el("DIV");
  assert.equal(shouldAllowNativeContextMenu(t, { composedPath() { throw new Error("x"); } }), false);
});
