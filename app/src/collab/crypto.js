// Collaboration crypto: invite codes, room keys, the signed + encrypted message envelope, the room fingerprint
// (short authentication string) and key wrapping for rotation. Pure: WebCrypto (globalThis.crypto) only, no DOM.
// Runs in browsers, Tauri webviews and Node 20+ (tests).
//
// Design (docs/collaboration.md ▸ Crypto, docs/adr/0010-collaboration-e2e.md):
//   * A room has a random 256-bit SECRET and a random ROOM ID. The invite code carries both, plus the host's member id,
//     in the URL fragment: `wss://relay.example:8787/#ofc1.<room>.<secret>.<hostId>` (`local#ofc1…` for same-device
//     rooms). Fragments are never sent to servers by browsers; the relay only ever learns the room id.
//   * From the secret HKDF-SHA256 derives (salt = "ofc1:" + room id, info names the purpose and the key epoch):
//       - the AES-GCM-256 room key (per epoch),
//       - the relay ACCESS TOKEN (the relay pins the first token it sees for a room and refuses peers without it, so
//         knowing only the room id is not enough to join or flood a room),
//       - the 48-bit room FINGERPRINT shown as six words, compared out of band.
//   * Every member creates a fresh ECDSA P-256 (signing) and ECDH P-256 (key agreement) key pair per session. The
//     MEMBER ID is the first 16 bytes of SHA-256(signing public key), so ids cannot be claimed without the key.
//   * Envelope = { v, e: epoch, s: sender id, n: counter, k: signing public key, iv, ct, sig }:
//       AAD  = "ofc1|<room>|<epoch>|<sender>|<counter>"  (binds room, key epoch, sender and order to the ciphertext)
//       sig  = ECDSA-SHA256(AAD | iv | ct) with the sender's signing key (stops members impersonating each other)
//     Receivers check id == hash(k), the signature, then decrypt, then the counter (strictly increasing per sender
//     and epoch: replays and reordering are rejected).
//   * Rotation (a member left or was removed): the host draws a new secret and room id and wraps them for every
//     remaining member with ECDH(host, member) + HKDF + AES-GCM. A removed member cannot unwrap them.
//
// Public API: see the exports below. Errors are CollabCryptoError with `code`:
//   'bad_invite' | 'bad_envelope' | 'bad_signature' | 'bad_sender' | 'decrypt' | 'replay' | 'no_crypto'.

import { SAS_WORDS } from "./wordlist.js";

export const INVITE_TAG = "ofc1";
export const SECRET_BYTES = 32;
export const ROOM_ID_BYTES = 16;
export const MEMBER_ID_BYTES = 16;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class CollabCryptoError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = "CollabCryptoError";
    this.code = code;
  }
}

function wc() {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new CollabCryptoError("WebCrypto is not available here. Collaboration needs a secure context (https, localhost or the desktop app).", "no_crypto");
  return c;
}

// ------------------------------------------------------------------ base64url

export function b64u(bytes) {
  let s = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64u(text) {
  const s = String(text);
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new CollabCryptoError("Invalid base64url text.", "bad_envelope");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const randomB64u = (n) => b64u(wc().getRandomValues(new Uint8Array(n)));
export const newRoomSecret = () => randomB64u(SECRET_BYTES);
export const newRoomId = () => randomB64u(ROOM_ID_BYTES);

// ------------------------------------------------------------------ invite codes

const B64U_RE = (n) => new RegExp(`^[A-Za-z0-9_-]{${n}}$`);
const ROOM_RE = B64U_RE(22);
const SECRET_RE = B64U_RE(43);
const MEMBER_RE = B64U_RE(22);

/** Checks a relay address: `local` (same device) or a ws:// / wss:// URL without credentials, query or fragment. */
export function normalizeRelay(relay) {
  const r = String(relay || "").trim();
  if (r === "local") return "local";
  let u;
  try {
    u = new URL(r);
  } catch {
    throw new CollabCryptoError("The relay address is not a valid URL (expected ws://host:port or wss://host).", "bad_invite");
  }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") throw new CollabCryptoError("The relay address must start with ws:// or wss://.", "bad_invite");
  if (u.username || u.password) throw new CollabCryptoError("The relay address must not contain a user name or password.", "bad_invite");
  if (u.search || u.hash) throw new CollabCryptoError("The relay address must not contain a query or fragment.", "bad_invite");
  return `${u.protocol}//${u.host}${u.pathname === "/" ? "/" : u.pathname}`;
}

/** Builds the invite code. The secret part sits in the URL fragment so it never reaches a server. */
export function formatInvite({ relay, room, secret, host }) {
  const r = normalizeRelay(relay);
  if (!ROOM_RE.test(room) || !SECRET_RE.test(secret) || !MEMBER_RE.test(host)) throw new CollabCryptoError("Invalid room parameters.", "bad_invite");
  return `${r}#${INVITE_TAG}.${room}.${secret}.${host}`;
}

/** Parses an invite code. Throws CollabCryptoError('bad_invite') with a readable message. */
export function parseInvite(text) {
  const s = String(text || "").trim();
  if (s.length > 600) throw new CollabCryptoError("This is not an OpenFini invite code (too long).", "bad_invite");
  const i = s.lastIndexOf(`#${INVITE_TAG}.`);
  if (i < 0) throw new CollabCryptoError("This is not an OpenFini invite code. It looks like wss://host/#ofc1.…", "bad_invite");
  const relay = normalizeRelay(s.slice(0, i));
  const parts = s.slice(i + 1).split(".");
  if (parts.length !== 4) throw new CollabCryptoError("The invite code is incomplete. Copy the whole code.", "bad_invite");
  const [, room, secret, host] = parts;
  if (!ROOM_RE.test(room) || !SECRET_RE.test(secret) || !MEMBER_RE.test(host)) throw new CollabCryptoError("The invite code is damaged. Copy the whole code again.", "bad_invite");
  return { relay, room, secret, host };
}

/** "wss://relay.example:8787/" → "relay.example:8787", "local" → "this device". For display only. */
export function relayHost(relay) {
  if (relay === "local") return "this device";
  try {
    return new URL(relay).host;
  } catch {
    return "?";
  }
}

// ------------------------------------------------------------------ room keys

async function hkdfBase(secret) {
  const raw = unb64u(secret);
  if (raw.length !== SECRET_BYTES) throw new CollabCryptoError("The room secret has the wrong length.", "bad_invite");
  return wc().subtle.importKey("raw", raw, "HKDF", false, ["deriveKey", "deriveBits"]);
}
const hkdf = (info, room) => ({ name: "HKDF", hash: "SHA-256", salt: enc.encode(`ofc1:${room}`), info: enc.encode(`openfini-collab/v1/${info}`) });

/**
 * Derives everything a member needs from the room secret.
 * @returns {Promise<{room:string, epoch:number, key:CryptoKey, accessToken:string, fingerprint:string[]}>}
 */
export async function deriveRoom({ secret, room, host, epoch = 0 }) {
  const base = await hkdfBase(secret);
  const s = wc().subtle;
  const key = await s.deriveKey(hkdf(`aes/${epoch}`, room), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const access = new Uint8Array(await s.deriveBits(hkdf("relay-access", room), base, 128));
  const fp = new Uint8Array(await s.deriveBits(hkdf(`fingerprint/${host}`, room), base, 48));
  return { room, epoch, key, accessToken: b64u(access), fingerprint: [...fp].map((b) => SAS_WORDS[b]) };
}

// ------------------------------------------------------------------ identities

/** SHA-256 of the raw signing public key, first 16 bytes, base64url (22 chars). */
export async function memberIdOf(signPubRaw) {
  const d = new Uint8Array(await wc().subtle.digest("SHA-256", signPubRaw));
  return b64u(d.subarray(0, MEMBER_ID_BYTES));
}

/** A fresh per-session identity: signing + key-agreement key pairs and the derived member id. */
export async function newIdentity() {
  const s = wc().subtle;
  const sign = await s.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const dh = await s.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const signPub = new Uint8Array(await s.exportKey("raw", sign.publicKey));
  const dhPub = new Uint8Array(await s.exportKey("raw", dh.publicKey));
  return { id: await memberIdOf(signPub), sign, dh, signPub: b64u(signPub), dhPub: b64u(dhPub) };
}

const pubCache = new Map();
async function importSignPub(b64) {
  let k = pubCache.get(b64);
  if (!k) {
    k = await wc().subtle.importKey("raw", unb64u(b64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (pubCache.size > 256) pubCache.clear();
    pubCache.set(b64, k);
  }
  return k;
}

// ------------------------------------------------------------------ envelope

export const aadOf = (room, epoch, sender, counter) => `${INVITE_TAG}|${room}|${epoch}|${sender}|${counter}`;
const ECDSA = { name: "ECDSA", hash: "SHA-256" };

/**
 * Encrypts and signs one message.
 * @param {{room:string, epoch:number, key:CryptoKey}} roomKeys
 * @param {{id:string, sign:CryptoKeyPair, signPub:string}} me
 * @param {number} counter strictly increasing per sender and epoch
 * @param {object} message plaintext object (validated by protocol.js before sending)
 * @returns {Promise<string>} the wire frame (JSON text)
 */
export async function seal(roomKeys, me, counter, message) {
  const c = wc();
  const iv = c.getRandomValues(new Uint8Array(12));
  const aad = aadOf(roomKeys.room, roomKeys.epoch, me.id, counter);
  const ct = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, roomKeys.key, enc.encode(JSON.stringify(message))));
  const ivs = b64u(iv);
  const cts = b64u(ct);
  const sig = new Uint8Array(await c.subtle.sign(ECDSA, me.sign.privateKey, enc.encode(`${aad}|${ivs}|${cts}`)));
  return JSON.stringify({ v: 1, e: roomKeys.epoch, s: me.id, n: counter, k: me.signPub, iv: ivs, ct: cts, sig: b64u(sig) });
}

/** Replay guard: remembers the last counter per epoch and sender. */
export class ReplayGuard {
  #last = new Map();
  /** Throws CollabCryptoError('replay') unless `counter` is larger than every earlier one of this sender. */
  check(epoch, sender, counter) {
    const k = `${epoch}|${sender}`;
    const last = this.#last.get(k);
    if (last !== undefined && counter <= last) throw new CollabCryptoError("Replayed or reordered message rejected.", "replay");
    if (this.#last.size > 4096) this.#last.clear();
    this.#last.set(k, counter);
  }
}

/**
 * Verifies, decrypts and replay-checks a wire frame. Never trusts anything before the signature and AEAD checks.
 * @param {{room:string, epoch:number, key:CryptoKey}} roomKeys
 * @param {string} frame
 * @param {ReplayGuard} guard
 * @returns {Promise<{sender:string, signPub:string, counter:number, message:any}>}
 */
export async function open(roomKeys, frame, guard) {
  let env;
  try {
    env = typeof frame === "string" ? JSON.parse(frame) : null;
  } catch {
    env = null;
  }
  const bad = (m) => new CollabCryptoError(m, "bad_envelope");
  if (!env || typeof env !== "object" || env.v !== 1) throw bad("Unknown message format.");
  const { e, s, n, k, iv, ct, sig } = env;
  if (!Number.isInteger(e) || e < 0 || !Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) throw bad("Invalid message header.");
  if (typeof s !== "string" || !MEMBER_RE.test(s) || typeof k !== "string" || k.length > 120 || typeof iv !== "string" || iv.length !== 16 || typeof ct !== "string" || typeof sig !== "string" || sig.length > 120) throw bad("Invalid message fields.");
  if (e !== roomKeys.epoch) throw new CollabCryptoError("Message for another key epoch.", "decrypt");
  const signPubRaw = unb64u(k);
  if ((await memberIdOf(signPubRaw)) !== s) throw new CollabCryptoError("The sender id does not match its key.", "bad_sender");
  const aad = aadOf(roomKeys.room, e, s, n);
  let ok = false;
  try {
    ok = await wc().subtle.verify(ECDSA, await importSignPub(k), unb64u(sig), enc.encode(`${aad}|${iv}|${ct}`));
  } catch {
    ok = false;
  }
  if (!ok) throw new CollabCryptoError("Invalid signature.", "bad_signature");
  let plain;
  try {
    plain = await wc().subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv), additionalData: enc.encode(aad) }, roomKeys.key, unb64u(ct));
  } catch {
    throw new CollabCryptoError("The message could not be decrypted (wrong room key or tampered data).", "decrypt");
  }
  guard?.check(e, s, n);
  let message;
  try {
    message = JSON.parse(dec.decode(plain));
  } catch {
    throw bad("The message content is not valid JSON.");
  }
  return { sender: s, signPub: k, counter: n, message };
}

// ------------------------------------------------------------------ key wrapping (rotation)

async function pairKey(myDhPrivate, theirDhPub, purpose) {
  const s = wc().subtle;
  const pub = await s.importKey("raw", unb64u(theirDhPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await s.deriveBits({ name: "ECDH", public: pub }, myDhPrivate, 256);
  const base = await s.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return s.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(`openfini-collab/v1/wrap/${purpose}`) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Encrypts `value` (JSON) for one member: ECDH(my key, their key) → HKDF → AES-GCM. `aad` binds the context. */
export async function wrapFor(myDh, theirDhPub, value, aad) {
  const c = wc();
  const key = await pairKey(myDh.privateKey, theirDhPub, aad);
  const iv = c.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(value))));
  return { iv: b64u(iv), ct: b64u(ct) };
}

/** Reverses {@link wrapFor} with my ECDH key and the sender's public key. */
export async function unwrapFrom(myDh, theirDhPub, wrapped, aad) {
  try {
    const key = await pairKey(myDh.privateKey, theirDhPub, aad);
    const plain = await wc().subtle.decrypt({ name: "AES-GCM", iv: unb64u(wrapped.iv), additionalData: enc.encode(aad) }, key, unb64u(wrapped.ct));
    return JSON.parse(dec.decode(plain));
  } catch {
    throw new CollabCryptoError("The new room key could not be unwrapped.", "decrypt");
  }
}

/** SHA-256 of bytes as base64url (file integrity in transfers). */
export async function sha256B64u(bytes) {
  return b64u(new Uint8Array(await wc().subtle.digest("SHA-256", bytes)));
}
