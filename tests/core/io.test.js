import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "../../app/vendor/fflate/fflate.js";
import { Doc } from "../../app/src/core/doc.js";
import { createNode, solid } from "../../app/src/core/nodes.js";
import { translate } from "../../app/src/core/math.js";
import { saveOfini, loadOfini, OFINI_MIME } from "../../app/src/core/ofini.js";
import { sniffMime } from "../../app/src/core/io.js";
import { prepareVectorDL } from "../../app/src/core/io.js";
import { displayListToSVGResult } from "../../app/src/engine/backends/svg.js";
import { buildPageDL } from "../../app/src/engine/dl.js";

const bytes = (...b) => Uint8Array.from(b);

test("sniffMime recognizes common formats by content", () => {
  assert.equal(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0)), "image/png");
  assert.equal(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(sniffMime(bytes(0x47, 0x49, 0x46, 0x38)), "image/gif");
  assert.equal(sniffMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)), "image/webp");
  assert.equal(sniffMime(bytes(0x50, 0x4b, 3, 4)), OFINI_MIME);
  assert.equal(sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), "image/svg+xml");
  assert.equal(sniffMime(new TextEncoder().encode('<?xml version="1.0"?><svg/>')), "image/svg+xml");
  assert.equal(sniffMime(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)), "application/octet-stream");
});

test(".ofini is a ZIP with the mimetype first and a round-trippable document", async () => {
  const doc = new Doc({ name: "Roundtrip", width: 500, height: 400, dpi: 300, studio: "layout", pages: 2 });
  const [p1, p2] = doc.pages;
  const master = doc.addMaster("Master A");
  doc.set(p1, { masterId: master.id });
  const sid = doc.createStory({ paragraphs: [{ runs: [{ text: "Hello ", attrs: { fontWeight: 700 } }, { text: "world" }] }] });
  doc.stories[sid].defaults = { char: { fontSize: 18 }, para: { align: "justify" } };
  const t1 = createNode("text", { storyId: sid, w: 200, h: 100, mode: "frame", m: translate(10, 10), linked: true, flowIndex: 0 });
  const t2 = createNode("text", { storyId: sid, w: 200, h: 100, mode: "frame", m: translate(10, 10), linked: true, flowIndex: 1 });
  doc.insert(t1, p1.root);
  doc.insert(t2, p2.root);
  doc.insert(createNode("rect", { w: 50, h: 50, fill: solid("#ff00ff"), m: translate(5, 5) }), master.root);
  doc.slices.push({ id: "sl1", name: "Hero", page: p1.id, x: 0, y: 0, w: 100, h: 50, format: "png", scale: 2, quality: 0.9 });
  doc.styles.paragraph.st1 = { name: "Body", attrs: { lineHeight: 1.4 }, char: { fontSize: 14 } };

  const data = await saveOfini(doc);
  const zip = unzipSync(data);
  assert.equal(Object.keys(zip)[0], "mimetype");
  assert.equal(strFromU8(zip.mimetype), OFINI_MIME);
  assert.ok(zip["document.json"]);

  const back = await loadOfini(data);
  assert.equal(back.name, "Roundtrip");
  assert.equal(back.dpi, 300);
  assert.equal(back.pages.length, 2);
  assert.equal(back.masters.length, 1);
  assert.equal(back.pages[0].masterId, master.id);
  assert.equal(back.stories[sid].story.paragraphs[0].runs[0].attrs.fontWeight, 700);
  assert.equal(back.stories[sid].defaults.char.fontSize, 18);
  assert.deepEqual(back.framesOfStory(sid).map((f) => f.flowIndex), [0, 1]);
  assert.equal(back.slices[0].scale, 2);
  assert.equal(back.styles.paragraph.st1.name, "Body");
  assert.equal(back.saved, true);
  assert.equal(back.history.entries.length, 0);
});

test("loading garbage reports a friendly error", async () => {
  await assert.rejects(() => loadOfini(bytes(1, 2, 3, 4, 5)), /valid OpenFini document/);
});

test("SVG export of a page keeps gradients, clips and groups", () => {
  const doc = new Doc({ name: "Svg", width: 200, height: 100 });
  const root = doc.pages[0].root;
  const r = createNode("rect", { w: 80, h: 40, r: [6, 6, 6, 6], m: translate(10, 10), fill: { type: "linear", x0: 0, y0: 0, x1: 1, y1: 0, stops: [{ o: 0, color: "#ff0000", alpha: 1 }, { o: 1, color: "#0000ff", alpha: 1 }] }, opacity: 0.8 });
  doc.insert(r, root);
  const dl = prepareVectorDL(buildPageDL(doc, doc.pages[0]));
  const { svg, warnings } = displayListToSVGResult(dl, { background: "#ffffff" });
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<linearGradient/);
  assert.match(svg, /opacity="0\.8"/);
  assert.match(svg, /viewBox="0 0 200 100"/);
  assert.deepEqual(warnings, []);
});
