// "Edit together" for pixel content (Pixel layers' bitmaps). Pure: works on ImageData-like objects
// ({ width, height, data: Uint8ClampedArray }) and never touches a canvas; ui/collab/live.js ▸ TreeBinding reads and
// writes the canvases. Tests: tests/collab/pixel-sync.test.js.
//
// A pixel layer's bitmap is cut into 128 × 128 tiles. After a local step that touched a pixel layer, the tiles whose
// hash changed are sent as `px` ops (deflated RGBA, base64) inside `op` messages of kind "pixel". Each tile is a
// last-writer-wins register with a Lamport clock [lamport, site]: two people painting different tiles merge, the
// same tile goes to the later stroke on every replica. A size change (crop, resize) sends every tile with the new
// size; receivers resize the canvas first.
//
// Wire op: { o: "px", id, W, H, s: [lamport, site], x, y, w, h, d, c: [lamport, site] }
//   x, y multiples of TILE; w, h <= TILE; s = clock of the size W x H (a register of its own); c = clock of the tile
//
// Public API
//   TILE, PIXEL_LIMITS
//   tileHashes(img) → Map("x,y" → hash)
//   class PixelSync(site)
//     .baseline(id, img)                 remember a layer's current tiles (no ops)
//     .local(id, img) → ops              tiles that changed since the baseline (and the new baseline)
//     .remote(op) → { apply, resize }    LWW check; on apply the caller (resizes and) writes decodeTile(op) at (x, y),
//                                        then calls .applied(op, tileRGBA)
//     .forget(id)
//   encodeTile(img, x, y, w, h) → base64  decodeTile(op) → Uint8ClampedArray (w * h * 4)
//   validatePixelOp(op) → op             throws on malformed input
import { deflateSync, inflateSync } from "../../vendor/fflate/fflate.js";

export const TILE = 128;
export const PIXEL_LIMITS = { size: 16384, data: 120_000, ops: 4096 };

const b64 = (bytes) => {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** FNV-1a over the RGBA words of one tile. */
function hashTile(img, x, y, w, h) {
  const d = img.data;
  let hsh = 0x811c9dc5 ^ (w << 16) ^ h;
  for (let r = 0; r < h; r++) {
    let i = ((y + r) * img.width + x) * 4;
    const end = i + w * 4;
    for (; i < end; i++) hsh = Math.imul(hsh ^ d[i], 0x01000193);
  }
  return hsh >>> 0;
}

export function tileHashes(img) {
  const out = new Map();
  for (let y = 0; y < img.height; y += TILE) for (let x = 0; x < img.width; x += TILE) out.set(`${x},${y}`, hashTile(img, x, y, Math.min(TILE, img.width - x), Math.min(TILE, img.height - y)));
  return out;
}

export function encodeTile(img, x, y, w, h) {
  const raw = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) raw.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return b64(deflateSync(raw, { level: 6 }));
}

export function decodeTile(op) {
  const raw = inflateSync(unb64(op.d));
  if (raw.length !== op.w * op.h * 4) throw new Error("pixel tile has the wrong size");
  return new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length);
}

const later = (a, b) => !b || a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export function validatePixelOp(op) {
  if (!op || typeof op !== "object" || op.o !== "px") throw new Error("pixel op expected");
  const { id, W, H, x, y, w, h, d, c } = op;
  if (typeof id !== "string" || !id || id.length > 64 || id === "__proto__") throw new Error("pixel op has a bad id");
  if (!int(W, 1, PIXEL_LIMITS.size) || !int(H, 1, PIXEL_LIMITS.size)) throw new Error("pixel op has a bad size");
  if (!int(x, 0, W - 1) || !int(y, 0, H - 1) || x % TILE || y % TILE) throw new Error("pixel op has a bad tile");
  if (w !== Math.min(TILE, W - x) || h !== Math.min(TILE, H - y)) throw new Error("pixel op has a bad tile size");
  if (typeof d !== "string" || d.length > PIXEL_LIMITS.data || !/^[A-Za-z0-9+/]*={0,2}$/.test(d)) throw new Error("pixel op has bad data");
  const clock = (k) => Array.isArray(k) && k.length === 2 && int(k[0], 0, 2 ** 48) && typeof k[1] === "string" && k[1].length <= 64;
  if (!clock(c) || !clock(op.s)) throw new Error("pixel op has a bad clock");
  return { o: "px", id, W, H, s: [op.s[0], op.s[1]], x, y, w, h, d, c: [c[0], c[1]] };
}

export class PixelSync {
  constructor(site) {
    this.site = String(site || "");
    this.lamport = 0;
    this.layers = new Map(); // id → { W, H, s: size clock, hashes: Map, clocks: Map }
  }

  #layer(id) {
    let l = this.layers.get(id);
    if (!l) this.layers.set(id, (l = { W: 0, H: 0, s: [0, ""], hashes: new Map(), clocks: new Map() }));
    return l;
  }

  /** Remember a layer's current tiles (no ops): after binding, a remote write or a resync. */
  baseline(id, img) {
    const l = this.#layer(id);
    if (l.W !== img.width || l.H !== img.height) {
      l.W = img.width;
      l.H = img.height;
      l.clocks = new Map();
    }
    l.hashes = tileHashes(img);
  }

  has(id) {
    return this.layers.has(id);
  }

  /** Tiles that changed since the baseline, as ops (a new size sends every tile and starts a new size clock). */
  local(id, img) {
    const l = this.#layer(id);
    const resized = l.W !== img.width || l.H !== img.height;
    if (resized) {
      l.W = img.width;
      l.H = img.height;
      l.s = [++this.lamport, this.site];
      l.clocks = new Map();
    }
    const now = tileHashes(img);
    const ops = [];
    for (const [key, hsh] of now) {
      if (!resized && l.hashes.get(key) === hsh) continue;
      const [x, y] = key.split(",").map(Number);
      const w = Math.min(TILE, img.width - x);
      const h = Math.min(TILE, img.height - y);
      const c = [++this.lamport, this.site];
      l.clocks.set(key, c);
      ops.push({ o: "px", id, W: img.width, H: img.height, s: l.s, x, y, w, h, d: encodeTile(img, x, y, w, h), c });
    }
    l.hashes = now;
    return ops;
  }

  /**
   * LWW check for a validated remote tile. `apply` true = write it (after resizing the canvas to W x H when `resize`).
   * The size is a register of its own (clock `s`): tiles painted on an older size than the current one are dropped,
   * a newer size replaces the layer's size on every replica.
   */
  remote(op) {
    this.lamport = Math.max(this.lamport, op.c[0], op.s[0]);
    const known = this.layers.has(op.id);
    const l = this.#layer(op.id);
    if (known && later(l.s, op.s)) return { apply: false };
    let resize = false;
    if (!known || later(op.s, l.s)) {
      resize = l.W !== op.W || l.H !== op.H;
      l.s = op.s;
      if (resize) {
        l.W = op.W;
        l.H = op.H;
        l.clocks = new Map();
        l.hashes = new Map();
      }
    } else if (l.W !== op.W || l.H !== op.H) return { apply: false }; // same size clock, another size: malformed
    if (!later(op.c, l.clocks.get(`${op.x},${op.y}`))) return { apply: false };
    return { apply: true, resize };
  }

  /**
   * After the caller wrote the tile: remember its clock and the hash of `data` (the tile's RGBA as read back from the
   * canvas, op.w x op.h, so premultiplied-alpha rounding does not make the tile look changed) so it is not sent back.
   */
  applied(op, data) {
    const l = this.#layer(op.id);
    l.clocks.set(`${op.x},${op.y}`, op.c);
    l.hashes.set(`${op.x},${op.y}`, hashTile({ width: op.w, data }, 0, 0, op.w, op.h));
  }

  forget(id) {
    this.layers.delete(id);
  }
}
