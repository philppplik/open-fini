// Encryption at rest for the app lock: seals structured values (JSON plus Uint8Array) with a key derived from the
// lock passphrase. The crypto itself (PBKDF2-SHA256 → AES-GCM-256) is the vault in ai/vault.js; this file only adds
// the packing of binary values, the lock record and the sealed-value envelope. Pure: uses globalThis.crypto only.
import { deriveVaultKey, newVaultSalt, sealBytes, openBytes, VaultError, VAULT_ITERATIONS } from "../ai/vault.js";

const CHECK_TEXT = "openfini-lock-check:1";

export { isProtectedKey, isSealed } from "./storage.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Serializes a value made of JSON types and Uint8Array into one byte array (binary parts are not base64-encoded). */
export function packValue(value) {
  const blobs = [];
  let offset = 0;
  const header = JSON.stringify(value === undefined ? null : value, (k, v) => {
    if (v instanceof Uint8Array) {
      blobs.push(v);
      const ref = { __u8: [offset, v.byteLength] };
      offset += v.byteLength;
      return ref;
    }
    return v;
  });
  const head = enc.encode(header);
  const out = new Uint8Array(4 + head.length + offset);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  let p = 4 + head.length;
  for (const b of blobs) {
    out.set(b, p);
    p += b.byteLength;
  }
  return out;
}

/** Inverse of {@link packValue}. Binary parts are copies (their own buffers). */
export function unpackValue(bytes) {
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (4 + n > bytes.byteLength) throw new VaultError("The stored data is damaged.", "bad_format");
  const base = 4 + n;
  return JSON.parse(dec.decode(bytes.subarray(4, base)), (k, v) => {
    if (v && typeof v === "object" && Array.isArray(v.__u8) && v.__u8.length === 2) return bytes.slice(base + v.__u8[0], base + v.__u8[0] + v.__u8[1]);
    return v;
  });
}

/** Holds the derived key in memory (never persisted) and seals / opens values. */
export class AtRest {
  /** @type {CryptoKey|null} */
  key = null;
  get unlocked() {
    return !!this.key;
  }
  forget() {
    this.key = null;
  }
  async seal(value) {
    if (!this.key) throw new VaultError("The app is locked.", "locked");
    const { iv, data } = await sealBytes(this.key, packValue(value));
    return { __ofl: 1, iv, data };
  }
  async open(envelope) {
    if (!this.key) throw new VaultError("The app is locked.", "locked");
    return unpackValue(await openBytes(this.key, envelope));
  }
}

/**
 * Creates the lock record to store (salt, iteration count and a sealed check value; the passphrase itself is never
 * stored) and the unlocked key.
 */
export async function createLock(passphrase, { iterations = VAULT_ITERATIONS } = {}) {
  const salt = newVaultSalt();
  const key = await deriveVaultKey(passphrase, salt, iterations);
  const check = await sealBytes(key, enc.encode(CHECK_TEXT));
  return { record: { v: 1, iter: iterations, salt, check }, key };
}

/** Derives the key for a stored record; throws VaultError 'bad_passphrase' when the passphrase is wrong. */
export async function verifyLock(record, passphrase) {
  if (!record || record.v !== 1 || !(record.salt instanceof Uint8Array) || !record.check) throw new VaultError("Unsupported lock record.", "bad_format");
  const iter = Number(record.iter);
  if (!Number.isInteger(iter) || iter < 1 || iter > 5_000_000) throw new VaultError("Invalid lock parameters.", "bad_format");
  const key = await deriveVaultKey(passphrase, record.salt, iter);
  const text = dec.decode(await openBytes(key, record.check));
  if (text !== CHECK_TEXT) throw new VaultError("Wrong passphrase.", "bad_passphrase");
  return key;
}
