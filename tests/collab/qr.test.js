// The tiny QR encoder (app/src/collab/qr.js): Reed-Solomon and format/version bits against ISO/IEC 18004 reference
// values, fixed patterns, and a round trip through an independent minimal decoder (unmask, zigzag read, de-interleave,
// verify every block's error correction, parse byte mode).
import test from "node:test";
import assert from "node:assert/strict";
import { encodeQR, qrToText, qrToSvgPath, formatBits, rsRemainder } from "../../app/src/collab/qr.js";

test("qr: Reed-Solomon and format bits match the reference values", () => {
  // thonky.com QR tutorial, 1-M "HELLO WORLD": data codewords → 10 error correction codewords
  assert.deepEqual(rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  // ISO/IEC 18004 table C.1 (format information after masking)
  assert.equal(formatBits("L", 0).toString(2).padStart(15, "0"), "111011111000100");
  assert.equal(formatBits("L", 1).toString(2).padStart(15, "0"), "111001011110011");
  assert.equal(formatBits("M", 0).toString(2).padStart(15, "0"), "101010000010010");
  assert.equal(formatBits("M", 5).toString(2).padStart(15, "0"), "100000011001110");
  assert.equal(formatBits("M", 7).toString(2).padStart(15, "0"), "100101010100000");
});

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
const BLOCKS = { L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] };
const ECC = { L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26] };
const TOTAL = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

function decode(qr) {
  const { size, modules: m, functionModules: fn } = qr;
  // format bits (first copy) → level and mask
  let fmt = 0;
  const bitsAt = [];
  for (let i = 0; i <= 5; i++) bitsAt.push([8, i]);
  bitsAt.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) bitsAt.push([14 - i, 8]);
  bitsAt.forEach(([x, y], i) => (fmt |= (m[y][x] ? 1 : 0) << i));
  const data = (fmt ^ 0x5412) >>> 10;
  const ecl = (data >>> 3) === 1 ? "L" : "M";
  const mask = data & 7;
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x]) bits.push(m[y][x] !== MASKS[mask](x, y) ? 1 : 0);
      }
  }
  const v = qr.version;
  const total = TOTAL[v - 1];
  const bytes = [];
  for (let i = 0; i + 8 <= total * 8; i += 8) bytes.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const nb = BLOCKS[ecl][v - 1];
  const eccLen = ECC[ecl][v - 1];
  const shortLen = Math.floor(total / nb) - eccLen;
  const nShort = nb - (total % nb);
  const blocks = Array.from({ length: nb }, (_, i) => ({ d: [], e: [], len: shortLen + (i < nShort ? 0 : 1) }));
  let k = 0;
  for (let i = 0; i <= shortLen; i++) for (const b of blocks) if (i < b.len) b.d.push(bytes[k++]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) b.e.push(bytes[k++]);
  for (const b of blocks) assert.deepEqual(rsRemainder(b.d, eccLen), b.e, "block error correction");
  const all = blocks.flatMap((b) => b.d);
  const dbits = all.flatMap((x) => Array.from({ length: 8 }, (_, i) => (x >>> (7 - i)) & 1));
  const read = (pos, n) => dbits.slice(pos, pos + n).reduce((a, b) => (a << 1) | b, 0);
  assert.equal(read(0, 4), 4, "byte mode");
  const cbits = v < 10 ? 8 : 16;
  const count = read(4, cbits);
  const out = [];
  for (let i = 0; i < count; i++) out.push(read(4 + cbits + i * 8, 8));
  return { ecl, mask, text: new TextDecoder().decode(new Uint8Array(out)) };
}

test("qr: encodes and decodes back for every size up to version 10 (L and M)", () => {
  for (const ecl of ["L", "M"]) {
    for (const len of [1, 10, 17, 30, 60, 100, 150, 200, 210]) {
      const text = `https://192.168.1.20:8787/#join=wss://192.168.1.20:8787/#ofc1.${"x".repeat(len)}`.slice(0, len + 20);
      let qr;
      try {
        qr = encodeQR(text, { ecl });
      } catch (e) {
        assert.ok(ecl === "M" && len + 20 > 213, `${ecl} ${len}: ${e.message}`);
        continue;
      }
      assert.equal(qr.size, qr.version * 4 + 17);
      const back = decode(qr);
      assert.equal(back.text, text);
      assert.equal(back.ecl, ecl);
      // finder pattern corners are dark, separators light; dark module present
      assert.ok(qr.modules[0][0] && qr.modules[6][6] && !qr.modules[7][7]);
      assert.ok(qr.modules[qr.size - 8][8]);
    }
  }
  assert.throws(() => encodeQR("x".repeat(400)));
});

test("qr: version information (version 7+) and output helpers", () => {
  const qr = encodeQR("y".repeat(150), { ecl: "L" });
  assert.ok(qr.version >= 7);
  if (qr.version === 7) {
    // version 7 information bits: 000111 110010 010100 (ISO/IEC 18004 table D.1)
    let vb = 0;
    for (let i = 0; i < 18; i++) vb |= (qr.modules[Math.floor(i / 3)][qr.size - 11 + (i % 3)] ? 1 : 0) << i;
    assert.equal(vb, 0x07c94);
  }
  const txt = qrToText(encodeQR("hi"), { quiet: 1 });
  assert.equal(txt.split("\n").length, Math.ceil((21 + 2) / 2));
  assert.match(qrToSvgPath(encodeQR("hi")), /^M\d+ \d+h1v1h-1z/);
  // 140 bytes at L need version 7 (version 6 holds 136 data codewords, version 7 holds 156)
  assert.equal(encodeQR("z".repeat(140), { ecl: "L" }).version, 7);
});
