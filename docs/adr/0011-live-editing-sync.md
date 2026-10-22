# 0011: Live editing with state-diffed tree registers and an RGA for text

Status: Accepted (beta)

## Context

Rooms (ADR 0010) carried chat, comments, presence and snapshots, but not simultaneous editing of one document. The
transport is an end-to-end encrypted, ordered-per-sender broadcast through a dumb relay or a BroadcastChannel; there is
no server that could order or transform operations, members join late and reconnect, and frames can arrive twice after a
resync. The document model (`core/doc.js`) records undo steps as closures (`{undo, redo}`), not as serializable
operations; many tools mutate nodes live and record one step at the end. Text lives in the Code studio's project files
and CodeMirror states. Bundle budgets rule out shipping Yjs or Automerge in the app.

## Decision

- **CRDTs, not OT**: without a central server, OT would need a sequencer; CRDTs converge from any delivery order.
- **Design documents: a replicated map of last-writer-wins registers** per entry (node, page, root, mask, story, asset,
  document settings): position (parent + fractional key), existence, and one register per field, each stamped with a
  Lamport clock and the authenticated sender id. Delete wins over concurrent edits; moves that would form a cycle are
  undone deterministically; sibling order uses fractional keys with the id as tie-breaker. Every op is commutative and
  idempotent, so no causal buffering is needed.
- **Ops are derived by diffing**, not by instrumenting every edit: after each history step the document is flattened
  (cached by render revision) and compared with the CRDT's view. This captures every tool, undo/redo and plug-in edit
  through one path and never needs to serialize history closures. Remote ops are applied by patching the document in place
  without touching the undo history, so Undo stays local and reverts only the user's own steps (which then travel as new
  ops). Echo suppression follows from the invariant "after applying, the diff is empty".
- **Text: an RGA** (Replicated Growable Array, Roh et al. 2011) with Lamport ids and runs; small, well understood, easy to
  test, merges concurrent typing without loss. Bound to CodeMirror with `addToHistory: false` so cursors are mapped and
  remote edits are not undoable locally.
- **Initial sync** is a snapshot (`.ofini` plus the CRDT state with all clocks) sent as an encrypted file transfer to the
  requester, followed by buffered ops; duplicates are harmless.
- **Lost-update visibility**: a remote write that replaces a value the user set in the last seconds triggers a notice and
  an automatic pre-merge version (throttled), so nothing disappears silently.
- **Scope of the beta**: Vector, Layout, the layer structure of Pixel documents and Code/text files. Pixel bitmaps and
  image bytes travel only with snapshots (*Resync*); Office documents are shared as snapshots.

## Consequences

- Convergence is property-tested with thousands of seeded random histories (pure CRDTs and through real documents).
- Cost: a flatten/diff per history step is O(document) with per-node caching; applying a remote batch rebuilds child
  lists in O(document). Fine for typical documents; very large documents will feel it first.
- Field-level LWW means two people setting the same field cannot both win; the loser gets a notice and a version.
  Rich text inside Layout stories is one field (whole-story LWW), unlike Code text which merges per character.
- Tombstones are kept for the session; there is no garbage collection and no cross-user undo (both need version vectors,
  which the protocol does not carry yet).
- The conflict notice is a heuristic (recent local write replaced), not true concurrency detection.
