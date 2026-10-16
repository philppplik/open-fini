// Agent loop: streams the model, executes tool calls, validates input, handles approval, retries, aborts.
// Pure: talks to a provider object only (see providers/*), never to the DOM or network directly.

import { abortError, isAbortError, makeId, sleep as defaultSleep, toBlocks } from "./util.js";

/**
 * @typedef {object} ToolDef
 * @property {string} name
 * @property {string} description
 * @property {object} inputSchema JSON Schema (object)
 * @property {(input:any, ctx:{id:string,name:string,signal?:AbortSignal,step:number,report:(text:string)=>void})=>any} run
 *   returns string | object (JSON-stringified) | Block[]
 * @property {(input:any)=>boolean|string} [needsApproval] truthy asks the user first; a string is shown as the reason
 * @property {boolean} [readOnly] read-only tools of one step run in parallel
 */

// ------------------------------------------------------------------ JSON Schema (compact)

const typeName = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);

function typeMatches(v, t) {
  switch (t) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "null":
      return v === null;
    case "array":
      return Array.isArray(v);
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v);
    default:
      return true;
  }
}

const show = (v) => {
  let s;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return s && s.length > 60 ? s.slice(0, 57) + "..." : s;
};

/**
 * Validates a value against a compact subset of JSON Schema: type, enum, const, required, properties,
 * additionalProperties, items, minItems/maxItems, minimum/maximum (+exclusive), minLength/maxLength, pattern,
 * oneOf/anyOf/allOf, nullable. Unknown keywords are ignored.
 * @param {any} value
 * @param {object} schema
 * @param {string} [path]
 * @returns {string[]} human-readable problems (empty when valid)
 */
export function validateSchema(value, schema, path = "input") {
  const errs = [];
  if (!schema || typeof schema !== "object" || schema === true) return errs;
  if (schema.nullable && value === null) return errs;
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errs.push(`${path} must be ${types.join(" or ")} (got ${typeName(value)})`);
      return errs;
    }
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errs.push(`${path} must be one of ${schema.enum.map(show).join(", ")} (got ${show(value)})`);
  }
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errs.push(`${path} must equal ${show(schema.const)}`);
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) errs.push(`${path} must be >= ${schema.minimum} (got ${value})`);
    if (schema.maximum != null && value > schema.maximum) errs.push(`${path} must be <= ${schema.maximum} (got ${value})`);
    if (schema.exclusiveMinimum != null && typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) errs.push(`${path} must be > ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum != null && typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) errs.push(`${path} must be < ${schema.exclusiveMaximum}`);
    if (schema.multipleOf && value % schema.multipleOf !== 0) errs.push(`${path} must be a multiple of ${schema.multipleOf}`);
  }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) errs.push(`${path} must have at least ${schema.minLength} characters`);
    if (schema.maxLength != null && value.length > schema.maxLength) errs.push(`${path} must have at most ${schema.maxLength} characters`);
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern, "u").test(value)) errs.push(`${path} must match pattern ${schema.pattern}`);
      } catch {
        /* ignore bad pattern */
      }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errs.push(`${path} must have at least ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errs.push(`${path} must have at most ${schema.maxItems} items`);
    if (Array.isArray(schema.items)) schema.items.forEach((s, i) => i < value.length && errs.push(...validateSchema(value[i], s, `${path}[${i}]`)));
    else if (schema.items) value.forEach((v, i) => errs.push(...validateSchema(v, schema.items, `${path}[${i}]`)));
  }
  if (typeMatches(value, "object") && (schema.properties || schema.required || schema.additionalProperties !== undefined)) {
    for (const k of schema.required || []) if (!(k in value) || value[k] === undefined) errs.push(`${path}.${k} is required`);
    const props = schema.properties || {};
    for (const k of Object.keys(value)) {
      if (value[k] === undefined) continue;
      if (k in props) errs.push(...validateSchema(value[k], props[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k} is not an allowed property`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errs.push(...validateSchema(value[k], schema.additionalProperties, `${path}.${k}`));
    }
  }
  if (Array.isArray(schema.allOf)) for (const s of schema.allOf) errs.push(...validateSchema(value, s, path));
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((s) => validateSchema(value, s, path).length === 0)) errs.push(`${path} does not match any of the allowed shapes (anyOf)`);
  if (Array.isArray(schema.oneOf)) {
    const n = schema.oneOf.filter((s) => validateSchema(value, s, path).length === 0).length;
    if (n !== 1) errs.push(`${path} must match exactly one of the allowed shapes (oneOf), matched ${n}`);
  }
  return errs;
}

// ------------------------------------------------------------------ sizes, truncation, compaction

const IMAGE_CHARS = 6000; // ~1.5k tokens per image

function blockChars(b) {
  if (!b) return 0;
  switch (b.type) {
    case "text":
      return (b.text || "").length;
    case "thinking":
      return (b.text || "").length;
    case "image":
      return IMAGE_CHARS;
    case "tool_use":
      return (b.name || "").length + JSON.stringify(b.input ?? {}).length;
    case "tool_result":
      return typeof b.content === "string" ? b.content.length : toBlocks(b.content).reduce((n, x) => n + blockChars(x), 0);
    default:
      return 0;
  }
}

function messageChars(m) {
  return typeof m.content === "string" ? m.content.length : toBlocks(m.content).reduce((n, b) => n + blockChars(b), 0);
}

/**
 * Rough token estimate (characters / 4; images count as ~1.5k tokens).
 * @param {{role:string,content:any}[]} messages
 * @returns {number}
 */
export function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages || []) chars += messageChars(m) + 4;
  return Math.ceil(chars / 4);
}

/**
 * Shortens text to `max` characters keeping the head and the tail, with a marker in between.
 * @param {string} text
 * @param {number} max
 */
export function truncateText(text, max) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = Math.max(0, max - head);
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[... ${omitted} characters omitted ...]\n\n${tail ? text.slice(text.length - tail) : ""}`;
}

/**
 * Returns a copy of the transcript that fits `maxChars`: old image blocks and old tool results are
 * replaced by short markers (oldest first); if still too large, old long text is shortened.
 * The last `keepRecent` messages are never touched. The input is not mutated.
 * @param {{role:string,content:any}[]} messages
 * @param {{maxChars?:number, keepRecent?:number}} [opts]
 */
export function compactMessages(messages, { maxChars = 200000, keepRecent = 6 } = {}) {
  const total = (arr) => arr.reduce((n, m) => n + messageChars(m), 0);
  if (total(messages) <= maxChars) return messages;
  const out = messages.map((m) => (typeof m.content === "string" ? m : { ...m, content: m.content.map((b) => ({ ...b })) }));
  const limit = Math.max(0, out.length - keepRecent);
  let size = total(out);
  const edit = (fn) => {
    for (let i = 0; i < limit && size > maxChars; i++) {
      const m = out[i];
      if (typeof m.content === "string") {
        const r = fn(m, null);
        if (r) {
          const before = m.content.length;
          m.content = r;
          size += m.content.length - before;
        }
        continue;
      }
      for (let k = 0; k < m.content.length && size > maxChars; k++) {
        const b = m.content[k];
        const before = blockChars(b);
        const nb = fn(m, b);
        if (nb) {
          m.content[k] = nb;
          size += blockChars(nb) - before;
        }
      }
    }
  };
  // 1) images in old messages and in old tool results
  edit((m, b) => {
    if (!b) return null;
    if (b.type === "image") return { type: "text", text: "[image omitted]" };
    if (b.type === "tool_result" && Array.isArray(b.content) && b.content.some((x) => x.type === "image")) {
      return { ...b, content: b.content.map((x) => (x.type === "image" ? { type: "text", text: "[image omitted]" } : x)) };
    }
    return null;
  });
  // 2) old tool results
  edit((m, b) => (b && b.type === "tool_result" && blockChars(b) > 40 ? { ...b, content: "[result omitted]" } : null));
  // 3) old long text and tool inputs
  edit((m, b) => {
    if (!b) return m.content.length > 1500 ? truncateText(m.content, 1500) : null;
    if (b.type === "text" && b.text.length > 1500) return { ...b, text: truncateText(b.text, 1500) };
    if (b.type === "tool_use" && blockChars(b) > 1500) return { ...b, input: { _omitted: "[input omitted]" } };
    return null;
  });
  return out;
}

// ------------------------------------------------------------------ the loop

function normalizeResult(result, max) {
  if (typeof result === "string") return truncateText(result, max);
  if (result === undefined || result === null) return "OK";
  if (Array.isArray(result) && result.length && result.every((b) => b && (b.type === "text" || b.type === "image"))) {
    return result.map((b) => (b.type === "text" ? { ...b, text: truncateText(b.text ?? "", max) } : b));
  }
  let s;
  try {
    s = typeof result === "object" ? JSON.stringify(result) : String(result);
  } catch {
    s = String(result);
  }
  return truncateText(s ?? "OK", max);
}

function schemaHint(schema) {
  let s;
  try {
    s = JSON.stringify(schema);
  } catch {
    return "";
  }
  return s.length > 700 ? s.slice(0, 700) + "..." : s;
}

/**
 * Runs the agent loop until the model stops calling tools, the step limit is hit, the run is aborted, or an
 * unrecoverable provider error occurs.
 *
 * Events (via onEvent): step, text, thinking, tool_start, tool_end, usage, retry, done.
 * `approve({id,name,input,reason})` is awaited when a tool's `needsApproval(input)` is truthy; without an
 * `approve` callback such tools are declined.
 *
 * @param {object} o
 * @param {{stream:Function}} o.provider
 * @param {string} o.model
 * @param {string} [o.system]
 * @param {{role:string,content:any}[]} o.messages existing transcript (not mutated)
 * @param {ToolDef[]} [o.tools]
 * @param {number} [o.maxSteps=24]
 * @param {number} [o.maxTokens]
 * @param {number} [o.temperature]
 * @param {{effort:'low'|'medium'|'high'}} [o.reasoning]
 * @param {AbortSignal} [o.signal]
 * @param {(e:object)=>void} [o.onEvent]
 * @param {(req:{id:string,name:string,input:any,reason:string})=>Promise<boolean>|boolean} [o.approve]
 * @param {number} [o.retries=2] retries per model call for retryable ProviderErrors
 * @param {number} [o.contextBudget] estimated tokens; older results are compacted above it
 * @param {number} [o.maxResultChars=60000] tool result size limit
 * @param {(ms:number, signal?:AbortSignal)=>Promise<void>} [o.sleep] injectable for tests
 * @param {object} [o.toolContext] extra fields merged into every tool `ctx`
 * @param {string|{name:string}} [o.toolChoice]
 * @returns {Promise<{messages:object[], stopReason:'end'|'max_steps'|'aborted'|'error', usage:{input:number,output:number,cachedInput?:number}, steps:number, error?:string}>}
 */
export async function runAgent(o) {
  const {
    provider,
    model,
    system,
    tools = [],
    maxSteps = 24,
    maxTokens,
    temperature,
    reasoning,
    signal,
    onEvent,
    approve,
    retries = 2,
    contextBudget,
    maxResultChars = 60000,
    toolChoice,
    toolContext,
  } = o;
  const sleepFn = o.sleep || defaultSleep;
  const emit = (e) => {
    try {
      const r = onEvent && onEvent(e);
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {
      /* UI callbacks must never break the loop */
    }
  };
  const history = [...(o.messages || [])];
  const added = [];
  const usage = { input: 0, output: 0 };
  let cachedTotal = 0;
  let steps = 0;
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const specs = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema || { type: "object", properties: {} } }));
  let lastFail = { sig: "", count: 0 };

  const push = (m) => {
    history.push(m);
    added.push(m);
  };
  const aborted = () => !!(signal && signal.aborted);
  const abortRace = (p) => {
    if (!signal) return p;
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError(signal));
      const h = () => reject(abortError(signal));
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
  };
  const result = (stopReason, extra = {}) => {
    const u = { ...usage };
    if (cachedTotal) u.cachedInput = cachedTotal;
    const r = { messages: added, stopReason, usage: u, steps, ...extra };
    emit({ type: "done", stopReason, usage: u, steps, ...(extra.error ? { error: extra.error } : {}) });
    return r;
  };

  async function consume(request) {
    let text = "";
    let thinking = "";
    let message = null;
    let stopReason = "end";
    const callErrors = new Map();
    const calls = [];
    for await (const ev of provider.stream(request, { signal })) {
      if (aborted()) throw abortError(signal);
      switch (ev.type) {
        case "text":
          text += ev.delta;
          emit({ type: "text", delta: ev.delta });
          break;
        case "thinking":
          thinking += ev.delta;
          emit({ type: "thinking", delta: ev.delta });
          break;
        case "tool_call":
          calls.push(ev);
          if (ev.error) callErrors.set(ev.id, ev);
          break;
        case "usage": {
          usage.input += ev.input || 0;
          usage.output += ev.output || 0;
          cachedTotal += ev.cachedInput || 0;
          emit({ type: "usage", input: ev.input || 0, output: ev.output || 0, ...(ev.cachedInput != null ? { cachedInput: ev.cachedInput } : {}), total: { ...usage } });
          break;
        }
        case "done":
          message = ev.message;
          stopReason = ev.stopReason || "end";
          break;
        default:
          break;
      }
    }
    if (!message) {
      const content = [];
      if (thinking) content.push({ type: "thinking", text: thinking });
      if (text) content.push({ type: "text", text });
      for (const c of calls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input || {} });
      message = { role: "assistant", content };
      if (calls.length) stopReason = "tool_use";
    }
    return { message, stopReason, callErrors };
  }

  async function callModel(view) {
    const request = { model, system, messages: view, tools: specs.length ? specs : undefined, maxTokens, temperature, reasoning, toolChoice };
    for (let attempt = 0; ; attempt++) {
      try {
        return await consume(request);
      } catch (e) {
        if (isAbortError(e) || aborted()) throw abortError(signal);
        if (e && e.retryable && attempt < retries) {
          const delay = e.retryAfterMs != null ? Math.min(e.retryAfterMs, 60000) : Math.min(30000, 1000 * 2 ** attempt);
          emit({ type: "retry", attempt: attempt + 1, error: String(e.message || e), status: e.status, delayMs: delay });
          await sleepFn(delay, signal);
          if (aborted()) throw abortError(signal);
          continue;
        }
        throw e;
      }
    }
  }

  async function execOne(call, stepNo, maxTokensStop, callErr) {
    const { id, name } = call;
    const input = call.input && typeof call.input === "object" ? call.input : {};
    const tool = toolMap.get(name);
    const t0 = Date.now();
    emit({ type: "tool_start", id, name, input });
    let content;
    let isError = false;
    const fail = (msg) => {
      content = msg;
      isError = true;
    };
    if (!tool) {
      fail(`Unknown tool "${name}". Available tools: ${[...toolMap.keys()].join(", ") || "(none)"}. Do not invent tools.`);
    } else if (callErr) {
      fail(
        `The arguments for "${name}" could not be parsed as JSON${maxTokensStop ? " because the response was cut off (max tokens reached)" : ""}. Send the call again with complete, valid JSON arguments${maxTokensStop ? " and keep the content shorter or split it into several calls" : ""}.`,
      );
    } else {
      const problems = validateSchema(input, tool.inputSchema, "input");
      if (problems.length) {
        fail(`Invalid input for "${name}": ${problems.slice(0, 8).join("; ")}. Expected schema: ${schemaHint(tool.inputSchema)}`);
      } else {
        try {
          let reason = tool.needsApproval ? tool.needsApproval(input) : false;
          if (reason) {
            if (typeof reason !== "string") reason = `Run ${name}`;
            const ok = approve ? await abortRace(Promise.resolve(approve({ id, name, input, reason }))) : false;
            if (!ok) fail("The user declined this action.");
          }
          if (!isError) {
            const ctx = { ...(toolContext || {}), id, name, signal, step: stepNo, report: (text) => emit({ type: "tool_progress", id, name, text: String(text) }) };
            const r = await abortRace(Promise.resolve().then(() => tool.run(input, ctx)));
            content = normalizeResult(r, maxResultChars);
          }
        } catch (e) {
          if (isAbortError(e) || aborted()) fail("Aborted by the user.");
          else fail(`Error: ${e && e.message ? e.message : String(e)}`);
        }
      }
    }
    // loop guard
    const sig = isError ? name + "\u0000" + JSON.stringify(input) : "";
    if (isError && !aborted()) {
      lastFail = lastFail.sig === sig ? { sig, count: lastFail.count + 1 } : { sig, count: 1 };
      if (lastFail.count >= 3) {
        const hint = `\n\nHint: this identical call has failed ${lastFail.count} times in a row. Stop repeating it. Change the arguments or your approach, or ask the user for help.`;
        if (typeof content === "string") content += hint;
        else content = [...content, { type: "text", text: hint }];
      }
    } else if (!isError) lastFail = { sig: "", count: 0 };
    emit({ type: "tool_end", id, name, result: content, isError, ms: Date.now() - t0 });
    return { type: "tool_result", toolUseId: id, content, ...(isError ? { isError: true } : {}) };
  }

  async function runTools(calls, stepNo, stopReason, callErrors) {
    const out = new Array(calls.length);
    let i = 0;
    while (i < calls.length) {
      if (aborted()) {
        for (; i < calls.length; i++) out[i] = { type: "tool_result", toolUseId: calls[i].id, content: "Aborted by the user.", isError: true };
        break;
      }
      const ro = (c) => !!(toolMap.get(c.name) && toolMap.get(c.name).readOnly);
      if (ro(calls[i])) {
        let j = i;
        while (j < calls.length && ro(calls[j])) j++;
        const base = i;
        await Promise.all(calls.slice(i, j).map(async (c, k) => void (out[base + k] = await execOne(c, stepNo, stopReason === "max_tokens", callErrors.get(c.id)))));
        i = j;
      } else {
        out[i] = await execOne(calls[i], stepNo, stopReason === "max_tokens", callErrors.get(calls[i].id));
        i++;
      }
    }
    return out;
  }

  // ---- main loop
  while (steps < maxSteps) {
    if (aborted()) return result("aborted");
    steps++;
    emit({ type: "step", n: steps });
    let view = history;
    if (contextBudget && estimateTokens(view) > contextBudget) view = compactMessages(view, { maxChars: contextBudget * 4 });
    let res;
    try {
      res = await callModel(view);
    } catch (e) {
      if (isAbortError(e) || aborted()) return result("aborted");
      return result("error", { error: String((e && e.message) || e), errorInfo: e && { code: e.code, status: e.status } });
    }
    const { message, stopReason, callErrors } = res;
    const content = toBlocks(message.content).slice();
    // make tool ids unique and non-empty
    const seen = new Set();
    for (const b of content) {
      if (b.type !== "tool_use") continue;
      if (!b.id || seen.has(b.id)) {
        const old = b.id;
        b.id = makeId("call");
        if (old && callErrors.has(old)) callErrors.set(b.id, callErrors.get(old));
      }
      seen.add(b.id);
    }
    const calls = content.filter((b) => b.type === "tool_use");
    if (content.length) push({ role: "assistant", content });
    if (stopReason === "error" && !calls.length) return result("error", { error: "The model stopped with an error." });
    if (!calls.length) return result("end", stopReason === "max_tokens" ? { truncated: true } : {});
    const results = await runTools(calls, steps, stopReason, callErrors);
    push({ role: "user", content: results });
    if (aborted()) return result("aborted");
  }
  return result("max_steps");
}
