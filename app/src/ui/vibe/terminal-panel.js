// Live output of the assistant's run_command (lazy, desktop app): a small floating panel with the command, its
// streaming stdout/stderr, the exit status, a Stop button (kills the process) and Close. One panel per command; the
// newest is on top. Docs: docs/vibe-studio.md ▸ Terminal access.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";

const MAX_CHARS = 200_000;

export function openTerminalPanel({ title, kill }) {
  const pre = h("pre.of-term__out", { role: "log", "aria-live": "polite", style: "margin:0;max-height:40vh;overflow:auto;white-space:pre-wrap;font:12px/1.4 var(--of-font-mono, monospace);padding:8px;background:var(--of-surface-2, #111);color:var(--of-text, #ddd)" });
  const status = h("span.of-term__status", t("Running…"));
  const stop = h("button.of-btn", { type: "button" }, t("Stop"));
  const close = h("button.of-btn", { type: "button" }, t("Close"));
  const panel = h("section.of-term", { role: "region", "aria-label": t("Command output"), style: "position:fixed;right:16px;bottom:16px;z-index:9000;width:min(640px,calc(100vw - 32px));border:1px solid var(--of-border, #444);border-radius:8px;background:var(--of-surface, #1b1b1b);box-shadow:0 8px 24px #0006;overflow:hidden" },
    h("header", { style: "display:flex;gap:8px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--of-border, #444)" }, h("code", { style: "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, `$ ${title}`), status, stop, close),
    pre);
  stop.addEventListener("click", () => {
    stop.disabled = true;
    kill?.();
  });
  close.addEventListener("click", () => panel.remove());
  document.body.append(panel);
  let size = 0;
  return {
    write(kind, data) {
      if (size > MAX_CHARS) return;
      size += data.length;
      const span = h("span", kind === "stderr" ? { style: "color:var(--of-danger, #f77)" } : {}, size > MAX_CHARS ? `${data}\n… ${t("output truncated")}` : data);
      const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
      pre.append(span);
      if (atEnd) pre.scrollTop = pre.scrollHeight;
    },
    exit(code, timedOut, error) {
      stop.disabled = true;
      status.textContent = error ? t("Failed: {error}", { error }) : timedOut ? t("Stopped after the time limit") : code == null ? t("Stopped") : t("Exit code {code}", { code });
    },
    el: panel,
  };
}
