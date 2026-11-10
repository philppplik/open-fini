# ADR 0028: Code mode for the Vibe assistant (`run_script`)

- Status: Accepted
- Date: 2026-11-10

## Context

The assistant edits documents through tools. One tool call per model turn is slow and costly for work that is
repetitive or computed: renumbering forty cards, laying out a grid from data, changing every heading that matches a
rule. `run_plan` batches a fixed list of calls, but it has no loops, conditions or arithmetic, and `evaluate` can
compute but may only call read-only tools. Models are good at writing short programs, so the missing piece is a
safe way to let a program drive the tools.

## Decision

Add `run_script`: the model sends a JavaScript function body, OpenFini runs it and returns the result.

1. **Isolation.** The script runs in a Web Worker built from a blob, with the prelude of `run_code`
   (`vibe/utility-lib.js`): `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB`, `caches`, nested
   workers and related globals are removed from the global object and its prototype chain. A worker has no DOM and
   no access to the app's memory. The worker is terminated when the script finishes, fails or runs out of time, so a
   busy loop cannot freeze the window (unlike a sandboxed iframe, which may share the page's thread).
2. **One way out.** `openfini.call(name, args)` (sugar: `openfini.<tool_name>(args)`) posts a message to the app,
   which runs exactly one tool and posts the parsed result back. There is no other channel.
3. **The gate** (`scriptTools` in `vibe/tools/script.js`) checks every call:
   - nested code, user prompts and orchestration are refused (`SCRIPT_BLOCKED`);
   - a skill's tool restriction applies as it does outside a script;
   - arguments are validated against the tool's schema before it runs;
   - a write tool that asks the user on every call (`alwaysAsk`: web, local files, terminal, clipboard) or whose own
     `needsApproval` returns a prompt for these arguments (publishing, pushing, memory, extensions) is refused with
     the instruction to call it directly. A script therefore never widens what the user approved.
   `run_script` itself follows the approval mode like any write tool: it asks in the careful mode and runs in the
   default mode, where the tools it may call would have run without a prompt anyway.
4. **Limits.** 100 KB of code, 500 tool calls, and a compute time limit (default 10 s, at most 60 s). Time spent
   inside tool calls is not charged, so a slow render does not kill a correct script.
5. **Undo.** The history entries the script created are folded into one step (`extensions/history.js`), tagged with
   the chat's run like every other edit, so "Undo this run" keeps working.
6. **Dry run.** `dryRun: true` runs the script for real, compares the layer facts of every page before and after
   (`diffFacts`), then undoes the script's entries and drops the redo tail. Only tools whose changes are fully
   recorded in the document history may write in a dry run (`DRY_RUN_GROUPS`: layers, tables, charts, layout);
   others are refused, because their changes could not be reverted exactly.
7. **A typed API on demand.** `find_tools` searches the tool set and prints TypeScript-like signatures generated from
   the JSON schemas (`tsSignature`). This is the reference for scripts and keeps the knowledge out of the system
   prompt until it is needed.

The same change adds `checkpoint` / `restore_checkpoint` (named history positions with a structural diff and a
saved render), `visual_diff` (pixel comparison against a checkpoint's render), `measure_layers` and `find_replace`.
They share `vibe/script-lib.js`, which is pure and unit-tested.

## Consequences

- One model turn can make hundreds of exact edits; the result reports the calls per tool and the undo behavior.
- A failed script leaves the edits made so far applied as one step and says so; the model can undo or continue.
- Code projects and Office documents keep their own undo stacks, so a dry run cannot cover their write tools.
- Checkpoints depend on the undo history: a checkpoint older than the history limit can be compared but not
  restored.

## Alternatives considered

- **Sandboxed iframe** (as custom tools use): shares fate with the page for synchronous loops in some engines and
  needs a document; rejected for model-written code.
- **Running tools inside the worker**: the document model is not available there and copying it both ways is slow
  and lossy.
- **Dry run by recording calls without running them**: later steps depend on real results (ids), so the recorded
  plan would differ from the real run.
