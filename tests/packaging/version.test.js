import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { groupOf } from "../../scripts/check-size.mjs";
import { SEMVER, cargoLockVersion, cargoVersion, readVersions } from "../../scripts/version.mjs";

describe("scripts/version.mjs", () => {
  it("accepts release and pre-release versions only", () => {
    for (const ok of ["0.1.0", "1.2.3", "10.20.30", "1.0.0-beta.1", "2.0.0-rc.2"]) assert.ok(SEMVER.test(ok), ok);
    for (const bad of ["1.0", "v1.0.0", "01.0.0", "1.0.0+build", "1.0.0-", ""]) assert.ok(!SEMVER.test(bad), bad);
  });

  it("reads the version of the [package] table only", () => {
    const toml = '[package]\nname = "openfini"\nversion = "1.2.3"\nrust-version = "1.90"\n\n[dependencies]\nserde = { version = "9.9.9" }\n';
    assert.equal(cargoVersion(toml), "1.2.3");
    assert.equal(cargoVersion("[dependencies]\nversion = \"1.0.0\"\n"), null);
  });

  it("finds the openfini entry in a Cargo.lock", () => {
    const lock = '[[package]]\nname = "serde"\nversion = "1.0.1"\n\n[[package]]\nname = "openfini"\nversion = "0.3.0"\n';
    assert.equal(cargoLockVersion(lock), "0.3.0");
  });

  it("keeps package.json, the lockfile and Cargo.toml in sync in the repository", async () => {
    const versions = await readVersions();
    const unique = new Set(Object.values(versions));
    assert.equal(unique.size, 1, `versions differ: ${JSON.stringify(versions)}`);
    const conf = JSON.parse(await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
    assert.equal(conf.version, "../package.json", "tauri.conf.json takes its version from package.json");
  });
});

describe("scripts/check-size.mjs", () => {
  it("sorts files into budget groups", () => {
    assert.equal(groupOf("assets/main-ABC.js"), "shell-js");
    assert.equal(groupOf("sw.js"), "shell-js");
    assert.equal(groupOf("vendor/shoelace/chunks/chunk.X.js"), "vendor-js");
    assert.equal(groupOf("styles/app-1234.css"), "css");
    assert.equal(groupOf("vendor/fonts/inter.woff2"), "fonts");
    assert.equal(groupOf("icons/icon-192.png"), "images");
    assert.equal(groupOf("manifest.webmanifest"), "markup-data");
    assert.equal(groupOf("vendor/shoelace/LICENSE.md"), "legal");
    assert.equal(groupOf("vendor/fflate/LICENSE"), "legal");
  });
});
