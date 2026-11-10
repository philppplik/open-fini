// The Code studio terminal's logic, without DOM or I/O (unit tested in tests/ui/code-terminal.test.js). The UI is
// ./terminal.js; programs run through the desktop app's run-without-a-shell command (src-tauri/src/cmd.rs) under the
// policy of vibe/terminal-policy.js. Docs: docs/code-studio.md ▸ "Terminal", decision: docs/adr/0025-code-studio-terminal.md.
//
// Public API
//   planLine(text, { cwd, root, policy }) -> Plan   what one typed line does (never runs anything)
//   createHistory(max)                    -> { push, prev, next, list }   shell-like Up/Down history
//   stripAnsi(text)                       -> text without color and cursor escape sequences
//   displayPath(abs, root)                -> "~/src" style path relative to the project folder
// Plan
//   { kind: "none" } | { kind: "clear" } | { kind: "pwd" } | { kind: "help" } | { kind: "history" }
//   { kind: "cd", cwd } | { kind: "run", argv, cwd } | { kind: "error", code, message, arg? }
//   code: "parse" (a shell operator or an open quote) | "policy" (allow/deny lists) | "cd-args" | "cd-outside";
//   message is English (the policy reasons are shared with the assistant tool); the UI translates by code
// Invariants
//   * The working folder never leaves the project folder (`root`): cd and every run are checked with resolveCwd.
//   * A line becomes an argv without a shell (parseArgv: quotes only, no operators, variables or globs) and must pass
//     checkCommand with the user's allow list, deny list and deny patterns. The assistant's on/off switch does not
//     apply: the person types and starts every command here themselves.
import { parseArgv, checkCommand, resolveCwd, normalizeTerminal } from "../../vibe/terminal-policy.js";

const BUILTINS = new Set(["cd", "pwd", "clear", "cls", "help", "history"]);
const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");
const isAbs = (p) => /^([a-z]:\/|\/)/i.test(p);

/**
 * Decides what a typed line does.
 * @param {string} text
 * @param {{ cwd: string, root: string, policy?: object }} o absolute current folder and project folder
 */
export function planLine(text, { cwd, root, policy }) {
  let argv;
  try {
    argv = parseArgv(String(text || "").trim());
  } catch (err) {
    return { kind: "error", code: "parse", message: err.message };
  }
  if (!argv.length) return { kind: "none" };
  const name = argv[0].toLowerCase();
  if (BUILTINS.has(name)) {
    if (name === "clear" || name === "cls") return { kind: "clear" };
    if (name === "pwd") return { kind: "pwd" };
    if (name === "help") return { kind: "help" };
    if (name === "history") return { kind: "history" };
    if (argv.length > 2) return { kind: "error", code: "cd-args", message: "cd takes one folder." };
    const target = argv[1] == null || argv[1] === "~" ? root : argv[1].startsWith("~/") ? `${norm(root)}/${argv[1].slice(2)}` : argv[1];
    try {
      const abs = isAbs(norm(target)) ? target : `${norm(cwd)}/${target}`;
      return { kind: "cd", cwd: resolveCwd(abs, [root]) };
    } catch {
      return { kind: "error", code: "cd-outside", message: `“${argv[1]}” is outside the project folder.`, arg: argv[1] };
    }
  }
  const why = checkCommand(argv, { ...normalizeTerminal(policy), enabled: true });
  if (why) return { kind: "error", code: "policy", message: why };
  let dir;
  try {
    dir = resolveCwd(cwd, [root]);
  } catch {
    dir = norm(root);
  }
  return { kind: "run", argv, cwd: dir };
}

/** Up/Down history like a shell: consecutive duplicates are stored once, at most `max` entries. */
export function createHistory(max = 200) {
  const items = [];
  let pos = 0;
  return {
    push(line) {
      const s = String(line).trim();
      if (s && items[items.length - 1] !== s) items.push(s);
      if (items.length > max) items.splice(0, items.length - max);
      pos = items.length;
    },
    /** The previous entry (Up), or null at the start. */
    prev() {
      if (!items.length) return null;
      pos = Math.max(0, pos - 1);
      return items[pos];
    },
    /** The next entry (Down); "" past the newest one. */
    next() {
      if (pos >= items.length) return "";
      pos++;
      return pos >= items.length ? "" : items[pos];
    },
    list: () => [...items],
  };
}

// CSI (colors, cursor movement), OSC (window titles, links) and two-character escapes
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Removes terminal escape sequences (programs print colors even without a TTY when FORCE_COLOR is set). */
export function stripAnsi(text) {
  return String(text).replace(ANSI, "");
}

/** "~" for the project folder, "~/sub/dir" inside it, the absolute path otherwise. */
export function displayPath(abs, root) {
  const a = norm(abs);
  const r = norm(root);
  const ci = /^[a-z]:/i.test(r);
  const eq = (x, y) => (ci ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (eq(a, r)) return "~";
  if (eq(a.slice(0, r.length + 1), `${r}/`)) return `~/${a.slice(r.length + 1)}`;
  return a;
}
