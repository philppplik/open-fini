import test from "node:test";
import assert from "node:assert/strict";
import { validateMessage, canDo, parseMentions, sanitizeFileName, cleanText, initialsOf, LIMITS, PERMISSION, TYPES } from "../../app/src/collab/protocol.js";
import { RoomState } from "../../app/src/collab/room.js";
import { ChatStore } from "../../app/src/collab/chat.js";

const M = (id) => id.padEnd(22, "A").slice(0, 22);
const ok = (m) => assert.equal(validateMessage(m).ok, true, JSON.stringify(validateMessage(m)));
const bad = (m, re) => {
  const r = validateMessage(m);
  assert.equal(r.ok, false, JSON.stringify(m).slice(0, 80));
  if (re) assert.match(r.error, re);
};

test("valid messages pass and come back as clean copies", () => {
  ok({ t: "chat", ts: 1, msg: { id: "m1", text: "hi @Mia", mentions: [M("b")] } });
  ok({ t: "presence", ts: 1, studio: "vector", doc: "d_1", page: "p1", x: 10, y: 20, sel: ["n1"], view: { x: 0, y: 0, w: 100, h: 50 } });
  ok({ t: "hello", ts: 1, profile: { nick: "Mia", color: "#ff0000", initials: "MI" }, dh: "abc" });
  ok({ t: "comment", ts: 1, doc: "d1", op: { op: "resolve", threadId: "t1", text: "Mia" } });
  ok({ t: "rotate", ts: 1, epoch: 1, wraps: { [M("x")]: { iv: "AAAAAAAAAAAAAAAA", ct: "abc" } } });
  const r = validateMessage({ t: "chat", ts: 1, msg: { id: "m1", text: "a‮b\u0007c" } });
  assert.equal(r.msg.msg.text, "abc", "bidi overrides and control characters are removed");
});

test("unknown types, unknown fields, wrong types and oversize values are rejected", () => {
  bad({ t: "eval", ts: 1 }, /unknown message type/);
  bad({ t: "chat", ts: 1, msg: { id: "m1", text: "x", html: "<b>" } }, /not allowed/);
  bad({ t: "chat", ts: 1, msg: { id: "m 1", text: "x" } }, /invalid characters/);
  bad({ t: "chat", ts: 1, msg: { id: "m1", text: "x".repeat(LIMITS.chatText + 1) } }, /too long/);
  bad({ t: "chat", ts: "1", msg: { id: "m1", text: "x" } });
  bad({ t: "typing", ts: 1 }, /missing/);
  bad({ t: "presence", ts: 1, studio: "vector", x: Infinity });
  bad({ t: "presence", ts: 1, studio: "vector", sel: new Array(LIMITS.ids + 1).fill("a") });
  bad({ t: "hello", ts: 1, profile: { nick: "Mia", color: "red" }, dh: "x" });
  bad({ t: "hello", ts: 1, profile: { nick: "Mia", color: "#ff0000", avatar: "data:image/svg+xml;base64,PHN2Zz4=" }, dh: "x" }, /invalid characters/);
  bad({ t: "react", ts: 1, id: "m1", emoji: "💣", on: true });
  bad({ t: "file-offer", ts: 1, fid: "f", name: "a.png", size: LIMITS.fileBytes + 1, chunks: 1, sha: "x" });
  bad({ t: "state", ts: 1, host: M("h"), roles: { ["__proto__"]: "editor" }, defaultRole: "editor" });
  bad({ t: "state", ts: 1, host: M("h"), roles: {}, defaultRole: "host" });
  bad(null);
  bad([]);
});

test("every type has a permission and roles are ordered", () => {
  for (const t of TYPES) assert.ok(PERMISSION[t]);
  assert.equal(canDo("viewer", "chat"), true);
  assert.equal(canDo("viewer", "comment"), false);
  assert.equal(canDo("commenter", "comment"), true);
  assert.equal(canDo("commenter", "op"), false);
  assert.equal(canDo("editor", "op"), true);
  assert.equal(canDo("editor", "rotate"), false);
  assert.equal(canDo("host", "rotate"), true);
  assert.equal(canDo("nobody", "chat"), false);
});

test("mentions, file names, text cleaning and initials", () => {
  const members = [{ id: "a", nick: "Mia" }, { id: "b", nick: "Mia Wong" }, { id: "c", nick: "Tom" }];
  assert.deepEqual(parseMentions("hey @mia wong and @tom!", members), ["b", "c"]);
  assert.deepEqual(parseMentions("hey @Mia.", members), ["a"]);
  assert.deepEqual(parseMentions("mail tom@x.org @tommy", members), []);
  assert.equal(sanitizeFileName("../../etc/passwd"), "_.._etc_passwd");
  assert.equal(sanitizeFileName("CON.txt"), "file_CON.txt");
  assert.equal(sanitizeFileName("  .hidden  "), "hidden");
  assert.equal(sanitizeFileName("a\u0000b<c>.png"), "ab_c_.png");
  assert.ok(sanitizeFileName(`${"x".repeat(300)}.png`).endsWith(".png"));
  assert.ok(sanitizeFileName(`${"x".repeat(300)}.png`).length <= LIMITS.fileName);
  assert.equal(cleanText("a\nb\tc\u0001", 10), "a\nb\tc");
  assert.equal(initialsOf("Mia Wong"), "MW");
  assert.equal(initialsOf("tom"), "TO");
  assert.equal(initialsOf(""), "?");
});

test("room: only the host assigns roles and removes; removed members stay out", () => {
  const host = M("host");
  const r = new RoomState({ me: M("me"), host, defaultRole: "commenter" });
  assert.equal(r.roleOf(host), "host");
  assert.equal(r.roleOf(M("x")), "commenter");
  r.apply(M("x"), { t: "role", member: M("y"), role: "viewer" });
  assert.equal(r.roleOf(M("y")), "commenter", "non-hosts cannot assign roles");
  r.apply(host, { t: "role", member: M("y"), role: "viewer" });
  assert.equal(r.roleOf(M("y")), "viewer");
  assert.equal(r.allowed(M("y"), "comment"), false);
  assert.equal(r.allowed(M("y"), "chat"), true);
  r.apply(host, { t: "role", member: host, role: "viewer" });
  assert.equal(r.roleOf(host), "host", "the host stays host");
  assert.equal(r.apply(host, { t: "remove", member: M("me") }).event, "removed-me");
  r.apply(host, { t: "remove", member: M("z") });
  assert.equal(r.allowed(M("z"), "chat"), false);
  assert.equal(r.apply(M("z"), { t: "hello", profile: { nick: "Z", color: "#000000" } }).changed, false);
  r.apply(host, { t: "state", host, roles: { [M("q")]: "editor", [host]: "viewer" }, defaultRole: "viewer" });
  assert.equal(r.roleOf(M("q")), "editor");
  assert.equal(r.roleOf(host), "host");
  assert.equal(r.defaultRole, "viewer");
});

test("room: join/leave events and expiry", () => {
  const r = new RoomState({ me: M("me"), host: M("h") });
  const p = { nick: "A", color: "#000000" };
  assert.equal(r.apply(M("a"), { t: "hello", profile: p }, 0).event, "join");
  assert.equal(r.apply(M("a"), { t: "hello", profile: p }, 1).event, "profile");
  assert.equal(r.apply(M("a"), { t: "bye" }, 2).event, "leave");
  assert.equal(r.apply(M("a"), { t: "hello", profile: p }, 3).event, "join");
  assert.deepEqual(r.expire(100000, 45000), [M("a")]);
  assert.equal(r.online().length, 0);
});

test("chat: threads, replies, author-only edit/delete, reactions, unread and mentions", () => {
  const me = M("me");
  const c = new ChatStore({ me, max: 5 });
  const a = c.add(M("a"), { nick: "A", color: "#000000" }, { id: "m1", text: "root", mentions: [me] });
  assert.equal(c.unread, 1);
  assert.equal(c.unreadMentions, 1);
  c.add(M("b"), { nick: "B" }, { id: "m2", text: "in thread", thread: "m1" });
  c.add(M("b"), { nick: "B" }, { id: "m3", text: "nested", thread: "m2" });
  assert.equal(c.byId.get("m3").thread, "m1", "replies to thread replies stay in the root thread");
  assert.deepEqual(c.main().map((m) => m.id), ["m1"]);
  assert.equal(c.threadCount("m1"), 2);
  assert.equal(c.add(M("b"), {}, { id: "m1", text: "dup" }), null);
  assert.equal(c.edit(M("b"), "m1", "hacked"), false, "only the author edits");
  assert.equal(c.edit(M("a"), "m1", "root (edited)"), true);
  assert.equal(c.react(M("b"), "m1", "👍", true), true);
  assert.equal(c.react(M("b"), "m1", "👍", true), false);
  assert.deepEqual(a.reactions["👍"], [M("b")]);
  assert.equal(c.remove(M("b"), "m1"), false);
  assert.equal(c.remove(M("a"), "m1"), true);
  assert.equal(a.text, "");
  c.markRead();
  assert.equal(c.unread, 0);
  for (let i = 0; i < 6; i++) c.addSystem(`s${i}`, i);
  assert.equal(c.list.length, 5, "history is capped");
  assert.equal(c.byId.has("m1"), false);
});

test("chat: activities of the same author, document and label merge", () => {
  const c = new ChatStore({ me: M("me") });
  c.addActivity(M("a"), { nick: "A" }, { doc: "d", label: "Move", count: 2 }, 1000);
  c.addActivity(M("a"), { nick: "A" }, { doc: "d", label: "Move", count: 1 }, 3000);
  c.addActivity(M("a"), { nick: "A" }, { doc: "d", label: "Delete", count: 1 }, 3500);
  c.addActivity(M("a"), { nick: "A" }, { doc: "d", label: "Delete", count: 1 }, 30000);
  assert.equal(c.list.length, 3);
  assert.equal(c.list[0].activity.count, 3);
  assert.equal(c.list[0].activity.steps, 2);
});
