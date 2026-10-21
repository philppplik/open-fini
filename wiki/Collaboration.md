# Collaboration

OpenFini rooms let people work together without an account and without an OpenFini server: a room chat that stays open across studios, @mentions and threads, files, Google-Docs-style comments, named versions, live cursors and follow. Everything in a room is end-to-end encrypted. Live co-editing of the same document is not available yet; members exchange snapshots instead. Available since 0.7.

## What is live and what is not

| Live in a room | Not live (by design in this release) |
| --- | --- |
| Chat: messages, @mentions, replies, threads, reactions, edit and delete, typing indicator, links that jump to a layer, page or code line | Simultaneous editing of the **same** document: there is no merge. Members share **snapshots** ("Share this document", "Send to room") and choose *Open*, *Open as copy* or *Update my copy* (a version of the old copy is saved first) |
| Files: encrypted, chunked, up to 25 MB, allow-listed types, never opened automatically | Edits of another member do not appear in your copy until they share a new snapshot |
| Activity feed generated from each member's own edits (can be turned off) | |
| Comments on layers, pages, text and code lines, synced between members who have the same document open | Comments written before you joined are only in documents you share |
| Presence: pointer with name and tool, selection halos, carets in the Code and Office editors, studio, document and page | Presence inside the Vibe studio (it shows the studio only) |
| Follow a member's studio, document, page and viewport (`Esc` or moving the canvas stops) | Following inside the Office editor |

Comments and versions also work **without** a room: comments are saved in the document, versions are snapshots on this device.

## Using it

1. **Profile:** *Settings ▸ Profile and collaboration* sets nickname, presence color and an optional picture (at most 128 px). Stored only on this device and never part of settings profiles.
2. **Start a room:** header button *Collaborate* or *Studio ▸ Collaborate…* then *Start a room*. *This device* links windows and tabs of this browser profile or app (no network). *Relay server* uses a relay you run ([[Collaboration Relay Setup]]), for example `ws://192.168.1.20:8787/` or `wss://relay.example.org/`.
3. **Invite:** *People ▸ Copy invite code* and send it privately. The code contains the room key.
4. **Join:** paste the code under *Join with an invite code* and confirm what others will see.
5. **Verify:** everyone sees six verification words under *People*. Compare them by phone or in person. Different words mean the invite was swapped or somebody is in another room: leave.
6. **Roles:** the host chooses whether new members join as *Editor* (share documents, files and edit activity), *Commenter* (chat, comments, files) or *Viewer* (chat and presence only), and can change roles or remove members. Removing a member (or a member leaving) rotates the room key; the others switch automatically and the invite code changes.
7. **Leave:** *People ▸ Leave*, the *Leave room* command, or *Settings ▸ Security and privacy ▸ Collaboration*.

Shortcuts: *Add Comment* `Ctrl+Alt+M`, *Room Chat* `Ctrl+Alt+C` (both rebindable).

## Comments and versions

- **Comments:** threads, replies, resolve and reopen, @mentions, markers on the canvas that follow their layer, and a Comments tab with filters. Saved in `document.json` (`comments`, additive).
- **Named versions:** *Save Version…* keeps complete snapshots on this device with thumbnail, author and note (up to 30 per document). Restore in place as one undoable step (a snapshot of the current state is saved first), open as a copy, or send a version to the room.

## Security summary

| Who | Can | Cannot |
| --- | --- | --- |
| Relay operator or network observer | See IP addresses, room ids, member count, frame sizes and timing; drop or delay frames | Read or change content, inject messages, learn nicknames |
| Someone with the invite code | Join and read everything until the key is rotated | Stay in after the host removes them |
| A malicious member | Read everything while in the room; post within their role; send junk (rejected and rate-limited) | Impersonate others, change roles, make your app render HTML or run code |
| A removed member | Keep what they already received | Read anything after the rotation |

Design: AES-GCM-256 room key derived with HKDF from a 256-bit secret that travels only in the invite's URL fragment; per-session ECDSA signatures; replay, tamper and forgery rejection. Honest limits: no per-message forward secrecy, a compromised device of any member exposes the room, a member offline during a rotation needs a new invite, and if the host leaves, roles freeze (start a new room). Details: [[Security and Privacy]], [collaboration.md](https://github.com/philppplik/open-fini/blob/main/docs/collaboration.md), [[Decision Records]].

Offline mode blocks every relay except one on this computer. WebRTC peer-to-peer is not implemented.

## Vibe

Read-only: `get_collab_status`, `read_chat`, `list_comments`, `list_versions`. With approval: `post_chat_message`, `add_comment`, `reply_comment`, `resolve_comment`, `save_version`. Invite codes and keys are never exposed to the assistant.

## See also

- [[Collaboration Relay Setup]]
- [[Security and Privacy]]
- [[Multi-Window]]
- [[Decision Records]]
