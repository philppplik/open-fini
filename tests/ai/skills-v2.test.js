import test from "node:test";
import assert from "node:assert/strict";
import { parseSkill, serializeSkill, renderSkill, validateSkill, suggestSkills, parseArgString, parseParam, BUILTIN_SKILL_LIST, skillsCatalog } from "../../app/src/ai/skills.js";

const SRC = `---
name: brand-post
description: Make a social post for a brand with a given tone and size.
version: 1.2.0
enforce-tools: true
allowed-tools: add_text, add_shape
params:
  - "brand: Brand name, short"
  - "tone: Voice (default: friendly)"
  - "size?: Canvas size"
when-to-use: instagram post, social graphic for my brand
requires: [base-layout]
references: [checklist.md]
studios: [layout, vector]
---
# Post for {{brand}}

Tone {{tone}}. Raw: $ARGUMENTS

## Verify
screenshot`;

test("skill features: params, enforcement, triggers, composition fields", () => {
  const s = parseSkill(SRC);
  assert.deepEqual(s.params, [
    { name: "brand", description: "Brand name, short", required: true },
    { name: "tone", description: "Voice", default: "friendly", required: false },
    { name: "size", description: "Canvas size", required: false },
  ]);
  assert.equal(s.enforceTools, true);
  assert.equal(s.version, "1.2.0");
  assert.equal(s.whenToUse, "instagram post, social graphic for my brand");
  assert.deepEqual(s.requires, ["base-layout"]);
  assert.deepEqual(s.references, ["checklist.md"]);
  assert.deepEqual(s.studios, ["layout", "vector"]);
  // round trip keeps the parameter specs (commas inside descriptions survive)
  const back = parseSkill(serializeSkill(s));
  assert.deepEqual(back.params, s.params);
  assert.equal(back.enforceTools, true);
  assert.equal(back.body, s.body);
  assert.match(skillsCatalog([s]), /\[args: brand, tone\?, size\?\]/);
});

test("parseParam and parseArgString", () => {
  assert.deepEqual(parseParam("x=5"), { name: "x", description: "", default: "5", required: false });
  assert.equal(parseParam("not valid!"), null);
  assert.deepEqual(parseParam({ name: "a", default: 1 }), { name: "a", description: "", default: "1", required: false });
  const params = parseSkill(SRC).params;
  assert.deepEqual(parseArgString('brand="Acme Co" tone=bold extra words', params), { named: { brand: "Acme Co", tone: "bold" }, raw: 'brand="Acme Co" tone=bold extra words' });
  assert.deepEqual(parseArgString("Acme", params).named, { brand: "Acme" });
});

test("renderSkill substitutes, reports missing args, includes required skills, lists references", () => {
  const base = parseSkill("---\nname: base-layout\ndescription: Shared layout rules for every layout skill here.\n---\nUse a 12 column grid.\n\n## Verify\nscreenshot");
  const s = { ...parseSkill(SRC), files: { "checklist.md": "- one" } };
  const r = renderSkill(s, { args: { brand: "Acme" }, all: [s, base] });
  assert.deepEqual(r.missing, []);
  assert.match(r.text, /# Post for Acme/);
  assert.match(r.text, /Tone friendly\./);
  assert.match(r.text, /Raw: brand=Acme tone=friendly/);
  assert.match(r.text, /## Included skill: base-layout\nUse a 12 column grid/);
  assert.match(r.text, /Reference files of this skill.*checklist\.md/);
  assert.match(r.text, /only these tools are allowed: add_text, add_shape/);
  assert.deepEqual(renderSkill(s, { all: [s] }).missing, ["brand"]);
  assert.match(renderSkill(s, { all: [s] }).text, /Required skill “base-layout” is not installed/);
  // cycles do not loop
  const a = parseSkill("---\nname: a1\ndescription: x\nrequires: [b1]\n---\nA");
  const b = parseSkill("---\nname: b1\ndescription: x\nrequires: [a1]\n---\nB");
  assert.equal((renderSkill(a, { all: [a, b] }).text.match(/Included skill/g) || []).length, 1);
  // undeclared named values are appended when the body has no placeholders
  assert.match(renderSkill(parseSkill("---\nname: q\ndescription: d\n---\nBody"), { args: "k=v" }).text, /## Arguments\n- k: v/);
});

test("validateSkill catches real problems", () => {
  const ok = validateSkill(SRC, { toolNames: ["add_text", "add_shape"], skillNames: ["base-layout"] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.warnings, []);
  const bad = validateSkill("---\nname: Bad Name\ndescription: short\nenforce-tools: yes\nrequires: [bad-name]\n---\nUse {{who}}.", { toolNames: [], skillNames: [] });
  assert.ok(bad.errors.some((e) => /name must be/.test(e)));
  assert.ok(bad.errors.some((e) => /description/.test(e)));
  assert.ok(bad.errors.some((e) => /enforce-tools/.test(e)));
  assert.ok(bad.warnings.some((w) => /\{\{who\}\}/.test(w)));
  assert.ok(validateSkill("no front matter at all, just text that is long enough to count").errors.some((e) => /front matter/.test(e)));
});

test("suggestSkills ranks by name, description, tags and triggers", () => {
  const top = (q) => suggestSkills(q, BUILTIN_SKILL_LIST, { limit: 1 })[0]?.skill.id;
  assert.equal(top("Can you design a logo for my bakery?"), "logo-design");
  assert.equal(top("translate all the text into German"), "copy-localization");
  assert.equal(top("make me a slide deck for the board meeting"), "presentation-layout");
  assert.equal(top("build the brand kit with three agents in parallel"), "multi-agent-project-lead");
  assert.deepEqual(suggestSkills("ok", BUILTIN_SKILL_LIST), []);
});

test("the built-in library has at least 26 skills, 16 of them new workflows with verification", () => {
  assert.ok(BUILTIN_SKILL_LIST.length >= 26);
  for (const id of ["design-system-builder", "responsive-website-from-brief", "photo-compositing", "icon-set", "presentation-layout", "print-brochure", "social-campaign-kit", "ui-mockup-mobile", "data-viz-report", "code-refactor-web", "seo-and-meta-audit", "accessibility-fixes", "copy-localization", "brand-from-logo", "web-animation-css", "multi-agent-project-lead"]) {
    const s = BUILTIN_SKILL_LIST.find((x) => x.id === id);
    assert.ok(s, id);
    assert.ok(s.version, `${id} has a version`);
    assert.ok(s.whenToUse.length > 10, `${id} has when-to-use triggers`);
    const r = renderSkill(s, { args: Object.fromEntries(s.params.map((p) => [p.name, "x"])), all: BUILTIN_SKILL_LIST });
    assert.deepEqual(r.missing, [], id);
    assert.doesNotMatch(r.text, /\{\{/, `${id}: every placeholder is declared`);
  }
});
