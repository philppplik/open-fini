# Troubleshooting

Something not working? Open **Help ▸ Troubleshooting…** (`Ctrl+Shift+F1`, or *Settings ▸ Troubleshooting*). A small
red dot with a number appears in the status bar when an unexpected error was logged; click it to open the dialog.
Error messages that appear as notifications have a **Details** button.

## The dialog

* **Log**: what the app recorded. A **session selector** switches between *This session*, *All stored sessions* and
  each earlier session (date, entry count, build). Filter by level and scope, search (across all sessions when *All
  stored sessions* is selected), pause, copy, save as `.txt` or `.json`, **Export all logs** (every stored session,
  redacted) and **Clear logs** (asks first; deletes this session and all stored logs). Repeated identical entries are
  merged (`×3`).
* **Problems**: warnings and errors grouped by message with counts, most serious first. When the cause is known
  (storage full, IndexedDB blocked, font load failure, AI key rejected or rate limited, provider unreachable,
  blocked by offline mode, Content-Security-Policy, out of memory, part of the app failed to load after an update,
  extension problems …) a plain-language hint says what to do. With AI features on, *Explain with Vibe* sends only the
  redacted message to your provider, and only when you click it.
* **Environment**: version and build, desktop / installed web app / browser, platform, browser or web view, CPU and
  memory, low-power mode, storage used and quota, service worker state, enabled features and your settings (without
  secrets).
* **Actions**: copy the diagnostic report, save the diagnostic bundle, report an issue, restart in safe mode, reset app
  data, verbose logging.

## Reporting a problem

1. *Report an issue…* shows exactly what will be prefilled and opens the GitHub bug form in your browser. The text is
   redacted and limited in size; nothing is sent until you submit the form on GitHub.
2. For more detail, *Copy diagnostic report* or *Save diagnostic bundle* (ZIP: report, environment, redacted logs, a
   list of stored data with sizes) and attach it.

Reports and bundles never contain documents, API keys, chat contents or file names. Skim them anyway.

## Common problems

| Symptom | What to try |
| --- | --- |
| "Storage is full" / autosave fails | Save documents as files. Settings ▸ Security and privacy ▸ Privacy tools: clear recent files or the autosaved session. Free disk space. Private windows have tiny limits. |
| Nothing is remembered between sessions | Site data is blocked or you are in a private window (IndexedDB unavailable). |
| App is slow or crashes on big images | Turn on Low-power mode, reduce undo-history memory, close other documents. |
| AI request fails | Check the Problems tab hint: key rejected (401/403), rate limit (429), server error, provider unreachable (local server not running, CORS in a browser, offline mode). |
| A feature says "Offline mode is on" | Settings ▸ Security and privacy ▸ Offline mode. |
| White screen or errors right after an update | Reload. Then *Restart in safe mode*, then *Reset app data* (offline cache). |
| Forgot the app-lock passphrase | Cannot be recovered. Use *Forgot your passphrase?* on the lock screen: it deletes the encrypted session, recent files, AI keys and chats and removes the lock. |

## Safe mode

*Restart in safe mode* (or open the app with `?safe=1`) starts without restoring your last session, with extensions
and AI off, and without applying saved settings (defaults are used; they are not deleted). A banner reminds you and
offers *Restart normally*. Use it to find out whether a setting, an extension or a damaged session causes a problem.

**Crash-loop guard:** if the app did not finish starting twice in a row, a plain panel appears on the next start
(it does not depend on the rest of the app) and offers safe mode, continuing normally, or resetting app data.

## Reset app data

*Troubleshooting ▸ Actions ▸ Reset…* lets you choose: settings, autosaved session / recent files / fonts / lock,
AI data, offline cache. Documents you saved as files are never touched. *Settings ▸ Security and privacy ▸ Delete all
local data* removes everything after typing `DELETE`.

## How long logs are kept

Logs are kept across sessions. Every info, warning and error entry (debug entries only with *Verbose logging*) is
stored on this device after secrets, tokens, e-mail addresses and your user name in paths were removed. Documents,
file contents and API keys are never logged. Storage is rotating: at most 20,000 entries or 5 MB, and nothing older
than **Settings ▸ Security and privacy ▸ Keep logs for N days** (default 14; **0 keeps the log for this session
only** and deletes what is stored). *Settings ▸ Security and privacy ▸ Privacy tools ▸ Logs* and *Clear logs* in the
dialog delete everything. The diagnostic report states the build and how many earlier sessions and entries are stored;
the bundle adds them as `log-history.json`.

## How logging works (for contributors)

* `app/src/core/log.js` is the pure logger: `log.debug|info|warn|error(scope, ...args)`, `log.scope("name")`, a
  2,000 entry ring buffer, merging of repeats, redaction at record time, `log.entries(filter)`, subscriptions.
  `app.log` is the same instance. Unit tests: `tests/core/log.test.js`.
* `app/src/core/log-capture.js` feeds it from `console.warn/error`, `window.onerror`, `unhandledrejection`, failed
  resource loads, failed `fetch` calls (network errors, 401/403/429/5xx; never bodies) and `securitypolicyviolation`
  events, and persists entries through the durable store.
* `app/src/core/log-store.js` is the pure store (no DOM; the caller passes `{get,set,delete}`): rotating segments of
  500 entries (`diag.seg.<n>`) plus an index (`diag.log.index`), one session per segment, pruning by age, entry count
  and bytes, redaction again on the way in. `log-capture.js` batches writes (5 s debounce, 1.5 s after an error) and
  flushes on `visibilitychange` and `pagehide`. Tests: `tests/core/log-store.test.js`.
* Shoelace `<sl-option>` values must not contain spaces; use `optVal()`/`optDecode()` from `core/util.js` for dynamic
  values (`tests/ui/sl-option-values.test.js` lints this).
* `app.run()` logs exceptions of commands (including rejected promises of async commands) and shows a toast with a
  **Details** button. `app.toast(message, variant, duration, { label, run })` accepts an action button.
* Use `log.warn("scope", "what happened", err)` for expected-but-notable failures; do not log document contents or
  secrets (redaction is a safety net, not permission).
* `app/src/core/diagnostics.js` holds the hint table (`HINTS`), problem grouping, the report/bundle/issue-URL builders
  and the storage inventory; `app/src/core/env.js` collects the environment (browser only).
* Vibe tools: `get_app_logs`, `get_diagnostics`, `get_security_status` (read-only, redacted).
