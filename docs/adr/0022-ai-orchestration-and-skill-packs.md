# 0022: AI orchestration (plan_work) and lazy skill packs

Status: Accepted

## Context
Vibe could spawn sub-agents, but multi-file or multi-studio jobs (a website with logo, photos and copy) had no plan,
no ordering, no shared hand-offs and no review. Assistants also had no compact, reliable knowledge of each studio or
of OpenFini itself, and many write tools did not say how to check their result.

## Decision
- `plan_work` (app/src/vibe/orchestrator.js) runs 2-12 tasks with studio, targets, dependencies and acceptance checks
  on the run's AgentManager: dependency order, target locks (tasks sharing a file or document run in order), a shared
  `blackboard`, per-task studio tool groups and guides, a verification instruction per task and one reviewer agent.
  `work_task` gives status, cancel and resume per task. History entries carry `tag.task`. Concurrency, steps and
  tokens use the existing sub-agent budget; without sub-agents the plan is returned for sequential work.
- Skill packs (app/src/ai/packs/): `studio-guide-*` and `openfini-*` skills. Only catalog rows ship with the AI
  runtime; bodies load by dynamic import on first use and appear as one compact catalog line per pack. Format and
  shortcut data are generated from the registries (scripts/knowledge-packs.mjs, checked by the tests).
- Every write tool gets a "Verify with ..." hint from its tool group; a lint test enforces descriptions, documented
  parameters and verify hints.
- Help > Ask about OpenFini opens a Vibe chat primed to answer from the knowledge pack.

## Consequences
Start-up is unchanged apart from one menu row; the lazy AI chunks grow by about 15 KiB gzip. Plans are per request
(not persisted across requests); resume works while the request runs.
