// Docking layout model (ui/docking/model.js), presets and workspace files: tree operations, normalization and the
// promise that every built-in workspace only uses registered panels.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/ui/docking/model.js";
import { PRESETS, baseLayout, essentialsSpec } from "../../app/src/ui/docking/presets.js";
import { parseWorkspace } from "../../app/src/ui/docking/view.js";
import { PANELS } from "../../app/src/ui/panels/index.js";
import { STUDIOS, dockDef, dockKeys, dockKeyOf } from "../../app/src/studios/index.js";
import { builtinWorkspaces, snapshotLayout } from "../../app/src/customize/toolbox-model.js";
import { validateSetting } from "../../app/src/customize/schema.js";

const two = () => M.fromSpec({ right: [["color", "brush"], ["layers", "history"]] });
const groups = (L) => {
  const out = [];
  M.eachGroup(L, (g, info) => out.push({ panels: g.panels, active: g.active, region: info.region, float: info.floatIndex }));
  return out;
};
const ids = (L) => {
  const s = [];
  M.eachGroup(L, (g) => s.push(g.id));
  return s;
};

test("fromSpec builds the classic two-group right dock", () => {
  const L = two();
  assert.equal(L.regions.right.root.type, "split");
  assert.equal(L.regions.right.root.dir, "column");
  assert.deepEqual(L.regions.right.root.sizes, [0.5, 0.5]);
  assert.deepEqual(groups(L).map((g) => g.panels), [["color", "brush"], ["layers", "history"]]);
  assert.equal(L.regions.left.root, null);
  assert.equal(new Set(ids(L)).size, 2);
});

test("tabs: activate, reorder, merge into another group", () => {
  let L = M.setActive(two(), "brush");
  assert.equal(groups(L)[0].active, "brush");
  L = M.reorderTab(L, "color", 2);
  assert.deepEqual(groups(L)[0].panels, ["brush", "color"]);
  const target = M.findPanel(L, "layers").group.id;
  L = M.movePanel(L, "brush", { group: target, zone: "center", index: 1 });
  assert.deepEqual(groups(L).map((g) => g.panels), [["color"], ["layers", "brush", "history"]]);
  assert.equal(M.findPanel(L, "brush").group.active, "brush");
});

test("dropping a panel on an edge of a group splits it", () => {
  const L0 = two();
  const gid = M.findPanel(L0, "layers").group.id;
  const L = M.movePanel(L0, "color", { group: gid, zone: "right" });
  const root = L.regions.right.root;
  assert.equal(root.dir, "column");
  assert.equal(root.children[1].type, "split");
  assert.equal(root.children[1].dir, "row");
  assert.deepEqual(root.children[1].children.map((c) => c.panels), [["layers", "history"], ["color"]]);
  // the same direction as the parent does not nest: it becomes a sibling
  const L2 = M.movePanel(L0, "color", { group: gid, zone: "bottom" });
  assert.equal(L2.regions.right.root.children.length, 3);
  assert.ok(Math.abs(L2.regions.right.root.sizes.reduce((a, b) => a + b, 0) - 1) < 1e-3);
});

test("dragging the last tab of a group onto itself changes nothing", () => {
  let L = M.movePanel(two(), "brush", { region: "left" });
  const gid = M.findPanel(L, "brush").group.id;
  assert.equal(M.movePanel(L, "brush", { group: gid, zone: "left" }), L);
});

test("window edges dock into regions; empty groups and one-child splits disappear", () => {
  let L = M.movePanel(two(), "color", { region: "left", edge: "outer" });
  assert.deepEqual(L.regions.left.root.panels, ["color"]);
  L = M.movePanel(L, "brush", { region: "bottom" });
  assert.deepEqual(L.regions.bottom.root.panels, ["brush"]);
  // the first group of the right region is gone, the split collapsed to the remaining group
  assert.equal(L.regions.right.root.type, "group");
  assert.deepEqual(L.regions.right.root.panels, ["layers", "history"]);
  // a second column at the right window edge widens the region
  const before = L.regions.right.size;
  L = M.movePanel(L, "color", { region: "right", edge: "outer" });
  assert.equal(L.regions.right.root.dir, "row");
  assert.deepEqual(L.regions.right.root.children.map((c) => c.panels), [["layers", "history"], ["color"]]);
  assert.ok(L.regions.right.size > before);
  assert.equal(L.regions.left.root, null);
});

test("floating, moving whole groups and raising", () => {
  let L = M.movePanel(two(), "history", { float: { x: 50, y: 60, w: 300, h: 200 } });
  assert.equal(L.floating.length, 1);
  assert.deepEqual(L.floating[0].group.panels, ["history"]);
  assert.deepEqual({ x: L.floating[0].x, y: L.floating[0].y, w: L.floating[0].w, h: L.floating[0].h }, { x: 50, y: 60, w: 300, h: 200 });
  const fid = L.floating[0].group.id;
  L = M.setFloatRect(L, fid, { x: 5000, y: -20 }, { w: 1200, h: 800 });
  assert.deepEqual([L.floating[0].x, L.floating[0].y], [900, 0]);
  // a floating group docks back as a whole
  const top = M.findPanel(L, "color").group.id;
  L = M.moveGroup(L, fid, { group: top, zone: "center" });
  assert.equal(L.floating.length, 0);
  assert.deepEqual(M.findPanel(L, "color").group.panels, ["color", "brush", "history"]);
  // move a docked group (with its front tab) to the bottom
  const g = M.findPanel(L, "layers").group.id;
  L = M.moveGroup(M.setActive(L, "layers"), g, { region: "bottom" });
  assert.deepEqual(L.regions.bottom.root.panels, ["layers"]);
  assert.equal(L.regions.bottom.root.id, g);
  // raise
  let F = M.addPanels(M.addPanels(M.emptyLayout(), ["a"], { float: { x: 0, y: 0, w: 200, h: 200 } }), ["b"], { float: { x: 0, y: 0, w: 200, h: 200 } });
  F = M.raiseFloat(F, F.floating[0].group.id);
  assert.deepEqual(F.floating.map((f) => f.group.panels[0]), ["b", "a"]);
});

test("sizes, region sizes, collapse and maximize", () => {
  let L = M.setSizes(two(), "right", [], [3, 1]);
  assert.deepEqual(L.regions.right.root.sizes, [0.75, 0.25]);
  assert.equal(M.setSizes(L, "right", [], [1]), L); // wrong length: unchanged
  assert.deepEqual(M.setSizes(L, "right", [], [1, 0]).regions.right.root.sizes.map((s) => s >= M.LIMITS.minFraction), [true, true]);
  L = M.setRegionSize(L, "right", 99999);
  assert.equal(L.regions.right.size, M.LIMITS.side.max);
  L = M.setRegionSize(L, "bottom", 1);
  assert.equal(L.regions.bottom.size, M.LIMITS.bottom.min);
  L = M.setCollapsed(L, "right", true);
  assert.equal(L.regions.right.collapsed, true);
  assert.equal(M.setCollapsed(L, "left", true).regions.left.collapsed, false); // nothing to collapse
  const gid = M.findPanel(L, "layers").group.id;
  L = M.setMaximized(L, gid);
  assert.equal(L.maximized, gid);
  assert.equal(M.setMaximized(L, "nope").maximized, null);
  L = M.removePanels(L, ["layers", "history"]);
  assert.equal(L.maximized, null);
  // docking into a collapsed region expands it
  L = M.movePanel(L, "brush", { region: "right", edge: "stack" });
  assert.equal(L.regions.right.collapsed, false);
});

test("normalize repairs broken JSON", () => {
  assert.equal(M.normalize(null), null);
  assert.equal(M.normalize("x"), null);
  assert.equal(M.normalize({ regions: {} }), null);
  const raw = {
    regions: {
      right: {
        size: -5,
        collapsed: "yes",
        root: {
          type: "split",
          dir: "column",
          sizes: [NaN, 2, 1],
          children: [
            { type: "group", id: "a", panels: ["color", "color", "ghost", 7], active: "ghost" },
            { type: "split", dir: "column", sizes: [1, 1], children: [{ type: "group", id: "a", panels: ["layers"] }, { type: "group", panels: [] }, { type: "nope" }] },
            { type: "split", dir: "row", children: [{ type: "group", id: "bad id!", panels: ["history"] }] },
          ],
        },
      },
      left: { root: { type: "group", panels: ["brush", "layers"] } },
      top: { root: { type: "group", panels: ["info"] } },
    },
    floating: [{ x: -100, y: 99999, w: 5, h: 1e9, group: { type: "group", panels: ["navigator"] } }, { group: { type: "split" } }, null],
    maximized: "zzz",
  };
  const L = M.normalize(raw, { known: ["color", "layers", "history", "brush", "navigator"], viewport: { w: 1000, h: 700 } });
  assert.deepEqual(groups(L).map((g) => g.panels), [["brush", "layers"], ["color"], ["history"], ["navigator"]]); // the first place a panel appears wins
  assert.equal(L.regions.right.size, M.LIMITS.side.min);
  assert.equal(L.regions.right.collapsed, false);
  assert.equal(L.regions.right.root.children.length, 2); // the emptied nested column is gone, the one-child row unwrapped
  assert.ok(Math.abs(L.regions.right.root.sizes.reduce((a, b) => a + b, 0) - 1) < 1e-3);
  const f = L.floating[0];
  assert.deepEqual([f.x, f.y, f.w, f.h], [0, 0, M.LIMITS.float.minW, 700]);
  assert.equal(L.maximized, null);
  assert.equal(new Set(ids(L)).size, ids(L).length); // unique ids
  assert.ok(ids(L).every((id) => /^[\w-]{1,24}$/.test(id)));
  assert.equal(M.findPanel(L, "color").group.id, "a"); // a valid id is kept
  // round trip
  assert.deepEqual(M.normalize(JSON.parse(JSON.stringify(M.serialize(L)))), L);
  // deep nesting is cut off
  let deep = { type: "group", panels: ["color"] };
  for (let i = 0; i < 20; i++) deep = { type: "split", dir: i % 2 ? "row" : "column", children: [deep, { type: "group", panels: [`p${i}`] }] };
  const D = M.normalize({ regions: { right: { root: deep } } });
  assert.ok(D && !M.panelIds(D).includes("color"));
});

test("reconcile drops hidden panels and brings missing ones back next to their mates", () => {
  const base = two();
  let L = M.reconcile(M.movePanel(base, "brush", { region: "left" }), ["color", "brush", "layers"], base);
  assert.deepEqual(M.panelIds(L).sort(), ["brush", "color", "layers"]);
  // history reappears as a tab with layers (its group in the base), without stealing the front tab
  L = M.reconcile(L, ["color", "brush", "layers", "history"], base);
  const g = M.findPanel(L, "history").group;
  assert.deepEqual(g.panels, ["layers", "history"]);
  assert.equal(g.active, "layers");
  // a panel whose mates are all gone goes back to its region as one more group
  const lone = M.reconcile(M.removePanels(base, ["color", "brush"]), ["layers", "history", "color"], base);
  assert.deepEqual(groups(lone).map((x) => x.panels), [["layers", "history"], ["color"]]);
  // unknown to the base: right region
  const extra = M.reconcile(base, ["color", "brush", "layers", "history", "x:panel"], base);
  assert.equal(M.findPanel(extra, "x:panel").region, "right");
});

test("mirror and sameLayout", () => {
  const L = M.movePanel(two(), "color", { region: "left" });
  const R = M.mirror(L);
  assert.deepEqual(R.regions.right.root.panels, ["color"]);
  assert.deepEqual(M.mirror(R), L);
  assert.ok(M.sameLayout(two(), M.setActive(two(), "brush")));
  assert.ok(!M.sameLayout(two(), L));
});

test("operations never mutate their input", () => {
  const L = two();
  const snap = JSON.stringify(L);
  const gid = M.findPanel(L, "layers").group.id;
  M.movePanel(L, "color", { group: gid, zone: "left" });
  M.moveGroup(L, gid, { float: { x: 1, y: 1, w: 300, h: 300 } });
  M.setSizes(L, "right", [], [1, 2]);
  M.removePanel(L, "color");
  M.setCollapsed(L, "right", true);
  assert.equal(JSON.stringify(L), snap);
});

test("every built-in workspace uses registered panels and a known arrangement", () => {
  for (const [studio, presets] of Object.entries(PRESETS)) {
    assert.ok(dockDef(studio), studio);
    for (const [id, spec] of Object.entries(presets)) {
      for (const r of M.REGIONS) for (const g of spec[r] || []) for (const p of g) assert.ok(PANELS[p], `${studio}/${id}: ${p} is not a registered panel`);
    }
  }
  const keys = dockKeys();
  for (const k of ["code", "scene", "vibe", "office:document", "office:slides", "office:board"]) assert.ok(keys.includes(k), `${k} has a dock definition`);
  for (const studio of keys) {
    const s = dockDef(studio);
    const essentials = s.essentials ? M.REGIONS.flatMap((r) => (s.essentials[r] || []).flat()) : [...(s.top || []), ...(s.bottom || [])];
    for (const p of [...(s.top || []), ...(s.bottom || []), ...essentials]) assert.ok(PANELS[p], `${studio}: ${p}`);
    // the Essentials arrangement places exactly the studio's panels
    assert.deepEqual([...essentials].sort(), [...(s.top || []), ...(s.bottom || [])].sort(), `${studio}: essentials lists the studio's panels`);
    for (const p of s.closed || []) assert.ok(essentials.includes(p), `${studio}: closed panel ${p} is not in the arrangement`);
    const panels = { top: s.top || [], bottom: s.bottom || [], closed: s.closed || [] };
    for (const w of builtinWorkspaces(studio, panels)) {
      if (w.state.preset) assert.ok(PRESETS[studio]?.[w.state.preset], `${studio}/${w.name}: unknown preset ${w.state.preset}`);
      // the arrangement shows exactly the panels the workspace keeps visible
      const visible = [...panels.top, ...panels.bottom].filter((p) => !w.state.hidden.includes(p));
      const L = M.reconcile(baseLayout(studio, s, w.state), visible, baseLayout(studio, s, w.state));
      assert.deepEqual(M.panelIds(L).sort(), [...visible].sort(), `${studio}/${w.name}`);
      if (w.state.preset) assert.deepEqual(M.panelIds(baseLayout(studio, s, w.state)).sort(), [...visible].sort(), `${studio}/${w.name} preset lists other panels`);
      assert.ok(validateSetting("workspaces", { [studio]: { [w.name]: w.state } }).ok, `${studio}/${w.name} does not validate`);
    }
  }
});

test("the Code, Scene, Office and Vibe studios open with today's arrangement", () => {
  const code = baseLayout("code", dockDef("code"), {});
  assert.deepEqual(groups(code).map((g) => [g.region, g.panels.length]), [["left", 7], ["right", 3], ["bottom", 3]]);
  assert.deepEqual(dockDef("code").closed, ["code-problems", "code-console", "code-terminal"]);
  const scene = baseLayout("scene", dockDef("scene"), {});
  assert.deepEqual(groups(scene).map((g) => [g.region, g.panels]), [["left", ["scene-media", "scene-effects"]], ["right", ["scene-inspector"]]]);
  assert.equal(scene.regions.left.size, 232);
  const board = baseLayout("office:board", dockDef("office:board"), {});
  assert.deepEqual(groups(board).map((g) => g.panels), [["board-comments", "board-outline", "board-properties", "board-library"]]);
  assert.deepEqual(groups(baseLayout("vibe", dockDef("vibe"), {})).map((g) => [g.region, g.panels]), [["left", ["vibe-chats"]], ["right", ["vibe-canvas", "vibe-activity"]]]);
  assert.equal(dockDef("office:sheet"), null);
});

test("an app of the Office suite has its own layout key", () => {
  const app = { studio: "office", officeUI: { kind: "board" } };
  assert.equal(dockKeyOf(app), "office:board");
  assert.equal(dockKeyOf({ studio: "office", officeUI: { kind: "sheet" } }), "office");
  assert.equal(dockKeyOf({ studio: "office", officeUI: null }), "office");
  assert.equal(dockKeyOf({ studio: "pixel" }), "pixel");
});

test("Essentials looks like the 1.1 dock: the studio's top and bottom panels, right side, default width", () => {
  for (const id of ["vector", "pixel", "layout"]) {
    const s = STUDIOS[id];
    const L = baseLayout(id, s, {});
    assert.deepEqual(groups(L).map((g) => g.panels), [s.top, s.bottom]);
    assert.equal(L.regions.right.size, 304);
    assert.deepEqual(L.regions.right.root.sizes, [0.5, 0.5]);
  }
  assert.deepEqual(essentialsSpec(STUDIOS.code).right[0], STUDIOS.code.top);
  const left = baseLayout("pixel", STUDIOS.pixel, { side: "left", width: 400 });
  assert.equal(left.regions.right.root, null);
  assert.equal(left.regions.left.size, 400);
});

test("layout preferences keep the dock arrangement; the schema accepts it", () => {
  const dock = M.serialize(two());
  const s = snapshotLayout({ hidden: ["x"], side: "right", width: null, preset: "painting", dock, junk: 1 });
  assert.deepEqual(Object.keys(s).sort(), ["dock", "hidden", "preset", "side", "width"]);
  assert.ok(validateSetting("layout", { pixel: { ...s, ws: "Mine" } }).ok);
  assert.ok(!validateSetting("layout", { pixel: { ...s, preset: "Bad Preset!" } }).ok);
  assert.ok(!validateSetting("layout", { pixel: { ...s, dock: "x" } }).ok);
});

test("workspace files: parse, repair, refuse", () => {
  const panels = ["color", "brush", "layers", "history"];
  const file = { format: "openfini-workspace", version: 1, studio: "pixel", name: "Night <shift>", state: { hidden: ["brush", "nope"], side: "left", width: 9999, preset: "painting", dock: { regions: { left: { root: { type: "group", panels: ["color", "evil"] } } } } } };
  const r = parseWorkspace(JSON.stringify(file), "pixel", panels);
  assert.equal(r.name, "Night shift");
  assert.deepEqual(r.state.hidden, ["brush"]);
  assert.equal(r.state.width, null);
  assert.equal(r.state.side, "left");
  assert.deepEqual(M.panelIds(r.state.dock), ["color"]);
  assert.ok(parseWorkspace("{", "pixel", panels).error);
  assert.ok(parseWorkspace(JSON.stringify({ ...file, format: "x" }), "pixel", panels).error);
  assert.match(parseWorkspace(JSON.stringify(file), "vector", panels).error, /Pixel/);
});
