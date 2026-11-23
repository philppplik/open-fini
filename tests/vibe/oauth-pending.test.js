// Web sign-in records that wait across the OAuth redirect: sealed with a one-time non-extractable key, never stored in
// clear text, one use, 15 minute lifetime (CodeQL js/clear-text-storage-of-sensitive-data).
import test from "node:test";
import assert from "node:assert/strict";
import { sealOnce, openOnce, VaultError } from "../../app/src/ai/vault.js";
import { savePending, takePending, PENDING_TTL_MS } from "../../app/src/vibe/oauth-pending.js";

function stores() {
  const idb = new Map();
  const ss = new Map();
  return {
    idb,
    ss,
    keys: { get: async (k) => idb.get(k), set: async (k, v) => void idb.set(k, v), delete: async (k) => void idb.delete(k) },
    session: { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: (k) => ss.delete(k) },
  };
}

test("sealOnce: round trip, key cannot be exported, wrong key and tampering fail", async () => {
  const value = { verifier: "v3r1f1er-secret", client: { clientId: "cid", clientSecret: "shh" } };
  const { key, sealed } = await sealOnce(value);
  assert.ok(!sealed.includes("v3r1f1er") && !sealed.includes("shh"));
  assert.deepEqual(await openOnce(key, sealed), value);
  await assert.rejects(globalThis.crypto.subtle.exportKey("raw", key), "the key is not extractable");
  const other = await sealOnce(1);
  await assert.rejects(openOnce(other.key, sealed), (e) => e instanceof VaultError && e.code === "bad_passphrase");
  const [iv, data] = sealed.split(".");
  const flipped = `${iv}.${data[0] === "A" ? "B" : "A"}${data.slice(1)}`;
  await assert.rejects(openOnce(key, flipped), (e) => e instanceof VaultError);
  await assert.rejects(openOnce(key, "garbage"), (e) => e.code === "bad_format");
});

test("pending record: sealed at rest, one use, expires", async () => {
  const s = stores();
  const data = { serverId: "m1", state: "st", verifier: "v3r1f1er-secret", redirectUri: "https://app/?vibe_oauth=mcp", client: { clientId: "cid", clientSecret: "shh" }, meta: { issuer: "https://auth" } };
  await savePending("vibe.mcpoauth", data, { ...s, now: 1000 });
  const stored = s.ss.get("vibe.mcpoauth");
  assert.ok(stored && !stored.includes("v3r1f1er") && !stored.includes("shh") && !stored.includes("cid"), "no clear text in sessionStorage");
  assert.ok(s.idb.get("vibe.mcpoauth.key"), "the key object is in IndexedDB");
  assert.deepEqual(await takePending("vibe.mcpoauth", { ...s, now: 2000 }), data);
  assert.equal(s.ss.size + s.idb.size, 0, "both parts are removed");
  assert.equal(await takePending("vibe.mcpoauth", { ...s, now: 2000 }), null, "one use");

  await savePending("vibe.pkce", { verifier: "x" }, { ...s, now: 0 });
  assert.equal(await takePending("vibe.pkce", { ...s, now: PENDING_TTL_MS + 1 }), null, "expired");
  assert.equal(s.ss.size + s.idb.size, 0);
});

test("pending record: a second sign-in in another tab replaces the key; blocked storage refuses to save", async () => {
  const s = stores();
  await savePending("p", { verifier: "a" }, s);
  const firstText = s.ss.get("p");
  await savePending("p", { verifier: "b" }, s); // the other tab overwrote the shared IndexedDB key
  s.ss.set("p", firstText);
  assert.equal(await takePending("p", s), null);

  const blocked = stores();
  blocked.keys.set = async () => undefined; // storage.js swallows IndexedDB errors
  blocked.keys.get = async () => undefined;
  await assert.rejects(savePending("p", { verifier: "a" }, blocked));
  assert.equal(blocked.ss.size, 0, "nothing is written when the key cannot be kept");
});
