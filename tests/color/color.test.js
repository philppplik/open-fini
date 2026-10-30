// Color management: ICC parsing (matrix/TRC, lut16, lutAtoB/BtoA), transforms, the approximate CMYK, PDF/X output
// structure, image profile embedding and the preflight.
import test from "node:test";
import assert from "node:assert/strict";
import { parseICC, createTransform, xyzToLab, labToXyz, deltaE } from "../../app/src/engine/color/icc.js";
import { rgbSpace, approxCmyk, buildRgbIcc } from "../../app/src/engine/color/spaces.js";
import { createColorContext, normalizeColorSettings, applyProof } from "../../app/src/engine/color/context.js";
import { preflight, hasTransparency } from "../../app/src/engine/color/preflight.js";
import { embedIccPng, embedIccJpeg } from "../../app/src/engine/color/embed.js";
import { createPDF } from "../../app/src/engine/backends/pdf.js";
import { checkPdf, pageObjects, pageContent, latin1Str } from "../layout/pdf-structure.js";

const lab = (space, rgb) => xyzToLab(space.to(1)(rgb));

// ------------------------------------------------------------------ synthetic ICC builder
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
const s15 = (v) => u32(Math.round(v * 65536) >>> 0);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const pad4 = (a) => (a.length % 4 ? a.concat(new Array(4 - (a.length % 4)).fill(0)) : a);

function iccFile(space, pcs, tags, cls = "prtr") {
  let off = 128 + 4 + tags.length * 12;
  const table = [...u32(tags.length)];
  const data = [];
  for (const [sig, body] of tags) {
    const b = pad4(body);
    table.push(...ascii(sig), ...u32(off), ...u32(body.length));
    data.push(...b);
    off += b.length;
  }
  const head = new Array(128).fill(0);
  head.splice(0, 4, ...u32(off));
  head.splice(8, 4, 4, 0x30, 0, 0);
  head.splice(12, 12, ...ascii(cls), ...ascii(space.padEnd(4)), ...ascii(pcs.padEnd(4)));
  head.splice(36, 4, ...ascii("acsp"));
  return new Uint8Array([...head, ...table, ...data]);
}
const desc = (s) => [...ascii("desc"), 0, 0, 0, 0, ...u32(s.length + 1), ...ascii(s), 0, ...new Array(78).fill(0)];

/** lut16 (mft2) tag over Lab (legacy encoding) sampled from fn on a grid. */
function mft2(inCh, outCh, grid, fn) {
  const out = [...ascii("mft2"), 0, 0, 0, 0, inCh, outCh, grid, 0];
  for (let i = 0; i < 9; i++) out.push(...s15(i % 4 === 0 ? 1 : 0));
  out.push(...u16(2), ...u16(2));
  for (let c = 0; c < inCh; c++) out.push(...u16(0), ...u16(65535));
  const total = grid ** inCh;
  for (let i = 0; i < total; i++) {
    const idx = [];
    let r = i;
    for (let d = inCh - 1; d >= 0; d--) {
      idx[d] = (r % grid) / (grid - 1);
      r = Math.floor(r / grid);
    }
    for (const v of fn(idx)) out.push(...u16(Math.round(Math.max(0, Math.min(1, v)) * 65535)));
  }
  for (let c = 0; c < outCh; c++) out.push(...u16(0), ...u16(65535));
  return out;
}
const labEnc = (L) => [(L[0] / 100) * (65280 / 65535), ((L[1] + 128) / 255) * (65280 / 65535), ((L[2] + 128) / 255) * (65280 / 65535)];
const labDec = (v) => [v[0] * (65535 / 65280) * 100, v[1] * (65535 / 65280) * 255 - 128, v[2] * (65535 / 65280) * 255 - 128];

/** A small LUT-based CMYK printer profile that mirrors the built-in approximation. */
function syntheticCmyk() {
  const ap = approxCmyk();
  const a2b = mft2(4, 3, 7, (cmyk) => labEnc(xyzToLab(ap.to(1)(cmyk))));
  const b2a = mft2(3, 4, 17, (v) => ap.from(1)(labToXyz(labDec(v))));
  return iccFile("CMYK", "Lab", [["desc", desc("Synthetic CMYK test")], ["wtpt", [...ascii("XYZ "), 0, 0, 0, 0, ...s15(0.9642), ...s15(1), ...s15(0.8249)]], ["A2B0", a2b], ["B2A0", b2a]]);
}

// ------------------------------------------------------------------ ICC
test("built-in RGB profiles round-trip through the ICC writer and parser", () => {
  for (const id of ["srgb", "display-p3", "adobe-rgb"]) {
    const bytes = buildRgbIcc(id);
    const p = parseICC(bytes);
    assert.equal(p.colorSpace, "RGB");
    assert.equal(p.pcs, "XYZ");
    assert.equal(p.name, rgbSpace(id).name);
    const t = createTransform(rgbSpace(id), p);
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [1, 0, 0]]) t(c).forEach((v, i) => assert.ok(Math.abs(v - c[i]) < 0.004, `${id} ${c}`));
  }
});

test("sRGB white maps to D50 and the Lab conversions invert", () => {
  const w = rgbSpace("srgb").to(1)([1, 1, 1]);
  assert.ok(Math.abs(w[0] - 0.9642) < 0.002 && Math.abs(w[1] - 1) < 0.002 && Math.abs(w[2] - 0.8249) < 0.002);
  const L = [52, -20, 35];
  assert.ok(deltaE(xyzToLab(labToXyz(L)), L) < 1e-9);
});

test("wide-gamut spaces convert to sRGB as expected", () => {
  const t = createTransform(rgbSpace("display-p3"), rgbSpace("srgb"));
  const red = t([1, 0, 0]);
  assert.ok(red[0] > 0.99 && red[1] < 0.01, "P3 red clips to sRGB red");
  const back = createTransform(rgbSpace("srgb"), rgbSpace("display-p3"))([1, 0, 0]);
  assert.ok(back[0] < 0.95 && back[1] > 0.1, "sRGB red sits inside P3");
});

test("LUT-based CMYK profile (lut16, Lab PCS) parses and agrees with its source model", () => {
  const p = parseICC(syntheticCmyk());
  assert.equal(p.colorSpace, "CMYK");
  assert.equal(p.name, "Synthetic CMYK test");
  const srgb = rgbSpace("srgb");
  const viaIcc = createTransform(p, srgb);
  const viaModel = createTransform(approxCmyk(), srgb);
  for (const c of [[0, 0, 0, 0], [1, 0, 0, 0], [0.5, 0.3, 0.1, 0.2], [0, 0, 0, 1]]) {
    assert.ok(deltaE(lab(srgb, viaIcc(c)), lab(srgb, viaModel(c))) < 3, `A2B ${c}`);
  }
  // round trip RGB -> CMYK (B2A) -> RGB (A2B) for in-gamut colors
  const r2c = createTransform(srgb, p);
  for (const rgb of [[0.5, 0.5, 0.5], [0.8, 0.6, 0.4], [0.3, 0.45, 0.35], [0.9, 0.9, 0.85]]) {
    assert.ok(deltaE(lab(srgb, viaIcc(r2c(rgb))), lab(srgb, rgb)) < 4, `round trip ${rgb}`);
  }
});

test("lutAtoB (v4) with parametric M curves and a matrix", () => {
  const para = (g) => [...ascii("para"), 0, 0, 0, 0, 0, 0, 0, 0, ...s15(g)];
  const M = rgbSpace("srgb").matrix;
  const scale = 32768 / 65535; // XYZ PCS encoding: 1.0 = 0x8000
  const Mi = [...M.map((v) => v * scale)];
  // A2B: A curves none, M curves gamma 2.2, matrix to XYZ (scaled to the encoding), B identity
  const head = (sig, inCh, outCh, offs) => [...ascii(sig), 0, 0, 0, 0, inCh, outCh, 0, 0, ...offs.flatMap(u32)];
  const curvesId = [...ascii("curv"), 0, 0, 0, 0, 0, 0, 0, 0];
  const a2bMat = [...Mi.map(s15).flat(), ...s15(0), ...s15(0), ...s15(0)];
  const base = 32;
  const bOff = base;
  const matOff = bOff + 3 * curvesId.length;
  const mOff = matOff + a2bMat.length;
  const a2b = [...head("mAB ", 3, 3, [bOff, matOff, mOff, 0, 0]), ...curvesId, ...curvesId, ...curvesId, ...a2bMat, ...para(2.2), ...para(2.2), ...para(2.2)];
  const bytes = iccFile("RGB", "XYZ", [["desc", desc("v4 test")], ["A2B0", a2b]], "mntr");
  const p = parseICC(bytes);
  const xyz = p.to(0)([0.5, 0.5, 0.5]);
  const g = Math.pow(0.5, 2.2);
  const want = [M[0] + M[1] + M[2], M[3] + M[4] + M[5], M[6] + M[7] + M[8]].map((v) => v * g);
  xyz.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 0.002, `mAB ${i}`));
});

test("hostile ICC input is rejected with readable errors", () => {
  assert.throws(() => parseICC(new Uint8Array(10)), /not an ICC profile/i);
  const good = buildRgbIcc("srgb");
  assert.throws(() => parseICC(good.subarray(0, 200)), /truncated|outside|broken/i);
  const bad = good.slice();
  bad[128] = 0xff; // huge tag count
  assert.throws(() => parseICC(bad), /tag table/);
  const off = good.slice();
  off.set(u32(0x7ffffff0), 132 + 4); // first tag offset past the end
  assert.throws(() => parseICC(off), /outside/);
  const lab = good.slice();
  lab.set(ascii("XYZ "), 16); // color space XYZ is unsupported
  assert.throws(() => parseICC(lab), /not supported/);
});

// ------------------------------------------------------------------ approximate CMYK and the context
test("approximate CMYK: paper white, rich black, in-gamut round trips", () => {
  const ctx = createColorContext({});
  assert.deepEqual(ctx.rgbToCmyk("#ffffff"), [0, 0, 0, 0]);
  const k = ctx.rgbToCmyk("#000000");
  assert.ok(k[3] > 80 && k[0] > 50, "black is a rich black (K plus CMY)");
  for (const hex of ["#808080", "#c08060", "#4a7060", "#e6e6dc"]) {
    const back = ctx.cmykToHex(ctx.rgbToCmyk(hex));
    const d = deltaE(lab(rgbSpace(), [1, 3, 5].map((i) => parseInt(back.slice(i, i + 2), 16) / 255)), lab(rgbSpace(), [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)));
    assert.ok(d < 2, `${hex} -> ${back} (dE ${d.toFixed(2)})`);
    assert.ok(ctx.inGamut(hex), hex);
  }
  assert.equal(ctx.inGamut("#00ff00"), false, "pure sRGB green is out of the CMYK gamut");
  assert.ok(ctx.approximate);
});

test("color settings normalize unknown values", () => {
  assert.deepEqual(normalizeColorSettings({ mode: "lab", rgb: "x", intent: 9, bpc: 0 }), { mode: "rgb", rgb: "srgb", cmyk: null, cmykName: "", intent: 1, bpc: true });
  assert.throws(() => createColorContext({}, buildRgbIcc("srgb")), /CMYK profile/);
  const ctx = createColorContext({ intent: 0, bpc: true }, syntheticCmyk());
  assert.equal(ctx.approximate, false);
  assert.equal(ctx.profileName, "Synthetic CMYK test");
});

test("soft proof tables keep in-gamut colors and flag out-of-gamut ones", () => {
  const ctx = createColorContext({});
  const tables = ctx.proofTables();
  const px = new Uint8ClampedArray([128, 128, 128, 255, 0, 255, 0, 255]);
  applyProof(px, tables, { proof: true });
  assert.ok(Math.abs(px[0] - 128) <= 3 && Math.abs(px[1] - 128) <= 3, "gray survives");
  assert.ok(px[5] < 240, "pure green is pulled into the gamut");
  const warn = new Uint8ClampedArray([0, 255, 0, 255]);
  applyProof(warn, tables, { proof: false, warn: true });
  assert.deepEqual([...warn], [128, 128, 128, 255]);
  // the preview of a printable CMYK color is never flagged
  for (const c of [[100, 0, 100, 0], [0, 100, 0, 0], [100, 0, 0, 0], [0, 0, 100, 0]]) {
    const hex = ctx.cmykToHex(c);
    assert.ok(ctx.inGamut(hex), `${c} -> ${hex}`);
    const px2 = new Uint8ClampedArray([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255));
    applyProof(px2, tables, { proof: false, warn: true });
    assert.notDeepEqual([...px2].slice(0, 3), [128, 128, 128], `${c} not gray`);
  }
});

// ------------------------------------------------------------------ PDF
const IDM = [1, 0, 0, 1, 0, 0];
const rect = (fill, extra) => ({ t: "path", d: [["M", 0, 0], ["L", 50, 0], ["L", 50, 50], ["L", 0, 50], ["Z"]], rule: "nonzero", fill, stroke: null, m: IDM, ...extra });
const DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
function pdf(items, opts) {
  const bytes = createPDF([{ width: 200, height: 100, items }], { creationDate: DATE, compress: false, title: "Test", ...opts });
  const parsed = checkPdf(bytes);
  const page = pageObjects(parsed.objects, parsed.trailer)[0];
  return { text: latin1Str(bytes), page, content: pageContent(parsed.objects, page), parsed };
}

test("native CMYK and spot paints are written as DeviceCMYK / Separation", () => {
  const { content, text } = pdf([rect({ type: "solid", color: "#00a0e0", alpha: 1, cmyk: [100, 20, 0, 0] }), rect({ type: "solid", color: "#ff0000", alpha: 1, cmyk: [0, 100, 100, 0], spot: "Brand Red" })]);
  assert.match(content, /^1 0\.2 0 0 k$/m);
  assert.match(content, /\/CS1 cs 1 scn/);
  assert.match(text, /\[\/Separation \/Brand#20Red \/DeviceCMYK << \/FunctionType 2/);
  assert.match(text, /\/ColorSpace << \/CS1 \d+ 0 R >>/);
});

test("PDF/X-4 output: header, OutputIntent with profile, GTS keys, XMP, CMYK conversion, page boxes", () => {
  const ctx = createColorContext({}, syntheticCmyk());
  const img = { id: "i1", width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) };
  const { text, page, content } = pdf([rect({ type: "solid", color: "#808080", alpha: 1 }), { t: "image", img, m: [10, 0, 0, 10, 0, 0] }], {
    bleed: 12,
    color: { toCmyk: ctx.toCmyk, imageToCmyk: ctx.imageToCmyk },
    pdfx: { version: "x4", profile: ctx.cmykIcc, identifier: "Synthetic", condition: ctx.profileName },
  });
  assert.ok(text.startsWith("%PDF-1.6\n"));
  assert.match(text, /\/GTS_PDFXVersion \(PDF\/X-4\)/);
  assert.match(text, /\/Trapped \/False/);
  assert.match(text, /\/OutputIntents \[\d+ 0 R\]/);
  assert.match(text, /\/S \/GTS_PDFX \/OutputConditionIdentifier \(Synthetic\)/);
  assert.match(text, /\/DestOutputProfile \d+ 0 R/);
  assert.match(text, /<pdfxid:GTS_PDFXVersion>PDF\/X-4<\/pdfxid:GTS_PDFXVersion>/);
  assert.match(text, /<xmpMM:DocumentID>uuid:[0-9a-f-]{36}<\/xmpMM:DocumentID>/);
  assert.match(text, /\/ColorSpace \/DeviceCMYK \/BitsPerComponent 8/);
  assert.doesNotMatch(text, /\/DeviceRGB/);
  assert.match(content, /^[\d.]+ [\d.]+ [\d.]+ [\d.]+ k$/m);
  assert.match(page.dict, /\/MediaBox \[0 0 168 93\]/);
  assert.match(page.dict, /\/TrimBox \[9 9 159 84\]/);
  assert.match(page.dict, /\/BleedBox \[0 0 168 93\]/);
  assert.match(page.dict, /\/Group << \/S \/Transparency \/CS \/DeviceCMYK >>/);
});

test("PDF/X-1a output: PDF 1.4, conformance key, no page transparency group, profile-less intent when approximate", () => {
  const ctx = createColorContext({});
  const { text, page } = pdf([rect({ type: "solid", color: "#336699", alpha: 1 })], {
    color: { toCmyk: ctx.toCmyk, imageToCmyk: ctx.imageToCmyk },
    pdfx: { version: "x1a", profile: null, identifier: "Custom", info: "approximate" },
  });
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.match(text, /\/GTS_PDFXVersion \(PDF\/X-1:2003\) \/GTS_PDFXConformance \(PDF\/X-1a:2003\)/);
  assert.doesNotMatch(page.dict, /\/Group/);
  assert.doesNotMatch(text, /DestOutputProfile/);
  assert.doesNotMatch(text, /\/SMask|\/ca 0/);
});

test("plain PDF stays RGB and reports fonts", () => {
  const report = {};
  const { text } = pdf([{ t: "text", m: IDM, runs: [{ text: "Hi", x: 0, y: 20, width: 10, font: { family: "Arial", size: 12, weight: 400, style: "normal" }, fill: { type: "solid", color: "#000000", alpha: 1 } }] }], { report });
  assert.ok(text.startsWith("%PDF-1.7\n"));
  assert.match(text, /\/Group << \/S \/Transparency \/CS \/DeviceRGB >>/);
  assert.equal(report.fonts.length, 1);
  assert.equal(report.fonts[0].embedded, false);
});

// ------------------------------------------------------------------ preflight
test("preflight lists RGB objects, low-res images, transparency, bleed, fonts and the missing profile", () => {
  const img = { id: "a1", width: 100, height: 100, rgba: new Uint8Array(100 * 100 * 4).fill(255) };
  const lists = [
    { width: 200, height: 100, items: [rect({ type: "solid", color: "#ff0000", alpha: 0.5 }), rect({ type: "solid", color: "#000", alpha: 1, cmyk: [100, 100, 100, 100] }), { t: "image", img, m: [1, 0, 0, 1, 0, 0] }] },
    { width: 200, height: 100, items: [rect({ type: "solid", color: "#000", alpha: 1, cmyk: [0, 0, 0, 100], spot: "Black Spot" })] },
  ];
  const r = preflight(lists, { standard: "x1a", pages: [{ bleed: 0 }, { bleed: 9 }], dpi: 96, fonts: [{ family: "Arial", embedded: false }, { family: "Inter", embedded: true, kind: "cff" }], approximate: true });
  const codes = r.issues.map((i) => `${i.code}${i.page || ""}:${i.severity}`);
  for (const c of ["rgb1:warning", "tac1:warning", "lowres1:warning", "transparency1:error", "bleed1:warning", "spot:info", "font:error", "profile:warning"]) assert.ok(codes.includes(c), `${c} in ${codes}`);
  assert.ok(!codes.includes("bleed2:warning") && !codes.includes("rgb2:warning"));
  assert.equal(r.issues.find((i) => i.code === "lowres").params.low, 96);
  assert.equal(r.issues.filter((i) => i.code === "font").length, 2);
  assert.ok(r.checked.length >= 8);
  const x4 = preflight(lists, { standard: "x4", pages: [{ bleed: 3 }, { bleed: 3 }], dpi: 300, fonts: [], approximate: false });
  assert.deepEqual(x4.issues.map((i) => i.code).sort(), ["rgb", "spot", "tac", "transparency"].sort());
  assert.equal(x4.issues.find((i) => i.code === "transparency").severity, "info");
  assert.equal(hasTransparency([{ t: "group", opacity: 1, blend: "multiply", items: [] }]), true);
  assert.equal(hasTransparency(lists[1].items), false);
});

// ------------------------------------------------------------------ embedding
test("ICC profiles embed into PNG (iCCP) and JPEG (APP2)", () => {
  // minimal PNG: signature, IHDR, sRGB, IEND (CRCs are not checked by the embedder)
  const chunk = (type, data) => [...u32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", new Array(13).fill(1)), ...chunk("sRGB", [0]), ...chunk("IEND", [])]);
  const icc = buildRgbIcc("display-p3");
  const out = embedIccPng(png, icc, "display-p3");
  const s = latin1Str(out);
  assert.ok(s.indexOf("iCCP") > s.indexOf("IHDR") && s.indexOf("iCCP") < s.indexOf("IEND"));
  assert.equal(s.indexOf("sRGB"), -1);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9]);
  const j = embedIccJpeg(jpg, icc);
  assert.deepEqual([...j.subarray(8, 10)], [0xff, 0xe2]);
  assert.equal(latin1Str(j.subarray(12, 23)), "ICC_PROFILE");
  assert.equal(j.length, jpg.length + 4 + 14 + icc.length);
});
