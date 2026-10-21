import test from "node:test";
import assert from "node:assert/strict";
import { CollabSession, normalizeProfile } from "../../app/src/collab/session.js";
import { createMemoryHub } from "../../app/src/collab/transport.js";
import { parseInvite, deriveRoom, seal, newIdentity } from "../../app/src/collab/crypto.js";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function settle(...sessions) {
  for (let i = 0; i < 6; i++) {
    await tick();
    await Promise.all(sessions.map((s) => s.settled()));
  }
}

async function room(hub, { defaultRole = "editor" } = {}) {
  const tf = () => hub.transport();
  const host = await CollabSession.create({ relay: "local", profile: { nick: "Hanabelle", color: "#e5484d" }, defaultRole, transportFactory: tf });
  await host.start();
  const mia = await CollabSession.join({ invite: host.inviteCode, profile: { nick: "Miaroselle", color: "#0090ff" }, transportFactory: tf });
  await mia.start();
  await settle(host, mia);
  return { host, mia, tf };
}

test("join: both sides see each other, the same fingerprint and the host's roles", async (t) => {
  const hub = createMemoryHub();
  const { host, mia } = await room(hub, { defaultRole: "commenter" });
  t.after(() => (host.leave(), mia.leave()));
  assert.deepEqual(host.fingerprint, mia.fingerprint);
  assert.equal(host.members.length, 1);
  assert.equal(host.members[0].profile.nick, "Miaroselle");
  assert.equal(mia.members[0].profile.nick, "Hanabelle");
  assert.equal(mia.myRole, "commenter");
  assert.equal(host.myRole, "host");
  assert.equal(mia.status().encrypted, true);
  // the "relay" only ever saw ciphertext
  for (const f of hub.log) {
    assert.ok(!f.includes("Hanabelle") && !f.includes("Miaroselle"), "nicknames never travel in clear text");
  }
});

test("chat with mention, reply and thread; edit, delete and reactions", async (t) => {
  const hub = createMemoryHub();
  const { host, mia } = await room(hub);
  t.after(() => (host.leave(), mia.leave()));
  const notes = [];
  mia.on("notify", (n) => notes.push(n));
  const root = await host.chat("Hi @Miaroselle, look at the logo");
  await settle(host, mia);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "mention");
  assert.equal(mia.chatStore.byId.get(root.id).text, "Hi @Miaroselle, look at the logo");
  const reply = await mia.chat("On it", { thread: root.id });
  await mia.react(root.id, "👍", true);
  await settle(host, mia);
  assert.equal(host.chatStore.threadCount(root.id), 1);
  assert.deepEqual(host.chatStore.byId.get(root.id).reactions["👍"], [mia.id]);
  await mia.editChat(reply.id, "On it now");
  await settle(host, mia);
  assert.equal(host.chatStore.byId.get(reply.id).text, "On it now");
  await assert.rejects(mia.editChat(root.id, "mine now"), /own messages/);
  await host.deleteChat(root.id);
  await settle(host, mia);
  assert.equal(mia.chatStore.byId.get(root.id).deleted, true);
  assert.equal(mia.rejected, 0);
});

test("a late joiner gets recent chat from the host", async (t) => {
  const hub = createMemoryHub();
  const { host, mia, tf } = await room(hub);
  await host.chat("before you came");
  await settle(host, mia);
  const tom = await CollabSession.join({ invite: host.inviteCode, profile: { nick: "Tom", color: "#46a758" }, transportFactory: tf });
  await tom.start();
  await settle(host, mia, tom);
  t.after(() => (host.leave(), mia.leave(), tom.leave()));
  assert.ok(tom.chatStore.list.some((m) => m.text === "before you came"));
  assert.equal(tom.members.length, 2);
});

test("permissions: a viewer's comment is refused locally and by the others", async (t) => {
  const hub = createMemoryHub();
  const { host, mia } = await room(hub, { defaultRole: "viewer" });
  t.after(() => (host.leave(), mia.leave()));
  await assert.rejects(mia.comment("d1", { op: "resolve", threadId: "t1" }), /does not allow comments/);
  const seen = [];
  host.on("comment", (c) => seen.push(c));
  await host.setRole(mia.id, "commenter");
  await settle(host, mia);
  assert.equal(mia.myRole, "commenter");
  await mia.comment("d1", { op: "resolve", threadId: "t1", text: "Mia" });
  await settle(host, mia);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sender, mia.id);
});

test("files arrive intact; disallowed types are refused before sending", async (t) => {
  const hub = createMemoryHub();
  const { host, mia } = await room(hub);
  t.after(() => (host.leave(), mia.leave()));
  const got = [];
  mia.on("file", (f) => got.push(f));
  const bytes = new Uint8Array(120000).map((_, i) => (i * 7) % 256);
  await host.sendFile(bytes, { name: "photo.png" });
  await settle(host, mia);
  assert.equal(got.length, 1);
  assert.equal(got[0].transfer.name, "photo.png");
  assert.deepEqual(got[0].bytes, bytes);
  await assert.rejects(host.sendFile(new Uint8Array(10), { name: "tool.exe" }), /cannot be sent/);
});

test("tampered, replayed, forged and outsider frames are rejected; nothing reaches the app", async (t) => {
  const hub = createMemoryHub();
  const { host, mia } = await room(hub);
  t.after(() => (host.leave(), mia.leave()));
  const chats = [];
  mia.on("chat", (c) => c.message && chats.push(c.message));
  const before = hub.log.length;
  await host.chat("original");
  await settle(host, mia);
  const frame = hub.log[before];
  const miaTransport = mia.transport;
  // replay the same frame
  miaTransport.deliver(frame);
  // tamper with it
  const env = JSON.parse(frame);
  miaTransport.deliver(JSON.stringify({ ...env, n: env.n + 50, ct: env.ct.slice(0, -4) + "AAAA" }));
  // an outsider with its own identity and a wrong key
  const outsider = await newIdentity();
  const wrong = await deriveRoom({ ...parseInvite(host.inviteCode), secret: "A".repeat(43) });
  miaTransport.deliver(await seal(wrong, outsider, 1, { t: "chat", ts: Date.now(), msg: { id: "x1", text: "hi" } }));
  // a member sending an invalid message (correct key, but schema violation)
  const keys = await deriveRoom(parseInvite(host.inviteCode));
  miaTransport.deliver(await seal(keys, outsider, 1, { t: "chat", ts: Date.now(), msg: { id: "x2", text: "x", html: "<img onerror=alert(1)>" } }));
  // a stale message (outside the time window)
  miaTransport.deliver(await seal(keys, outsider, 2, { t: "chat", ts: Date.now() - 3600_000, msg: { id: "x3", text: "old" } }));
  // a non-host trying host-only actions
  miaTransport.deliver(await seal(keys, outsider, 3, { t: "role", ts: Date.now(), member: mia.id, role: "viewer" }));
  await settle(host, mia);
  assert.deepEqual(chats.map((m) => m.text), ["original"]);
  assert.equal(mia.rejected, 6);
  assert.equal(mia.myRole, "editor");
});

test("relay access token: a peer with only the room id cannot join", async () => {
  const hub = createMemoryHub();
  const { host, mia } = await room(hub);
  const inv = parseInvite(host.inviteCode);
  const intruder = hub.transport();
  await assert.rejects(intruder.connect({ room: inv.room, token: "B".repeat(22) }), (e) => e.code === "forbidden");
  host.leave();
  mia.leave();
});

test("removing a member rotates the key: the removed member is out, the others continue", async (t) => {
  const hub = createMemoryHub();
  const { host, mia, tf } = await room(hub);
  const tom = await CollabSession.join({ invite: host.inviteCode, profile: { nick: "Tom", color: "#46a758" }, transportFactory: tf });
  await tom.start();
  await settle(host, mia, tom);
  t.after(() => (host.leave(), mia.leave(), tom.leave()));
  const oldInvite = host.inviteCode;
  const oldFp = host.fingerprint.join(" ");
  let removed = false;
  tom.on("removed", () => (removed = true));
  await host.remove(tom.id);
  await settle(host, mia, tom);
  await settle(host, mia, tom);
  assert.equal(removed, true);
  assert.equal(tom.state, "removed");
  assert.notEqual(host.inviteCode, oldInvite);
  assert.equal(mia.inviteCode, host.inviteCode, "the remaining member switched to the new room");
  assert.notEqual(host.fingerprint.join(" "), oldFp);
  assert.deepEqual(mia.fingerprint, host.fingerprint);
  assert.equal(mia.epoch, 1);
  const got = [];
  mia.on("chat", (c) => c.message && got.push(c.message.text));
  await host.chat("after rotation");
  await settle(host, mia);
  assert.deepEqual(got, ["after rotation"]);
  // the old room on the relay has no member left from the new epoch
  assert.ok(!hub.rooms.has(parseInvite(oldInvite).room) || [...hub.rooms.get(parseInvite(oldInvite).room).peers].length <= 1);
});

test("profiles are normalized", () => {
  assert.deepEqual(normalizeProfile({ nick: "  ", color: "red" }), { nick: "Guest", color: "#6e56cf", initials: "GU" });
  assert.equal(normalizeProfile({ nick: "Ann", color: "#ABCDEF", avatar: "javascript:alert(1)" }).avatar, undefined);
  assert.equal(normalizeProfile({ nick: "Ann", color: "#ABCDEF" }).color, "#abcdef");
});
