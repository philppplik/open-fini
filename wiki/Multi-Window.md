# Multi-Window

Any document tab, or a whole studio, can open in its own operating-system window, so you can work in two studios side by side. Every window is a complete OpenFini instance with its own memory; documents are handed over, not shared live. Recent files are covered at the end.

## Using it

| Goal | How |
| --- | --- |
| Move a document to a new window | Right-click the tab, **Move to new window** (default) |
| Open a copy | Right-click the tab, **Open copy in new window** |
| Open a studio in its own window | Right-click the studio button, **Open studio in new window**, or *File ▸ Detach Current Studio* |
| New window | *File ▸ New Window* (`Ctrl+Shift+Alt+N`) |
| Send back | *File ▸ Return to Main Window* (pop-outs only), or accept the prompt when closing a pop-out |

Commands: `window.popout`, `window.popoutStudio`, `window.new`, `window.returnToMain`. Preferences are shared, so a change in one window updates the others. Move transfers the whole current state including unsaved changes (a confirmation explains this).

## How it works

A pop-out is the same page with `?popout=<studio>&doc=<handoffId>&pid=<windowId>`. The source writes the document into the browser database under a handoff id; the new window loads it, deletes the key and announces `adopted` on a `BroadcastChannel`. Only after that does the source close its copy, and on timeout (12 s) it keeps the document. The two copies are independent afterwards.

## Not losing work

Pop-outs autosave to their own session key. If a pop-out closes without returning, the main window reopens its unsaved documents as tabs at the next opportunity. Handoff and session data are encrypted while the app lock is on.

## Limits

- **Desktop:** pop-outs are real Tauri windows with the same custom title bar. This path cannot be exercised in CI or a browser and needs a manual check on each OS.
- **Browser or PWA:** pop-outs are same-origin pop-up windows showing the browser's own chrome. Pop-up blockers can refuse them (a toast says so). A closing browser pop-up can only show a leave-page warning; unsaved work returns through recovery.
- Documents are never shared live and there is no co-editing between windows (use [[Collaboration]] rooms for sharing between people).
- Vibe chats and other in-memory state are per window.

## Recent files

The start page has **Clear recent** (confirm, then a 6-second Undo toast), and a remove button per entry. *File ▸ Open Recent* ends with **Clear Recent**. *Settings ▸ General* has *Show recent files on the start page* and *Number of recent files to remember* (0 to 50; 0 stores nothing). Recent entries and their stored copies are encrypted when the app lock is on.

## See also

- [[Collaboration]]
- [[Platform Support]]
- [[Settings Reference]]
- [[Troubleshooting and Logs]]
