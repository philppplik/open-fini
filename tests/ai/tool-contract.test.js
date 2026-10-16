import test from "node:test";
import assert from "node:assert/strict";
import { createOpenFiniTools, TOOL_GROUPS } from "../../app/src/vibe/tools/index.js";
import { BUILTIN_SKILL_LIST, createMockProvider, runAgent, validateSchema } from "../../app/src/ai/index.js";

// Only builds the tool definitions; nothing here touches a document.
const tools = createOpenFiniTools({ prefs: {}, docs: [], on() {}, emit() {} }, {});
const names = new Set(tools.map((t) => t.name));

test("every tool has a name, description, object schema and a run function", () => {
  assert.ok(tools.length >= 50);
  for (const t of tools) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, t.name);
    assert.ok(t.description && t.description.length > 20, `${t.name}: description`);
    assert.equal(t.inputSchema?.type, "object", `${t.name}: schema`);
    assert.equal(typeof t.run, "function", `${t.name}: run`);
  }
  assert.equal(names.size, tools.length, "tool names are unique");
});

test("every tool is listed in exactly one UI group", () => {
  const grouped = Object.values(TOOL_GROUPS).flatMap((g) => g.tools || g);
  for (const n of names) assert.ok(grouped.includes(n), `${n} is missing from TOOL_GROUPS`);
  for (const n of grouped) assert.ok(names.has(n), `TOOL_GROUPS names unknown tool ${n}`);
});

test("built-in skills only allow tools that exist", () => {
  for (const s of BUILTIN_SKILL_LIST) {
    for (const t of s.allowedTools || s["allowed-tools"] || []) assert.ok(names.has(t), `${s.name} allows unknown tool ${t}`);
  }
});

test("the demo assistant only calls tools that exist, with arguments that fit their schemas", async () => {
  const prompts = ["Make a poster for a jazz night", "Design a logo for a coffee shop", "Build a landing page for a bakery", "Make this photo brighter and add a blur", "make it warmer and more saturated"];
  for (const prompt of prompts) {
    const seen = [];
    const byName = new Map(tools.map((t) => [t.name, t]));
    const agentTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      run: async (input) => {
        seen.push({ name: t.name, input });
        // minimal plausible results so the mock can continue (ids of layers)
        return t.name === "list_layers" ? { layers: [{ id: "n1", type: "image" }] } : { ok: true, id: "n1" };
      },
    }));
    await runAgent({ provider: createMockProvider(), model: "demo", system: "", messages: [{ role: "user", content: prompt }], tools: agentTools, maxSteps: 8 });
    assert.ok(seen.length, `${prompt}: the demo did nothing`);
    for (const c of seen) {
      const def = byName.get(c.name);
      assert.ok(def, `${prompt}: unknown tool ${c.name}`);
      assert.deepEqual(validateSchema(c.input, def.inputSchema), [], `${prompt}: ${c.name} arguments do not fit the schema`);
    }
  }
});
