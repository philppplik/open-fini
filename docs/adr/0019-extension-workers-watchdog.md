# ADR 0019: Extension background scripts in workers, a watchdog, and a worker pool for heavy jobs

Status: Accepted

## Context

Extensions ran in `<iframe sandbox="allow-scripts">` frames. A synchronous infinite loop in an extension could not be
interrupted: in engines that keep a sandboxed frame in the app's process (WebKit) the whole window froze, and even
where the frame had its own process the heartbeat only noticed after 30–40 s. Separately, a few pure jobs (Lanczos
resampling of large layers, image tracing, deflating large documents on save) blocked the UI thread for 0.2–0.5 s each.

## Decision

1. **Background scripts run in a dedicated worker started by the sandboxed frame.** The frame becomes a relay: it
   creates a `Worker` from a `blob:` URL (opaque origin and the frame's CSP are inherited: `connect-src 'none'`, no
   storage), forwards `postMessage` traffic, and terminates the worker on request. Removing the frame terminates the
   worker too, so stopping is preemptive. A worker created by the app itself was rejected: it would run with the app's
   origin and could read its storage. Panels need a DOM and stay frames. When no worker can be started the relay runs
   the script in the frame (the previous behavior) and logs it.
2. **A pure watchdog** (`extensions/watchdog.js`): a heartbeat state machine (ping every 5 s, hung after three
   unanswered ticks), a flood guard over every raw message, and a stop policy (three stops in 30 minutes disable the
   extension). Timers and clock are injected; the sandbox wires it up. A stop notifies the user with Restart / Disable
   and is logged to the persistent log.
3. **A generic worker pool** (`core/workers/`): lazily created module workers (size `hardwareConcurrency - 1`, at most
   4), transferable buffers, cancellation by `AbortSignal` (terminates the worker), progress messages, idle shutdown,
   and a local fallback with the same job code when Workers are unavailable or fail to start (Node tests, old engines).
   Only three jobs moved, chosen by measurement (`docs/performance.md`): `pixel.resize` (Resize Document with a
   resample filter), `pixel.trace` (Trace Image) and `zip.compress` (saving documents with more than 512 KB to deflate).

## Consequences

* A runaway loop in a background script no longer freezes the app in builds that support workers in sandboxed frames.
  Panels can still freeze WebKit-based builds; this is documented in `docs/extensions.md`.
* Background scripts have no DOM. The bundled extensions and SDK examples did not use one.
* The pool worker is a separate bundle that repeats the resize/trace engines and fflate (about 24 KiB gzip, lazy).
  Start-up is unchanged. Other candidates (live filter layers, RAG indexing, unzip on open) were measured and left on the
  main thread: either they are fast enough or they need an asynchronous render pipeline first.
