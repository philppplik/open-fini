import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupSections, NAV_GROUPS } from "../../app/src/ui/settings-nav.js";
import { blankEntries, blankAction, OFFICE_BLANK } from "../../app/src/commands/new-blank.js";

test("launch screen minimum time is three seconds", () => {
  const src = readFileSync(new URL("../../app/src/launch.js", import.meta.url), "utf8");
  assert.match(src, /MIN_SHOWN_MS = 3000;/);
});

test("settings sections are grouped under headings; unknown sections go to Advanced", () => {
  const ids = ["general", "appearance", "studios", "toolbox", "ai", "security", "about", "my-ext"];
  const g = groupSections(ids.map((id) => ({ id })));
  assert.deepEqual(g.map((x) => x.title), ["App", "Studios and tools", "AI", "Collaboration and privacy", "Advanced"]);
  assert.deepEqual(g[0].sections.map((s) => s.id), ["general", "appearance"]);
  assert.deepEqual(g[4].sections.map((s) => s.id), ["about", "my-ext"]);
  assert.equal(NAV_GROUPS.length, 5);
});

test("empty groups are dropped while searching", () => {
  assert.deepEqual(groupSections([{ id: "ai" }]).map((x) => x.id), ["ai"]);
});

test("every studio with a blank path gets a File > New Blank entry", () => {
  const studios = [{ id: "vector", label: "Vector", document: true }, { id: "code", label: "Code" }, { id: "vibe", label: "Vibe" }, { id: "scene", label: "Scene" }, { id: "office", label: "Office" }, { id: "ext", label: "Ext" }];
  const e = blankEntries(studios);
  assert.deepEqual(e.filter((x) => !x.kind).map((x) => x.id), ["file.newBlank.vector", "file.newBlank.code", "file.newBlank.vibe", "file.newBlank.scene"]);
  assert.equal(e.filter((x) => x.kind).length, OFFICE_BLANK.length);
  assert.equal(blankAction({ id: "ext", label: "Ext" }), null);
  assert.equal(typeof blankAction({ id: "ext", newBlank() {} }), "function");
});
