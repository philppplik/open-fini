import test from "node:test";
import assert from "node:assert/strict";
import { fuzzyScore, rankCommands, pushRecent, sectionOf } from "../../app/src/ui/command-search.js";

const E = [
  { id: "file.save", label: "Save", shortcut: "Mod+S" },
  { id: "file.saveAs", label: "Save As…", shortcut: "Mod+Shift+S" },
  { id: "file.saveAll", label: "Save All" },
  { id: "view.theme", label: "Toggle Light / Dark" },
  { id: "view.zoomIn", label: "Zoom In", shortcut: "Mod+=" },
  { id: "code.format", label: "Format Document", studios: ["code"] },
  { id: "pixel.invert", label: "Invert Selection", studios: ["pixel"] },
  { id: "code.zoomIn", label: "Preview Zoom In", studios: ["code"] },
  { id: "arrange.group", label: "Group", shortcut: "Mod+G" },
];

test("fuzzyScore: empty query, no match, prefix beats scattered", () => {
  assert.equal(fuzzyScore("", "anything"), 0);
  assert.equal(fuzzyScore("xyz", "Save As"), -1);
  assert.ok(fuzzyScore("sav", "Save As") > fuzzyScore("sas", "Save As"));
  assert.ok(fuzzyScore("sa", "Save") > fuzzyScore("sa", "Bonsai"), "word start wins");
  assert.ok(fuzzyScore("tgl lgt", "Toggle Light / Dark") > 0, "each word matches on its own");
  assert.equal(fuzzyScore("zz in", "Zoom In"), -1, "every word must match");
});

test("rankCommands: relevance, exact matches first, ids and sections searchable", () => {
  const r = rankCommands(E, "save", { studio: "vector" });
  assert.equal(r[0].id, "file.save");
  assert.deepEqual(r.slice(0, 3).map((x) => x.id).sort(), ["file.save", "file.saveAll", "file.saveAs"]);
  assert.equal(rankCommands(E, "dark", { studio: "vector" })[0].id, "view.theme");
  assert.equal(rankCommands(E, "view theme", { studio: "vector" })[0].id, "view.theme", "ids contribute");
  assert.ok(rankCommands(E, "mod+g", { studio: "vector" }).some((x) => x.id === "arrange.group"), "shortcut search");
});

test("rankCommands: studio-aware", () => {
  const code = rankCommands(E, "zoom in", { studio: "code" });
  assert.equal(code[0].id, "code.zoomIn", "the studio's own command wins");
  assert.ok(!rankCommands(E, "", { studio: "vector" }).some((x) => x.studios || x.id === "pixel.invert" || x.id === "code.format"), "other studios' commands are hidden");
  assert.ok(rankCommands(E, "format", { studio: "code" }).some((x) => x.id === "code.format"));
  assert.equal(rankCommands(E, "", { studio: "code" })[0].section, "Code", "empty query lists the studio's commands first");
});

test("rankCommands: recent commands lead on an empty query and get a boost", () => {
  const r = rankCommands(E, "", { studio: "vector", recent: ["view.theme", "arrange.group"] });
  assert.deepEqual(r.slice(0, 2).map((x) => x.id), ["view.theme", "arrange.group"]);
  assert.ok(r[0].recent);
  const boosted = rankCommands(E, "zoom", { studio: "vector", recent: ["view.zoomIn"] });
  assert.equal(boosted[0].id, "view.zoomIn");
});

test("pushRecent and sectionOf", () => {
  assert.deepEqual(pushRecent(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.equal(pushRecent(Array.from({ length: 8 }, (_, i) => String(i)), "x").length, 8);
  assert.equal(sectionOf("file.saveAs"), "File");
  assert.equal(sectionOf("custom.thing"), "Custom");
});
