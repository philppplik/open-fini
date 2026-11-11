// Terminal tab of the Code studio's bottom panel (lazy: loaded the first time the tab is shown). A console without a
// shell or PTY: one line = one program with arguments, run by the desktop app in the project folder (src-tauri/src/
// cmd.rs: no shell, working folder checked inside the opened folders, time limit, output cap, Stop kills the process).
// The browser build shows why it is unavailable. Logic: ./terminal-model.js. Docs: docs/code-studio.md ▸ "Terminal",
// docs/security.md ▸ "Terminal in the Code studio", decision: docs/adr/0025-code-studio-terminal.md.
import { h, empty } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { localSources } from "../open-folder.js";
import { planLine, createHistory, stripAnsi, displayPath } from "./terminal-model.js";

const EVENT = "openfini://cmd";
const MAX_CHARS = 300_000; // characters kept on screen; older output is dropped from the top

const tauri = () => globalThis.window?.__TAURI__;
const desktopReady = () => !!(tauri()?.core?.invoke && tauri()?.event?.listen);

/** The folder the project was opened from (desktop), if this session may run programs in it. */
function projectRoot(ws) {
  const src = localSources.get(ws.web);
  if (src?.kind !== "path") return null;
  return ws.app.openedFolders?.has(src.path) ? src.path : null;
}

/** The plan's error in the UI language (the policy's own reason is shared with the assistant and stays English). */
function errorText(plan) {
  if (plan.code === "cd-args") return t("cd takes one folder.");
  if (plan.code === "cd-outside") return t("“{folder}” is outside the project folder.", { folder: plan.arg });
  if (plan.code === "parse") return t("Not run: {reason}", { reason: plan.message });
  return t("Not allowed: {reason}", { reason: plan.message });
}

export function createTerminal(ws) {
  const { app } = ws;
  const history = createHistory();
  const out = h("pre.of-cterm__log", { role: "log", "aria-live": "polite", "aria-label": t("Terminal output") });
  const cwdLabel = h("code.of-cterm__cwd");
  const input = h("input.of-cterm__input", { type: "text", spellcheck: false, autocomplete: "off", "aria-label": t("Command"), placeholder: t("Type a command, for example npm test, and press Enter") });
  const runBtn = h("sl-button", { size: "small", variant: "primary" }, t("Run"));
  const stopBtn = h("sl-button", { size: "small", variant: "danger", disabled: true }, h("sl-icon", { slot: "prefix", name: "stop-fill" }), t("Stop"));
  const notice = h("div.of-cterm__notice");
  const el = h("div.of-cterm", notice, out, h("div.of-cterm__line", cwdLabel, h("span.of-cterm__prompt", { "aria-hidden": "true" }, "›"), input, runBtn, stopBtn));
  let cwd = null;
  let running = null; // { id, kill }

  function write(text, kind = "out") {
    const s = stripAnsi(text);
    if (!s) return;
    const atEnd = out.scrollTop + out.clientHeight >= out.scrollHeight - 4;
    const last = out.lastChild;
    if (last && last.dataset.kind === kind && kind !== "cmd" && kind !== "info") last.textContent += s;
    else out.append(h("span", { class: `of-cterm__${kind}`, "data-kind": kind }, s));
    let size = out.textContent.length;
    while (size > MAX_CHARS && out.firstChild) {
      size -= out.firstChild.textContent.length;
      out.firstChild.remove();
    }
    if (atEnd) out.scrollTop = out.scrollHeight;
  }
  const line = (text, kind = "info") => write(`${text}\n`, kind);

  /** Shows the unavailable notice (browser build, no folder) or enables the console. Returns the project folder. */
  function sync() {
    empty(notice);
    const root = desktopReady() ? projectRoot(ws) : null;
    const ok = !!root;
    if (!desktopReady()) {
      notice.append(h("sl-icon", { name: "info-circle" }), h("span", t("The terminal needs the OpenFini desktop app: a browser cannot start programs on your computer. Use the Console tab for the page's own output.")));
    } else if (!root) {
      const open = h("sl-button", { size: "small" }, t("Open Folder…"));
      open.addEventListener("click", () => app.run("file.openFolder"));
      notice.append(h("sl-icon", { name: "folder2-open" }), h("span", t("Commands run in the folder this project was opened from. Open the project folder with File ▸ Open Folder to use the terminal.")), open);
    }
    notice.hidden = ok;
    input.disabled = !ok || !!running;
    runBtn.disabled = !ok || !!running;
    if (ok && (!cwd || !cwdInside(cwd, root))) cwd = root;
    cwdLabel.textContent = ok ? displayPath(cwd, root) : "";
    cwdLabel.title = ok ? cwd : "";
    return root;
  }
  const cwdInside = (dir, root) => displayPath(dir, root).startsWith("~");

  async function submit() {
    const root = sync();
    if (!root || running) return;
    const text = input.value;
    input.value = "";
    history.push(text);
    const { vibeStore } = await import("../../vibe/store.js");
    await vibeStore.load();
    const plan = planLine(text, { cwd, root, policy: vibeStore.settings.terminal });
    if (plan.kind !== "none" && plan.kind !== "clear") line(`${displayPath(cwd, root)} › ${text.trim()}`, "cmd");
    switch (plan.kind) {
      case "none":
        return;
      case "clear":
        empty(out);
        return;
      case "pwd":
        return line(cwd);
      case "history":
        return line(history.list().map((s, i) => `${String(i + 1).padStart(4)}  ${s}`).join("\n"));
      case "help":
        return line(t("Runs one program with its arguments in the project folder, without a shell: pipes, redirects, variables and wildcards do not work, and programs cannot read keyboard input. Only programs on the allow list in Settings ▸ Artificial intelligence ▸ Terminal can run; the deny list always wins. Built in: cd, pwd, clear, history, help. Up and Down recall earlier commands, Ctrl+C or Stop ends a running program."));
      case "cd":
        cwd = plan.cwd;
        sync();
        return;
      case "error":
        return line(errorText(plan), "err");
      case "run":
        return run(plan, root, vibeStore.settings.terminal);
      default:
    }
  }

  async function run(plan, root, policy) {
    const { normalizeTerminal } = await import("../../vibe/terminal-policy.js");
    const p = normalizeTerminal(policy);
    const api = tauri();
    let id = null;
    const early = [];
    let finish;
    const done = new Promise((r) => (finish = r));
    const handle = (ev) => {
      if (ev.kind === "exit") finish(ev);
      else write(ev.data, ev.kind === "stderr" ? "err" : "out");
    };
    const unlisten = await api.event.listen(EVENT, (e) => {
      const ev = e.payload || {};
      if (id == null) early.push(ev);
      else if (ev.id === id) handle(ev);
    });
    running = { kill: () => id != null && api.core.invoke("cmd_kill", { id }) };
    setBusy(true);
    try {
      id = await api.core.invoke("cmd_run", { argv: plan.argv, cwd: plan.cwd, roots: [root], timeoutMs: p.timeoutMs, maxOutput: p.maxOutputBytes });
      for (const ev of early.splice(0)) if (ev.id === id) handle(ev);
      const ex = await done;
      if (out.lastChild && !out.lastChild.textContent.endsWith("\n")) write("\n");
      if (ex.timedOut) line(t("Stopped after the time limit ({s} s, Settings ▸ Artificial intelligence ▸ Terminal).", { s: Math.round(p.timeoutMs / 1000) }), "err");
      else if (ex.code == null) line(t("Stopped"), "err");
      else line(t("Exit code {code}", { code: ex.code }), ex.code === 0 ? "ok" : "err");
    } catch (err) {
      line(t("Failed: {error}", { error: String(err?.message || err) }), "err");
    } finally {
      unlisten();
      running = null;
      setBusy(false);
    }
  }

  function setBusy(on) {
    stopBtn.disabled = !on;
    sync();
    if (!on) input.focus();
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // typing here never triggers studio shortcuts
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const v = history.prev();
      if (v != null) input.value = v;
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      input.value = history.next();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      empty(out);
    }
  });
  // Ctrl+C (not Cmd+C, which copies) stops the running program, also while the focus is on the output
  el.addEventListener("keydown", (e) => {
    if (running && e.key === "c" && e.ctrlKey && !e.metaKey && !String(getSelection?.() || "")) {
      e.preventDefault();
      running.kill();
    }
  });
  runBtn.addEventListener("click", submit);
  stopBtn.addEventListener("click", () => running?.kill());
  out.addEventListener("click", () => {
    if (!String(getSelection?.() || "") && !input.disabled) input.focus();
  });

  sync();
  return {
    el,
    /** Re-checks availability (the project may have been opened from a folder since) and focuses the input. */
    show() {
      sync();
      if (!input.disabled) requestAnimationFrame(() => input.focus());
    },
    clear: () => empty(out),
    stop: () => running?.kill(),
    get running() {
      return !!running;
    },
  };
}
