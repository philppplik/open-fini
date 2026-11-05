import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createOpenFiniTools, TOOL_GROUPS, VERIFY_WITH } from "../../app/src/vibe/tools/index.js";
import { PACK_SKILL_LIST, hydrateSkill, parseSkill, skillsCatalog, BUILTIN_SKILL_LIST } from "../../app/src/ai/skills.js";
import { PACK_SKILLS, loadPack, GUIDE_FOR_STUDIO } from "../../app/src/ai/packs/index.js";

const tools = createOpenFiniTools({ prefs: {}, docs: [], on() {}, emit() {} }, {});
const names = new Set(tools.map((t) => t.name));

test("tool lint: descriptions, documented parameters and a verify hint on every write tool", () => {
  for (const t of tools) {
    assert.ok(t.description.length >= 30, `${t.name}: description too short`);
    for (const [k, v] of Object.entries(t.inputSchema.properties || {})) assert.ok(v.description, `${t.name}.${k} has no description`);
    if (!t.readOnly) assert.match(t.description, /verif/i, `${t.name}: write tools say how to verify`);
  }
  for (const g of Object.keys(TOOL_GROUPS)) assert.ok(VERIFY_WITH[g], `VERIFY_WITH misses group ${g}`);
  for (const hint of Object.values(VERIFY_WITH)) for (const m of hint.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)) assert.ok(names.has(m[0]), `verify hint names unknown tool ${m[0]}`);
});

test("pack catalog rows match the lazy pack modules", async () => {
  for (const pack of new Set(PACK_SKILLS.map((s) => s.pack))) {
    const parsed = (await loadPack(pack)).map(parseSkill);
    const rows = PACK_SKILLS.filter((s) => s.pack === pack);
    assert.deepEqual(parsed.map((s) => s.name).sort(), rows.map((s) => s.name).sort(), pack);
    for (const s of parsed) {
      assert.equal(s.description, rows.find((r) => r.name === s.name).description, `${s.name}: catalog description drifted`);
      assert.ok(s.body.length > 300 && s.body.length < 6000, `${s.name}: keep packs small (${s.body.length})`);
      for (const t of s.allowedTools) assert.ok(names.has(t), `${s.name} allows unknown tool ${t}`);
      for (const m of s.body.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)) if (/^(add|get|list|set|select|import|apply|edit|write|read|office|sheet|slides|board|describe|check|plan|work|spawn|wait)_/.test(m[1])) assert.ok(names.has(m[1]), `${s.name} mentions unknown tool ${m[1]}`);
      for (const m of s.body.matchAll(/docs\/[\w-]+\.md/g)) assert.ok(existsSync(m[0]), `${s.name} links missing ${m[0]}`);
    }
  }
  for (const g of Object.values(GUIDE_FOR_STUDIO)) assert.ok(PACK_SKILLS.some((s) => s.name === g), g);
  assert.ok(!BUILTIN_SKILL_LIST.some((s) => PACK_SKILLS.some((p) => p.name === s.name)), "pack names are unique");
});

test("pack skills are stubs until hydrated and the catalog stays compact", async () => {
  const stub = PACK_SKILL_LIST.find((s) => s.name === "openfini-formats");
  assert.equal(stub.body, "");
  const full = await hydrateSkill(stub);
  assert.match(full.body, /\.docx/);
  const cat = skillsCatalog(PACK_SKILL_LIST);
  assert.equal(cat.split("\n").length, 3, "one line per pack");
  assert.ok(cat.length < 1400);
});

test("generated knowledge data is up to date (npm run knowledge:packs)", () => {
  const r = spawnSync(process.execPath, ["scripts/knowledge-packs.mjs", "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const gen = readFileSync("app/src/ai/packs/generated.js", "utf8");
  assert.match(gen, /Mod\+S/);
  assert.match(gen, /xlsx/);
});
