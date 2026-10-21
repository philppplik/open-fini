# 0008 — Vibe hub: concurrent chats with a fair document write lock and tag-based run undo

**Status:** Accepted

## Context

Vibe Studio had one `VibeSession` with one chat. Users want several chats working at the same time, and chats that
start sub-agents. All tools act on the app's shared state (`app.doc`, the active page, the selection), and per-run
undo used a history index marker (`doc.history.index` before the run), which breaks as soon as two writers
interleave.

## Decision

* A `VibeHub` (`app/src/vibe/hub.js`) owns many `VibeSession`s (one per chat, each with its own abort controller,
  transcript, plan, approvals queue, undo records and activity log) and the shared services: AI runtime, providers,
  knowledge index, MCP clients and **one write lock** (`app/src/vibe/locks.js`).
* **Lock granularity: one tool call.** Every mutating tool call (and every call that needs another document to be
  active) acquires the lock; waiters are served strictly FIFO, so two chats alternate call by call and neither starves.
  Read-only calls never wait while the chat's own document is active. `run_plan` holds the lock for the whole plan,
  which makes a plan atomic with respect to other chats. Sub-agents use the same lock with their own owner id.
* **Document affinity.** Each chat remembers the document it last edited; before a locked call the hub activates that
  document again if another chat switched away from it. The canvas therefore "follows" the chat that is editing.
* **Run tags instead of markers.** `History` got an optional ambient `tag` (additive change in `core/history.js`):
  while a chat holds the lock, `doc.history.tag = { chat, run }`, and every pushed entry is stamped with it (entries
  with different tags never coalesce). Sub-agents use their parent's run id, so "Undo this run" includes their edits.
* **Undo this run** (`app/src/vibe/run-undo.js`) undoes the run's entries only while they are on top of the stack. If
  another chat or the user edited the document afterwards, it refuses with an explanation instead of reverting other
  people's work or reordering history.
* The UI talks to the **active** chat through `SessionView`, which forwards the active session's events (the same
  event names the single session had) and, on a switch, re-renders the transcript, replays the running request's live
  events and re-emits pending approvals and questions. Background chats never steal focus.

## Consequences

* Two chats on the same document cannot corrupt each other's steps, but their edits can interleave at tool-call
  granularity. A user who wants one chat's work to be atomic asks for `run_plan` or runs one chat at a time.
* Out-of-order undo is impossible by design (History is a stack); the UI says so.
* A user edit made while a chat's async tool call holds the lock is stamped with that run's tag (rare: async tools
  such as image generation). Undoing the run would then undo it too.
* Tools still read global UI state (`app.doc`, `app.page`, the selection). Moving every tool to an explicit document
  context would remove the affinity switching but touches 100+ tools; left for later.
