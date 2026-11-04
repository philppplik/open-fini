# AI logging

One structured record per Vibe request, so developers can see what the assistant did and iterate on skills and tools.
Code: `app/src/vibe/ai-log.js` (records, export), hooked into `vibe/session.js`; UI `app/src/ui/vibe/panel-ailog.js`.

## Settings

Settings ▸ Artificial intelligence ▸ Logging and actions (stored in the Vibe settings):

| Key | Default | Meaning |
| --- | --- | --- |
| `aiLog` | `true` | record run metadata |
| `aiLogVerbose` | `false` | also record prompt, tool arguments, results and the reply (redacted) |
| `quickActionChat` | `"new"` | right-click AI: `new` chat, `reuse` the last one, `inline` (no chat) |

## Storage

`core/log-store.js` in its own channel: index key `ai.log.index`, segments `ai.seg.<n>` (100 records per segment),
same rotation as the diagnostics log (14 days, 20,000 entries, 5 MB). Each entry's `msg` is the JSON record (at most
64 KiB; larger records drop content and get `truncated: true`). Everything passes `redact()`/`redactValue()` from
`core/log.js`; keys named like secrets become `"[redacted]"`.

## Record (version 1)

```jsonc
{
  "v": 1, "t": 1760000000000, "ms": 1834, "chat": "chat_…", "source": "chat" | "right-click" | "quick-action",
  "model": "gpt-…", "provider": "<provider id>|demo", "route": "<route id>|chain|null", "mode": "balanced",
  "systemHash": "a53a7331", "systemChars": 9123,          // FNV-1a of the system prompt: spot prompt changes
  "skills": ["…"], "skillsLoaded": ["brand-voice"], "toolsAvailable": 118, "promptChars": 240,
  "tools": [{ "id": "…", "name": "set_text", "argKeys": ["id", "text"], "argChars": 52, "ms": 7,
              "status": "ok" | "error" | "unfinished", "resultChars": 80, "error": "…",
              "args": {…}, "result": "…" }],         // args/result only when verbose
  "approvals": [{ "tool": "delete_layer", "allowed": true, "reason": "…" }],
  "retries": [{ "attempt": 1, "status": 429, "error": "…", "delayMs": 2000 }],
  "fallbacks": [{ "from": "A", "to": "B", "category": "rate_limit", "reason": "…" }],
  "usage": { "input": 1200, "output": 300, "cachedInput": 0 }, "steps": 4,
  "stopReason": "end" | "max_steps" | "error" | …, "error": "…",
  "verbose": false, "prompt": "…", "reply": "…"           // prompt/reply only when verbose
}
```

## Export

**Export AI log for the developer** (the Logging tab and Troubleshooting) writes
`{ format: "openfini-ai-log", version: 1, exported, build, includesContent, runs: [record…] }` as JSON, or the same as
Markdown (one section and a tool table per run). Without *Include content* the export removes `prompt`, `reply` and
every tool's `args`/`result`, even when verbose logging stored them. Secrets are always removed.

Tests: `tests/ai/ai-log.test.js`.
