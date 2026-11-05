// 3D / free transform of a raster: perspective tilt around X/Y/Z with a perspective distance, skew, corner pin and a
// simple grid warp mesh. The mesh is (n+1) x (n+1) points; every cell of the source grid is mapped onto its
// destination quad with its own homography (inverse mapping, bicubic by default), so a 1 x 1 mesh is a corner pin.
// Pure: plain {width, height, data} images, no DOM. Runs on the worker pool ("pixel.warpMesh").
import { createImage } from "./image.js";
import { sampleInto, storeSampleAt } from "./transform.js";

const D2R = Math.PI / 180;

/**
 * Projects the corners of a w x h rectangle tilted in 3D. Angles in degrees (rotateX tilts top/bottom, rotateY
 * left/right, rotateZ spins in the plane), `distance` is the camera distance as a multiple of the diagonal (larger =
 * flatter), skew in degrees. Returns four [x, y] points (TL, TR, BR, BL) in the rectangle's own pixel space.
 */
export function projectRect(w, h, { rotateX = 0, rotateY = 0, rotateZ = 0, distance = 2, skewX = 0, skewY = 0, scale = 1 } = {}) {
  const cx = w / 2, cy = h / 2;
  const d = Math.max(0.2, distance) * Math.hypot(w, h);
  const [ax, ay, az] = [rotateX * D2R, rotateY * D2R, rotateZ * D2R];
  const tx = Math.tan(skewX * D2R), ty = Math.tan(skewY * D2R);
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([px, py]) => {
    let x = (px - cx) * scale, y = (py - cy) * scale, z = 0;
    [x, y] = [x + y * tx, y + x * ty];
    [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    const k = d / Math.max(d * 0.05, d + z);
    return [cx + x * k, cy + y * k];
  });
}

/** Homography (row-major 3x3, h[8] = 1) mapping the four `from` points onto the four `to` points; null if degenerate. */
export function homography(from, to) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  h.push(1);
  return h;
}

/** Applies a homography to a point. */
export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** (n+1)^2 mesh points (row-major) spread bilinearly over a quad [TL, TR, BR, BL]. */
export function meshFromQuad(quad, n = 1) {
  const [a, b, c, d] = quad;
  const pts = [];
  for (let j = 0; j <= n; j++) {
    const v = j / n;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      pts.push([(1 - v) * ((1 - u) * a[0] + u * b[0]) + v * ((1 - u) * d[0] + u * c[0]), (1 - v) * ((1 - u) * a[1] + u * b[1]) + v * ((1 - u) * d[1] + u * c[1])]);
    }
  }
  return pts;
}

/** Bounding box {x, y, w, h} (integer, outward) of a point list. */
export function pointsBounds(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const x = Math.floor(x0), y = Math.floor(y0);
  return { x, y, w: Math.max(1, Math.ceil(x1) - x), h: Math.max(1, Math.ceil(y1) - y) };
}

const cross = (a, b, px, py) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
function inTri(a, b, c, px, py) {
  const d1 = cross(a, b, px, py), d2 = cross(b, c, px, py), d3 = cross(c, a, px, py);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/**
 * Warps `img` so that its regular n x n grid lands on `points` ((n+1)^2 destination points, row-major, in the source
 * pixel space). Returns { img, x, y }: the output bitmap and its offset in that space (it covers the warped bounds).
 * @param {{filter?: 'nearest'|'bilinear'|'bicubic', maxPixels?: number}} [opts] default bicubic
 */
export function warpMesh(img, n, points, opts = {}) {
  if (points.length !== (n + 1) * (n + 1)) throw new RangeError("warpMesh: wrong number of mesh points");
  const b = pointsBounds(points);
  if (b.w * b.h > (opts.maxPixels || 100e6)) throw new RangeError("warpMesh: the result would be too large");
  const out = createImage(b.w, b.h);
  const filter = opts.filter || "bicubic";
  const { width: W, height: H } = img;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * (n + 1) + i;
      const dst = [points[k], points[k + 1], points[k + n + 2], points[k + n + 1]];
      const src = [[(i * W) / n, (j * H) / n], [((i + 1) * W) / n, (j * H) / n], [((i + 1) * W) / n, ((j + 1) * H) / n], [(i * W) / n, ((j + 1) * H) / n]];
      const Hm = homography(dst, src);
      if (!Hm) continue;
      const cb = pointsBounds(dst);
      for (let y = Math.max(0, cb.y - b.y); y < Math.min(b.h, cb.y - b.y + cb.h + 1); y++) {
        const py = y + b.y + 0.5;
        for (let x = Math.max(0, cb.x - b.x); x < Math.min(b.w, cb.x - b.x + cb.w + 1); x++) {
          const px = x + b.x + 0.5;
          if (!inTri(dst[0], dst[1], dst[2], px, py) && !inTri(dst[0], dst[2], dst[3], px, py)) continue;
          const [sx, sy] = applyH(Hm, px, py);
          if (sx < -0.5 || sy < -0.5 || sx > W + 0.5 || sy > H + 0.5) continue;
          sampleInto(filter, img.data, W, H, sx - 0.5, sy - 0.5);
          storeSampleAt(out.data, (y * b.w + x) * 4);
        }
      }
    }
  }
  return { img: out, x: b.x, y: b.y };
}
