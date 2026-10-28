// Office Toolkit: virtualization math for very large grids and lists (a sheet with a million rows, a long slide
// sorter). An Axis maps item indexes to pixel offsets with a default size and sparse custom sizes, and answers "which
// items are visible" in O(log n) without allocating per item. Pure; tests in tests/office/toolkit.test.js. The DOM
// component that uses it is toolkit/ui.js ▸ virtualGrid.
//
// Public API
//   createAxis({ count, size, sizes? }) → axis
//     axis.count, axis.total                      item count and total length in px
//     axis.offsetOf(i) → px                        start of item i (i may equal count: the end)
//     axis.sizeOf(i) → px
//     axis.indexAt(px) → i                         item under a pixel position (clamped to 0 .. count-1)
//     axis.visible(scroll, viewport, overscan?) → { start, end }   end exclusive
//     axis.setSize(i, px) / axis.setCount(n)       custom sizes (row heights, column widths); 0 hides an item
// Invariants: sizes are finite and ≥ 0; custom sizes are kept sorted by index; offsetOf is monotonic.

export function createAxis({ count = 0, size = 20, sizes = null } = {}) {
  let n = Math.max(0, Math.floor(count));
  const base = Math.max(0, size);
  /** sorted custom entries: [index, size] */
  let custom = [];
  /** prefix of (custom - base) deltas: delta[k] = sum over custom[0..k-1] */
  let delta = [0];
  const rebuild = () => {
    custom.sort((a, b) => a[0] - b[0]);
    delta = [0];
    for (const [, s] of custom) delta.push(delta[delta.length - 1] + (s - base));
  };
  if (sizes) {
    for (const [i, s] of sizes instanceof Map ? sizes : Object.entries(sizes)) custom.push([Number(i), Math.max(0, Number(s) || 0)]);
    rebuild();
  }
  /** number of custom entries with index < i */
  const before = (i) => {
    let lo = 0;
    let hi = custom.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (custom[mid][0] < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const offsetOf = (i) => {
    const k = Math.max(0, Math.min(n, Math.floor(i)));
    return k * base + delta[before(k)];
  };
  const sizeOf = (i) => {
    const k = before(i);
    return custom[k] && custom[k][0] === i ? custom[k][1] : base;
  };
  const axis = {
    get count() {
      return n;
    },
    get total() {
      return offsetOf(n);
    },
    offsetOf,
    sizeOf,
    indexAt(px) {
      if (n === 0) return 0;
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsetOf(mid) <= px) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    visible(scroll, viewport, overscan = 2) {
      if (n === 0) return { start: 0, end: 0 };
      const start = Math.max(0, axis.indexAt(Math.max(0, scroll)) - overscan);
      const end = Math.min(n, axis.indexAt(scroll + Math.max(0, viewport)) + 1 + overscan);
      return { start, end };
    },
    setSize(i, s) {
      const k = before(i);
      const v = Math.max(0, Number(s) || 0);
      if (custom[k] && custom[k][0] === i) {
        if (v === base) custom.splice(k, 1);
        else custom[k][1] = v;
      } else if (v !== base) custom.splice(k, 0, [i, v]);
      rebuild();
    },
    setCount(c) {
      n = Math.max(0, Math.floor(c));
      custom = custom.filter(([i]) => i < n);
      rebuild();
    },
  };
  return axis;
}
