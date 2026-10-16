import test from "node:test";
import assert from "node:assert/strict";
import { encryptJson, decryptJson, maskKey, randomId, createPkce, pkceChallenge, openRouterAuthUrl, exchangeOpenRouterCode, VaultError } from "../../app/src/ai/vault.js";
import { fakeFetch, jsonResponse } from "./helpers.js";

test("vault: encrypt/decrypt round trip with the real KDF parameters", async () => {
  const value = { providers: { openrouter: { key: "sk-or-v1-abc" } }, n: 1, text: "grüße \u{1f511}" };
  const blob = await encryptJson(value, "correct horse");
  assert.equal(blob.v, 1);
  assert.equal(blob.kdf, "PBKDF2-SHA256");
  assert.equal(blob.iter, 250000);
  assert.equal(blob.cipher, "AES-GCM");
  for (const k of ["salt", "iv", "data"]) assert.match(blob[k], /^[A-Za-z0-9+/]+=*$/);
  assert.ok(!JSON.stringify(blob).includes("sk-or-v1"));
  assert.deepEqual(await decryptJson(blob, "correct horse"), value);
  assert.deepEqual(await decryptJson(JSON.stringify(blob), "correct horse"), value, "accepts a JSON string");
  const again = await encryptJson(value, "correct horse", { iterations: 1000 });
  assert.notEqual(again.salt, blob.salt);
  assert.notEqual(again.iv, blob.iv);
  assert.deepEqual(await decryptJson(again, "correct horse"), value);
});

test("vault: wrong passphrase, tampering and bad formats", async () => {
  const blob = await encryptJson({ a: 1 }, "pw", { iterations: 1000 });
  await assert.rejects(decryptJson(blob, "wrong"), (e) => e instanceof VaultError && e.code === "bad_passphrase");
  const bytes = Buffer.from(blob.data, "base64");
  bytes[0] ^= 1;
  await assert.rejects(decryptJson({ ...blob, data: bytes.toString("base64") }, "pw"), (e) => e.code === "bad_passphrase");
  await assert.rejects(decryptJson({ ...blob, iter: 999 }, "pw"), (e) => e.code === "bad_passphrase");
  await assert.rejects(decryptJson({ ...blob, v: 2 }, "pw"), (e) => e.code === "bad_format");
  await assert.rejects(decryptJson({ ...blob, iter: 1e12 }, "pw"), (e) => e.code === "bad_format");
  await assert.rejects(decryptJson("not json", "pw"), (e) => e.code === "bad_format");
  await assert.rejects(decryptJson(null, "pw"), (e) => e.code === "bad_format");
  await assert.rejects(encryptJson({}, ""), (e) => e.code === "bad_passphrase");
});

test("vault: maskKey and randomId", () => {
  assert.equal(maskKey("sk-or-v1-0123456789abcdef"), "sk-o…cdef");
  assert.equal(maskKey("short"), "•••••");
  assert.equal(maskKey(""), "");
  assert.equal(maskKey(undefined), "");
  const a = randomId("key_");
  assert.match(a, /^key_[0-9a-f]{16}$/);
  assert.notEqual(a, randomId("key_"));
  assert.equal(randomId().length, 16);
  assert.equal(randomId("", 4).length, 8);
});

test("PKCE: RFC 7636 appendix B test vector", async () => {
  assert.equal(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("PKCE: createPkce shape and OpenRouter URL / code exchange", async () => {
  const p = await createPkce();
  assert.match(p.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(p.challenge, await pkceChallenge(p.verifier));
  assert.match(p.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(p.state.length >= 16);
  assert.notEqual((await createPkce()).verifier, p.verifier);

  const url = openRouterAuthUrl({ callbackUrl: "http://localhost:5173/auth/callback", challenge: p.challenge });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://openrouter.ai/auth");
  assert.equal(u.searchParams.get("callback_url"), "http://localhost:5173/auth/callback");
  assert.equal(u.searchParams.get("code_challenge"), p.challenge);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  const withState = new URL(openRouterAuthUrl({ callbackUrl: "https://app.test/cb", challenge: "c", state: "s1" }));
  assert.equal(withState.searchParams.get("callback_url"), "https://app.test/cb?state=s1");

  const f = fakeFetch(() => jsonResponse({ key: "sk-or-v1-new", user_id: "user_1" }));
  const r = await exchangeOpenRouterCode({ code: "abc", verifier: p.verifier, fetch: f });
  assert.deepEqual(r, { key: "sk-or-v1-new", userId: "user_1" });
  assert.equal(f.calls[0].url, "https://openrouter.ai/api/v1/auth/keys");
  assert.equal(f.calls[0].method, "POST");
  assert.deepEqual(f.calls[0].json, { code: "abc", code_verifier: p.verifier, code_challenge_method: "S256" });
  await assert.rejects(exchangeOpenRouterCode({ code: "x", verifier: "v", fetch: fakeFetch(() => jsonResponse({ error: { message: "bad code" } }, { status: 400 })) }), /bad code/);
  await assert.rejects(exchangeOpenRouterCode({ code: "x", verifier: "v", fetch: fakeFetch(() => jsonResponse({})) }), (e) => e.code === "bad_format");
});
