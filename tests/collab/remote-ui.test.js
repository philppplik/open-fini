// The bridge between the main window and the Collaboration window (always its own OS window, ADR 0030):
// protocol (collab/remote-ui.js) and the window's model (collab/remote-model.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_NAMES, LIMITS, PROTOCOL, RUN_COMMANDS, UI_CHANNEL, WINDOW_LABEL, WINDOW_SIZE, changeKind, isUiMessage, makeSnapshot, placeWindow, readShow, readSnapshot, readWindowState, snapshotKey, validateAction, windowFeatures } from "../../app/src/collab/remote-ui.js";
import { createRemoteModel } from "../../app/src/collab/remote-model.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(join(root, p), "utf8");

const msg = (o = {}) => ({ id: "m1", from: "B", nick: "Ben", color: "#00ff00", ts: 10, kind: "chat", text: "Hello", ...o });
const input = (o = {}) => ({
  prefs: { nick: "Ann", relay: "ws://127.0.0.1:8787/", offline: false },
  me: { id: "A", ids: ["local-a", "A"], profile: { nick: "Ann", color: "#ff0000", initials: "AN" }, studio: "vector", docName: "Poster" },
  session: {
    state: "open",
    host: "relay.example.org",
    id: "A",
    role: "host",
    isHost: true,
    fingerprint: ["one", "two", "three", "four", "five", "six"],
    local: false,
    builtin: null,
    members: [{ id: "B", profile: { nick: "Ben", color: "#00ff00" }, role: "editor", studio: "pixel", docName: "Photo", typing: false }],
    chat: [msg()],
    unread: 1,
    followId: null,
    transfers: [],
    received: [{ fid: "f1", name: "a.ofini", size: 10, ext: "ofini", doc: "d1" }],
    live: [],
  },
  doc: { id: "d1", name: "Poster" },
  docIds: ["d1", "d2"],
  threads: [{ id: "t1", author: "B", color: "#00ff00", ts: 5, where: "Layer “Logo”", anchor: { kind: "node", node: "n1" }, messages: [{ id: "c1", author: "B", nick: "Ben", color: "#00ff00", ts: 5, text: "Bigger", mentions: ["A"] }] }],
  ...o,
});

test("envelope: only known message types, window → main messages need the window id", () => {
  assert.equal(UI_CHANNEL, "openfini-collab-ui");
  assert.ok(isUiMessage({ t: "snap", s: {} }));
  assert.ok(isUiMessage({ t: "close" }));
  assert.ok(isUiMessage({ t: "show", tab: "chat" }));
  assert.ok(isUiMessage({ t: "res", rid: "r1", ok: true }));
  assert.ok(isUiMessage({ t: "hello", pid: "abc123" }));
  assert.equal(isUiMessage({ t: "hello" }), false);
  assert.equal(isUiMessage({ t: "act", a: {} }), false);
  assert.equal(isUiMessage({ t: "dock" }), false, "the old in-app docking is gone");
  assert.equal(isUiMessage({ t: "eval", pid: "x" }), false);
  assert.equal(isUiMessage(null), false);
});

test("actions: a whitelist with cleaned arguments", () => {
  assert.deepEqual(validateAction({ name: "chat.send", args: { text: "  hi  ", reply: "m1", evil: 1 } }), { ok: true, action: { name: "chat.send", args: { text: "hi", reply: "m1", links: [] } } });
  assert.equal(validateAction({ name: "chat.send", args: { text: "   " } }).ok, false);
  assert.equal(validateAction({ name: "chat.send", args: { text: "x".repeat(9000) } }).action.args.text.length, LIMITS.text);
  assert.equal(validateAction({ name: "eval", args: { code: "1" } }).ok, false);
  assert.equal(validateAction({ name: "__proto__" }).ok, false);
  assert.equal(validateAction({ name: "toString" }).ok, false);
  assert.equal(validateAction(null).ok, false);
  // links are rebuilt field by field
  const l = validateAction({ name: "chat.send", args: { text: "see", links: [{ kind: "node", doc: "d1", id: "n1", label: "Logo", extra: true }, { kind: "url", doc: "d1", id: "x" }] } }).action.args.links;
  assert.deepEqual(l, [{ kind: "node", doc: "d1", id: "n1", label: "Logo" }]);
  // only listed commands of the main window may be started
  for (const c of RUN_COMMANDS) assert.ok(validateAction({ name: "run", args: { command: c } }).ok);
  assert.equal(validateAction({ name: "run", args: { command: "file.deleteAll" } }).ok, false);
  assert.equal(validateAction({ name: "run", args: {} }).ok, false);
  // rooms
  assert.deepEqual(validateAction({ name: "room.create", args: { where: "relay", relay: " wss://r.example/ ", role: "admin", tunnel: "yes" } }).action.args, { where: "relay", relay: "wss://r.example/", role: "editor", tunnel: false });
  assert.equal(validateAction({ name: "room.create", args: { where: "moon" } }).ok, false);
  assert.equal(validateAction({ name: "room.join", args: { code: "" } }).ok, false);
  assert.equal(validateAction({ name: "member.role", args: { id: "B", role: "host" } }).ok, false, "nobody is made host from the window");
  assert.deepEqual(validateAction({ name: "member.follow", args: {} }).action.args, { id: null });
  // files: bytes only, within the room's file limit
  assert.ok(validateAction({ name: "file.send", args: { name: "a.png", bytes: new Uint8Array(3) } }).ok);
  assert.equal(validateAction({ name: "file.send", args: { name: "a.png", bytes: [1, 2, 3] } }).ok, false);
  assert.equal(validateAction({ name: "file.send", args: { name: "a.png", bytes: new Uint8Array(0) } }).ok, false);
  assert.equal(validateAction({ name: "file.open", args: { fid: "f1", mode: "exec" } }).action.args.mode, "copy");
  // ids must be plain single-line strings
  assert.equal(validateAction({ name: "comment.resolve", args: { thread: "t\n1" } }).ok, false);
  assert.equal(validateAction({ name: "comment.reply", args: { thread: {}, text: "x" } }).ok, false);
  assert.deepEqual(validateAction({ name: "comment.resolve", args: { thread: "t1" } }).action.args, { thread: "t1", on: true });
  assert.equal(validateAction({ name: "version.restore", args: { id: "v1", inPlace: 1 } }).action.args.inPlace, false);
  // every action answers something for empty arguments (never throws)
  for (const name of ACTION_NAMES) assert.equal(typeof validateAction({ name, args: {} }).ok, "boolean", name);
});

test("snapshots: bounded plain data, no secrets, validated again by the window", () => {
  const raw = input();
  raw.session.inviteCode = "wss://relay/#ofc1.SECRET";
  raw.session.secret = "SECRET";
  raw.session.keys = { k: "SECRET" };
  raw.me.signingKey = "SECRET";
  raw.session.members[0].profile.avatar = "javascript:alert(1)";
  raw.session.chat = Array.from({ length: LIMITS.chat + 40 }, (_, i) => msg({ id: `m${i}`, ts: i, text: "x".repeat(5000), html: "<b>", reactions: { "👍": ["A", 7] }, links: [{ kind: "page", doc: "d1", id: "p1" }] }));
  const s = makeSnapshot(raw);
  assert.equal(s.v, PROTOCOL);
  assert.equal(JSON.stringify(s).includes("SECRET"), false, "invite code, room secret and keys never enter a snapshot");
  assert.equal(s.session.chat.length, LIMITS.chat);
  assert.equal(s.session.chat.at(-1).id, `m${LIMITS.chat + 39}`, "the newest messages are kept");
  assert.equal(s.session.chat[0].text.length, LIMITS.text);
  assert.equal("html" in s.session.chat[0], false);
  assert.deepEqual(s.session.chat[0].reactions, { "👍": ["A"] });
  assert.equal(s.session.members[0].profile.avatar, undefined, "only image data URLs are avatars");
  assert.equal(s.session.members[0].profile.initials, "BE");
  assert.deepEqual(s.threads[0].anchor, { kind: "node", quote: "" });
  assert.equal(s.threads[0].where, "Layer “Logo”");
  // round trip through the channel (structured clone) and the window's validation
  const again = readSnapshot(structuredClone(s));
  assert.deepEqual(again, s);
  assert.equal(readSnapshot({ ...s, v: 1 }), null, "a window of another version is not fed");
  assert.equal(readSnapshot("x"), null);
  // garbage in, safe defaults out
  const g = readSnapshot({ v: PROTOCOL, session: { members: "x", chat: [null, 5, { kind: "script", color: "red" }] }, threads: [null], doc: { id: 5 } });
  assert.equal(g.session.chat.length, 3);
  assert.equal(g.session.chat[2].kind, "chat");
  assert.equal(g.session.chat[2].color, "#888888");
  assert.equal(g.doc, null);
  assert.deepEqual(g.session.members, []);
  // not in a room
  assert.equal(makeSnapshot(input({ session: null })).session, null);
});

test("changeKind: nothing, only the chat stream, or everything", () => {
  const a = makeSnapshot(input());
  const same = makeSnapshot(input());
  same.ts = a.ts + 5000;
  assert.equal(changeKind(a, same), "none");
  assert.equal(snapshotKey(a), snapshotKey(same), "the time stamp does not make a snapshot new");
  const chat = input();
  chat.session.chat.push(msg({ id: "m2", text: "More" }));
  chat.session.unread = 2;
  chat.session.members[0].typing = true;
  assert.equal(changeKind(a, makeSnapshot(chat)), "chat");
  const role = input();
  role.session.members[0].role = "viewer";
  assert.equal(changeKind(a, makeSnapshot(role)), "all");
  assert.equal(changeKind(a, makeSnapshot(input({ doc: { id: "d2", name: "Other" } }))), "all");
  assert.equal(changeKind(a, makeSnapshot(input({ session: null }))), "all");
  assert.equal(changeKind(null, a), "all");
});

test("show requests are validated", () => {
  assert.deepEqual(readShow({ t: "show", tab: "versions", focus: "version" }), { tab: "versions", thread: null, invite: "", focus: "version" });
  assert.deepEqual(readShow({ tab: "settings", thread: 5, focus: "x", invite: 7 }), { tab: null, thread: null, invite: "", focus: null });
  assert.equal(readShow({ invite: ` ${"c".repeat(9000)}` }).invite.length, LIMITS.invite - 1);
});

test("window placement: remembered where it is still reachable, never off screen", () => {
  assert.deepEqual(readWindowState(null), { w: WINDOW_SIZE.w, h: WINDOW_SIZE.h, compact: false });
  assert.deepEqual(readWindowState({ x: 10.4, y: 20, w: 700, h: 800, compact: true }), { x: 10, y: 20, w: 700, h: 800, compact: true });
  assert.deepEqual(readWindowState({ x: "a", w: 5, h: 5 }), { w: WINDOW_SIZE.w, h: WINDOW_SIZE.h, compact: false }, "too small or malformed falls back");
  const screens = [{ x: 0, y: 0, w: 1920, h: 1080 }, { x: 1920, y: 0, w: 1280, h: 1024 }];
  assert.deepEqual(placeWindow({ x: 2000, y: 100, w: 600, h: 700 }, screens), { w: 600, h: 700, x: 2000, y: 100 }, "second screen");
  assert.deepEqual(placeWindow({ x: 2000, y: 100, w: 600, h: 700 }, [screens[0]]), { w: 600, h: 700 }, "the second screen is gone: the system places it");
  assert.deepEqual(placeWindow({ x: 100, y: 3000, w: 600, h: 700 }, screens), { w: 600, h: 700 });
  assert.deepEqual(placeWindow({ x: 100, y: 100, w: 600, h: 700 }, []), { w: 600, h: 700 }, "unknown screens: size only");
  assert.deepEqual(placeWindow({ x: 0, y: 0, w: 5000, h: 4000 }, screens), { w: 1920, h: 1080, x: 0, y: 0 }, "never larger than its screen");
  assert.deepEqual(placeWindow(null, screens), { w: WINDOW_SIZE.w, h: WINDOW_SIZE.h });
  assert.equal(windowFeatures({ w: 560, h: 720 }), "popup=yes,width=560,height=720");
  assert.equal(windowFeatures({ w: 560, h: 720, x: -5, y: 9 }), "popup=yes,width=560,height=720,left=-5,top=9");
});

// A tiny main window: answers actions like ui/collab/remote-host.js does (validate, perform, answer, new snapshot).
function bridge() {
  const sent = [];
  const toasts = [];
  const state = input();
  let model;
  const act = async (name, args) => {
    const v = validateAction({ name, args: structuredClone(args) });
    if (!v.ok) return { ok: false, error: v.error };
    sent.push(v.action);
    const { args: a } = v.action;
    if (name === "chat.send") state.session.chat.push(msg({ id: `m${state.session.chat.length + 1}`, from: "A", nick: "Ann", text: a.text, ...(a.thread ? { thread: a.thread } : {}) }));
    if (name === "chat.read") state.session.unread = 0;
    if (name === "room.leave") state.session = null;
    if (name === "member.remove") return { ok: false, error: "Your role in this room does not allow this." };
    if (name === "invite.code") return { ok: true, data: "wss://relay/#ofc1.code" };
    queueMicrotask(() => model.update(readSnapshot(structuredClone(makeSnapshot(state)))));
    return { ok: true };
  };
  model = createRemoteModel({ act, toast: (...a) => toasts.push(a) });
  model.update(makeSnapshot(state));
  return { model, sent, toasts, state };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("model: snapshots become the shapes the Collaboration UI reads", () => {
  const { model } = bridge();
  const { c, app } = model;
  assert.equal(c.myId, "A");
  assert.ok(c.isMine("local-a") && c.isMine("A") && !c.isMine("B"));
  assert.deepEqual(c.status(), { connected: true, members: 2 });
  assert.equal(c.session.relayHost, "relay.example.org");
  assert.equal(c.session.myRole, "host");
  assert.equal(c.session.room.roleOf("B"), "editor");
  assert.equal(c.session.room.roleOf("A"), "host");
  assert.equal(c.session.member("B").presence.docName, "Photo");
  assert.equal(c.session.chatStore.unread, 1);
  assert.equal(c.session.chatStore.byId.get("m1").text, "Hello");
  assert.equal(c.session.chatStore.main().length, 1);
  assert.equal(c.received.get("f1").transfer.ext, "ofini");
  assert.equal(c.threads()[0].where, "Layer “Logo”");
  assert.deepEqual(app.doc, { id: "d1", name: "Poster" });
  assert.ok(app.docs.some((d) => d.id === "d2"));
  assert.equal(app.prefs.collabNick, "Ann");
  assert.equal("shareInviteCode" in c.session, false, "the model never holds the invite code");
});

test("model: changes are actions for the main window; state comes back as a snapshot", async () => {
  const { model, sent, toasts } = bridge();
  const { c } = model;
  const s = c.session;
  await s.chat("Hi all", { thread: "m1" });
  await tick();
  assert.deepEqual(sent.at(-1), { name: "chat.send", args: { text: "Hi all", thread: "m1", links: [] } });
  assert.equal(c.session, s, "the session object stays the same across snapshots, so open forms read fresh state");
  assert.equal(s.chatStore.thread("m1").length, 1);
  assert.equal(s.chatStore.threadCount("m1"), 1);
  // read marker: one action, and not again while nothing is unread
  c.markRead();
  c.markRead();
  await tick();
  assert.equal(sent.filter((a) => a.name === "chat.read").length, 1);
  assert.equal(c.session.chatStore.unread, 0);
  // the invite code only on request
  assert.equal(await c.inviteCode(), "wss://relay/#ofc1.code");
  // a refused action rejects with the main window's words
  await assert.rejects(s.remove("B"), /does not allow/);
  // fire-and-forget calls report through a toast instead
  c.setResolved("t\n1", true);
  await tick();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][1], "danger");
  assert.equal(c.reply("t1", "   "), false);
  assert.equal(c.reply("t1", "Done"), true);
  await tick();
  assert.deepEqual(sent.at(-1), { name: "comment.reply", args: { thread: "t1", text: "Done" } });
  // leaving: the session is gone with the next snapshot
  await c.leave();
  await tick();
  assert.equal(c.session, null);
  assert.equal(c.status().connected, false);
});

test("model: update reports what has to be rendered again", () => {
  const { model, state } = bridge();
  assert.equal(model.update(makeSnapshot(state)), "none");
  state.session.chat.push(msg({ id: "m9" }));
  assert.equal(model.update(makeSnapshot(state)), "chat");
  state.docIds.push("d3");
  assert.equal(model.update(makeSnapshot(state)), "all");
});

test("Collaboration is never rendered inside the app window", () => {
  // the UI module is only loaded by the Collaboration window's page
  const dir = join(root, "app/src");
  const importers = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js") && /ui\/collab\/window\.js|["']\.\/window\.js["']/.test(readFileSync(p, "utf8")) && /[\\/]ui[\\/]collab[\\/]/.test(p)) importers.push(e.name);
    }
  };
  walk(dir);
  assert.deepEqual(importers, ["remote-view.js"]);
  const runtime = read("app/src/ui/collab/runtime.js");
  assert.equal(/showCollabWindow|collabPopout|dockBack/.test(runtime), false);
  assert.match(runtime, /remote-host\.js"\)\)\.openWindow\(/);
  // one window on the desktop: a fixed label the capability and the Rust side know
  assert.ok(JSON.parse(read("src-tauri/capabilities/default.json")).windows.includes(WINDOW_LABEL));
  assert.match(read("src-tauri/src/lib.rs"), new RegExp(`COLLAB_WINDOW: &str = "${WINDOW_LABEL}"`));
  assert.match(read("app/src/ui/popout.js"), /getByLabel\(WINDOW_LABEL\)/);
});
