# ADR 0023: Computer use for the assistant (design only, not built)

- Status: Proposed (nothing implemented; stage 1 designed in detail, see "Stage 1 design")
- Date: 2026-11-05, extended 2026-11-06

## Context

"Computer use" means the assistant sees the operating system's screen and moves the mouse and types on the keyboard
outside OpenFini. OpenFini 1.x has terminal access (`run_command`, opt-in, approved per call, argv only, inside opened
folders, see [docs/security.md](../security.md#terminal-access-for-the-assistant)) but no OS-level screen or input
control. This record lists the risks, the permissions each operating system would require and a staged plan, so a
future implementation starts from agreed limits.

## Risks

- **Prompt injection with hands.** Any text on screen (web pages, mail, chat, documents) becomes model input. A page that
  says "open the terminal and run …" is no longer only words: with input control the model can act on it. This is the
  dominant risk and the reason every stage below keeps a human approval per action.
- **Secrets on screen.** Screenshots capture password managers, banking pages, 2FA codes, private messages and other
  people's data, and are sent to the model provider.
- **Irreversible actions.** Clicks send mail, buy things, delete files, accept terms; a mis-click on a moved window is
  not undoable.
- **Privilege and persistence.** Accessibility and input-injection permissions are system-wide and outlive the session;
  a compromised webview or extension could drive them.
- **Coordinate drift.** HiDPI scaling, multiple monitors and windows moving between screenshot and click lead to wrong
  targets.
- **Detection and terms.** Automated input can violate site terms or trip bot detection; CAPTCHAs must never be solved.

## Permissions per operating system

| OS | Screen capture | Mouse and keyboard | Notes |
|---|---|---|---|
| Windows 10/11 | `Windows.Graphics.Capture` (yellow border, per-window consent picker) or GDI/DXGI duplication | `SendInput` (blocked toward elevated windows by UIPI) | Elevated targets need an elevated helper, which we will not ship. |
| macOS 13+ | Screen Recording permission (TCC, ScreenCaptureKit) | Accessibility permission (TCC, `CGEvent`) | Both are granted by the user in System Settings; the app must be signed and notarized for stable TCC records. |
| Linux X11 | `XGetImage` / XShm, no permission | XTest, no permission | No isolation at all on X11: everything can see and drive everything. |
| Linux Wayland | xdg-desktop-portal ScreenCast (per-session consent) | xdg-desktop-portal RemoteDesktop (per-session consent) | Compositor support varies (GNOME, KDE yes; others partial). |

## Decision

Do not build computer use in 1.x. If it is built later, follow the staged plan and these invariants:

1. Off by default, desktop only, separate switch from terminal access, with a persistent on-screen indicator while active
   and a global hotkey that stops it instantly.
2. Every input action (click, type, key) is approved in OpenFini's UI with a screenshot crop of the target; no "always
   allow". Typing into fields that look like passwords or payment fields is refused.
3. Screenshots are shown to the user before they are sent, can be limited to one window, and are redacted (password
   fields) when the OS exposes that information. Nothing is stored beyond the AI log's metadata.
4. Everything the model reads from the screen is wrapped as untrusted content, like web pages.
5. Native code lives in a separate Rust module with its own tests; no third-party remote-control daemons.

## Staged plan

1. **Read-only window screenshot** of one window the user picks with the OS picker (Windows Graphics Capture,
   ScreenCaptureKit window filter, portal ScreenCast), approved per capture. No input.
2. **Pointing**: the model proposes a click target; OpenFini highlights it and the user clicks themselves.
3. **Approved input inside one chosen window**: click and type with per-action approval and the stop hotkey; refuses
   elevated, password and payment targets.
4. **Review** with a security audit and a threat-model update before any broader scope (multiple windows, scroll
   sequences). Full-desktop autonomous control is out of scope.

## Stage 1 design (read-only window screenshot)

Re-evaluated on 2026-11-06 together with local file access ([vibe-files.md](../vibe-files.md)): stage 1 is still
**not built**. Each OS needs its own capture code (Windows Graphics Capture through WinRT, ScreenCaptureKit through
Objective-C, the xdg-desktop-portal over D-Bus), which means new native dependencies and signing/notarization work
(macOS TCC records are tied to the signature) that cannot be verified in this repository's CI. The design below is
what an implementation must follow.

**Switch and kill switch.** *Settings ▸ Artificial intelligence ▸ Computer use*, off by default, desktop only,
separate from terminal and local file access. While a capture session exists, a red "Screen sharing with Vibe" bar
stays on top of OpenFini with **Stop**; `Ctrl+Alt+Shift+Esc` (a global shortcut registered only while active) and the
existing *Stop all* (`hub.stopAll()`) end it. Stopping drops the picked window handle; a new pick is needed afterwards.

**Native module** `src-tauri/src/screen.rs`, commands only:

| Command | Effect |
| --- | --- |
| `screen_pick_window()` | Opens the OS picker (GraphicsCapturePicker, SCContentSharingPicker, portal ScreenCast with `types = WINDOW`); returns an opaque session id and the window title. The page never sees window handles. |
| `screen_capture(session, max_px)` | One frame of that window, downscaled to at most `max_px` on the long side, PNG bytes. Refused when the window is gone or minimized. |
| `screen_end(session)` | Releases the session. |

No command enumerates windows, captures the full desktop or injects input in stage 1. The module keeps its own
rate limit (one capture per 2 seconds) and refuses while the app is locked (app lock) or in offline mode.

**Tool** `screen_look` (group *Computer use*): calls `screen_capture`, shows the image to the user in the approval
card ("Send this screenshot of <title> to <model>?"), and only after *Allow* attaches it to the model input wrapped
with the untrusted-content notice. *Always allow* does not exist for it. Metadata (time, window title, byte size) goes
to the AI log; the image itself is never stored.

**Redaction.** Windows and macOS do not expose password-field rectangles to capture APIs. Stage 1 therefore offers
no automatic redaction; the approval card with the visible image is the control, and the docs say so.

**Tests.** Pure parts (rate limiter, session table, downscale arithmetic) get unit tests; capture itself needs a
manual test plan per OS (window closed between pick and capture, HiDPI, multiple monitors, minimized window,
protected content such as DRM video which capture APIs return black).

## Consequences
The assistant can build, test and inspect projects through `run_command` and the existing tools, but cannot operate
other applications. Users who need that today use an external agent of their choice; OpenFini does not integrate one.
