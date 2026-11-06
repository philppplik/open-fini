// Display-list preparation for PDF export: spreads and image placement analysis. Pure, no DOM (the resampling and
// JPEG encoding that act on the results live in core/export-run.js).
//
// Public API:
//   combineSpread(lists)                 -> one display list with the pages side by side (left to right)
//   imagePlacements(list, dpi)           -> [{ item, parent, index, ppi }]  every image item with its effective resolution
//   downsampleTarget(img, ppi, target)   -> { width, height } | null   new pixel size, or null when no resampling is needed
//   replaceImage(item, ref)              -> a copy of the image item that shows `ref` at the same place and size
// Invariants: matrices are canvas style [a, b, c, d, e, f]; images in masks are left alone (they shape, not paint).

/** Pages side by side: the second page starts where the first ends; height is the tallest page. */
export function combineSpread(lists) {
  if (lists.length === 1) return lists[0];
  let x = 0;
  const items = [];
  for (const dl of lists) {
    const dx = x;
    for (const it of dl.items) items.push(it.m ? { ...it, m: [it.m[0], it.m[1], it.m[2], it.m[3], it.m[4] + dx, it.m[5]] } : { t: "group", m: [1, 0, 0, 1, dx, 0], items: [it] });
    x += dl.width;
  }
  return { width: x, height: Math.max(...lists.map((d) => d.height)), items };
}

const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const IDENT = [1, 0, 0, 1, 0, 0];

/**
 * Every painted image with its effective resolution (the lower of the horizontal and vertical pixels per inch on the
 * page). `parent.items[index] === item`, so callers can replace it.
 */
export function imagePlacements(list, dpi = 96) {
  const out = [];
  const walk = (parent, m) => {
    parent.items.forEach((it, index) => {
      const mm = it.m ? mul(m, it.m) : m;
      if (it.t === "group" && Array.isArray(it.items)) walk(it, mm);
      else if (it.t === "image" && it.img && it.img.width > 0 && it.img.height > 0) {
        const sx = Math.hypot(mm[0], mm[1]);
        const sy = Math.hypot(mm[2], mm[3]);
        if (sx > 0 && sy > 0) out.push({ item: it, parent, index, ppi: Math.min(dpi / sx, dpi / sy) });
      }
    });
  };
  walk(list, IDENT);
  return out;
}

/** New pixel size when an image placed at `ppi` exceeds 1.5 x the target (the usual "downsample above" threshold). */
export function downsampleTarget(img, ppi, target) {
  if (!(target > 0) || !(ppi > target * 1.5)) return null;
  const k = target / ppi;
  return { width: Math.max(1, Math.round(img.width * k)), height: Math.max(1, Math.round(img.height * k)) };
}

/** The image item drawing `ref` (any pixel size) over the same area as before. */
export function replaceImage(item, ref) {
  const sx = item.img.width / ref.width;
  const sy = item.img.height / ref.height;
  const m = item.m || IDENT;
  return { ...item, img: ref, m: [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]] };
}
