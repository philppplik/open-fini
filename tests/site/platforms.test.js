import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAsset, detectPlatform, formatSize, parseSums, pickDownloads } from "../../site/assets/js/platforms.js";

// the asset names of the published 1.1.3 release (release.yml bundle targets)
const NAMES = [
  "OpenFini-1.1.3-1.aarch64.rpm", "OpenFini-1.1.3-1.x86_64.rpm", "OpenFini-1.1.3-pwa.zip", "openfini-relay.mjs",
  "OpenFini_1.1.3_aarch64.app.tar.gz", "OpenFini_1.1.3_aarch64.AppImage", "OpenFini_1.1.3_aarch64.dmg",
  "OpenFini_1.1.3_amd64.AppImage", "OpenFini_1.1.3_amd64.deb", "OpenFini_1.1.3_arm64-setup.exe", "OpenFini_1.1.3_arm64.deb",
  "OpenFini_1.1.3_x64-setup.exe", "OpenFini_1.1.3_x64.app.tar.gz", "OpenFini_1.1.3_x64.dmg", "OpenFini_1.1.3_x64_en-US.msi", "SHA256SUMS.txt",
];
const ASSETS = NAMES.map((name, i) => ({ name, size: 1e6 + i, url: `https://example.test/${name}` }));

const UA = {
  winX64: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  linuxX64: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  linuxArm: "Mozilla/5.0 (X11; Linux aarch64; rv:145.0) Gecko/20100101 Firefox/145.0",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
};

const primary = (env) => pickDownloads(detectPlatform(env), ASSETS).primary?.name ?? null;

test("classifies every installer of a release and skips updater bundles and checksums", () => {
  assert.equal(classifyAsset("OpenFini_1.1.3_x64-setup.exe").kind, "exe");
  assert.deepEqual({ ...classifyAsset("OpenFini_1.1.3_arm64-setup.exe") }, { os: "windows", arch: "arm64", kind: "exe", order: 12 });
  assert.equal(classifyAsset("OpenFini_1.1.3_aarch64.dmg").arch, "arm64");
  assert.equal(classifyAsset("OpenFini-1.1.3-1.x86_64.rpm").os, "linux");
  assert.equal(classifyAsset("OpenFini-1.1.3-pwa.zip").kind, "pwa");
  assert.equal(classifyAsset("OpenFini_1.1.3_x64.app.tar.gz"), null);
  assert.equal(classifyAsset("SHA256SUMS.txt"), null);
  assert.equal(NAMES.filter((n) => classifyAsset(n)).length, 13);
});

test("Windows x64 gets the NSIS installer, ARM64 its own build", () => {
  assert.equal(primary({ userAgent: UA.winX64 }), "OpenFini_1.1.3_x64-setup.exe");
  assert.equal(primary({ userAgent: UA.winFirefox }), "OpenFini_1.1.3_x64-setup.exe");
  // Chromium on Windows ARM64 reports x86 in the user agent; the client hints tell the truth
  assert.equal(primary({ userAgent: UA.winX64, platform: "Windows", architecture: "arm", bitness: "64" }), "OpenFini_1.1.3_arm64-setup.exe");
  const others = pickDownloads(detectPlatform({ userAgent: UA.winX64 }), ASSETS).others.map((a) => a.name);
  assert.deepEqual(others, ["OpenFini_1.1.3_x64_en-US.msi", "OpenFini_1.1.3_arm64-setup.exe"]);
});

test("macOS: Apple Silicon first unless the browser says Intel", () => {
  const safari = pickDownloads(detectPlatform({ userAgent: UA.macSafari }), ASSETS);
  assert.equal(safari.primary.name, "OpenFini_1.1.3_aarch64.dmg");
  assert.equal(safari.archKnown, false);
  assert.deepEqual(safari.others.map((a) => a.name), ["OpenFini_1.1.3_x64.dmg"]);
  assert.equal(primary({ userAgent: UA.macChrome, platform: "macOS", architecture: "x86", bitness: "64" }), "OpenFini_1.1.3_x64.dmg");
  assert.equal(primary({ userAgent: UA.macChrome, platform: "macOS", architecture: "arm", bitness: "64" }), "OpenFini_1.1.3_aarch64.dmg");
});

test("Linux gets the AppImage of its architecture, packages as alternatives", () => {
  const x64 = pickDownloads(detectPlatform({ userAgent: UA.linuxX64 }), ASSETS);
  assert.equal(x64.primary.name, "OpenFini_1.1.3_amd64.AppImage");
  assert.deepEqual(x64.others.slice(0, 2).map((a) => a.name), ["OpenFini_1.1.3_amd64.deb", "OpenFini-1.1.3-1.x86_64.rpm"]);
  assert.equal(primary({ userAgent: UA.linuxArm }), "OpenFini_1.1.3_aarch64.AppImage");
});

test("phones, tablets and Chromebooks get no installer", () => {
  assert.deepEqual(detectPlatform({ userAgent: UA.android }), { os: "android", arch: null });
  assert.deepEqual(detectPlatform({ userAgent: UA.iphone }), { os: "ios", arch: null });
  // iPadOS requests the desktop site and looks like a Mac, except for touch
  assert.deepEqual(detectPlatform({ userAgent: UA.macSafari, maxTouchPoints: 5 }), { os: "ios", arch: null });
  assert.equal(detectPlatform({ userAgent: UA.chromebook }).os, "chromeos");
  for (const ua of [UA.android, UA.iphone, UA.chromebook]) assert.equal(primary({ userAgent: ua }), null);
  assert.equal(detectPlatform({ userAgent: "" }).os, "unknown");
});

test("parses SHA256SUMS.txt and formats sizes per locale", () => {
  const h = "a".repeat(64);
  assert.deepEqual(parseSums(`${h}  OpenFini_1.1.3_x64-setup.exe\n${"b".repeat(64)} *dist/OpenFini-1.1.3-pwa.zip\nnoise`), {
    "OpenFini_1.1.3_x64-setup.exe": h,
    "OpenFini-1.1.3-pwa.zip": "b".repeat(64),
  });
  assert.equal(formatSize(5981853, "en"), "6.0 MB");
  assert.equal(formatSize(5981853, "de"), "6,0 MB");
  assert.equal(formatSize(40644, "en"), "40.6 KB");
});
