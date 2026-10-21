// Catalog of the extensions that ship with OpenFini (extensions/catalog.json, written by scripts/pack-extensions.mjs and
// copied next to the app by the build; in development scripts/serve.mjs serves it at the same URL). Nothing in the
// catalog is installed or enabled by default; installing goes through ExtensionHost.install with the consent dialog.
// Pure: no DOM, so it is unit tested in Node (tests/extensions-bundled/catalog.test.js).
//
// Public API: fetchCatalog(fetchFn?), entryState(entry, installedRecord, hostVersion), installEntry(host, entry, ask, fetchFn?)
import { compareVersions, satisfies } from "./semver.js";
import { unpackExtension } from "./zip.js";

export const CATALOG_BASE = "./extensions/";

/** @returns {Promise<object[]>} the catalog entries; throws a readable Error when the catalog is unavailable. */
export async function fetchCatalog(fetchFn = fetch) {
  let res;
  try {
    res = await fetchFn(`${CATALOG_BASE}catalog.json`, { cache: "no-store" });
  } catch {
    throw new Error("The list of bundled extensions could not be loaded.");
  }
  if (!res.ok) throw new Error("The list of bundled extensions is not part of this build.");
  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.extensions)) throw new Error("The list of bundled extensions is malformed.");
  return data.extensions.filter((e) => e && typeof e.id === "string" && typeof e.name === "string" && typeof e.file === "string" && /^packages\/[\w.-]+\.ofext$/.test(e.file));
}

/** How an entry relates to what is installed: "available" | "installed" | "update" | "incompatible". */
export function entryState(entry, installed, hostVersion) {
  if (hostVersion && entry.engines && !satisfies(hostVersion, entry.engines)) return "incompatible";
  if (!installed) return "available";
  return compareVersions(entry.version, installed.manifest?.version || "0.0.0") > 0 ? "update" : "installed";
}

/** Downloads a bundled package from the app's own files and installs it; `ask` is the consent dialog. */
export async function installEntry(host, entry, ask, fetchFn = fetch) {
  const res = await fetchFn(`${CATALOG_BASE}${entry.file}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`“${entry.name}” is not part of this build (HTTP ${res.status}).`);
  const files = unpackExtension(new Uint8Array(await res.arrayBuffer()));
  return host.install({ files, source: { type: "bundled", name: entry.name } }, ask);
}
