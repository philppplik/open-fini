// Update checker: asks GitHub for the latest published release and compares it with the running version.
//
// Pure (no DOM): `fetch` is passed in, so it is unit-tested with a fake. The app never installs updates by itself;
// it tells the user and links to the release page / the installer that fits the platform.
//   compareVersions("0.5.0", "0.4.9") -> 1
//   parseRelease(apiJson, { os, arch }) -> { version, name, url, notes, publishedAt, prerelease, asset: {name,url,size}|null }
//   checkForUpdates({ fetch, current, os, arch, signal }) -> { status: "available"|"current"|"unknown", ... }
// Callers must go through `app.network.assert("update")` first (Settings ▸ Security and privacy ▸ Offline mode).

export const RELEASES_API = "https://api.github.com/repos/philppplik/open-fini/releases/latest";
export const RELEASES_PAGE = "https://github.com/philppplik/open-fini/releases";

const num = (s) => (/^\d+$/.test(s) ? Number(s) : s);

/** Semver-ish comparison (leading "v" ignored, pre-release suffix sorts before the release). Returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre = ""] = String(v).trim().replace(/^v/i, "").split("-");
    return { core: core.split(".").map((x) => Number(x) || 0), pre };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    const d = (x.core[i] || 0) - (y.core[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; // 1.0.0 > 1.0.0-beta
  if (!y.pre) return -1;
  const px = x.pre.split(".").map(num);
  const py = y.pre.split(".").map(num);
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    if (px[i] === undefined) return -1;
    if (py[i] === undefined) return 1;
    if (px[i] === py[i]) continue;
    if (typeof px[i] === "number" && typeof py[i] === "number") return px[i] < py[i] ? -1 : 1;
    return String(px[i]) < String(py[i]) ? -1 : 1;
  }
  return 0;
}

/** Picks the installer that matches the platform ("windows" | "macos" | "linux", arch "x64" | "arm64"). */
export function pickAsset(assets, { os = "", arch = "" } = {}) {
  const list = (assets || []).filter((a) => a && typeof a.name === "string" && /^https:\/\//.test(a.browser_download_url || ""));
  const arm = arch === "arm64";
  const rules = {
    windows: [(n) => n.endsWith(arm ? "arm64-setup.exe" : "x64-setup.exe"), (n) => n.endsWith("-setup.exe")],
    macos: [(n) => n.endsWith(".dmg") && (arm ? /aarch64|arm64/.test(n) : /x64|x86_64/.test(n)), (n) => n.endsWith(".dmg")],
    linux: [(n) => n.endsWith(".AppImage") && (arm ? /aarch64|arm64/.test(n) : /amd64|x86_64/.test(n)), (n) => n.endsWith(".AppImage")],
  }[os];
  if (!rules) return null;
  for (const rule of rules) {
    const hit = list.find((a) => rule(a.name));
    if (hit) return { name: hit.name, url: hit.browser_download_url, size: hit.size || 0 };
  }
  return null;
}

/** Turns the GitHub API answer into the fields the UI needs; null when the answer is unusable. */
export function parseRelease(json, platform = {}) {
  if (!json || typeof json.tag_name !== "string" || json.draft) return null;
  const version = json.tag_name.replace(/^v/i, "");
  if (!/^\d+\.\d+/.test(version)) return null;
  const url = /^https:\/\/github\.com\//.test(json.html_url || "") ? json.html_url : RELEASES_PAGE;
  return {
    version,
    name: String(json.name || `OpenFini ${version}`).slice(0, 120),
    url,
    notes: String(json.body || "").slice(0, 4000),
    publishedAt: json.published_at || null,
    prerelease: !!json.prerelease,
    asset: pickAsset(json.assets, platform),
  };
}

/** Detects os and arch from a user-agent string (best effort; arm detection is unreliable in browsers). */
export function detectPlatform(ua = "") {
  const os = /Windows/i.test(ua) ? "windows" : /Mac OS X|Macintosh/i.test(ua) ? "macos" : /Linux|X11/i.test(ua) ? "linux" : "";
  const arch = /arm64|aarch64|ARM/i.test(ua) ? "arm64" : "x64";
  return { os, arch };
}

/**
 * @param {{fetch?: typeof fetch, current: string|null, os?: string, arch?: string, signal?: AbortSignal}} o
 */
export async function checkForUpdates({ fetch: f = globalThis.fetch, current, os, arch, signal } = {}) {
  if (!current) return { status: "unknown", reason: "This is a development build: it has no version to compare." };
  let res;
  try {
    res = await f(RELEASES_API, { headers: { Accept: "application/vnd.github+json" }, signal });
  } catch (err) {
    return { status: "unknown", reason: `Could not reach GitHub (${err.message || "network error"}).` };
  }
  if (!res.ok) return { status: "unknown", reason: res.status === 403 ? "GitHub is limiting requests right now. Try again later." : `GitHub answered ${res.status}.` };
  let json;
  try {
    json = await res.json();
  } catch {
    return { status: "unknown", reason: "GitHub sent an unreadable answer." };
  }
  const release = parseRelease(json, { os, arch });
  if (!release) return { status: "unknown", reason: "No published release was found." };
  const cmp = compareVersions(release.version, current);
  return { status: cmp > 0 ? "available" : "current", current, release };
}
