// Presentation depth: list levels, mixed font and size, the automatic date field, native charts in PowerPoint and
// OpenDocument files (docs/office-slides.md).
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/office/slides/model.js";
import { layoutText } from "../../app/src/office/slides/render.js";
import { readPptx, writePptx } from "../../app/src/office/slides/pptx.js";
import { readOdp, writeOdp } from "../../app/src/office/slides/odp.js";
import { pptxChartXml, readPptxChart, odfChartXml, readOdfChart } from "../../app/src/office/slides/chart-xml.js";
import { parseXml } from "../../app/src/engine/office/xml.js";
import { readZip, text as zipText } from "../../app/src/engine/office/zip.js";
import { ImportReport } from "../../app/src/core/import-report.js";
import { OfficeProject } from "../../app/src/core/office.js";
import { slidesTools } from "../../app/src/vibe/tools/office-slides.js";

const measure = (font, text) => String(text).length * font.size * 0.5;
const deckWithBody = (text, extra = {}) => {
  let d = M.createDeck({ template: "blank" });
  const r = M.addSlide(d, { layout: "title-content" });
  d = r.deck;
  const s = M.slideById(d, r.id);
  const body = s.elements.find((e) => e.ph === "body");
  d = M.updateElements(d, s.id, [body.id], { text, ...extra });
  return { d, sid: s.id, id: body.id, el: () => M.slideById(d, s.id).elements.find((e) => e.id === body.id) };
};

test("list levels: normalize, follow edits, change by selection, tabs", () => {
  assert.deepEqual(M.normLevels([0, 2, 0, 0], "a\nb\nc\nd"), [0, 2]);
  assert.deepEqual(M.normLevels([12, -1], "a\nb"), [8]);
  let { d, sid, id } = deckWithBody("One\nTwo\nThree", { levels: [0, 1, 2] });
  const el = () => M.slideById(d, sid).elements.find((e) => e.id === id);
  assert.deepEqual(el().levels, [0, 1, 2]);
  d = M.updateElements(d, sid, [id], { text: "One\nTwo\nTwo and a half\nThree" });
  assert.deepEqual(el().levels, [0, 1, 1, 2], "a new paragraph takes the level it split from");
  d = M.updateElements(d, sid, [id], { text: "One\nThree" });
  assert.deepEqual(M.paragraphLevels(el()), [0, 2]);
  d = M.setLevels(d, sid, id, 0, 0, { delta: 1 });
  assert.deepEqual(el().levels, [1, 2]);
  d = M.setLevels(d, sid, id, 0, 9, { delta: -1 });
  assert.deepEqual(el().levels, [0, 1]);
  assert.deepEqual(M.textWithLevels("Top\n\tSub\n\t\tSubsub"), { text: "Top\nSub\nSubsub", levels: [0, 1, 2] });
  assert.deepEqual(M.textWithLevels("a\nb").levels, []);
});

test("mixed font and size spans", () => {
  let { d, sid, id, el } = deckWithBody("Small Big");
  d = M.formatText(d, sid, id, 6, 9, { size: 40, font: "Georgia" });
  const e = M.slideById(d, sid).elements.find((x) => x.id === id);
  assert.deepEqual(e.spans, [{ start: 6, end: 9, font: "Georgia", size: 40 }]);
  assert.deepEqual(M.formatSpans(e, 6, 9, { size: null }), [{ start: 6, end: 9, font: "Georgia" }]);
  assert.deepEqual(M.normSpans([{ start: 0, end: 2, size: "abc", font: "" }], 3), [], "invalid values are dropped");
  const lay = layoutText(d, e, measure);
  assert.equal(lay.lines.length, 1);
  assert.ok(Math.abs(lay.lines[0].size - 40 * M.PT) < 1e-9, "the line is as tall as its largest text");
  d = M.updateElements(d, sid, [id], { style: { size: 18 } });
  assert.equal(M.slideById(d, sid).elements.find((x) => x.id === id).spans[0].size, undefined, "whole-box size replaces span sizes");
  void el;
});

test("layout indents list levels and picks bullets by level", () => {
  const { d, el } = deckWithBody("A\nB\nC", { levels: [0, 1, 2] });
  const { lines } = layoutText(d, el(), measure);
  assert.deepEqual(lines.map((l) => l.level), [0, 1, 2]);
  assert.ok(lines[1].x > lines[0].x && lines[2].x > lines[1].x);
  assert.ok(lines[1].bx > lines[0].bx, "the bullet moves with its level");
});

test("automatic date field in the footer", () => {
  let d = M.createDeck({ template: "blank" });
  d = M.setFooter(d, { autoDate: true, dateFormat: "short", number: true });
  const now = new Date(2026, 10, 10);
  const els = M.masterElements(d, { ...d.slides[0], layout: "blank" }, now);
  const date = els.find((e) => e.id === "@f-date");
  assert.equal(date.field, "date");
  assert.equal(date.text, M.footerDate({ dateFormat: "short" }, now));
  assert.match(M.footerDate({ dateFormat: "long" }, now, "en-US"), /November 10, 2026/);
  assert.equal(els.find((e) => e.id === "@f-num").field, "slidenum");
  assert.equal(M.normMaster({ footer: { dateFormat: "weird" } }).footer.dateFormat, "long");
});

test("PowerPoint round trip: levels, font and size, date field, footer and charts", () => {
  let { d, sid, id } = deckWithBody("Point\nDetail\nMore", { levels: [0, 1, 2] });
  d = M.formatText(d, sid, id, 0, 5, { font: "Georgia", size: 30, bold: true });
  d = M.setFooter(d, { autoDate: true, dateFormat: "full", text: "ACME", number: true });
  const kinds = ["column", "stacked-bar", "line", "area", "pie", "donut", "scatter", "radar", "kpi"];
  kinds.forEach((type, i) => {
    d = M.addElement(d, sid, { type: "chart", x: 10 + i, y: 10, w: 300, h: 200, chart: { type, title: `T ${type}`, data: { categories: ["1", "2", "3"], series: [{ name: "A", values: [1, 2, 3] }, { name: "B", values: [3, null, 1] }] } } }).deck;
  });
  const bytes = writePptx(M.exportDeck(d));
  const zip = readZip(bytes).entries;
  assert.ok(zipText(zip, "ppt/charts/chart1.xml").includes("<c:barChart>"));
  assert.match(zipText(zip, "[Content_Types].xml"), /drawingml\.chart\+xml/);
  const slideXml = zipText(zip, "ppt/slides/slide2.xml");
  assert.match(slideXml, /<a:fld [^>]*type="datetime2"/);
  assert.match(slideXml, /<p:ph type="sldNum"/);
  assert.match(slideXml, /lvl="2"/);
  const report = new ImportReport("PowerPoint");
  const back = readPptx(bytes, { report });
  const s2 = back.slides[1];
  const body = s2.elements.find((e) => e.ph === "body");
  assert.deepEqual(body.levels, [0, 1, 2]);
  assert.deepEqual(body.spans, [{ start: 0, end: 5, bold: true, font: "Georgia", size: 30 }]);
  assert.equal(back.master.footer.autoDate, true);
  assert.equal(back.master.footer.dateFormat, "full");
  assert.equal(back.master.footer.text, "ACME");
  assert.equal(back.master.footer.number, true);
  const charts = s2.elements.filter((e) => e.type === "chart");
  assert.deepEqual(charts.map((c) => c.chart.type), kinds.slice(0, -1), "every native type comes back");
  assert.deepEqual(charts[0].chart.data.series[1].values, [3, null, 1]);
  assert.equal(charts[0].chart.title, "T column");
  assert.deepEqual(charts.find((c) => c.chart.type === "pie").chart.data.series.length, 1, "a pie keeps its first series");
  assert.ok(s2.elements.some((e) => e.type === "table"), "a big-number chart becomes a table");
});

test("chart parts by themselves", () => {
  const chart = { type: "percent-column", title: "Mix", options: { palette: ["#112233"], textColor: "#333333", fontFamily: "Calibri" }, data: { categories: ["a", "b"], series: [{ name: "S", values: [1, 2] }] } };
  const xml = pptxChartXml(chart);
  assert.match(xml, /<c:grouping val="percentStacked"\/>/);
  assert.match(xml, /val="112233"/);
  assert.equal(readPptxChart(parseXml(xml)).type, "percent-column");
  const odf = odfChartXml(chart, { w: 300, h: 200 });
  assert.match(odf, /chart:percentage="true"/);
  const r = readOdfChart(parseXml(odf));
  assert.equal(r.type, "percent-column");
  assert.deepEqual(r.data, chart.data);
  assert.equal(readPptxChart(parseXml("<c:chartSpace/>")), null);
});

test("OpenDocument round trip: nested lists, span fonts, date fields and chart objects", () => {
  let { d, sid, id } = deckWithBody("Point\nDetail", { levels: [0, 1] });
  d = M.formatText(d, sid, id, 0, 5, { size: 32 });
  d = M.setFooter(d, { autoDate: true });
  d = M.addElement(d, sid, { type: "chart", x: 10, y: 10, w: 300, h: 200, chart: { type: "line", title: "Trend", data: { categories: ["Q1", "Q2"], series: [{ name: "Rev", values: [5, 7] }] } } }).deck;
  const bytes = writeOdp(M.exportDeck(d));
  const zip = readZip(bytes).entries;
  const content = zipText(zip, "content.xml");
  assert.match(content, /<draw:object xlink:href="\.\/Object 1"/);
  assert.match(content, /<text:date>/);
  assert.match(content, /fo:font-size="32pt"/);
  assert.match(zipText(zip, "META-INF/manifest.xml"), /opendocument\.chart/);
  assert.match(zipText(zip, "Object 1/content.xml"), /chart:class="chart:line"/);
  const back = readOdp(bytes, { report: new ImportReport("Impress") });
  const s2 = back.slides[1];
  assert.deepEqual(s2.elements.find((e) => e.ph === "body").levels, [0, 1]);
  const ch = s2.elements.find((e) => e.type === "chart");
  assert.equal(ch.chart.type, "line");
  assert.deepEqual(ch.chart.data.series, [{ name: "Rev", values: [5, 7] }]);
});

test("Vibe: sub-bullets, font and size, automatic date", async () => {
  const deck = M.createDeck({ template: "blank" });
  const doc = { office: new OfficeProject(deck, "slides"), tx: (label, fn) => fn(), _do: (op) => op.redo() };
  const app = { doc, docs: [doc], officeUI: null };
  const tools = Object.fromEntries(slidesTools(app).map((t) => [t.name, t]));
  await tools.slides_add_slide.run({ layout: "title-content" });
  const r = await tools.slides_set_text.run({ slide: 2, placeholder: "body", text: "Goal\n\tStep one\n\tStep two" });
  const body = () => doc.office.model.slides[1].elements.find((e) => e.id === r.element);
  assert.equal(body().text, "Goal\nStep one\nStep two");
  assert.deepEqual(body().levels, [0, 1, 1]);
  await tools.slides_format_text.run({ slide: 2, placeholder: "body", match: "Goal", size: 36, font: "Georgia" });
  assert.deepEqual(body().spans, [{ start: 0, end: 4, font: "Georgia", size: 36 }]);
  await tools.slides_set_footer.run({ autoDate: true, dateFormat: "short" });
  assert.equal(doc.office.model.master.footer.autoDate, true);
});
