// Built-in network features of the desktop app (src-tauri/src: relay.rs, ftp.rs, smtp.rs, netio.rs): the
// collaboration relay, FTP/FTPS uploads and sending mail over SMTP. Loaded on first use; never part of start-up.
// Browsers and the PWA cannot open raw TCP connections, so there everything here reports "desktop only".
//
// API
//   nativeNetAvailable() → boolean
//   invokeNet(cmd, args) → Promise              errors become NativeNetError { code, fingerprint }
//   parseNetError(raw) → { code, fingerprint, message }   (UNTRUSTED_CERT | CERT_CHANGED | CANCELLED | ERROR)
//   withTrust(run, { pin, confirm, save }) → Promise   trust on first use for self-signed certificates
//   bytesToBase64(bytes) → string               onNetProgress(job, cb) → Promise<unlisten>
//   relay.start({ lan }) / relay.stop() / relay.status()
//   ftpTest(target) / ftpUpload(target, files, { onProgress, signal })
//   smtpTest(target) / smtpSend(target, mail, { onProgress, signal })

export const DESKTOP_ONLY = "This needs the OpenFini desktop app: a browser cannot open FTP or mail connections or run a relay.";
const PROGRESS_EVENT = "openfini://net-progress";

const tauri = () => (typeof window !== "undefined" ? window.__TAURI__ : null);

export function nativeNetAvailable() {
  return typeof tauri()?.core?.invoke === "function";
}

export class NativeNetError extends Error {
  constructor(message, code = "ERROR", fingerprint = "") {
    super(message);
    this.name = "NativeNetError";
    this.code = code;
    this.fingerprint = fingerprint;
  }
}

/** Splits the Rust side's error strings (`UNTRUSTED_CERT:<sha256>`, `CERT_CHANGED:<sha256>`, `CANCELLED`, text). */
export function parseNetError(raw) {
  const s = String(raw?.message ?? raw ?? "Unknown error");
  const m = /^(UNTRUSTED_CERT|CERT_CHANGED):([0-9A-Fa-f:]+)$/.exec(s);
  if (m) {
    const message = m[1] === "UNTRUSTED_CERT" ? "The server's certificate is not trusted by this computer." : "The server's certificate changed since you trusted it.";
    return { code: m[1], fingerprint: m[2], message };
  }
  if (s === "CANCELLED") return { code: "CANCELLED", fingerprint: "", message: "Cancelled." };
  return { code: "ERROR", fingerprint: "", message: s };
}

export async function invokeNet(cmd, args) {
  const core = tauri()?.core;
  if (!core?.invoke) throw new NativeNetError(DESKTOP_ONLY, "UNAVAILABLE");
  try {
    return await core.invoke(cmd, args);
  } catch (err) {
    const e = parseNetError(err);
    throw new NativeNetError(e.message, e.code, e.fingerprint);
  }
}

/**
 * Runs `run(pin)`; when the server's certificate is unknown (self-signed) or changed, asks `confirm({ fingerprint,
 * changed })` and, when the person trusts it, `save(fingerprint)` and runs once more with the pin.
 */
export async function withTrust(run, { pin = "", confirm, save } = {}) {
  try {
    return await run(pin);
  } catch (err) {
    if (!(err instanceof NativeNetError) || (err.code !== "UNTRUSTED_CERT" && err.code !== "CERT_CHANGED") || !confirm) throw err;
    const ok = await confirm({ fingerprint: err.fingerprint, changed: err.code === "CERT_CHANGED" });
    if (!ok) throw new NativeNetError("The connection was stopped: the certificate was not trusted.", "NOT_TRUSTED");
    await save?.(err.fingerprint);
    return run(err.fingerprint);
  }
}

/** Base64 of bytes (chunked, so large files do not overflow the argument list). */
export function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Progress events of one job; resolves with an unlisten function. */
export async function onNetProgress(job, cb) {
  const ev = tauri()?.event;
  if (!ev?.listen) return () => {};
  return ev.listen(PROGRESS_EVENT, (e) => e?.payload?.job === job && cb(e.payload));
}

const newJob = () => `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function job(cmd, args, { onProgress, signal } = {}) {
  const id = newJob();
  const unlisten = onProgress ? await onNetProgress(id, onProgress) : () => {};
  const abort = () => invokeNet("net_cancel", { job: id }).catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await invokeNet(cmd, { ...args, job: id });
  } finally {
    signal?.removeEventListener("abort", abort);
    unlisten();
  }
}

export const relay = {
  start: ({ lan = true, port = null } = {}) => invokeNet("relay_start", { lan, port }),
  stop: () => invokeNet("relay_stop"),
  status: () => (nativeNetAvailable() ? invokeNet("relay_status") : Promise.resolve(null)),
};

export const ftpTest = (target) => invokeNet("ftp_test", { target });
export const ftpUpload = (target, files, opts) => job("ftp_upload", { target, files: files.map((f) => ({ path: f.path, data: bytesToBase64(f.bytes) })) }, opts);
export const smtpTest = (target) => invokeNet("smtp_test", { target });
export const smtpSend = (target, mail, opts) => job("smtp_send", { target, mail: { ...mail, attachments: (mail.attachments || []).map((a) => ({ name: a.name, mime: a.mime || "application/octet-stream", data: bytesToBase64(a.bytes) })) } }, opts);
