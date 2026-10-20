// Key vault helpers: passphrase encryption (WebCrypto PBKDF2 + AES-GCM), key masking, random ids and
// OpenRouter OAuth PKCE helpers. Pure: uses globalThis.crypto only; `fetch` is injected.

import { base64ToBytes, bytesToBase64, bytesToBase64Url, doFetch } from "./util.js";

const KDF_ITERATIONS = 250000;
const AAD = new TextEncoder().encode("openfini-vault:1");

/** Error for vault failures. `code` is 'bad_passphrase' | 'bad_format' | 'no_crypto'. */
export class VaultError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new VaultError("WebCrypto is not available in this environment.", "no_crypto");
  return c;
}

async function deriveKey(passphrase, salt, iterations) {
  const c = subtle();
  const base = await c.subtle.importKey("raw", new TextEncoder().encode(String(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return c.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypts any JSON-serializable value with a passphrase (PBKDF2-SHA256 250k iterations, AES-GCM-256,
 * random salt and IV). Returns a versioned, JSON-safe envelope with base64 fields.
 * @param {any} value
 * @param {string} passphrase
 * @param {{iterations?:number}} [opts] lower `iterations` only for tests
 * @returns {Promise<{v:1,kdf:'PBKDF2-SHA256',iter:number,cipher:'AES-GCM',salt:string,iv:string,data:string}>}
 */
export async function encryptJson(value, passphrase, { iterations = KDF_ITERATIONS } = {}) {
  if (!passphrase) throw new VaultError("A passphrase is required.", "bad_passphrase");
  const c = subtle();
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, plain));
  return { v: 1, kdf: "PBKDF2-SHA256", iter: iterations, cipher: "AES-GCM", salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(ct) };
}

/**
 * Decrypts an envelope from {@link encryptJson} (object or JSON string).
 * @param {object|string} blob
 * @param {string} passphrase
 * @returns {Promise<any>}
 * @throws {VaultError} 'bad_passphrase' for a wrong passphrase or tampered data, 'bad_format' for unknown envelopes
 */
export async function decryptJson(blob, passphrase) {
  let env = blob;
  if (typeof blob === "string") {
    try {
      env = JSON.parse(blob);
    } catch {
      throw new VaultError("The vault data is not valid JSON.", "bad_format");
    }
  }
  if (!env || env.v !== 1 || env.cipher !== "AES-GCM" || env.kdf !== "PBKDF2-SHA256" || !env.salt || !env.iv || !env.data) throw new VaultError("Unsupported vault format.", "bad_format");
  const iter = Number(env.iter);
  if (!Number.isInteger(iter) || iter < 1 || iter > 5_000_000) throw new VaultError("Invalid vault parameters.", "bad_format");
  const c = subtle();
  try {
    const key = await deriveKey(passphrase, base64ToBytes(env.salt), iter);
    const plain = await c.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(env.iv), additionalData: AAD }, key, base64ToBytes(env.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError("Wrong passphrase or damaged vault data.", "bad_passphrase");
  }
}

// ---- raw building blocks for other at-rest encryption (app lock): derive once, seal many values

/** Derives the AES-GCM key of a passphrase (same KDF and parameters as {@link encryptJson}). The key is not extractable. */
export function deriveVaultKey(passphrase, salt, iterations = KDF_ITERATIONS) {
  if (!passphrase) throw new VaultError("A passphrase is required.", "bad_passphrase");
  return deriveKey(passphrase, salt, iterations);
}

/** Fresh random salt for {@link deriveVaultKey}. */
export const newVaultSalt = () => subtle().getRandomValues(new Uint8Array(16));
export const VAULT_ITERATIONS = KDF_ITERATIONS;

/** Encrypts bytes with a derived key (AES-GCM, random IV, same associated data as the JSON vault). */
export async function sealBytes(key, bytes) {
  const c = subtle();
  const iv = c.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, bytes));
  return { iv, data: ct };
}

/** Decrypts the result of {@link sealBytes}. Throws VaultError 'bad_passphrase' when the key is wrong or data was changed. */
export async function openBytes(key, { iv, data }) {
  try {
    return new Uint8Array(await subtle().subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, data));
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError("Wrong passphrase or damaged data.", "bad_passphrase");
  }
}

/**
 * Masks an API key for display, e.g. `sk-o...cdef`. Short keys are fully masked.
 * @param {string} key
 */
export function maskKey(key) {
  const k = String(key ?? "");
  if (!k) return "";
  if (k.length <= 8) return "•".repeat(k.length);
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

/**
 * Random hex id with an optional prefix.
 * @param {string} [prefix]
 * @param {number} [bytes=8]
 */
export function randomId(prefix = "", bytes = 8) {
  const a = subtle().getRandomValues(new Uint8Array(bytes));
  return prefix + Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ PKCE (RFC 7636) + OpenRouter OAuth

/**
 * Computes the S256 code challenge for a verifier: BASE64URL(SHA256(ASCII(verifier))).
 * @param {string} verifier
 * @returns {Promise<string>}
 */
export async function pkceChallenge(verifier) {
  const d = await subtle().subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(d));
}

/**
 * Creates a PKCE verifier (43 chars), its S256 challenge and a random `state`.
 * @returns {Promise<{verifier:string, challenge:string, state:string}>}
 */
export async function createPkce() {
  const verifier = bytesToBase64Url(subtle().getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: await pkceChallenge(verifier), state: randomId("", 12) };
}

/**
 * Builds the OpenRouter authorization URL. `state` (optional) is appended to the callback URL as a query parameter
 * because OpenRouter returns the callback's own query string untouched.
 * @param {{callbackUrl:string, challenge:string, state?:string}} o
 * @returns {string}
 */
export function openRouterAuthUrl({ callbackUrl, challenge, state }) {
  let cb = callbackUrl;
  if (state) {
    const u = new URL(callbackUrl);
    u.searchParams.set("state", state);
    cb = u.toString();
  }
  const q = new URLSearchParams({ callback_url: cb, code_challenge: challenge, code_challenge_method: "S256" });
  return `https://openrouter.ai/auth?${q.toString()}`;
}

/**
 * Exchanges the OAuth `code` for a user-controlled OpenRouter API key.
 * @param {{code:string, verifier:string, fetch?:typeof fetch, signal?:AbortSignal}} o
 * @returns {Promise<{key:string, userId?:string}>}
 */
export async function exchangeOpenRouterCode({ code, verifier, fetch: f, signal }) {
  const fn = f || ((...a) => globalThis.fetch(...a));
  const res = await doFetch(
    fn,
    "https://openrouter.ai/api/v1/auth/keys",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }), signal },
    "openrouter",
  );
  const j = await res.json();
  if (!j || typeof j.key !== "string") throw new VaultError("OpenRouter did not return a key.", "bad_format");
  return { key: j.key, ...(j.user_id ? { userId: j.user_id } : {}) };
}
