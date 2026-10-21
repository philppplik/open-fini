// Integrity self-check: compares the files this page is actually served with the precache manifest that scripts/build.mjs
// embeds in sw.js ([path, first 12 hex chars of the SHA-256] per file). Pure: `fetchBytes` and `hash` are injected.
//
// Honest scope: this detects damaged downloads, stale or mixed caches and partially applied updates. It cannot detect a
// server that was changed to serve a different sw.js as well; for that, compare the installer with SHA256SUMS.txt.

const ENTRY = /\["([^"\\]+)","([0-9a-f]{12})"\]/g;

/**
 * Extracts the manifest from the text of a built sw.js (minified or not).
 * @param {string} swText
 * @returns {[string, string][]|null} null for the development service worker (no manifest injected)
 */
export function parseManifest(swText) {
  const text = String(swText || "");
  const block = /\[\s*\[\s*"[^"\\]+"\s*,\s*"[0-9a-f]{12}"\s*\](?:\s*,\s*\[\s*"[^"\\]+"\s*,\s*"[0-9a-f]{12}"\s*\])*\s*\]/.exec(text);
  if (!block) return null;
  const out = [];
  for (const m of block[0].replace(/\s+/g, "").matchAll(ENTRY)) out.push([m[1], m[2]]);
  return out.length ? out : null;
}

/** Hex SHA-256 prefix (12 chars) of bytes, matching the build script. */
export async function shortHash(bytes, subtle = globalThis.crypto?.subtle) {
  const d = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(d.subarray(0, 6), (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Checks files against the manifest.
 * @param {{manifest:[string,string][], fetchBytes:(path:string)=>Promise<Uint8Array>, hash?:(b:Uint8Array)=>Promise<string>,
 *   filter?:(path:string)=>boolean, concurrency?:number, onProgress?:(done:number,total:number)=>void, signal?:{aborted:boolean}}} o
 * @returns {Promise<{checked:number, ok:number, mismatched:string[], missing:string[], skipped:number, aborted:boolean}>}
 */
export async function verifyFiles({ manifest, fetchBytes, hash = shortHash, filter = () => true, concurrency = 8, onProgress, signal }) {
  const list = manifest.filter(([p]) => filter(p));
  const result = { checked: 0, ok: 0, mismatched: [], missing: [], skipped: manifest.length - list.length, aborted: false };
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < list.length) {
      if (signal?.aborted) {
        result.aborted = true;
        return;
      }
      const [path, expected] = list[next++];
      try {
        const actual = await hash(await fetchBytes(path));
        result.checked++;
        if (actual === expected) result.ok++;
        else result.mismatched.push(path);
      } catch {
        result.missing.push(path);
      }
      onProgress?.(++done, list.length);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length || 1)) }, worker));
  result.mismatched.sort();
  result.missing.sort();
  return result;
}

/** One-sentence summary of a result. */
export function integritySummary(r) {
  if (r.aborted) return "The check was cancelled.";
  if (!r.mismatched.length && !r.missing.length) return `All ${r.ok} checked files match the build manifest.`;
  return `${r.mismatched.length} file${r.mismatched.length === 1 ? "" : "s"} differ and ${r.missing.length} could not be read out of ${r.checked + r.missing.length} checked. Reload the app; if this persists, reinstall it or clear the offline cache.`;
}
