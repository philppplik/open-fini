# Troubleshooting and Logs

When something does not work, open *Help ▸ Troubleshooting…* (`Ctrl+Shift+F1`, or *Settings ▸ Troubleshooting*). A small red dot with a number appears in the status bar when an unexpected error was logged; click it to open the dialog. This page explains the dialog, the log, safe mode, resetting data, reporting a problem and the common symptoms.

## The dialog

| Tab | Contents |
| --- | --- |
| Log | What the app recorded, kept across sessions: a session selector (this session, all stored sessions, or one earlier session with date and entry count), filter by level and scope, search across sessions, pause, copy, save as `.txt` or `.json`, **Export all logs** (redacted) and **Clear logs**; repeated entries merge (`x3`) |
| Problems | Warnings and errors grouped by message with counts, most serious first; a plain-language hint when the cause is known (storage full, IndexedDB blocked, font load failure, AI key rejected or rate limited, provider unreachable, blocked by offline mode, Content-Security-Policy, out of memory, part of the app failed to load after an update, extension problems). With AI on, *Explain with Vibe* sends only the redacted message, and only when you click it |
| Environment | Version and build, desktop, installed web app or browser, platform, web view, CPU and memory, low-power mode, storage and quota, service worker state, enabled features and settings without secrets |
| Actions | Copy the diagnostic report, save the diagnostic bundle, report an issue, restart in safe mode, reset app data, verbose logging |

Error notifications have a **Details** button that opens the dialog.

## How long logs are kept

Logs are stored on this device (secrets, e-mail addresses and your user name in paths are removed first; never documents or keys). They rotate: at most 20,000 entries or 5 MB, and nothing older than **Settings > Security and privacy > Keep logs for N days** (default 14). Set it to 0 to keep the log for the current session only. The diagnostic report names the build and how many earlier sessions are stored.

## Report a problem

1. *Report an issue…* shows exactly what will be prefilled and opens the GitHub bug form in your browser. The text is redacted and size limited, and nothing is sent until you submit the form on GitHub.
2. For more detail, *Copy diagnostic report* or *Save diagnostic bundle* (a ZIP with the report, environment, redacted logs and a list of stored data with sizes) and attach it.

Reports and bundles never contain documents, API keys, chat contents or file names. Skim them anyway. For security issues use the private process in [[Security and Privacy]].

## Common problems

| Symptom | What to try |
| --- | --- |
| "Storage is full" or autosave fails | Save documents as files; in *Settings ▸ Security and privacy ▸ Privacy tools* clear recent files or the autosaved session; free disk space. Private windows have tiny limits |
| Nothing is remembered between sessions | Site data is blocked, or you are in a private window (IndexedDB unavailable) |
| Slow or crashing on big images | Turn on low-power mode, reduce undo-history memory, close other documents ([[Performance and Low Power]]) |
| AI request fails | Read the hint in Problems: key rejected (401, 403), rate limit (429), server error, provider unreachable (local server not running, CORS in a browser, offline mode) |
| "Offline mode is on" | *Settings ▸ Security and privacy ▸ Offline mode* |
| White screen or errors after an update | Reload; then restart in safe mode; then reset app data (offline cache) |
| Forgot the app-lock passphrase | Cannot be recovered; use *Forgot your passphrase?* on the lock screen (deletes encrypted session, recent files, AI keys and chats, removes the lock) |
| Pop-out window does not open in a browser | A pop-up blocker refused it ([[Multi-Window]]) |
| Collaboration cannot connect | Check the relay address and options ([[Collaboration Relay Setup]]) |
| The installer is blocked by the OS | See the first-launch notes in [[Installation]] |

## Safe mode

*Restart in safe mode* (or open the app with `?safe=1`) starts without restoring your last session, with extensions and AI off and without applying saved settings (defaults are used, nothing is deleted). A banner offers *Restart normally*. Use it to learn whether a setting, an extension or a damaged session causes the problem. A **crash-loop guard** shows a plain panel after two failed starts in a row, offering safe mode, continuing normally or resetting app data.

## Reset app data

*Troubleshooting ▸ Actions ▸ Reset…* lets you choose settings, the autosaved session, recent files, fonts and lock, AI data, or the offline cache. Documents you saved as files are never touched. *Settings ▸ Security and privacy ▸ Delete all local data* removes everything after you type `DELETE`.

## For contributors: how logging works

`app/src/core/log.js` is the pure logger: `log.debug|info|warn|error(scope, ...args)`, `log.scope("name")`, a 2,000 entry ring buffer, merging of repeats and redaction at record time. `core/log-capture.js` feeds it from `console.warn` and `console.error`, `window.onerror`, unhandled rejections, failed resource loads, failed `fetch` calls (never bodies) and security-policy violations, and keeps the newest 50 errors in storage. `app.run()` logs command exceptions and shows a toast with Details. `core/diagnostics.js` holds the hint table and the report builders. Do not log document contents or secrets: redaction is a safety net, not permission. Vibe tools `get_app_logs`, `get_diagnostics` and `get_security_status` expose the redacted data read-only.

## See also

- [[Security and Privacy]]
- [[FAQ]]
- [[Settings Reference]]
- [[Testing]]
