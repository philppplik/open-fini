// Collaboration protocol: message types, limits and strict validation of every decrypted message. Pure (no DOM).
//
// Every message is a plain JSON object `{ t: <type>, ts: <ms since epoch>, ...fields }`. It is validated twice:
// before sending (a bug must not produce frames other clients reject) and after decrypting (other members are
// untrusted: a member may run a modified client). Validation is a whitelist: unknown types and unknown fields are
// rejected, every string has a maximum length, numbers are finite and ranged, arrays are capped. Text is plain text
// only: the UI renders it with textContent, never as HTML.
//
// Public API
//   LIMITS, ROLES, ROLE_RANK, PERMISSION, TYPES   constants (see docs/collaboration.md ▸ Protocol)
//   validateMessage(msg) → { ok:true, msg } | { ok:false, error }   (returns a cleaned copy with only known fields)
//   canDo(role, type)                            whether a role may send a message type
//   parseMentions(text, members)                 member ids @mentioned in text
//   cleanText(text, max)                         strips control characters (keeps \n and \t), trims to `max`
//   sanitizeFileName(name)                       safe display/save name

export const LIMITS = Object.freeze({
  frameBytes: 256 * 1024, // one wire frame (the relay enforces the same limit)
  chatText: 4000,
  commentText: 4000,
  nick: 32,
  initials: 3,
  avatarChars: 24 * 1024, // data URL of the avatar (≤ 128 px, PNG/WebP/JPEG), re-decoded by the receiver
  fileBytes: 25 * 1024 * 1024,
  chunkBytes: 48 * 1024, // raw bytes per file chunk (base64 grows this by 4/3)
  fileName: 120,
  chatHistory: 500, // messages kept in memory
  stateChat: 60, // recent messages the host sends to a new member
  members: 32,
  links: 8,
  mentions: 16,
  ids: 64, // selected layer ids in presence
  label: 120,
  docName: 120,
  idChars: 64,
  reactions: 8,
  ops: 512, // ops per "op" message ("Edit together", beta); each op is validated by collab/tree-crdt.js or text-crdt.js
  opPath: 512, // file path of a text op (Code studio)
  skewMs: 10 * 60 * 1000, // messages older/newer than this are rejected (replay window across sessions)
  presencePerSecond: 20,
});

/** Roles, weakest first. */
export const ROLES = Object.freeze(["viewer", "commenter", "editor", "host"]);
export const ROLE_RANK = Object.freeze({ viewer: 0, commenter: 1, editor: 2, host: 3 });

/** The weakest role that may send each message type. */
export const PERMISSION = Object.freeze({
  hello: "viewer",
  profile: "viewer",
  bye: "viewer",
  chat: "viewer",
  "chat-edit": "viewer",
  "chat-del": "viewer",
  react: "viewer",
  typing: "viewer",
  presence: "viewer",
  "file-offer": "commenter",
  "file-chunk": "commenter",
  comment: "commenter",
  activity: "editor",
  op: "editor",
  share: "editor",
  live: "viewer",
  state: "host",
  role: "host",
  remove: "host",
  rotate: "host",
});
export const TYPES = Object.freeze(Object.keys(PERMISSION));

export const canDo = (role, type) => type in PERMISSION && (ROLE_RANK[role] ?? -1) >= ROLE_RANK[PERMISSION[type]];

export const REACTIONS = Object.freeze(["👍", "❤️", "😄", "🎉", "👀", "✅"]);
export const COLORS = Object.freeze(["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#6e56cf", "#d6409f"]);

// ------------------------------------------------------------------ primitives

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f‎‏‪-‮⁦-⁩]/g;
/** Plain text without control or bidi-override characters (keeps newline and tab), cut to `max`. */
export function cleanText(text, max) {
  return String(text ?? "").replace(CTRL, "").slice(0, max);
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const MEMBER_RE = /^[A-Za-z0-9_-]{22}$/;
const B64U_RE = /^[A-Za-z0-9_-]*$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
// a project-relative file path: no leading slash, no "..", no backslashes or control characters
// eslint-disable-next-line no-control-regex
const PATH_RE = /^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$))[^\\\u0000-\u001f]+$/;
const AVATAR_RE = /^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

class Invalid extends Error {}
const fail = (m) => {
  throw new Invalid(m);
};

const V = {
  str: (max, { min = 0, re = null } = {}) => (v, p) => {
    if (typeof v !== "string") fail(`${p} must be text`);
    if (v.length < min || v.length > max) fail(`${p} has an invalid length`);
    if (re && !re.test(v)) fail(`${p} has invalid characters`);
    return v;
  },
  text: (max, { min = 0 } = {}) => (v, p) => {
    if (typeof v !== "string") fail(`${p} must be text`);
    const t = cleanText(v, max + 1);
    if (t.length > max) fail(`${p} is too long`);
    if (t.trim().length < min) fail(`${p} is empty`);
    return t;
  },
  id: () => V.str(64, { min: 1, re: ID_RE }),
  member: () => V.str(22, { min: 22, re: MEMBER_RE }),
  b64u: (max) => V.str(max, { re: B64U_RE }),
  int: (min, max) => (v, p) => (Number.isInteger(v) && v >= min && v <= max ? v : fail(`${p} must be a whole number between ${min} and ${max}`)),
  num: (min, max) => (v, p) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fail(`${p} is out of range`)),
  bool: () => (v, p) => (typeof v === "boolean" ? v : fail(`${p} must be true or false`)),
  oneOf: (...opts) => (v, p) => (opts.includes(v) ? v : fail(`${p} has an unknown value`)),
  arr: (item, max) => (v, p) => {
    if (!Array.isArray(v) || v.length > max) fail(`${p} must be a list of at most ${max}`);
    return v.map((x, i) => item(x, `${p}[${i}]`));
  },
  obj: (shape, required = []) => (v, p) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${p} must be an object`);
    const out = {};
    for (const k of Object.keys(v)) if (!(k in shape)) fail(`${p}.${k} is not allowed`);
    for (const k of required) if (v[k] === undefined) fail(`${p}.${k} is missing`);
    for (const [k, check] of Object.entries(shape)) if (v[k] !== undefined) out[k] = check(v[k], `${p}.${k}`);
    return out;
  },
  /** A plain object (not an array); its contents are validated by the module that uses it. */
  plain: () => (v, p) => (v && typeof v === "object" && !Array.isArray(v) ? v : fail(`${p} must be an object`)),
  /** { key: value } with validated keys and values, at most `max` entries. */
  map: (key, value, max) => (v, p) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${p} must be an object`);
    const keys = Object.keys(v);
    if (keys.length > max) fail(`${p} has too many entries`);
    const out = {};
    for (const k of keys) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") fail(`${p} has a forbidden key`);
      out[key(k, `${p} key`)] = value(v[k], `${p}.${k}`);
    }
    return out;
  },
};

// ------------------------------------------------------------------ shared shapes

const PROFILE = V.obj({ nick: V.text(LIMITS.nick, { min: 1 }), color: V.str(7, { re: COLOR_RE }), initials: V.text(LIMITS.initials), avatar: V.str(LIMITS.avatarChars, { re: AVATAR_RE }) }, ["nick", "color"]);
const STUDIO = V.str(24, { re: /^[a-z0-9-]{1,24}$/ });
/** A link to an object in a document: a layer, a page, a code line or an office paragraph. */
const LINK = V.obj({ kind: V.oneOf("node", "page", "line", "text", "comment", "version"), doc: V.id(), id: V.str(256), page: V.id(), label: V.text(LIMITS.label), line: V.int(1, 10_000_000) }, ["kind", "doc", "label"]);
const RECT = V.obj({ x: V.num(-1e7, 1e7), y: V.num(-1e7, 1e7), w: V.num(0, 1e7), h: V.num(0, 1e7) }, ["x", "y", "w", "h"]);

/** Where a comment thread is anchored. See collab/comments.js. */
export const ANCHOR = V.obj(
  {
    kind: V.oneOf("doc", "page", "node", "region", "text", "line", "element"),
    page: V.id(), // page id (page, node, region)
    node: V.id(), // layer id (node)
    rect: RECT, // page coordinates (region), or a hint position for node/page
    pin: V.obj({ x: V.num(-1e7, 1e7), y: V.num(-1e7, 1e7) }, ["x", "y"]), // clicked point in page coordinates (fallback when the layer is gone)
    off: V.obj({ x: V.num(-1000, 1000), y: V.num(-1000, 1000) }, ["x", "y"]), // the point relative to the layer / element box (0..1 = inside)
    elem: V.str(256), // website element id (Code studio preview) the comment is attached to
    path: V.str(512), // file path (Code studio) or paragraph path as JSON (Office studio)
    line: V.int(1, 10_000_000), // first line (Code studio)
    endLine: V.int(1, 10_000_000),
    col: V.int(0, 1e7), // columns (Code studio), 0-based
    endCol: V.int(0, 1e7),
    from: V.int(0, 1e9), // text offsets (Office studio: offsets in the block at `path`)
    to: V.int(0, 1e9),
    quote: V.text(200), // the commented text, for display when the anchor moved
  },
  ["kind"],
);

const COMMENT_MSG = V.obj({ id: V.id(), author: V.member(), nick: V.text(LIMITS.nick), color: V.str(7, { re: COLOR_RE }), text: V.text(LIMITS.commentText, { min: 1 }), ts: V.int(0, 1e14), edited: V.int(0, 1e14), deleted: V.bool(), mentions: V.arr(V.member(), LIMITS.mentions) }, ["id", "author", "text", "ts"]);
export const THREAD = V.obj(
  { id: V.id(), anchor: ANCHOR, author: V.member(), nick: V.text(LIMITS.nick), color: V.str(7, { re: COLOR_RE }), ts: V.int(0, 1e14), resolved: V.bool(), resolvedBy: V.text(LIMITS.nick), resolvedAt: V.int(0, 1e14), messages: V.arr(COMMENT_MSG, 200) },
  ["id", "anchor", "author", "ts", "messages"],
);
const COMMENT_OP = V.obj(
  {
    op: V.oneOf("add", "reply", "edit", "delete", "resolve", "reopen", "drop", "reanchor"),
    thread: THREAD, // add
    anchor: ANCHOR, // reanchor (a dragged pin)
    threadId: V.id(),
    msg: COMMENT_MSG, // reply
    msgId: V.id(),
    text: V.text(LIMITS.commentText, { min: 1 }),
  },
  ["op"],
);

const CHAT_FILE = V.obj({ fid: V.id(), name: V.text(LIMITS.fileName, { min: 1 }), mime: V.str(100), size: V.int(0, LIMITS.fileBytes) }, ["fid", "name", "size"]);
const CHAT = V.obj({ id: V.id(), text: V.text(LIMITS.chatText), reply: V.id(), thread: V.id(), mentions: V.arr(V.member(), LIMITS.mentions), links: V.arr(LINK, LIMITS.links), file: CHAT_FILE });

// ------------------------------------------------------------------ message types

const BASE = { t: V.oneOf(...TYPES), ts: V.int(0, 1e14) };
const SHAPES = {
  hello: [{ profile: PROFILE, dh: V.b64u(120), want: V.bool(), app: V.str(24) }, ["profile", "dh"]],
  profile: [{ profile: PROFILE }, ["profile"]],
  bye: [{}, []],
  chat: [{ msg: CHAT }, ["msg"]],
  "chat-edit": [{ id: V.id(), text: V.text(LIMITS.chatText, { min: 1 }) }, ["id", "text"]],
  "chat-del": [{ id: V.id() }, ["id"]],
  react: [{ id: V.id(), emoji: V.oneOf(...REACTIONS), on: V.bool() }, ["id", "emoji", "on"]],
  typing: [{ on: V.bool() }, ["on"]],
  presence: [
    {
      doc: V.id(),
      docName: V.text(LIMITS.docName),
      studio: STUDIO,
      page: V.id(),
      x: V.num(-1e7, 1e7),
      y: V.num(-1e7, 1e7),
      sel: V.arr(V.id(), LIMITS.ids),
      tool: V.str(40, { re: /^[A-Za-z0-9_.-]{0,40}$/ }),
      view: RECT,
      caret: V.obj({ path: V.str(512), line: V.int(1, 10_000_000), ch: V.int(0, 1e7), from: V.int(0, 1e9), to: V.int(0, 1e9) }),
      away: V.bool(),
    },
    ["studio"],
  ],
  "file-offer": [{ fid: V.id(), name: V.text(LIMITS.fileName, { min: 1 }), mime: V.str(100), size: V.int(0, LIMITS.fileBytes), chunks: V.int(1, Math.ceil(LIMITS.fileBytes / LIMITS.chunkBytes)), sha: V.b64u(43), purpose: V.oneOf("file", "doc", "version", "live"), doc: V.id(), note: V.text(200), to: V.member() }, ["fid", "name", "size", "chunks", "sha"]],
  "file-chunk": [{ fid: V.id(), i: V.int(0, 100000), data: V.str(Math.ceil((LIMITS.chunkBytes * 4) / 3) + 4, { re: /^[A-Za-z0-9+/]*={0,2}$/ }) }, ["fid", "i", "data"]],
  comment: [{ doc: V.id(), op: COMMENT_OP }, ["doc", "op"]],
  activity: [{ doc: V.id(), docName: V.text(LIMITS.docName), page: V.id(), pageName: V.text(LIMITS.label), label: V.text(LIMITS.label, { min: 1 }), count: V.int(1, 100000), nodes: V.arr(V.id(), LIMITS.ids) }, ["doc", "label", "count"]],
  // live editing (docs/collaboration.md ▸ Live editing): the envelope is checked here, every entry of `ops` by
  // validateTreeOp / validateTextOp before it is applied
  op: [{ doc: V.id(), kind: V.oneOf("tree", "text"), path: V.str(LIMITS.opPath, { min: 1, re: PATH_RE }), ops: V.arr(V.plain(), LIMITS.ops) }, ["doc", "kind", "ops"]],
  share: [{ doc: V.id(), docName: V.text(LIMITS.docName), kind: V.oneOf("tree", "text", "snapshot"), a: V.oneOf("start", "stop", "pause", "resume"), studio: STUDIO }, ["doc", "kind", "a"]],
  live: [{ doc: V.id(), a: V.oneOf("req", "have", "bye", "sent"), to: V.member(), fid: V.id() }, ["doc", "a"]],
  state: [{ host: V.member(), roles: V.map((k, p) => V.member()(k, p), V.oneOf(...ROLES), LIMITS.members * 4), defaultRole: V.oneOf("viewer", "commenter", "editor"), chat: V.arr(V.obj({ from: V.member(), nick: V.text(LIMITS.nick), color: V.str(7, { re: COLOR_RE }), ts: V.int(0, 1e14), msg: CHAT }, ["from", "ts", "msg"]), LIMITS.stateChat) }, ["host", "roles", "defaultRole"]],
  role: [{ member: V.member(), role: V.oneOf("viewer", "commenter", "editor") }, ["member", "role"]],
  remove: [{ member: V.member() }, ["member"]],
  rotate: [{ epoch: V.int(1, 1e6), wraps: V.map((k, p) => V.member()(k, p), V.obj({ iv: V.b64u(16), ct: V.b64u(400) }, ["iv", "ct"]), LIMITS.members), removed: V.arr(V.member(), LIMITS.members) }, ["epoch", "wraps"]],
};

/**
 * Validates a message object (after decryption, or before sending).
 * @returns {{ok:true, msg:object} | {ok:false, error:string}}
 */
export function validateMessage(msg) {
  try {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) fail("message must be an object");
    const type = msg.t;
    const shape = SHAPES[type];
    if (!shape) fail(`unknown message type “${String(type).slice(0, 20)}”`);
    const [fields, required] = shape;
    const clean = V.obj({ ...BASE, ...fields }, ["t", "ts", ...required])(msg, type);
    return { ok: true, msg: clean };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    return { ok: false, error: "invalid message" };
  }
}

/** Validates one comment thread (documents load these from .ofini files). */
export function validateThread(thread) {
  try {
    return { ok: true, thread: THREAD(thread, "thread") };
  } catch (e) {
    return { ok: false, error: e instanceof Invalid ? e.message : "invalid thread" };
  }
}

/** Ids of the members whose nickname is @mentioned (case-insensitive, longest names first). */
export function parseMentions(text, members) {
  const out = [];
  const s = String(text || "").toLowerCase();
  const list = [...members].filter((m) => m?.nick).sort((a, b) => b.nick.length - a.nick.length);
  const taken = new Set(); // start positions already claimed by a longer name ("@Mia Wong" is not also "@Mia")
  for (const m of list) {
    const needle = `@${m.nick.toLowerCase()}`;
    let i = s.indexOf(needle);
    while (i >= 0) {
      const next = s.charAt(i + needle.length);
      if (!taken.has(i) && (!next || !/[\p{L}\p{N}_]/u.test(next))) {
        taken.add(i);
        if (!out.includes(m.id)) out.push(m.id);
      }
      i = s.indexOf(needle, i + 1);
    }
    if (out.length >= LIMITS.mentions) break;
  }
  return out;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
/** A file name that is safe to show and to offer as a download name: no paths, no control characters, no reserved names. */
export function sanitizeFileName(name) {
  let n = cleanText(name, 400)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .replace(/\s+/g, " ");
  if (!n || RESERVED.test(n)) n = `file${n ? `_${n}` : ""}`;
  if (n.length > LIMITS.fileName) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : "";
    n = n.slice(0, LIMITS.fileName - ext.length) + ext;
  }
  return n;
}

/** Initials from a nickname ("Mia Wong" → "MW"). */
export function initialsOf(nick) {
  const parts = cleanText(nick, LIMITS.nick).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const chars = parts.length === 1 ? [...parts[0]].slice(0, 2) : [[...parts[0]][0], [...parts[parts.length - 1]][0]];
  return chars.join("").toUpperCase();
}
