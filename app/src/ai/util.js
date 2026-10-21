// Shared helpers for the AI runtime: errors, SSE parsing, lenient JSON, base64, abort handling.
// Pure ES module: no DOM, no storage, no globals other than standard JS/Web APIs.

/**
 * Error thrown by providers for HTTP and protocol failures.
 * @property {number} status HTTP status (0 for network errors)
 * @property {string} code provider error code/type, or a synthetic one ('network_error', 'stream_truncated', ...)
 * @property {boolean} retryable whether the agent layer should retry
 * @property {number} [retryAfterMs] server-suggested delay
 */
export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{status?:number, code?:string, retryable?:boolean, retryAfterMs?:number, provider?:string, body?:any}} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = info.status ?? 0;
    this.code = info.code ?? (info.status ? String(info.status) : "error");
    this.retryable = !!info.retryable;
    if (info.retryAfterMs != null) this.retryAfterMs = info.retryAfterMs;
    if (info.provider) this.provider = info.provider;
    if (info.body !== undefined) this.body = info.body;
  }
}

/** Creates an AbortError (or returns the signal's own Error reason). @param {AbortSignal} [signal] */
export function abortError(signal) {
  const r = signal && signal.reason;
  if (r instanceof Error && r.name === "AbortError") return r;
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}

/** True for AbortError-like values. @param {any} e */
export function isAbortError(e) {
  return !!e && (e.name === "AbortError" || e.code === "ABORT_ERR");
}

/** Throws an AbortError when the signal is already aborted. @param {AbortSignal} [signal] */
export function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError(signal);
}

/**
 * Combines several signals into one.
 * @param {(AbortSignal|undefined|null)[]} signals
 * @returns {{signal: AbortSignal, dispose: () => void}}
 */
export function combineSignals(signals) {
  const list = signals.filter(Boolean);
  const ctl = new AbortController();
  const offs = [];
  const fire = (s) => {
    if (!ctl.signal.aborted) ctl.abort(s.reason);
  };
  for (const s of list) {
    if (s.aborted) {
      fire(s);
      break;
    }
    const h = () => fire(s);
    s.addEventListener("abort", h, { once: true });
    offs.push(() => s.removeEventListener("abort", h));
  }
  return { signal: ctl.signal, dispose: () => offs.forEach((f) => f()) };
}

/**
 * Sleeps for `ms`, rejecting early on abort.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal));
    };
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

let idCounter = 0;
/** Short unique-ish id for generated tool calls. @param {string} [prefix] */
export function makeId(prefix = "id") {
  idCounter = (idCounter + 1) % 1e9;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${(globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0] ?? 0).toString(36).slice(-6)}`;
}

/** Normalizes message content to a block array. @param {string|object[]} content */
export function toBlocks(content) {
  if (content == null) return [];
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  return Array.isArray(content) ? content : [];
}

/** Concatenates the text of text blocks. @param {string|object[]} content */
export function textOf(content) {
  if (typeof content === "string") return content;
  return toBlocks(content)
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ---------------------------------------------------------------- base64

/** @param {Uint8Array} bytes */
export function bytesToBase64(bytes) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

/** @param {string} b64 @returns {Uint8Array} */
export function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/[\r\n\s]/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {Uint8Array} bytes */
export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Detects an image MIME type from magic bytes. @param {Uint8Array} b */
export function sniffImageMime(b) {
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 11 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b.length > 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return "image/png";
}

/** Parses a `data:` URL into {mime,data(base64)} or null. @param {string} url */
export function parseDataUrl(url) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(String(url || ""));
  if (!m) return null;
  const isB64 = /;base64/i.test(m[2]);
  const mime = m[1] || "text/plain";
  if (isB64) return { mime, data: m[3] };
  const bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
  return { mime, data: bytesToBase64(bytes) };
}

// ---------------------------------------------------------------- SSE

/**
 * Yields decoded text chunks from a fetch Response, ReadableStream, async iterable or plain text response.
 * Honors `signal` even when the underlying stream never produces data.
 * @param {any} source
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<string>}
 */
export async function* readTextChunks(source, signal) {
  const body = source && typeof source === "object" && "body" in source ? source.body : source;
  const decoder = new TextDecoder("utf-8");
  const decode = (c) => (typeof c === "string" ? c : decoder.decode(c, { stream: true }));
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    let abortP = null;
    let onAbort = null;
    if (signal) {
      abortP = new Promise((_, rej) => {
        onAbort = () => rej(abortError(signal));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
      abortP.catch(() => {});
    }
    let finished = false;
    try {
      for (;;) {
        const r = await (abortP ? Promise.race([reader.read(), abortP]) : reader.read());
        if (r.done) {
          finished = true;
          break;
        }
        const t = decode(r.value);
        if (t) yield t;
      }
      const tail = decoder.decode();
      if (tail) yield tail;
    } finally {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      if (!finished) {
        try {
          reader.cancel().catch(() => {});
        } catch {
          /* ignore */
        }
      }
    }
    return;
  }
  if (body && typeof body[Symbol.asyncIterator] === "function") {
    for await (const c of body) {
      throwIfAborted(signal);
      const t = decode(c);
      if (t) yield t;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
    return;
  }
  if (source && typeof source.text === "function") {
    const t = await source.text();
    if (t) yield t;
  }
}

/**
 * Incremental Server-Sent-Events parser. Robust against chunks split anywhere,
 * CRLF/CR/LF line endings, comments, keep-alives and a missing final blank line.
 * @returns {{push:(text:string)=>{event:string,data:string,id?:string}[], flush:()=>{event:string,data:string,id?:string}[]}}
 */
export function createSseParser() {
  let buf = "";
  let started = false;
  let event = "";
  let id;
  let data = [];
  const out = [];
  const dispatch = () => {
    if (data.length) out.push({ event: event || "message", data: data.join("\n"), ...(id !== undefined ? { id } : {}) });
    event = "";
    data = [];
  };
  const line = (l) => {
    if (l === "") return dispatch();
    if (l.charCodeAt(0) === 58) return; // ':' comment
    const i = l.indexOf(":");
    let field = l;
    let value = "";
    if (i >= 0) {
      field = l.slice(0, i);
      value = l.slice(i + 1);
      if (value.charCodeAt(0) === 32) value = value.slice(1);
    }
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
    else if (field === "id") id = value;
  };
  const drain = (final) => {
    const re = /\r\n|\n|\r/g;
    let start = 0;
    let m;
    while ((m = re.exec(buf))) {
      if (!final && m[0] === "\r" && m.index + 1 === buf.length) break; // maybe half of a CRLF
      line(buf.slice(start, m.index));
      start = m.index + m[0].length;
    }
    buf = buf.slice(start);
  };
  return {
    push(text) {
      if (!started && text) {
        started = true;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      }
      buf += text;
      drain(false);
      return out.splice(0);
    },
    flush() {
      drain(true);
      if (buf) {
        line(buf);
        buf = "";
      }
      dispatch();
      return out.splice(0);
    },
  };
}

/**
 * Parses an SSE response body into events.
 * @param {any} source Response | ReadableStream | async iterable
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<{event:string,data:string,id?:string}>}
 */
export async function* parseSse(source, signal) {
  const p = createSseParser();
  for await (const chunk of readTextChunks(source, signal)) {
    for (const ev of p.push(chunk)) yield ev;
  }
  for (const ev of p.flush()) yield ev;
}

// ---------------------------------------------------------------- JSON

/**
 * Parses JSON, repairing common truncation (unterminated strings/brackets, dangling commas/keys)
 * and stripping Markdown code fences. Empty input parses to `{}`.
 * @param {string} text
 * @returns {{ok:boolean, value:any, repaired:boolean, error?:string}}
 */
export function parseJsonLenient(text) {
  let s = String(text ?? "").trim();
  if (s === "") return { ok: true, value: {}, repaired: false };
  const tryParse = (t) => {
    try {
      return { v: JSON.parse(t) };
    } catch {
      return null;
    }
  };
  let r = tryParse(s);
  if (r) return { ok: true, value: r.v, repaired: false };
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*(?:```)?$/i.exec(s);
  if (fence) {
    s = fence[1];
    r = tryParse(s);
    if (r) return { ok: true, value: r.v, repaired: true };
  }
  const stack = [];
  const commas = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
    else if (c === "," && stack.length) commas.push({ pos: i, closers: stack.slice().reverse().join("") });
  }
  let head = s;
  if (inStr) {
    if (esc) head = head.slice(0, -1);
    head += '"';
  }
  head = head.trimEnd();
  if (head.endsWith(",")) head = head.slice(0, -1);
  else if (head.endsWith(":")) head += "null";
  const closers = stack.slice().reverse().join("");
  r = tryParse(head + closers);
  if (r) return { ok: true, value: r.v, repaired: true };
  for (let i = commas.length - 1; i >= 0; i--) {
    r = tryParse(s.slice(0, commas[i].pos) + commas[i].closers);
    if (r) return { ok: true, value: r.v, repaired: true };
  }
  return { ok: false, value: {}, repaired: false, error: "Invalid JSON" };
}

// ---------------------------------------------------------------- HTTP errors

/** Parses Retry-After style headers into milliseconds. @param {any} headers */
export function retryAfterMs(headers) {
  if (!headers || typeof headers.get !== "function") return undefined;
  const ms = headers.get("retry-after-ms");
  if (ms != null && !isNaN(+ms)) return Math.max(0, Math.round(+ms));
  const ra = headers.get("retry-after");
  if (ra == null) return undefined;
  if (!isNaN(+ra)) return Math.max(0, Math.round(+ra * 1000));
  const t = Date.parse(ra);
  return isNaN(t) ? undefined : Math.max(0, t - Date.now());
}

/**
 * Builds a ProviderError from a failed HTTP response (OpenAI / OpenRouter / DeepSeek / Anthropic bodies).
 * @param {Response} res
 * @param {string} [provider]
 * @returns {Promise<ProviderError>}
 */
export async function errorFromResponse(res, provider) {
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    /* ignore */
  }
  let body;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    body = undefined;
  }
  return errorFromBody(body, raw, res.status, retryAfterMs(res.headers), provider);
}

/**
 * Normalizes an error payload into a ProviderError.
 * @param {any} body parsed JSON (may be undefined)
 * @param {string} raw raw body text
 * @param {number} status
 * @param {number} [retryAfter]
 * @param {string} [provider]
 */
export function errorFromBody(body, raw, status, retryAfter, provider) {
  let message = "";
  let code;
  const e = body && typeof body === "object" ? (body.error ?? body) : undefined;
  if (typeof e === "string") message = e;
  else if (e && typeof e === "object") {
    message = e.message || e.detail || e.msg || "";
    code = e.code ?? e.type;
    const meta = e.metadata;
    if (meta && meta.raw) {
      const rawMsg = typeof meta.raw === "string" ? meta.raw : JSON.stringify(meta.raw);
      const extra = `${meta.provider_name ? meta.provider_name + ": " : ""}${rawMsg.slice(0, 300)}`;
      message = message ? `${message} (${extra})` : extra;
    }
  }
  if (!message) message = (raw || "").slice(0, 300).trim() || `HTTP ${status}`;
  if (code == null) code = status ? String(status) : "error";
  let st = status;
  if ((!st || st === 200) && typeof code === "number") st = code; // OpenRouter mid-stream errors
  const c = String(code);
  let retryable = st === 408 || st === 409 || st === 425 || st === 429 || st === 529 || (st >= 500 && st !== 501 && st !== 505);
  if (/overloaded|rate_limit|api_error|server_error|timeout/i.test(c)) retryable = true;
  if (/insufficient_quota|billing|credit|invalid_api_key|authentication|permission|not_found|invalid_request/i.test(c)) retryable = false;
  if (/insufficient (credits|quota)|billing/i.test(message)) retryable = false;
  return new ProviderError(message, { status: st, code: c, retryable, retryAfterMs: retryAfter, provider, body });
}

/**
 * Performs fetch and converts network failures / non-2xx responses into ProviderError.
 * AbortError is rethrown untouched.
 * @param {typeof fetch} fetchFn
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} [provider]
 * @returns {Promise<Response>}
 */
export async function doFetch(fetchFn, url, init, provider) {
  if (typeof fetchFn !== "function") throw new ProviderError("No fetch implementation available", { code: "no_fetch", provider });
  let res;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    if (isAbortError(e) || (init && init.signal && init.signal.aborted)) throw isAbortError(e) ? e : abortError(init.signal);
    throw new ProviderError(`Network error: ${e && e.message ? e.message : e}`, { status: 0, code: "network_error", retryable: true, provider });
  }
  if (!res.ok) throw await errorFromResponse(res, provider);
  return res;
}

/** Joins a base URL and a path without doubling slashes. @param {string} base @param {string} path */
export function joinUrl(base, path) {
  return String(base || "").replace(/\/+$/, "") + "/" + String(path || "").replace(/^\/+/, "");
}
