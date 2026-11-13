// Interactive mode: `ofini` without arguments in a terminal. A prompt with history (Up/Down, this session only) and
// Tab completion of commands, options, kinds and file paths; every line runs the same `main()` as the command line.
import { createInterface } from "node:readline";
import { readdirSync, statSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { splitWords, GLOBAL_FLAGS } from "./args.mjs";
import { palette, useColor } from "./term.mjs";
import { NEW_KINDS } from "./project.mjs";

/** Completion candidates for a partial line (exported for tests). */
export function complete(line, { commands, cwd = process.cwd() }) {
  const words = line.split(/\s+/);
  const cur = words[words.length - 1];
  const names = [...Object.keys(commands), "exit", "clear"];
  if (words.length <= 1) return [names.filter((n) => n.startsWith(cur)), cur];
  const cmd = commands[words[0]];
  if (cur.startsWith("-") && cmd) {
    const flags = [...Object.keys(cmd.flags), ...Object.keys(GLOBAL_FLAGS)].map((f) => `--${f}`);
    return [flags.filter((f) => f.startsWith(cur)), cur];
  }
  if (words[0] === "new" && words.length === 2) return [NEW_KINDS.filter((k) => k.startsWith(cur)), cur];
  if ((words[0] === "help" && words.length === 2) || (words[0] === "completion" && words.length === 2)) {
    const list = words[0] === "help" ? Object.keys(commands) : ["bash", "zsh", "fish", "powershell"];
    return [list.filter((k) => k.startsWith(cur)), cur];
  }
  // file paths
  const raw = cur.replace(/^["']/, "");
  const dir = raw.endsWith("/") || raw.endsWith("\\") ? raw : dirname(raw) === "." && !raw.startsWith(".") ? "" : dirname(raw);
  const base = raw.endsWith("/") || raw.endsWith("\\") ? "" : basename(raw);
  let list = [];
  try {
    list = readdirSync(resolve(cwd, dir || "."))
      .filter((n) => n.startsWith(base) && (base.startsWith(".") || !n.startsWith(".")))
      .map((n) => {
        const p = dir ? join(dir, n).replace(/\\/g, "/") : n;
        let isDir = false;
        try {
          isDir = statSync(resolve(cwd, p)).isDirectory();
        } catch {
          isDir = false;
        }
        return isDir ? `${p}/` : p;
      });
  } catch {
    list = [];
  }
  return [list.sort(), cur];
}

/**
 * Starts the interactive mode; resolves with the exit code when the user leaves (exit, Ctrl+D).
 * @param {{ main: Function, commands: object, version: string, io: object }} o
 */
export function startRepl({ main, commands, version, io }) {
  const c = palette(useColor(io.stdout, io.env));
  const rl = createInterface({ input: io.stdin, output: io.stdout, terminal: true, historySize: 500, completer: (line) => complete(line, { commands, cwd: io.cwd }) });
  io.stdout.write(`${c.bold("ofini")} ${version} interactive mode. Type ${c.bold("help")} for commands, ${c.bold("exit")} to leave. Tab completes.\n`);
  rl.setPrompt(`${c.cyan("ofini ›")} `);
  rl.prompt();
  let last = 0;
  let busy = false;
  return new Promise((done) => {
    rl.on("line", async (line) => {
      const text = line.trim();
      if (!text) return rl.prompt();
      if (text === "exit" || text === "quit") return rl.close();
      if (text === "clear") {
        io.stdout.write("\x1b[2J\x1b[H");
        return rl.prompt();
      }
      let words;
      try {
        words = splitWords(text);
      } catch (e) {
        io.stderr.write(`${c.red("error:")} ${e.message}\n`);
        return rl.prompt();
      }
      if (words[0] === "ofini") words.shift();
      busy = true;
      rl.pause();
      last = await main(words, { ...io, interactive: true });
      busy = false;
      if (last) io.stdout.write(c.dim(`(exit code ${last})\n`));
      rl.resume();
      rl.prompt();
    });
    rl.on("SIGINT", () => {
      if (busy) return;
      if (rl.line) {
        rl.write(null, { ctrl: true, name: "u" });
        io.stdout.write("\n");
        rl.prompt();
      } else rl.close();
    });
    rl.on("close", () => {
      io.stdout.write("\n");
      done(last);
    });
  });
}
