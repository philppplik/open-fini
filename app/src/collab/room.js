// Room membership and permissions: a pure state machine (no DOM, no crypto, no network).
//
// The room is "who is here, with which role". The host is the member whose id is in the invite code (it cannot be
// claimed: member ids are hashes of signing keys, see crypto.js). Only the host may assign roles, remove members and
// rotate the key; everyone else follows the host's `state` / `role` / `remove` messages. When the host is gone, roles
// freeze (nobody can change them) and the room keeps working for chat, comments and presence.
//
// Public API
//   new RoomState({ me, host, defaultRole })
//   .members            Map<id, Member>   Member = { id, profile, role, dh, online, lastSeen, presence, typing }
//   .roleOf(id)         "host" | "editor" | "commenter" | "viewer" (unknown members: the default role)
//   .allowed(id, type)  may member `id` send a message of `type` (protocol.js PERMISSION)
//   .apply(sender, msg, now) → { changed:boolean, event?:string, data?:any }   applies a validated message
//   .snapshot()         the host's `state` payload (roles + default role)
//   .expire(now, ms)    marks members offline after `ms` without a message
// Invariants: the host's role is always "host"; a removed member never re-appears in this room epoch;
// roles from anyone but the host are ignored.
import { canDo, LIMITS } from "./protocol.js";

export class RoomState {
  /** @param {{me:string, host:string, defaultRole?:string}} o */
  constructor({ me, host, defaultRole = "editor" }) {
    this.me = me;
    this.host = host;
    this.defaultRole = defaultRole;
    /** @type {Map<string, any>} */
    this.members = new Map();
    this.roles = new Map(); // id → role assigned by the host
    this.removed = new Set();
  }

  get isHost() {
    return this.me === this.host;
  }

  roleOf(id) {
    if (id === this.host) return "host";
    return this.roles.get(id) || this.defaultRole;
  }

  allowed(id, type) {
    if (this.removed.has(id)) return false;
    return canDo(this.roleOf(id), type);
  }

  /** Adds or refreshes a member (from hello/profile or any message). Returns true when the member is new. */
  touch(id, now) {
    let m = this.members.get(id);
    const isNew = !m;
    if (!m) {
      if (this.members.size >= LIMITS.members * 2) return false;
      m = { id, profile: null, dh: null, online: true, lastSeen: now, presence: null, typing: false };
      this.members.set(id, m);
    }
    m.online = true;
    m.lastSeen = now;
    return isNew;
  }

  /**
   * Applies a validated message from `sender` (the caller has already checked crypto and permissions).
   * @returns {{changed:boolean, event?:string, data?:any}}
   */
  apply(sender, msg, now = Date.now()) {
    if (this.removed.has(sender)) return { changed: false };
    const fromHost = sender === this.host;
    switch (msg.t) {
      case "hello":
      case "profile": {
        const was = this.members.get(sender);
        const wasOnline = !!was?.online && !!was?.profile;
        this.touch(sender, now);
        const m = this.members.get(sender);
        if (!m) return { changed: false };
        m.profile = msg.profile;
        if (msg.dh) m.dh = msg.dh;
        return { changed: true, event: wasOnline ? "profile" : "join", data: m };
      }
      case "bye": {
        const m = this.members.get(sender);
        if (!m) return { changed: false };
        m.online = false;
        m.typing = false;
        return { changed: true, event: "leave", data: m };
      }
      case "state": {
        if (!fromHost || msg.host !== this.host) return { changed: false };
        this.defaultRole = msg.defaultRole;
        this.roles = new Map(Object.entries(msg.roles).filter(([id, r]) => id !== this.host && r !== "host"));
        return { changed: true, event: "roles" };
      }
      case "role": {
        if (!fromHost || msg.member === this.host) return { changed: false };
        this.roles.set(msg.member, msg.role);
        return { changed: true, event: "roles", data: { member: msg.member, role: msg.role } };
      }
      case "remove": {
        if (!fromHost || msg.member === this.host) return { changed: false };
        this.removed.add(msg.member);
        const m = this.members.get(msg.member);
        if (m) m.online = false;
        return { changed: true, event: msg.member === this.me ? "removed-me" : "removed", data: { member: msg.member } };
      }
      default: {
        // any other message proves the sender is online
        const isNew = this.touch(sender, now);
        if (msg.t === "typing") this.members.get(sender).typing = msg.on;
        if (msg.t === "chat") this.members.get(sender).typing = false;
        if (msg.t === "presence") this.members.get(sender).presence = msg;
        return { changed: isNew || msg.t === "typing", event: isNew ? "join" : msg.t };
      }
    }
  }

  /** Host only: assigns a role locally (the caller broadcasts the `role` message). */
  setRole(id, role) {
    if (!this.isHost || id === this.host) return false;
    this.roles.set(id, role);
    return true;
  }

  /** The `state` payload the host sends to new members. */
  snapshot() {
    return { host: this.host, roles: Object.fromEntries(this.roles), defaultRole: this.defaultRole };
  }

  /** Marks members offline when they have been silent for `ms`. Returns the ids that changed. */
  expire(now, ms = 45000) {
    const out = [];
    for (const m of this.members.values()) {
      if (m.online && now - m.lastSeen > ms) {
        m.online = false;
        m.typing = false;
        out.push(m.id);
      }
    }
    return out;
  }

  /** Members that are online (excluding me), host first, then by nickname. */
  online() {
    return [...this.members.values()].filter((m) => m.online && m.id !== this.me && !this.removed.has(m.id)).sort((a, b) => (a.id === this.host ? -1 : b.id === this.host ? 1 : (a.profile?.nick || "").localeCompare(b.profile?.nick || "")));
  }

  /** Forgets everything except the host and the roles (after a key rotation the remaining members say hello again). */
  resetForEpoch(removed = []) {
    for (const id of removed) {
      this.removed.add(id);
      this.members.delete(id);
      this.roles.delete(id);
    }
  }
}
