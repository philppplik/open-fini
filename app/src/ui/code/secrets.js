// Tokens and passwords for Git remotes and publish targets. They live in this device's private storage (never in a
// document) — plain like AI keys, or sealed with the Vibe vault passphrase when the vault is on. `publish.secrets` is
// also encrypted by the app lock. Values are returned only to code that sends them to the configured host.
import { kvGet, kvSet } from "../../core/storage.js";

const KEY = "publish.secrets";

async function vault() {
  const { vibeStore } = await import("../../vibe/store.js");
  await vibeStore.load();
  return vibeStore;
}

async function readAll() {
  const raw = (await kvGet(KEY)) || {};
  if (!raw.sealed) return raw;
  const v = await vault();
  if (!v.passphrase) throw new Error("Your key vault is locked. Unlock it in Settings ▸ Artificial intelligence ▸ Models first.");
  const { decryptJson } = await import("../../ai/index.js");
  return decryptJson(raw.sealed, v.passphrase);
}

async function writeAll(all) {
  const v = await vault();
  if (v.settings.vault) {
    if (!v.passphrase) throw new Error("Your key vault is locked. Unlock it in Settings ▸ Artificial intelligence ▸ Models first.");
    const { encryptJson } = await import("../../ai/index.js");
    await kvSet(KEY, { sealed: await encryptJson(all, v.passphrase) });
  } else await kvSet(KEY, all);
}

export async function getSecret(id) {
  return (await readAll())[id] || "";
}
export async function hasSecret(id) {
  try {
    return !!(await getSecret(id));
  } catch {
    return false;
  }
}
export async function setSecret(id, value) {
  const all = await readAll();
  if (value) all[id] = value;
  else delete all[id];
  await writeAll(all);
}
