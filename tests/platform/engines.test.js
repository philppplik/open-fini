// Engine registry (platform/engines.js), the PDF knowledge-base loader (vibe/rag-pdf.js), loader ingestion with page
// citations (vibe/knowledge-sources.js) and the microphone helpers for batch recognizers (vibe/speech-capture.js).
import test from "node:test";
import assert from "node:assert/strict";
import { EngineRegistry, validateEngine, extensionEngine, mcpEngine, ENGINE_KINDS } from "../../app/src/platform/engines.js";
import { ensureBuiltinEngines } from "../../app/src/platform/builtin-engines.js";
import { itemsToText, loadPdfText } from "../../app/src/vibe/rag-pdf.js";
import { addFiles, searchWithCitations, pageAt } from "../../app/src/vibe/knowledge-sources.js";
import { KnowledgeIndex } from "../../app/src/ai/rag.js";
import { resampleMono, rms, createEndpointer } from "../../app/src/vibe/speech-capture.js";
import { simplePdf } from "../formats/_pdf-fixture.js";

const stt = (o = {}) => ({ id: "wh", label: "Whisper", local: true, transcribe: async () => ({ text: "hi" }), ...o });

test("validateEngine checks id, label, privacy flag and the kind's method", () => {
  assert.deepEqual(validateEngine("stt", stt()), []);
  assert.match(validateEngine("nope", stt())[0], /Unknown engine kind/);
  assert.ok(validateEngine("stt", stt({ id: "Bad Id" })).some((e) => /id must/.test(e)));
  assert.ok(validateEngine("stt", stt({ local: "yes" })).some((e) => /local must/.test(e)));
  assert.ok(validateEngine("stt", { id: "x1", label: "X", local: true }).some((e) => /listen or transcribe/.test(e)));
  assert.ok(validateEngine("rag-loader", { id: "doc", label: "D", local: true, load() {}, extensions: ["pdf"] }).some((e) => /extensions/.test(e)));
  assert.deepEqual(Object.keys(ENGINE_KINDS), ["stt", "tts", "search", "rag-loader", "ocr"]);
});

test("register, list, pick and dispose; built-ins stay first; ids are unique per kind", () => {
  const r = new EngineRegistry();
  const seen = [];
  r.onChange((k) => seen.push(k));
  const offExt = r.register("stt", stt({ id: "ext:a:w", source: "extension" }));
  r.register("stt", { id: "system", label: "System", local: false, listen() {} });
  assert.deepEqual(r.list("stt").map((e) => e.id), ["system", "ext:a:w"]);
  assert.throws(() => r.register("stt", stt({ id: "system" })), /already registered/);
  assert.equal(r.pick("stt").id, "system");
  assert.equal(r.pick("stt", { local: true }).id, "ext:a:w");
  assert.equal(r.pick("stt", { id: "ext:a:w" }).id, "ext:a:w");
  assert.ok(Object.isFrozen(r.get("stt", "system")));
  offExt();
  assert.equal(r.pick("stt", { local: true }), null);
  assert.deepEqual(seen, ["stt", "stt", "stt"]);
  r.register("rag-loader", { id: "pdf", label: "PDF", local: true, extensions: [".PDF"], mimes: ["application/pdf"], load() {} });
  assert.equal(r.pick("rag-loader", { path: "Docs/Report.pdf" }).id, "pdf");
  assert.equal(r.pick("rag-loader", { mime: "application/pdf" }).id, "pdf");
  assert.equal(r.pick("rag-loader", { path: "a.docx" }), null);
  assert.deepEqual(r.loaderExtensions(), [".pdf"]);
});

test("extension and MCP engines: method per kind, privacy defaults, plain options", async () => {
  const calls = [];
  const e = extensionEngine("stt", { id: "whisper", label: "Whisper (WASM)", local: true }, async (id, args, op = "run") => (calls.push({ id, args, op }), { text: "hallo" }), { id: "dev.example.whisper", name: "Whisper" });
  assert.equal(e.id, "ext:dev.example.whisper:whisper");
  assert.equal(e.source, "extension");
  const ctl = new AbortController();
  assert.deepEqual(await e.transcribe(new Float32Array(4), { lang: "de", signal: ctl.signal, onX: () => {} }), { text: "hallo" });
  assert.deepEqual(Object.keys(calls[0].args[1]), ["lang"], "signals and functions do not cross the sandbox");
  assert.throws(() => extensionEngine("nope", { id: "x" }, () => {}, { id: "a", name: "A" }), /cannot register/);
  const s = extensionEngine("search", { id: "s", label: "S" }, async () => [], { id: "a.b", name: "Acme" });
  assert.equal(s.local, false, "remote unless the extension says otherwise");
  assert.match(s.endpoint, /Acme/);
  const m = mcpEngine("search", { server: "Brave MCP", tool: "web_search", callTool: async (name, args) => ({ name, args }), map: (q, o) => ({ q, n: o.limit }), parse: (r) => [{ title: r.name, url: "https://x.example", snippet: r.args.q }] });
  assert.equal(m.id, "mcp:brave-mcp:web_search");
  assert.deepEqual(await m.search("cats", { limit: 3 }), [{ title: "web_search", url: "https://x.example", snippet: "cats" }]);
  assert.deepEqual(validateEngine("search", m), []);
});

test("PDF loader: text layer per page with page starts; scans are reported or sent to OCR", async () => {
  assert.equal(itemsToText([{ str: "Hello", transform: [1, 0, 0, 1, 0, 100] }, { str: "World", transform: [1, 0, 0, 1, 40, 100] }, { str: "Next line", transform: [1, 0, 0, 1, 0, 80], hasEOL: true }]), "Hello World\nNext line");
  const pdf = simplePdf("BT /F1 12 Tf 20 150 Td (Revenue grew) Tj ET");
  const r = await loadPdfText(pdf);
  assert.match(r.text, /Revenue grew/);
  assert.deepEqual(r.pages, [{ n: 1, char: 0 }]);
  assert.deepEqual(r.skipped, []);
  const blank = simplePdf("0 0 1 rg 10 10 50 50 re f");
  const none = await loadPdfText(blank);
  assert.equal(none.text, "");
  assert.match(none.skipped[0].reason, /OCR engine/);
  const ocr = { label: "Fake OCR", recognize: async (img) => ({ text: `scanned ${img.width}` }) };
  const viaOcr = await loadPdfText(blank, { ocr, renderPage: async () => ({ width: 7, height: 1, data: new Uint8ClampedArray(28) }) });
  assert.equal(viaOcr.text, "scanned 7");
  await assert.rejects(loadPdfText(new TextEncoder().encode("not a pdf")), /not a valid PDF|could not be read/);
});

test("knowledge base: loader files are indexed and cited by page", async () => {
  const reg = ensureBuiltinEngines(new EngineRegistry());
  const idx = new KnowledgeIndex({ chunkSize: 200, overlap: 20 });
  const pdf = simplePdf("BT /F1 12 Tf 20 150 Td (Warranty lasts months) Tj ET");
  const r = await addFiles(idx, [{ path: "docs/terms.pdf", bytes: pdf }, { path: "img.png", bytes: new Uint8Array(8) }], { loaderFor: (p) => reg.pick("rag-loader", { path: p }) });
  assert.deepEqual(r.added, ["docs/terms.pdf"]);
  assert.equal(r.skipped[0].reason, "not a text file");
  const hits = await searchWithCitations(idx, "warranty months");
  assert.equal(hits.results[0].page, 1);
  assert.equal(hits.cite.split("\n")[0], "[1] docs/terms.pdf p.1");
  assert.equal(pageAt([{ n: 1, char: 0 }, { n: 3, char: 50 }], 60), 3);
  // without a loader PDFs stay skipped, as before
  const r2 = await addFiles(new KnowledgeIndex(), [{ path: "a.pdf", bytes: pdf }]);
  assert.equal(r2.skipped[0].reason, "not a text file");
});

test("speech capture helpers: resampling, level and the end of an utterance", () => {
  const out = resampleMono([new Float32Array([0, 1, 0, -1]), new Float32Array([0, 1, 0, -1])], 48000, 16000);
  assert.equal(out.length, 2);
  assert.equal(resampleMono([new Float32Array([0.5])], 16000).length, 1);
  assert.ok(Math.abs(rms(new Float32Array([1, -1])) - 1) < 1e-9);
  const ep = createEndpointer({ threshold: 0.1, silenceMs: 300, maxMs: 5000, startTimeoutMs: 1000 });
  assert.equal(ep.push(0.01, 100), "listening");
  assert.equal(ep.push(0.5, 100), "speaking");
  assert.equal(ep.push(0.01, 200), "speaking");
  assert.equal(ep.push(0.01, 100), "done");
  const quiet = createEndpointer({ threshold: 0.1, startTimeoutMs: 300 });
  assert.equal(quiet.push(0, 300), "done");
  assert.equal(quiet.spoke, false);
});
