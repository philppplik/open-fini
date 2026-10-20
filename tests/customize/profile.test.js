import test from "node:test";
import assert from "node:assert/strict";
import { customizationDefaults, validateSetting, SETTINGS, SETTING_KEYS, describeSettings } from "../../app/src/customize/schema.js";
import { buildProfile, validateProfile, diffProfile, patchFromDiff, templateProfile, PROFILE_TEMPLATES, sanitizeStoredProfiles, summarizeValue } from "../../app/src/customize/profile.js";
import { arrangeToolbox, editorRows, moveKey, moveKeyBefore, setToolVisible, setUngrouped, filterMenuItems, builtinWorkspaces, allWorkspaces, cleanWorkspaceName, visiblePanels } from "../../app/src/customize/toolbox-model.js";
import { createRegistry } from "../../app/src/customize/registry.js";
import { checkerConfig, overlayColors, cursorFor } from "../../app/src/customize/canvas-style.js";

const defaults = () => ({ ...customizationDefaults(), theme: "dark", themeId: "default", accent: "violet", density: "default", uiScale: 100, rulers: true, lowPower: "auto", historyMB: 96, reduceMotion: "auto", autosaveSeconds: 4, focusRings: false, showHints: true, clipContent: null });

test("schema validates values", () => {
  assert.ok(validateSetting("uiScale", 125).ok);
  assert.ok(!validateSetting("uiScale", 500).ok);
  assert.ok(!validateSetting("uiScale", "125").ok);
  assert.ok(validateSetting("canvasBg", "#101010").ok && validateSetting("canvasBg", "").ok);
  assert.ok(!validateSetting("canvasBg", "red").ok);
  assert.ok(validateSetting("uiFont", "mono").ok && !validateSetting("uiFont", "comic").ok);
  assert.ok(validateSetting("toolbox", { pixel: { hidden: ["brush"] } }).ok);
  assert.ok(!validateSetting("toolbox", { nope: {} }).ok);
  assert.ok(validateSetting("layout", { pixel: { hidden: ["layers"], side: "left", width: 320 } }).ok);
  assert.ok(!validateSetting("layout", { pixel: { side: "top" } }).ok);
  assert.ok(!validateSetting("aiEnabled", true).ok);
  assert.ok(/protected/.test(validateSetting("apiKey", "x").error));
  assert.ok(validateSetting("newDocDefaults", { vector: { width: 800, unit: "mm" } }).ok);
  assert.ok(!validateSetting("newDocDefaults", { vector: { unit: "furlong" } }).ok);
  assert.ok(validateSetting("quickActions", ["undo", "file.export"]).ok);
});

test("no security or secret setting is portable; defaults satisfy the schema", () => {
  assert.ok(!SETTING_KEYS.some((k) => /key|token|secret|passw|aiEnabled|appLock|offline|protected|confirmExternal/i.test(k) && k !== "shortcuts"));
  const d = customizationDefaults();
  for (const s of SETTINGS) if (s.key in d) assert.ok(s.check(d[s.key]), s.key);
  assert.equal(describeSettings({ uiScale: 120 }, defaults(), { section: "appearance" }).find((x) => x.key === "uiScale").value, 120);
});

test("profile build, validate, diff", () => {
  const prefs = { ...defaults(), uiScale: 130, apiKey: "sk-secret", aiEnabled: true, toursSeen: { a: 1 }, shortcuts: { "edit.undo": ["F9"] } };
  const p = buildProfile(prefs, { name: "Work", created: "2026-01-01T00:00:00Z" });
  assert.equal(p.settings.uiScale, 130);
  assert.ok(!("apiKey" in p.settings) && !("aiEnabled" in p.settings) && !("toursSeen" in p.settings));
  assert.ok(!/sk-secret/.test(JSON.stringify(p)));
  const v = validateProfile(JSON.stringify(p));
  assert.ok(v.ok, v.errors.join());
  const d = diffProfile(defaults(), defaults(), v.profile, "merge");
  assert.deepEqual(d.map((x) => x.key).sort(), ["shortcuts", "uiScale"]);
  assert.equal(patchFromDiff(d).uiScale, 130);
  const cur = { ...defaults(), density: "compact" };
  assert.ok(!diffProfile(cur, defaults(), { settings: { uiScale: 110 } }, "merge").some((x) => x.key === "density"));
  assert.ok(diffProfile(cur, defaults(), { settings: { uiScale: 110 } }, "replace").some((x) => x.key === "density" && x.to === "default"));
  assert.equal(summarizeValue("x", true), "on");
});

test("profile import is strict", () => {
  const ok = { format: "openfini-profile", version: 1, name: "n", settings: { uiScale: 120 } };
  assert.ok(validateProfile(ok).ok);
  const bad = (o) => validateProfile(typeof o === "string" ? o : JSON.stringify(o));
  assert.ok(!bad("{oops").ok);
  assert.ok(!bad([]).ok);
  assert.ok(!bad({ ...ok, format: "x" }).ok);
  assert.ok(!bad({ ...ok, version: 2 }).ok);
  assert.ok(!bad({ ...ok, version: 0 }).ok);
  assert.ok(!bad({ ...ok, settings: [] }).ok);
  assert.ok(!bad({ ...ok, settings: { uiScale: 999 } }).ok);
  assert.ok(!bad({ ...ok, settings: { apiKey: "sk-123" } }).ok);
  assert.ok(!bad({ ...ok, settings: { aiEnabled: true } }).ok);
  assert.ok(!bad('{"format":"openfini-profile","version":1,"settings":{"__proto__":{"x":1}}}').ok);
  const w = bad({ ...ok, settings: { uiScale: 120, futureThing: 1 }, extra: 1 });
  assert.ok(w.ok && w.warnings.length === 2 && !("futureThing" in w.profile.settings));
  assert.ok(!bad("x".repeat(600000)).ok);
  assert.equal(validateProfile({ ...ok, name: "<b>x</b>" }).profile.name, "bx/b");
});

test("templates and stored profiles", () => {
  assert.deepEqual(PROFILE_TEMPLATES.map((t) => t.name), ["Work", "Presentation (big UI)", "Low power"]);
  for (const t of PROFILE_TEMPLATES) assert.ok(validateProfile(templateProfile(t.id, defaults())).ok, t.id);
  assert.equal(templateProfile("presentation", defaults()).settings.uiScale, 140);
  const stored = sanitizeStoredProfiles({ profiles: { A: buildProfile(defaults(), { name: "A" }), B: { format: "nope" } } });
  assert.deepEqual(Object.keys(stored), ["A"]);
});

test("toolbox arrangement", () => {
  const entries = [{ id: "move", group: null }, { id: "pen", group: ["pen", "pencil"] }, { id: "rect", group: ["rect", "ellipse", "star"] }, { id: "text", group: null }];
  const ids = (l) => l.map((e) => e.id);
  assert.deepEqual(ids(arrangeToolbox(entries, {})), ["move", "pen", "rect", "text"]);
  assert.deepEqual(ids(arrangeToolbox(entries, { hidden: ["move", "pen"] })), ["pencil", "rect", "text"]);
  const g = arrangeToolbox(entries, { hidden: ["rect"] }).find((e) => e.key === "rect");
  assert.deepEqual(g.group, ["ellipse", "star"]);
  assert.deepEqual(ids(arrangeToolbox(entries, { hidden: ["pen", "pencil"] })), ["move", "rect", "text"]);
  assert.deepEqual(ids(arrangeToolbox(entries, { order: ["text", "move"] })), ["text", "move", "pen", "rect"]);
  assert.equal(arrangeToolbox(entries, { ungroup: ["rect"] }).length, 6);
  assert.deepEqual(ids(arrangeToolbox(entries, {}, (id) => id !== "text")), ["move", "pen", "rect"]);
  const rows = editorRows(entries, { hidden: ["pen"] });
  assert.deepEqual(rows[1].hidden, ["pen"]);
  assert.deepEqual(moveKey(["a", "b", "c"], [], "c", -1), ["a", "c", "b"]);
  assert.deepEqual(moveKey(["a", "b", "c"], [], "a", -5), ["a", "b", "c"]);
  assert.deepEqual(moveKeyBefore(["a", "b", "c"], [], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(setToolVisible({}, "x", false), { hidden: ["x"] });
  assert.deepEqual(setToolVisible({ hidden: ["x"] }, "x", true), {});
  assert.deepEqual(setUngrouped({}, "pen", true), { ungroup: ["pen"] });
});

test("menus and workspaces", () => {
  const items = ["a", "-", { label: "Sub", items: ["b", "c"] }, "-", { label: "Only", items: ["d"] }, { dynamic: "x" }];
  assert.deepEqual(filterMenuItems(items, ["b", "d"]), ["a", "-", { label: "Sub", items: ["c"] }, "-", { dynamic: "x" }]);
  assert.equal(filterMenuItems(items, []), items);
  const panels = { top: ["type", "appearance", "color"], bottom: ["layers", "history"] };
  const ws = builtinWorkspaces("vector", panels);
  assert.deepEqual(ws.map((w) => w.name), ["Essentials", "Typography", "Minimal"]);
  assert.deepEqual(ws[1].state.hidden, ["color", "history"]);
  assert.deepEqual(builtinWorkspaces("pixel", { top: ["color", "brush"], bottom: ["layers"] }).map((w) => w.name), ["Essentials", "Painting", "Retouching"]);
  const all = allWorkspaces("vector", panels, { Mine: { hidden: [], side: "left", width: null }, Minimal: { hidden: ["x"], side: "right", width: null } });
  assert.equal(all.length, 4);
  assert.equal(all.find((w) => w.name === "Minimal").builtin, false);
  assert.equal(cleanWorkspaceName("  <hi>\n"), "hi");
  assert.equal(cleanWorkspaceName("__proto__"), "");
  assert.deepEqual(visiblePanels(["a", "b"], ["a"]), ["b"]);
});

test("registry hooks", () => {
  let n = 0;
  const r = createRegistry(() => n++);
  const off = r.registerSetting("my-ext", { key: "myext.compact", type: "switch", label: "Compact", default: false });
  assert.deepEqual(r.settingSections(), ["my-ext"]);
  assert.throws(() => r.registerSetting("my-ext", { key: "myext.compact", type: "switch", label: "x", default: 1 }), /already/);
  assert.throws(() => r.registerSetting("Bad Section", { key: "myext.k", type: "switch", label: "x", default: 1 }), /section/);
  assert.throws(() => r.registerSetting("s", { key: "k", type: "switch", label: "x", default: 1 }), /key/);
  assert.throws(() => r.registerSetting("s", { key: "my.sel", type: "select", label: "x", default: 1 }), /options/);
  off();
  assert.deepEqual(r.settingSections(), []);
  const offT = r.registerToolboxEntry("vector", { id: "x.tool", label: "X", command: "ext:x" });
  assert.equal(r.toolboxEntries("vector").length, 1);
  assert.throws(() => r.registerToolboxEntry("vector", { id: "x.tool", label: "X", command: "c" }), /already/);
  offT();
  assert.equal(r.toolboxEntries("vector").length, 0);
  assert.ok(n >= 4);
});

test("canvas style", () => {
  assert.equal(checkerConfig({ checker: "solid" }), null);
  assert.deepEqual(checkerConfig({}), { a: "#ffffff", b: "#d4d4d8", size: 6 });
  assert.equal(checkerConfig({ checker: "dark", checkerSize: 12 }).size, 12);
  assert.equal(checkerConfig({ checkerSize: 99 }).size, 6);
  assert.equal(overlayColors({}).guide, "rgba(34,211,238,0.85)");
  assert.equal(overlayColors({ guideColor: "#ff0000" }).guide, "rgba(255,0,0,0.85)");
  assert.equal(overlayColors({ selectionColor: "#00ff00" }, "#123456").selection, "#00ff00");
  assert.equal(overlayColors({}, "#123456").selection, "#123456");
  assert.equal(cursorFor("default", "default"), "default");
  assert.equal(cursorFor("grab", "large"), "grab");
  assert.match(cursorFor("crosshair", "xlarge"), /^url\("data:image\/svg\+xml;utf8,%3Csvg.*crosshair$/);
});
