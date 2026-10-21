import test from "node:test";
import assert from "node:assert/strict";
import { SAS_WORDS } from "../../app/src/collab/wordlist.js";
import { b64u, unb64u, newRoomId, newRoomSecret, formatInvite, parseInvite, normalizeRelay, relayHost, deriveRoom, newIdentity, memberIdOf, seal, open, ReplayGuard, wrapFor, unwrapFrom, CollabCryptoError } from "../../app/src/collab/crypto.js";

test("the verification word list has 256 unique lowercase words", () => {
  assert.equal(SAS_WORDS.length, 256);
  assert.equal(new Set(SAS_WORDS).size, 256);
  for (const w of SAS_WORDS) assert.match(w, /^[a-z]+$/);
});

test("base64url round-trips", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(unb64u(b64u(bytes)), bytes);
  assert.throws(() => unb64u("a+b/"), CollabCryptoError);
});

test("invite codes carry relay, room, secret and host; the secret sits in the fragment", async () => {
  const me = await newIdentity();
  const inv = { relay: "wss://relay.example.org:8443/", room: newRoomId(), secret: newRoomSecret(), host: me.id };
  const code = formatInvite(inv);
  assert.ok(code.startsWith("wss://relay.example.org:8443/#ofc1."));
  assert.ok(new URL(code).hash.includes(inv.secret), "the secret is in the fragment");
  assert.ok(!new URL(code).pathname.includes(inv.secret));
  assert.deepEqual(parseInvite(`  ${code}\n`), inv);
  assert.deepEqual(parseInvite(formatInvite({ ...inv, relay: "local" })).relay, "local");
  assert.equal(relayHost("ws://192.168.1.20:8787/"), "192.168.1.20:8787");
});

test("bad invites and relay addresses are refused with readable errors", () => {
  for (const bad of ["", "hello", "https://x/#ofc1.a.b.c", "wss://x/#ofc1.short.short.short", "wss://x/#ofc1." + "a".repeat(700)]) {
    assert.throws(() => parseInvite(bad), (e) => e.code === "bad_invite" && e.message.length > 10, bad.slice(0, 30));
  }
  assert.throws(() => normalizeRelay("http://example.org"), /ws:\/\//);
  assert.throws(() => normalizeRelay("wss://user:pw@example.org"), /user name/);
  assert.throws(() => normalizeRelay("wss://example.org/?x=1"), /query/);
  assert.equal(normalizeRelay("ws://127.0.0.1:8787"), "ws://127.0.0.1:8787/");
});

test("everyone with the secret derives the same key, access token and fingerprint; epochs differ", async () => {
  const p = { secret: newRoomSecret(), room: newRoomId(), host: (await newIdentity()).id };
  const a = await deriveRoom(p);
  const b = await deriveRoom(p);
  assert.equal(a.accessToken, b.accessToken);
  assert.match(a.accessToken, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(a.fingerprint, b.fingerprint);
  assert.equal(a.fingerprint.length, 6);
  for (const w of a.fingerprint) assert.ok(SAS_WORDS.includes(w));
  const other = await deriveRoom({ ...p, secret: newRoomSecret() });
  assert.notDeepEqual(other.fingerprint, a.fingerprint);
  assert.notEqual(other.accessToken, a.accessToken);
  // a different host id changes the fingerprint (a swapped host would be noticed)
  const swapped = await deriveRoom({ ...p, host: (await newIdentity()).id });
  assert.notDeepEqual(swapped.fingerprint, a.fingerprint);
});

test("member ids are bound to the signing key", async () => {
  const me = await newIdentity();
  assert.equal(await memberIdOf(unb64u(me.signPub)), me.id);
  assert.match(me.id, /^[A-Za-z0-9_-]{22}$/);
});

async function setup() {
  const p = { secret: newRoomSecret(), room: newRoomId(), host: "h" };
  const keys = await deriveRoom(p);
  return { p, keys, alice: await newIdentity(), bob: await newIdentity() };
}

test("seal/open: round trip, and the frame does not contain the plaintext", async () => {
  const { keys, alice } = await setup();
  const frame = await seal(keys, alice, 1, { t: "chat", ts: 1, msg: { id: "m1", text: "secret plans for Tuesday" } });
  assert.ok(!frame.includes("secret plans"));
  const r = await open(keys, frame, new ReplayGuard());
  assert.equal(r.sender, alice.id);
  assert.equal(r.message.msg.text, "secret plans for Tuesday");
});

test("open rejects replays, reordering, tampering, forged senders, wrong keys and wrong epochs", async () => {
  const { p, keys, alice, bob } = await setup();
  const guard = new ReplayGuard();
  const f1 = await seal(keys, alice, 1, { t: "typing", ts: 1, on: true });
  const f2 = await seal(keys, alice, 2, { t: "typing", ts: 1, on: false });
  await open(keys, f2, guard);
  await assert.rejects(open(keys, f2, guard), (e) => e.code === "replay");
  await assert.rejects(open(keys, f1, guard), (e) => e.code === "replay", "older counter after a newer one");

  // tampered ciphertext → the signature fails first
  const env = JSON.parse(await seal(keys, alice, 3, { t: "typing", ts: 1, on: true }));
  const ct = env.ct.split("");
  ct[5] = ct[5] === "A" ? "B" : "A";
  await assert.rejects(open(keys, JSON.stringify({ ...env, ct: ct.join("") }), new ReplayGuard()), (e) => e.code === "bad_signature");
  // changed counter (AAD) → signature fails
  await assert.rejects(open(keys, JSON.stringify({ ...env, n: 99 }), new ReplayGuard()), (e) => e.code === "bad_signature");
  // claiming to be Bob with Alice's key
  await assert.rejects(open(keys, JSON.stringify({ ...env, s: bob.id }), new ReplayGuard()), (e) => e.code === "bad_sender");
  // Bob's key with Bob's id but Alice's signature
  await assert.rejects(open(keys, JSON.stringify({ ...env, s: bob.id, k: bob.signPub }), new ReplayGuard()), (e) => e.code === "bad_signature");
  // someone without the room key (signs correctly with an own identity, but encrypts with another key)
  const outsider = await deriveRoom({ ...p, secret: newRoomSecret() });
  const forged = await seal(outsider, bob, 1, { t: "typing", ts: 1, on: true });
  await assert.rejects(open(keys, forged, new ReplayGuard()), (e) => e.code === "decrypt");
  // the next epoch's key cannot read epoch 0 frames
  const next = await deriveRoom({ ...p, epoch: 1 });
  await assert.rejects(open(next, f1, new ReplayGuard()), (e) => e.code === "decrypt");
  // garbage
  for (const g of ["", "{}", "null", '{"v":1}', "x".repeat(100)]) await assert.rejects(open(keys, g, new ReplayGuard()), CollabCryptoError);
});

test("rotation key wrapping: only the addressed member can unwrap", async () => {
  const host = await newIdentity();
  const bob = await newIdentity();
  const eve = await newIdentity();
  const next = { secret: newRoomSecret(), room: newRoomId(), epoch: 1 };
  const w = await wrapFor(host.dh, bob.dhPub, next, "rotate|r|1|bob");
  assert.deepEqual(await unwrapFrom(bob.dh, host.dhPub, w, "rotate|r|1|bob"), next);
  await assert.rejects(unwrapFrom(eve.dh, host.dhPub, w, "rotate|r|1|bob"), (e) => e.code === "decrypt");
  await assert.rejects(unwrapFrom(bob.dh, host.dhPub, w, "rotate|r|1|eve"), (e) => e.code === "decrypt", "context is bound");
});
