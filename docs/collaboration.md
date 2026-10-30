# Collaboration

Work together in OpenFini without an account and without an OpenFini server: a room chat that stays open across studios,
@mentions, replies and threads, files, Google-Docs-style comments, named versions, live cursors and "follow". Everything
in a room is end-to-end encrypted. This guide is for users (first section) and for engineers (the rest).

Decision record: [ADR 0010](adr/0010-collaboration-e2e-relay.md). Security summary: [security.md ▸ Collaboration](security.md#collaboration-rooms).

## What is live, and what is not

| Live in a room | Not live (by design, in this release) |
| --- | --- |
| Chat: messages, @mentions with autocomplete and notification, replies, threads, reactions, edit/delete, typing indicator, links that jump to a layer, page or code line | — |
| **Edit together (beta)** for documents shared *live*: Vector, Layout and the layer structure of Pixel documents (properties, add, delete, move, reorder, pages, masters, text stories, swatches, styles), Code studio projects and one-file text documents (character-level merge in every text file). See [Live editing](#live-editing-edit-together-beta). | Pixel **bitmaps** and placed image data are not live: they travel with the snapshot when a document is opened and on *Resync*. Office documents are shared as snapshots only. Creating text files is live; deleting or renaming files is not. |
| Files (encrypted, chunked, up to 25 MB, allow-listed types, never opened automatically) | Documents shared as a *copy* are snapshots: members choose *Open*, *Open as copy* or *Update my copy* (a version of the old copy is saved first). |
| Activity feed: "Hana · Move · 3 layers on Page 2 · Jump · Show", generated from each member's own edits (can be turned off); it is the "who changed what" feed of live documents too | Undo across people: Undo only reverts your own steps. |
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

Shortcuts: *Add Comment Here…* `Ctrl+Alt+M`, *Room Chat* `Ctrl+Alt+C` (both rebindable).

## Comments on the canvas, in code and in text

Right-click where the comment belongs and choose **Add comment here…** (also `Ctrl+Alt+M` at the pointer or selection,
or the command palette: *Add Comment Here…*). It works in the Vector, Pixel and Layout canvas, the layers panel, the
Code editor, the Office editor and website elements, with or without a room (comments are saved in the document and sync
when a room is active). A small composer opens at the click: type, `@` suggests room members, `Ctrl+Enter` posts, `Esc`
cancels.

* **Pins** are numbered (creation order) and use the author's color. They follow zoom, pan, page position and the layer
  they were placed on. Click, `Enter` or hover opens the thread popover: replies, resolve/reopen, edit and delete of your
  own messages, "Open in Comments". Drag a pin to re-anchor it (thread author or host; a new `reanchor` comment op). In
  the Code and Office editors the commented range is highlighted and a pin sits at its start.
* **Comment mode** (command *Comment Mode*, status bar button): click anywhere on the canvas or editor to place a comment;
  `C` or `Esc` leaves it. The status bar button next to the zoom shows the number of open comments and hides/shows all
  pins and highlights (command *Show or Hide All Comments*, preference `collabPins`).
* **Keyboard**: pins are buttons (Tab); `]` and `[` move to the next/previous comment while a pin or popover has focus;
  focus returns to the pin when a popover closes; popovers are non-modal dialogs with an accessible name.
* A comment needs the *Commenter* or *Editor* role when you are in a room; Viewers see pins but cannot add.

### Anchoring model per studio

The anchor is stored in the thread (`doc.comments`, `.ofini` document.json) and sent unchanged in `comment` ops. Fields
were added to the existing `ANCHOR` (all optional, old clients and files stay valid): `pin`, `off`, `elem`, `col`,
`endCol`. Builders and the resolution rules live in `app/src/collab/anchors.js` (pure, `tests/collab/comment-ux.test.js`).

| Studio | `kind` | Stored | Resolution |
| --- | --- | --- | --- |
| Vector, Pixel, Layout canvas, layer under the pointer | `node` | `node`, `page`, `pin` (clicked page point), `off` (point relative to the layer's box, 0..1), `quote` (layer name) | `off` x current layer bounds: the pin follows the layer when it moves or resizes; if the layer is deleted the pin stays at `pin` on its page |
| Canvas, empty spot | `region` | `page`, `pin`, `rect` (zero-size) | fixed page coordinates |
| Layers panel row | `node` | like the canvas, point = top right of the layer | as above |
| Code editor | `line` | `path`, `line`, `col`, optional `endLine`, `endCol` (a range), `quote` | line/column to document offsets at draw time; a caret comment underlines the whole line. Lines are not tracked through edits: if the text moves above, the comment stays on its line number and the quote shows what it was about |
| Office editor | `text` | `path` (paragraph path as JSON), `from`, `to`, `quote` | same as before: offsets in the block at `path` |
| Website element | `element` | `elem` (the website designer's element id), `quote` | listed in Comments; *Show where* selects the element. Pins are not drawn over the preview (the sandboxed frame is not touched) |

Limits: there is no operational transform for anchors, so heavy concurrent editing can move a code or Office comment off
its text (the quote is kept for display); drag a pin or re-comment to fix it. Pins over the website preview are not drawn.

### Comments without a room (all studios) and for the AI

Comments do not need the collaboration window or a room. The small **comments host**
(`app/src/ui/collab/comments-host.js`) owns the threads, the inline UI and the pins; it never imports the room runtime
(`runtime.js`: sessions, transport, crypto, versions). When you later start or join a room, the runtime attaches itself
as `host.room`: from then on local comment changes are also broadcast and remote ones arrive through
`host.applyRemote`. Everything else (Vibe tools, the dock panel, the status bar) uses the host only.

* **Comments panel** in the right dock of Vector, Pixel, Layout and Code (command `comments.panel`, Edit menu): list
  with Open / Resolved / All, a jump to the commented place, resolve/reopen and **Resolve with AI**. Studios without a
  dock (Office) open the Collaboration window's Comments tab instead.
* Status bar count, **Comment Mode** (`Shift+C`: `C` alone is the Crop tool; click where the comment belongs, `Esc` or
  `C` leaves), Edit ▸ Add Comment Here…, and the context menu entry (registered at start-up, loads only the comment UI).
* **Persistence**: threads are saved in the `.ofini` (`comments`, see [file-format.md](file-format.md)): anchors, replies,
  resolved state, author nickname and color survive save and reload, and everybody who opens the file sees them. An
  author the reader does not know is shown by the saved nickname, or as "Unknown author" when the file has none.
  Covered by `tests/collab/comment-context.test.js` (round trip) and the app-integration tests.
* **For the AI** (`collab/comment-context.js`, pure): `resolveTarget(anchor, env)` turns an anchor into what it points at
  now: layer id, name, type and bounds; code file, lines, excerpt (and whether the line moved: the saved quote is searched);
  website element (element path `sel` + HTML excerpt); Office paragraph with the quoted text. The Vibe tools
  `list_comments` and `get_comment_context` (with a cropped screenshot for canvas anchors) return it; see
  [vibe-studio.md](vibe-studio.md).
* Limits: Office anchors are paragraph offsets (they drift when text before them is edited; the quote is reported as stale);
  website elements are located by their element path and are lost when the structure changes; pins for website elements are
  not drawn on the preview (they appear in the panel); table cells are anchored to the table layer and the click point.

## The Collaboration window

The window decides its layout from **its own width** (container based, not the app window):

| Width | Layout |
| --- | --- |
| < 520 px | top tabs (Chat, People, Comments, Versions) |
| >= 520 px | left side rail with icon + label: the tabs plus *Share* and *Settings* |
| >= 900 px | rail plus a list column (members next to Chat, threads next to Comments) and the content on the right |

Header buttons: *Compact density* (icon-only rail, tighter rows), *Pop out*, *Maximize/Restore* (also double-click the
header), *Close*. Drag the header (it snaps to the edges of the app window), or focus it and use the arrow keys (Shift =
bigger steps). Resize with the corner. Position, size, maximized and compact are remembered per browser profile
(`openfini.collab.window`). The rail is one roving tab stop (arrows, Home/End); transitions respect reduced motion; colors
come from the `--of-*` tokens, so themes and glass styles apply. Pure decisions (`layoutMode`, `clampRect`,
`snapRect`, stored state) are in `app/src/ui/collab/layout-mode.js` (tested).

A web page cannot draw outside its own window, so the in-app window can never leave the main window. The real answer is
the pop-out below.

### Pop-out window

*Pop out* (or the command *Pop Out Collaboration Window*) opens `?popout=collab` in an OS window (a popup in the
browser, a `WebviewWindow` labeled `popout-<n>` in the desktop app). The main window **keeps the one room connection**:
the pop-out is a UI-only remote view of the room (chat, people, comments of the active document) that talks to the main
window over `BroadcastChannel("openfini-collab-ui")`. No secret, key or invite code crosses that channel, and no second
identity joins the room. Unread badges, mention toasts and the title counter stay in the main window. *Dock back* or
closing the pop-out shows the floating window again; closing the main window closes the pop-out. Why not a second
connection: [ADR 0013](adr/0013-collab-popout.md). Code: `app/src/collab/remote-ui.js` (protocol, tested),
`ui/collab/remote-host.js`, `ui/collab/remote-view.js`. Limits: the pop-out has no canvas, so a comment added there is
anchored to the main window's current selection; the Tauri `WebviewWindow` path cannot be exercised in CI and needs a
manual check.

## Architecture

```
app/src/collab/                 pure, Node-tested (tests/collab/)
  crypto.js        invite codes, HKDF room keys, signed AES-GCM envelope, replay guard, fingerprint words, ECDH wrapping
  wordlist.js      256 words for the verification code (frozen)
  anchors.js       comment anchor builders/resolution per studio, pin numbers, popover placement (tests/collab/comment-ux.test.js)
  remote-ui.js     protocol of the UI-only pop-out: action whitelist, bounded snapshots (same test file)
  (ui/collab/) comment-ui.js composer, thread popover, pins, comment mode; layout-mode.js responsive decisions;
               remote-host.js / remote-view.js the two sides of the pop-out
  protocol.js      message types, limits, roles/permissions, strict validation, mention parsing, file-name sanitizing
  room.js          membership state machine: host, roles, removal, expiry
  chat.js          chat store: threads, replies, reactions, edits, unread, activity grouping
  comments.js      comment threads: ops, authorship rules, normalization for documents, filters
  versions.js      version index with pruning, on an injected key-value store
  files.js         allow-list, chunking, verified reassembly
  presence.js      send throttle (≤ 20/s), receive token bucket, follow math
  transport.js     Transport interface: relay (WebSocket), local (BroadcastChannel), memory (tests)
  session.js       CollabSession: one room = transport + crypto + membership + chat + files
  tree-crdt.js     Edit together: replicated tree of LWW registers, flatten/diff of documents, op validation
  tree-apply.js    applies a tree CRDT view to a live document without touching undo history
  text-crdt.js     Edit together: RGA sequence CRDT for text files, textDiff, op validation
  fractional.js    fractional ordering keys
  qr.js            tiny QR encoder (relay terminal and join-link QR codes)
app/src/ui/collab/              lazy UI (loads on the first collab.* command)
  runtime.js       controller (app.collab): rooms, presence, activity, comments, versions, files, follow, jumps
  window.js        floating window: Chat, People, Comments, Versions
  overlay.js       cursors, halos, comment markers (canvas), carets (Code/Office)
  settings-section.js   Settings ▸ Profile and collaboration
  live.js          shared documents: share/open/stop/pause/resync, tree and text bindings, cards, tab badges, bar
  network.js       relay diagnosis, /info, LAN invite addresses, join links, QR codes, "How to start a relay"
scripts/relay-tls.mjs           self-signed certificate (dependency-free X.509 writer) for --lan
app/src/commands/collab.js      collab.open/chat/comments/addComment/versions/saveVersion/share/leave/profile,
                                shareDocument/shareLive/shareCopy/stopSharing/resync/relayHelp, the share context menu, #join= links
app/src/vibe/tools/collab.js    Vibe tools (group "Collaboration")
scripts/relay.mjs               the relay (Node, no dependencies): rooms, --lan, --serve-app, GET /info
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
| `op` | `doc, kind (tree/text), path? (text file), ops[]` (≤ 512 ops; every op validated by `validateTreeOp` / `validateTextOp`) | editor |
| `share` | `doc, docName, kind (tree/text/snapshot), a (start/stop/pause/resume), studio?`; stop only counts from the sharer, pause/resume from the sharer or the host | editor |
| `live` | `doc, a (req/have/bye), to?` (request a snapshot from one member; announce or leave a live document) | viewer |
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

## Live editing (Edit together, beta)

### Using it

* **Share** the open document with one gesture: right-click the document tab, the empty canvas, a file or tab in the
  Code explorer, or the Office editor ▸ *Share with collaboration room…* (asks *live* or *copy*), *Share as linked live
  document* or *Share a copy (snapshot)*; also *File ▸ Share with Collaboration Room…* and the command palette
  (`collab.shareDocument`, `collab.shareLive`, `collab.shareCopy`, `collab.stopSharing`, `collab.resync`). Without a room,
  the Collaboration window opens on *Start a room*; the document is shared as soon as you are in.
* **Receivers** get a card "Mia shared “Poster” — *Open live* / *Open copy* / *Ignore*" (and a line in the chat). Nothing
  opens without a click and a confirmation. Members who join later are told about live documents automatically.
* While a document is live, its tab shows a people badge with the number of people, and a bar "Editing together ·
  N people · beta" sits above the status bar with *Pause*/*Resume* (sharer and host), *Resync* and *Stop sharing*/*Leave*.
* **Roles**: editors edit; commenters and viewers watch. A non-editor's local change to a live document is rolled back to
  the shared state (with a notice) and every receiver drops their ops anyway (the session's permission check).
* **Pause**: the sharer or the host can pause editing; local edits are rolled back while paused, ops sent more than 3 s after
  the pause are dropped (the bar then offers *Resync*).
* **Conflicts**: two people changing the *same field* of the *same layer* (e.g. both set the fill) cannot both win. The
  later write wins on every device; if it replaced a value you set in the last 6 seconds you get a notice, and a version
  "Before merging an edit from …" of your document (as it was just before) is saved automatically (at most one per
  document every 2 minutes) under *Versions*. Text never conflicts: concurrent typing merges character by character.
* **Undo** only reverts your own steps; other people's edits are never in your undo history.

### Design

Decision record: [ADR 0011](adr/0011-live-editing-sync.md). Two CRDTs, both pure modules in `app/src/collab/`:

**Design documents (`tree-crdt.js`, `tree-apply.js`, `fractional.js`).** Every node, page, page root, mask, story,
asset and the document's own settings (`#doc`) is an *entry* with last-writer-wins registers: `pos` (parent + fractional
ordering key), `live` (exists/deleted) and one register per field (JSON text). Each register carries a clock
`[lamport, site]`, site = the authenticated member id of the writer; clocks compare by lamport, then site. Ops:

| Op | Wire | Effect |
| --- | --- | --- |
| add | `{o:"add", id, p, k, v:{field:value}, c}` | pos, live = true and every field (create, or restore after a delete) |
| set | `{o:"set", id, f, v?, c}` | one field; no `v` deletes the field |
| del | `{o:"del", id, c}` | live = false (tombstone kept for the session) |
| mv | `{o:"mv", id, p, k, q?, qk?, c}` | move or reorder; `q`/`qk` = previous place (breaks move cycles) |

Conflict policy: per-field last writer wins; **delete wins** over concurrent edits (edits never touch `live`; an explicit
restore after seeing the delete brings the entry back); an entry is visible only if its whole parent chain is; siblings
sort by `(key, id)`, so concurrent inserts at one place keep a deterministic order; concurrent moves that would form a
cycle undo the newest of those moves (back to `q`). Applying ops is commutative and idempotent, so **no causal delivery
is needed**: an op on an entry that has not arrived yet just fills its registers and becomes visible when its parent does.
Virtual roots: `#pages`, `#masters`, `#stories`, `#assets`; slot keys `#root` (page root group), `#mask`, `~` (unordered).

Binding (`ui/collab/live.js ▸ TreeBinding`): after each local history step (the document's `change` event, batched for
60 ms) the document is flattened (`flattenDoc`, node JSON cached by render revision `_rev`) and diffed against the CRDT
view (`diffOps`: adds, top-most deletes, field sets, and new ordering keys only for children outside the longest run that
is already in key order). Remote ops are applied to the CRDT, then `applyView` patches the live document in place
(objects keep their identity, removed ones go to a graveyard for later restores) **without touching the undo history**,
and a `change` event with `remote: true` redraws. Echo suppression is structural: after `applyView`, `diffOps` is empty.
Undo of a local step is a normal local edit that is diffed and sent again.

**Text (`text-crdt.js`).** A Replicated Growable Array: every character has an id `[lamport, site]` and is inserted after
its origin character, skipping following characters with greater ids; deletes set a tombstone. Ops:
`{o:"ins", a:[l,site]|null, l, t}` (a run of characters with consecutive ids) and `{o:"del", r:[[l,site,count]…]}`.
Inserts whose origin has not arrived wait in a pending list; deletes of unknown ids are remembered. Binding
(`TextBinding`): project text changes (`web` `text` events) are turned into one replace (`textDiff`) per file and batch;
remote changes go to CodeMirror through `CodeEditors.applyRemote` with `addToHistory: false` (selections and cursors are
mapped through the change) or straight into the project when the file is not open.

**Initial sync and catch-up.** *Open live* sends `live {a:"req", to}` to the sharer (or any member who has it). That
member flushes its pending ops and sends the `.ofini` snapshot as an encrypted file transfer (`purpose: "live"`, `to`
the requester, ignored by everyone else) with `collab-live.json` inside: the CRDT state with every clock. Ops that arrive
meanwhile are buffered and applied afterwards (duplicates are harmless). *Resync* repeats this for an open document and
also brings pixel bitmaps and image data.

**Limits.** 512 ops and 180 KiB per message (larger steps are split), field values ≤ 96 KiB, depth ≤ 32, no prototype
keys, lamport ≤ 2^48, text inserts ≤ 64 Ki characters, live text files ≤ 2 Mi characters, 20 000 pending text ops. Field
names starting with `_`, `id`, `mask`, `root`, `constructor`, `prototype` are refused; document-level fields are an
allow-list (`DOC_FIELDS`). Tombstones are kept for the session (memory grows with deleted content). A malicious *editor*
can still vandalize the document within these rules (as with any shared document); versions keep the history.

## Rooms across your network

### One click in the desktop app (no Node.js, no terminal)

*Collaborate ▸ Start a room ▸ Where: Your network: start a relay on this computer ▸ Create room*. The desktop app starts
the relay built into it (`src-tauri/src/relay.rs`, [ADR 0018](adr/0018-built-in-network-services.md)) on port 8787 (any
free port when 8787 is taken), on every interface, creates the room on `ws://127.0.0.1:<port>/` and puts this
computer's network address (`ws://192.168.x.x:<port>/`) into the invite code. *People* then shows the address, *Copy
invite code*, *Show QR code* (of the invite code, to move it to another device) and **Stop relay** (leaves the room and
disconnects everyone). The relay also stops when OpenFini closes. Windows asks once whether OpenFini may accept
connections: allow it for **private** networks only.

It speaks exactly the protocol below (same limits, Origin allow-list, token pinning, `GET /info`) but is deliberately
simpler than the Node relay: **plain `ws://` only and it does not serve the app.** Members join with the **desktop app**
on the same network. Browsers on other devices (phones, tablets, the PWA) need a secure page and `wss://`, so for them
run the Node relay with `--lan` below. The network address is the interface of the default route (one address; on
machines with several networks pick another one by typing it into the relay address).

**In the browser / PWA** a page cannot listen on a port, so this option is not offered; the Collaboration window says
so and asks for the address of a hosted relay (`wss://…`) or of one started elsewhere.

### The Node relay (`--lan`): browsers on other devices

What blocked it before: the relay listened on `127.0.0.1`, invite codes carried the address as typed (`ws://localhost`
means "this computer" on every device), an https page (the PWA) may not open `ws://` to another machine (mixed content),
and other browsers on plain `http://` have **no WebCrypto** (only secure contexts do), so they cannot encrypt at all.

```sh
npm run relay -- --lan
```

binds every interface, **serves the app itself** (`dist/`, or `app/` in a source checkout) and answers **http/ws and
https/wss on the same port** (it looks at the first byte of each connection). For https it creates a self-signed
certificate for all LAN addresses (kept in `~/.openfini-relay/`, reused while it still covers them). It prints every LAN
address, the certificate fingerprint and a QR code of `https://<lan-ip>:8787/`.

1. On the relay computer, open OpenFini (desktop app, or `http://localhost:8787/`), *Collaborate ▸ Start a room ▸ Relay
   server* with `ws://localhost:8787/`. Use *Test connection* if anything is unclear.
2. *People ▸ Address for other devices*: pick `wss://192.168.x.x:8787/` (filled from the relay's `GET /info`). The invite
   code and the join link now carry that address; this computer stays connected through localhost.
3. On the other device, open `https://192.168.x.x:8787/` (scan the QR code), accept the certificate warning once
   (compare the fingerprint the relay printed), then paste the invite code, or open the **join link**
   `https://192.168.x.x:8787/#join=<invite>` (or its QR code under *Show QR code*): the join form is filled in, you confirm.
   The code stays in the URL fragment, which browsers never send; the app removes it from the address bar.

Clients try the other scheme on the same port when needed (`transport.js ▸ relayCandidates`): an https page tries
`wss://` before `ws://`, the desktop app falls back from `wss://` (untrusted certificate) to `ws://`. The relay accepts
pages it served itself (Origin equals Host and the host is an IP literal or `localhost`, which rules out DNS rebinding).
`GET /info` answers CORS only for allowed origins and Chrome's Private Network Access preflight
(`Access-Control-Allow-Private-Network`). `--no-tls` serves http/ws only (then only the desktop app and the relay computer
can encrypt). Browsers cannot search the network for relays; share the printed address, a join link or the QR code.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "This page is not a secure context" | the app was opened over `http://<ip>` | open `https://<ip>:8787/` (relay with `--lan`), use `localhost`, or the desktop app |
| Others cannot connect, invite shows `localhost` | the invite carries this computer's loopback address | *People ▸ Address for other devices* → the LAN address |
| "The browser refused to open the connection" on the PWA | https page → `ws://` to a LAN IP (mixed content) | relay with `--lan` (wss on the same port), or open the app the relay serves |
| Certificate warning on every device | self-signed certificate | accept once per device after comparing the printed fingerprint; or use a reverse proxy with a real certificate |
| "The relay refused or closed the connection" while `/info` works | this page's origin is not allowed | `--origin https://your.origin`, or open the app the relay serves |
| Connection times out | firewall, wrong IP, guest Wi-Fi isolation | allow the port for *private* networks (Windows asks on first start); same network; check the IP the relay printed |
| `/info` cannot be read from the desktop app | the app's CSP allows `http:` only for `localhost` | expected; the WebSocket test still runs (`ws:`/`wss:` are allowed to any host) |
| A live document drifted (e.g. after a pause) | ops dropped while paused or a long disconnect | *Resync* in the bar |

## Running a relay

The desktop app has the relay built in (see *One click in the desktop app* above); the commands below are for servers,
for browsers on other devices, and for people without the desktop app.

`npm run relay` only works **inside the OpenFini project folder**: anywhere else npm stops with
`ENOENT: no such file or directory, open '…/package.json'`. Without the sources, download `scripts/relay.mjs` (one file,
no dependencies) into any folder and run `node relay.mjs --lan` there. Put `scripts/relay-tls.mjs` next to it for
https/wss; without it the standalone relay says so and serves `ws://` only. Without the app next to it, `--lan` only
relays (it prints a note) and the QR code is skipped when `app/src/collab/qr.js` is not found.

```sh
node relay.mjs --lan                           # standalone: this one file in any folder
npm run relay                                  # ws://127.0.0.1:8787/ (this computer only)
npm run relay -- --lan                         # your network: see "Rooms across your network"
node scripts/relay.mjs --host 0.0.0.0          # your network without serving the app (prints a warning)
node scripts/relay.mjs --host 0.0.0.0 --port 8443 --tls-cert cert.pem --tls-key key.pem   # wss:// directly
node scripts/relay.mjs --help                  # all options: --lan, --serve-app [dir], --no-tls, --tls-dir, --origin, --any-origin, --max-rooms, --max-peers, --rate, --quiet
```

Whenever the relay listens on anything other than loopback it prints a warning; every room still needs its access token
(derived from the room secret), and content stays end-to-end encrypted. To trust the self-signed certificate permanently
instead of accepting a warning, import `~/.openfini-relay/relay-cert.pem` into the device's trust store (desktop: the
system certificate manager; Android: *Settings ▸ Security ▸ Install certificate*; iOS: install the profile, then enable
full trust under *General ▸ About ▸ Certificate Trust Settings*).

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
* **Live editing of a new document kind**: write a binding in `ui/collab/live.js` with `stateJSON()`, `flush()`,
  `receive(sender, msg)`, `replaceState(doc, state)`, `detach()`, reuse the tree or text CRDT if the model fits, extend
  `docKind`, and add a convergence test (seeded random histories, shuffled delivery) before wiring the UI. Office documents
  are the obvious next candidate (paragraph runs as text CRDTs plus a tree for blocks).
* **Undo across people / garbage collection**: both need causal metadata (version vectors) the protocol does not carry yet.
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
* `tests/collab/tree-crdt.test.js`, `text-crdt.test.js`: property-based convergence (3000 + 1500 seeded random histories
  with 2–4 replicas, shuffled and duplicated delivery, identical documents required), conflict policy, hostile ops, and
  500 random concurrent histories through real `core/doc.js` documents (flatten → diff → ops → applyView, no echo,
  remote edits never in the undo history).
* `tests/collab/relay-lan.test.js`: `/info`, CORS and Private Network Access, `--serve-app` with path-traversal attempts,
  the same-origin rule (and DNS-rebinding refusal), one port serving http and TLS, and two sessions editing one document
  live through the real relay while the relay only sees ciphertext. `tests/collab/qr.test.js`: QR encoder against
  reference values and an independent decoder.
* Manual check (done for this release): two tabs with a *This device* room editing a Vector document and a Code file at
  the same time; the relay with `--serve-app` on localhost opened from `http://localhost:8787` and `http://127.0.0.1:8787`
  as two "devices", joining through a join link.
* Not covered: real LAN between machines, phones, TLS in a browser (certificate warning flow), reverse proxies, the
  Tauri desktop app's join path (its CSP allows `ws:`/`wss:` to any host; not run here), scanning the QR code with a
  phone (the encoder is verified structurally).
