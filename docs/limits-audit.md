# Limits audit: AI, Vibe and platform

Every named limit of the assistant (Vibe), its engines and the platform layer, with its cause, the extension point
that lifts it and a value/effort rating. Office limits (Document, Spreadsheet, Presentation, Whiteboard) are audited
separately. The working backlog stays [known-limits.md](known-limits.md); this file explains *why* each limit exists
and *how* it is lifted, and records which ones were closed in this pass.

Sources: [known-limits.md](known-limits.md), [ADR 0018](adr/0018-built-in-network-services.md),
[ADR 0022](adr/0022-ai-orchestration-and-skill-packs.md), [ADR 0023](adr/0023-computer-use.md),
[ADR 0024](adr/0024-ofini-cli-and-tui.md), the `vibe-*.md` guides, [extensions.md](extensions.md#honest-limits) and the
limitation notes of the 1.0.0 and 1.0.1 changelog entries.

Rating: **value** (H/M/L) is how many users hit the limit and how badly; **effort** (S/M/L/XL) is the work to lift it
in this repository, including tests and docs. **Status**: *Closed* = lifted in this pass (see CHANGELOG
`[Unreleased]`), *Partial* = an extension point exists and the rest plugs into it, *Open* = not lifted.

## Summary

| # | Limit | Value | Effort | Status |
| --- | --- | --- | --- | --- |
| A1 | Orchestrator: no per-task cancel or undo in the UI | H | S | Closed |
| A2 | Skill packs not shown in the Skills settings panel | M | S | Closed |
| A3 | Five Code-preview settings missing from the customization schema | M | S | Closed |
| A4 | Engines (speech, search, RAG loaders, OCR) are hard-wired; extensions and MCP cannot add any | H | M | Closed (registry), MCP: Partial |
| A5 | RAG: no PDF ingestion | H | S | Closed (text layer) |
| A6 | RAG: no OCR for scanned pages | M | L | Partial (hook point; no engine bundled) |
| A7 | Local speech-to-text runtime not bundled | M | L | Partial (pluggable engine; whisper.cpp not bundled) |
| A8 | Local neural text-to-speech not built | L | L | Partial (pluggable engine) |
| A9 | Built-in Rust relay: no relay key | H | S | Closed |
| A10 | Built-in Rust relay: no TLS | M | L | Open |
| A11 | Computer use not built | M | L | Closed for stage 1 (read-only window look) |
| A12 | No headless-browser page reading | M | XL | Open (no safe design) |
| A13 | Change sets (diffs) live in memory only | L | M | Open |
| A14 | Plans are per request (not persisted across requests) | L | M | Open |
| A15 | OpenCode bridge: no streaming, untested against a real binary | L | M | Open |
| A16 | Extension limits (synchronous loop in a panel frame, panel reload, hot reload only with FS Access API) | L | M–L | Open |
| A17 | Integrated terminal console in the Code studio, `ofini` TUI | M | L | Open |
| A18 | MCP servers cannot register engines directly | L | M | Partial (adapter API) |

## Details

### A1 Orchestrator per-task cancel and undo (H/S, Closed)

*Cause.* `plan_work` exposed cancel and resume only to the model (`work_task`); the live checklist was plain text,
and undo existed only per run (`run-undo.js`), so one task of a parallel job could not be stopped or reverted.

*Lift.* History entries already carry `tag.task`. `run-undo.js` generalizes to a tag predicate (`undoTagged`); the
session exposes `cancelTask(id)` and `undoTask(id)`; the checklist steps carry the task id and state, and the Activity
tab draws **Cancel** (pending/running) and **Undo task** (final tasks with edits) per row. Undo stays safe on a linear
history: it is refused with an explanation when newer edits by another task, chat or the user sit on top in the same
document (as for runs).

### A2 Skill packs in the Skills panel (M/S, Closed)

*Cause.* The panel listed only `BUILTIN_SKILL_LIST`, user and extension skills; the lazy packs (`PACK_SKILL_LIST`) were
known to the chat but invisible in Settings. *Lift.* A "Skill packs" group (studio guides, OpenFini knowledge) with
Use, Test, Customize and Export; Customize and Export load the pack body on demand (`hydrateSkill`).

### A3 Code-preview settings in the customization schema (M/S, Closed)

*Cause.* `codePreviewPort`, `codePreviewSpa`, `codePreviewLan`, `latexEngine` and `latexRemoteUrl` were added to the
preferences without schema rows, so profiles dropped them and `set_setting` refused them. *Lift.* Schema rows with
validators. Two of them change what leaves the device (`codePreviewLan` opens the preview to the network,
`latexRemoteUrl` sends LaTeX sources to a server), so they are marked `userOnly`: validated, shown by `get_settings`,
but never imported from a profile or changed by the assistant; the user sets them in Settings.

### A4 Engine registry (H/M, Closed; MCP Partial)

*Cause.* Speech input and output, web search backends and knowledge-base loaders were switch statements in their
modules; adding one meant a core edit. *Lift.* `app/src/platform/engines.js` ([engines.md](engines.md)): one registry
with typed kinds (`stt`, `tts`, `search`, `rag-loader`, `ocr`), validated descriptors, `register()` that returns a
disposer, `list/get/pick`, change events and a privacy flag (`local`). Built-ins register lazily; extensions register
through `openfini.engines.register()` (permission `vibe`, calls routed into the extension's worker with the RPC limits,
removed when it stops). Consumers: speech input (*Local model*), *Web access ▸ Search backend*, `rag_add_source` and
*Knowledge ▸ Add files*, the PDF loader (OCR). Not consumed yet: registered `tts` engines (spoken replies keep the
system voices). Export formats stay outside the registry: extensions already add exporters through
`contributes.exporters`. MCP tools can be wrapped with `mcpEngine()` in code; there is no settings UI for it (A18).

### A5 RAG PDF ingestion (H/S, Closed)

*Cause.* `addFiles` indexed text extensions only. *Lift.* `rag-loader` engines; the built-in PDF loader reads the text
layer with the already vendored, lazily loaded pdf.js (`page.getTextContent()`), keeps page numbers for citations
(`file.pdf p.3`), honors the existing caps and reports password-protected or image-only pages instead of guessing.

### A6 RAG OCR (M/L, Partial)

*Cause.* No OCR engine ships: Tesseract.js plus language data is several MB, too large for the size budget, and an
online OCR service would send documents away. *Lift.* The PDF loader calls the first registered `ocr` engine for pages
without a text layer (rendered to an image in the browser); without one, the page is listed as skipped with the reason.
An extension or a future lazily downloaded model can provide the engine; the user decides.

### A7 Local speech recognizer (M/L, Partial)

*Cause.* whisper.cpp needs an Emscripten build (about 1 MB gzip of WebAssembly), a reproducible build step and
real-time measurements on low-end hardware; bundling it would exceed the size budget, and lazy downloading needs the
same reproducible build. *Lift.* `stt` engines come in two shapes, streaming (`listen`, like the system recognizer) and
batch (`transcribe(pcm16k)`). The runtime records one utterance from the microphone (16 kHz mono PCM, silence end,
time cap) and hands it to a batch engine, so a whisper.cpp WebAssembly build only has to implement `transcribe`.
*Speech input ▸ Local model* uses the first registered local engine and still says so honestly when none is
installed. Not done: the WebAssembly build itself (see [vibe-voice.md](vibe-voice.md#plugging-in-a-local-recognizer)).

### A8 Local neural TTS (L/L, Partial)

The registry has a `tts` kind and the system voices are registered as its built-in engine, but spoken replies do not
switch to another engine yet (next step: a voice-engine choice in *Settings ▸ Voice*). A Piper/ONNX runtime is not
bundled for the same size reasons as A7.

### A9 Rust relay key (H/S, Closed)

*Cause.* The built-in relay had no access control beyond room tokens, so a relay reachable from the internet (for
example through a tunnel) was an open forwarder. *Lift.* `relay_start` takes an optional key (16 to 128 base64url characters;
the app generates 22); WebSocket upgrades without `?key=<key>` get `401` (constant-time comparison, same rule as the Node
relay's `--auth-token`). When a room is started with the tunnel option, the app generates a key, restarts a keyless relay
and puts the key into the local address and the public invite; LAN-only rooms stay keyless (trusted network).

### A10 Rust relay TLS (M/L, Open)

*Cause.* The relay uses one reader and one writer thread per connection on a cloned `TcpStream`; `native-tls` streams
cannot be cloned, so TLS needs a different I/O model (one thread with non-blocking I/O, or a lock around the stream)
plus certificate handling (user-supplied PEM, or a generated self-signed certificate that browsers on other devices
reject anyway). It cannot be tested on the Windows development machine (`cargo test` does not start there). *Way to
lift.* Move the relay to a single-threaded poll loop over `native_tls::TlsStream` with an acceptor built from a
user-chosen PEM pair; until then use the Node relay's `--tls-cert/--tls-key` or a TLS-terminating proxy, and the relay
key (A9) for access control.

### A11 Computer use stage 1 (M/L, Closed for stage 1)

*Cause.* ADR 0023 planned native capture per OS (WinRT, ScreenCaptureKit, portal), which needs new native code and
signing work that CI cannot verify. *Lift.* Stage 1 uses the web platform's own screen-capture picker
(`getDisplayMedia`, preferring one window): the browser or OS shows its picker and sharing indicator, the page never
enumerates windows, and OpenFini adds the ADR's controls: off by default (*Settings ▸ Artificial intelligence ▸
Computer use*), a red bar with **Stop** while a capture session exists, `Escape` from the bar and *Stop all* end it,
one capture per 2 seconds, offline mode and app lock refuse it, and every frame is shown to the user and sent only
after **Send** (no "always allow"). Frames are wrapped as untrusted content and never stored; the AI log keeps only
time, size and the window label. No input injection (stages 2 to 4 stay design only). Desktop webviews: WebView2
supports the picker; WKWebView and WebKitGTK support depends on the OS version and is unverified.

### A12 Headless-browser page reading (M/XL, Open)

*Cause and decision.* Rendering arbitrary sites in a hidden webview would run their JavaScript with the app's network
position (local network, cookies of the webview profile), and Tauri 2 has no supported way to read a remote page's
DOM without giving that page IPC access. No design found that keeps the guarantees of the native GET (no cookies,
private addresses refused per hop, approval per domain). *Way to lift.* A separate, unprivileged browser process
(for example a user-installed Chromium driven over the DevTools protocol by an MCP server the user adds) keeps the
risk outside OpenFini; the `search` and `rag-loader` engine kinds accept such an engine from an extension.

### A13–A18

- **A13 Change sets in memory only.** Diffs hold full before/after snapshots; persisting them would bloat chat storage.
  Lift: store compact per-layer patches with the chat, capped by size.
- **A14 Plans per request.** Orchestrators are bound to the run's AgentManager; persisting a plan needs serializable
  task state and agents that resume from summaries. Lift: save `status()` with the chat and offer *Continue plan*.
- **A15 OpenCode bridge.** Only documented endpoints are used; streaming (SSE `/event`) needs a real binary to test
  against. Lift: SSE reader behind the existing adapter once verified.
- **A16 Extension limits.** Panels run in sandboxed frames on the main thread (only background scripts run in
  workers); frames reload when hidden; hot reload needs the File System Access API. Lift: off-main-thread panels are not
  possible with DOM access; keep the watchdog.
- **A17 Code studio terminal console and `ofini` TUI.** Need a PTY on the desktop (new native code) and a terminal
  emulator component; tracked in ADR 0024.
- **A18 MCP engines.** `mcpEngine(kind, server, tool, map)` adapts an MCP tool to an engine in code; a settings UI to do
  that without code is open.

## Verification

Closed items have unit tests (registry, loaders, schema rows, task undo, relay key parsing, capture rate limiter and
session state). Not verified in the real environment: the capture picker in the desktop webviews (WebView2,
WKWebView, WebKitGTK), the relay key over a real network, OCR and local recognizer engines (none bundled).
