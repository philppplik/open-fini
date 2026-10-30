// One sandboxed <iframe> per extension (and per panel): `sandbox="allow-scripts"` without allow-same-origin, so the
// code has an opaque origin and cannot touch the app, its storage or its cookies. All traffic is postMessage.
// A single window listener routes messages to the right sandbox by `event.source`.
// Background frames are relays that run the extension's script in a dedicated worker (html.js); destroy() posts
// {t:"kill"} (the relay terminates the worker) and removes the frame, which also ends every worker it owns.
// Watchdog (watchdog.js): every raw message passes a flood guard; with `onHang` a heartbeat pings the sandbox once
// it is ready; answers of the extension to host calls are size-checked.
import { createHeartbeat, createFloodGuard, WATCHDOG } from "./watchdog.js";
import { measure } from "./rpc.js";

const live = new Set();
let listening = false;

function onMessage(e) {
  for (const sb of live) {
    if (sb.frame.contentWindow && e.source === sb.frame.contentWindow) return void sb._receive(e.data);
  }
}

/**
 * @param {{doc: string, label: string, hidden?: boolean, onRequest: (msg:any, sb:any)=>Promise<any>, onLog?: (level:string,text:string)=>void,
 *   onHang?: (sb:any)=>void, onViolation?: (kind:string, sb:any)=>void}} o
 */
export function createSandbox({ doc, label, hidden = true, onRequest, onLog, onHang, onViolation }) {
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
  const flood = createFloodGuard();
  const violation = (kind) => onViolation?.(kind, sb);
  const sb = {
    frame,
    ready,
    alive: true,
    mode: null, // "worker" | "frame" once ready
    lastLog: 0,
    heartbeat: null,
    _receive(m) {
      if (!sb.alive || !m || typeof m !== "object" || m.ofx !== 1) return;
      const f = flood.hit();
      if (f !== "ok") return void (f === "kill" && violation("flood"));
      if (m.t === "req") {
        Promise.resolve(onRequest(m, sb))
          .then((res) => res && sb.alive && frame.contentWindow?.postMessage(res, "*"))
          .catch(() => {});
      } else if (m.t === "ires") {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (!m.ok) return void p.reject(Object.assign(new Error(m.e?.message || "The extension failed."), { code: m.e?.code }));
        try {
          measure(m.r, WATCHDOG.maxReplyBytes);
        } catch (err) {
          p.reject(Object.assign(new Error(err.message), { code: err.code }));
          return void violation("size");
        }
        p.resolve(m.r);
      } else if (m.t === "ready") {
        if (!readyFlag) {
          readyFlag = true;
          sb.mode = m.mode === "worker" ? "worker" : "frame";
          if (!m.error && onHang) {
            sb.heartbeat = createHeartbeat({ ping: () => sb.invoke("ping", {}, WATCHDOG.intervalMs * (WATCHDOG.misses + 1)), onHang: () => onHang(sb) });
            sb.heartbeat.start();
          }
          readyDone(m.error ? { error: String(m.error) } : { mode: sb.mode });
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
          reject(Object.assign(new Error(`The extension did not answer within ${Math.round(timeoutMs / 1000)} s.`), { code: "TIMEOUT" }));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        frame.contentWindow.postMessage({ ofx: 1, t: "inv", id, m, p }, "*");
      });
    },
    destroy() {
      if (!sb.alive) return;
      sb.alive = false;
      sb.heartbeat?.stop();
      live.delete(sb);
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(Object.assign(new Error("The extension was stopped."), { code: "STOPPED" }));
      }
      pending.clear();
      try {
        frame.contentWindow?.postMessage({ ofx: 1, t: "kill" }, "*"); // the relay terminates its worker
      } catch {
        /* already gone */
      }
      frame.remove(); // removing the frame ends its document and every worker it owns
      readyDone({ error: "stopped" });
    },
  };
  live.add(sb);
  frame.srcdoc = doc;
  if (hidden) document.body.append(frame);
  return sb;
}
