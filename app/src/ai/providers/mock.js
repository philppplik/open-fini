// Deterministic offline "Demo" provider. Same interface as the real providers; needs no network and no key.
// Default behavior: keyword-driven scripted replies that emit text deltas and tool calls.

import { bytesToBase64, makeId, throwIfAborted, sleep, textOf, toBlocks, ProviderError, errorFromBody, abortError } from "../util.js";

const COLORS = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  violet: "#8b5cf6",
  pink: "#ec4899",
  black: "#111827",
  white: "#ffffff",
  gray: "#9ca3af",
  grey: "#9ca3af",
};

function pickColor(text, fallback) {
  const hex = /#[0-9a-f]{6}\b/i.exec(text);
  if (hex) return hex[0].toLowerCase();
  const w = /\b(red|orange|yellow|green|teal|blue|purple|violet|pink|black|white|gray|grey)\b/i.exec(text);
  return w ? COLORS[w[1].toLowerCase()] : fallback;
}

function quoted(text) {
  const m = /"([^"]{1,120})"|“([^”]{1,120})”|'([^']{1,120})'/.exec(text);
  return m ? m[1] || m[2] || m[3] : null;
}

/** Index of the last user message that carries real text (not only tool results). */
function lastPromptIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string" ? m.content.trim() : toBlocks(m.content).some((b) => b.type === "text" && b.text.trim())) return i;
  }
  return -1;
}

/** Recursively collects `id` values from parsed tool results (shapes, layers, documents ...). */
function collectIds(v, out, depth = 0) {
  if (!v || typeof v !== "object" || depth > 6 || out.length > 200) return;
  if (Array.isArray(v)) {
    for (const x of v) collectIds(x, out, depth + 1);
    return;
  }
  if ((typeof v.id === "string" || typeof v.id === "number") && v.id !== "") out.push(String(v.id));
  if (Array.isArray(v.ids)) for (const x of v.ids) if (typeof x === "string" || typeof x === "number") out.push(String(x));
  for (const k of Object.keys(v)) if (k !== "id" && k !== "ids") collectIds(v[k], out, depth + 1);
}

/**
 * Reads ids returned by earlier tool results (JSON text in tool_result blocks) after message index `from`.
 * @param {{role:string,content:any}[]} messages
 * @param {number} from
 * @returns {{ids:string[], lastId?:string, firstId?:string}}
 */
export function idsFromResults(messages, from) {
  const ids = [];
  const called = new Set();
  for (let i = Math.max(0, from); i < messages.length; i++) {
    for (const b of toBlocks(messages[i].content)) {
      if (b.type === "tool_use") called.add(b.name);
      if (b.type !== "tool_result" || b.isError) continue;
      const t = typeof b.content === "string" ? b.content : textOf(b.content);
      try {
        collectIds(JSON.parse(t), ids);
      } catch {
        /* plain text result */
      }
    }
  }
  return { ids, lastId: ids[ids.length - 1], firstId: ids[0], called };
}

/**
 * Builds the scripted plan for a prompt: a list of steps, each with optional text and tool calls.
 * Step arguments may depend on ids returned by earlier steps (`ctx`).
 * @param {string} prompt
 * @param {{ids:string[], lastId?:string, firstId?:string}} [ctx]
 * @returns {{text:string, calls:{name:string,input:object}[]}[]}
 */
export function planForPrompt(prompt, ctx = { ids: [], called: new Set() }) {
  // "Use the “name” skill [with args {...}]. rest" loads the skill first, then continues with the rest
  const sk = /use the [“"]?([a-z0-9-]+)[”"]? skill(?: with args (\{[^\n]*?\}))?\.?\s*/i.exec(prompt);
  if (sk) {
    let args;
    try {
      args = sk[2] ? JSON.parse(sk[2]) : undefined;
    } catch {
      args = undefined;
    }
    const rest = prompt.replace(sk[0], " ").trim();
    const after = rest ? planForPrompt(rest, ctx) : [];
    return [{ text: `Loading the ${sk[1]} skill.`, calls: [{ name: "use_skill", input: { name: sk[1], ...(args ? { args } : {}) } }] }, ...after];
  }
  return planForPromptBase(prompt, ctx);
}

function planForPromptBase(prompt, ctx) {
  const p = prompt.toLowerCase();
  const color0 = pickColor(prompt, "#4f46e5");
  // sub-agents: "build a brand kit with three agents"
  if (/\bagents?\b/.test(p) && /\b(brand ?kit|three|3|parallel)\b/.test(p)) {
    return [
      { text: "I will set up a canvas and split the brand kit into three parallel agents.", calls: [{ name: "new_document", input: { name: "Brand kit", width: 1200, height: 800 } }] },
      {
        text: "Starting the agents.",
        calls: [
          { name: "spawn_agent", input: { role: "palette", task: `Draw a ${/#[0-9a-f]{6}/i.test(prompt) ? color0 : "blue"} rectangle at the left as the primary color swatch.`, tools: ["design"] } },
          { name: "spawn_agent", input: { role: "mark", task: "Draw an orange circle as the brand mark.", tools: ["design"] } },
          { name: "spawn_agent", input: { role: "type", task: 'Add a headline text "Brand Kit".', tools: ["design"] } },
        ],
      },
      { text: "Waiting for the agents to finish.", calls: [{ name: "wait_agent", input: {} }] },
      { text: "Let me check the combined result.", calls: [{ name: "screenshot", input: {} }] },
    ];
  }
  // power tools: "run a batch plan" / "query the rectangles and recolor them"
  if (/\bbatch\b|\brun_plan\b|\brun a plan\b/.test(p)) {
    return [
      {
        text: "Doing it in one batch.",
        calls: [{
          name: "run_plan",
          input: {
            label: "Batch demo",
            steps: [
              { id: "doc", tool: "new_document", args: { name: "Batch demo", width: 800, height: 600 } },
              { id: "bg", tool: "add_shape", args: { type: "rect", x: 0, y: 0, w: 800, h: 600, fill: color0, name: "Background" } },
              { id: "card", tool: "add_shape", args: { type: "rect", x: 200, y: 150, w: 400, h: 300, fill: "#ffffff", radius: 24, name: "Card" } },
              { id: "title", tool: "add_text", args: { text: "Made in one turn", x: 240, y: 270, fontSize: 40, color: "#111827" } },
              { tool: "set_style", args: { ids: [{ $ref: "card.id" }], stroke: "#111827", strokeWidth: 2 } },
            ],
          },
        }],
      },
      { text: "Checking it.", calls: [{ name: "screenshot", input: {} }] },
    ];
  }
  if (/\bquery\b|\bfind (all|every)\b/.test(p) && /\b(rect|rectangles|shapes|layers|text)\b/.test(p)) {
    const type = /\btext\b/.test(p) ? "text" : "rect";
    return [
      { text: "Finding the layers.", calls: [{ name: "query_layers", input: { type, fields: ["id", "name", "fill"] } }] },
      { text: "Recoloring all of them at once.", calls: [{ name: "apply_to_many", input: { query: { type }, style: { fill: color0 } } }] },
      { text: "", calls: [{ name: "describe_page", input: {} }] },
    ];
  }
  return planForPromptLegacy(prompt, ctx);
}

function planForPromptLegacy(prompt, ctx) {
  const p = prompt.toLowerCase();
  const color = pickColor(prompt, "#4f46e5");
  const q = quoted(prompt);
  const poster = /\bposter\b|\bflyer\b/.test(p);
  const logo = /\blogo\b/.test(p);
  if (poster || logo) {
    const w = logo ? 1024 : 800;
    const h = logo ? 1024 : 1120;
    const title = q || (logo ? "Northwind" : "Summer Sessions");
    const c1 = pickColor(prompt, logo ? "#4f46e5" : "#7c3aed");
    return [
      { text: logo ? "I will start a square document for the logo." : "I will start a fresh poster document.", calls: [{ name: "new_document", input: { name: logo ? "Logo" : "Poster", width: w, height: h } }] },
      {
        text: "Adding a gradient background.",
        calls: [{ name: "add_shape", input: { type: "rect", x: 0, y: 0, w, h, fill: { type: "linear", angle: 135, stops: [{ offset: 0, color: c1 }, { offset: 1, color: "#f97316" }] }, radius: 0, name: "Background" } }],
      },
      {
        text: "Now the headline.",
        calls: [{ name: "add_text", input: { text: title, x: Math.round(w * 0.08), y: Math.round(h * (logo ? 0.45 : 0.55)), fontSize: logo ? 120 : 96, color: "#ffffff", fontWeight: 800 } }],
      },
      { text: "Let me check how it looks.", calls: [{ name: "screenshot", input: {} }] },
    ];
  }
  if (/\b(report|table|chart|graph|dashboard)\b/.test(p)) {
    return [
      { text: "I will start a landscape page for the report.", calls: [{ name: "new_document", input: { name: "Report", width: 1240, height: 880, studio: "layout" } }] },
      { text: "Adding a table with a total row.", calls: [{ name: "add_table", input: { data: [["Region", "Q1", "Q2"], ["North", 120, 150], ["South", 90, 110], ["Total", "=SUM(B2:B3)", "=SUM(C2:C3)"]], headerCols: 1, style: "striped", x: 80, y: 120, w: 480 } }] },
      { text: "And a chart linked to it.", calls: [{ name: "add_chart", input: { type: "column", title: "Sales by region", tableId: ctx.lastId || "n1", x: 620, y: 120, w: 520, h: 330 } }] },
      { text: "Let me check how it looks.", calls: [{ name: "screenshot", input: {} }] },
    ];
  }
  if (/\bwebsite\b|\blanding\b|\bweb ?page\b|\bportfolio\b|\bblog\b/.test(p)) {
    const template = /\bportfolio\b/.test(p) ? "portfolio" : /\bblog\b/.test(p) ? "blog" : "landing";
    const title = q || "Welcome";
    return [
      { text: `Creating a ${template} site from the template.`, calls: [{ name: "create_website", input: { template } }] },
      {
        text: "Customizing the headline and accent color.",
        calls: [
          {
            name: "write_file",
            input: {
              path: "index.html",
              content: `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n<link rel="stylesheet" href="styles.css">\n</head>\n<body>\n<header><h1>${title}</h1><p>A clean starting point built by Vibe.</p><a class="cta" href="#start">Get started</a></header>\n<main id="start"><h2>Why it works</h2><p>Readable type, strong contrast and generous spacing.</p></main>\n</body>\n</html>\n`,
            },
          },
          {
            name: "write_file",
            input: {
              path: "styles.css",
              content: `:root { --fg: #111827; --bg: #ffffff; --accent: ${color}; }\nbody { margin: 0; font: 18px/1.6 system-ui, sans-serif; color: var(--fg); background: var(--bg); }\nheader, main { max-width: 720px; margin: 0 auto; padding: 64px 24px; }\nh1 { font-size: 3rem; line-height: 1.1; }\n.cta { display: inline-block; padding: 12px 24px; border-radius: 8px; background: var(--accent); color: #fff; text-decoration: none; }\n`,
            },
          },
        ],
      },
      { text: "Taking a look at the preview.", calls: [{ name: "screenshot", input: {} }] },
    ];
  }
  const adjust = /\bbrighter\b|\bbrightness\b|\bcontrast\b|\bsaturat|\bvibrant\b|\bwarmer\b/.test(p);
  const blur = /\bblur\b/.test(p);
  const make = [];
  if (/\brectangle\b|\bsquare\b|\bbox\b|\bcard\b/.test(p)) make.push({ name: "add_shape", input: { type: "rect", x: 120, y: 120, w: 320, h: 200, fill: color, radius: 16, name: "Rectangle" } });
  if (/\bcircle\b|\bellipse\b|\bdot\b/.test(p)) make.push({ name: "add_shape", input: { type: "ellipse", x: 480, y: 160, w: 200, h: 200, fill: make.length ? "#f97316" : color, radius: 0, name: "Circle" } });
  if (/\bheadline\b|\btitle\b|\bheading\b|\btext\b/.test(p)) make.push({ name: "add_text", input: { text: q || "Your headline here", x: 120, y: 380, fontSize: 64, color: "#111827", fontWeight: 700 } });
  const steps = [];
  if (make.length) steps.push({ text: "On it.", calls: make });
  if (make.length && /\bshadow\b|\bborder\b|\bstroke\b|\boutline\b/.test(p) && ctx.ids.length) {
    steps.push({ text: "Adding an outline to what I just made.", calls: [{ name: "set_style", input: { ids: ctx.ids.slice(0, 2), stroke: "#111827", strokeWidth: 4 } }] });
  }
  if (adjust || blur) {
    if (!make.length && (!ctx.ids.length || (ctx.called && ctx.called.has("list_layers")))) steps.push({ text: "Let me see which layers exist.", calls: [{ name: "list_layers", input: {} }] });
    const id = ctx.firstId;
    const calls = [];
    if (adjust) {
      const effect = /\bsaturat|\bvibrant\b/.test(p) ? "hsl" : /\bwarmer\b/.test(p) ? "white-balance" : "brightness-contrast";
      const params = effect === "hsl" ? { saturation: 25 } : effect === "white-balance" ? { temperature: 20 } : { brightness: 12, contrast: 10 };
      calls.push({ name: "apply_adjustment", input: { kind: "adjustment", id: effect, ...(id ? { targetId: id } : {}), params } });
    }
    if (blur) calls.push({ name: "apply_adjustment", input: { kind: "filter", id: "gaussian-blur", ...(id ? { targetId: id } : {}), params: { radius: 8 } } });
    steps.push({ text: "Applying that now.", calls });
  }
  if (!steps.length) return [];
  steps.push({ text: "", calls: [{ name: "screenshot", input: {} }] });
  return steps;
}

function finalText(messages, start) {
  // summarize the tool results of the last step
  const results = [];
  for (let i = start; i < messages.length; i++) {
    for (const b of toBlocks(messages[i].content)) if (b.type === "tool_result") results.push(b);
  }
  const failed = results.filter((r) => r.isError);
  if (failed.length) {
    const t = typeof failed[0].content === "string" ? failed[0].content : textOf(failed[0].content);
    return `One step did not work: ${t.slice(0, 160)} Tell me how you would like to continue and I will adjust.`;
  }
  return "Done. I made the changes and checked the result. Tell me what you would like to refine: colors, spacing, wording or layout.";
}

/** Splits text into small word-ish deltas. @param {string} s */
function chunks(s) {
  return s.match(/\S+\s*|\s+/g) || [];
}

const estimate = (s) => Math.ceil(String(s).length / 4);

/** Builds the complete assistant message from streamed events. */
function messageFromEvents(events) {
  let text = "";
  let thinking = "";
  const calls = [];
  for (const e of events) {
    if (e.type === "text") text += e.delta;
    else if (e.type === "thinking") thinking += e.delta;
    else if (e.type === "tool_call") calls.push({ type: "tool_use", id: e.id, name: e.name, input: e.input || {} });
  }
  const content = [];
  if (thinking) content.push({ type: "thinking", text: thinking });
  if (text) content.push({ type: "text", text });
  content.push(...calls);
  return { role: "assistant", content };
}

// ---- tiny PNG encoder (stored deflate) for deterministic placeholder images
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function chunk(type, data) {
  const t = [...type].map((c) => c.charCodeAt(0));
  const body = new Uint8Array(t.length + data.length);
  body.set(t, 0);
  body.set(data, 4);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/**
 * Encodes an RGBA-free gradient PNG (RGB, stored deflate blocks). Deterministic for the same seed.
 * @param {number} w
 * @param {number} h
 * @param {number} seed
 * @returns {Uint8Array}
 */
export function gradientPng(w, h, seed) {
  const raw = new Uint8Array((w * 3 + 1) * h);
  const h1 = seed & 255;
  const h2 = (seed >>> 8) & 255;
  const h3 = (seed >>> 16) & 255;
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      raw[p++] = (h1 + (x * 255) / w) & 255;
      raw[p++] = (h2 + (y * 255) / h) & 255;
      raw[p++] = (h3 + ((x + y) * 128) / (w + h)) & 255;
    }
  }
  const z = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) {
    const len = Math.min(65535, raw.length - i);
    z.push(i + len >= raw.length ? 1 : 0, len & 255, len >>> 8, ~len & 255, (~len >>> 8) & 255);
    for (let j = 0; j < len; j++) z.push(raw[i + j]);
  }
  let a = 1;
  let b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  z.push(...u32(((b << 16) | a) >>> 0));
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = new Uint8Array([...u32(w), ...u32(h), 8, 2, 0, 0, 0]);
  return new Uint8Array([...sig, ...chunk("IHDR", ihdr), ...chunk("IDAT", new Uint8Array(z)), ...chunk("IEND", new Uint8Array(0))]);
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Creates the offline Demo provider.
 * @param {{script?:(request:object, ctx:{signal?:AbortSignal})=>AsyncIterable<object>, delayMs?:number, name?:string, failures?:(object|null|"ok")[]|((call:number)=>object|null)}} [opts]
 *  `failures` injects errors for testing model routing: entry N applies to the N-th stream() call (null/"ok" = none).
 *  Failure = {type:"http", status, code?, message?, retryAfterMs?} | {type:"network"} | {type:"timeout"} (never answers until aborted)
 *          | {type:"cut", afterChars?} (streams some text, then the connection drops) | {type:"empty"} (ends without content)
 *  `script` is an async generator yielding provider events (text/thinking/tool_call/usage/done); a missing `done` is synthesized.
 */
export function createMockProvider(opts = {}) {
  const delayMs = opts.delayMs ?? 0;
  const pause = async (signal) => {
    if (delayMs > 0) await sleep(delayMs, signal);
    else throwIfAborted(signal);
  };

  async function* defaultScript(request) {
    const messages = request.messages || [];
    const has = (n) => !request.tools || request.tools.some((t) => t.name === n);
    const idx = lastPromptIndex(messages);
    const prompt = idx >= 0 ? textOf(messages[idx].content) : "";
    const step = messages.slice(idx + 1).filter((m) => m.role === "assistant").length;
    let plan = [];
    if (request.toolChoice !== "none" && request.tools && request.tools.length) {
      plan = planForPrompt(prompt, idsFromResults(messages, idx + 1))
        .map((s) => ({ text: s.text, calls: s.calls.filter((c) => has(c.name)) }))
        .filter((s) => s.calls.length);
    }
    const cur = plan[step];
    if (cur) {
      if (cur.text) yield* words(cur.text);
      for (let i = 0; i < cur.calls.length; i++) yield { type: "tool_call", id: `call_mock_${step}_${i}`, name: cur.calls[i].name, input: cur.calls[i].input };
      return;
    }
    if (step > 0 && plan.length) {
      yield* words(finalText(messages, idx + 1));
      return;
    }
    if (request.reasoning) yield { type: "thinking", delta: "Considering the request and the tools available. " };
    const hello = /\b(hi|hello|hey)\b/i.test(prompt);
    yield* words(
      hello
        ? "Hi, I am Vibe, running in offline demo mode. Try asking me to draw a blue rectangle and a circle, build a poster or a website, add a headline, or blur the image."
        : "I am running in offline demo mode, so I can only handle a few requests. Try \"draw a blue rectangle and a circle\", \"make a poster\", \"build a website\", \"add a headline\" or \"blur the image\". Connect a model provider in Settings for the full assistant.",
    );
  }
  async function* words(t) {
    for (const c of chunks(t)) yield { type: "text", delta: c };
  }

  let calls = 0;
  const nextFailure = () => {
    const i = calls++;
    const f = typeof opts.failures === "function" ? opts.failures(i) : (opts.failures || [])[i];
    return f && f !== "ok" ? f : null;
  };
  const mockName = opts.name || "demo";

  return {
    name: mockName,
    get calls() {
      return calls;
    },
    kind: "mock",
    baseUrl: "mock://demo",
    capabilities: { embeddings: true, images: true },

    async listModels() {
      return [
        { id: "demo", name: "Demo (offline)", contextWindow: 32000, vision: false, tools: true },
        { id: "demo-image", name: "Demo image generator", imageOutput: true },
      ];
    },

    async *stream(request, { signal } = {}) {
      throwIfAborted(signal);
      const fail = nextFailure();
      if (fail) {
        if (fail.type === "http") throw errorFromBody({ error: { type: fail.code || String(fail.status), message: fail.message || `HTTP ${fail.status}` } }, "", fail.status, fail.retryAfterMs, mockName);
        if (fail.type === "network") throw new ProviderError("Network error: Failed to fetch", { status: 0, code: "network_error", retryable: true, provider: mockName });
        if (fail.type === "timeout") {
          await new Promise((_, reject) => {
            if (!signal) return;
            if (signal.aborted) return reject(abortError(signal));
            signal.addEventListener("abort", () => reject(signal.reason instanceof Error ? signal.reason : abortError(signal)), { once: true });
          });
        }
        if (fail.type === "empty") return;
      }
      const src = opts.script ? opts.script(request, { signal }) : defaultScript(request);
      const events = [];
      let done = null;
      let usage = false;
      let cut = 0;
      for await (const e of src) {
        await pause(signal);
        if (e.type === "done") {
          done = e;
          continue;
        }
        if (e.type === "usage") usage = true;
        if (e.type === "tool_call" && !e.id) e.id = makeId("call");
        events.push(e);
        yield e;
        if (fail && fail.type === "cut" && e.type === "text") {
          cut += e.delta.length;
          if (cut >= (fail.afterChars ?? 12)) throw new ProviderError("The stream ended before the model finished.", { code: "stream_truncated", retryable: true, provider: mockName });
        }
      }
      throwIfAborted(signal);
      const message = (done && done.message) || messageFromEvents(events);
      if (!usage) {
        const inChars = (request.messages || []).reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), (request.system || "").length);
        yield { type: "usage", input: Math.ceil(inChars / 4), output: estimate(JSON.stringify(message.content)) };
      }
      const hasTools = message.content.some((b) => b.type === "tool_use");
      yield { type: "done", stopReason: (done && done.stopReason) || (hasTools ? "tool_use" : "end"), message };
    },

    /** Deterministic 64-dimensional hashed bag-of-words vectors (good enough for demos and tests). */
    async embed(texts) {
      return texts.map((t) => {
        const v = new Array(64).fill(0);
        for (const w of String(t).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) v[hash(w) % 64] += 1;
        const n = Math.hypot(...v) || 1;
        return v.map((x) => x / n);
      });
    },

    /** Returns a small deterministic gradient PNG per requested image. */
    async generateImage({ prompt = "", n = 1 } = {}) {
      const out = [];
      for (let i = 0; i < Math.max(1, Math.min(4, n)); i++) out.push({ mime: "image/png", data: bytesToBase64(gradientPng(64, 64, hash(prompt + i))) });
      return out;
    },
  };
}
