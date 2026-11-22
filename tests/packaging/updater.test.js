// In-app updates (docs/updates.md): the build stays valid without a signing key, the endpoint is the https GitHub
// release asset, and the plugin is wired in the capability, Cargo and the Release workflow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOverlay, looksLikePubkey, run, UPDATE_ENDPOINT } from "../../scripts/updater-config.mjs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const pub = Buffer.from("untrusted comment: minisign public key: ABCD\nRWQ...").toString("base64");

test("the base config has no updater plugin and no update artifacts (valid without a key)", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.equal(conf.plugins?.updater, undefined);
  assert.ok(!conf.bundle.createUpdaterArtifacts);
});

test("the overlay uses the https GitHub latest.json only and signed artifacts", () => {
  const o = buildOverlay(pub);
  assert.equal(o.bundle.createUpdaterArtifacts, true);
  assert.deepEqual(o.plugins.updater.endpoints, [UPDATE_ENDPOINT]);
  assert.match(UPDATE_ENDPOINT, /^https:\/\/github\.com\/philppplik\/open-fini\/releases\/latest\/download\/latest\.json$/);
  assert.equal(o.plugins.updater.pubkey, pub);
});

test("updater-config: without keys it only warns; with keys it writes the overlay and exports the args", () => {
  const dir = mkdtempSync(join(tmpdir(), "of-upd-"));
  const envFile = join(dir, "env");
  assert.equal(run({ RUNNER_TEMP: dir, GITHUB_ENV: envFile }), null);
  assert.equal(run({ RUNNER_TEMP: dir, TAURI_SIGNING_PRIVATE_KEY: "k", TAURI_UPDATER_PUBKEY: "not a key" }), null);
  assert.ok(!existsSync(envFile));
  const file = run({ RUNNER_TEMP: dir, GITHUB_ENV: envFile, TAURI_SIGNING_PRIVATE_KEY: "k", TAURI_UPDATER_PUBKEY: pub });
  assert.equal(JSON.parse(readFileSync(file, "utf8")).plugins.updater.pubkey, pub);
  assert.match(readFileSync(envFile, "utf8"), /^TAURI_UPDATER_ARGS=--config .*tauri-updater\.conf\.json\n$/);
  assert.ok(looksLikePubkey(pub) && !looksLikePubkey(""));
});

test("plugins are wired: Cargo, capability, lib.rs registers the updater only with a key, workflow passes the secrets", () => {
  assert.match(read("src-tauri/Cargo.toml"), /tauri-plugin-updater/);
  assert.match(read("src-tauri/Cargo.toml"), /tauri-plugin-process/);
  const perms = JSON.parse(read("src-tauri/capabilities/default.json")).permissions;
  assert.ok(perms.includes("updater:default") && perms.includes("process:allow-restart") && perms.includes("allow-update-install-kind"));
  assert.match(read("src-tauri/src/lib.rs"), /if updater::configured\(context\.config\(\)\)/);
  const wf = read(".github/workflows/release.yml");
  for (const s of ["secrets.TAURI_SIGNING_PRIVATE_KEY }}", "secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}", "vars.TAURI_UPDATER_PUBKEY }}", "uploadUpdaterJson: true", "updaterJsonPreferNsis: true"]) assert.ok(wf.includes(s), s);
});
