# Multi-window (pop-out windows) and recent files

Work in several studios side by side: any document tab, or a whole studio, can open in its own OS window.

## Using it
- Tab right-click: **Move to new window** (default) or **Open copy in new window**.
- Studio button right-click: **Open studio in new window**. File: **New Window** (Ctrl+Shift+Alt+N), **Detach Current Studio**, **Return to Main Window** (pop-outs only). Commands: `window.popout`, `window.popoutStudio`, `window.new`, `window.returnToMain`.
- Closing a pop-out asks whether to send its documents back to the main window.
- Preferences are shared: a change in one window updates the others (`storage` event).

## Architecture
Every window is a full OpenFini instance (own `App`, own memory). A pop-out is the same page with `?popout=<studio>&doc=<handoffId>&pid=<windowId>`.

| Piece | Where |
| --- | --- |
| Pure logic: URL params, envelope, registry, label allocation | `app/src/platform/popout.js` (tests: `tests/packaging/popout.test.js`) |
| Runtime: window creation, handoff, return, recovery, prefs sync | `app/src/ui/popout.js` (lazy, loaded by `boot.js`) |
| Commands | `app/src/commands/window.js` |
| Menus | `File` and `View` in `ui/menus.js`; tab and studio-button providers in `ui/context-menu/providers.js` |
| Tauri permissions | `src-tauri/capabilities/default.json` (`windows: ["main", "popout-*"]`, `core:webview:allow-create-webview-window`) |

### Handoff protocol
1. Source opens the window first (the browser needs the click's user gesture), choosing the handoff id.
2. Source writes the document with `saveOfini` into IndexedDB `popout:<id>` (envelope: version, name, studio, saved flag, path, bytes, mode).
3. The new window polls for the envelope (up to 10 s), loads it with `loadOfini`, deletes the key and posts `adopted` on `BroadcastChannel("openfini-popout")`.
4. Only after `adopted` (12 s timeout) does the source close its copy (Move). On timeout or a blocked window the source keeps the document. The two copies are independent afterwards.
5. **Return** is the same protocol in the other direction (message `return`, answered with `adopted` by the main window).

Move transfers the whole current state, so unsaved changes travel with it (a confirm explains this).

### Not losing work
Pop-outs autosave to their own key `popout-session:<windowId>` (the main window keeps `session`). When a pop-out closes without returning (`closed` message) and at the next main start, the main window pings the channel; documents of vanished pop-outs that were unsaved reopen as tabs, then the key is deleted. Handoff and session keys are encrypted while the app lock is on.

## Limits
- **Tauri (desktop):** real windows via `window.__TAURI__.webviewWindow.WebviewWindow`, labels `popout-<n>`, same custom title bar. This path cannot be exercised in CI or a browser; it was written against the Tauri v2 API and needs a manual check.
- **Web / PWA:** `window.open` of the same origin as a popup window. Browsers cannot create frameless windows, so the browser's own chrome shows. Pop-up blockers can refuse it (a toast says so). Closing a browser popup cannot run an async "send back?" prompt: only a leave-page warning appears, and unsaved work comes back through recovery.
- Documents are never shared live; there is no co-editing between windows.
- Studio Vibe chats and other in-memory state are per window.

## Recent files
Start page: **Clear recent** (confirm, then an Undo toast for 6 seconds that restores the list and the stored copies), a remove button per entry (hover or keyboard focus). File ▸ Open Recent ends with **Clear Recent**. Command `file.clearRecent`. Settings ▸ General: "Show recent files on the start page" (`showRecent`) and "Number of recent files to remember" (`recentLimit`, 0-50; 0 stores nothing; lowering trims at once). Pure list logic: `app/src/core/recents.js` (tests: `tests/core/recents.test.js`). No Vibe tool: neither feature acts on documents.

## How to extend
New message types go into `MESSAGE_TYPES` in `platform/popout.js` and a branch in `installWindowing`. Keep envelopes plain structured-clonable data and bump `ENVELOPE_VERSION` on incompatible changes.
