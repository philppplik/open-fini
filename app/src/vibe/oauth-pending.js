// The web/PWA sign-ins (MCP servers, OpenRouter) leave the page for the authorization server and come back with
// `?vibe_oauth=…`. The PKCE verifier, state and client registration must survive that navigation, but must not sit in
// clear text in browser storage. They are sealed with a one-time, non-extractable AES-GCM key (ai/vault.js sealOnce):
// the key object lives in IndexedDB (`<name>.key`), the ciphertext in this tab's sessionStorage (`<name>`), and both
// are removed on return; a record older than 15 minutes is refused.
// Trade-off: this keeps the secret out of clear text at rest and out of other tabs; code running in the app's own
// origin could still use the key, which no browser-only design can prevent. The desktop app never stores these
// records: its loopback flow keeps them in memory. See docs/openai-account-auth.md.
import { sealOnce, openOnce } from "../ai/vault.js";
import { kvGetRaw, kvSetRaw, kvDelete } from "../core/storage.js";

export const PENDING_TTL_MS = 15 * 60 * 1000;

/**
 * @typedef {{ get(id:string): Promise<any>, set(id:string, v:any): Promise<any>, delete(id:string): Promise<any> }} KeyStore
 * @typedef {{ getItem(k:string): string|null, setItem(k:string, v:string): void, removeItem(k:string): void }} SessionStore
 */

/** The browser's stores: IndexedDB for the key, this tab's sessionStorage for the sealed text. */
export const pendingStores = () => ({ keys: { get: kvGetRaw, set: kvSetRaw, delete: kvDelete }, session: globalThis.sessionStorage });

/**
 * Seals `data` under `name` for the return trip. Throws when the key cannot be kept (storage blocked); the caller
 * then stops instead of falling back to clear text.
 * @param {string} name
 * @param {object} data
 * @param {{ keys: KeyStore, session: SessionStore, now?: number }} stores
 */
export async function savePending(name, data, { keys, session, now = Date.now() }) {
  const { key, sealed } = await sealOnce({ ...data, expires: now + PENDING_TTL_MS });
  await keys.set(`${name}.key`, key);
  const kept = await keys.get(`${name}.key`);
  if (!kept || typeof kept !== "object") throw new Error("storage unavailable");
  session.setItem(name, sealed);
}

/**
 * Takes the record saved under `name` (one use: both parts are removed first). Returns null when it is missing,
 * expired, sealed with another key (a second sign-in started in another tab) or damaged.
 * @param {string} name
 * @param {{ keys: KeyStore, session: SessionStore, now?: number }} stores
 */
export async function takePending(name, { keys, session, now = Date.now() }) {
  let sealed = null;
  try {
    sealed = session.getItem(name);
    session.removeItem(name);
  } catch {
    /* unavailable */
  }
  let key = null;
  try {
    key = await keys.get(`${name}.key`);
    await keys.delete(`${name}.key`);
  } catch {
    /* unavailable */
  }
  if (!sealed || !key) return null;
  try {
    const rec = await openOnce(key, sealed);
    if (!rec || !(rec.expires > now)) return null;
    delete rec.expires;
    return rec;
  } catch {
    return null;
  }
}
