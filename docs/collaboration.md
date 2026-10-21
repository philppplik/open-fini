# Collaboration

Work together in OpenFini without an account and without an OpenFini server: a room chat that stays open across studios,
@mentions, replies and threads, files, Google-Docs-style comments, named versions, live cursors and "follow". Everything
in a room is end-to-end encrypted. This guide is for users (first section) and for engineers (the rest).

Decision record: [ADR 0010](adr/0010-collaboration-e2e-relay.md). Security summary: [security.md ▸ Collaboration](security.md#collaboration-rooms).

## What is live, and what is not

| Live in a room | Not live (by design, in this release) |
| --- | --- |
| Chat: messages, @mentions with autocomplete and notification, replies, threads, reactions, edit/delete, typing indicator, links that jump to a layer, page or code line | Simultaneous editing of the **same** document. There is no CRDT/OT for the studios yet. |
| Files (encrypted, chunked, up to 25 MB, allow-listed types, never opened automatically) | Document content does not merge: members exchange **snapshots** ("Share this document", "Send to room" of a version) and choose *Open*, *Open as copy* or *Update my copy* (a version of the old copy is saved first). |
| Activity feed: "Hana · Move · 3 layers on Page 2 · Jump · Show", generated from each member's own edits (can be turned off) | Edits of another member do not appear in your copy until they share a new snapshot. |
| Comments on layers, pages, text and code lines: threads, replies, resolve/reopen, @mentions, synced between members who have the same document (same document id) open | Comments written before you joined are only in documents you share. |
| Presence: pointer with name and tool, selection halos (Vector, Pixel, Layout), carets in the Code and Office editors, current studio, document and page | Presence in the Vibe studio (it shows the studio only). |
| Follow a member: their studio, document, page and viewport (Esc or moving the canvas stops) | Following inside the Office editor (its scroll position is not shared). |

Comments and versions also work **without** a room: comments are saved in the document; versions are snapshots on this device.

## Using it

1. **Profile**: *Settings ▸ Profile and collaboration*: nickname, presence color and an optional picture (reduced to at
   most 128 px). Stored only on this device; never part of exported settings profiles.
2. **Start a room**: header button *Collaborate* (people icon) or *Studio ▸ Collaborate…* ▸ *Start a room*.
   * *This device* links the windows and tabs of this browser profile or app (no network at all).
   * *Relay server* uses a relay you run (below), for example `ws://192.168.1.20:8787/` on your network or
     `wss://relay.example.org/` on a server.
3. **Invite**: *People ▸ Copy invite code* and send it privately (chat app, e-mail). The code contains the room key.
4. **Join**: paste the code under *Join with an invite code*. You are asked to confirm what others will see.
5. **Verify**: everyone sees six verification words under *People*. Compare them by phone or in person. Different words
   mean somebody is not in the room you think (for example the invite was swapped): leave.
6. **Roles**: the host decides whether new members join as *Editor* (default; may share documents, files and edit
   activity), *Commenter* (chat, comments, files) or *Viewer* (chat and presence only) and can change roles or remove a
   member at any time. Removing a member (or a member leaving) changes the room key; the others switch automatically,
   and the invite code changes too.
7. **Leave**: *People ▸ Leave*, the *Leave room* command, or *Settings ▸ Security and privacy ▸ Collaboration*.

Shortcuts: *Add Comment* `Ctrl+Alt+M`, *Room Chat* `Ctrl+Alt+C` (both rebindable). Comment markers on the canvas follow
their layer; click one to open its thread.

## Architecture

```
app/src/collab/                 pure, Node-tested (tests/collab/)
  crypto.js        invite codes, HKDF room keys, signed AES-GCM envelope, replay guard, fingerprint words, ECDH wrapping
  wordlist.js      256 words for the verification code (frozen)
  protocol.js      message types, limits, roles/permissions, strict validation, mention parsing, file-name sanitizing
  room.js          membership state machine: host, roles, removal, expiry
  chat.js          chat store: threads, replies, reactions, edits, unread, activity grouping
  comments.js      comment threads: ops, authorship rules, normalization for documents, filters
  versions.js      version index with pruning, on an injected key-value store
  files.js         allow-list, chunking, verified reassembly
  presence.js      send throttle (≤ 20/s), receive token bucket, follow math
  transport.js     Transport interface: relay (WebSocket), local (BroadcastChannel), memory (tests)
  session.js       CollabSession: one room = transport + crypto + membership + chat + files
app/src/ui/collab/              lazy UI (loads on the first collab.* command)
  runtime.js       controller (app.collab): rooms, presence, activity, comments, versions, files, follow, jumps
  window.js        floating window: Chat, People, Comments, Versions
  overlay.js       cursors, halos, comment markers (canvas), carets (Code/Office)
  settings-section.js   Settings ▸ Profile and collaboration
app/src/commands/collab.js      collab.open/chat/comments/addComment/versions/saveVersion/share/leave/profile
app/src/vibe/tools/collab.js    Vibe tools (group "Collaboration")
scripts/relay.mjs               the relay (Node, no dependencies)
```

Nothing collaboration-related runs at start-up except the command stubs. `document.json` gains the additive
`comments` field (see [file-format.md](file-format.md#comments)).

### Transports

All transports carry opaque text frames (envelopes) and implement:

```js
{ kind, host, connect({ room, token }), send(frame) → boolean, close(), onFrame(fn), onStatus(fn) }
```

* **Relay** (`ws://` / `wss://`): a WebSocket to `scripts/relay.mjs`. Reconnects with back-off.
* **Local** (`BroadcastChannel("openfini-collab/<room>")`): windows and tabs of the same origin and profile. Also links
  pop-out windows. Frames are encrypted all the same.
* **Memory**: a fake relay with the same semantics for tests.
* **WebRTC peer-to-peer: not implemented.** Browsers and Tauri webviews cannot listen on sockets, so without a relay the
  only serverless option is WebRTC with manual signaling (copy/paste of offers). It was left out of this release; the
  `Transport` interface is the place to add it.

### Relay protocol

JSON text frames over RFC 6455:

| Direction | Frame | Meaning |
| --- | --- | --- |
| client → relay | `{ "t": "join", "room": <22 chars>, "token": <22 chars> }` | must be the first frame (within 10 s) |
| client → relay | `{ "t": "msg", "d": <envelope text> }` | forward to every other peer of the room |
| relay → client | `{ "t": "joined", "peers": n }` | joined; n other peers |
| relay → client | `{ "t": "msg", "d": … }` | a frame from another peer |
| relay → client | `{ "t": "peers", "n": n }` | peer count changed |
| relay → client | `{ "t": "error", "code": "forbidden" \| "room_full" \| "too_many_rooms" \| "rate" \| … }` | refusal |

The first peer of a room pins its access token; later peers must present the same token (derived from the room secret,
so knowing the room id alone does not let anyone in). Rooms disappear when the last peer leaves.

### Messages (inside the envelope)

Every message is `{ "t": type, "ts": ms, …fields }`, validated by `protocol.js ▸ validateMessage` before sending and after
decrypting. Unknown types or fields, wrong types, oversize strings and arrays are rejected. Weakest role allowed:

| Type | Fields | Role |
| --- | --- | --- |
| `hello` | `profile {nick, color, initials?, avatar?}`, `dh` (ECDH public key), `want` (asks for replies) | viewer |
| `profile`, `bye`, `typing {on}` | | viewer |
| `chat` | `msg {id, text, reply?, thread?, mentions[], links[], file?}` | viewer |
| `chat-edit {id, text}`, `chat-del {id}`, `react {id, emoji, on}` | author only for edit/delete | viewer |
| `presence` | `doc, docName, studio, page, x, y, sel[], tool, view{x,y,w,h}, caret{path,line,ch,from,to}` | viewer |
| `file-offer` | `fid, name, mime, size, chunks, sha (SHA-256), purpose (file/doc/version), doc?, note?` | commenter |
| `file-chunk` | `fid, i, data (base64, 48 KiB raw)` | commenter |
| `comment` | `doc, op {op: add/reply/edit/delete/resolve/reopen/drop, …}` | commenter |
| `activity` | `doc, docName, page, pageName, label, count, nodes[]` | editor |
| `op` | reserved for "Edit together" (not sent by this release) | editor |
| `state` | `host, roles{}, defaultRole, chat[]` (recent chat for newcomers) | host |
| `role {member, role}`, `remove {member}`, `rotate {epoch, wraps{}, removed[]}` | | host |

Limits (`LIMITS` in protocol.js): 256 KiB per frame, 4000 characters per message or comment, 25 MB per file, 32 members,
24 KB avatar data URL, ±10 minutes clock window, ≤ 20 presence updates per second.

## Crypto design

* **Room secret**: 256 random bits. **Room id**: 128 random bits. The **invite code** is
  `<relay>#ofc1.<room id>.<secret>.<host member id>`; the secret is in the URL fragment, which browsers never send to
  servers. Same-device rooms use `local#ofc1.…`.
* **Keys** (HKDF-SHA256, salt `ofc1:<room id>`): the AES-GCM-256 room key per epoch (`info = …/aes/<epoch>`), the relay
  access token (`…/relay-access`, 128 bits) and the 48-bit fingerprint shown as six words (`…/fingerprint/<host id>`).
  PBKDF2 is not used: the secret is random, not a password.
* **Identity**: each member creates fresh ECDSA P-256 (signing) and ECDH P-256 (key agreement) key pairs per session.
  The **member id** is the first 16 bytes of SHA-256 of the signing public key, so an id cannot be claimed without its key.
  The host's id is in the invite; only messages signed by that key can change roles, remove members or rotate keys.
* **Envelope**: `{ v, e: epoch, s: sender id, n: counter, k: signing public key, iv, ct, sig }` with
  `AAD = "ofc1|<room>|<epoch>|<sender>|<counter>"` and `sig = ECDSA(AAD|iv|ct)`. Receivers check id = hash(k), the
  signature, decrypt (AES-GCM with the AAD), then the counter (strictly increasing per sender and epoch), the timestamp
  window, the schema, the sender's rate (token bucket) and permission, in that order. Frames are processed one at a time.
* **Rotation**: when the host removes a member or a member leaves, the host draws a new secret and room id and wraps them
  for every remaining member with ECDH(host, member) → HKDF → AES-GCM (`rotate` message). Everyone reconnects to the new
  room id. The removed member cannot unwrap the new key and the relay no longer forwards the new room to them.
* **Never stored or logged**: invite codes, secrets and keys live in memory only. `core/log.js` redacts anything that looks
  like an invite (`[redacted-invite]`); the relay logs only counts, short room-id prefixes and error codes.

### Threat model

| Who | Can | Cannot |
| --- | --- | --- |
| The relay operator / network observer | see IP addresses, room ids, the number of members, frame sizes and timing; drop, delay or replay frames; refuse service | read or change content (AES-GCM + signatures), inject messages, join without the access token, learn nicknames |
| Someone with only the room id | nothing (no access token) | join the relay room |
| Someone who obtained the invite code | join and read everything until the key is rotated | stay in after the host removes them |
| A malicious member | read everything while in the room; post chat, comments and files within their role; send malformed or oversized messages (rejected); flood (rate-limited); lie about their presence | impersonate another member (signatures), change roles or remove people (host-only, signed), make others' clients render HTML or run code (plain text only, files never auto-open, avatars re-encoded) |
| A removed member | keep what they already received | read anything after the rotation |

Honest limits: there is **no per-message forward secrecy** (a leaked room key exposes the traffic of that key epoch;
rotation starts a new epoch). A **compromised device** of any member exposes the room. Frames of a member who left can be
replayed within the 10-minute window to someone who did not see the originals (counters protect only receivers that saw
them). A member who is offline during a rotation needs a new invite code. If the host leaves, roles freeze and nobody can
remove members: start a new room. Same-device rooms share one profile (nickname) between the windows.

## Running a relay

```sh
npm run relay                                  # ws://127.0.0.1:8787/ (this computer only)
node scripts/relay.mjs --host 0.0.0.0          # your network: ws://<this computer's IP>:8787/ (prints a warning)
node scripts/relay.mjs --host 0.0.0.0 --port 8443 --tls-cert cert.pem --tls-key key.pem   # wss:// directly
node scripts/relay.mjs --help                  # all options: --origin, --any-origin, --max-rooms, --max-peers, --rate, --quiet
```

The relay needs only Node 20+. It binds `127.0.0.1` by default. Browsers are accepted from the desktop app and from
`localhost` pages; a hosted web version needs `--origin https://your.host`. Limits per connection: 150 messages/s
(burst 300), 4 MiB/s, frames up to 257 KiB, 32 connections per IP, 16 members per room, 200 rooms (all configurable).

**On a VPS behind a TLS reverse proxy** (recommended for the internet), run the relay on localhost and let the proxy
terminate TLS:

```nginx
location /openfini-relay/ {
  proxy_pass http://127.0.0.1:8787/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 120s;
}
```

```caddyfile
relay.example.org {
  reverse_proxy 127.0.0.1:8787
}
```

Members then use `wss://relay.example.org/` (Caddy) or `wss://example.org/openfini-relay/` (nginx). The relay sees the
proxy's address, not the members' (configure the proxy's own logs accordingly). The desktop app's Content-Security-Policy
allows `ws:` and `wss:` connections for this (see [ADR 0010](adr/0010-collaboration-e2e-relay.md)); offline mode blocks
every relay except one on this computer.

## How to extend

* **A new message type**: add it to `PERMISSION` and `SHAPES` in `protocol.js` (with limits), handle it in
  `session.js ▸ #dispatch`, add validation and permission tests in `tests/collab/protocol.test.js` and a session test.
  Old clients reject unknown types (they show up as rejected frames), so keep new types optional.
* **A new transport**: implement the interface in `transport.js` and route it in `createTransport`; run
  `tests/collab/session.test.js` against it with a fake.
* **Real co-editing**: the `op` message type is reserved. A safe first step is last-writer-wins per node property for
  Vector/Layout via the document ops (`core/ops.js`), behind an "Edit together (beta)" switch; text needs a sequence CRDT.
* **Strings**: the extractor picks up literal toasts and dialog texts in `ui/collab/` (`scripts/i18n-extract.mjs`).

## Testing

* `node --test tests/collab/*.test.js`: crypto (tampering, replay, forged senders, wrong keys, epochs, wrapping),
  protocol validation and permissions, room/chat/comments/versions/files/presence stores, sessions over the memory hub
  (join, chat with mentions/threads, late joiners, permissions, files, hostile frames, removal and rotation), and the real
  relay on a random port with a WebSocket client built on `node:http` (rooms, token pinning, limits, rate limiting, origin
  check, end-to-end chat and file transfer while asserting the relay never saw plaintext).
* Manual check: two tabs of the dev server (`node scripts/serve.mjs --port 4300`) with a *This device* room, then with
  `npm run relay` and a relay room: join, chat with a mention, reply and thread, a file, a comment resolved in the other
  tab, the cursor visible in the other tab, follow, save and restore a version.
* Not covered by automated tests: real LAN between machines, TLS (`--tls-cert`) and reverse proxies.
