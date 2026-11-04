# 0018: Built-in relay, FTP/FTPS and SMTP in the desktop shell

Status: Accepted

## Context

Collaboration across a network and publishing to classic web hosts needed Node.js programs (`scripts/relay.mjs`,
`scripts/publish-helper.mjs`) started from a terminal. People without a development setup failed at the first step:
`npm run relay` outside the project folder stops with `ENOENT … package.json`, and a browser cannot listen on a port or
open raw TCP connections anyway. The desktop shell (ADR 0001) is a small Rust program that can do both.

## Decision

- **Relay in Rust** (`src-tauri/src/relay.rs`), started from the Collaboration window (*Start a room ▸ Your network*).
  Same wire protocol, limits, Origin allow-list, token pinning and `GET /info` as the Node relay, so clients and the
  People tab need no special case. std threads only (accept loop, one reader and one bounded writer per connection);
  plain `ws://`, no app serving, no TLS. Members use the desktop app; browsers on other devices keep using the Node relay
  with `--lan` (https page + wss), which stays the tool for servers.
- **FTP/FTPS and SMTP clients in Rust** (`ftp.rs`, `smtp.rs`, shared `netio.rs`, pure helpers in `wire.rs`) as Tauri
  commands, used by a new *FTP / FTPS server* publish target and *Export ▸ Send by email…*. Blocking std I/O on Tauri's
  blocking pool, progress as events, cancel between files.
- **TLS via the operating system** (`native-tls`): the system trust store (corporate CAs work), no C build on Windows and
  macOS. Trust on first use for self-signed certificates: verification failure → a probe connection that sends nothing
  reads the SHA-256 fingerprint → the person confirms → the fingerprint is pinned per target.
- **Command permissions:** `build.rs` declares the app's commands (`AppManifest`), so each one needs an `allow-<command>`
  entry in `capabilities/default.json` (main window and pop-outs). A command missing there is refused at run time.
- **Secrets** stay in the existing key store (`ui/code/secrets.js`, vault-sealed when the vault is on) and are passed to
  one command call; Rust never logs and never puts them in errors.
- **No SFTP yet.** `russh` brings an async runtime-bound SSH stack with many crypto crates for one target; the helper
  keeps SFTP/rsync with the system `ssh` binaries.
- **Dependencies:** `native-tls` (new), `serde` and `serde_json` (already in the tree through Tauri, now direct). SHA-1
  (WebSocket handshake), SHA-256 (fingerprints) and base64 are small in-crate implementations with test vectors.
- The web build shows clear "desktop app only" messages; the helpers stay for browsers and for SFTP, and when a helper
  does not answer the app explains how to install Node.js and start it instead of showing a raw network error.

## Consequences

- One click for a LAN room and for FTPS/mail; no Node.js for most people.
- More native code to maintain (about 1,500 lines with tests). CI compiles it and runs its unit tests on Linux; the TLS
  paths ran against local fake servers on Windows during development, not against real servers or on macOS/Linux.
- Linux builds link OpenSSL (`libssl`), present on every desktop distribution; CI already installs `libssl-dev`.
- `native-tls` cannot reuse the TLS session on the FTPS data channel explicitly; servers that require it
  (`require_ssl_reuse`) may refuse uploads. Switching to `rustls` would solve that at the cost of a C/asm crypto build
  (`ring`/`aws-lc`) and its own trust store.
- The embedded relay serves plain `ws://`; phones and tablets in a browser still need the Node relay.
