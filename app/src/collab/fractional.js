// Fractional ordering keys for "Edit together" (docs/collaboration.md ▸ Live editing). Pure (no DOM).
//
// A key is a non-empty string of base-62 digits (0-9, A-Z, a-z, compared by plain string order) that never ends in
// "0". Between any two keys a < b there is always another key, so a sibling can be inserted or moved anywhere without
// renumbering the others. Concurrent inserts at the same place may produce the same key; callers break ties by node id,
// which keeps the order identical on every replica.
//
// Public API
//   DIGITS                     the alphabet
//   keyBetween(a, b)           a key strictly between a and b (null = open end)
//   keysBetween(a, b, n)       n increasing keys strictly between a and b
//   initialKey(i, n)           deterministic key of position i in a list of n (used when every replica starts from the
//                              same snapshot, so they all compute the same keys without talking)
//   isKey(k)                   validates a key received from another member
export const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0];
const MAX_LEN = 256;

function midpoint(a, b) {
  // a < b as fractions 0.a and 0.b (b === null means 1)
  if (b !== null) {
    let n = 0;
    while ((a[n] || ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

/** A key strictly between `a` and `b` (either may be null for "start"/"end"). Throws when a >= b. */
export function keyBetween(a = null, b = null) {
  if (a !== null && !isKey(a)) throw new Error(`invalid key ${a}`);
  if (b !== null && !isKey(b)) throw new Error(`invalid key ${b}`);
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);
  return midpoint(a || "", b);
}

/** `n` increasing keys strictly between `a` and `b`. */
export function keysBetween(a = null, b = null, n = 1) {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  // split the interval recursively so keys stay short
  const mid = keyBetween(a, b);
  const left = Math.floor((n - 1) / 2);
  return [...keysBetween(a, mid, left), mid, ...keysBetween(mid, b, n - 1 - left)];
}

/** Deterministic key for index `i` of `n` items: fixed-width base-62 digits plus "V" (never ends in "0"). */
export function initialKey(i, n) {
  let width = 1;
  while (DIGITS.length ** width < n + 1) width++;
  let x = i + 1;
  let s = "";
  for (let k = 0; k < width; k++) {
    s = DIGITS[x % 62] + s;
    x = Math.floor(x / 62);
  }
  return `${s}V`;
}

export const isKey = (k) => typeof k === "string" && k.length > 0 && k.length <= MAX_LEN && /^[0-9A-Za-z]+$/.test(k) && k[k.length - 1] !== ZERO;
