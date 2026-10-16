import test from "node:test";
import assert from "node:assert/strict";
import { KnowledgeIndex, chunkText, tokenize, stem } from "../../app/src/ai/rag.js";

const DOCS = [
  { id: "brand", title: "Brand guide", text: "Our brand colors are deep teal and warm orange. The logo needs clear space equal to the height of the letter O. Typography uses Inter for headings and Source Serif for body text." },
  { id: "pricing", title: "Pricing", text: "The Pro plan costs 19 dollars per month. Teams pay 49 dollars per month for ten seats. Invoices are sent on the first day of each billing cycle." },
  { id: "faq", title: "FAQ", text: "How do I export a poster? Open the export dialog and choose PDF with bleed. Printing at 300 dpi gives the sharpest posters." },
];

test("chunkText: sizes, overlap, sentence awareness", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("short text"), ["short text"]);
  const para = (i) => `Paragraph ${i} starts here. ` + "It has several sentences about design. ".repeat(6);
  const text = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
  const chunks = chunkText(text, { size: 400, overlap: 80 });
  assert.ok(chunks.length >= 6);
  for (const c of chunks) assert.ok(c.length <= 400, `chunk length ${c.length}`);
  // all paragraph headings survive
  const joined = chunks.join("\n");
  for (let i = 0; i < 12; i++) assert.ok(joined.includes(`Paragraph ${i} starts here.`));
  // overlap: consecutive chunks share some words
  const tail = chunks[0].split(/\s+/).slice(-3).join(" ");
  assert.ok(chunks[1].includes(tail.split(" ").at(-1)));
  // chunks end on sentence boundaries when possible
  assert.ok(chunks.slice(0, -1).every((c) => /[.!?]$/.test(c)));
  // no whitespace at all: hard split
  const hard = chunkText("x".repeat(2500), { size: 1000, overlap: 100 });
  assert.deepEqual(hard.map((c) => c.length), [1000, 1000, 500]);
  // CRLF normalized
  assert.equal(chunkText("a\r\n\r\nb", { size: 1 }).join("|").includes("\r"), false);
});

test("tokenizer and stemmer", () => {
  assert.deepEqual(tokenize("The quick Posters are printing 300 dpi!"), ["quick", "poster", "print", "300", "dpi"]);
  assert.equal(stem("colors"), stem("color"));
  assert.equal(stem("designing"), stem("designed"));
  assert.equal(stem("queries"), "query");
  assert.equal(stem("glass"), "glass");
  assert.deepEqual(tokenize("Café über"), ["café", "über"]);
});

test("KnowledgeIndex: BM25 ranking, remove, replace, stats, listDocuments", async () => {
  const idx = new KnowledgeIndex();
  for (const d of DOCS) idx.addDocument({ ...d, meta: { src: d.id } }); // sync part works without await
  assert.equal(idx.stats().docs, 3);
  let hits = await idx.search("what are the brand colors?");
  assert.equal(hits[0].docId, "brand");
  assert.equal(hits[0].title, "Brand guide");
  assert.deepEqual(hits[0].meta, { src: "brand" });
  assert.match(hits[0].chunkId, /^brand#\d+$/);
  assert.ok(hits[0].score > 0);
  hits = await idx.search("how much does the pro plan cost per month");
  assert.equal(hits[0].docId, "pricing");
  hits = await idx.search("printing posters pdf bleed");
  assert.equal(hits[0].docId, "faq");
  assert.deepEqual(await idx.search("zzzz qqqq"), []);
  assert.deepEqual(await idx.search(""), []);
  assert.equal((await idx.search("month", { k: 1 })).length, 1);
  assert.deepEqual(await idx.search("brand", { minScore: 1000 }), []);
  assert.deepEqual(idx.listDocuments().map((d) => [d.id, d.title, d.chunks, d.meta.src]), [["brand", "Brand guide", 1, "brand"], ["pricing", "Pricing", 1, "pricing"], ["faq", "FAQ", 1, "faq"]]);

  assert.equal(idx.removeDocument("brand"), true);
  assert.equal(idx.removeDocument("brand"), false);
  assert.equal((await idx.search("brand colors"))[0]?.docId === "brand", false);
  await idx.addDocument({ id: "pricing", title: "Pricing", text: "Everything is free now." });
  assert.equal((await idx.search("pro plan costs")).length, 0);
  assert.equal(idx.stats().docs, 2);
  assert.equal(idx.stats().hasEmbedder, false);
});

test("KnowledgeIndex: title terms are searchable; multi-chunk docs", async () => {
  const idx = new KnowledgeIndex({ chunkSize: 300, overlap: 40 });
  const long = Array.from({ length: 40 }, (_, i) => `Section ${i} talks about topic${i} in detail.`).join(" ");
  await idx.addDocument({ id: "long", title: "Handbook", text: long });
  assert.ok(idx.stats().chunks > 3);
  const [top] = await idx.search("topic33");
  assert.ok(top.text.includes("topic33"));
  assert.equal((await idx.search("handbook")).length > 0, true);
});

test("KnowledgeIndex: hybrid search with a fake embedder, serialization round trip", async () => {
  // fake embedder: concept axes (colors, money, printing)
  const axes = [/colou?r|teal|orange|brand/i, /cost|dollar|price|plan|pay|cheap/i, /print|pdf|dpi|poster|export/i];
  const embed = async (texts) => texts.map((t) => axes.map((re) => (re.test(t) ? 1 : 0)).concat([0.01]));
  const idx = new KnowledgeIndex();
  idx.setEmbedder(embed);
  for (const d of DOCS) await idx.addDocument(d);
  assert.equal(idx.stats().vectors, 3);
  assert.equal(idx.stats().dim, 4);
  // lexical overlap is zero ("cheap" never appears as a term) but the embedder links it to pricing
  assert.equal(idx.searchSync("cheap")[0], undefined);
  const hits = await idx.search("cheap");
  assert.equal(hits[0].docId, "pricing");
  // hybrid score is an RRF score
  assert.ok(hits[0].score > 0 && hits[0].score < 0.05);
  // both signals agree -> still first
  assert.equal((await idx.search("brand colors"))[0].docId, "brand");

  const json = JSON.parse(JSON.stringify(idx.toJSON()));
  assert.equal(json.docs.length, 3);
  assert.equal(typeof json.docs[0].chunks[0].vec, "string");
  const copy = KnowledgeIndex.fromJSON(json);
  assert.deepEqual(copy.stats(), { ...idx.stats(), hasEmbedder: false });
  assert.deepEqual(copy.listDocuments(), idx.listDocuments());
  assert.equal((await copy.search("how do I export a poster"))[0].docId, "faq");
  copy.setEmbedder(embed);
  assert.equal((await copy.search("cheap"))[0].docId, "pricing");
  assert.equal(KnowledgeIndex.fromJSON(JSON.stringify(idx.toJSON())).stats().chunks, 3);
  assert.throws(() => KnowledgeIndex.fromJSON({ nope: 1 }));

  // embedMissing after setting the embedder late, and a failing embedder keeps BM25 working
  const late = new KnowledgeIndex();
  for (const d of DOCS) late.addDocument(d);
  late.setEmbedder(embed);
  assert.equal(await late.embedMissing(), 3);
  const bad = new KnowledgeIndex();
  bad.setEmbedder(async () => { throw new Error("embedding service down"); });
  await assert.rejects(bad.addDocument(DOCS[0]), /service down/);
  assert.equal((await bad.search("brand colors"))[0].docId, "brand");
});

test("KnowledgeIndex: 5k chunks index and search quickly", async () => {
  const idx = new KnowledgeIndex();
  const words = Array.from({ length: 800 }, (_, i) => "w" + ((i * 7919) % 997).toString(36) + "x" + i);
  let t = Date.now();
  for (let d = 0; d < 250; d++) {
    const text = Array.from({ length: 20 }, (_, p) => Array.from({ length: 45 }, (_, k) => words[(d * 31 + p * 17 + k * 3) % words.length]).join(" ") + ".").join("\n\n");
    idx.addDocument({ id: "d" + d, title: "Doc " + d, text });
  }
  const built = Date.now() - t;
  assert.ok(idx.stats().chunks >= 2500, "chunks: " + idx.stats().chunks);
  t = Date.now();
  for (let i = 0; i < 50; i++) await idx.search(words[i * 5] + " " + words[i * 5 + 1]);
  const per = (Date.now() - t) / 50;
  assert.ok(per < 50, `search ${per} ms`);
  assert.ok(built < 3000, `build ${built} ms`);
});
