// Ids of the Proto document model (docs/concepts/proto-studio.md §3.1). Pure.
//
// A new id is a one-letter prefix plus 8 base-36 characters ("n" + "k3x9a0qz"): nodes "n", pages "p", variable
// collections "c", variables "v", styles "s", flows "f", media "m". Ids are unique per document and never reused by
// the operation layer. Ids read from files may be shorter ("n7"); `isId` accepts any short token without "/" or ".",
// because override paths ("n31/n22") and binding keys ("n22.text") use those characters as separators.

const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const ID_PREFIX = Object.freeze({ node: "n", page: "p", collection: "c", variable: "v", style: "s", flow: "f", media: "m" });

/** True for a well-formed id. */
export const isId = (s) => typeof s === "string" && ID_RE.test(s);

const has = (taken, id) => (!taken ? false : typeof taken === "function" ? taken(id) : taken instanceof Set || taken instanceof Map ? taken.has(id) : Object.prototype.hasOwnProperty.call(taken, id));

/**
 * A new id with `prefix` that is not in `taken` (an object map, Set, Map or predicate).
 * @param {string} [prefix]
 * @param {object|Set<string>|Map<string, unknown>|((id: string) => boolean)|null} [taken]
 * @param {() => number} [random] a source of numbers in [0, 1) (tests pass a seeded one)
 */
export function newId(prefix = "n", taken = null, random = Math.random) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let s = prefix;
    for (let i = 0; i < 8; i++) s += B36[Math.floor(random() * 36) % 36];
    if (!has(taken, s)) return s;
  }
  throw new Error("Could not find a free id.");
}

/** A small seeded random source (mulberry32) for deterministic ids in tests and scripted runs. */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
