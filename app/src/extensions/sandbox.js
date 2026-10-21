// One sandboxed <iframe> per extension (and per panel): `sandbox="allow-scripts"` without allow-same-origin, so the
// code has an opaque origin and cannot touch the app, its storage or its cookies. All traffic is postMessage.
// A single window listener routes messages to the right sandbox by `event.source`.
const live = new Set();
let listening = false;

function onMessage(e) {
  for (const sb of live) {
    if (sb.frame.contentWindow && e.source === sb.frame.contentWindow) return void sb._receive(e.data);
  }
}

/**
 * @param {{doc: string, label: string, hidden?: boolean, onRequest: (msg:any, sb:any)=>Promise<any>, onLog?: (level:string,text:string)=>void}} o
 */
export function createSandbox({ doc, label, hidden = true, onRequest, onLog }) {
  if (!listening) {
    window.addEventListener("message", onMessage);
    listening = true;
  }
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", label);
  frame.setAttribute("referrerpolicy", "no-referrer");
  if (hidden) {
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;visibility:hidden";
  }
  const pending = new Map();
  let seq = 0;
  let readyDone;
  const ready = new Promise((res) => (readyDone = res));
  let readyFlag = false;
  const sb = {
    frame,
    ready,
    alive: true,
    lastLog: 0,
    _receive(m) {
      if (!m || typeof m !== "object" || m.ofx !== 1) return;
      if (m.t === "req") {
        Promise.resolve(onRequest(m, sb))
          .then((res) => res && sb.alive && frame.contentWindow?.postMessage(res, "*"))
          .catch(() => {});
      } else if (m.t === "ires") {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.ok) p.resolve(m.r);
        else p.reject(Object.assign(new Error(m.e?.message || "The extension failed."), { code: m.e?.code }));
      } else if (m.t === "ready") {
        if (!readyFlag) {
          readyFlag = true;
          readyDone(m.error ? { error: String(m.error) } : {});
        }
      } else if (m.t === "log") {
        const now = Date.now();
        if (now - sb.lastLog < 20 && m.level !== "error") return; // console floods are dropped
        sb.lastLog = now;
        onLog?.(["info", "warn", "error"].includes(m.level) ? m.level : "info", String(m.text ?? "").slice(0, 4000));
      }
    },
    /** Calls into the extension; rejects on timeout or when the frame is gone. */
    invoke(m, p = {}, timeoutMs = 30_000) {
      return new Promise((resolve, reject) => {
        if (!sb.alive || !frame.contentWindow) return reject(new Error("The extension is not running."));
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`The extension did not answer within ${Math.round(timeoutMs / 1000)} s.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        frame.contentWindow.postMessage({ ofx: 1, t: "inv", id, m, p }, "*");
      });
    },
    destroy() {
      if (!sb.alive) return;
      sb.alive = false;
      live.delete(sb);
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("The extension was stopped."));
      }
      pending.clear();
      frame.remove();
      readyDone({ error: "stopped" });
    },
  };
  live.add(sb);
  frame.srcdoc = doc;
  if (hidden) document.body.append(frame);
  return sb;
}
