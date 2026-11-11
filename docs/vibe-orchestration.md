# Vibe orchestration and skill packs

## plan_work
For jobs that span several files, documents or studios, Vibe calls `plan_work { goal, tasks[] }`. Each task has
`id`, `title`, `studio` (vector, pixel, layout, code, document, sheet, slides, board, scene, vibe), `targets` (files or
document names), `dependsOn`, `acceptance` and `instructions`. The tasks appear as a live checklist in the chat.

- Scheduling: a task starts when its dependencies are done; tasks sharing a target are serialized; failed or
  cancelled tasks skip their dependents. Parallelism and the step/token budget are the sub-agent settings.
- Each task runs as a sub-agent with its studio's tool group, the matching `studio-guide-*`, the `blackboard` and
  read-only tools, and must re-read its output before finishing. A reviewer agent then checks the acceptance
  criteria, fixes small problems and reports PASS or FAIL.
- `work_task { action: status | cancel | resume, id }`; `blackboard { action: get | set, key, value }`.
- Edits are tagged per task in the document history (`tag.task`), next to the chat, run and agent tags.
- The checklist in the Activity tab has controls per task: **Cancel** while a task is pending or running (its agent
  stops, dependents are skipped) and **Undo task** once it is final and has edits in an open document. Undo takes the
  write lock and reverts only that task's entries (`undoTask` in app/src/vibe/run-undo.js); a document where another
  task, chat or the user edited afterwards is left alone and named in the warning (undo the newer work first, as with
  *Undo this run*). Undone tasks show "(undone)" and `work_task status` reports `undone: true`. The controls apply to
  the latest plan of the chat.
- Fallback: without sub-agents the plan comes back in `sequential` mode; when the budget is spent tasks fail with a
  budget message and the assistant finishes the rest itself.

## Skill packs
- `studio-guide-<studio>`: where to start, tool order, units and ids, undo grouping, pitfalls, verification.
  Embedded automatically in plan_work tasks and in `spawn_agent` children that get a studio tool set.
- `openfini-*`: overview, studios, formats, ofini-format, how-to, shortcuts, settings, extensions, collaboration,
  security-privacy, troubleshooting, licensing. Help > Ask about OpenFini opens a chat primed with them.
- Packs are lazy (app/src/ai/packs/); the system prompt lists them in one line per pack.
- `npm run knowledge:packs` regenerates app/src/ai/packs/generated.js from platform/file-types.js,
  platform/format-verdicts.js, the Office app registry and the command registry; `npm run knowledge:check` (and
  the tests) fail when it is out of date.

## Tool descriptions
Write tools end with "Verify with <tool>" from `VERIFY_WITH` (app/src/vibe/tools/index.js). tests/ai/skill-packs.test.js
lints descriptions, parameter docs, verify hints and pack contents.
