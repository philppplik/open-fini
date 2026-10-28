import test from "node:test";
import assert from "node:assert/strict";
import { routePresets, addTargets, moveTarget } from "../../app/src/vibe/route-presets.js";

const provs = [
  { id: "a", preset: "anthropic", label: "Anthropic" },
  { id: "o", preset: "openai", label: "OpenAI" },
  { id: "l", preset: "ollama", label: "Ollama" },
];

test("presets: same provider, other provider, local", () => {
  const p = Object.fromEntries(routePresets({ activeProvider: "a", model: "claude-sonnet-5-5" }, provs).map((x) => [x.id, x]));
  assert.deepEqual(p["same-smaller"].targets, [{ providerId: "a", model: "claude-haiku-4-5" }]);
  assert.deepEqual(p["fast-cheap"].targets, [{ providerId: "o", model: "gpt-5-mini" }]);
  assert.deepEqual(p["local-last"].targets, [{ providerId: "l", model: "llama3.1" }]);
});

test("presets: missing prerequisites explain themselves", () => {
  const p = Object.fromEntries(routePresets({ activeProvider: "a", model: "claude-haiku-4-5" }, [provs[0]]).map((x) => [x.id, x]));
  assert.equal(p["same-smaller"].targets.length, 0);
  assert.match(p["fast-cheap"].reason, /second connection/);
  assert.match(p["local-last"].reason, /Ollama/);
});

test("addTargets de-duplicates and moveTarget clamps", () => {
  const r = addTargets({ targets: [{ providerId: "a", model: "m" }] }, [{ providerId: "a", model: "m" }, { providerId: "o", model: "n" }]);
  assert.equal(r.targets.length, 2);
  assert.deepEqual(moveTarget([1, 2, 3], 0, -1), [1, 2, 3]);
  assert.deepEqual(moveTarget([1, 2, 3], 0, 2), [2, 3, 1]);
});
