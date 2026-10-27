// Model routing with fallback. Pure ES module (no DOM, no storage, no globals except timers, injectable).
//
// A ROUTE is an ordered list of targets { providerId, model, label?, enabled?, timeoutMs?, provider, capabilities? }.
// `createRoutedProvider(...)` wraps them into ONE provider-shaped object, so runAgent, sub-agents and quick actions
// use a route without knowing about it. Its stream() follows this state machine for every request:
//
//   for each usable target (enabled, tool/vision/context compatible, breaker closed):
//     attempt -> failure? classify (ProviderError.category / fallbackWorthy / retryable)
//       retryable and retries left        -> backoff (exponential + jitter, honors Retry-After <= maxRetryAfterMs), same target
//       not fallbackWorthy (auth, invalid request, content...) -> THROW the original error (never hide user mistakes)
//         (auth errors fall back only when policy.fallbackOnAuth)
//       otherwise                         -> breaker.fail(target); emit route_fallback; next target
//   all targets failed -> throw RouteError with every attempt listed
//
// Mid-stream failures: tool_call events are buffered until the attempt succeeds, so a failure that happened before
// any TEXT reached the consumer restarts the same request cleanly. If text was already streamed, the next attempt
// continues: messages + the partial assistant text + a "continue exactly where you left off" user message; the final
// `done` message gets the partial text prepended, so nothing is duplicated. (Thinking deltas are never replayed.)
//
// Events yielded in addition to the provider events (agent.js forwards them to onEvent):
//   { type:"route_retry",    target, attempt, delayMs, reason, category }
//   { type:"route_fallback", from, to, reason, category, text }   `text` is a ready-made notice
//
// Invariants: every loop is bounded (targets x (retries+1) attempts); the stream either returns a normal completion
// or throws (AbortError for user aborts, the original error for non-fallback failures, RouteError otherwise).
import { ProviderError, abortError, isAbortError, combineSignals, sleep as defaultSleep, toBlocks, classifyProviderError } from "./util.js";

export const DEFAULT_POLICY = Object.freeze({
  retriesPerTarget: 1, // extra attempts on the same target for retryable errors before falling back
  baseDelayMs: 600,
  maxDelayMs: 8000,
  maxRetryAfterMs: 15000, // a longer Retry-After means "this target is out for now": fall back instead of waiting
  firstTokenTimeoutMs: 45000, // abort and fall back when nothing arrives
  attemptTimeoutMs: 240000, // upper bound for one attempt, streaming included
  breakerThreshold: 3, // consecutive fallback-worthy failures that open the breaker
  breakerCooldownMs: 60000,
  fallbackOnAuth: false,
  fallbackBackground: true, // sub-agents and background runs use the chain too
});

/** Merges user policy fields over the defaults, clamping to sane ranges. @param {object} [p] */
export function normalizePolicy(p = {}) {
  const n = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Math.max(lo, Math.min(hi, Number(v))) : d);
  const d = DEFAULT_POLICY;
  return {
    retriesPerTarget: Math.round(n(p.retriesPerTarget, d.retriesPerTarget, 0, 5)),
    baseDelayMs: n(p.baseDelayMs, d.baseDelayMs, 0, 60000),
    maxDelayMs: n(p.maxDelayMs, d.maxDelayMs, 0, 120000),
    maxRetryAfterMs: n(p.maxRetryAfterMs, d.maxRetryAfterMs, 0, 600000),
    firstTokenTimeoutMs: n(p.firstTokenTimeoutMs, d.firstTokenTimeoutMs, 0, 600000),
    attemptTimeoutMs: n(p.attemptTimeoutMs, d.attemptTimeoutMs, 0, 3600000),
    breakerThreshold: Math.round(n(p.breakerThreshold, d.breakerThreshold, 1, 50)),
    breakerCooldownMs: n(p.breakerCooldownMs, d.breakerCooldownMs, 0, 3600000),
    fallbackOnAuth: p.fallbackOnAuth === true,
    fallbackBackground: p.fallbackBackground !== false,
  };
}

/** Error thrown when every target failed. `attempts` lists each try. */
export class RouteError extends ProviderError {
  /** @param {string} message @param {{attempts:object[], category?:string, status?:number}} info */
  constructor(message, info) {
    super(message, { status: info.status ?? 0, code: "route_exhausted", retryable: false, category: info.category || "unknown", fallbackWorthy: false });
    this.name = "RouteError";
    this.attempts = info.attempts;
  }
}

export const targetKey = (t) => `${t.providerId || t.provider?.name || "?"}/${t.model}`;
export const targetLabel = (t) => t.label || t.model || targetKey(t);

/** Per-target circuit breaker state shared across requests. */
export class RouteHealth {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.map = new Map(); // key -> { fails, openUntil }
  }
  isOpen(key) {
    const s = this.map.get(key);
    return !!s && s.openUntil > this.now();
  }
  /** Seconds until the breaker of `key` closes (0 when closed). */
  coolingMs(key) {
    const s = this.map.get(key);
    return s ? Math.max(0, s.openUntil - this.now()) : 0;
  }
  fail(key, threshold, cooldownMs) {
    const s = this.map.get(key) || { fails: 0, openUntil: 0 };
    s.fails++;
    if (s.fails >= threshold) {
      s.openUntil = this.now() + cooldownMs;
      s.fails = 0; // half-open afterwards: the next failure counts from zero but one more run is tried
    }
    this.map.set(key, s);
  }
  ok(key) {
    this.map.delete(key);
  }
  reset() {
    this.map.clear();
  }
}

/** Small counts-only success/failure statistics per target (no prompts, no content). Serializable. */
export class RouteStats {
  /** @param {object} [data] from toJSON() @param {()=>number} [now] */
  constructor(data = {}, now = () => Date.now()) {
    this.now = now;
    this.data = data && typeof data === "object" ? data : {}; // key -> { ok, fail, recent:[[t, 0|1, category]] }
  }
  record(key, ok, category) {
    const e = (this.data[key] ||= { ok: 0, fail: 0, recent: [] });
    if (ok) e.ok++;
    else e.fail++;
    e.recent.push([this.now(), ok ? 1 : 0, ok ? "" : category || "unknown"]);
    if (e.recent.length > 40) e.recent.splice(0, e.recent.length - 40);
  }
  summary(key) {
    const e = this.data[key];
    if (!e) return { ok: 0, fail: 0, total: 0, rate: null };
    const total = e.ok + e.fail;
    return { ok: e.ok, fail: e.fail, total, rate: total ? e.ok / total : null };
  }
  /** Failures of `key` in the last `windowMs` (default 24 h). */
  recentFailures(key, windowMs = 86400000) {
    const since = this.now() - windowMs;
    return (this.data[key]?.recent || []).filter((r) => r[0] >= since && r[1] === 0).length;
  }
  toJSON() {
    return this.data;
  }
}

/**
 * Suggests adding a fallback when the primary target failed repeatedly and the route has no alternative.
 * @returns {{key:string, failures:number, text:string}|null}
 */
export function suggestFallback(stats, route, { threshold = 3, windowMs = 86400000 } = {}) {
  const targets = (route?.targets || []).filter((t) => t.enabled !== false);
  if (targets.length !== 1) return null;
  const key = targetKey(targets[0]);
  const failures = stats.recentFailures(key, windowMs);
  if (failures < threshold) return null;
  return { key, failures, text: `Your model “${targetLabel(targets[0])}” failed ${failures} times today. Add a fallback model?` };
}

/**
 * Resolves the effective route from (already chat-merged) settings.
 * Old single `activeProvider`/`model` settings behave as a one-element route.
 * @param {{routes?:object[], activeRoute?:string|null, activeProvider?:string|null, model?:string}} s
 * @param {{useFallback?:boolean, primary?:{providerId:string|null, model:string}}} [o] `primary` = per-chat model override
 * @returns {{id:string|null, name:string, targets:{providerId:string|null, model:string, label?:string, enabled?:boolean, timeoutMs?:number}[], policy:object, chain:boolean}}
 */
export function resolveRoute(s, o = {}) {
  const single = { providerId: s.activeProvider || null, model: s.model || "" };
  const r = o.useFallback === false ? null : (s.routes || []).find((x) => x.id === s.activeRoute);
  let targets = r ? r.targets.filter((t) => t && t.enabled !== false && t.model) : [];
  if (r && o.primary?.model) targets = [{ ...o.primary }, ...targets.filter((t) => !(t.providerId === o.primary.providerId && t.model === o.primary.model))];
  if (!targets.length) targets = [o.primary?.model ? { ...o.primary } : single];
  return { id: r?.id ?? null, name: r?.name || "Single model", targets, policy: normalizePolicy(r?.policy || {}), chain: targets.length > 1 };
}

/** Rough token estimate of a request (chars / 4); images count 1000. */
export function estimateRequestTokens(request) {
  let chars = (request.system || "").length;
  let imgs = 0;
  for (const m of request.messages || []) {
    if (typeof m.content === "string") chars += m.content.length;
    else
      for (const b of toBlocks(m.content)) {
        if (b.type === "image") imgs++;
        else chars += JSON.stringify(b.type === "tool_result" ? b.content : b.type === "tool_use" ? b.input : b.text ?? "").length;
      }
  }
  for (const t of request.tools || []) chars += JSON.stringify(t).length;
  return Math.ceil(chars / 4) + imgs * 1000;
}
const hasImages = (request) => (request.messages || []).some((m) => toBlocks(m.content).some((b) => b.type === "image" || (b.type === "tool_result" && Array.isArray(b.content) && b.content.some((x) => x.type === "image"))));

const REASON_TEXT = {
  rate_limit: "a rate limit",
  overloaded: "an overloaded service",
  timeout: "a timeout",
  network: "a network error",
  context_length: "a context-length limit",
  model_unavailable: "an unavailable model",
  content_filter: "a content filter",
  auth: "an authentication error",
  invalid_request: "an invalid request",
  unknown: "an error",
};
/** Human-readable fallback notice, e.g. “Switched to Claude Haiku after a timeout.” */
export function fallbackNotice(toLabel, category) {
  return `Switched to ${toLabel} after ${REASON_TEXT[category] || REASON_TEXT.unknown}.`;
}

const CONTINUE_PROMPT = "Your previous reply was cut off by a connection problem. Continue exactly where it stopped. Do not repeat or summarize what you already wrote; do not add a greeting.";

/** Normalizes any thrown value into a ProviderError-like object with category flags. */
export function toRouteFailure(e) {
  if (e instanceof ProviderError) return e;
  const msg = String((e && e.message) || e);
  const c = classifyProviderError({ status: 0, code: /fetch|network|ECONN|ENOTFOUND|socket/i.test(msg) ? "network_error" : "error", message: msg });
  return new ProviderError(msg, { status: 0, code: "error", retryable: c.retryable, category: c.category, fallbackWorthy: c.fallbackWorthy });
}

/**
 * Creates the routed provider.
 * @param {object} o
 * @param {{providerId?:string, model:string, label?:string, provider:{stream:Function}, timeoutMs?:number, capabilities?:{tools?:boolean, vision?:boolean, contextWindow?:number}}[]} o.targets enabled targets, primary first
 * @param {object} [o.policy] see DEFAULT_POLICY
 * @param {RouteHealth} [o.health] shared breaker state
 * @param {RouteStats} [o.stats]
 * @param {(ev:object)=>void} [o.onEvent] also receives route events (in addition to the stream)
 * @param {{set:(fn:Function, ms:number)=>any, clear:(h:any)=>void}} [o.timers]
 * @param {(ms:number, signal?:AbortSignal)=>Promise<void>} [o.sleep]
 * @param {()=>number} [o.random]
 */
export function createRoutedProvider(o) {
  const targets = (o.targets || []).filter((t) => t && t.enabled !== false);
  if (!targets.length) throw new Error("A route needs at least one target.");
  const policy = normalizePolicy(o.policy);
  const health = o.health || new RouteHealth();
  const stats = o.stats;
  const timers = o.timers || { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h) };
  const sleep = o.sleep || defaultSleep;
  const random = o.random || Math.random;

  async function* stream(request, { signal } = {}) {
    request = { ...request };
    delete request.signal;
    const attempts = [];
    const skipped = [];
    const state = { text: "" }; // text already delivered to the consumer
    let minContext = 0; // targets with a known window <= this failed with context_length
    const need = { tools: !!(request.tools && request.tools.length) && request.toolChoice !== "none", vision: hasImages(request) };
    const estimate = estimateRequestTokens(request);
    const note = (t, why) => skipped.push({ target: targetLabel(t), key: targetKey(t), skipped: why });
    let usable = targets.filter((t) => {
      const c = t.capabilities || {};
      if (need.tools && c.tools === false) return note(t, "model has no tool support"), false;
      if (need.vision && c.vision === false) return note(t, "model cannot read images"), false;
      if (c.contextWindow && estimate > c.contextWindow * 0.95) return note(t, "request exceeds its context window"), false;
      return true;
    });
    if (!usable.length) throw new RouteError(`No target in the route can handle this request (${skipped.map((s) => `${s.target}: ${s.skipped}`).join("; ")}).`, { attempts: skipped, category: "invalid_request" });
    const allOpen = usable.every((t) => health.isOpen(targetKey(t)));

    for (let ti = 0; ti < usable.length; ti++) {
      const target = usable[ti];
      const key = targetKey(target);
      const c = target.capabilities || {};
      if (minContext && c.contextWindow && c.contextWindow <= minContext) {
        attempts.push({ target: targetLabel(target), key, skipped: "context window not larger" });
        continue;
      }
      if (!allOpen && health.isOpen(key)) {
        attempts.push({ target: targetLabel(target), key, skipped: `cooling down for ${Math.ceil(health.coolingMs(key) / 1000)} s` });
        continue;
      }
      let failure = null;
      for (let retry = 0; retry <= policy.retriesPerTarget; retry++) {
        if (signal?.aborted) throw abortError(signal);
        failure = null;
        const t0 = Date.now();
        const prefix = state.text;
        const req = prefix ? { ...request, model: target.model, messages: [...request.messages, { role: "assistant", content: prefix }, { role: "user", content: CONTINUE_PROMPT }] } : { ...request, model: target.model };
        try {
          yield* attempt(target, req, prefix, state, signal);
          health.ok(key);
          stats?.record(key, true);
          return;
        } catch (e) {
          if (isAbortError(e) || signal?.aborted) throw isAbortError(e) ? e : abortError(signal);
          failure = toRouteFailure(e);
        }
        const rec = { target: targetLabel(target), key, category: failure.category, status: failure.status, message: String(failure.message).slice(0, 300), ms: Date.now() - t0, retry };
        attempts.push(rec);
        stats?.record(key, false, failure.category);
        const fallbackOk = failure.fallbackWorthy || (failure.category === "auth" && policy.fallbackOnAuth);
        if (!fallbackOk) {
          failure.routeAttempts = attempts;
          throw failure;
        }
        const longWait = failure.retryAfterMs != null && failure.retryAfterMs > policy.maxRetryAfterMs;
        if (failure.retryable && !longWait && retry < policy.retriesPerTarget) {
          const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** retry);
          const delay = Math.max(failure.retryAfterMs ?? 0, Math.round(backoff * (0.5 + random() * 0.5)));
          yield routeEvent(o, { type: "route_retry", target: targetLabel(target), attempt: retry + 1, delayMs: delay, reason: rec.message, category: failure.category });
          await sleep(delay, signal);
          continue;
        }
        break;
      }
      // this target is done for this request
      if (failure.category !== "context_length" && failure.category !== "content_filter") health.fail(key, policy.breakerThreshold, policy.breakerCooldownMs);
      if (failure.category === "context_length") minContext = Math.max(minContext, c.contextWindow || 0);
      const next = usable.slice(ti + 1).find((t) => !(minContext && t.capabilities?.contextWindow && t.capabilities.contextWindow <= minContext));
      if (next) yield routeEvent(o, { type: "route_fallback", from: targetLabel(target), to: targetLabel(next), reason: String(failure.message).slice(0, 200), category: failure.category, text: fallbackNotice(targetLabel(next), failure.category) });
    }
    const last = attempts.filter((a) => a.category).pop();
    const tried = attempts.filter((a) => a.category);
    const lines = [...tried.map((a) => `${a.target}: ${a.category}${a.status ? ` (HTTP ${a.status})` : ""} – ${a.message}`), ...attempts.filter((a) => a.skipped).map((a) => `${a.target}: skipped – ${a.skipped}`), ...skipped.map((a) => `${a.target}: skipped – ${a.skipped}`)];
    throw new RouteError(`All ${targets.length} model${targets.length === 1 ? "" : "s"} in the route failed.\n${lines.join("\n")}`, { attempts: [...attempts, ...skipped], category: last?.category || "unknown", status: last?.status });
  }

  /** One attempt: streams events, buffering tool calls; enforces first-token and attempt timeouts. */
  async function* attempt(target, req, prefix, state, outer) {
    const ctl = new AbortController();
    const first = target.timeoutMs ?? policy.firstTokenTimeoutMs;
    let firstTimer = null;
    let totalTimer = null;
    let timeoutErr = null;
    const trip = (code, msg) => {
      timeoutErr = new ProviderError(msg, { status: 0, code, retryable: true, category: "timeout", fallbackWorthy: true, provider: target.providerId });
      ctl.abort(timeoutErr);
    };
    if (first > 0) firstTimer = timers.set(() => trip("first_token_timeout", `No response from ${targetLabel(target)} within ${Math.round(first / 1000)} s.`), first);
    if (policy.attemptTimeoutMs > 0) totalTimer = timers.set(() => trip("attempt_timeout", `${targetLabel(target)} did not finish within ${Math.round(policy.attemptTimeoutMs / 1000)} s.`), policy.attemptTimeoutMs);
    const buffered = [];
    let pendingDone = null;
    let got = false;
    let merged = null;
    try {
      merged = combineSignals([outer, ctl.signal]);
      const it = target.provider.stream(req, { signal: merged.signal })[Symbol.asyncIterator]();
      let finished = false;
      while (!finished) {
        const step = await raceAbort(it.next(), ctl.signal, () => timeoutErr);
        if (step.done) break;
        const ev = step.value;
        if (ev.type === "text" || ev.type === "thinking" || ev.type === "tool_call") {
          if (firstTimer != null) {
            timers.clear(firstTimer);
            firstTimer = null;
          }
        }
        if (ev.type === "tool_call") buffered.push(ev);
        else if (ev.type === "done") pendingDone = ev;
        else {
          if (ev.type === "text") {
            state.text += ev.delta;
            got = true;
          }
          yield ev;
        }
      }
      if (!pendingDone && !buffered.length && !got) throw new ProviderError(`${targetLabel(target)} returned an empty response.`, { status: 0, code: "empty_response", retryable: true, category: "network", fallbackWorthy: true });
      for (const b of buffered) yield b;
      if (pendingDone) {
        if (prefix && pendingDone.message) {
          const content = toBlocks(pendingDone.message.content).slice();
          const i = content.findIndex((b) => b.type === "text");
          if (i >= 0) content[i] = { ...content[i], text: prefix + content[i].text };
          else content.unshift({ type: "text", text: prefix });
          pendingDone = { ...pendingDone, message: { ...pendingDone.message, content } };
        }
        yield pendingDone;
      }
    } catch (e) {
      if (timeoutErr) throw timeoutErr;
      throw e;
    } finally {
      if (firstTimer != null) timers.clear(firstTimer);
      if (totalTimer != null) timers.clear(totalTimer);
      merged?.dispose();
      if (!ctl.signal.aborted) ctl.abort();
    }
  }
  return {
    name: "route",
    kind: "route",
    baseUrl: "route://",
    capabilities: { embeddings: false, images: false },
    targets,
    health,
    policy,
    async listModels() {
      return targets.map((t) => ({ id: t.model, name: targetLabel(t) }));
    },
    stream,
  };
}

function routeEvent(o, ev) {
  try {
    o.onEvent?.(ev);
  } catch {
    /* observers never break routing */
  }
  return ev;
}

/** Rejects when `signal` aborts (with the timeout error when there is one), otherwise resolves with `p`. */
function raceAbort(p, signal, getErr) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(getErr() || abortError(signal));
    const h = () => reject(getErr() || abortError(signal));
    signal.addEventListener("abort", h, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", h);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", h);
        reject(e);
      },
    );
  });
}

/**
 * "Test route": sends a tiny request to every target separately (no fallback) and reports the outcome.
 * @returns {Promise<{target:string, key:string, ok:boolean, ms:number, category?:string, message?:string}[]>}
 */
export async function testRoute(targets, { signal, timeoutMs = 20000, timers } = {}) {
  const tm = timers || { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h) };
  const out = [];
  for (const t of targets) {
    const t0 = Date.now();
    const ctl = new AbortController();
    const comb = combineSignals([signal, ctl.signal]);
    const h = tm.set(() => ctl.abort(new ProviderError("Timed out", { code: "timeout", retryable: true, category: "timeout" })), timeoutMs);
    try {
      let got = false;
      const it = t.provider.stream({ model: t.model, messages: [{ role: "user", content: "Reply with the single word OK." }], maxTokens: 16 }, { signal: comb.signal })[Symbol.asyncIterator]();
      while (true) {
        const s = await raceAbort(it.next(), comb.signal, () => new ProviderError(`No answer within ${Math.round(timeoutMs / 1000)} s.`, { code: "timeout", retryable: true, category: "timeout" }));
        if (s.done) break;
        if (s.value.type === "text") got = true;
      }
      out.push({ target: targetLabel(t), key: targetKey(t), ok: got || true, ms: Date.now() - t0 });
    } catch (e) {
      if (signal?.aborted) throw abortError(signal);
      const f = toRouteFailure(e);
      out.push({ target: targetLabel(t), key: targetKey(t), ok: false, ms: Date.now() - t0, category: f.category, message: String(f.message).slice(0, 200) });
    } finally {
      tm.clear(h);
      comb.dispose();
      ctl.abort();
    }
  }
  return out;
}
