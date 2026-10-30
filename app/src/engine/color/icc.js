// ICC profile parser and a compact color transform engine. Pure (no DOM), lazily loaded.
//
// Supported: ICC v2 and v4 headers and tag tables; matrix/TRC RGB and gray TRC profiles; LUT-based profiles with
// lut8Type (mft1), lut16Type (mft2), lutAtoBType (mAB) and lutBtoAType (mBA); curveType (curv) and
// parametricCurveType (para); XYZ and Lab PCS. Not supported: named-color profiles, DeviceLink and abstract profiles,
// multiProcessElementType (D2Bx/B2Dx, ignored in favor of A2Bx/B2Ax), profile sequence and calibration tags.
//
// A "profile" here is any object with { name, channels, colorSpace, wtpt, to(intent), from(intent) }: `to` maps device
// values (0..1 per channel) to PCS XYZ (D50, white Y = 1, relative colorimetric), `from` does the reverse. Parsed ICC
// profiles, the built-in RGB working spaces (rgb-spaces.js) and the built-in approximate CMYK all implement it.
// Intents: 0 perceptual, 1 relative colorimetric, 2 saturation, 3 absolute colorimetric.

export const D50 = [0.9642, 1, 0.8249];
const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);
const CHANNELS = { RGB: 3, CMYK: 4, GRAY: 1 };

// ------------------------------------------------------------------ Lab / XYZ
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));
/** XYZ (D50, Y=1) to CIE Lab. */
export function xyzToLab([X, Y, Z]) {
  const fx = fLab(X / D50[0]);
  const fy = fLab(Y);
  const fz = fLab(Z / D50[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIE Lab to XYZ (D50, Y=1). */
export function labToXyz([L, a, b]) {
  const fy = (L + 16) / 116;
  return [fInv(fy + a / 500) * D50[0], fInv(fy), fInv(fy - b / 200) * D50[2]];
}
/** CIE76 color difference. */
export const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ------------------------------------------------------------------ 3x3 matrices
export const matMul = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export function matInv(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) throw new Error("Singular color matrix.");
  return [A / det, (c * h - b * i) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det];
}

// ------------------------------------------------------------------ curves
/** Parametric curve (ICC para function types 0..4). */
export function paraCurve(type, p) {
  const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = p;
  const pow = (x) => (x > 0 ? Math.pow(x, g) : 0);
  switch (type) {
    case 0: return (x) => pow(x);
    case 1: return (x) => (x >= -b / a ? pow(a * x + b) : 0);
    case 2: return (x) => (x >= -b / a ? pow(a * x + b) + c : c);
    case 3: return (x) => (x >= d ? pow(a * x + b) : c * x);
    case 4: return (x) => (x >= d ? pow(a * x + b) + e : c * x + f);
    default: throw new Error("Unknown parametric curve type " + type + ".");
  }
}
const tableCurve = (t) => (x) => {
  const p = clamp01(x) * (t.length - 1);
  const i = Math.min(Math.floor(p), t.length - 2);
  return t[i] + (t[i + 1] - t[i]) * (p - i);
};
/** Numerical inverse of a monotone curve on [0,1] (sampled, linear interpolation). */
export function invertCurve(f, n = 4096) {
  const ys = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) ys[i] = f(i / n);
  const up = ys[n] >= ys[0];
  return (y) => {
    let lo = 0;
    let hi = n;
    if (up ? y <= ys[0] : y >= ys[0]) return 0;
    if (up ? y >= ys[n] : y <= ys[n]) return 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (up ? ys[mid] <= y : ys[mid] >= y) lo = mid;
      else hi = mid;
    }
    const span = ys[hi] - ys[lo];
    return (lo + (span ? (y - ys[lo]) / span : 0)) / n;
  };
}

// ------------------------------------------------------------------ CLUT
/** n-dimensional multilinear interpolation over a grid; `data` is normalized 0..1, first input varies slowest. */
export function clut(grid, outCh, data) {
  const nIn = grid.length;
  const strides = new Array(nIn);
  let s = outCh;
  for (let i = nIn - 1; i >= 0; i--) {
    strides[i] = s;
    s *= grid[i];
  }
  if (data.length < s) throw new Error("ICC color table is truncated.");
  const frac = new Float64Array(nIn);
  return (inp) => {
    let off = 0;
    for (let i = 0; i < nIn; i++) {
      const g = grid[i] - 1;
      const x = clamp01(inp[i]) * g;
      const i0 = g > 0 ? Math.min(Math.floor(x), g - 1) : 0;
      frac[i] = g > 0 ? x - i0 : 0;
      off += i0 * strides[i];
    }
    const out = new Array(outCh).fill(0);
    for (let corner = 0; corner < 1 << nIn; corner++) {
      let w = 1;
      let o = off;
      for (let i = 0; i < nIn && w; i++) {
        if ((corner >> i) & 1) {
          w *= frac[i];
          o += strides[i];
        } else w *= 1 - frac[i];
      }
      if (!w) continue;
      for (let k = 0; k < outCh; k++) out[k] += w * data[o + k];
    }
    return out;
  };
}

// ------------------------------------------------------------------ parser
const sigAt = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
const s15 = (dv, o) => dv.getInt32(o) / 65536;

/**
 * Parses an ICC profile. Throws a readable error for anything that is not a usable RGB, CMYK or gray profile.
 * @param {Uint8Array} bytes
 */
export function parseICC(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 132) throw new Error("This is not an ICC profile (too short).");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (sigAt(dv, 36) !== "acsp") throw new Error("This is not an ICC profile.");
  const size = dv.getUint32(0);
  if (size < 132 || size > bytes.length) throw new Error("The ICC profile is truncated.");
  const count = dv.getUint32(128);
  if (count > 4096 || 132 + count * 12 > size) throw new Error("The ICC profile has a broken tag table.");
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const o = 132 + i * 12;
    const off = dv.getUint32(o + 4);
    const len = dv.getUint32(o + 8);
    if (off < 128 || len < 8 || off + len > size) throw new Error("The ICC profile has a tag outside the file.");
    tags.set(sigAt(dv, o), { off, len });
  }
  const colorSpace = sigAt(dv, 16).trim();
  const channels = CHANNELS[colorSpace];
  if (!channels) throw new Error(`ICC profiles for ${colorSpace} are not supported (only RGB, CMYK and gray).`);
  const pcs = sigAt(dv, 20).trim();
  if (pcs !== "XYZ" && pcs !== "Lab") throw new Error("The ICC profile has an unsupported connection space.");
  const p = {
    bytes: bytes.subarray(0, size),
    major: bytes[8],
    version: `${bytes[8]}.${bytes[9] >> 4}`,
    deviceClass: sigAt(dv, 12),
    colorSpace,
    channels,
    pcs,
    tags,
    dv,
  };
  p.name = readText(p, "desc") || "ICC profile";
  p.copyright = readText(p, "cprt") || "";
  p.wtpt = tags.has("wtpt") ? readXYZ(p, "wtpt") : D50;
  const cache = new Map();
  const pipe = (dir, intent) => {
    const key = dir + intent;
    if (!cache.has(key)) cache.set(key, buildPipe(p, dir, intent));
    return cache.get(key);
  };
  p.to = (intent = 1) => pipe("A2B", intent);
  p.from = (intent = 1) => pipe("B2A", intent);
  pipe("A2B", 1); // fail early on profiles we cannot use at all
  return p;
}

function readText(p, tag) {
  const t = p.tags.get(tag);
  if (!t) return "";
  const { dv } = p;
  const type = sigAt(dv, t.off);
  const end = t.off + t.len;
  try {
    if (type === "desc") {
      const n = dv.getUint32(t.off + 8);
      let s = "";
      for (let i = 0; i < n && t.off + 12 + i < end; i++) {
        const c = dv.getUint8(t.off + 12 + i);
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s.trim();
    }
    if (type === "mluc") {
      const len = dv.getUint32(t.off + 20);
      const o = t.off + dv.getUint32(t.off + 24);
      let s = "";
      for (let i = 0; i + 1 < len && o + i + 1 < end; i += 2) s += String.fromCharCode(dv.getUint16(o + i));
      return s.replace(/\0+$/, "").trim();
    }
    if (type === "text") {
      let s = "";
      for (let i = t.off + 8; i < end; i++) {
        const c = dv.getUint8(i);
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s.trim();
    }
  } catch {
    /* unreadable text tag: ignore */
  }
  return "";
}

function readXYZ(p, tag) {
  const t = p.tags.get(tag);
  if (!t || t.len < 20) throw new Error(`The ICC profile has a broken ${tag} tag.`);
  return [s15(p.dv, t.off + 8), s15(p.dv, t.off + 12), s15(p.dv, t.off + 16)];
}

/** Reads a curv or para curve at `o`; returns { f, len } (len padded to 4 bytes). */
function readCurve(dv, o, end) {
  if (o + 12 > end) throw new Error("ICC curve is truncated.");
  const type = sigAt(dv, o);
  if (type === "curv") {
    const n = dv.getUint32(o + 8);
    const len = (12 + 2 * n + 3) & ~3;
    if (o + 12 + 2 * n > end) throw new Error("ICC curve is truncated.");
    if (n === 0) return { f: (x) => x, len };
    if (n === 1) {
      const g = dv.getUint16(o + 12) / 256;
      return { f: (x) => (x > 0 ? Math.pow(x, g) : 0), len };
    }
    const tbl = new Float64Array(n);
    for (let i = 0; i < n; i++) tbl[i] = dv.getUint16(o + 12 + 2 * i) / 65535;
    return { f: tableCurve(tbl), len };
  }
  if (type === "para") {
    const ft = dv.getUint16(o + 8);
    const np = [1, 3, 4, 5, 7][ft];
    if (!np || o + 12 + 4 * np > end) throw new Error("ICC parametric curve is broken.");
    const params = [];
    for (let i = 0; i < np; i++) params.push(s15(dv, o + 12 + 4 * i));
    return { f: paraCurve(ft, params), len: 12 + 4 * np };
  }
  throw new Error(`Unsupported ICC curve type '${type}'.`);
}

function readCurves(dv, o, n, end) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = readCurve(dv, o, end);
    out.push(c.f);
    o += c.len;
  }
  return out;
}

const applyCurves = (cs, v) => v.map((x, i) => cs[i](x));

/** Reads a lut8 / lut16 / lutAtoB / lutBtoA tag as a function on normalized values. */
function readLut(p, tag) {
  const t = p.tags.get(tag);
  const { dv } = p;
  const o = t.off;
  const end = t.off + t.len;
  const type = sigAt(dv, o);
  const inCh = dv.getUint8(o + 8);
  const outCh = dv.getUint8(o + 9);
  if (!inCh || !outCh || inCh > 8 || outCh > 8) throw new Error("ICC color table has an invalid channel count.");
  if (type === "mft1" || type === "mft2") {
    const wide = type === "mft2";
    const grid = dv.getUint8(o + 10);
    const mat = [];
    for (let i = 0; i < 9; i++) mat.push(s15(dv, o + 12 + 4 * i));
    const n = wide ? dv.getUint16(o + 48) : 256;
    const m = wide ? dv.getUint16(o + 50) : 256;
    const bps = wide ? 2 : 1;
    let pos = o + (wide ? 52 : 48);
    const cells = Math.pow(grid, inCh) * outCh;
    if (n < 2 || m < 2 || grid < 2 || pos + (inCh * n + cells + outCh * m) * bps > end) throw new Error("ICC color table is truncated.");
    const rd = (q) => (wide ? dv.getUint16(q) / 65535 : dv.getUint8(q) / 255);
    const tables = (ch, len) => {
      const out = [];
      for (let c = 0; c < ch; c++) {
        const tbl = new Float64Array(len);
        for (let i = 0; i < len; i++, pos += bps) tbl[i] = rd(pos);
        out.push(tableCurve(tbl));
      }
      return out;
    };
    const inC = tables(inCh, n);
    const data = new Float64Array(cells);
    for (let i = 0; i < cells; i++, pos += bps) data[i] = rd(pos);
    const lut = clut(new Array(inCh).fill(grid), outCh, data);
    const outC = tables(outCh, m);
    const useMat = inCh === 3 && p.pcs === "XYZ" && tag.startsWith("B2A") && mat.some((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) > 1e-6);
    return { legacy: wide, f: (v) => applyCurves(outC, lut(applyCurves(inC, useMat ? matMul(mat, v) : v))) };
  }
  if (type === "mAB " || type === "mBA ") {
    const ab = type === "mAB ";
    const off = (k) => dv.getUint32(o + 12 + 4 * k);
    const [oB, oMat, oM, oClut, oA] = [0, 1, 2, 3, 4].map(off);
    // curves next to the device side have the device channel count; B/M curves the PCS side (3)
    const devCh = ab ? inCh : outCh;
    const pcsCh = ab ? outCh : inCh;
    if (!oB) throw new Error("ICC color table has no B curves.");
    const B = readCurves(dv, o + oB, pcsCh, end);
    const M = oM ? readCurves(dv, o + oM, pcsCh, end) : null;
    const A = oA ? readCurves(dv, o + oA, devCh, end) : null;
    let mat = null;
    if (oMat) {
      if (o + oMat + 48 > end) throw new Error("ICC matrix is truncated.");
      mat = [];
      for (let i = 0; i < 12; i++) mat.push(s15(dv, o + oMat + 4 * i));
    }
    let lut = null;
    if (oClut) {
      const q = o + oClut;
      const nIn = ab ? inCh : pcsCh;
      const nOut = ab ? pcsCh : outCh;
      const grid = [];
      for (let i = 0; i < nIn; i++) grid.push(dv.getUint8(q + i));
      const prec = dv.getUint8(q + 16);
      if (grid.some((g) => g < 1) || (prec !== 1 && prec !== 2)) throw new Error("ICC color table is broken.");
      const cells = grid.reduce((a, g) => a * g, 1) * nOut;
      if (q + 20 + cells * prec > end) throw new Error("ICC color table is truncated.");
      const data = new Float64Array(cells);
      for (let i = 0; i < cells; i++) data[i] = prec === 2 ? dv.getUint16(q + 20 + 2 * i) / 65535 : dv.getUint8(q + 20 + i) / 255;
      lut = clut(grid, nOut, data);
    }
    const mtx = (v) => (mat ? [0, 1, 2].map((r) => mat[3 * r] * v[0] + mat[3 * r + 1] * v[1] + mat[3 * r + 2] * v[2] + mat[9 + r]) : v);
    const f = ab
      ? (v) => {
          let x = A ? applyCurves(A, v) : v;
          if (lut) x = lut(x);
          if (M) x = applyCurves(M, x);
          return applyCurves(B, mtx(x));
        }
      : (v) => {
          let x = mtx(applyCurves(B, v));
          if (M) x = applyCurves(M, x);
          if (lut) x = lut(x);
          return A ? applyCurves(A, x) : x;
        };
    return { legacy: false, f };
  }
  throw new Error(`Unsupported ICC color table type '${type.trim()}'.`);
}

// PCS encodings of LUT tags: XYZ 1.0 = 0x8000; Lab legacy (lut16) L 100 = 0xFF00; Lab v4 / lut8 L 100 = 0xFFFF.
const XYZ_SCALE = 65535 / 32768;
function decodePcs(pcs, legacy, v) {
  if (pcs === "XYZ") return [v[0] * XYZ_SCALE, v[1] * XYZ_SCALE, v[2] * XYZ_SCALE];
  const k = legacy ? 65535 / 65280 : 1;
  return labToXyz([v[0] * k * 100, v[1] * k * 255 - 128, v[2] * k * 255 - 128]);
}
function encodePcs(pcs, legacy, xyz) {
  if (pcs === "XYZ") return xyz.map((x) => clamp01(x / XYZ_SCALE));
  const k = legacy ? 65280 / 65535 : 1;
  const [L, a, b] = xyzToLab(xyz);
  return [clamp01((L / 100) * k), clamp01(((a + 128) / 255) * k), clamp01(((b + 128) / 255) * k)];
}

function buildPipe(p, dir, intent) {
  const n = intent === 3 ? 1 : intent;
  const tag = [`${dir}${n}`, `${dir}1`, `${dir}0`].find((k) => p.tags.has(k));
  if (tag) {
    const lut = readLut(p, tag);
    if (dir === "A2B") return (dev) => decodePcs(p.pcs, lut.legacy, lut.f(dev.map(clamp01)));
    return (xyz) => lut.f(encodePcs(p.pcs, lut.legacy, xyz)).map(clamp01);
  }
  if (p.colorSpace === "RGB" && ["rXYZ", "gXYZ", "bXYZ", "rTRC", "gTRC", "bTRC"].every((k) => p.tags.has(k))) {
    const cols = ["rXYZ", "gXYZ", "bXYZ"].map((k) => readXYZ(p, k));
    const M = [cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]];
    const trc = ["rTRC", "gTRC", "bTRC"].map((k) => readCurve(p.dv, p.tags.get(k).off, p.tags.get(k).off + p.tags.get(k).len).f);
    return matrixTrc(M, trc, dir);
  }
  if (p.colorSpace === "GRAY" && p.tags.has("kTRC")) {
    const t = p.tags.get("kTRC");
    const f = readCurve(p.dv, t.off, t.off + t.len).f;
    if (dir === "A2B") return ([g]) => D50.map((w) => w * f(clamp01(g)));
    const inv = invertCurve(f);
    return (xyz) => [inv(clamp01(xyz[1]))];
  }
  throw new Error("The ICC profile has no usable color transform for this direction.");
}

/** Matrix/TRC pipeline (also used by the built-in RGB spaces). */
export function matrixTrc(M, trc, dir) {
  if (dir === "A2B") return (rgb) => matMul(M, rgb.map((v, i) => trc[i](clamp01(v))));
  const Mi = matInv(M);
  const inv = trc.map((f) => invertCurve(f));
  return (xyz) => matMul(Mi, xyz).map((v, i) => inv[i](clamp01(v)));
}

// ------------------------------------------------------------------ transforms
function blackPoint(p) {
  const black = p.colorSpace === "CMYK" ? [1, 1, 1, 1] : p.colorSpace === "GRAY" ? [0] : [0, 0, 0];
  return Math.max(0, Math.min(0.5, p.to(1)(black)[1]));
}

/**
 * Device-to-device transform `src` -> `dst`.
 * Black point compensation is the simplified Adobe form: a linear XYZ scaling between the device-black luminance of
 * both profiles (relative colorimetric A2B1 of RGB 0,0,0 / CMYK 100,100,100,100), not the full estimation algorithm.
 * @param {{intent?:number, bpc?:boolean}} [o]
 * @returns {(dev:number[]) => number[]}
 */
export function createTransform(src, dst, { intent = 1, bpc = false } = {}) {
  const to = src.to(intent);
  const from = dst.from(intent);
  let adapt = null;
  if (intent === 3) {
    const ws = src.wtpt || D50;
    const wd = dst.wtpt || D50;
    adapt = (x) => [x[0] * ws[0] / wd[0], x[1] * ws[1] / wd[1], x[2] * ws[2] / wd[2]];
  } else if (bpc && intent !== 2) {
    const bs = blackPoint(src);
    const bd = blackPoint(dst);
    if (Math.abs(bs - bd) > 1e-4) {
      const k = (1 - bd) / (1 - bs);
      adapt = (x) => x.map((v, i) => (v - bs * D50[i]) * k + bd * D50[i]);
    }
  }
  return adapt ? (dev) => from(adapt(to(dev))) : (dev) => from(to(dev));
}

/** Bakes a 3-input transform into a grid³ LUT with trilinear lookup (for images and the soft proof). */
export function bakeLut3(fn, outCh, grid = 17) {
  const g = grid - 1;
  const data = new Float32Array(grid * grid * grid * outCh);
  let o = 0;
  for (let r = 0; r < grid; r++) for (let gg = 0; gg < grid; gg++) for (let b = 0; b < grid; b++) {
    const v = fn([r / g, gg / g, b / g]);
    for (let k = 0; k < outCh; k++) data[o++] = v[k];
  }
  const look = clut([grid, grid, grid], outCh, data);
  return { grid, outCh, data, apply: look };
}
