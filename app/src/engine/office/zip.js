// ZIP access for DOCX / ODT with limits against hostile files: entry count, declared size per entry and in total
// (zip bombs), and entry names (path traversal, absolute paths). Pure; uses the vendored fflate.
import { unzipSync, zipSync, strToU8, strFromU8 } from "../../../vendor/fflate/fflate.js";

export const ZIP_LIMITS = { maxEntries: 4000, maxEntryBytes: 80 * 1024 * 1024, maxTotalBytes: 300 * 1024 * 1024 };

/** True for a safe relative entry name ("word/document.xml"); false for "../x", "/x", "C:\x" and the like. */
export function safeEntryName(name) {
  if (typeof name !== "string" || !name || name.length > 512) return false;
  if (name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name)) return false;
  return !name.split("/").some((seg) => seg === ".." || seg === ".");
}

export const isZip = (b) => b && b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);

/**
 * Reads a ZIP archive within limits. Never throws for bad archives: problems are listed in `problems`.
 * @param {Uint8Array} bytes
 * @param {{ want?: (name: string) => boolean, limits?: Partial<typeof ZIP_LIMITS> }} [o]
 * @returns {{ entries: Record<string, Uint8Array>, problems: string[], ok: boolean }}
 */
export function readZip(bytes, { want = () => true, limits = {} } = {}) {
  const L = { ...ZIP_LIMITS, ...limits };
  const problems = [];
  let count = 0;
  let total = 0;
  if (!isZip(bytes)) return { entries: {}, problems: ["The file is not a ZIP package."], ok: false };
  let entries = {};
  try {
    entries = unzipSync(bytes, {
      filter(f) {
        if (!safeEntryName(f.name)) {
          problems.push(`Skipped an entry with an unsafe name (${String(f.name).slice(0, 60)}).`);
          return false;
        }
        if (f.name.endsWith("/") || !want(f.name)) return false;
        if (++count > L.maxEntries) {
          if (count === L.maxEntries + 1) problems.push(`The package has more than ${L.maxEntries} entries; the rest was ignored.`);
          return false;
        }
        if (f.originalSize > L.maxEntryBytes) {
          problems.push(`Skipped ${f.name}: it unpacks to ${Math.round(f.originalSize / 1048576)} MB, more than the limit.`);
          return false;
        }
        total += f.originalSize;
        if (total > L.maxTotalBytes) {
          problems.push(`Skipped ${f.name}: the package unpacks to more than ${Math.round(L.maxTotalBytes / 1048576)} MB.`);
          total -= f.originalSize;
          return false;
        }
        return true;
      },
    });
  } catch (err) {
    return { entries: {}, problems: [...problems, `The package is damaged (${err?.message || "unreadable ZIP"}).`], ok: false };
  }
  // fflate trusts the declared size; a lying header can still produce a short or long buffer: re-check
  for (const [k, v] of Object.entries(entries)) if (!(v instanceof Uint8Array) || v.length > L.maxEntryBytes) delete entries[k];
  return { entries, problems, ok: true };
}

export const text = (entries, name) => (entries[name] ? strFromU8(entries[name]) : null);

/**
 * Writes a ZIP. `files` is an ordered list of [name, string|Uint8Array, {store?: boolean}] (the order is kept, so
 * ODF's "mimetype" can be first and stored).
 */
export function writeZip(files) {
  const obj = {};
  for (const [name, data, o] of files) {
    const bytes = typeof data === "string" ? strToU8(data) : data;
    obj[name] = [bytes, { level: o?.store ? 0 : 6, mtime: new Date(2020, 0, 1) }];
  }
  return zipSync(obj);
}

export { strToU8, strFromU8 };
