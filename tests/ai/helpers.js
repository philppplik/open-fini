// Test helpers for the AI runtime: fake fetch, SSE bodies, event collection.

const enc = new TextEncoder();

/** Builds a Response whose body is delivered in the given string/byte chunks. */
export function streamResponse(chunks, { status = 200, headers = { "content-type": "text/event-stream" } } = {}) {
  let i = 0;
  const body = new ReadableStream({
    pull(ctrl) {
      if (i >= chunks.length) return ctrl.close();
      const c = chunks[i++];
      ctrl.enqueue(typeof c === "string" ? enc.encode(c) : c);
    },
  });
  return new Response(body, { status, headers });
}

/** Splits bytes at one offset into two chunks. */
export function splitAt(text, n) {
  const b = enc.encode(text);
  return [b.slice(0, n), b.slice(n)];
}

export function jsonResponse(obj, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Creates a fake fetch from a handler; records calls. */
export function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const call = { url: String(url), init, method: init.method || "GET", headers: init.headers || {}, body: typeof init.body === "string" ? init.body : undefined };
    if (call.body) {
      try {
        call.json = JSON.parse(call.body);
      } catch {
        /* not json */
      }
    }
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  fn.calls = calls;
  return fn;
}

export async function collect(iter) {
  const out = [];
  for await (const e of iter) out.push(e);
  return out;
}

/** Formats OpenAI SSE data lines. */
export const oa = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
export const chunk = (delta, finish = null, extra = {}) => oa({ id: "x", choices: [{ index: 0, delta, finish_reason: finish }], ...extra });

/** Anthropic SSE event. */
export const an = (type, obj) => `event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`;

/** Scripted provider: each call to stream() runs the next generator. */
export function scriptedProvider(scripts) {
  let n = 0;
  const requests = [];
  return {
    requests,
    name: "scripted",
    async *stream(req, o) {
      requests.push(JSON.parse(JSON.stringify(req)));
      const s = scripts[Math.min(n++, scripts.length - 1)];
      yield* s(req, o);
    },
  };
}

export const textTurn = (text) =>
  async function* () {
    yield { type: "text", delta: text };
    yield { type: "done", stopReason: "end", message: { role: "assistant", content: [{ type: "text", text }] } };
  };

export const toolTurn = (calls, text = "") =>
  async function* () {
    if (text) yield { type: "text", delta: text };
    const content = [];
    if (text) content.push({ type: "text", text });
    for (const c of calls) {
      yield { type: "tool_call", ...c };
      content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
    }
    yield { type: "done", stopReason: "tool_use", message: { role: "assistant", content } };
  };
