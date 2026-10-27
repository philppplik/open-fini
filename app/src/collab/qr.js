// A tiny QR code encoder (byte mode, error correction L or M, versions 1-10: up to 271 bytes). Pure, no dependencies.
// Used by the relay (`scripts/relay.mjs --lan` prints the join link as a QR code in the terminal) and by the app
// (Collaboration ▸ People ▸ invite link as a QR code). Written for OpenFini after the structure of Project Nayuki's
// MIT-licensed "QR Code generator" and ISO/IEC 18004; tests: tests/collab/qr.test.js.
//
// Public API
//   encodeQR(text, { ecl = "M" }) → { size, version, modules: boolean[][] (row-major, true = dark) }
//   qrToText(qr, { quiet = 2, invert = false }) → string     two rows per line with ▀ ▄ █ (terminal)
//   qrToSvgPath(qr) → string                                 SVG path data ("M x y h1 v1 h-1 z …"), 1 unit per module
//   formatBits(ecl, mask), rsRemainder(data, degree)         exported for tests
const ECL = { L: { idx: 0, bits: 1 }, M: { idx: 1, bits: 0 } };
// per version 1..10: error correction codewords per block and number of blocks (ISO/IEC 18004 table 9)
const ECC_PER_BLOCK = [
  [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
];
const BLOCKS = [
  [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
];
const MAX_VERSION = 10;

function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = (ver, e) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver - 1] * BLOCKS[e][ver - 1];

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 2);
  }
  return r;
}

/** Reed-Solomon error correction codewords of `data` (array of bytes). */
export function rsRemainder(data, degree) {
  const div = rsDivisor(degree);
  const r = new Array(degree).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < degree; i++) r[i] ^= gfMul(div[i], f);
  }
  return r;
}

/** The 15 format bits for an error correction level and mask. */
export function formatBits(ecl, mask) {
  const data = (ECL[ecl].bits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function alignPositions(ver, size) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

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

export function encodeQR(text, { ecl = "M" } = {}) {
  if (!ECL[ecl]) throw new Error("error correction level must be L or M");
  const e = ECL[ecl].idx;
  const bytes = [...new TextEncoder().encode(String(text))];
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    const bits = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
    if (bits <= dataCodewords(ver, e) * 8) break;
  }
  if (ver > MAX_VERSION) throw new Error("text too long for a QR code");
  // data bits
  const bits = [];
  const put = (v, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver, e) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // blocks, error correction, interleaving
  const nBlocks = BLOCKS[e][ver - 1];
  const eccLen = ECC_PER_BLOCK[e][ver - 1];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortLen = Math.floor(raw / nBlocks) - eccLen;
  const nShort = nBlocks - (raw % nBlocks);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const len = shortLen + (i < nShort ? 0 : 1);
    const d = data.slice(k, k + len);
    k += len;
    blocks.push({ d, ecc: rsRemainder(d, eccLen) });
  }
  const all = [];
  for (let i = 0; i <= shortLen; i++) for (const b of blocks) if (i < b.d.length) all.push(b.d[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) all.push(b.ecc[i]);

  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    m[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const al = alignPositions(ver, size);
  for (let i = 0; i < al.length; i++)
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const drawFormat = (mask) => {
    const b = formatBits(ecl, mask);
    const bit = (i) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // reserve the areas
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vb = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((vb >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  // data in the zigzag order
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < all.length * 8) {
          m[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
  }
  // choose the mask with the lowest penalty
  const applyMask = (k) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x];
  };
  let best = 0;
  let bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    applyMask(k);
    drawFormat(k);
    const s = penalty(m, size);
    if (s < bestScore) {
      bestScore = s;
      best = k;
    }
    applyMask(k);
  }
  applyMask(best);
  drawFormat(best);
  return { size, version: ver, mask: best, ecl, modules: m, functionModules: fn };
}

function penalty(m, size) {
  let score = 0;
  const lines = [];
  for (let y = 0; y < size; y++) lines.push(m[y]);
  for (let x = 0; x < size; x++) lines.push(m.map((row) => row[x]));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    const s = line.map((d) => (d ? "1" : "0")).join("");
    for (const pat of ["10111010000", "00001011101"]) for (let k = s.indexOf(pat); k >= 0; k = s.indexOf(pat, k + 1)) score += 40;
  }
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** The QR code as text for a terminal: two module rows per line, with a quiet zone. */
export function qrToText(qr, { quiet = 2, invert = false } = {}) {
  const n = qr.size + quiet * 2;
  const dark = (x, y) => {
    const xx = x - quiet;
    const yy = y - quiet;
    const d = xx >= 0 && yy >= 0 && xx < qr.size && yy < qr.size && qr.modules[yy][xx];
    return invert ? !d : d;
  };
  const lines = [];
  for (let y = 0; y < n; y += 2) {
    let s = "";
    for (let x = 0; x < n; x++) {
      const top = dark(x, y);
      const bottom = y + 1 < n && dark(x, y + 1);
      s += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(s);
  }
  return lines.join("\n");
}

/** SVG path data for the dark modules (one unit per module; draw with a quiet zone of 4 units around it). */
export function qrToSvgPath(qr) {
  let d = "";
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) d += `M${x} ${y}h1v1h-1z`;
  return d;
}
