// The host side of the extension RPC: envelope validation, size caps, rate limiting, permission checks,
// timeouts and error mapping. Pure (the clock and the handlers are injected), so it is unit-tested.
//
// Wire format (both directions, `ofx` = protocol version):
//   { ofx: 1, t: "req", id, m: "ui.showMessage", p: {…} }   a call
//   { ofx: 1, t: "res", id, ok: true, r }  |  { ofx: 1, t: "res", id, ok: false, e: { code, message } }
import { checkPermission } from "./permissions.js";

export const PROTOCOL = 1;
export const DEFAULT_LIMITS = {
  maxRequestBytes: 4 * 1024 * 1024,
  maxResultBytes: 8 * 1024 * 1024,
  callTimeoutMs: 30_000,
  interactiveTimeoutMs: 10 * 60_000,
  burst: 100, // calls that may arrive at once
  perSecond: 60, // sustained calls per second
  floodKillAfter: 300, // rate-limited calls in a row before the extension is stopped
};

export class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Size in bytes (approximate) of a structured-clone-safe value; throws RpcError for anything else. */
export function measure(value, limit = Infinity) {
  let bytes = 0;
  let nodes = 0;
  const stack = [[value, 0]];
  while (stack.length) {
    const [x, depth] = stack.pop();
    if (++nodes > 100_000) throw new RpcError("TOO_LARGE", "The value has too many entries.");
    if (depth > 24) throw new RpcError("BAD_VALUE", "The value is nested too deeply.");
    if (x === null || x === undefined || typeof x === "boolean") bytes += 4;
    else if (typeof x === "number") bytes += 8;
    else if (typeof x === "string") bytes += x.length;
    else if (x instanceof ArrayBuffer) bytes += x.byteLength;
    else if (ArrayBuffer.isView(x)) bytes += x.byteLength;
    else if (Array.isArray(x)) for (const y of x) stack.push([y, depth + 1]);
    else if (typeof x === "object" && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null)) {
      for (const k of Object.keys(x)) {
        bytes += k.length;
        stack.push([x[k], depth + 1]);
      }
    } else throw new RpcError("BAD_VALUE", `Values of type ${typeof x} cannot be sent (only JSON data and typed arrays).`);
    if (bytes > limit) throw new RpcError("TOO_LARGE", `The value is larger than ${Math.round(limit / 1024)} KB.`);
  }
  return bytes;
}

/** Argument validators for handlers. Every helper throws RpcError("BAD_REQUEST") with a clear message. */
export const v = {
  obj(x, name = "params") {
    if (x === undefined || x === null) return {};
    if (typeof x !== "object" || Array.isArray(x)) throw new RpcError("BAD_REQUEST", `${name} must be an object.`);
    return x;
  },
  str(x, name, { max = 2000, min = 0, re, optional = false } = {}) {
    if (x === undefined && optional) return undefined;
    if (typeof x !== "string") throw new RpcError("BAD_REQUEST", `${name} must be a string.`);
    if (x.length < min || x.length > max) throw new RpcError("BAD_REQUEST", `${name} must be ${min}–${max} characters.`);
    if (re && !re.test(x)) throw new RpcError("BAD_REQUEST", `${name} has an invalid format.`);
    return x;
  },
  num(x, name, { min = -Infinity, max = Infinity, int = false, optional = false } = {}) {
    if (x === undefined && optional) return undefined;
    if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max || (int && !Number.isInteger(x))) throw new RpcError("BAD_REQUEST", `${name} must be ${int ? "an integer" : "a number"} between ${min} and ${max}.`);
    return x;
  },
  bool(x, name, { optional = false } = {}) {
    if (x === undefined && optional) return undefined;
    if (typeof x !== "boolean") throw new RpcError("BAD_REQUEST", `${name} must be true or false.`);
    return x;
  },
  oneOf(x, name, options, { optional = false } = {}) {
    if (x === undefined && optional) return undefined;
    if (!options.includes(x)) throw new RpcError("BAD_REQUEST", `${name} must be one of ${options.join(", ")}.`);
    return x;
  },
  arr(x, name, { max = 1000, optional = false } = {}) {
    if (x === undefined && optional) return undefined;
    if (!Array.isArray(x) || x.length > max) throw new RpcError("BAD_REQUEST", `${name} must be an array of at most ${max} entries.`);
    return x;
  },
};

const METHOD_RE = /^[a-z][A-Za-z]{0,24}(\.[a-z][A-Za-z]{0,24})?$/;

/**
 * @param {{handlers: Record<string, ((params: any, meta: any) => any) & {interactive?: boolean}>, granted: Iterable<string>,
 *   limits?: Partial<typeof DEFAULT_LIMITS>, now?: () => number, toolKind?: (name: string) => "read"|"write"|"denied",
 *   onViolation?: (kind: string) => void, onCall?: (method: string, ok: boolean, ms: number) => void}} o
 */
export function createDispatcher({ handlers, granted, limits = {}, now = Date.now, toolKind, onViolation, onCall }) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  let grants = new Set(granted);
  let tokens = L.burst;
  let last = now();
  let limited = 0;

  const fail = (id, code, message) => ({ ofx: PROTOCOL, t: "res", id, ok: false, e: { code, message: String(message).slice(0, 600) } });

  async function dispatch(msg, meta = {}) {
    if (!msg || typeof msg !== "object" || msg.ofx !== PROTOCOL || msg.t !== "req") return null; // not ours
    const id = msg.id;
    if (!(Number.isSafeInteger(id) || (typeof id === "string" && id.length <= 40))) return null;
    if (typeof msg.m !== "string" || !METHOD_RE.test(msg.m)) return fail(id, "BAD_REQUEST", "Invalid method name.");

    const t = now();
    tokens = Math.min(L.burst, tokens + ((t - last) / 1000) * L.perSecond);
    last = t;
    if (tokens < 1) {
      if (++limited >= L.floodKillAfter) onViolation?.("flood");
      return fail(id, "RATE_LIMITED", "Too many calls; slow down.");
    }
    tokens -= 1;
    limited = 0;

    const handler = handlers[msg.m];
    try {
      measure(msg.p, L.maxRequestBytes);
    } catch (err) {
      onViolation?.(err.code === "TOO_LARGE" ? "size" : "value");
      return fail(id, err.code || "BAD_VALUE", err.message);
    }
    const params = msg.p === undefined ? {} : msg.p;
    if (params === null || typeof params !== "object" || Array.isArray(params)) return fail(id, "BAD_REQUEST", "params must be an object.");
    const kind = msg.m === "document.callTool" && toolKind ? await toolKind(params.name) : undefined;
    if (kind === "denied") return fail(id, "PERMISSION_DENIED", `The tool “${params.name}” is not available to extensions.`);
    const check = checkPermission(grants, msg.m, params, { toolKind: kind });
    if (!check.ok) return fail(id, check.code, check.message);
    if (!handler) return fail(id, "UNKNOWN_METHOD", `Unknown method “${msg.m}”.`);

    const started = now();
    let timer;
    try {
      const ms = handler.interactive ? L.interactiveTimeoutMs : L.callTimeoutMs;
      const result = await Promise.race([
        Promise.resolve().then(() => handler(params, meta)),
        new Promise((_, rej) => (timer = setTimeout(() => rej(new RpcError("TIMEOUT", `${msg.m} took longer than ${Math.round(ms / 1000)} s.`)), ms))),
      ]);
      measure(result, L.maxResultBytes);
      onCall?.(msg.m, true, now() - started);
      return { ofx: PROTOCOL, t: "res", id, ok: true, r: result === undefined ? null : result };
    } catch (err) {
      onCall?.(msg.m, false, now() - started);
      return fail(id, err instanceof RpcError ? err.code : "HANDLER_ERROR", err?.message || String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    dispatch,
    setGranted(g) {
      grants = new Set(g);
    },
    get granted() {
      return grants;
    },
  };
}
