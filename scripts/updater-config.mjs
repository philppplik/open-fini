// Release workflow helper (docs/updates.md): switches on in-app updates for one build.
//
// With both the signing key (secret TAURI_SIGNING_PRIVATE_KEY) and the public key (variable TAURI_UPDATER_PUBKEY) it writes
// a Tauri config overlay (updater plugin + signed update artifacts) and exports `TAURI_UPDATER_ARGS=--config <file>` for
// the build step. Without them it prints a warning and exports nothing: the release is built exactly as before, without
// update artifacts and without latest.json, and the app falls back to "open the release page".
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const UPDATE_ENDPOINT = "https://github.com/philppplik/open-fini/releases/latest/download/latest.json";

/** The overlay merged over src-tauri/tauri.conf.json. Only the https GitHub endpoint; the plugin enforces the signature. */
export function buildOverlay(pubkey) {
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: { updater: { pubkey, endpoints: [UPDATE_ENDPOINT] } },
  };
}

/** The public key file's content (what `tauri signer generate` writes to <name>.pub) is base64 of a minisign key. */
export function looksLikePubkey(s) {
  try {
    return /^untrusted comment:/.test(Buffer.from(String(s).trim(), "base64").toString("utf8"));
  } catch {
    return false;
  }
}

export function run(env = process.env) {
  const key = (env.TAURI_SIGNING_PRIVATE_KEY || "").trim();
  const pub = (env.TAURI_UPDATER_PUBKEY || "").trim();
  if (!key || !pub) {
    const missing = [!key && "secret TAURI_SIGNING_PRIVATE_KEY", !pub && "variable TAURI_UPDATER_PUBKEY"].filter(Boolean).join(" and ");
    console.log(`::warning title=In-app updates are off::Missing ${missing}. This release has no update artifacts and no latest.json; installed apps keep opening the release page. See docs/updates.md.`);
    return null;
  }
  if (!looksLikePubkey(pub)) {
    console.log("::warning title=In-app updates are off::TAURI_UPDATER_PUBKEY is not a minisign public key (use the content of the .pub file written by `npx tauri signer generate`). See docs/updates.md.");
    return null;
  }
  const file = join(env.RUNNER_TEMP || ".", "tauri-updater.conf.json").replace(/\\/g, "/");
  writeFileSync(file, JSON.stringify(buildOverlay(pub), null, 2));
  if (env.GITHUB_ENV) appendFileSync(env.GITHUB_ENV, `TAURI_UPDATER_ARGS=--config ${file}\n`);
  console.log("In-app updates are on for this build: signed update artifacts and latest.json will be created.");
  return file;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
