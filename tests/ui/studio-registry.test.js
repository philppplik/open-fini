import test from "node:test";
import assert from "node:assert/strict";
import {
  createStudioRegistry,
  resolveVisibleStudios,
  overflowStudios,
  toggleVisibleStudio,
  moveVisibleStudio,
  reorderVisibleStudio,
  studioForDigit,
  studioIconSpec,
  MAX_VISIBLE_STUDIOS,
  DEFAULT_VISIBLE_STUDIOS,
} from "../../app/src/studios/registry.js";
import { chromeMode, createWindowControls } from "../../app/src/platform/window-controls.js";

const ids = ["vector", "pixel", "layout", "code", "vibe", "office", "video"];

test("registerStudio fills defaults, sorts by order and rejects bad or duplicate ids", () => {
  const r = createStudioRegistry();
  r.registerStudio({ id: "b", label: "B", order: 20 });
  r.registerStudio({ id: "a", label: "A", order: 10, icon: "alpha", blurb: "first" });
  r.registerStudio({ id: "c", label: "C" }); // no order: after everything registered
  assert.deepEqual(r.studioIds(), ["a", "b", "c"]);
  assert.deepEqual(r.getStudio("b").tools, []);
  assert.equal(r.getStudio("b").icon, "b");
  assert.throws(() => r.registerStudio({ id: "a", label: "again" }), /already registered/);
  assert.throws(() => r.registerStudio({ id: "Bad Id", label: "x" }), /Invalid studio id/);
  assert.throws(() => r.registerStudio({ id: "nolabel" }), /needs a label/);
  assert.equal(r.hasStudio("a"), true);
  assert.equal(r.hasStudio("zzz"), false);
});

test("onStudioRegistered fires for later registrations (one entry is enough for a new studio)", () => {
  const r = createStudioRegistry();
  const seen = [];
  const off = r.onStudioRegistered((s) => seen.push(s.id));
  r.registerStudio({ id: "office", label: "Office", order: 60 });
  off();
  r.registerStudio({ id: "video", label: "Video", order: 70 });
  assert.deepEqual(seen, ["office"]);
});

test("studioIconSpec uses the glyph library unless a system icon is given", () => {
  assert.equal(studioIconSpec({ icon: "code" }), "of:code");
  assert.equal(studioIconSpec({ icon: "x", systemIcon: "file-earmark" }), "file-earmark");
});

test("resolveVisibleStudios: defaults, unknown ids, duplicates, the hard maximum and never empty", () => {
  assert.deepEqual(resolveVisibleStudios(undefined, ids), DEFAULT_VISIBLE_STUDIOS);
  assert.deepEqual(resolveVisibleStudios(["vibe", "nope", "vibe", "pixel"], ids), ["vibe", "pixel"]);
  assert.equal(resolveVisibleStudios(ids, ids).length, MAX_VISIBLE_STUDIOS);
  assert.deepEqual(resolveVisibleStudios([], ids), DEFAULT_VISIBLE_STUDIOS);
  assert.deepEqual(resolveVisibleStudios(["gone"], ["only"]), ["only"]);
  // a studio registered later does not enter the header by itself
  assert.ok(!resolveVisibleStudios(undefined, ids).includes("office"));
});

test("overflowStudios lists everything that is not in the header", () => {
  assert.deepEqual(overflowStudios(["vector", "pixel"], ids), ["layout", "code", "vibe", "office", "video"]);
  assert.deepEqual(overflowStudios(ids, ids), []);
});

test("toggleVisibleStudio enforces the maximum of five and at least one", () => {
  let v = ["vector", "pixel", "layout", "code", "vibe"];
  const full = toggleVisibleStudio(v, "office");
  assert.deepEqual(full.visible, v);
  assert.match(full.error, /at most 5/);
  const removed = toggleVisibleStudio(v, "pixel");
  assert.equal(removed.error, null);
  v = removed.visible;
  assert.deepEqual(v, ["vector", "layout", "code", "vibe"]);
  assert.deepEqual(toggleVisibleStudio(v, "office").visible, ["vector", "layout", "code", "vibe", "office"]);
  const last = toggleVisibleStudio(["vector"], "vector");
  assert.deepEqual(last.visible, ["vector"]);
  assert.match(last.error, /At least one/);
});

test("moveVisibleStudio and reorderVisibleStudio keep ids unique and ignore invalid moves", () => {
  const v = ["a", "b", "c"];
  assert.deepEqual(moveVisibleStudio(v, "a", 1), ["b", "a", "c"]);
  assert.deepEqual(moveVisibleStudio(v, "a", -1), v);
  assert.deepEqual(moveVisibleStudio(v, "c", 1), v);
  assert.deepEqual(moveVisibleStudio(v, "x", 1), v);
  assert.deepEqual(reorderVisibleStudio(v, "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(reorderVisibleStudio(v, "a", "c"), ["b", "c", "a"]);
  assert.deepEqual(reorderVisibleStudio(v, "a", "a"), v);
});

test("Alt+digit follows the visible order", () => {
  const v = ["code", "vector", "office"];
  assert.equal(studioForDigit(v, 1), "code");
  assert.equal(studioForDigit(v, 3), "office");
  assert.equal(studioForDigit(v, 4), null);
  assert.equal(studioForDigit(v, 0), null);
});

test("chromeMode: browser keeps its chrome, macOS overlays, Windows and Linux draw the bar", () => {
  assert.equal(chromeMode({ isDesktop: false, os: "web" }), "native");
  assert.equal(chromeMode({ isDesktop: true, os: "macos" }), "overlay");
  assert.equal(chromeMode({ isDesktop: true, os: "windows" }), "custom");
  assert.equal(chromeMode({ isDesktop: true, os: "linux" }), "custom");
});

test("windowControls are harmless no-ops in the browser", async () => {
  const wc = createWindowControls({ isDesktop: false, os: "web" });
  assert.equal(wc.mode, "native");
  assert.equal(wc.hasButtons, false);
  assert.equal(await wc.minimize(), undefined);
  assert.equal(await wc.toggleMaximize(), undefined);
  assert.equal(await wc.isMaximized(), false);
  assert.equal(await wc.verify(), "native");
  await (await wc.installCloseGuard(async () => true))();
});

test("windowControls: toggles maximize, steps back when decorations are still on, guards close", async () => {
  const calls = [];
  let maximized = false;
  let closeHandler;
  const win = {
    isMaximized: async () => maximized,
    maximize: async () => (calls.push("maximize"), (maximized = true)),
    unmaximize: async () => (calls.push("unmaximize"), (maximized = false)),
    minimize: async () => calls.push("minimize"),
    close: async () => calls.push("close"),
    destroy: async () => calls.push("destroy"),
    isDecorated: async () => false,
    onCloseRequested: async (fn) => ((closeHandler = fn), () => {}),
  };
  const wc = createWindowControls({ isDesktop: true, os: "windows", tauri: { window: { getCurrentWindow: () => win } } });
  assert.equal(wc.hasButtons, true);
  assert.equal(await wc.verify(), "custom");
  await wc.toggleMaximize();
  await wc.toggleMaximize();
  assert.deepEqual(calls, ["maximize", "unmaximize"]);

  let allow = false;
  await wc.installCloseGuard(async () => allow);
  let prevented = 0;
  await closeHandler({ preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.ok(!calls.includes("destroy"), "a cancelled confirmation keeps the window open");
  allow = true;
  await closeHandler({ preventDefault: () => prevented++ });
  assert.ok(calls.includes("destroy"));

  const decorated = createWindowControls({ isDesktop: true, os: "linux", tauri: { window: { getCurrentWindow: () => ({ isDecorated: async () => true }) } } });
  assert.equal(await decorated.verify(), "native");
  assert.equal(decorated.hasButtons, false);
});
