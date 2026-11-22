# Computer use for the assistant

Vibe can operate your own computer on request: it sees the screen and uses the mouse and keyboard in other apps.
The feature is **off by default**, exists only in the **desktop app on Windows and macOS**, and every session needs
your permission in a system dialog. Decision record: [ADR 0023](adr/0023-computer-use.md). Threat model:
[security.md](security.md#computer-use-for-the-assistant).

> Status: the code paths are covered by unit tests (grant state machine, policy, coordinate mapping, key parsing,
> loop guard) and compile for Windows. Real control of a Windows or macOS desktop has **not** been verified end to
> end yet; see [Limits](#limits-and-what-is-not-verified).

## Switching it on

1. *Settings ▸ Artificial intelligence ▸ Computer use ▸ Allow the assistant to use this computer*.
2. macOS only: allow OpenFini under *System Settings ▸ Privacy & Security ▸ Screen & System Audio Recording* (to see
   the screen) and *Accessibility* (to use the mouse and keyboard). The settings page shows both states and opens the
   right pane. After allowing screen recording, quit and reopen OpenFini.
3. Ask Vibe for something on your computer ("open the calculator and add 12 and 30"), or start a session yourself in
   the settings.

In the browser (PWA) the tools are not offered to the model at all and the settings page explains why: a web page
cannot see the screen or use the mouse and keyboard. On Linux the desktop app answers "not supported yet".

## Sessions

Nothing works without a session. A session is created only by a **native dialog** that the desktop app opens itself
(`computer_grant_request` in `src-tauri/src/computer.rs`). The text of the dialog is fixed in the app (English and
German); the page and the model cannot change it. It says what the assistant will be able to do, that screenshots go
to the AI provider you selected and are not stored by OpenFini, and how to stop.

| Property | Behavior |
| --- | --- |
| Who can start one | The assistant's first `computer` call (the dialog appears), or you in the settings. |
| Scope | **View only** (screenshots) or **view and control** (also mouse and keyboard). A request for control offers three answers: *Allow control*, *View only*, *Don't allow*. After *View only* the assistant is not allowed to ask again for control in that session. |
| Time limit | 5, 15 (default), 30 or 60 minutes; never longer than 60. The session ends by itself. |
| Declined | The assistant is told not to ask again; the desktop app refuses a new request for 10 seconds, the page for a minute and for the rest of that request. |
| Stop | The **Stop** button of the indicator, **Ctrl+Alt+Shift+Esc** (a global hotkey registered only while a session is active; it also stops every running chat), *Stop session* in the settings, *Stop all* in Vibe, switching the feature off, or quitting OpenFini. |
| Pause | **Esc** pauses input (screenshots still work); *Pause* in the indicator and the settings does the same. Only you can resume. |

While a session is active a small red bar stays **on top of all windows** ("Vibe is using this computer · 12 min
left") with *Pause* / *Resume* and *Stop*. It turns amber while paused. It is its own window with its own capability
(`src-tauri/capabilities/computer-indicator.json`): status, pause, resume, stop, nothing else.

## Confirmation of actions

- **Looking** (`screenshot`, `zoom`, `cursor_position`, `wait`) is covered by the session and does not ask again.
- **Every input action asks for your approval** in the Vibe transcript, showing what will happen ("click at (640, 360)
  of the last screenshot", the text to type, the keys to press). There is no "Always allow", and no approval mode
  (Auto included) skips it.
- **Opt-in for one session:** when you start a session in the settings you can tick *run clicks, scrolling and
  navigation keys without asking*. The dialog then says so. Typing text, shortcuts with modifiers, Enter, Delete and
  drags still ask every time. In such a session, moving your mouse pauses the assistant (the next action notices that
  the pointer is not where it left it). The assistant itself can never ask for this option.
- The first input action after a session started is never run: the assistant is told to take a screenshot first and
  send the action again, so you always confirm against something you can see.

Every action is a tool call in the transcript (with the screenshot that came back), is recorded in the AI log like
every tool call, and is appended to the **action log** (*Settings ▸ Artificial intelligence ▸ Computer use ▸ Action
log*; `computer-use-audit.jsonl` in the app's log folder, at most 2 MiB plus one older file): time, session, operation,
coordinates or key names, the app in front, result. Screenshots and typed text are never written to it, only sizes.

## What the assistant must not do

Passwords cannot be recognized reliably (no operating system tells an app "this is a password field"), so the rule is
a policy with several layers rather than a detector:

- The system prompt and the tool description say: never type passwords, codes, keys, card or bank details; never fill
  sign-in or payment forms; never solve CAPTCHAs, change security settings or install software; ask before anything
  that cannot be undone.
- Text that looks like a payment card number (Luhn check), an IBAN (checksum) or an API key or private key is refused
  before it reaches the desktop side.
- The desktop side refuses to type into a window whose title looks like a sign-in or payment page ("Sign in", "Login",
  "Anmelden", "Checkout", "Payment", …). This is a heuristic with false positives; type there yourself.
- Typed text always needs your approval, and the approval card shows the text.
- **Screen content is untrusted.** Every screenshot result says so, and the system prompt tells the model that text on
  screen is data, that only your chat messages are instructions, and to stop and tell you when the screen asks for
  something you did not.

## Apps that are off limits

- **OpenFini's own windows** never accept input from computer use, including its approval cards, the grant dialog and
  the indicator. The assistant cannot approve its own actions.
- **Deny list:** password managers (1Password, Bitwarden, KeePass, LastPass, Dashlane, NordPass, Proton Pass, Enpass,
  RoboForm, Keeper, Keychain Access, Passwords), authenticators, Windows Security, Credential Manager, User Account
  Control and the *Privacy & Security* pane. Matching windows are **blacked out in screenshots** (also when partly
  covered) and refuse clicks and keys. You can add apps or words of window titles; the built-in entries cannot be
  removed.
- **Allow list (optional):** when it is not empty, only these apps accept input.
- The lists live in `computer-use.json` in the app's config folder and cannot be changed while a session is active.
- **Windows:** apps running as administrator and the secure desktop (UAC prompts, lock screen) cannot be controlled
  (User Interface Privilege Isolation drops the input); OpenFini detects elevated windows and says so instead of
  failing silently. OpenFini does not ship an elevated helper.

## Tools

One tool with the common computer-use action schema, plus an information tool (group *Computer use*):

| Tool | Purpose |
| --- | --- |
| `computer` | `action`: `screenshot`, `zoom` (`region` [x0, y0, x1, y1]), `cursor_position`, `wait` (`duration`), `mouse_move`, `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click` (`coordinate` [x, y]), `left_click_drag` (`start_coordinate`, `coordinate`), `scroll` (`coordinate`, `scroll_direction`, `scroll_amount`), `type` (`text`), `key` (`text`, for example `Enter`, `ctrl+c`, `cmd+shift+t`). |
| `computer_info` | Platform, session state, displays and open windows with their box in the last screenshot. Never starts a session. |

The tools work with every vision-capable model through the normal tool interface. They are **not** mapped to
Anthropic's native `computer_…` tool type: that type needs one fixed display size per request, while OpenFini supports
several displays and regions, and the mapping could not be tested against the real API. The generic tool uses the
same action names, so models trained on that schema recognize it.

A guide for the model ships as the skill `studio-guide-computer` (screenshot first, one action at a time, verify,
prefer the keyboard, stop and ask).

## Coordinates, displays and HiDPI

- A screenshot shows one display (the primary one by default; `display` picks another) scaled down so its longer side
  is at most 1280 px (setting, 640 to 2000). It is a JPEG.
- The model gives coordinates in **pixels of the last screenshot**. The page maps them to desktop coordinates with
  the region the screenshot reported: `x = region.x + (px + 0.5) · region.w / width` (the centre of that image
  pixel). The same formula is unit tested on both sides with the same numbers.
- Desktop coordinates are what the operating system uses for the mouse: physical pixels of the virtual desktop on
  Windows (OpenFini is per-monitor DPI aware; displays left of or above the primary one have negative coordinates),
  points on macOS (a Retina display captured at 2× still maps exactly, because only the region and the image size
  enter the formula).
- The desktop side refuses points that are on no display. A screenshot older than three minutes, or from an earlier
  session, cannot be used for actions.
- `zoom` returns an enlarged crop for reading; coordinates keep referring to the last full screenshot.
- After every input action a new screenshot comes back (setting), so the model sees the result.

## Limits

| Limit | Value |
| --- | --- |
| Session length | 1 to 60 minutes (default 15) |
| Input actions per session | 600 |
| Input actions per minute / minimum gap | 120 / 100 ms |
| Screenshots | at most one per 250 ms |
| Input actions per request (one user message) | 40 (setting, 1 to 200); at most three times as many calls in total |
| Identical action in a row | 3; the fourth is refused |
| Screen unchanged after three rounds of actions | the model is told that its actions have no visible effect |
| Text per `type` call | 2000 characters, no control characters |
| Keys per `key` call | 8 |
| Scroll | 30 notches per call |

The first three rows are enforced by the desktop side, the rest by the page.

## How it is built

```
Vibe tool "computer" (app/src/vibe/tools/computer.js)
   policy: app/src/vibe/computer-policy.js      risk classes, approvals, secrets, mapping, loop guard
        │  invoke (main window only: capabilities/computer-use.json)
        ▼
src-tauri/src/computer.rs
   grant (native dialog) ── scope, expiry, pause, rate limits, action budget, checked on every call
   guards ── own windows, deny / allow list, elevated windows, points on a display, sign-in titles
   native ── xcap (capture, displays, windows), enigo (mouse, keyboard), image (scale, JPEG)
   indicator window, global hotkey (tauri-plugin-global-shortcut), Esc watcher, action log
```

- The desktop side is the boundary. It does not trust the page: without a grant from the native dialog every command
  fails, whatever the page sends. Per-action confirmation is page-side (it needs the chat UI); the desktop side makes
  sure a wrong page still cannot act outside a session, outside its scope, while paused, faster than the limits, on
  OpenFini's own windows or on denied apps.
- Keyboard input goes to the app in front. After you approve an action, OpenFini is in front, so the desktop side
  brings back the window the last click chose (Windows: `SetForegroundWindow`; macOS: `open -a <app>`) before typing,
  and refuses when that fails.
- On macOS input runs on the main thread (the keyboard layout lookup requires it).

## Permissions per operating system

| OS | To see the screen | To use mouse and keyboard | Notes |
| --- | --- | --- | --- |
| Windows 10/11 | none | none | No control of elevated windows or the secure desktop. DRM-protected video is captured black. |
| macOS 11+ | Screen & System Audio Recording | Accessibility | Both are granted in System Settings and are tied to the app's signature; an unsigned development build has to be allowed again after each rebuild. There are no Info.plist usage strings or entitlements for these two permissions; macOS shows its own prompts. Without Screen Recording, window titles are not visible either. |
| Linux | not supported | not supported | The capture library needs PipeWire, GBM and Wayland development packages that the build machines do not have, and Wayland requires portal sessions. |

## Limits and what is not verified

- **Not verified on real desktops.** Capture and input were not exercised during development (the tests mock the
  native side; the Rust tests cover the pure parts). Expect rough edges with several displays of different scale
  factors, macOS Spaces and full-screen apps, and games or apps that ignore synthetic input.
- macOS code is compiled by the release workflow only (the pull request checks compile Linux and run the tests).
- The always-on-top indicator is visible in screenshots.
- Deny-listed windows are blacked out by their bounds, not by what is actually visible; a covered window still
  produces a black rectangle. An app that is not on the list is shown as is: close what you do not want to share.
- No redaction of password fields, notifications or other private content inside allowed apps.
- The Esc pause polls the keyboard state about 25 times a second; a very short tap can be missed. Use the Stop
  button or the hotkey when it matters.
- Typing uses the operating system's text input; apps with unusual input handling (some terminals, remote desktops,
  games) may drop characters.
- No clipboard access through computer use, no drag with other buttons, no key hold.
- The browser build has no screen sharing for the assistant (`getDisplayMedia` view-only mode is not built).
