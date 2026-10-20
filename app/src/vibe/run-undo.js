// Per-run undo for concurrent Vibe chats, based on history entry tags (core/history.js `tag`). Pure.
//
// Every mutating tool call of a chat runs under the hub's write lock with `doc.history.tag = { chat, run }`, so the
// entries a run created carry its run id (sub-agents use their parent's run id). "Undo this run" then means: undo the
// applied entries tagged with that run. Because History is a linear stack, this is only correct while those entries
// are on TOP of the stack. If another chat (or the user) edited the document afterwards, undoing would also revert
// (or reorder) their work, so we refuse and explain instead of guessing. See docs/adr/0007-vibe-hub.md.
//
// Public API: runSteps(history, runId), undoRunCheck(history, runId), undoRun(doc, runId), mergeTagged(...)

/** Number of applied entries of `runId` that are still in the history. */
export function runSteps(history, runId) {
  let n = 0;
  for (let i = 0; i < history.index; i++) if (history.entries[i].tag?.run === runId) n++;
  return n;
}

/**
 * Can `runId` be undone right now?
 * @returns {{ok:boolean, steps:number, reason?:string, blockedBy?:'other'|'user'}}
 */
export function undoRunCheck(history, runId) {
  const steps = runSteps(history, runId);
  if (!steps) return { ok: false, steps: 0, reason: "This run has no edits left in the document history (already undone, or trimmed by the history limit)." };
  // every applied entry above the run's first entry must belong to the run
  let first = -1;
  for (let i = 0; i < history.index; i++) {
    if (history.entries[i].tag?.run === runId) {
      first = i;
      break;
    }
  }
  for (let i = first; i < history.index; i++) {
    const t = history.entries[i].tag;
    if (t?.run !== runId) {
      return { ok: false, steps, blockedBy: t ? "other" : "user", reason: t ? "Another chat edited this document after this run. Undo that chat's run first (or use Ctrl+Z step by step)." : "You edited this document after this run. Undo your own edits first (Ctrl+Z), then undo the run." };
    }
  }
  return { ok: true, steps };
}

/**
 * Undoes every entry of `runId` when it is on top of the stack.
 * @param {{history:any, undo:()=>boolean}} doc
 * @returns {{undone:number, reason?:string}}
 */
export function undoRun(doc, runId) {
  const c = undoRunCheck(doc.history, runId);
  if (!c.ok) return { undone: 0, reason: c.reason };
  let n = 0;
  while (doc.history.index > 0 && doc.history.entries[doc.history.index - 1].tag?.run === runId) {
    if (!doc.undo()) break;
    n++;
  }
  return { undone: n };
}
