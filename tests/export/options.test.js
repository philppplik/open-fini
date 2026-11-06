// Export options schema (engine/export/options.js) and PDF preparation (engine/export/pdf-prep.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPORT_FORMATS, EXPORT_OPTIONS, EXPORT_GROUPS, BUILTIN_PRESETS, normalizeExportSettings, visibleOptions, availableFormats, choicesOf, optionDef,
  parsePageRange, parseSizes, formatFileName, spreadGroups, planExport, changedSettings, presetFile, readPresetFile, validPresetList, pixelSize,
} from "../../app/src/engine/export/options.js";
import { combineSpread, imagePlacements, downsampleTarget, replaceImage } from "../../app/src/engine/export/pdf-prep.js";

const ENV = { pages: 4, hasSelection: true, layers: 2, facing: true, cmykDoc: false, wideGamut: false, encoders: new Set(["image/png", "image/jpeg", "image/webp"]), userFonts: true, hasText: true };
const keys = (st, env = ENV) => visibleOptions(st, env).map((d) => d.key);
const INFO = { name: "Poster", dpi: 96, current: 1, pages: [{ w: 100, h: 50, name: "Cover" }, { w: 100, h: 50 }, { w: 100, h: 50 }, { w: 100, h: 50 }], selection: { x: 10, y: 10, w: 20, h: 10 }, layers: [{ name: "Logo", bounds: { x: 0, y: 0, w: 10, h: 10 } }, { name: "Text", bounds: { x: 5, y: 5, w: 30, h: 10 } }], facing: true, date: new Date(2026, 10, 5) };

test("schema is well formed: unique keys, known formats and groups, choices for enums, defaults within range", () => {
  const ids = EXPORT_FORMATS.map((f) => f.id);
  assert.equal(new Set(EXPORT_OPTIONS.map((o) => o.key)).size, EXPORT_OPTIONS.length);
  for (const o of EXPORT_OPTIONS) {
    assert.ok(o.formats.length && o.formats.every((f) => ids.includes(f)), o.key);
    assert.ok(EXPORT_GROUPS.some((g) => g.id === o.group), o.key);
    assert.ok(o.label, o.key);
    if (o.type === "enum") assert.ok(o.choices.some((c) => c.value === o.default), `${o.key} default is a choice`);
    if (o.type === "number" && typeof o.default === "number") assert.ok(o.default >= o.min && o.default <= o.max, o.key);
  }
});

test("every option is consumed by the export code (no dead controls)", () => {
  const src = ["../../app/src/core/export-run.js", "../../app/src/engine/export/options.js"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  for (const o of EXPORT_OPTIONS) {
    const uses = (src.match(new RegExp(`\\bst\\.${o.key}\\b`, "g")) || []).length;
    assert.ok(uses > 0, `${o.key} is never read by the export code`);
  }
});

test("defaults reproduce the previous dialog and legacy settings migrate", () => {
  const st = normalizeExportSettings({}, ENV);
  assert.equal(st.format, "png");
  assert.equal(st.scale, 1);
  assert.equal(st.background, "page");
  assert.equal(st.quality, 90);
  const old = normalizeExportSettings({ format: "jpg", quality: 0.8, transparent: true, bleed: true, marks: true, rasterDpi: 300, bogus: 1 }, ENV);
  assert.equal(old.format, "jpeg");
  assert.equal(old.quality, 80);
  assert.equal(old.background, "page", "JPEG cannot be transparent");
  assert.equal(old.bleed, "document");
  assert.equal(old.cropMarks, true);
  assert.equal(old.rasterDpi, 300);
  assert.ok(!("bogus" in old));
  assert.equal(normalizeExportSettings({ format: "png", transparent: true }, ENV).background, "transparent");
  assert.equal(normalizeExportSettings({ scale: 99, colors: 1.4, bgColor: "red" }, ENV).scale, 16);
  assert.equal(normalizeExportSettings({ colors: 1.4 }, ENV).colors, 2);
  assert.equal(normalizeExportSettings({ bgColor: "red" }, ENV).bgColor, "#ffffff");
});

test("options appear only where they change the output", () => {
  assert.ok(!keys({ ...normalizeExportSettings({ format: "png" }, ENV) }).includes("quality"));
  assert.ok(keys(normalizeExportSettings({ format: "jpeg" }, ENV)).includes("quality"));
  assert.ok(keys(normalizeExportSettings({ format: "svg", svgImages: "jpeg" }, ENV)).includes("quality"));
  assert.ok(!keys(normalizeExportSettings({ format: "svg" }, ENV)).includes("quality"));
  const jpegBg = choicesOf(optionDef("background"), normalizeExportSettings({ format: "jpeg" }, ENV), ENV).map((c) => c.value);
  assert.ok(!jpegBg.includes("transparent"));
  // PDF/X implies CMYK and embedded fonts: those switches disappear
  const x4 = keys(normalizeExportSettings({ format: "pdf", standard: "x4" }, ENV));
  assert.ok(!x4.includes("pdfColor") && !x4.includes("embedFonts") && !x4.includes("pageInfo"));
  const plain = keys(normalizeExportSettings({ format: "pdf" }, ENV));
  assert.ok(plain.includes("pdfColor") && plain.includes("embedFonts") && plain.includes("pageInfo"));
  // JPEG image compression is not offered for CMYK output (canvas JPEG is RGB)
  const cm = normalizeExportSettings({ format: "pdf", standard: "x1a", imageCompression: "jpeg" }, ENV);
  assert.equal(cm.imageCompression, "auto");
  // indexed-only options
  assert.ok(!keys(normalizeExportSettings({ format: "png" }, ENV)).includes("colors"));
  assert.ok(keys(normalizeExportSettings({ format: "png", colorMode: "indexed" }, ENV)).includes("dither"));
  assert.equal(normalizeExportSettings({ format: "jpeg", colorMode: "indexed" }, ENV).colorMode, "rgb");
  assert.equal(normalizeExportSettings({ format: "tiff", colorMode: "cmyk", background: "transparent" }, ENV).background, "page");
  // a single-page document has no page choices; a document without text has no font options
  const one = { ...ENV, pages: 1, facing: false, hasText: false, hasSelection: false };
  assert.deepEqual(choicesOf(optionDef("scope"), normalizeExportSettings({ format: "pdf" }, one), one).map((c) => c.value), ["page"]);
  assert.ok(!keys(normalizeExportSettings({ format: "pdf" }, one), one).includes("scope"));
  assert.ok(!keys(normalizeExportSettings({ format: "pdf" }, one), one).includes("embedFonts"));
  assert.ok(!keys(normalizeExportSettings({ format: "pdf", scope: "all" }, one), one).includes("spreads"));
  // multi-size list replaces the single size
  assert.ok(!keys(normalizeExportSettings({ format: "png", sizes: "1x, 2x" }, ENV)).includes("scale"));
});

test("formats depend on the browser's encoders", () => {
  assert.ok(!availableFormats(ENV).some((f) => f.id === "avif"));
  assert.ok(availableFormats({ ...ENV, encoders: new Set(["image/avif", "image/webp"]) }).some((f) => f.id === "avif"));
  assert.equal(normalizeExportSettings({ format: "avif" }, ENV).format, "png");
});

test("page ranges", () => {
  assert.deepEqual(parsePageRange("", 3), [0, 1, 2]);
  assert.deepEqual(parsePageRange("1-2, 4", 5), [0, 1, 3]);
  assert.deepEqual(parsePageRange("3-", 5), [2, 3, 4]);
  assert.deepEqual(parsePageRange("-2", 5), [0, 1]);
  assert.deepEqual(parsePageRange("3-1, 2", 5), [2, 1, 0]);
  assert.throws(() => parsePageRange("7", 5), (e) => e.i18n && /outside/.test(e.message));
  assert.throws(() => parsePageRange("a", 5), /not a page number/);
});

test("sizes, pixel sizes and file names", () => {
  assert.deepEqual(parseSizes("1x, 2x, 512w 64h, 300ppi, nope, 2x").map((s) => [s.kind, s.value, s.suffix]), [["scale", 1, ""], ["scale", 2, "@2x"], ["width", 512, "-512w"], ["height", 64, "-64h"], ["ppi", 300, "-300ppi"]]);
  assert.deepEqual(pixelSize({ w: 200, h: 100 }, { kind: "width", value: 50 }), { scale: 0.25, width: 50, height: 25, ppi: 24 });
  assert.deepEqual(pixelSize({ w: 96, h: 96 }, { kind: "ppi", value: 300 }, 96), { scale: 3.125, width: 300, height: 300, ppi: 300 });
  assert.equal(formatFileName("{name}/{page}:{x}", { name: "A", page: 2 }), "A_2_");
  assert.equal(formatFileName("{name}-{date}", { name: "A", date: new Date(2026, 0, 9) }), "A-2026-01-09");
  assert.equal(formatFileName("", {}), "export");
});

test("spreads pair pages like the pasteboard", () => {
  assert.deepEqual(spreadGroups([0, 1, 2, 3, 4], true), [[0], [1, 2], [3, 4]]);
  assert.deepEqual(spreadGroups([1, 3], true), [[1], [3]]);
  assert.deepEqual(spreadGroups([0, 1], false), [[0], [1]]);
});

test("planExport: one PDF, files per page, layer and size, unique names", () => {
  const pdf = planExport(normalizeExportSettings({ format: "pdf", scope: "all", spreads: true }, ENV), INFO);
  assert.equal(pdf.files, 1);
  assert.deepEqual(pdf.jobs[0].pages, [0, 1, 2, 3]);
  assert.equal(pdf.jobs[0].name, "Poster");
  const pages = planExport(normalizeExportSettings({ format: "png", scope: "range", range: "1, 3" }, ENV), INFO);
  assert.deepEqual(pages.jobs.map((j) => j.name), ["Poster-1", "Poster-3"]);
  const sizes = planExport(normalizeExportSettings({ format: "png", sizes: "1x, 2x" }, ENV), INFO);
  assert.deepEqual(sizes.jobs.map((j) => [j.name, j.size.width]), [["Poster", 100], ["Poster@2x", 200]]);
  const layers = planExport(normalizeExportSettings({ format: "png", scope: "layers", padding: 2 }, ENV), INFO);
  assert.deepEqual(layers.jobs.map((j) => [j.name, j.size.width]), [["Poster-Logo", 14], ["Poster-Text", 34]]);
  const named = planExport(normalizeExportSettings({ format: "png", scope: "layers", naming: "{layer}-{w}" }, ENV), INFO);
  assert.deepEqual(named.jobs.map((j) => j.name), ["Logo-10", "Text-30"]);
  const sel = planExport(normalizeExportSettings({ format: "jpeg", scope: "selection", sizeMode: "width", width: 40 }, ENV), INFO);
  assert.deepEqual([sel.jobs[0].area, sel.jobs[0].size.height], [{ x: 10, y: 10, w: 20, h: 10 }, 20]);
  const huge = planExport(normalizeExportSettings({ format: "png", scale: 16, sizes: "16384w" }, ENV), INFO);
  assert.equal(huge.warnings.length, 0);
  const tooBig = planExport(normalizeExportSettings({ format: "png", sizeMode: "height", height: 16000 }, ENV), INFO);
  assert.equal(tooBig.warningKeys.length, 1);
  const dup = planExport(normalizeExportSettings({ format: "png", scope: "all", naming: "same" }, ENV), INFO);
  assert.deepEqual(dup.jobs.map((j) => j.name), ["same-1", "same-2", "same-3", "same-4"]);
});

test("presets: built-ins are valid, files round trip and foreign keys are dropped", () => {
  for (const p of BUILTIN_PRESETS) {
    const st = normalizeExportSettings(p.settings, { ...ENV, encoders: new Set(["image/webp", "image/avif"]) });
    for (const [k, v] of Object.entries(p.settings)) assert.deepEqual(st[k], v, `${p.id}.${k}`);
  }
  const st = normalizeExportSettings({ format: "pdf", standard: "x4", bleed: "custom", bleedMm: 5 }, ENV);
  const saved = [{ name: "Press", settings: changedSettings(st, ENV) }];
  assert.ok(validPresetList(saved));
  assert.deepEqual(saved[0].settings, { format: "pdf", standard: "x4", bleed: "custom", bleedMm: 5 });
  const back = readPresetFile(presetFile(saved));
  assert.deepEqual(back, saved);
  const evil = readPresetFile(JSON.stringify({ presets: [{ name: "X", settings: { format: "png", __proto__x: 1, script: "alert(1)" } }] }));
  assert.deepEqual(evil[0].settings, { format: "png" });
  assert.throws(() => readPresetFile("{"), /not an OpenFini export preset/);
  assert.ok(!validPresetList([{ name: "", settings: {} }]));
});

test("PDF preparation: spreads, effective resolution and downsampling", () => {
  const a = { width: 100, height: 50, items: [{ t: "path", m: [1, 0, 0, 1, 5, 0] }] };
  const b = { width: 120, height: 60, items: [{ t: "path", m: [1, 0, 0, 1, 0, 0] }] };
  const s = combineSpread([a, b]);
  assert.equal(s.width, 220);
  assert.equal(s.height, 60);
  assert.deepEqual(s.items.map((i) => i.m[4]), [5, 100]);
  assert.equal(combineSpread([a]), a);
  const img = { id: "i", width: 1000, height: 500 };
  const item = { t: "image", img, m: [0.1, 0, 0, 0.1, 3, 4] }; // 100 x 50 px on the page at 96 dpi -> 960 ppi
  const dl = { width: 200, height: 200, items: [{ t: "group", m: [2, 0, 0, 2, 0, 0], items: [item] }] };
  const [pl] = imagePlacements(dl, 96);
  assert.equal(Math.round(pl.ppi), 480);
  assert.equal(downsampleTarget(img, pl.ppi, 400), null, "480 is not above 1.5 x 400");
  const t = downsampleTarget(img, pl.ppi, 150);
  assert.deepEqual(t, { width: 313, height: 156 });
  const r = replaceImage(item, { id: "j", width: 250, height: 125 });
  assert.deepEqual(r.m, [0.4, 0, 0, 0.4, 3, 4]);
});
