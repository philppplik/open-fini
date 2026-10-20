import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, parseRelease, pickAsset, detectPlatform, checkForUpdates } from "../../app/src/core/updates.js";

const asset = (name) => ({ name, size: 1, browser_download_url: `https://github.com/philppplik/open-fini/releases/download/v1.0.0/${name}` });
const release = (over = {}) => ({
  tag_name: "v0.5.0",
  name: "OpenFini 0.5.0",
  html_url: "https://github.com/philppplik/open-fini/releases/tag/v0.5.0",
  body: "notes",
  assets: [asset("OpenFini_0.5.0_x64-setup.exe"), asset("OpenFini_0.5.0_arm64-setup.exe"), asset("OpenFini_0.5.0_aarch64.dmg"), asset("OpenFini_0.5.0_x64.dmg"), asset("OpenFini_0.5.0_amd64.AppImage")],
  ...over,
});
const fakeFetch = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("compareVersions orders releases and pre-releases", () => {
  assert.equal(compareVersions("0.5.0", "0.4.9"), 1);
  assert.equal(compareVersions("0.4.0", "0.4.0"), 0);
  assert.equal(compareVersions("v0.10.0", "0.9.0"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
});

test("pickAsset chooses the installer for the platform", () => {
  const a = release().assets;
  assert.match(pickAsset(a, { os: "windows", arch: "x64" }).name, /x64-setup\.exe$/);
  assert.match(pickAsset(a, { os: "windows", arch: "arm64" }).name, /arm64-setup\.exe$/);
  assert.match(pickAsset(a, { os: "macos", arch: "arm64" }).name, /aarch64\.dmg$/);
  assert.match(pickAsset(a, { os: "linux", arch: "x64" }).name, /amd64\.AppImage$/);
  assert.equal(pickAsset(a, { os: "plan9" }), null);
  assert.equal(pickAsset([{ name: "x-setup.exe", browser_download_url: "http://evil/x" }], { os: "windows" }), null, "https only");
});

test("parseRelease rejects drafts and nonsense, keeps only github links", () => {
  assert.equal(parseRelease(null), null);
  assert.equal(parseRelease(release({ draft: true })), null);
  assert.equal(parseRelease(release({ tag_name: "nightly" })), null);
  assert.equal(parseRelease(release({ html_url: "https://evil.example/x" })).url, "https://github.com/philppplik/open-fini/releases");
  assert.equal(parseRelease(release()).version, "0.5.0");
});

test("detectPlatform reads the user agent", () => {
  assert.deepEqual(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), { os: "windows", arch: "x64" });
  assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)").os, "macos");
});

test("checkForUpdates reports available, current and unknown", async () => {
  const avail = await checkForUpdates({ fetch: fakeFetch(release()), current: "0.4.0", os: "windows", arch: "x64" });
  assert.equal(avail.status, "available");
  assert.equal(avail.release.version, "0.5.0");
  assert.match(avail.release.asset.name, /setup\.exe$/);
  assert.equal((await checkForUpdates({ fetch: fakeFetch(release()), current: "0.5.0" })).status, "current");
  assert.equal((await checkForUpdates({ fetch: fakeFetch(release()), current: "0.6.0" })).status, "current");
  assert.equal((await checkForUpdates({ fetch: fakeFetch({}, 403), current: "0.4.0" })).status, "unknown");
  assert.equal((await checkForUpdates({ fetch: async () => { throw new Error("offline"); }, current: "0.4.0" })).status, "unknown");
  assert.equal((await checkForUpdates({ fetch: fakeFetch(release()), current: null })).status, "unknown");
});
