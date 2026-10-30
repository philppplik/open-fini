// Built-in color spaces: the RGB working spaces (sRGB, Display P3, Adobe RGB 1998) as matrix/TRC profiles, the
// built-in APPROXIMATE CMYK (an ink model, not a measured printing condition) and a writer for small ICC v2 RGB
// profiles (embedded in exported PNG/JPEG files and PDF/X-4 output). Pure, lazily loaded.
import { D50, matMul, matInv, matrixTrc, paraCurve, xyzToLab, deltaE } from "./icc.js";

const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);

// ------------------------------------------------------------------ RGB working spaces
const SRGB_TRC = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045];
const SPACES = {
  srgb: { name: "sRGB IEC61966-2.1", xy: [0.64, 0.33, 0.3, 0.6, 0.15, 0.06], trc: SRGB_TRC },
  "display-p3": { name: "Display P3", xy: [0.68, 0.32, 0.265, 0.69, 0.15, 0.06], trc: SRGB_TRC },
  "adobe-rgb": { name: "Adobe RGB (1998) compatible", xy: [0.64, 0.33, 0.21, 0.71, 0.15, 0.06], trc: [563 / 256] },
};
export const RGB_SPACES = Object.keys(SPACES);

const BRADFORD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const mat3 = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c]));

/** RGB -> XYZ(D50) matrix from xy primaries with a D65 white, Bradford-adapted. */
function primariesToD50([rx, ry, gx, gy, bx, by]) {
  const W = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
  const P = [rx / ry, gx / gy, bx / by, 1, 1, 1, (1 - rx - ry) / ry, (1 - gx - gy) / gy, (1 - bx - by) / by];
  const S = matMul(matInv(P), W);
  const M = P.map((v, i) => v * S[i % 3]);
  const cw = matMul(BRADFORD, W);
  const cd = matMul(BRADFORD, D50);
  const A = mat3(matInv(BRADFORD), mat3([cd[0] / cw[0], 0, 0, 0, cd[1] / cw[1], 0, 0, 0, cd[2] / cw[2]], BRADFORD));
  return mat3(A, M);
}

const rgbCache = new Map();
/** A built-in RGB working space as a profile object (see icc.js). */
export function rgbSpace(id = "srgb") {
  const key = SPACES[id] ? id : "srgb";
  if (rgbCache.has(key)) return rgbCache.get(key);
  const s = SPACES[key];
  const M = primariesToD50(s.xy);
  const f = s.trc.length === 1 ? paraCurve(0, s.trc) : paraCurve(3, s.trc);
  const trc = [f, f, f];
  const to = matrixTrc(M, trc, "A2B");
  const from = matrixTrc(M, trc, "B2A");
  const p = { id: key, name: s.name, channels: 3, colorSpace: "RGB", wtpt: D50, matrix: M, trc: s.trc, to: () => to, from: () => from };
  rgbCache.set(key, p);
  return p;
}

// ------------------------------------------------------------------ approximate CMYK
// A multiplicative ink model in linear light: each ink filters the paper reflectance per channel, with a simple
// dot-gain curve (+15 % at 50 %) and a paper-black floor. Inks are typical coated-offset process colors. It makes CMYK
// previews, soft proofing and RGB -> CMYK separations plausible, but it is NOT a characterized printing condition:
// colors will not match a press. Load a real ICC profile (FOGRA39, GRACoL, SWOP …) for that.
const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const INKS = [[0, 158, 224], [230, 0, 126], [255, 237, 0], [35, 31, 32]].map((c) => c.map((v) => lin(v / 255)));
const FLOOR = 0.005;
const tvi = (x) => x + 0.6 * x * (1 - x);

/** Approximate CMYK (0..1) -> linear sRGB reflectance. */
function inkModel(cmyk) {
  const out = [1, 1, 1];
  for (let i = 0; i < 4; i++) {
    const cov = tvi(clamp01(cmyk[i]));
    if (!cov) continue;
    for (let ch = 0; ch < 3; ch++) out[ch] *= 1 - cov * (1 - INKS[i][ch]);
  }
  return out.map((v) => FLOOR + (1 - FLOOR) * v);
}

/** Linear sRGB target -> CMYK (0..1) with medium GCR, solved by Gauss-Newton on the log reflectance. */
function inkSolve(t) {
  const target = t.map((v) => Math.log(Math.max(FLOOR, Math.min(1, v))));
  const e = t.map((v) => enc(clamp01(v)));
  const hi = Math.max(...e);
  const k0 = 1 - hi;
  const sat = hi > 0 ? (hi - Math.min(...e)) / hi : 0;
  // GCR replaces the gray component only: saturated colors keep K low so CMY can still reach them
  const k = clamp01(k0 * clamp01((k0 - 0.1) / 0.9) * (1 - sat * sat));
  const ik = 1 - k;
  let x = [0, 1, 2].map((i) => clamp01(ik > 0 ? (1 - e[i] - k) / ik : 0));
  const F = (cmy) => inkModel([cmy[0], cmy[1], cmy[2], k]).map(Math.log);
  for (let it = 0; it < 10; it++) {
    const f = F(x);
    const r = f.map((v, i) => v - target[i]);
    if (Math.hypot(...r) < 1e-5) break;
    const J = [];
    for (let j = 0; j < 3; j++) {
      const h = x[j] > 0.5 ? -1e-4 : 1e-4;
      const xx = x.slice();
      xx[j] += h;
      const fj = F(xx);
      for (let i = 0; i < 3; i++) J[3 * i + j] = (fj[i] - f[i]) / h;
    }
    let step;
    try {
      step = matMul(matInv(J), r);
    } catch {
      break;
    }
    x = x.map((v, i) => clamp01(v - step[i]));
  }
  return [x[0], x[1], x[2], k];
}

let approx = null;
/** The built-in approximate CMYK as a profile object (see icc.js). Intents are ignored. */
export function approxCmyk() {
  if (approx) return approx;
  const srgb = rgbSpace("srgb");
  const M = srgb.matrix;
  const Mi = matInv(M);
  const to = (cmyk) => matMul(M, inkModel(cmyk));
  const from = (xyz) => inkSolve(matMul(Mi, xyz));
  approx = { id: "approx", name: "OpenFini approximate CMYK (not a measured printing condition)", approximate: true, channels: 4, colorSpace: "CMYK", wtpt: D50, to: () => to, from: () => from };
  return approx;
}

/** True when a color survives RGB -> CMYK -> RGB within `tol` Delta E (CIE76). */
export function inGamutXyz(cmyk, xyz, tol = 3) {
  const back = cmyk.to(1)(cmyk.from(1)(xyz));
  return deltaE(xyzToLab(back), xyzToLab(xyz)) <= tol;
}

// ------------------------------------------------------------------ ICC writer (v2 matrix/TRC RGB)
/** Writes a minimal ICC v2 display profile for a built-in RGB space (about 0.6-2.6 KiB). */
export function buildRgbIcc(id = "srgb") {
  const sp = rgbSpace(id);
  const tags = [];
  const s15 = (v) => {
    const n = Math.round(v * 65536);
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  };
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0) & 0x7f);
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const pad = (a) => (a.length % 4 ? a.concat(new Array(4 - (a.length % 4)).fill(0)) : a);
  const xyz = (v) => [...ascii("XYZ "), 0, 0, 0, 0, ...v.flatMap(s15)];
  const desc = (s) => pad([...ascii("desc"), 0, 0, 0, 0, ...u32(s.length + 1), ...ascii(s), 0, ...new Array(12 + 67).fill(0)]);
  let curve;
  if (sp.trc.length === 1) {
    const g = Math.round(sp.trc[0] * 256);
    curve = pad([...ascii("curv"), 0, 0, 0, 0, ...u32(1), g >> 8, g & 255]);
  } else {
    const f = paraCurve(3, sp.trc);
    const n = 1024;
    const body = [];
    for (let i = 0; i < n; i++) {
      const v = Math.round(clamp01(f(i / (n - 1))) * 65535);
      body.push(v >> 8, v & 255);
    }
    curve = pad([...ascii("curv"), 0, 0, 0, 0, ...u32(n), ...body]);
  }
  const M = sp.matrix;
  tags.push(["desc", desc(sp.name)], ["cprt", pad([...ascii("text"), 0, 0, 0, 0, ...ascii("No copyright, use freely"), 0])], ["wtpt", xyz(D50)]);
  tags.push(["rXYZ", xyz([M[0], M[3], M[6]])], ["gXYZ", xyz([M[1], M[4], M[7]])], ["bXYZ", xyz([M[2], M[5], M[8]])]);
  tags.push(["rTRC", curve], ["gTRC", curve], ["bTRC", curve]);
  const tableLen = 4 + tags.length * 12;
  let off = 128 + tableLen;
  const table = [...u32(tags.length)];
  const data = [];
  let lastBody = null;
  let lastOff = 0;
  for (const [sig, body] of tags) {
    if (body === lastBody) {
      table.push(...ascii(sig), ...u32(lastOff), ...u32(body.length));
      continue;
    }
    table.push(...ascii(sig), ...u32(off), ...u32(body.length));
    lastBody = body;
    lastOff = off;
    data.push(...body);
    off += body.length;
  }
  const size = off;
  const out = new Uint8Array(size);
  // header: size, version 2.1, class 'mntr', space 'RGB ', PCS 'XYZ ', date, 'acsp', D50 illuminant at 68
  out.set(u32(size), 0);
  out.set([2, 0x10, 0, 0], 8);
  out.set(ascii("mntrRGB XYZ "), 12);
  out.set([0x07, 0xea, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0], 24);
  out.set(ascii("acsp"), 36);
  out.set(D50.flatMap(s15), 68);
  out.set(table, 128);
  out.set(data, 128 + tableLen);
  return out;
}

