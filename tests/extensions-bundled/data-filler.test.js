import test from "node:test";
import assert from "node:assert/strict";
import { rng, generate, KINDS, guessKind, fillValue, htmlList, htmlTable, htmlCards, fakeRows, initials, fillSelection, insertAvatars, insertHtmlBlock, email, fullName } from "../../extensions/data-filler/src/lib.js";
import { mockApi } from "./_mock.js";

test("the PRNG is deterministic per seed and differs between seeds", () => {
  const a = rng(42);
  const b = rng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(rng(1)(), rng(2)());
  assert.equal(rng("x")(), rng("x")());
  const r = rng(7);
  for (let i = 0; i < 200; i++) {
    const n = r.int(3, 5);
    assert.ok(n >= 3 && n <= 5);
  }
});

test("every kind generates non-empty, deterministic text", () => {
  for (const kind of Object.keys(KINDS)) {
    const one = generate(kind, { seed: 5, count: 3 });
    assert.deepEqual(one, generate(kind, { seed: 5, count: 3 }), kind);
    assert.ok(one.join("").length > 0, kind);
  }
  assert.throws(() => generate("nope"), /Unknown kind/);
});

test("generated values have the right shape", () => {
  assert.match(generate("email", { seed: 1 })[0], /^[a-z.]+@[a-z.]+\.[a-z]+$/);
  assert.match(generate("price", { seed: 1 })[0], /^\$\d+\.\d\d$/);
  assert.match(generate("date", { seed: 1, dateStyle: "iso" })[0], /^\d{4}-\d\d-\d\d$/);
  assert.match(generate("phone", { seed: 1 })[0], /^\(\d{3}\) \d{3}-\d{4}$/);
  assert.match(generate("initials", { seed: 1 })[0], /^[A-Z]{2}$/);
  assert.equal(generate("words", { seed: 1, count: 4 })[0].split(" ").length, 4);
  assert.equal(generate("paragraphs", { seed: 1, count: 3 })[0].split("\n\n").length, 3);
  assert.equal(initials("ada lovelace"), "AL");
  assert.ok(email(rng(3), "Ann Lee").startsWith("ann"));
  assert.match(fullName(rng(3)), /^\S+ \S+$/);
});

test("guessKind reads layer names and content", () => {
  assert.equal(guessKind("Email", ""), "email");
  assert.equal(guessKind("Product price", ""), "price");
  assert.equal(guessKind("Author name", ""), "name");
  assert.equal(guessKind("Headline", ""), "words");
  assert.equal(guessKind("Description", ""), "paragraphs");
  assert.equal(guessKind("Layer 4", "", "sentences"), "sentences");
});

test("fillValue is stable per index and seed; short boxes get one paragraph", () => {
  assert.equal(fillValue({ name: "Title" }, { seed: 1, index: 0 }), fillValue({ name: "Title" }, { seed: 1, index: 0 }));
  assert.notEqual(fillValue({ name: "Title" }, { seed: 1, index: 0 }), fillValue({ name: "Title" }, { seed: 1, index: 1 }));
  assert.equal(fillValue({ name: "Body", h: 100 }, { seed: 1 }).includes("\n\n"), false);
});

test("HTML blocks are well formed and use the requested number of items", () => {
  assert.equal((htmlList(5, 1).match(/<li>/g) || []).length, 5);
  assert.equal((htmlTable(4, 1).match(/<tr>/g) || []).length, 5);
  assert.equal((htmlCards(3, 1).match(/<article/g) || []).length, 3);
  assert.match(htmlTable(2, 1), /<th scope="col">/);
  assert.equal(htmlCards(3, 1), htmlCards(3, 1));
  assert.ok(!htmlList(3, 1).includes("<script"));
  assert.equal(fakeRows(2, 9)[0].name, fakeRows(2, 9)[0].name);
});

test("fillSelection fills text layers inside groups and skips other layers", async () => {
  const api = mockApi({ selection: [{ id: "g", type: "group", children: [{ id: "t1", type: "text", name: "Email", text: "x" }, { id: "r", type: "rect" }] }, { id: "t2", type: "text", name: "Title", text: "y" }] });
  const n = await fillSelection(api, { kind: "auto", seed: 3 });
  assert.equal(n, 2);
  const texts = api.calls.filter((c) => c[1].text !== undefined);
  assert.deepEqual(texts.map((c) => c[1].ids[0]), ["t1", "t2"]);
  assert.match(texts[0][1].text, /@/);
  assert.deepEqual(api.calls.filter((c) => c[1].name).map((c) => c[1].name), ["Email", "Title"], "layer names are restored");
  assert.equal(await fillSelection(mockApi({ selection: [{ id: "r", type: "rect" }] }), {}), 0);
});

test("insertAvatars adds a circle and initials per avatar; insertHtmlBlock inserts markup", async () => {
  const api = mockApi({});
  await insertAvatars(api, { count: 2, seed: 1 });
  assert.deepEqual(api.calls.map((c) => c[0]), ["add_shape", "add_text", "add_shape", "add_text"]);
  const html = mockApi({ studio: "code" });
  await insertHtmlBlock(html, { block: "table", count: 3, seed: 1 });
  assert.equal(html.calls[0][0], "insert_html");
  assert.match(html.calls[0][1].html, /<table/);
  await assert.rejects(() => insertHtmlBlock(html, { block: "nope" }), /Unknown block/);
});
