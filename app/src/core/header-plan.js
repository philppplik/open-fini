// Responsive header planning (pure). The shell header sheds things in a fixed order until it fits: see ui/header-fit.js.
// `ops` are steps ({ set(on) }) in shedding order; `overflows()` measures. Returns the number of steps that are on.
// It starts at `from` (the previous result) so a resize does not rebuild everything: grow while it overflows, then try
// to give one step back at a time while it still fits.
export function fitSteps(ops, overflows, from = 0) {
  let n = Math.max(0, Math.min(from, ops.length));
  const apply = (k) => ops.forEach((op, i) => op.set(i < k));
  apply(n);
  while (n < ops.length && overflows()) apply(++n);
  while (n > 0) {
    apply(n - 1);
    if (overflows()) {
      apply(n);
      break;
    }
    n--;
  }
  return n;
}
