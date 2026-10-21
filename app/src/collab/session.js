// A collaboration session: one room, one transport, one identity. Glues crypto, protocol, membership, chat and file
// transfer together. No DOM: the UI (app/src/ui/collab/) listens to its events; tests drive it with the memory hub.
//
// Lifecycle
//   const s = await CollabSession.create({ relay, profile, transportFactory })   // host: new room
//   const s = await CollabSession.join({ invite, profile, transportFactory })    // member: from an invite code
//   await s.start()      derive keys, connect, say hello
//   s.leave()            say bye, close (the host rotates the key for everyone else)
//
// Sending (each validates the message first and throws on invalid input):
//   chat(text, { reply, thread, links, file })  editChat(id, text)  deleteChat(id)  react(id, emoji, on)  typing(on)
//   presence(payload)  activity(payload)  comment(doc, op)  sendFile(bytes, { name, purpose, doc, note }) → fid
//   setRole(id, role)  remove(id)  (host only)   op(payload) ("Edit together", beta)
//
// Events (Emitter): "status" {state, host, peers, members, epoch, encrypted:true} · "members" · "chat" · "notify"
//   {kind:"mention"|"reply", message} · "presence" {member} · "comment" {doc, op, sender} · "file-progress" {transfer}
//   · "file" {transfer, bytes} · "op" {sender, msg} · "removed" · "rotated" {invite} · "rejected" {reason, code}
//   · "error" {error}
//
// Security invariants (tests/collab/session.test.js):
//   * frames are processed strictly in order (one queue), so counters stay monotonic and replay checks are exact;
//   * a frame is used only after signature, AEAD, replay, timestamp-window, schema, rate and permission checks;
//   * secrets and invite codes are never logged (the logger is injected and only receives reasons and counts).
import { Emitter } from "../core/util.js";
import { LIMITS, validateMessage, parseMentions, cleanText, initialsOf } from "./protocol.js";
import { deriveRoom, formatInvite, parseInvite, newIdentity, newRoomId, newRoomSecret, seal, open, ReplayGuard, wrapFor, unwrapFrom, sha256B64u, relayHost, randomB64u } from "./crypto.js";
import { RoomState } from "./room.js";
import { ChatStore } from "./chat.js";
import { Assembler, checkFile, chunkCount, sliceChunk } from "./files.js";
import { TokenBucket } from "./presence.js";

const newMsgId = () => randomB64u(9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CollabSession extends Emitter {
  /** Creates a new room with me as host. */
  static async create({ relay, profile, defaultRole = "editor", transportFactory, log, now }) {
    const identity = await newIdentity();
    const invite = { relay, room: newRoomId(), secret: newRoomSecret(), host: identity.id };
    formatInvite(invite); // validates the relay address
    return new CollabSession({ invite, identity, profile, defaultRole, transportFactory, log, now });
  }

  /** Joins a room from an invite code (text). Throws CollabCryptoError('bad_invite'). */
  static async join({ invite, profile, transportFactory, log, now }) {
    const parsed = typeof invite === "string" ? parseInvite(invite) : invite;
    const identity = await newIdentity();
    return new CollabSession({ invite: parsed, identity, profile, transportFactory, log, now });
  }

  constructor({ invite, identity, profile, defaultRole = "editor", transportFactory, log = null, now = () => Date.now() }) {
    super();
    this.invite = { ...invite };
    this.me = identity;
    this.profile = normalizeProfile(profile);
    this.transportFactory = transportFactory;
    this.log = log;
    this.now = now;
    this.room = new RoomState({ me: identity.id, host: invite.host, defaultRole });
    this.chatStore = new ChatStore({ me: identity.id });
    this.files = new Assembler({ verify: async (bytes, sha) => (await sha256B64u(bytes)) === sha });
    this.keys = null;
    this.transport = null;
    this.guard = new ReplayGuard();
    this.counter = 0;
    this.state = "idle";
    this.peers = null;
    this.rejected = 0;
    this.buckets = new Map();
    this.#inQ = Promise.resolve();
    this.#outQ = Promise.resolve();
    this.offStatus = null;
  }

  #inQ;
  #outQ;
  #rotateTimer = null;
  #pendingRemoved = new Set();

  get id() {
    return this.me.id;
  }
  get isHost() {
    return this.room.isHost;
  }
  get myRole() {
    return this.room.roleOf(this.me.id);
  }
  get epoch() {
    return this.keys?.epoch ?? 0;
  }
  /** The current invite code. Shown in the UI on request; never logged, never stored in profiles or documents. */
  get inviteCode() {
    return formatInvite(this.invite);
  }
  get relayHost() {
    return relayHost(this.invite.relay);
  }
  get fingerprint() {
    return this.keys?.fingerprint || [];
  }
  get members() {
    return this.room.online();
  }
  member(id) {
    return id === this.me.id ? { id, profile: this.profile, online: true } : this.room.members.get(id) || null;
  }

  status() {
    return { state: this.state, host: this.relayHost, peers: this.peers, members: this.room.online().length + 1, epoch: this.epoch, encrypted: true, role: this.myRole };
  }

  #setState(state, extra = {}) {
    this.state = state;
    if (extra.peers !== undefined) this.peers = extra.peers;
    this.emit("status", { ...this.status(), ...(extra.error ? { error: extra.error } : {}) });
  }

  // ------------------------------------------------------------------ connect / leave

  async start() {
    this.keys = await deriveRoom({ secret: this.invite.secret, room: this.invite.room, host: this.invite.host, epoch: this.keys?.epoch ?? 0 });
    await this.#connect();
    await this.send("hello", { profile: this.profile, dh: this.me.dhPub, want: true });
    this.#expiry = setInterval(() => this.#tick(), 5000);
    this.#expiry.unref?.();
    this.#heartbeat = 0;
    return this;
  }

  #expiry = null;
  #heartbeat = 0;
  #tick() {
    const gone = this.room.expire(this.now(), 45000);
    if (gone.length) this.emit("members");
    // a light heartbeat keeps members "online" while nobody types or moves
    if (++this.#heartbeat % 4 === 0 && this.state === "open") this.send("typing", { on: false }).catch(() => {});
  }

  async #connect() {
    this.offStatus?.();
    this.transport?.close();
    this.#setState("connecting");
    const tr = this.transportFactory(this.invite.relay);
    this.transport = tr;
    tr.onFrame((f) => this.#enqueue(f));
    this.offStatus = tr.onStatus((s) => {
      if (tr !== this.transport) return;
      if (s.state === "open") this.#setState("open", { peers: s.peers ?? null });
      else if (s.state === "reconnecting") this.#setState("reconnecting");
      else if (s.state === "closed" && this.state !== "left") this.#setState("closed", { error: s.error });
      else if (s.state === "error") this.emit("error", { error: s.error });
    });
    await tr.connect({ room: this.invite.room, token: this.keys.accessToken });
    if (this.state === "connecting") this.#setState("open");
  }

  /** Leaves the room: tells the others, closes the connection. */
  async leave() {
    if (this.state === "left") return;
    try {
      if (this.state === "open") await this.send("bye", {});
    } catch {
      /* best effort */
    }
    this.#close("left");
  }

  #close(state) {
    clearInterval(this.#expiry);
    clearTimeout(this.#rotateTimer);
    this.offStatus?.();
    this.transport?.close();
    this.transport = null;
    this.#setState(state);
  }

  // ------------------------------------------------------------------ sending

  /** Validates, encrypts, signs and sends one message. Resolves when it was handed to the transport. */
  send(type, fields) {
    const msg = { t: type, ts: this.now(), ...fields };
    const v = validateMessage(msg);
    if (!v.ok) return Promise.reject(new Error(`Invalid ${type} message: ${v.error}`));
    if (!this.room.allowed(this.me.id, type)) return Promise.reject(new Error(type === "comment" ? "Your role in this room does not allow comments." : "Your role in this room does not allow this."));
    const job = this.#outQ.then(async () => {
      if (!this.transport || !this.keys) throw new Error("Not connected to a room.");
      const frame = await seal(this.keys, this.me, ++this.counter, v.msg);
      if (frame.length > LIMITS.frameBytes) throw new Error("The message is too large to send.");
      if (!this.transport.send(frame)) throw new Error("The message could not be sent (not connected).");
      return v.msg;
    });
    this.#outQ = job.catch(() => {});
    return job;
  }

  async chat(text, { reply, thread, links, file } = {}) {
    const clean = cleanText(text, LIMITS.chatText).trim();
    if (!clean && !file) throw new Error("The message is empty.");
    const all = [...this.room.members.values()].filter((m) => m.profile);
    const mentions = parseMentions(clean, all.map((m) => ({ id: m.id, nick: m.profile.nick })));
    const msg = { id: newMsgId(), text: clean, ...(reply ? { reply } : {}), ...(thread ? { thread } : {}), ...(mentions.length ? { mentions } : {}), ...(links?.length ? { links } : {}), ...(file ? { file } : {}) };
    await this.send("chat", { msg });
    const m = this.chatStore.add(this.me.id, this.profile, msg, { local: true, ts: this.now() });
    this.emit("chat", { message: m });
    return m;
  }

  async editChat(id, text) {
    const clean = cleanText(text, LIMITS.chatText).trim();
    if (!this.chatStore.byId.get(id) || this.chatStore.byId.get(id).from !== this.me.id) throw new Error("You can only edit your own messages.");
    await this.send("chat-edit", { id, text: clean });
    this.chatStore.edit(this.me.id, id, clean, this.now());
    this.emit("chat", {});
  }

  async deleteChat(id) {
    if (this.chatStore.byId.get(id)?.from !== this.me.id) throw new Error("You can only delete your own messages.");
    await this.send("chat-del", { id });
    this.chatStore.remove(this.me.id, id);
    this.emit("chat", {});
  }

  async react(id, emoji, on) {
    await this.send("react", { id, emoji, on });
    this.chatStore.react(this.me.id, id, emoji, on);
    this.emit("chat", {});
  }

  typing(on) {
    return this.send("typing", { on: !!on });
  }

  presence(p) {
    return this.send("presence", p);
  }

  async activity(a) {
    await this.send("activity", a);
    this.chatStore.addActivity(this.me.id, this.profile, a, this.now());
    this.emit("chat", {});
  }

  comment(doc, op) {
    return this.send("comment", { doc, op });
  }

  op(payload) {
    return this.send("op", payload);
  }

  async updateProfile(profile) {
    this.profile = normalizeProfile(profile);
    if (this.state === "open") await this.send("profile", { profile: this.profile });
    this.emit("members");
  }

  /**
   * Sends a file in encrypted chunks. Returns the file id; progress is reported with "file-progress" events
   * ({ transfer: { fid, name, size, sent, outgoing:true } }).
   */
  async sendFile(bytes, { name, purpose = "file", doc, note, onProgress } = {}) {
    const chk = checkFile(name, bytes.length);
    if (!chk.ok) throw new Error(chk.error);
    const fid = newMsgId();
    const chunks = chunkCount(bytes.length);
    const sha = await sha256B64u(bytes);
    await this.send("file-offer", { fid, name: chk.name, mime: chk.mime, size: bytes.length, chunks, sha, purpose, ...(doc ? { doc } : {}), ...(note ? { note: cleanText(note, 200) } : {}) });
    const t = { fid, name: chk.name, size: bytes.length, sent: 0, outgoing: true, purpose };
    for (let i = 0; i < chunks; i++) {
      await this.send("file-chunk", { fid, i, data: sliceChunk(bytes, i) });
      t.sent = Math.min(bytes.length, (i + 1) * LIMITS.chunkBytes);
      onProgress?.(t);
      this.emit("file-progress", { transfer: t });
      if (i % 8 === 7) await sleep(120); // stay well below the relay's rate limits
    }
    return { fid, name: chk.name, mime: chk.mime, size: bytes.length };
  }

  // ------------------------------------------------------------------ host controls

  async setRole(id, role) {
    if (!this.isHost) throw new Error("Only the host can change roles.");
    await this.send("role", { member: id, role });
    this.room.setRole(id, role);
    this.emit("members");
  }

  /** Removes a member and rotates the room key so the removed member cannot read anything that follows. */
  async remove(id) {
    if (!this.isHost) throw new Error("Only the host can remove members.");
    if (id === this.me.id) throw new Error("The host cannot remove itself; leave the room instead.");
    await this.send("remove", { member: id });
    this.room.apply(this.me.id, { t: "remove", member: id });
    this.room.resetForEpoch([id]);
    this.files.dropFrom(id);
    await this.rotate([id]);
    this.emit("members");
  }

  /**
   * Host: draws a new secret and room id, wraps them for every remaining member (ECDH) and switches over.
   * Members that are offline at this moment need a new invite code.
   */
  async rotate(removed = []) {
    if (!this.isHost) throw new Error("Only the host can rotate the room key.");
    const next = { secret: newRoomSecret(), room: newRoomId(), epoch: this.epoch + 1 };
    const wraps = {};
    for (const m of this.room.online()) {
      if (!m.dh || removed.includes(m.id)) continue;
      wraps[m.id] = await wrapFor(this.me.dh, m.dh, next, `rotate|${this.invite.room}|${next.epoch}|${m.id}`);
    }
    await this.send("rotate", { epoch: next.epoch, wraps, ...(removed.length ? { removed } : {}) });
    await this.#switchTo(next);
  }

  async #switchTo({ secret, room, epoch }) {
    this.invite = { ...this.invite, secret, room };
    this.keys = await deriveRoom({ secret, room, host: this.invite.host, epoch });
    this.guard = new ReplayGuard();
    await this.#connect();
    await this.send("hello", { profile: this.profile, dh: this.me.dhPub, want: true });
    this.chatStore.addSystem("The room key was changed. Compare the new verification words.", this.now());
    this.emit("rotated", { epoch });
    this.emit("chat", {});
    this.emit("status", this.status());
  }

  // ------------------------------------------------------------------ receiving

  #enqueue(frame) {
    this.#inQ = this.#inQ.then(() => this.#receive(frame)).catch((err) => this.#reject("internal", err?.message || "error"));
  }

  /** For tests: resolves when every frame received so far has been processed. */
  settled() {
    return this.#inQ;
  }

  #reject(code, reason) {
    this.rejected++;
    this.log?.warn?.("collab", `Rejected a message: ${code}${reason ? ` (${String(reason).slice(0, 80)})` : ""}`);
    this.emit("rejected", { code, reason });
  }

  async #receive(frame) {
    if (typeof frame !== "string" || frame.length > LIMITS.frameBytes || !this.keys) return this.#reject("too_large");
    let opened;
    try {
      opened = await open(this.keys, frame, this.guard);
    } catch (e) {
      // frames of an older epoch can still be in flight right after a rotation: drop them quietly
      if (e.code === "decrypt" && /epoch/.test(e.message)) return;
      return this.#reject(e.code || "bad_envelope", e.message);
    }
    const { sender } = opened;
    if (sender === this.me.id) return; // own echo
    const v = validateMessage(opened.message);
    if (!v.ok) return this.#reject("schema", v.error);
    const msg = v.msg;
    if (Math.abs(msg.ts - this.now()) > LIMITS.skewMs) return this.#reject("stale", "timestamp outside the allowed window");
    let bucket = this.buckets.get(sender);
    if (!bucket) this.buckets.set(sender, (bucket = new TokenBucket(120, 300, this.now)));
    if (!bucket.take()) return this.#reject("rate", "too many messages");
    if (!this.room.allowed(sender, msg.t)) return this.#reject("permission", `${msg.t} not allowed for role ${this.room.roleOf(sender)}`);
    await this.#dispatch(sender, msg);
  }

  async #dispatch(sender, msg) {
    const author = () => this.room.members.get(sender)?.profile || { nick: "?", color: "#888888" };
    const r = this.room.apply(sender, msg, this.now());
    switch (msg.t) {
      case "hello": {
        // a newcomer asks (`want`) for everyone's hello (profile + key-agreement key) and, from the host, the room state
        if (msg.want) {
          await this.send("hello", { profile: this.profile, dh: this.me.dhPub, want: false }).catch(() => {});
          if (this.isHost) await this.send("state", { ...this.room.snapshot(), chat: this.chatStore.recent() }).catch(() => {});
        }
        if (r.event === "join") {
          this.chatStore.addSystem(`${msg.profile.nick} joined.`, this.now());
          this.emit("chat", {});
        }
        this.emit("members");
        break;
      }
      case "profile":
        this.emit("members");
        break;
      case "bye": {
        this.files.dropFrom(sender);
        this.chatStore.addSystem(`${author().nick} left.`, this.now());
        this.emit("members");
        this.emit("chat", {});
        if (this.isHost) this.#scheduleRotation(sender);
        break;
      }
      case "state": {
        if (sender !== this.room.host) break;
        for (const c of msg.chat || []) {
          if (this.chatStore.byId.has(c.msg.id)) continue;
          this.chatStore.add(c.from, { nick: c.nick, color: c.color }, c.msg, { local: true, ts: c.ts });
        }
        this.emit("members");
        this.emit("chat", {});
        break;
      }
      case "chat": {
        const m = this.chatStore.add(sender, author(), msg.msg, { ts: this.now() });
        if (!m) break;
        this.emit("chat", { message: m });
        if (this.chatStore.mentionsMe(m)) this.emit("notify", { kind: "mention", message: m });
        else if (m.reply && this.chatStore.byId.get(m.reply)?.from === this.me.id) this.emit("notify", { kind: "reply", message: m });
        break;
      }
      case "chat-edit":
        if (this.chatStore.edit(sender, msg.id, msg.text, this.now())) this.emit("chat", {});
        break;
      case "chat-del":
        if (this.chatStore.remove(sender, msg.id)) this.emit("chat", {});
        break;
      case "react":
        if (this.chatStore.react(sender, msg.id, msg.emoji, msg.on)) this.emit("chat", {});
        break;
      case "typing":
        if (r.changed) this.emit("members");
        break;
      case "presence":
        if (r.event === "join") this.emit("members");
        this.emit("presence", { member: this.room.members.get(sender) });
        break;
      case "activity":
        this.chatStore.addActivity(sender, author(), msg, this.now());
        this.emit("chat", {});
        break;
      case "comment":
        this.emit("comment", { doc: msg.doc, op: msg.op, sender, isHost: sender === this.room.host });
        break;
      case "op":
        this.emit("op", { sender, msg });
        break;
      case "file-offer": {
        const res = this.files.offer(sender, msg);
        if (!res.ok) return this.#reject("file", res.error);
        this.emit("file-progress", { transfer: res.transfer });
        break;
      }
      case "file-chunk": {
        const res = await this.files.chunk(sender, msg);
        if (!res.ok) {
          if (res.transfer) this.emit("file-progress", { transfer: { ...res.transfer, failed: res.error } });
          return this.#reject("file", res.error);
        }
        if (res.done) this.emit("file", { transfer: res.transfer, bytes: res.transfer.bytes });
        else if (res.transfer.got.size % 4 === 0) this.emit("file-progress", { transfer: res.transfer });
        break;
      }
      case "role":
        this.emit("members");
        break;
      case "remove": {
        if (r.event === "removed-me") {
          this.emit("removed", {});
          this.#close("removed");
          return;
        }
        this.files.dropFrom(msg.member);
        this.emit("members");
        break;
      }
      case "rotate": {
        if (sender !== this.room.host) break;
        const mine = msg.wraps[this.me.id];
        const hostDh = this.room.members.get(sender)?.dh;
        if (!mine || !hostDh) {
          // not re-keyed (removed, or joined too late): this room is over for us
          this.emit("removed", { rotated: true });
          this.#close("removed");
          return;
        }
        const next = await unwrapFrom(this.me.dh, hostDh, mine, `rotate|${this.invite.room}|${msg.epoch}|${this.me.id}`);
        if (!next || typeof next.secret !== "string" || typeof next.room !== "string" || next.epoch !== msg.epoch) return this.#reject("rotate", "bad key material");
        this.room.resetForEpoch(msg.removed || []);
        await this.#switchTo(next);
        break;
      }
      default:
        break;
    }
  }

  #scheduleRotation(left) {
    this.#pendingRemoved.add(left);
    clearTimeout(this.#rotateTimer);
    this.#rotateTimer = setTimeout(() => {
      const removed = [...this.#pendingRemoved];
      this.#pendingRemoved.clear();
      if (this.state === "open") this.rotate(removed).catch((e) => this.emit("error", { error: e }));
    }, 1500);
  }
}

/** A profile as it is sent: nickname, color, initials, optional avatar data URL. */
export function normalizeProfile(p = {}) {
  const nick = cleanText(p.nick || "", LIMITS.nick).trim() || "Guest";
  const color = /^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color.toLowerCase() : "#6e56cf";
  const out = { nick, color, initials: cleanText(p.initials || initialsOf(nick), LIMITS.initials) };
  if (typeof p.avatar === "string" && p.avatar.length <= LIMITS.avatarChars && /^data:image\/(?:png|webp|jpeg);base64,/.test(p.avatar)) out.avatar = p.avatar;
  return out;
}
