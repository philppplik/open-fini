// Release assets and platform detection for the Download page. Pure (no DOM): the build uses it to write the asset
// table, site.js uses it in the browser, tests/site/platforms.test.js checks the mapping on user agent samples.
// Asset names follow the bundle targets of .github/workflows/release.yml (Tauri's naming).

/** @typedef {{ os: string, arch: string|null }} Platform */
/** @typedef {{ name: string, size: number, url: string, sha256?: string }} Asset */
/** @typedef {{ os: string, arch: string, kind: string, order: number }} AssetInfo */

const PATTERNS = [
  [/_x64-setup\.exe$/i, { os: "windows", arch: "x64", kind: "exe", order: 10 }],
  [/_x64_[\w-]+\.msi$/i, { os: "windows", arch: "x64", kind: "msi", order: 11 }],
  [/_arm64-setup\.exe$/i, { os: "windows", arch: "arm64", kind: "exe", order: 12 }],
  [/_aarch64\.dmg$/i, { os: "macos", arch: "arm64", kind: "dmg", order: 20 }],
  [/_x64\.dmg$/i, { os: "macos", arch: "x64", kind: "dmg", order: 21 }],
  [/_amd64\.AppImage$/i, { os: "linux", arch: "x64", kind: "appimage", order: 30 }],
  [/_amd64\.deb$/i, { os: "linux", arch: "x64", kind: "deb", order: 31 }],
  [/\.x86_64\.rpm$/i, { os: "linux", arch: "x64", kind: "rpm", order: 32 }],
  [/_aarch64\.AppImage$/i, { os: "linux", arch: "arm64", kind: "appimage", order: 33 }],
  [/_arm64\.deb$/i, { os: "linux", arch: "arm64", kind: "deb", order: 34 }],
  [/\.aarch64\.rpm$/i, { os: "linux", arch: "arm64", kind: "rpm", order: 35 }],
  [/-pwa\.zip$/i, { os: "web", arch: "any", kind: "pwa", order: 40 }],
  [/^openfini-relay\.mjs$/i, { os: "any", arch: "any", kind: "relay", order: 50 }],
];

/**
 * What a release file is, or null for files the page does not list (updater bundles, signatures, checksums).
 * @param {string} name
 * @returns {AssetInfo|null}
 */
export function classifyAsset(name) {
  for (const [re, info] of PATTERNS) if (re.test(name)) return { ...info };
  return null;
}

/**
 * Works out the operating system and CPU architecture.
 * @param {{ userAgent?: string, platform?: string, architecture?: string, bitness?: string, maxTouchPoints?: number }} env
 *   `platform`, `architecture` and `bitness` come from navigator.userAgentData.getHighEntropyValues (Chromium only).
 * @returns {Platform}
 */
export function detectPlatform({ userAgent = "", platform = "", architecture = "", bitness = "", maxTouchPoints = 0 } = {}) {
  const ua = userAgent;
  const hintArch = architecture === "arm" ? "arm64" : architecture === "x86" ? (bitness === "32" ? null : "x64") : null;
  if (/Android/i.test(ua) || platform === "Android") return { os: "android", arch: null };
  if (/iPhone|iPad|iPod/i.test(ua) || platform === "iOS") return { os: "ios", arch: null };
  // iPadOS asks for the desktop site and reports itself as a Mac; only touch tells them apart
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return { os: "ios", arch: null };
  if (/CrOS/i.test(ua) || platform === "Chrome OS") return { os: "chromeos", arch: null };
  if (/Windows/i.test(ua) || platform === "Windows") {
    const arch = hintArch ?? (/ARM64|aarch64/i.test(ua) ? "arm64" : "x64");
    return { os: "windows", arch };
  }
  if (/Mac OS X|Macintosh/i.test(ua) || platform === "macOS") return { os: "macos", arch: hintArch };
  if (/Linux|X11/i.test(ua) || platform === "Linux") {
    const arch = hintArch ?? (/aarch64|arm64/i.test(ua) ? "arm64" : /x86_64|amd64/i.test(ua) ? "x64" : null);
    return { os: "linux", arch };
  }
  return { os: "unknown", arch: null };
}

const PREFERRED = { windows: ["exe", "msi"], macos: ["dmg"], linux: ["appimage", "deb", "rpm"] };

/**
 * The one file to offer first, plus the other files for the same system.
 * macOS without a known architecture (Safari, Firefox) gets the Apple Silicon build first.
 * Phones, tablets and Chromebooks get no installer (`primary` is null).
 * @param {Platform} platform
 * @param {Asset[]} assets
 * @returns {{ primary: (Asset & AssetInfo)|null, others: (Asset & AssetInfo)[], archKnown: boolean }}
 */
export function pickDownloads(platform, assets) {
  const kinds = PREFERRED[platform.os];
  if (!kinds) return { primary: null, others: [], archKnown: false };
  const arch = platform.arch ?? (platform.os === "linux" ? "x64" : "arm64");
  const mine = assets
    .map((a) => ({ ...a, ...classifyAsset(a.name) }))
    .filter((a) => a.os === platform.os)
    .sort((a, b) => (a.arch === arch ? 0 : 1) - (b.arch === arch ? 0 : 1) || kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.order - b.order);
  return { primary: mine[0] ?? null, others: mine.slice(1), archKnown: platform.arch !== null };
}

/**
 * Parses a SHA256SUMS.txt file ("<hash>  <name>" per line).
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseSums(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m) out[m[2].trim().replace(/^.*\//, "")] = m[1].toLowerCase();
  }
  return out;
}

/** Human-readable size, e.g. "6.0 MB". Decimal units, like the operating systems' download dialogs. */
export function formatSize(bytes, locale = "en") {
  const mb = bytes / 1e6;
  const n = mb >= 1 ? mb : bytes / 1e3;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n)} ${mb >= 1 ? "MB" : "KB"}`;
}
