// Terminal tool (group "Terminal"): run_command. Desktop app only, OFF by default (Settings ▸ Artificial intelligence ▸
// Terminal), and every single call asks for approval showing the exact argv and folder. No shell: the program is run
// directly with its arguments (src-tauri/src/cmd.rs), only inside folders opened with File ▸ Open Folder, with a time
// limit and an output cap. Output streams into a live panel with a Stop button; the call is recorded in the AI log
// like every tool call. Policy: ../terminal-policy.js.
import { tool, S } from "./helpers.js";
import { vibeStore } from "../store.js";

const EVENT = "openfini://cmd";

/** Runs argv through the desktop app (no shell); resolves { code, timedOut, stdout, stderr, truncated }. */
export async function runNative(argv, { cwd, roots, timeoutMs, maxOutputBytes, signal, onOutput, title }) {
  const tauri = globalThis.window?.__TAURI__;
  if (!tauri?.core?.invoke || !tauri.event?.listen) throw new Error("Commands can only run in the OpenFini desktop app.");
  let id = null;
  let panel = null;
  const early = [];
  let out = "";
  let err = "";
  let size = 0;
  let finish;
  const done = new Promise((r) => (finish = r));
  const handle = (ev) => {
    if (ev.kind === "exit") return finish(ev);
    size += ev.data.length;
    if (ev.kind === "stderr") err += ev.data;
    else out += ev.data;
    panel?.write(ev.kind, ev.data);
    onOutput?.(ev.kind, ev.data);
  };
  const unlisten = await tauri.event.listen(EVENT, (e) => {
    const p = e.payload || {};
    if (id == null) early.push(p);
    else if (p.id === id) handle(p);
  });
  const kill = () => (id != null ? tauri.core.invoke("cmd_kill", { id }) : null);
  panel = await import("../../ui/vibe/terminal-panel.js").then((m) => m.openTerminalPanel({ title, kill })).catch(() => null);
  signal?.addEventListener("abort", kill, { once: true });
  try {
    id = await tauri.core.invoke("cmd_run", { argv, cwd, roots, timeoutMs, maxOutput: maxOutputBytes });
    for (const p of early.splice(0)) if (p.id === id) handle(p);
    const ex = await done;
    panel?.exit(ex.code, ex.timedOut);
    return { code: ex.code ?? null, timedOut: !!ex.timedOut, stdout: out, stderr: err, truncated: size >= maxOutputBytes };
  } catch (e) {
    panel?.exit(null, false, String(e?.message || e));
    throw e;
  } finally {
    signal?.removeEventListener("abort", kill);
    unlisten();
  }
}

export function terminalTools(app) {
  return [
    tool("run_command", "Runs ONE program with arguments (argv, no shell: no pipes, redirects, variables or globs) in a folder the user opened, for builds, tests, linters, git and package managers. Desktop app only, off until the user enables it, only programs on the user's allow list, and every call needs approval. Returns exit code and output (capped).", {
      argv: { type: "array", items: { type: "string" }, minItems: 1, description: "Program and arguments, e.g. [\"npm\", \"test\"]" },
      cwd: S.str("Working folder: absolute, or relative to the first opened folder (default: the first opened folder)"),
      timeoutMs: S.num("Time limit in ms (default from settings, at most 600000)", { minimum: 1000, maximum: 600000 }),
    }, ["argv"], async (a, c) => {
      const tp = await import("../terminal-policy.js");
      const p = tp.normalizeTerminal(vibeStore.settings.terminal);
      const why = tp.checkCommand(a.argv, p);
      if (why) throw new Error(why);
      const roots = [...(app.openedFolders || [])];
      const cwd = tp.resolveCwd(a.cwd, roots);
      const timeoutMs = Math.min(a.timeoutMs || p.timeoutMs, 600000);
      const r = await runNative(a.argv, { cwd, roots, timeoutMs, maxOutputBytes: p.maxOutputBytes, signal: c?.signal, title: a.argv.join(" "), onOutput: (k, d) => c?.report?.(d.slice(-200)) });
      const clip = (s) => (s.length > 20000 ? `… ${s.slice(-20000)}` : s);
      return { exitCode: r.code, timedOut: r.timedOut, stdout: clip(r.stdout), stderr: clip(r.stderr), truncated: r.truncated, cwd };
    }, {
      needsApproval: (a) => {
        const t = vibeStore.settings.terminal;
        if (!t?.enabled) return false; // the run reports that terminal access is off
        return `Run this program on your computer?\n${(a.argv || []).map((x) => (/[\s"']/.test(x) ? JSON.stringify(x) : x)).join(" ")}\nin ${a.cwd || "the first opened folder"}`;
      },
      alwaysAsk: true,
    }),
  ];
}
