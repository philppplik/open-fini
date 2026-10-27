# 0010: Collaboration through a dumb relay with end-to-end encryption

Status: Accepted

## Context

Users want to work together across studios: chat, comments, presence, follow, files and versions. OpenFini has no
backend and no accounts, and must keep working offline. Browsers and Tauri webviews cannot listen on sockets, so two
instances cannot talk directly without a server or WebRTC signaling. Whatever carries the traffic must not be trusted
with the content: users will run relays on shared machines and VPSs, and nobody should have to trust us or a host.

## Decision

- **Transports behind one interface** (`app/src/collab/transport.js`): a self-hosted **relay** (`scripts/relay.mjs`, a
  dependency-free RFC 6455 server: rooms, fan-out, limits, no persistence, binds 127.0.0.1 by default), **same device**
  over `BroadcastChannel`, and an in-memory fake for tests. WebRTC with manual signaling is deferred.
- **End-to-end encryption with WebCrypto only**: a random room secret travels in the invite code's URL fragment; HKDF
  derives the AES-GCM room key, a relay access token and a six-word fingerprint. Every frame is AES-GCM encrypted with AAD
  binding room, key epoch, sender and counter, and **signed with a per-session ECDSA key** whose hash is the member id.
- **Deviation from the original brief ("keypair-free member token")**: a symmetric token derived from the shared secret
  cannot distinguish members (anyone with the secret can mint anyone's token) and cannot re-key the room without leaking
  the new key to a removed member. We therefore use per-session ECDSA (authenticity, host-only controls) and ECDH (key
  rotation) key pairs. The secret-derived token is kept for the relay only, where it stops strangers who know a room id.
- **Strict schema validation** of every decrypted message, plain-text rendering only, file allow-list with explicit
  consent, avatar re-encoding, per-member rate limits.
- **No live co-editing in this release** (superseded by [ADR 0011](0011-live-editing-sync.md)). Documents travel as encrypted `.ofini` snapshots; chat, comments, presence,
  follow and the activity feed are live. The `op` message type is reserved for a later "Edit together (beta)".
- **CSP**: the desktop `connect-src` adds `ws: wss:` (scheme sources) because relay hosts are entered by the user and a CSP
  cannot be changed at runtime. `https:` was already allowed, so this does not open a new exfiltration channel; offline
  mode (`app.network.assert("collab", url)`) still blocks every non-loopback relay.

## Consequences

Anyone can run a relay with `npm run relay`; the relay learns metadata (IP addresses, room ids, sizes, timing) but no
content. Security depends on the invite code staying private and on members comparing the verification words. There is
no per-message forward secrecy; rotation on leave/remove bounds exposure per epoch. Concurrent edits to one document are
not merged, which keeps the format and undo model untouched but means members coordinate through snapshots and comments.
Comments became part of the document (`document.json ▸ comments`, additive, no format bump).
