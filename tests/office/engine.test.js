// Office Studio engine: model editing, styles, tables, and the DOCX / ODT / RTF / HTML / Markdown / text / PDF codecs.
import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "../../app/vendor/fflate/fflate.js";
import * as M from "../../app/src/engine/office/model.js";
import { readDocx, writeDocx } from "../../app/src/engine/office/docx.js";
import { readOdt, writeOdt } from "../../app/src/engine/office/odt.js";
import { readRtf, writeRtf } from "../../app/src/engine/office/rtf.js";
import { readHtml, writeHtml } from "../../app/src/engine/office/html.js";
import { readMarkdown, writeMarkdown, readText, writeText } from "../../app/src/engine/office/markdown.js";
import { exportPdf, layoutPages, listLabel } from "../../app/src/engine/office/pdf.js";
import { readZip, safeEntryName } from "../../app/src/engine/office/zip.js";
import { parseXml, textOf } from "../../app/src/engine/office/xml.js";
import { detectOfficeFormat, parseGdoc, officeGuidance, importOffice, exportOffice, FORMATS } from "../../app/src/engine/office/index.js";
import { imageSize, sniffImage, parseDataUri, toBase64, fromBase64 } from "../../app/src/engine/office/media.js";
import { OfficeProject } from "../../app/src/core/office.js";

// a real 2 x 1 PNG (red, blue)
const PNG = fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DwH4QZGAAg+wP9bBlRXwAAAABJRU5ErkJggg==");

function sample() {
  const d = M.createDocument({ title: "Sample" });
  d.media.img1 = { id: "img1", mime: "image/png", name: "dot.png", bytes: PNG, w: 2, h: 1 };
  d.footnotes.f1 = [M.para("The footnote text.")];
  const table = M.createTable(3, 3, 450, { header: true });
  table.rows[0].cells[0].blocks = [M.para("Name")];
  table.rows[0].cells[1].blocks = [M.para("Value")];
  table.rows[1].cells[0].blocks = [M.para("Alpha")];
  table.rows[1].cells[2].shading = "#ffeeaa";
  const merged = M.tableMerge(table, 2, 0, 2, 1);
  d.blocks = [
    M.para("Report Title", "Title"),
    M.heading(1, "Introduction"),
    M.para([{ text: "Bold ", b: true }, { text: "italic ", i: true }, { text: "under ", u: true }, { text: "strike ", s: true }, { text: "red", color: "#ff0000" }, { text: " H" }, { text: "2", va: "sub" }, { text: "O x" }, { text: "2", va: "super" }, { text: " link", link: "https://example.com/a?b=1&c=2" }, { type: "footnote", id: "f1" }]),
    M.para([{ text: "Centered, big", size: 16, font: "Georgia", highlight: "#ffff00" }], "Normal", { props: { align: "center", spaceBefore: 12, spaceAfter: 6, indentLeft: 18 } }),
    M.para("First bullet", "List", { list: { kind: "bullet", level: 0, id: "b1" } }),
    M.para("Nested bullet", "List", { list: { kind: "bullet", level: 1, id: "b1" } }),
    M.para("Step one", "List", { list: { kind: "number", level: 0, id: "n1" } }),
    M.para("Step two", "List", { list: { kind: "number", level: 0, id: "n1" } }),
    merged,
    M.para([{ text: "Picture: " }, { type: "image", media: "img1", width: 60, height: 30, alt: "Two dots" }]),
    M.para("Quoted words", "Quote"),
    M.para([{ text: "line one" }, { type: "break" }, { text: "line two" }]),
    { type: "rule" },
    { type: "pageBreak" },
    M.heading(2, "Ünïcödé — “quotes” & <tags> 你好 😀"),
    M.para("End."),
  ];
  d.header = [M.para("Sample header")];
  d.footer = [M.para([{ text: "Page " }, { type: "field", field: "page" }, { text: " of " }, { type: "field", field: "pages" }])];
  return M.normalizeDoc(d);
}

const texts = (doc) => doc.blocks.map((b) => (b.type === "paragraph" ? M.paraText(b) : b.type));
const findPara = (doc, t) => doc.blocks.find((b) => b.type === "paragraph" && M.paraText(b).includes(t));

function checkCommon(back, label, { pageBreak = true } = {}) {
  const src = sample();
  const bodyText = (d) => d.blocks.filter((b) => b.type === "paragraph").map((b) => M.paraText(b).replace(/\uFFFC/g, "")).join("\n");
  for (const t of ["Report Title", "Introduction", "First bullet", "Nested bullet", "Step two", "Quoted words", "End.", "你好"]) assert.ok(bodyText(back).includes(t), `${label}: lost “${t}”`);
  assert.equal(M.headingLevel(back, findPara(back, "Introduction")), 1, `${label}: heading level`);
  const rich = findPara(back, "Bold");
  const run = (t) => rich.runs.find((r) => r.text && r.text.includes(t));
  assert.ok(run("Bold").b, `${label}: bold`);
  assert.ok(run("italic").i, `${label}: italic`);
  assert.ok(run("under").u, `${label}: underline`);
  assert.ok(run("strike").s, `${label}: strike`);
  assert.equal(run("red").color, "#ff0000", `${label}: color`);
  assert.equal(rich.runs.find((r) => r.va === "sub")?.text, "2", `${label}: subscript`);
  assert.equal(rich.runs.find((r) => r.va === "super")?.text, "2", `${label}: superscript`);
  assert.equal(run("link").link, "https://example.com/a?b=1&c=2", `${label}: link`);
  const fn = rich.runs.find((r) => r.type === "footnote");
  assert.ok(fn, `${label}: footnote reference`);
  assert.match(M.paraText(back.footnotes[fn.id][0]), /The footnote text\./, `${label}: footnote text`);
  const nested = findPara(back, "Nested bullet");
  assert.deepEqual([nested.list?.kind, nested.list?.level], ["bullet", 1], `${label}: nested bullet`);
  const step = findPara(back, "Step two");
  assert.equal(step.list?.kind, "number", `${label}: numbered list`);
  assert.equal(findPara(back, "Step one").list.id, step.list.id, `${label}: one list`);
  const t = back.blocks.find((b) => b.type === "table");
  assert.ok(t, `${label}: table`);
  assert.equal(t.cols.length, 3, `${label}: table columns`);
  assert.equal(t.rows.length, 3, `${label}: table rows`);
  assert.equal(t.rows[2].cells[0].colspan, 2, `${label}: merged cell`);
  assert.equal(M.paraText(t.rows[1].cells[0].blocks[0]), "Alpha", `${label}: cell text`);
  assert.equal(t.rows[1].cells[2].shading, "#ffeeaa", `${label}: cell shading`);
  const img = back.blocks.flatMap((b) => (b.type === "paragraph" ? b.runs : [])).find((r) => r.type === "image");
  assert.ok(img, `${label}: image`);
  assert.deepEqual([Math.round(img.width), Math.round(img.height)], [60, 30], `${label}: image size`);
  assert.deepEqual([...back.media[img.media].bytes], [...PNG], `${label}: image bytes`);
  const lb = findPara(back, "line one");
  assert.ok(lb.runs.some((r) => r.type === "break"), `${label}: line break`);
  if (pageBreak) assert.ok(back.blocks.some((b) => b.type === "pageBreak"), `${label}: page break`);
  assert.equal(findPara(back, "Quoted").style, "Quote", `${label}: Quote style`);
  void src;
}

test("model: typing, Enter, Backspace, Delete and ranges", () => {
  let d = M.createDocument();
  let r = M.insertText(d, { path: [0], offset: 0 }, "Hello world", { b: true });
  assert.equal(M.paraText(r.doc.blocks[0]), "Hello world");
  assert.equal(r.pos.offset, 11);
  r = M.splitParagraph(r.doc, { path: [0], offset: 5 });
  assert.deepEqual(texts(r.doc), ["Hello", " world"]);
  assert.deepEqual(r.pos, { path: [1], offset: 0 });
  r = M.joinBackward(r.doc, [1]);
  assert.deepEqual(texts(r.doc), ["Hello world"]);
  assert.equal(r.pos.offset, 5);
  r = M.insertText(r.doc, { path: [0], offset: 11 }, "\nsecond\nthird");
  assert.deepEqual(texts(r.doc), ["Hello world", "second", "third"]);
  r = M.deleteRange(r.doc, { path: [0], offset: 5 }, { path: [2], offset: 2 });
  assert.deepEqual(texts(r.doc), ["Helloird"]);
  r = M.joinForward(M.insertText(r.doc, { path: [0], offset: 8 }, "\nX").doc, [0]);
  assert.deepEqual(texts(r.doc), ["HelloirdX"]);
  // marks of the typed text follow the text before the caret
  d = r.doc;
  d = M.formatRange(d, { path: [0], offset: 0 }, { path: [0], offset: 5 }, { i: true });
  assert.ok(M.rangeHasMark(d.blocks[0].runs, 0, 5, "i"));
  assert.ok(!M.rangeHasMark(d.blocks[0].runs, 0, 9, "i"));
  d = M.formatRange(d, { path: [0], offset: 0 }, { path: [0], offset: 5 }, { i: null });
  assert.ok(!M.rangeHasMark(d.blocks[0].runs, 0, 5, "i"));
  assert.deepEqual(M.marksAt(d.blocks[0].runs, 3), { b: true });
  // immutability: the old document is untouched
  assert.equal(M.paraText(M.createDocument().blocks[0]), "");
});

test("model: lists, indent, headings next style, outline and stats", () => {
  let d = M.createDocument();
  d = M.insertText(d, { path: [0], offset: 0 }, "a\nb\nc").doc;
  d = M.toggleList(d, { path: [0], offset: 0 }, { path: [2], offset: 1 }, "number");
  assert.ok(d.blocks.every((b) => b.list?.kind === "number"));
  assert.equal(new Set(d.blocks.map((b) => b.list.id)).size, 1);
  d = M.indentParagraphs(d, { path: [1], offset: 0 }, { path: [1], offset: 0 }, 1);
  assert.equal(d.blocks[1].list.level, 1);
  d = M.toggleList(d, { path: [0], offset: 0 }, { path: [2], offset: 0 }, "number");
  assert.ok(d.blocks.every((b) => !b.list));
  // Enter at the end of a heading continues with Normal; Enter in an empty list item leaves the list
  let h = M.createDocument();
  h.blocks = [M.heading(2, "Title")];
  const s = M.splitParagraph(h, { path: [0], offset: 5 });
  assert.equal(s.doc.blocks[1].style, "Normal");
  const li = M.normalizeDoc({ blocks: [M.para("", "List", { list: { kind: "bullet", level: 0 } })] });
  assert.equal(M.splitParagraph(li, { path: [0], offset: 0 }).doc.blocks[0].list, undefined);
  h = M.normalizeDoc({ blocks: [M.heading(1, "A"), M.para("text here"), M.heading(3, "B")] });
  assert.deepEqual(M.outline(h).map((o) => [o.level, o.text]), [[1, "A"], [3, "B"]]);
  assert.equal(M.stats(h).words, 4);
});

test("model: style inheritance resolves basedOn chains and survives cycles", () => {
  const d = M.createDocument();
  d.styles.Base = { name: "Base", type: "paragraph", basedOn: "Normal", para: { spaceAfter: 20 }, run: { color: "#112233" } };
  d.styles.Child = { name: "Child", type: "paragraph", basedOn: "Base", para: { align: "center" }, run: { b: true } };
  const n = M.normalizeDoc(d);
  const st = M.resolveStyle(n, "Child");
  assert.equal(st.run.font, "Calibri");
  assert.equal(st.run.color, "#112233");
  assert.equal(st.run.b, true);
  assert.equal(st.para.spaceAfter, 20);
  assert.equal(st.para.align, "center");
  n.styles.Base.basedOn = "Child"; // cycle
  assert.ok(M.resolveStyle(n, "Child").run.b);
  const p = M.para([{ text: "x", color: "#00ff00" }], "Child", { props: { align: "right" } });
  assert.equal(M.effectivePara(n, p).align, "right");
  assert.equal(M.effectiveRun(n, p, p.runs[0]).color, "#00ff00");
});

test("model: tables insert/delete rows and columns, merge and split keep the grid rectangular", () => {
  let t = M.createTable(3, 3);
  t = M.tableMerge(t, 0, 0, 1, 1);
  const g = M.tableGrid(t);
  assert.equal(g[1][1].r, 0);
  assert.equal(t.rows[0].cells[0].rowspan, 2);
  assert.equal(t.rows[0].cells[0].colspan, 2);
  t = M.tableInsertRow(t, 0, true); // inside the merged block: the span grows
  assert.equal(t.rows.length, 4);
  assert.equal(t.rows[0].cells[0].rowspan, 3);
  t = M.tableInsertCol(t, 2, true);
  assert.equal(t.cols.length, 4);
  for (const row of M.tableGrid(t)) assert.ok(row.every(Boolean), "no holes");
  t = M.tableDeleteRow(t, 0);
  assert.equal(t.rows[0].cells[0].rowspan, 2);
  t = M.tableDeleteCol(t, 0);
  assert.equal(t.rows[0].cells[0].colspan || 1, 1);
  t = M.tableSplit(M.tableMerge(t, 0, 0, 0, 1), 0, 0);
  for (const row of M.tableGrid(t)) assert.ok(row.every((x) => x && x.colspan === 1));
  assert.equal(M.tableDeleteRow(M.createTable(1, 2), 0), null);
});

test("model: find and replace (plain, whole word, regex groups)", () => {
  let d = M.normalizeDoc({ blocks: [M.para("The cat sat on the mat."), M.para("Concatenate THE cat")] });
  assert.equal(M.findMatches(d, "cat").length, 3);
  assert.equal(M.findMatches(d, "cat", { wholeWord: true }).length, 2);
  assert.equal(M.findMatches(d, "the", { caseSensitive: true }).length, 1);
  assert.equal(M.findMatches(d, "(", { regex: true }).length, 0, "bad regex is no match, no throw");
  d = M.replaceMatches(d, M.findMatches(d, "cat", { wholeWord: true }), "dog");
  assert.deepEqual(texts(d), ["The dog sat on the mat.", "Concatenate THE dog"]);
  const re = M.findMatches(d, "(\\w+)at\\b", { regex: true });
  d = M.replaceMatches(d, re, "[$1]", { query: "(\\w+)at\\b", regex: true });
  assert.equal(M.paraText(d.blocks[0]), "The dog [s] on the [m].");
});

test("model: normalizeDoc cleans hostile and malformed input", () => {
  const d = M.normalizeDoc({ blocks: [{ type: "paragraph", runs: [{ text: "a\u0000b\nc", link: "javascript:alert(1)", color: "red", size: 1e9, font: 'x";}<y' }, { type: "image", media: "nope" }, null, 7] }, { type: "evil" }, "x"], styles: { "../x": {}, Normal: { basedOn: "Normal" } }, page: { width: -5, margins: { top: 1e9 } }, media: { a: { mime: "text/html", bytes: new Uint8Array(1) } } });
  assert.equal(d.blocks.length, 1);
  const r = d.blocks[0].runs[0];
  assert.equal(r.text, "ab c");
  assert.equal(r.link, undefined);
  assert.equal(r.color, "#ff0000");
  assert.equal(r.size, 1638);
  assert.ok(!/["<>;]/.test(r.font));
  assert.equal(d.blocks[0].runs.length, 1);
  assert.ok(!d.styles["../x"]);
  assert.equal(d.page.width, 72);
  assert.equal(d.page.margins.top, 1440);
  assert.deepEqual(Object.keys(d.media), []);
  assert.doesNotThrow(() => M.normalizeDoc(null));
  assert.doesNotThrow(() => M.normalizeDoc("nonsense"));
});

test("DOCX: write → read round trip keeps text, formatting, lists, tables, images, footnotes, header/footer", () => {
  const bytes = writeDocx(sample());
  const { doc, report } = readDocx(bytes, { name: "sample.docx" });
  checkCommon(doc, "docx");
  assert.equal(doc.page.size, "A4");
  assert.ok(doc.footer[0].runs.some((r) => r.type === "field" && r.field === "page"));
  assert.equal(M.paraText(doc.header[0]), "Sample header");
  assert.equal(doc.meta.title, "Sample");
  assert.equal(findPara(doc, "Centered").props.align, "center");
  assert.equal(findPara(doc, "Centered").runs[0].font, "Georgia");
  assert.equal(findPara(doc, "Centered").runs[0].highlight, "#ffff00");
  assert.ok(report.items.some((i) => i.status === "kept"));
  // the package declares every part it contains
  const { entries } = readZip(bytes);
  const ct = new TextDecoder().decode(entries["[Content_Types].xml"]);
  for (const p of ["word/document.xml", "word/styles.xml", "word/numbering.xml", "word/footnotes.xml", "word/footer1.xml"]) assert.ok(ct.includes(`/${p}`), p);
  assert.ok(ct.includes('Extension="png"'));
  const xml = new TextDecoder().decode(entries["word/document.xml"]);
  assert.ok(xml.includes("&lt;tags&gt;") && xml.includes("&amp;"), "XML is escaped");
  assert.doesNotThrow(() => parseXml(xml));
});

test("DOCX: reads documents written by other tools (complex fields, vMerge, styles with numbering)", () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Head</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>styled bullet</w:t></w:r></w:p>
    <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://openfini.example/" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>site</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:ins><w:r><w:t xml:space="preserve"> added</w:t></w:r></w:ins><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>
    <w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
      <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>tall</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b1</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>b2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>x</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>y</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const styles = `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style></w:styles>`;
  const numbering = `<w:numbering ${W}><w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num></w:numbering>`;
  const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
  const bytes = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(document), "word/styles.xml": strToU8(styles), "word/numbering.xml": strToU8(numbering), "word/_rels/document.xml.rels": strToU8(rels) });
  const { doc, report } = readDocx(bytes);
  assert.equal(M.headingLevel(doc, doc.blocks[0]), 2);
  assert.equal(doc.blocks[1].list?.kind, "bullet");
  const p = doc.blocks[2];
  assert.equal(p.runs.find((r) => r.text === "site").link, "https://openfini.example/");
  assert.equal(M.paraText(p), "site added");
  assert.ok(report.items.some((i) => i.status === "dropped" && /deletions/.test(i.text)));
  const t = doc.blocks[3];
  assert.equal(t.rows[0].cells[0].rowspan, 2);
  assert.equal(t.rows[1].cells.length, 1);
  assert.deepEqual(doc.blocks.slice(4, 7).map((b) => b.type), ["paragraph", "pageBreak", "paragraph"]);
  assert.equal(doc.page.size, "Letter");
  assert.equal(M.resolveStyle(doc, "Normal").run.font, "Arial");
  assert.equal(M.resolveStyle(doc, "Normal").run.size, 12);
});

test("ODT: write → read round trip", () => {
  const bytes = writeOdt(sample());
  const { entries } = readZip(bytes);
  assert.equal(new TextDecoder().decode(entries.mimetype), "application/vnd.oasis.opendocument.text");
  // mimetype must be the first entry and stored (uncompressed)
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 38)), "mimetype");
  assert.equal(bytes[8] | (bytes[9] << 8), 0, "stored");
  const { doc } = readOdt(bytes);
  checkCommon(doc, "odt");
  assert.ok(doc.footer[0].runs.some((r) => r.type === "field" && r.field === "pages"));
  assert.ok(doc.blocks.some((b) => b.type === "rule"));
  assert.equal(findPara(doc, "Centered").props.align, "center");
});

test("RTF: write → read round trip, Unicode escapes and code pages", () => {
  const rtf = writeRtf(sample());
  assert.ok(/^\{\\rtf1/.test(rtf));
  assert.ok(!/[^\x00-\x7f]/.test(rtf), "RTF output is 7-bit");
  const { doc } = readRtf(rtf);
  checkCommon(doc, "rtf");
  assert.ok(M.paraText(findPara(doc, "Ünïcödé")).includes("😀"));
  const legacy = readRtf("{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 caf\\'e9 \\u8364? end\\par}").doc;
  assert.equal(M.paraText(legacy.blocks[0]), "café € end");
});

test("HTML: export is clean and semantic, import is sanitized", () => {
  const html = writeHtml(sample());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<h1 class="s-Heading1">Introduction<\/h1>/);
  assert.match(html, /<ul><li class="s-List">First bullet<ul><li class="s-List">Nested bullet<\/li><\/ul><\/li><\/ul>/);
  assert.match(html, /<img src="data:image\/png;base64,/);
  assert.match(html, /colspan="2"/);
  assert.match(html, /&lt;tags&gt;/);
  const { doc } = readHtml(html);
  checkCommon(doc, "html");
  const evil = readHtml('<p onclick="x()">Hi<script>alert(1)</script><a href="javascript:alert(2)">bad</a><img src="https://tracker.example/p.gif" onerror="y()"><iframe src="x"></iframe><style>p{}</style></p><p style="color:rgb(0,128,0);font-weight:bold">green</p>');
  const all = JSON.stringify(evil.doc.blocks);
  assert.ok(!/alert|javascript|tracker|onclick/.test(all));
  assert.equal(evil.doc.blocks[0].runs.map((r) => r.text).join(""), "Hibad");
  assert.deepEqual([evil.doc.blocks[1].runs[0].color, evil.doc.blocks[1].runs[0].b], ["#008000", true]);
  assert.ok(evil.report.items.some((i) => i.status === "dropped"));
});

test("Markdown: export and import", () => {
  const md = writeMarkdown(sample());
  assert.match(md, /^# Report Title/m);
  assert.match(md, /^# Introduction/m);
  assert.match(md, /\*\*Bold\*\*/);
  assert.match(md, /^- First bullet$/m);
  assert.match(md, /^ {3}- Nested bullet$/m);
  assert.match(md, /^2\. Step two$/m);
  assert.match(md, /\| Name \| Value \|/);
  assert.match(md, /\[\^1\]: The footnote text\./);
  assert.match(md, /\\<tags\\>/);
  const { doc } = readMarkdown(md);
  assert.equal(M.headingLevel(doc, findPara(doc, "Introduction")), 1);
  assert.equal(findPara(doc, "Nested bullet").list.level, 1);
  assert.ok(findPara(doc, "Bold").runs.find((r) => r.text?.startsWith("Bold")).b);
  assert.ok(doc.blocks.some((b) => b.type === "table"));
  assert.ok(findPara(doc, "Bold").runs.some((r) => r.type === "footnote"));
  assert.equal(M.paraText(findPara(doc, "<tags>")).includes("<tags>"), true);
});

test("plain text import and export", () => {
  const { doc } = readText("one\r\ntwo\fthree");
  assert.deepEqual(texts(doc), ["one", "two", "pageBreak", "three"]);
  const t = writeText(sample());
  assert.match(t, /^• First bullet$/m);
  assert.match(t, /^ {4}• Nested bullet$/m);
  assert.match(t, /^2\. Step two$/m);
  assert.match(t, /Name\tValue/);
});

test("PDF: pages, headers/footers with page numbers, valid file", () => {
  const d = sample();
  d.blocks.push(...Array.from({ length: 80 }, (_, i) => M.para(`Paragraph ${i} ${"lorem ipsum dolor sit amet ".repeat(6)}`)));
  const pages = layoutPages(d);
  assert.ok(pages.length >= 3);
  const footerText = (p) => p.items.filter((it) => it.t === "text").flatMap((it) => it.runs).map((r) => r.text).join(" ");
  assert.match(footerText(pages[1]), new RegExp(`2\\s*of\\s*${pages.length}`));
  for (const p of pages) for (const it of p.items) if (it.t === "text") for (const r of it.runs) assert.ok(r.y <= p.height && r.y >= 0, "text inside the page");
  const pdf = exportPdf(d, { creationDate: new Date(0) });
  const s = new TextDecoder("latin1").decode(pdf);
  assert.ok(s.startsWith("%PDF-1.7"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  assert.equal((s.match(/\/Type \/Page\b/g) || []).length, pages.length);
  assert.equal(listLabel("number", 1, 28), "ab.");
  assert.equal(listLabel("number", 2, 14), "xiv.");
});

test("zip safety: traversal names, bombs, garbage", () => {
  assert.ok(safeEntryName("word/document.xml"));
  for (const bad of ["../evil", "/abs", "C:\\x", "a/../../b", "a\\b", ""]) assert.ok(!safeEntryName(bad), bad);
  const z = zipSync({ "../evil.txt": strToU8("x"), "ok.txt": strToU8("y"), "big.bin": new Uint8Array(2 * 1024 * 1024) });
  const r = readZip(z, { limits: { maxEntryBytes: 1024 * 1024 } });
  assert.deepEqual(Object.keys(r.entries), ["ok.txt"]);
  assert.ok(r.problems.some((p) => /unsafe/.test(p)) && r.problems.some((p) => /big\.bin/.test(p)));
  const total = readZip(zipSync({ a: new Uint8Array(600), b: new Uint8Array(600) }), { limits: { maxTotalBytes: 1000 } });
  assert.deepEqual(Object.keys(total.entries), ["a"]);
  assert.equal(readZip(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9])).ok, false);
});

test("hostile inputs never throw uncaught errors (only clean Error messages)", () => {
  const rnd = (n, seed) => {
    const out = new Uint8Array(n);
    let x = seed;
    for (let i = 0; i < n; i++) out[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
    return out;
  };
  const good = writeDocx(sample());
  const odt = writeOdt(sample());
  const cases = [new Uint8Array(0), rnd(500, 1), good.subarray(0, good.length >> 1), odt.subarray(0, 900), zipSync({ "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>unclosed") }), zipSync({ "word/document.xml": strToU8("<".repeat(5000) + "w:p>".repeat(3000)) })];
  for (const [k, b] of cases.entries()) {
    for (const fn of [readDocx, readOdt]) {
      try {
        const r = fn(b);
        assert.ok(r.doc.blocks.length >= 1, `case ${k}`);
      } catch (err) {
        assert.ok(err instanceof Error && err.message.length > 5, `case ${k}: ${err}`);
      }
    }
  }
  assert.equal(M.paraText(readDocx(cases[4]).doc.blocks[0]), "unclosed");
  const deep = "<a>".repeat(5000) + "x";
  assert.doesNotThrow(() => parseXml(deep));
  assert.ok(textOf(parseXml(deep)).includes("x"));
  // billion laughs: entities are never expanded
  const lol = '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><r>&b;</r>';
  assert.equal(textOf(parseXml(lol)), "&b;");
  for (const s of ["{\\rtf1 " + "{".repeat(10000) + "x", "{\\rtf1\\u99999999999? \\'zz \\bin999999 x", "{\\rtf1{\\pict\\pngblip zz}}", "{\\rtf1\\trowd\\cellx-5 a\\cell\\row}"]) {
    const r = readRtf(s);
    assert.ok(r.doc.blocks.length >= 1);
  }
  assert.throws(() => readRtf("not rtf"), /not an RTF/);
  assert.doesNotThrow(() => readHtml("<table><tr><td><table><tr><td>" + "<div>".repeat(3000)));
  assert.doesNotThrow(() => readMarkdown("#".repeat(10000) + "\n" + "> ".repeat(2000) + "x"));
});

test("format detection, Google Docs pointers and guidance", () => {
  assert.equal(detectOfficeFormat("a.docx", writeDocx(sample())).id, "docx");
  assert.equal(detectOfficeFormat("renamed.zip", writeDocx(sample())).id, "docx");
  assert.equal(detectOfficeFormat("x.odt", writeOdt(sample())).id, "odt");
  assert.equal(detectOfficeFormat("x.txt", strToU8("{\\rtf1 hi}")).id, "rtf");
  assert.equal(detectOfficeFormat("old.doc", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])).id, "doc");
  assert.equal(detectOfficeFormat("data.xlsx", zipSync({ "xl/workbook.xml": strToU8("<x/>") })).kind, "spreadsheet");
  assert.equal(detectOfficeFormat("deck.pptx").kind, "presentation");
  assert.equal(detectOfficeFormat("a.ofini", zipSync({ "document.json": strToU8("{}") })), null);
  const g = parseGdoc(strToU8(JSON.stringify({ url: "https://docs.google.com/document/d/abc123def456/edit", doc_id: "abc123def456" })), "Plan.gdoc");
  assert.equal(g.url, "https://docs.google.com/document/d/abc123def456/edit");
  assert.equal(parseGdoc(strToU8(JSON.stringify({ url: "javascript:alert(1)", doc_id: "abc123def456xyz" })), "x.gdoc").url, "https://docs.google.com/document/d/abc123def456xyz/edit");
  assert.equal(parseGdoc(strToU8("garbage"), "x.gdoc").url, null);
  const info = officeGuidance(detectOfficeFormat("Plan.gdoc"), { name: "Plan.gdoc", bytes: strToU8(JSON.stringify({ doc_id: "abc123def456" })) });
  assert.match(info.steps.join(" "), /File ▸ Download ▸ Microsoft Word \(\.docx\)/);
  assert.match(officeGuidance(detectOfficeFormat("a.csv")).steps[0], /Layout/);
  assert.match(officeGuidance(detectOfficeFormat("a.doc")).title, /97-2003/);
  assert.match(officeGuidance(detectOfficeFormat("a.pages")).steps[0], /Export To ▸ Word/);
  assert.ok(FORMATS.every((f) => f.ext.length));
});

test("importOffice / exportOffice dispatch every readable and writable format", () => {
  for (const id of ["docx", "odt", "rtf", "html", "md", "txt"]) {
    const out = exportOffice(sample(), id);
    assert.ok(out.bytes.length > 50, id);
    const back = importOffice(`file.${out.ext}`, out.bytes);
    assert.equal(back.format.id, id);
    assert.ok(back.doc.blocks.some((b) => b.type === "paragraph" && M.paraText(b).includes("First bullet")), id);
  }
});

test("media helpers", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.deepEqual(imageSize(PNG), { w: 2, h: 1 });
  assert.deepEqual(imageSize(strToU8('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" width="80">')), { w: 80, h: 40 });
  assert.deepEqual([...fromBase64(toBase64(PNG))], [...PNG]);
  assert.equal(parseDataUri(`data:image/png;base64,${toBase64(PNG)}`).mime, "image/png");
  assert.equal(parseDataUri("data:text/html,<script>"), null);
});

test(".ofini: the office model round-trips through the manifest with images as separate entries", () => {
  const prj = new OfficeProject(sample());
  const man = JSON.parse(JSON.stringify(prj.manifest()));
  assert.ok(!JSON.stringify(man).includes("bytes"));
  const entries = prj.entries();
  assert.deepEqual(Object.keys(entries), ["office/media/img1.png"]);
  const back = OfficeProject.fromManifest(man, entries);
  const doc = M.normalizeDoc(back.model);
  assert.deepEqual([...doc.media.img1.bytes], [...PNG]);
  assert.equal(doc.blocks.length, sample().blocks.length);
});
