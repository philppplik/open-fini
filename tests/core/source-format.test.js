// Saving back to the original format: the decision table of canSaveAsSource, text round trips (byte identical,
// BOM, CRLF), Office writers re-reading equal text, and the display helpers. Pure: no browser needed.
import test from "node:test";
import assert from "node:assert/strict";
import { Doc } from "../../app/src/core/doc.js";
import { WebProject } from "../../app/src/core/web.js";
import { OfficeProject } from "../../app/src/core/office.js";
import { createNode } from "../../app/src/core/nodes.js";
import * as M from "../../app/src/engine/office/model.js";
import { importOffice, exportOffice } from "../../app/src/engine/office/index.js";
import { decodeText, encodeText, detectEol, describeSource, canSaveAsSource, saveTarget, displayName, sourceMeta, sourceSnapshot, officeFidelityNotes } from "../../app/src/core/source-format.js";

const enc = (s) => new TextEncoder().encode(s);
const same = (a, b) => assert.deepEqual([...a], [...b]);

function textDoc(name, bytes) {
  const { text, bom, eol } = decodeText(bytes);
  const doc = new Doc({ name: name.replace(/\.[^.]+$/, ""), studio: "code" });
  doc.web = WebProject.fromFiles({ [name]: text }, { entry: name });
  const src = describeSource({ name, bytes }, doc);
  doc.source = { ...src, bom, eol, entry: name, original: bytes, snapshot: text };
  return doc;
}
function officeDoc(name) {
  const doc = new Doc({ name: name.replace(/\.[^.]+$/, ""), studio: "office" });
  doc.office = new OfficeProject(M.createDocument({ title: "T" }));
  doc.source = describeSource({ name }, doc);
  return doc;
}

test("text files round trip byte for byte when unchanged (txt, md, json, empty, no trailing newline, invalid UTF-8)", () => {
  for (const [name, content] of [["notes.txt", "Hello\nWorld\n"], ["README.md", "# Title\n\n- a\n- b\n"], ["data.json", '{"a":1}'], ["empty.txt", ""], ["umlaut.txt", "Grüße – ü\n"]]) {
    const bytes = enc(content);
    const doc = textDoc(name, bytes);
    same(encodeText(doc.web.files.get(name).text, doc.source), bytes);
  }
  const bad = new Uint8Array([0x61, 0xff, 0x62, 0x0a]); // not valid UTF-8: still written back unchanged
  const d = textDoc("bad.txt", bad);
  same(encodeText(d.web.files.get("bad.txt").text, d.source), bad);
});

test("CRLF and the UTF-8 BOM are kept after an edit", () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("one\r\ntwo\r\n")]);
  const doc = textDoc("win.txt", bytes);
  assert.equal(doc.source.eol, "crlf");
  assert.equal(doc.source.bom, true);
  assert.equal(doc.web.files.get("win.txt").text, "one\ntwo\n"); // editors work on LF
  same(encodeText("one\ntwo\nthree\n", doc.source), [0xef, 0xbb, 0xbf, ...enc("one\r\ntwo\r\nthree\r\n")]);
  const plain = textDoc("unix.txt", enc("a\nb\n"));
  same(encodeText("a\nb\nc\n", plain.source), enc("a\nb\nc\n")); // no BOM added, LF stays LF
});

test("detectEol", () => {
  assert.equal(detectEol("a\nb"), "lf");
  assert.equal(detectEol("a\r\nb\r\n"), "crlf");
  assert.equal(detectEol("a\rb"), "cr");
  assert.equal(detectEol("a\r\nb\n"), "mixed");
  assert.equal(detectEol("single line"), "none");
});

test("canSaveAsSource decision table: text", () => {
  const doc = textDoc("notes.txt", enc("hi\n"));
  const ok = canSaveAsSource(doc);
  assert.equal(ok.ok, true);
  assert.equal(ok.label, ".txt");
  assert.equal(ok.name, "notes.txt");
  assert.deepEqual(saveTarget(doc), { label: ".txt", name: "notes.txt", source: true });
  // a second file: only .ofini keeps it
  doc.web.files.set("extra.css", { path: "extra.css", mime: "text/css", text: "a{}" });
  const two = canSaveAsSource(doc);
  assert.equal(two.ok, false);
  assert.equal(two.ask, true);
  assert.match(two.reason, /more than one file/);
  assert.equal(saveTarget(doc).label, ".ofini");
  doc.web.files.delete("extra.css");
  assert.equal(canSaveAsSource(doc).ok, true);
  // a design object on the page
  doc.pages[0].root.children.push(createNode("rect"));
  assert.match(canSaveAsSource(doc).reason, /design pages/);
  doc.pages[0].root.children.length = 0;
  // an attached image asset
  doc.assets.a1 = { id: "a1" };
  assert.match(canSaveAsSource(doc).reason, /images/);
  delete doc.assets.a1;
  // renamed file
  doc.web.files.set("other.txt", doc.web.files.get("notes.txt"));
  doc.web.files.delete("notes.txt");
  assert.match(canSaveAsSource(doc).reason, /renamed/);
});

test("canSaveAsSource: setting off, no source, never-silent formats", () => {
  const doc = textDoc("notes.txt", enc("hi\n"));
  assert.equal(canSaveAsSource(doc, { enabled: false }).ok, false);
  assert.equal(canSaveAsSource(doc, { enabled: false }).ask, false);
  assert.equal(saveTarget(doc, { enabled: false }).label, ".ofini");
  assert.equal(canSaveAsSource(new Doc()).ok, false);
  for (const name of ["photo.png", "photo.jpg", "anim.gif", "art.psd", "file.pdf", "layout.idml"]) {
    const d = new Doc({ studio: "pixel" });
    d.source = describeSource({ name }, d);
    const r = canSaveAsSource(d);
    assert.equal(r.ok, false, name);
    assert.equal(r.ask, false, name); // saved as .ofini without a dialog
    assert.match(r.reason, /Save As/);
    assert.equal(saveTarget(d).label, ".ofini");
  }
  assert.equal(describeSource({ name: "x.ofini" }, new Doc()), null);
});

test("canSaveAsSource: SVG only while it is a plain single-page vector drawing", () => {
  const doc = new Doc({ studio: "vector" });
  doc.source = describeSource({ name: "logo.svg" }, doc);
  assert.equal(doc.source.kind, "vector");
  doc.pages[0].root.children.push(createNode("rect"), createNode("path"));
  assert.equal(canSaveAsSource(doc).ok, true);
  const fx = createNode("ellipse");
  fx.fx = [{ type: "blur", radius: 4 }];
  doc.pages[0].root.children.push(fx);
  assert.match(canSaveAsSource(doc).reason, /effects/);
  doc.pages[0].root.children.pop();
  doc.pages[0].root.children.push(createNode("pixel"));
  assert.match(canSaveAsSource(doc).reason, /pixel layers/);
  doc.pages[0].root.children.pop();
  const blend = createNode("rect");
  blend.blend = "multiply";
  doc.pages[0].root.children.push(blend);
  assert.match(canSaveAsSource(doc).reason, /blend/);
  doc.pages[0].root.children.pop();
  doc.pages.push(doc.pages[0]);
  assert.match(canSaveAsSource(doc).reason, /more than one page/);
});

test("canSaveAsSource: office documents are always written through the Office writers", () => {
  for (const [name, id] of [["a.docx", "docx"], ["a.odt", "odt"], ["a.rtf", "rtf"], ["a.html", "html"], ["a.md", "md"], ["a.txt", "txt"]]) {
    const doc = officeDoc(name);
    assert.equal(doc.source.kind, "office");
    assert.equal(doc.source.officeId, id);
    const r = canSaveAsSource(doc);
    assert.equal(r.ok, true, name);
    assert.equal(r.name, name);
  }
  // templates and macro-enabled files are never overwritten by a plain document: they have no source and stay .ofini
  assert.equal(officeDoc("t.dotx").source, null);
  assert.equal(officeDoc("t.docm").source, null);
  assert.equal(canSaveAsSource(officeDoc("t.dotx")).ok, false);
  // spelling variants keep their name
  assert.equal(canSaveAsSource(officeDoc("a.markdown")).name, "a.markdown");
});

test("Office round trip: docx, odt, rtf, html, md, txt written by the Office writer re-read to the same text", () => {
  const model = M.createDocument({ title: "Doc" });
  model.blocks = [M.heading(1, "Quarterly report"), M.para("First paragraph with ümlauts."), M.para("Second paragraph.")];
  for (const id of ["docx", "odt", "rtf", "html", "md", "txt"]) {
    const out = exportOffice(model, id, {});
    const back = importOffice(`x.${out.ext}`, out.bytes, {}).doc;
    const text = (d) => d.blocks.filter((b) => b.type === "paragraph").map((b) => M.paraText(b).trim()).filter(Boolean).join("|");
    assert.equal(text(back), text(model), id);
  }
});

test("office fidelity notes list what the target format cannot store", () => {
  const model = M.createDocument();
  model.blocks = [M.para([{ text: "bold", b: true }])];
  assert.deepEqual(officeFidelityNotes(model, "docx"), []);
  assert.match(officeFidelityNotes(model, "txt").join(" "), /Formatting/);
  model.header = [M.para("Header")];
  assert.match(officeFidelityNotes(model, "md").join(" "), /Headers and footers/);
  assert.deepEqual(officeFidelityNotes(null, "txt"), []);
});

test("display helpers: tab name, ofini metadata, session snapshot", () => {
  const doc = textDoc("notes.txt", enc("hi\n"));
  assert.equal(displayName(doc), "notes.txt");
  assert.equal(displayName(doc, { enabled: false }), "notes");
  assert.deepEqual(sourceMeta(doc), { name: "notes.txt", format: "txt" });
  assert.deepEqual(JSON.parse(JSON.stringify(doc.toJSON())).source, { name: "notes.txt", format: "txt" });
  const snap = sourceSnapshot(doc.source);
  assert.equal(snap.original, undefined);
  assert.equal(snap.handle, undefined);
  doc.source = null;
  assert.equal(displayName(doc), "notes");
  assert.equal(JSON.parse(JSON.stringify(doc.toJSON())).source, undefined);
});
