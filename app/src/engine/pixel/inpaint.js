// Mask inpainting (Content-Aware Fill, the Object Eraser, content-aware crop corners): exemplar-based patch synthesis
// in onion-peel order and push-pull diffusion. Pure, no DOM. Not part of engine/pixel/index.js (the start-up chunk): the
// worker pool loads it (core/workers/jobs.js "pixel.inpaint"). Tests: tests/pixel/retouch.test.js.

/**
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

const EMPTY = () => ({ x: 0, y: 0, width: 0, height: 0 });

// Seeded standard-normal table (the same numbers as fx-detail.js gaussianTable; kept here so this lazy module does not
// pull start-up engine modules into the worker graph).
function gaussianTable(seed) {
  const rnd = mulberry((seed | 0) ^ 0x9e3779b9);
  const t = new Float32Array(32768);
  for (let i = 0; i < t.length; i += 2) {
    const u = Math.max(1e-12, rnd());
    const v = rnd();
    const m = Math.sqrt(-2 * Math.log(u));
    t[i] = m * Math.cos(2 * Math.PI * v);
    t[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return t;
}


// Pyramid push-pull interpolation: fills holes (w = 0) of a premultiplied RGBA float image (4 values per pixel). Exported
// for heal.js (patch blending), which interpolates boundary differences with it.
export function pushPull(val, wgt, w, h) {
  const levels = [{ val, wgt, w, h }];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const L = levels[levels.length - 1];
    const nw = Math.max(1, (L.w + 1) >> 1);
    const nh = Math.max(1, (L.h + 1) >> 1);
    const nv = new Float32Array(nw * nh * 4);
    const nwg = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let r = 0, g = 0, b = 0, a = 0, ws = 0;
        for (let dy = 0; dy < 2; dy++) {
          const yy = y * 2 + dy;
          if (yy >= L.h) continue;
          for (let dx = 0; dx < 2; dx++) {
            const xx = x * 2 + dx;
            if (xx >= L.w) continue;
            const i = yy * L.w + xx;
            const wv = L.wgt[i];
            if (wv <= 0) continue;
            r += L.val[i * 4] * wv;
            g += L.val[i * 4 + 1] * wv;
            b += L.val[i * 4 + 2] * wv;
            a += L.val[i * 4 + 3] * wv;
            ws += wv;
          }
        }
        const o = y * nw + x;
        if (ws > 0) {
          nv[o * 4] = r / ws;
          nv[o * 4 + 1] = g / ws;
          nv[o * 4 + 2] = b / ws;
          nv[o * 4 + 3] = a / ws;
          nwg[o] = Math.min(1, ws / 4 * 1.5);
        }
      }
    }
    levels.push({ val: nv, wgt: nwg, w: nw, h: nh });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const F = levels[l];
    const C = levels[l + 1];
    for (let y = 0; y < F.h; y++) {
      const gy = (y + 0.5) / 2 - 0.5;
      let y0 = Math.floor(gy);
      const ty = gy - y0;
      let y1 = y0 + 1;
      y0 = y0 < 0 ? 0 : y0 >= C.h ? C.h - 1 : y0;
      y1 = y1 < 0 ? 0 : y1 >= C.h ? C.h - 1 : y1;
      for (let x = 0; x < F.w; x++) {
        const i = y * F.w + x;
        const wv = F.wgt[i];
        if (wv >= 1) continue;
        const gx = (x + 0.5) / 2 - 0.5;
        let x0 = Math.floor(gx);
        const tx = gx - x0;
        let x1 = x0 + 1;
        x0 = x0 < 0 ? 0 : x0 >= C.w ? C.w - 1 : x0;
        x1 = x1 < 0 ? 0 : x1 >= C.w ? C.w - 1 : x1;
        const k00 = (y0 * C.w + x0) * 4, k10 = (y0 * C.w + x1) * 4, k01 = (y1 * C.w + x0) * 4, k11 = (y1 * C.w + x1) * 4;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        for (let c = 0; c < 4; c++) {
          const up = C.val[k00 + c] * w00 + C.val[k10 + c] * w10 + C.val[k01 + c] * w01 + C.val[k11 + c] * w11;
          F.val[i * 4 + c] = F.val[i * 4 + c] * wv + up * (1 - wv);
        }
        F.wgt[i] = 1;
      }
    }
  }
}

function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Exemplar-based fill in onion-peel order with propagated + random candidates.
function patchFill(img, hole, bounds, seed) {
  const W = img.width;
  const H = img.height;
  const data = img.data;
  const rnd = mulberry(seed);
  const state = new Uint8Array(W * H); // 0 = known/source, 1 = unknown (hole), 2 = filled
  const srcIdx = new Int32Array(W * H).fill(-1);
  const x0 = bounds.x, y0 = bounds.y, x1 = bounds.x + bounds.width, y1 = bounds.y + bounds.height;
  const list = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (hole[y * W + x]) { state[y * W + x] = 1; list.push(y * W + x); }
  if (!list.length) return;
  // distance from the hole boundary: BFS layers
  const order = [];
  let frontier = [];
  const inHole = (i) => state[i] === 1;
  for (const i of list) {
    const x = i % W, y = (i / W) | 0;
    if ((x > 0 && !inHole(i - 1) && state[i - 1] !== 2) || (x < W - 1 && !inHole(i + 1)) || (y > 0 && !inHole(i - W)) || (y < H - 1 && !inHole(i + W))) {
      frontier.push(i);
    }
  }
  let layer = 1;
  const seen = new Uint8Array(W * H);
  for (const i of frontier) seen[i] = 1;
  while (frontier.length) {
    for (const i of frontier) order.push(i);
    const next = [];
    for (const i of frontier) {
      const x = i % W, y = (i / W) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const n of nb) {
        if (n >= 0 && state[n] === 1 && !seen[n]) {
          seen[n] = 1;
          next.push(n);
        }
      }
    }
    frontier = next;
    layer++;
  }
  // holes unreachable from known pixels (whole image masked) are left untouched
  const hx = (x1 - x0), hy = (y1 - y0);
  const S = Math.max(24, Math.min(160, Math.round(Math.max(hx, hy) * 1.5)));
  const HW = 2; // window half size
  const nbOff = [];
  for (let dy = -HW; dy <= HW; dy++) for (let dx = -HW; dx <= HW; dx++) if (dx || dy) nbOff.push(dx, dy);
  const cost = (px, py, qx, qy) => {
    let c = 0;
    let n = 0;
    for (let k = 0; k < nbOff.length; k += 2) {
      const ax = px + nbOff[k], ay = py + nbOff[k + 1];
      if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
      const ai = ay * W + ax;
      if (state[ai] === 1) continue;
      const bx = qx + nbOff[k], by = qy + nbOff[k + 1];
      if (bx < 0 || by < 0 || bx >= W || by >= H) { c += 3 * 255 * 255; n++; continue; }
      const bi = by * W + bx;
      if (state[bi] === 1) { c += 3 * 255 * 255; n++; continue; }
      const p = ai * 4, q = bi * 4;
      const dr = data[p] - data[q], dg = data[p + 1] - data[q + 1], db = data[p + 2] - data[q + 2];
      c += dr * dr + dg * dg + db * db;
      n++;
    }
    return n ? c / n : Infinity;
  };
  const validSource = (qx, qy) => qx >= 0 && qy >= 0 && qx < W && qy < H && state[qy * W + qx] === 0 && data[(qy * W + qx) * 4 + 3] > 0;
  for (const i of order) {
    const px = i % W, py = (i / W) | 0;
    let bestC = Infinity, bq = -1;
    // propagated candidates from filled neighbors
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (state[ni] !== 2 || srcIdx[ni] < 0) continue;
        const sq = srcIdx[ni];
        const qx = (sq % W) - dx, qy = ((sq / W) | 0) - dy;
        if (!validSource(qx, qy)) continue;
        const c = cost(px, py, qx, qy);
        if (c < bestC) { bestC = c; bq = qy * W + qx; }
      }
    }
    for (let t = 0; t < 48; t++) {
      const qx = Math.round(px + (rnd() * 2 - 1) * S), qy = Math.round(py + (rnd() * 2 - 1) * S);
      if (!validSource(qx, qy)) continue;
      const c = cost(px, py, qx, qy);
      if (c < bestC) { bestC = c; bq = qy * W + qx; }
    }
    if (bq < 0) {
      // nothing usable nearby: fall back to the nearest known neighbor color
      for (let r = 1; r < 64 && bq < 0; r++) {
        for (let dy = -r; dy <= r && bq < 0; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (validSource(px + dx, py + dy)) { bq = (py + dy) * W + px + dx; break; }
          }
        }
      }
      if (bq < 0) continue;
    }
    const p = i * 4, q = bq * 4;
    data[p] = data[q];
    data[p + 1] = data[q + 1];
    data[p + 2] = data[q + 2];
    data[p + 3] = data[q + 3];
    srcIdx[i] = bq;
    state[i] = 2;
  }
}

/**
 * Fills the masked area using the surrounding content (content-aware fill / object removal).
 * `method`: 'patch' copies matching texture from nearby areas (onion-peel exemplar synthesis, best for textures,
 * cost grows with the hole area), 'diffuse' interpolates smoothly (fast, blurry, best for small blemishes or
 * large areas), 'auto' (default) picks 'patch' for holes up to 60000 px. A final blend through the (anti-aliased)
 * mask hides the seam.
 * @param {RGBAImage} img modified in place
 * @param {{width:number,height:number,data:Uint8Array}} mask coverage mask, same size; >= 128 counts as hole
 * @param {{method?: 'auto'|'patch'|'diffuse', grow?: number, seed?: number, texture?: boolean}} [opts]
 *   `grow` expands the hole by that many px first (default 1); `texture` (default true) re-adds grain to diffused fills
 * @returns {Rect} dirty rect
 */
export function inpaintMask(img, mask, opts = {}) {
  const W = img.width;
  const H = img.height;
  if (mask.width !== W || mask.height !== H) throw new RangeError("inpaintMask: mask size mismatch");
  const md = mask.data;
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1, area = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (md[y * W + x] >= 128) {
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
        area++;
      }
    }
  }
  if (!area) return EMPTY();
  const grow = opts.grow === undefined ? 1 : Math.max(0, Math.round(opts.grow));
  const pad = grow + 1;
  const rx0 = Math.max(0, bx0 - pad), ry0 = Math.max(0, by0 - pad);
  const rx1 = Math.min(W, bx1 + 1 + pad), ry1 = Math.min(H, by1 + 1 + pad);
  const rect = { x: rx0, y: ry0, width: rx1 - rx0, height: ry1 - ry0 };
  // working hole = mask >= 128 grown by `grow` (Chebyshev)
  let hole = new Uint8Array(W * H);
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) if (md[y * W + x] >= 128) hole[y * W + x] = 1;
  for (let g = 0; g < grow; g++) {
    const next = hole.slice();
    for (let y = ry0; y < ry1; y++) {
      for (let x = rx0; x < rx1; x++) {
        const i = y * W + x;
        if (hole[i]) continue;
        if ((x > 0 && hole[i - 1]) || (x < W - 1 && hole[i + 1]) || (y > 0 && hole[i - W]) || (y < H - 1 && hole[i + W])) next[i] = 1;
      }
    }
    hole = next;
  }
  let holeArea = 0;
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) holeArea += hole[y * W + x];
  if (holeArea >= W * H) return EMPTY();
  const original = new Uint8ClampedArray(img.data);
  const method = opts.method === "diffuse" || opts.method === "patch" ? opts.method : holeArea <= 60000 ? "patch" : "diffuse";
  const seed = opts.seed === undefined ? 1 : opts.seed;
  if (method === "patch") {
    patchFill(img, hole, rect, seed);
  } else {
    // push-pull diffusion on a margin-expanded region
    const m = 2;
    const qx0 = Math.max(0, rx0 - m), qy0 = Math.max(0, ry0 - m);
    const qx1 = Math.min(W, rx1 + m), qy1 = Math.min(H, ry1 + m);
    const w = qx1 - qx0, h = qy1 - qy0;
    const val = new Float32Array(w * h * 4);
    const wgt = new Float32Array(w * h);
    const data = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y + qy0) * W + (x + qx0);
        if (hole[i]) continue;
        const p = i * 4;
        const a = data[p + 3];
        const k = a / 255;
        const o = y * w + x;
        val[o * 4] = data[p] * k;
        val[o * 4 + 1] = data[p + 1] * k;
        val[o * 4 + 2] = data[p + 2] * k;
        val[o * 4 + 3] = a;
        wgt[o] = 1;
      }
    }
    pushPull(val, wgt, w, h);
    // grain estimate from known pixels next to the hole
    let noiseStd = 0;
    if (opts.texture !== false) {
      let sum = 0, cnt = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = (y + qy0) * W + (x + qx0);
          if (hole[i]) continue;
          if (!hole[i - 1] && !hole[i + 1] && !hole[i - W] && !hole[i + W]) {
            // near the hole? only sample within 6 px of the rect
            const p = i * 4;
            const l = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
            const lN = (data[p - 4] + data[p + 4] + data[p - W * 4] + data[p + W * 4]) * 0.25 * 0.299 + (data[p - 3] + data[p + 5] + data[p - W * 4 + 1] + data[p + W * 4 + 1]) * 0.25 * 0.587 + (data[p - 2] + data[p + 6] + data[p - W * 4 + 2] + data[p + W * 4 + 2]) * 0.25 * 0.114;
            const dl = l - lN;
            sum += dl * dl;
            cnt++;
          }
        }
      }
      if (cnt) noiseStd = Math.min(12, Math.sqrt(sum / cnt) * 0.6);
    }
    const table = noiseStd > 0.5 ? gaussianTable(seed) : null;
    let s = (seed * 2654435761) | 0 || 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y + qy0) * W + (x + qx0);
        if (!hole[i]) continue;
        const o = (y * w + x) * 4;
        const a = val[o + 3];
        const p = i * 4;
        if (a <= 0.0005) {
          data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 0;
          continue;
        }
        const inv = 255 / a;
        let n = 0;
        if (table) {
          s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
          n = table[s & 0x7fff] * noiseStd;
        }
        data[p] = val[o] * inv + n;
        data[p + 1] = val[o + 1] * inv + n;
        data[p + 2] = val[o + 2] * inv + n;
        data[p + 3] = a;
      }
    }
  }
  // blend through the original (anti-aliased) mask so the seam is soft
  const data = img.data;
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const i = y * W + x;
      const m = md[i];
      const p = i * 4;
      if (m === 0 && !hole[i]) continue;
      // inside the grown hole but outside the mask: keep the fill only where the mask had coverage
      const f = m >= 128 ? 1 : m / 255;
      if (f >= 1) continue;
      data[p] = original[p] + (data[p] - original[p]) * f;
      data[p + 1] = original[p + 1] + (data[p + 1] - original[p + 1]) * f;
      data[p + 2] = original[p + 2] + (data[p + 2] - original[p + 2]) * f;
      data[p + 3] = original[p + 3] + (data[p + 3] - original[p + 3]) * f;
    }
  }
  return rect;
}

