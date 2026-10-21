import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../../app/src/ai/skills.js";

test("system prompt follows the UI language but yields to the user's own language", () => {
  const de = buildSystemPrompt({ language: "de" });
  assert.match(de, /German \(de\)/);
  assert.match(de, /unless they write in another language/);
  assert.match(buildSystemPrompt({ language: "en" }), /Answer in the language the user writes in/);
  assert.match(buildSystemPrompt({}), /Answer in the language the user writes in/);
  assert.match(buildSystemPrompt({ language: "fr" }), /\(fr\)/);
});
