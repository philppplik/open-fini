# 0013: The Collaboration window pops out as a UI-only remote view

Status: Accepted

## Context

The floating Collaboration window cannot leave the main app window: a web page cannot draw outside its own window.
Users want chat and comments on a second screen. OpenFini already has real OS windows (pop-outs, see
`docs/multi-window.md`), but every window is a full `App` with its own memory, and the room transport is per window
(BroadcastChannel for "This device" rooms, one WebSocket for relay rooms). A pop-out therefore cannot simply "use the
same connection".

## Options

a. **Second connection**: the pop-out joins the room itself. This needs the room secret in the new window (a handoff
   through IndexedDB), and a member identity. A member id is the hash of an ECDSA signing key that lives in the main
   window; sharing it means exporting private key material, otherwise the pop-out would join as a *second member* (a
   second "you" in the member list, a second set of read markers and notifications, a second key-rotation participant).
   Both are worse than the problem they solve: secrets would cross windows and be written to disk, even briefly.
b. **UI-only remote view** (chosen): the main window stays the only owner of the connection, identity, keys, unread
   counters and notifications. The pop-out is a view: it receives bounded, plain-data snapshots and sends a whitelist of
   actions over `BroadcastChannel("openfini-collab-ui")`.

## Decision

Option b. Pieces:

- `collab/remote-ui.js` (pure, tested): message envelope, action whitelist (`chat.send`, `chat.read`, `comment.add`,
  `comment.reply`, `comment.resolve`, `comment.jump`, `dock`), snapshot builder and validator with hard limits (120 chat
  messages, 200 threads, 4000 characters per text). Snapshots contain nicknames, colors, roles, chat text and thread
  text only: no keys, invite code, fingerprint words or room secret. The receiving side validates again.
- `ui/collab/remote-host.js` (main window): `popOut` opens the window through `ui/popout.js` (`popoutCollab`, URL
  `?popout=collab`, Tauri label `popout-<n>`, covered by the existing capability `windows: ["main", "popout-*"]`), answers
  `hello` with a snapshot, pushes a new snapshot after every change (coalesced, 120 ms), validates every action again and
  re-checks the member's role before acting. While a pop-out is attached the floating window is hidden; closing the
  pop-out (`bye` on `pagehide`, or the *Dock back* button) shows it again.
- `ui/collab/remote-view.js` (pop-out window): renders the same responsive layout (side rail, list column) from the
  snapshot with `textContent` only. `boot.js` takes this path before any studio, session restore, onboarding or recovery
  runs; the pop-out uses its own (never written) session key so it can not touch the main window's autosave.

## Consequences

- No duplicate identity, no secret handoff, no second transport. Unread badges, mention toasts and the title counter
  keep working in the main window; the pop-out marks the chat read through `chat.read`.
- The pop-out needs the main window: if the main window closes it is told to close (`dock`); if the main window is
  still starting, the pop-out keeps saying hello every two seconds.
- BroadcastChannel is same-origin only, so any script of this origin could read snapshots. That is the same trust
  boundary as the app's own IndexedDB; chat text is already visible to every OpenFini window of that origin on the device.
- A comment added from the pop-out is anchored to the current selection of the main window (the pop-out has no
  document or canvas).
- Works in the browser (`window.open` popup) and in Tauri (`WebviewWindow`). The Tauri path cannot run in CI and needs a
  manual check. Tabs of two *different* browser profiles do not share a BroadcastChannel; that case never arises because a
  pop-out is opened by its own main window.
