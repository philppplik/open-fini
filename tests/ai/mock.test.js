import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { createMockProvider, planForPrompt } from "../../app/src/ai/providers/mock.js";
import { runAgent } from "../../app/src/ai/agent.js";
import { base64ToBytes } from "../../app/src/ai/util.js";
import { collect } from "./helpers.js";

const TOOLS = ["new_document", "add_shape", "add_text", "set_style", "apply_adjustment", "list_layers", "create_website", "write_file", "screenshot"];
function makeTools(log) {
  let n = 0;
  return TOOLS.map((name) => ({
    name,
    description: name,
    inputSchema: { type: "object" },
    run: (input) => {
      log.push({ name, input });
      if (name === "list_layers") return { layers: [{ id: "layerA" }, { id: "layerB" }] };
      if (name === "screenshot" || name === "write_file") return "ok";
      return { id: `${name}-${++n}` };
    },
  }));
}
const go = async (prompt, log = []) => {
  const r = await runAgent({ provider: createMockProvider(), model: "demo", messages: [{ role: "user", content: prompt }], tools: makeTools(log) });
  return { r, log };
};

test("mock: poster and logo run new_document, gradient background, headline, screenshot, closing text", async () => {
  for (const word of ["poster", "logo"]) {
    const { r, log } = await go(`Make a ${word} "Moon Cafe"`);
    assert.deepEqual(log.map((l) => l.name), ["new_document", "add_shape", "add_text", "screenshot"]);
    assert.equal(log[1].input.type, "rect");
    assert.equal(log[1].input.fill.type, "linear");
    assert.equal(log[2].input.text, "Moon Cafe");
    for (const k of ["text", "x", "y", "fontSize", "color", "fontWeight"]) assert.ok(k in log[2].input, k);
    for (const k of ["type", "x", "y", "w", "h", "fill", "radius", "name"]) assert.ok(k in log[1].input, k);
    assert.equal(r.stopReason, "end");
    assert.equal(r.messages.at(-1).role, "assistant");
    assert.ok(r.messages.at(-1).content.some((b) => b.type === "text" && b.text.length > 10));
  }
});

test("mock: website uses create_website and write_file", async () => {
  const { log } = await go("Build me a portfolio website");
  assert.deepEqual(log.map((l) => l.name), ["create_website", "write_file", "write_file", "screenshot"]);
  assert.equal(log[0].input.template, "portfolio");
  assert.ok(log[1].input.path && log[1].input.content.includes("<!doctype html>"));
});

test("mock: adjustments reference layer ids returned by list_layers", async () => {
  const { log } = await go("make it brighter and add a blur");
  assert.deepEqual(log.map((l) => l.name), ["list_layers", "apply_adjustment", "apply_adjustment", "screenshot"]);
  assert.equal(log[1].input.targetId, "layerA");
  assert.equal(log[1].input.kind, "adjustment");
  assert.equal(log[1].input.id, "brightness-contrast");
  assert.ok(log[1].input.params);
  assert.equal(log[2].input.kind, "filter");
  assert.equal(log[2].input.id, "gaussian-blur");
  assert.equal(log[2].input.targetId, "layerA");
});

test("mock: shapes, outline via set_style with returned ids, headline", async () => {
  const { log } = await go('red rectangle and a circle and a headline "Hi" with a border');
  assert.deepEqual(log.map((l) => l.name), ["add_shape", "add_shape", "add_text", "set_style", "screenshot"]);
  assert.equal(log[0].input.fill, "#ef4444");
  assert.deepEqual(log[3].input.ids, ["add_shape-1", "add_shape-2"]);
});

test("mock: friendly fallback, missing tools, toolChoice none, thinking, usage", async () => {
  const p = createMockProvider();
  const ev = await collect(p.stream({ model: "demo", messages: [{ role: "user", content: "what is the weather" }], tools: [{ name: "add_shape" }], reasoning: { effort: "low" } }));
  assert.ok(ev.some((e) => e.type === "thinking"));
  assert.ok(ev.some((e) => e.type === "usage"));
  const done = ev.at(-1);
  assert.equal(done.stopReason, "end");
  assert.match(done.message.content.find((b) => b.type === "text").text, /demo mode/);
  const noTools = await collect(p.stream({ model: "demo", messages: [{ role: "user", content: "draw a circle" }] }));
  assert.equal(noTools.at(-1).message.content.some((b) => b.type === "tool_use"), false);
  const onlyShape = await collect(p.stream({ model: "demo", messages: [{ role: "user", content: "a poster" }], tools: [{ name: "add_shape" }] }));
  assert.deepEqual(onlyShape.filter((e) => e.type === "tool_call").map((e) => e.name), ["add_shape"]);
  assert.equal(onlyShape.at(-1).stopReason, "tool_use");
});

test("mock: custom script generator and abort", async () => {
  const p = createMockProvider({
    script: async function* (req) {
      yield { type: "text", delta: "A" };
      yield { type: "tool_call", name: "x", input: { v: req.messages.length } };
    },
  });
  const ev = await collect(p.stream({ model: "m", messages: [{ role: "user", content: "x" }] }));
  const done = ev.at(-1);
  assert.equal(done.stopReason, "tool_use");
  assert.equal(done.message.content[1].input.v, 1);
  assert.ok(done.message.content[1].id, "ids are synthesized");
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(collect(p.stream({ model: "m", messages: [] }, { signal: ctl.signal })), (e) => e.name === "AbortError");
});

test("mock: models, embeddings and images", async () => {
  const p = createMockProvider();
  assert.equal((await p.listModels())[0].id, "demo");
  const [a, b, c] = await p.embed(["blue circle", "blue circle", "tax invoice"]);
  assert.deepEqual(a, b);
  const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
  assert.ok(dot(a, a) > 0.999);
  assert.ok(dot(a, c) < dot(a, b));
  const [img] = await p.generateImage({ prompt: "sunset" });
  const bytes = base64ToBytes(img.data);
  assert.equal(img.mime, "image/png");
  assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // decode IDAT with zlib to prove the PNG is valid
  let off = 8;
  const idat = [];
  while (off < bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + off).getUint32(0);
    const type = String.fromCharCode(...bytes.slice(off + 4, off + 8));
    if (type === "IDAT") idat.push(bytes.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  assert.equal(inflateSync(Buffer.concat(idat)).length, (64 * 3 + 1) * 64);
  assert.equal((await p.generateImage({ prompt: "sunset" }))[0].data, img.data, "deterministic");
});

test("mock: planForPrompt returns nothing for unrelated prompts", () => {
  assert.deepEqual(planForPrompt("tell me a joke"), []);
});
