// File Doctor (app/src/core/doctor/): every check against a deliberately broken .ofini built in the test, the repair
// result, the ZIP recovery scan and the short reports on other file types.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8, strFromU8, unzipSync } from "../../app/vendor/fflate/fflate.js";
import { diagnoseFile, repairFile, reportText, doctorReport, redactPaths, FIXES, pngProblem, crc32, scanLocalHeaders, safeEntryName } from "../../app/src/core/doctor/index.js";
import { encodePng } from "../../app/src/engine/export/png.js";

const MIME = "application/vnd.openfini+zip";
const png = () => encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(255) });
const node = (o) => ({ m: [1, 0, 0, 1, 0, 0], opacity: 1, ...o });
const baseJson = () => ({
  format: "openfini",
  version: 1,
  name: "Fixture",
  studio: "vector",
  pages: [{ id: "p1", name: "Page 1", x: 0, y: 0, w: 800, h: 600, bg: "#ffffff", masterId: null, margins: { top: 0, right: 0, bottom: 0, left: 0 }, columns: 1, gutter: 12, bleed: 0, guides: { h: [], v: [] }, root: node({ id: "root", type: "group", children: [node({ id: "r1", type: "rect", w: 10, h: 10 })] }) }],
  masters: [],
  assets: [],
  stories: {},
  styles: { paragraph: {}, character: {} },
  swatches: [],
  settings: {},
});
function pack(json, extra = {}, { mimeFirst = true, thumbnail = true } = {}) {
  const files = {};
  if (mimeFirst) files.mimetype = [strToU8(MIME), { level: 0 }];
  files["document.json"] = typeof json === "string" ? strToU8(json) : strToU8(JSON.stringify(json));
  if (thumbnail) files["thumbnail.png"] = png();
  Object.assign(files, extra);
  return zipSync(files);
}
const codes = (r) => r.findings.map((f) => f.code);
const find = (r, code) => r.findings.find((f) => f.code === code);

test("a healthy project has no findings and reports its contents", () => {
  const r = diagnoseFile(pack(baseJson()), { name: "ok.ofini" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings, []);
  assert.equal(r.info.kind, "vector");
  assert.equal(r.info.pages.length, 1);
  assert.equal(r.info.layers.total, 1);
  assert.equal(r.info.layers.byType.rect, 1);
  assert.equal(r.info.thumbnail, true);
});

test("empty files, non-ZIP files and over-limit files are errors without a fix", () => {
  assert.deepEqual(codes(diagnoseFile(new Uint8Array(), { name: "a.ofini" })), ["empty"]);
  assert.deepEqual(codes(diagnoseFile(strToU8("hello"), { name: "a.ofini" })), ["not-zip"]);
  const r = diagnoseFile(pack(baseJson()), { name: "a.ofini", limits: { entries: 1, entry: 1e9, total: 1e9 } });
  assert.deepEqual(codes(r), ["limits"]);
  assert.equal(r.ok, false);
});

test("a truncated file is recovered from its local headers", () => {
  const full = pack(baseJson(), { "assets/big.bin": new Uint8Array(4000).fill(7) });
  const cut = full.subarray(0, full.length - 40); // the central directory is gone
  const r = diagnoseFile(cut, { name: "cut.ofini" });
  assert.equal(r.container, "recovered");
  assert.equal(find(r, "zip-corrupt").fix.id, "recover-entries");
  const fixed = repairFile(cut, { name: "cut.ofini" });
  assert.ok(fixed.bytes);
  assert.ok(fixed.applied.includes("recover-entries"));
  assert.equal(fixed.after.container, "ok");
  const back = unzipSync(fixed.bytes);
  assert.equal(Object.keys(back)[0], "mimetype");
  assert.ok(back["document.json"]);
});

test("the recovery scan keeps intact entries and lists damaged ones", () => {
  const z = zipSync({ "a.txt": strToU8("x".repeat(500)), "b.txt": strToU8("y".repeat(500)) });
  const bad = z.slice();
  // flip a byte inside the data of the first entry: its CRC no longer matches
  bad[30 + 5 + 3] ^= 0xff;
  const s = scanLocalHeaders(bad);
  assert.ok(s.damaged.includes("a.txt"));
  assert.ok(s.order.includes("b.txt"));
  assert.equal(strFromU8(s.entries["b.txt"]), "y".repeat(500));
});

test("mimetype problems are found and rewritten first and stored", () => {
  const missing = pack(baseJson(), {}, { mimeFirst: false });
  assert.ok(codes(diagnoseFile(missing, { name: "m.ofini" })).includes("mimetype-missing"));
  const wrong = pack(baseJson(), { mimetype: strToU8("text/plain") }, { mimeFirst: false });
  assert.ok(codes(diagnoseFile(wrong, { name: "m.ofini" })).includes("mimetype-wrong"));
  const fixed = repairFile(missing, { name: "m.ofini" });
  assert.equal(Object.keys(unzipSync(fixed.bytes))[0], "mimetype");
  assert.equal(fixed.after.findings.length, 0);
});

test("stray bytes around document.json are removed; unparseable JSON is reported", () => {
  const dirty = pack(`\uFEFF${JSON.stringify(baseJson())}\0\0garbage`);
  const r = diagnoseFile(dirty, { name: "j.ofini" });
  assert.equal(find(r, "json-damaged").fix.id, "json-clean");
  const fixed = repairFile(dirty, { name: "j.ofini" });
  assert.equal(fixed.after.ok, true);
  assert.equal(JSON.parse(strFromU8(unzipSync(fixed.bytes)["document.json"])).name, "Fixture");
  const broken = pack('{"format":"openfini","pages":[');
  const r2 = diagnoseFile(broken, { name: "j.ofini" });
  assert.ok(codes(r2).includes("json-invalid"));
  assert.equal(repairFile(broken, { name: "j.ofini" }).bytes, null);
});

test("missing document.json, newer and unreadable format versions", () => {
  const nodoc = zipSync({ mimetype: [strToU8(MIME), { level: 0 }], "assets/a.png": png() });
  assert.ok(codes(diagnoseFile(nodoc, { name: "n.ofini" })).includes("no-document"));
  const newer = { ...baseJson(), version: 99 };
  assert.equal(find(diagnoseFile(pack(newer), { name: "v.ofini" }), "version-newer").severity, "warning");
  const bad = { ...baseJson(), version: "x" };
  const r = diagnoseFile(pack(bad), { name: "v.ofini" });
  assert.equal(find(r, "version-invalid").fix.safe, false);
  assert.equal(repairFile(pack(bad), { name: "v.ofini" }).bytes, null, "not a safe fix");
  const all = repairFile(pack(bad), { name: "v.ofini", fixes: "all" });
  assert.equal(JSON.parse(strFromU8(unzipSync(all.bytes)["document.json"])).version, 1);
});

test("invalid values, duplicate ids, unreadable layers and a negative page size are repaired safely", () => {
  const j = baseJson();
  j.pages[0].w = -5;
  j.pages[0].root.children.push(node({ id: "r1", type: "ellipse", w: -20, h: null, opacity: 7 }), node({ id: "r3", type: "rect", m: [1, 0, 0, 1, null, 0], w: 5, h: 5 }), 42, { name: "no type" });
  const r = diagnoseFile(pack(j), { name: "v.ofini" });
  for (const c of ["page-size", "duplicate-id", "negative-size", "bad-value", "node-invalid"]) assert.ok(codes(r).includes(c), c);
  const fixed = repairFile(pack(j), { name: "v.ofini" });
  assert.equal(fixed.after.counts.error + fixed.after.counts.warning, 0, reportText(fixed.after));
  const out = JSON.parse(strFromU8(unzipSync(fixed.bytes)["document.json"]));
  const kids = out.pages[0].root.children;
  assert.equal(out.pages[0].w, 5);
  assert.equal(kids.length, 3);
  assert.equal(new Set(kids.map((k) => k.id)).size, 3);
  const ell = kids.find((k) => k.type === "ellipse");
  assert.equal(ell.w, 20);
  assert.equal(ell.h, 100);
  assert.equal(ell.opacity, 1);
  assert.deepEqual(kids.find((k) => k.id === "r3").m, [1, 0, 0, 1, 0, 0]);
});

test("too deeply nested layers are an error; the fix is not a safe one", () => {
  const j = baseJson();
  let cur = j.pages[0].root;
  for (let i = 0; i < 205; i++) {
    const g = node({ id: `g${i}`, type: "group", children: [] });
    cur.children.push(g);
    cur = g;
  }
  const r = diagnoseFile(pack(j), { name: "d.ofini" });
  assert.equal(find(r, "too-deep").fix.safe, false);
  const fixed = repairFile(pack(j), { name: "d.ofini", fixes: "all" });
  assert.ok(!codes(fixed.after).includes("too-deep"));
});

test("dangling references: pictures, stories, master pages and styles", () => {
  const j = baseJson();
  j.pages[0].masterId = "nope";
  j.pages[0].root.children.push(node({ id: "img", type: "image", assetId: "missing", w: 10, h: 10 }), node({ id: "t", type: "text", storyId: "s1", w: null, h: null }), node({ id: "t2", type: "text", storyId: "s2" }));
  j.stories = { s2: { paragraphs: [{ styleId: "ghost", runs: [{ text: "Hi", styleId: "ghost-char", attrs: { fontFamily: "Lora" } }] }] } };
  const r = diagnoseFile(pack(j), { name: "r.ofini" });
  for (const c of ["master-ref", "dangling-asset", "missing-story", "style-ref"]) assert.ok(codes(r).includes(c), c);
  assert.deepEqual(r.info.fonts, ["Lora"]);
  const safe = repairFile(pack(j), { name: "r.ofini" });
  assert.deepEqual(codes(safe.after).filter((c) => c !== "thumbnail-missing"), ["dangling-asset"], "the picture layer is only removed with all fixes");
  const all = repairFile(pack(j), { name: "r.ofini", fixes: "all" });
  assert.equal(all.after.ok, true);
  const out = JSON.parse(strFromU8(unzipSync(all.bytes)["document.json"]));
  assert.equal(out.pages[0].masterId, null);
  assert.ok(out.stories.s1);
  assert.equal(out.stories.s2.paragraphs[0].styleId, undefined);
});

test("orphaned, unused, damaged and oversized stored files", () => {
  const j = baseJson();
  j.assets = [{ id: "a1", mime: "image/png", name: "used.png", w: 2, h: 2 }, { id: "a2", mime: "image/png", name: "unused.png" }, { id: "a3", mime: "image/jpeg", name: "bad.jpg" }];
  j.pages[0].root.children.push(node({ id: "i1", type: "image", assetId: "a1", w: 2, h: 2 }), node({ id: "i3", type: "image", assetId: "a3", w: 2, h: 2 }), node({ id: "px", type: "pixel", w: 2, h: 2 }));
  const extra = { "assets/a1.png": png(), "assets/a2.png": png(), "assets/a3.jpg": strToU8("not a jpeg"), "assets/zz.png": png(), "pixels/px.png": strToU8("broken"), "pixels/old.png": png(), "thumbnail.png": strToU8("nope"), "custom/notes.txt": strToU8("x") };
  const r = diagnoseFile(pack(j, extra), { name: "o.ofini", limits: undefined });
  assert.equal(codes(r).filter((c) => c === "orphan-file").length, 2);
  for (const c of ["asset-unused", "asset-corrupt", "pixels-corrupt", "thumbnail", "unknown-entry"]) assert.ok(codes(r).includes(c), c);
  const safe = repairFile(pack(j, extra), { name: "o.ofini" });
  const names = Object.keys(unzipSync(safe.bytes));
  assert.ok(!names.includes("assets/zz.png") && !names.includes("pixels/old.png") && !names.includes("thumbnail.png"));
  assert.ok(names.includes("assets/a2.png"), "unused assets stay unless all fixes are chosen");
  assert.ok(names.includes("custom/notes.txt"), "unknown parts are kept");
  const pruned = repairFile(pack(j, extra), { name: "o.ofini", fixes: ["prune-unused"] });
  assert.ok(!Object.keys(unzipSync(pruned.bytes)).includes("assets/a2.png"));
});

test("website, Office and Scene parts are checked against their manifests", () => {
  const j = baseJson();
  j.web = { entry: "index.html", files: [{ path: "index.html", mime: "text/html" }, { path: "gone.css", mime: "text/css" }, { path: "../evil", mime: "text/plain" }], settings: {} };
  j.office = {
    kind: "scene",
    media: { m1: { id: "m1", mime: "video/mp4", file: "office/scene/media/m1.mp4" }, m2: { id: "m2", mime: "image/png", file: "office/scene/media/m2.png" } },
    clips: { c1: { id: "c1", type: "comp", comp: "A" }, c2: { id: "c2", type: "video", media: "zz" }, c3: { id: "c3", type: "image", media: "m2" } },
    comps: { A: { id: "A", name: "Comp A", clips: { x: { id: "x", type: "comp", comp: "B" } } }, B: { id: "B", name: "Comp B", clips: { y: { id: "y", type: "comp", comp: "A" } } } },
  };
  const extra = { "web/files/index.html": strToU8("<p>hi</p>"), "web/files/stray.js": strToU8("1"), "office/scene/media/m2.png": png() };
  const r = diagnoseFile(pack(j, extra), { name: "w.ofini" });
  assert.equal(codes(r).filter((c) => c === "web-missing").length, 2);
  for (const c of ["orphan-file", "office-media-missing", "scene-cycle", "scene-ref"]) assert.ok(codes(r).includes(c), c);
  assert.equal(r.info.kind, "scene");
  const fixed = repairFile(pack(j, extra), { name: "w.ofini", fixes: "all" });
  assert.equal(fixed.after.counts.error + fixed.after.counts.warning, 0, reportText(fixed.after));
  const out = JSON.parse(strFromU8(unzipSync(fixed.bytes)["document.json"]));
  assert.deepEqual(out.web.files.map((f) => f.path), ["index.html"]);
  assert.deepEqual(Object.keys(out.office.media), ["m2"]);
});

test("missing structure is filled and a page is added when there is none", () => {
  const j = { format: "openfini", version: 1, name: "x", pages: [], masters: "bad", styles: [] };
  const r = diagnoseFile(pack(j), { name: "s.ofini" });
  assert.ok(codes(r).includes("no-pages") && codes(r).includes("structure"));
  const fixed = repairFile(pack(j), { name: "s.ofini" });
  const out = JSON.parse(strFromU8(unzipSync(fixed.bytes)["document.json"]));
  assert.equal(out.pages.length, 1);
  assert.deepEqual(out.masters, []);
  assert.deepEqual(out.styles, { paragraph: {}, character: {} });
});

test("unsafe entry names are reported and dropped", () => {
  const bytes = pack(baseJson(), { "../escape.txt": strToU8("x") });
  const r = diagnoseFile(bytes, { name: "u.ofini" });
  assert.ok(codes(r).includes("unsafe-names"));
  const fixed = repairFile(bytes, { name: "u.ofini" });
  assert.ok(!Object.keys(unzipSync(fixed.bytes)).some((n) => n.includes("..")));
  assert.equal(safeEntryName("a/../b"), false);
  assert.equal(safeEntryName("C:\\x"), false);
  assert.equal(safeEntryName("assets/a.png"), true);
});

test("other files get a short report: PNG, JPEG, PDF, JSON, SVG, Office ZIPs", () => {
  assert.equal(diagnoseFile(png(), { name: "a.png" }).findings.length, 0);
  const badPng = png().slice(0, 30);
  assert.equal(diagnoseFile(badPng, { name: "a.png" }).findings[0].code, "png-corrupt");
  assert.equal(pngProblem(png()), null);
  assert.equal(diagnoseFile(new Uint8Array([0xff, 0xd8, 1, 2]), { name: "a.jpg" }).findings[0].code, "jpeg-truncated");
  assert.equal(diagnoseFile(strToU8("%PDF-1.7\n..."), { name: "a.pdf" }).findings[0].code, "pdf-truncated");
  assert.equal(diagnoseFile(strToU8("{"), { name: "a.excalidraw" }).findings[0].code, "json-invalid");
  assert.equal(diagnoseFile(strToU8("<html/>"), { name: "a.svg" }).findings[0].code, "svg-invalid");
  const docx = zipSync({ "[Content_Types].xml": strToU8("<x/>"), "word/document.xml": strToU8("<w/>".repeat(200)) });
  assert.equal(diagnoseFile(docx, { name: "a.docx" }).ok, true);
  const cut = docx.subarray(0, docx.length - 30);
  const r = diagnoseFile(cut, { name: "a.docx" });
  assert.equal(r.container, "recovered");
  const fixed = repairFile(cut, { name: "a.docx" });
  assert.equal(diagnoseFile(fixed.bytes, { name: "a.docx" }).ok, true);
  assert.equal(diagnoseFile(strToU8("x"), { name: "a.bin" }).findings[0].code, "not-checked");
});

test("every finding has a known fix and a message template; reports contain no paths", () => {
  const j = baseJson();
  j.pages[0].root.children.push(node({ id: "img", type: "image", assetId: "gone" }));
  const r = diagnoseFile(pack(j), { name: "C:\\Users\\ana\\x.ofini" });
  for (const f of r.findings) {
    assert.ok(f.message.length > 10);
    if (f.fix) assert.equal(FIXES[f.fix.id].label, f.fix.label);
  }
  const text = doctorReport({ app: { version: "1.2.3", platform: "test" }, env: [], doc: r });
  assert.ok(!/image layer image refers/.test(text) || text.includes("…"));
  assert.equal(redactPaths("C:\\Users\\ana\\Documents\\x"), "C:\\Users\\…\\Documents\\x");
  assert.equal(redactPaths("/home/bob/a.ofini"), "/home/…/a.ofini");
  assert.equal(crc32(strToU8("123456789")), 0xcbf43926);
});

test("pages without guides, margins or position get the defaults (views read them without checks)", () => {
  const j = baseJson();
  delete j.pages[0].guides;
  delete j.pages[0].margins;
  j.pages[0].x = null;
  const r = diagnoseFile(pack(j), { name: "g.ofini" });
  assert.match(find(r, "page-fields").params.fields, /x, margins, guides/);
  const out = JSON.parse(strFromU8(unzipSync(repairFile(pack(j), { name: "g.ofini" }).bytes)["document.json"]));
  assert.deepEqual(out.pages[0].guides, { h: [], v: [] });
  assert.equal(out.pages[0].x, 0);
});
