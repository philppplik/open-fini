# ADR 0025: A terminal in the Code studio without a shell or PTY

- Status: Accepted
- Date: 2026-11-10

## Context

People building a website in the Code studio want to run the project's own tools next to the editor: `npm test`,
`npm run build`, `git status`, a linter or a formatter. The desktop app already runs programs for the assistant's
`run_command` tool (`src-tauri/src/cmd.rs`): one program with an argv, never through a shell, only inside folders the
person opened with *File ▸ Open Folder*, with a time limit, an output cap and a kill switch. That path is reviewed
and documented in [security.md](../security.md#terminal-access-for-the-assistant). A real terminal (a PTY running the
person's shell) would need a new native dependency, a terminal emulator in the web view and a much wider attack
surface: anything that can post to the shell's input could run any command.

## Decision

The Code studio gets a **console**, not a shell: a *Terminal* tab in the bottom panel (`ui/code/terminal.js`, logic in
`ui/code/terminal-model.js`) that reuses `cmd_run` / `cmd_kill` unchanged.

- **One line = one program with arguments.** The line is split with `parseArgv` (quotes only; `| & ; < > $` and
  backticks are refused), so there is no interpolation, piping, globbing or chaining.
- **Same policy as the assistant.** `checkCommand` with the person's allow list, deny list and deny patterns
  (*Settings ▸ Artificial intelligence ▸ Terminal*); shells are refused in JavaScript and again in Rust. The
  assistant's on/off switch does **not** apply: it guards the assistant, while here the person types and starts every
  command themselves. No AI tool can reach this console.
- **Project folder only.** The working folder is the folder the project was opened from (desktop, *File ▸ Open
  Folder*); `cd` is a built-in that cannot leave it (`resolveCwd` with the project folder as the only root) and Rust
  canonicalizes the folder again before starting the program.
- **Time limit and output cap** from the same settings (default 60 s and 256 KiB per command; at most 10 min).
  *Stop* and `Ctrl+C` kill the process. Built-ins: `cd`, `pwd`, `clear`, `history`, `help`; history is kept in memory
  only (never in the document).
- **Browser build:** the tab explains that the desktop app is needed; nothing is emulated.

## Consequences

- No new native code, dependency or permission; the security review of `cmd.rs` covers the console.
- Not a terminal emulator: programs get no stdin (prompts cannot be answered), no TTY (some print without colors,
  escape sequences are removed), and long-running dev servers end at the time limit. Interactive tools (`npm init`
  without `-y`, editors, REPLs) do not work.
- Programs run against the files on disk. Unsaved edits of a folder project are on disk only when the local preview
  server or a save has written them.
- An allowed interpreter (`node`, `python`, `npm run …`) can still run any code as the person; the allow list cannot
  make that safe. This is the same limit as for the assistant and is stated in the docs.

## Alternatives considered

- **PTY with the person's shell** (xterm.js plus a native PTY crate): full compatibility, but a large dependency,
  a shell reachable from the web view and a second security model. Rejected for now; revisit only with an ADR.
- **Reusing the assistant's floating output panel:** no input line, no history, one panel per command. Rejected.
