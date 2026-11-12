# 0030: Collaboration always lives in its own OS window

Status: Accepted (supersedes [0013](0013-collab-popout.md))

## Context

Until now the Collaboration UI was a floating window inside the app window, with an optional pop-out
([ADR 0013](0013-collab-popout.md)) that showed chat, people and comments only. Starting or joining a room, invitations,
roles and versions needed the in-app window, and a blocked pop-up fell back to it silently. The owner's requirement:
the Collaboration window starts outside, as its own native window, and is never drawn inside the app window.

The constraints of ADR 0013 still hold: every OpenFini window is its own page with its own memory; the room connection
and the member identity (an ECDSA signing key) live in one window; a second connection would mean a second member or
key material crossing windows.

## Options

a. **Second connection in the Collaboration window.** Rejected for the reasons of ADR 0013 (second identity or exported
   private keys, secrets written for a handoff).
b. **Render the main window's DOM into the other window** (`popup.document.body.append(...)`). Works only for
   `window.open` popups of the same origin. Tauri `WebviewWindow`s have no opener relationship, custom elements and
   constructed style sheets do not survive adoption into another document, and dialogs would open in the wrong window.
c. **One UI, fed by a model built from snapshots** (chosen). The main window stays the only owner of the connection,
   identity, keys and documents. The Collaboration window is a remote view that renders the *whole* control surface
   (start, join, invite, people, roles, chat, files, comments, versions) from bounded snapshots and sends a whitelist
   of actions back.

## Decision

Option c. Pieces:

- `collab/remote-ui.js` (pure, tested): protocol version 2 on `BroadcastChannel("openfini-collab-ui")`. Messages
  `hello`, `bye`, `act`/`res` (with optional plain `data`), `snap`, `show` (main asks the window to show a tab, a
  comment thread, the join form with a code from a join link, or the Save version form) and `close`. A whitelist of
  actions with cleaned arguments, a bounded snapshot builder and validator (300 chat messages, 500 threads, 64 members,
  4000 characters per text, avatars only as small image data URLs), `changeKind` (nothing / chat stream only /
  everything) and the window placement rules.
- `collab/remote-model.js` (pure, tested): turns snapshots into the shapes the UI reads (`c.session`, `c.threads()`,
  `app.doc`, ...) and every changing call into an action. `ui/collab/window.js` is therefore the same UI code as
  before, minus the floating-window chrome, and it only ever runs in the Collaboration window.
- `ui/collab/remote-host.js` (main window): `openWindow` opens the window or focuses the open one, answers `hello` with
  a snapshot, pushes a new one after every change (coalesced, skipped when nothing changed), validates every action
  again and re-checks the member's role, and performs it (including starting the built-in relay and the dialogs that
  belong to the main window, which it brings to the front).
- `ui/collab/remote-view.js` (Collaboration window): boots from `?popout=collab` before any studio, session restore or
  onboarding; mounts the UI with the first snapshot; remembers its own position, size and density.
- Windows: `popoutCollab` in `ui/popout.js`. Desktop: a Tauri `WebviewWindow` with the fixed label `collab`
  (capability `windows: ["main", "popout-*", "collab"]`), so a second call finds it with `getByLabel` and focuses it;
  `src-tauri/src/lib.rs` destroys it when the main window is destroyed. Web / PWA: `window.open` with popup features
  and a fixed window name. When the browser refuses the popup, a dialog explains it and its button retries inside
  that click. There is no in-app fallback: `window.js` is imported by `remote-view.js` only (a test guards this).
- What belongs to the document stays in the document: remote cursors, selection halos, carets, comment pins, the
  inline comment composer and popovers, the Comments dock panel, share cards and the together bar.

### Secrets

Room keys, the signing key and the room secret never enter a snapshot. The **invite code** is needed in the window
(show, copy, QR code). It is not part of snapshots: the main window sends it only as the answer to `invite.code` /
`invite.link`, which the UI sends on those clicks; it travels the other way when the user types or pastes a code to
join. This relaxes ADR 0013 ("no invite code crosses the channel"). The channel is same-origin and in memory, the same
trust boundary as the app's own storage; nothing is written to disk.

## Consequences

- One Collaboration UI instead of two (the reduced pop-out view is gone), and no setting: `collabPopout` is removed.
- Closing the Collaboration window never leaves the room. The main window says so with a toast and an *Open window*
  action; the header button keeps its badge. Leaving is an explicit action (People ▸ Leave, *Leave Room*).
- Closing or reloading the main window closes the Collaboration window (`close` message; on the desktop also from Rust).
- The window needs the main window. Actions time out with "The main window did not answer." when it is gone.
- Comments added in the window are anchored to the main window's current selection (the window has no canvas);
  *Add Comment…* in the menus opens the inline composer in the document instead.
- A file sent from the window is copied once through the channel (up to 25 MB, the room's file limit).
- Position and size are remembered in `localStorage` (`openfini.collab.nativeWindow`) and only reused when that place is
  still on a screen (desktop: all monitors; browsers only report the current screen, and may clamp the position).
- Not verifiable in CI: the Tauri window (creation, focus, frameless header with drag region and buttons, placement on
  mixed-DPI monitors, close with the main window) and real browser popups. These need a manual check.
