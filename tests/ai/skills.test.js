import test from "node:test";
import assert from "node:assert/strict";
import { parseSkill, serializeSkill, skillsCatalog, buildSystemPrompt, BUILTIN_SKILLS, BUILTIN_SKILL_LIST } from "../../app/src/ai/skills.js";

import { createOpenFiniTools } from "../../app/src/vibe/tools/index.js";

// every real tool name (skills may only reference tools that exist), plus the legacy list
const REAL_TOOLS = createOpenFiniTools({ prefs: {}, docs: [], on() {}, emit() {} }, {}).map((t) => t.name);
const TOOL_NAMES = new Set([
  ...REAL_TOOLS,
  ..."get_document_info list_layers get_selection select_layers screenshot add_shape add_text add_path import_svg set_style transform_layers group_layers delete_layers reorder_layers align_layers add_pixel_layer apply_adjustment list_effects generate_image edit_image add_page write_file read_file list_files edit_file insert_element set_element_style set_page_meta search_knowledge remember ask_user use_skill list_commands list_themes set_theme start_tour get_platform_info set_studio get_histogram auto_correct_suggestion new_document add_table edit_table read_table list_tables import_csv_to_table add_chart edit_chart read_chart".split(" "),
]);

test("parseSkill: frontmatter with inline lists, comma lists, quotes", () => {
  const s = parseSkill(`---
name: My Skill
description: "Does: things, well"
allowed-tools: add_shape, add_text
tags: [one, "two words", three]
license: MIT
---

# Heading

Body text.
`);
  assert.equal(s.id, "my-skill");
  assert.equal(s.name, "My Skill");
  assert.equal(s.description, "Does: things, well");
  assert.deepEqual(s.allowedTools, ["add_shape", "add_text"]);
  assert.deepEqual(s.tags, ["one", "two words", "three"]);
  assert.deepEqual(s.meta, { license: "MIT" });
  assert.equal(s.body, "# Heading\n\nBody text.");
});

test("parseSkill: yaml dashes, folded and literal blocks, CRLF, BOM", () => {
  const s = parseSkill(
    "﻿---\r\nname: x\r\ndescription: >\r\n  first line\r\n  second line\r\nallowed-tools:\r\n  - get_selection\r\n  - 'screenshot'\r\ntags:\r\n  - a\r\nnotes: |\r\n  keep\r\n  lines\r\n---\r\nBody\r\n",
  );
  assert.equal(s.description, "first line second line");
  assert.deepEqual(s.allowedTools, ["get_selection", "screenshot"]);
  assert.deepEqual(s.tags, ["a"]);
  assert.equal(s.meta.notes, "keep\nlines");
  assert.equal(s.body, "Body");
});

test("parseSkill: tolerant without frontmatter, space separated tools, odd input", () => {
  const s = parseSkill("# Poster Helper\n\nHelps you with posters.\n\n- step one");
  assert.equal(s.name, "Poster Helper");
  assert.equal(s.description, "Helps you with posters.");
  assert.deepEqual(s.allowedTools, []);
  assert.deepEqual(parseSkill("---\nname: a\nallowed_tools: x y z\n---\n").allowedTools, ["x", "y", "z"]);
  assert.equal(parseSkill("").name, "untitled");
  assert.equal(parseSkill("---\nname: a\n(no closing").name, "untitled");
  assert.equal(parseSkill(null).body, "");
});

test("serializeSkill round trips", () => {
  const skill = { name: "Round: Trip", description: 'Says "hi": really', allowedTools: ["a", "b"], tags: ["t1", "t 2"], body: "# Body\n\n- x", meta: { author: "me" } };
  const back = parseSkill(serializeSkill(skill));
  assert.equal(back.name, skill.name);
  assert.equal(back.description, skill.description);
  assert.deepEqual(back.allowedTools, skill.allowedTools);
  assert.deepEqual(back.tags, skill.tags);
  assert.deepEqual(back.meta, skill.meta);
  assert.equal(back.body, skill.body);
  const minimal = parseSkill(serializeSkill({ name: "m", description: "d", body: "b", extraKey: "v" }));
  assert.deepEqual([minimal.name, minimal.description, minimal.body, minimal.meta.extraKey], ["m", "d", "b", "v"]);
});

test("skillsCatalog is compact", () => {
  assert.equal(skillsCatalog([]), "");
  const cat = skillsCatalog([{ name: "A B", description: "x".repeat(400) }, parseSkill("---\nname: c\ndescription: short\n---\nb")]);
  assert.match(cat, /^Available skills/);
  assert.match(cat, /- a-b: x+\.\.\./);
  assert.match(cat, /- c: short/);
  assert.ok(cat.length < 500);
});

test("built-in skills: useful, well formed skills", () => {
  assert.ok(BUILTIN_SKILLS.length >= 9);
  assert.deepEqual(
    BUILTIN_SKILL_LIST.slice(0, 8).map((s) => s.id),
    ["logo-design", "social-post", "photo-retouch", "landing-page", "poster-layout", "brand-kit", "accessibility-audit", "copywriting"],
  );
  assert.ok(BUILTIN_SKILL_LIST.some((s) => s.id === "help-me-use-openfini"));
  for (const s of BUILTIN_SKILL_LIST) {
    assert.ok(s.description.length > 40 && !s.description.includes("\n"), s.id);
    assert.ok(s.body.length > 1200, `${s.id} body is substantial`);
    assert.ok(s.allowedTools.length >= 3, s.id);
    for (const t of s.allowedTools) assert.ok(TOOL_NAMES.has(t), `${s.id} uses unknown tool ${t}`);
    assert.match(s.body, /screenshot|Read it aloud|Read each line aloud/i, s.id);
    assert.match(s.body, /##\s*Verify/, s.id);
    // tool names mentioned in the body must exist
    for (const m of s.body.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)) {
      if (/^(add|get|list|set|select|import|transform|group|delete|reorder|align|apply|generate|edit|write|read|insert|search|ask|use|remember)_/.test(m[1])) assert.ok(TOOL_NAMES.has(m[1]), `${s.id} mentions ${m[1]}`);
    }
  }
  // a round trip keeps built-ins stable
  const again = parseSkill(serializeSkill(BUILTIN_SKILL_LIST[0]));
  assert.equal(again.body, BUILTIN_SKILL_LIST[0].body);
});

test("buildSystemPrompt", () => {
  const p = buildSystemPrompt({
    studio: "layout",
    doc: { name: "Flyer", pages: 2, page: { width: 800, height: 1120 }, website: false },
    skills: BUILTIN_SKILL_LIST.slice(0, 2),
    memory: ["Brand color is teal", "Prefers short copy"],
    knowledgeHint: "12 documents indexed.",
    mode: "careful",
    extra: "Always answer in a pirate voice.",
  });
  assert.match(p, /Vibe, the assistant built into OpenFini/);
  assert.match(p, /Layout studio/);
  assert.match(p, /name: Flyer/);
  assert.match(p, /800 x 1120 px/);
  assert.match(p, /screenshot/);
  assert.match(p, /untrusted data/);
  assert.match(p, /Never invent tools|never invent tools|Do not invent|invent tools/i);
  assert.match(p, /Mode: careful/);
  assert.match(p, /- logo-design:/);
  assert.match(p, /Brand color is teal/);
  assert.match(p, /12 documents indexed/);
  assert.ok(p.trim().endsWith("Always answer in a pirate voice."), "extra instructions come last");
  assert.match(buildSystemPrompt({ mode: "auto" }), /Mode: auto/);
  assert.match(buildSystemPrompt({}), /Mode: balanced/);
  assert.match(buildSystemPrompt({ doc: { website: true } }), /website project/);
  assert.doesNotMatch(buildSystemPrompt({ doc: null }), /Current document/);
  assert.match(buildSystemPrompt({ mode: "ask" }), /answers and advice only/);
  assert.doesNotMatch(buildSystemPrompt({ extra: "   " }), /Additional instructions/);
});
