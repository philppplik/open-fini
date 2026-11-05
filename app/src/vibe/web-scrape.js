// Scraping, crawling and JSON API requests for the Vibe assistant (tools scrape_page, crawl_site, http_request). Pure
// logic on top of web-access.js (same SSRF guard, size and time limits, no cookies or credentials); `fetch` and `sleep`
// are injectable so everything is testable. Loaded lazily by app/src/vibe/tools/web-access.js.
//
// Public API
//   parseHtml(html) → root node     select(root, selector) → nodes     textOf(node) → string
//   extractTables(html) → [{ caption, rows: string[][] }]   tablesToMarkdown(tables) → string
//   extractLinks(html, baseUrl) → [{ url, text, internal }]  extractMeta(html, baseUrl) → { title, description, … }
//   parseRobots(text) → { rules, crawlDelay, sitemaps }       robotsAllows(robots, path) → boolean
//   parseSitemap(xml) → { urls, sitemaps }
//   crawl(startUrl, web, { maxPages, maxDepth, delayMs, pathPrefix, useSitemap, fetchImpl, sleep, signal, onProgress })
//   httpRequest(url, web, { method, headers, body, fetchImpl, signal })
// Invariants: crawling stays on the start URL's origin, obeys robots.txt (user agent "OpenFini", else "*"), waits at
// least `delayMs` (and the site's Crawl-delay, capped at 10 s) between requests and stops at hard caps (CRAWL_CAPS).
// http_request only reaches hosts on the API allowlist (web.apiDomains) and never follows redirects.

import { guardedFetch, checkUrl, normalizeWeb, extractReadable } from "./web-access.js";
import { hostMatches } from "./web-hosts.js";

export const CRAWL_CAPS = Object.freeze({ maxPages: 25, maxDepth: 3, maxCharsPerPage: 8000, maxTotalChars: 120000, maxDelayMs: 10000 });
export const UA = "OpenFini";

// ------------------------------------------------------------------ tiny HTML tree

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") {
    const c = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : "";
  }
  return ENT[e.toLowerCase()] ?? m;
});

/** Parses HTML into { tag, attrs, children, parent } nodes (text nodes are { text }). Scripts and styles are dropped. */
export function parseHtml(html) {
  const src = String(html).replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<\/?([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>|<!doctype[^>]*>/gi;
  let last = 0;
  for (let m; (m = re.exec(src)); ) {
    if (m.index > last) cur.children.push({ text: decode(src.slice(last, m.index)), parent: cur });
    last = re.lastIndex;
    if (!m[1]) continue;
    const tag = m[1].toLowerCase();
    if (m[0][1] === "/") {
      for (let n = cur; n && n !== root; n = n.parent) if (n.tag === tag) {
        cur = n.parent;
        break;
      }
      continue;
    }
    const attrs = {};
    for (const a of (m[2] || "").matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? "");
    // implicit closes that matter for tables, lists and paragraphs
    if (/^(tr|td|th|li|p|option)$/.test(tag)) {
      const stop = tag === "tr" ? /^(table|tbody|thead|tfoot)$/ : tag === "li" ? /^(ul|ol)$/ : /^(tr|table|body)$/;
      for (let n = cur; n && n !== root && !stop.test(n.tag); n = n.parent) if (n.tag === tag || (tag !== "p" && /^(td|th)$/.test(tag) && /^(td|th)$/.test(n.tag))) {
        cur = n.parent;
        break;
      }
    }
    const node = { tag, attrs, children: [], parent: cur };
    cur.children.push(node);
    if (!VOID.has(tag) && !m[0].endsWith("/>")) cur = node;
  }
  if (last < src.length) cur.children.push({ text: decode(src.slice(last)), parent: cur });
  return root;
}

/** Visible text of a node, whitespace collapsed. */
export function textOf(node) {
  if (node.text != null) return node.text.replace(/\s+/g, " ").trim();
  const parts = [];
  const walk = (n) => {
    if (n.text != null) parts.push(n.text);
    else {
      if (n.tag === "br") parts.push("\n");
      n.children.forEach(walk);
      if (/^(p|div|li|tr|h[1-6]|section|article)$/.test(n.tag)) parts.push("\n");
    }
  };
  walk(node);
  return parts.join(" ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
}

function* descendants(n) {
  for (const c of n.children || []) {
    if (c.tag) {
      yield c;
      yield* descendants(c);
    }
  }
}

/** Parses one compound selector like `div#main.post[data-x="1"]`. */
function parseCompound(s) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;
  let pos = 0;
  for (let m; (m = re.exec(s)); ) {
    if (m.index !== pos) break;
    pos = re.lastIndex;
    if (m[1]) out.tag = m[1] === "*" ? null : m[1].toLowerCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else out.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] ?? m[7] ?? m[8] ?? "" });
    if (pos === s.length) break;
  }
  if (pos !== s.length) throw new Error(`Unsupported selector part “${s}”. Supported: tag, #id, .class, [attr], [attr=value] (also ^= $= *= ~=), descendant (space) and child (>) combinators, comma lists.`);
  return out;
}

function matches(n, c) {
  if (c.tag && n.tag !== c.tag) return false;
  if (c.id && n.attrs.id !== c.id) return false;
  const cls = (n.attrs.class || "").split(/\s+/);
  if (c.classes.some((x) => !cls.includes(x))) return false;
  for (const a of c.attrs) {
    const v = n.attrs[a.name];
    if (v == null) return false;
    if (!a.op) continue;
    const ok = { "=": v === a.value, "^=": v.startsWith(a.value), "$=": v.endsWith(a.value), "*=": v.includes(a.value), "~=": v.split(/\s+/).includes(a.value), "|=": v === a.value || v.startsWith(`${a.value}-`) }[a.op];
    if (!ok) return false;
  }
  return true;
}

/** CSS selector subset (see parseCompound) over a parsed tree. Results in document order, without duplicates. */
export function select(root, selector) {
  const out = new Set();
  for (const part of String(selector).split(",").map((s) => s.trim()).filter(Boolean)) {
    const tokens = part.replace(/\s*>\s*/g, " > ").split(/\s+/);
    const chain = []; // [{ comp, rel }] rel = how this compound relates to the previous one
    let rel = " ";
    for (const tk of tokens) {
      if (tk === ">") rel = ">";
      else {
        chain.push({ comp: parseCompound(tk), rel });
        rel = " ";
      }
    }
    const fits = (n, i) => {
      if (!matches(n, chain[i].comp)) return false;
      if (i === 0) return true;
      if (chain[i].rel === ">") return !!n.parent?.tag && n.parent.tag !== "#root" && fits(n.parent, i - 1);
      for (let p = n.parent; p && p.tag !== "#root"; p = p.parent) if (fits(p, i - 1)) return true;
      return false;
    };
    for (const n of descendants(root)) if (fits(n, chain.length - 1)) out.add(n);
  }
  const order = [...descendants(root)];
  return order.filter((n) => out.has(n));
}

// ------------------------------------------------------------------ extractors

export function extractTables(html) {
  return select(parseHtml(html), "table").map((t) => {
    const rows = select(t, "tr").filter((tr) => {
      for (let p = tr.parent; p; p = p.parent) if (p.tag === "table") return p === t;
      return false;
    });
    const cap = select(t, "caption")[0];
    return { caption: cap ? textOf(cap) : "", rows: rows.map((tr) => tr.children.filter((c) => c.tag === "td" || c.tag === "th").map((c) => textOf(c).replace(/\n/g, " "))).filter((r) => r.length) };
  });
}

export function tablesToMarkdown(tables) {
  return tables.map((t, i) => {
    const w = Math.max(0, ...t.rows.map((r) => r.length));
    if (!w) return "";
    const pad = (r) => `| ${[...r, ...Array(w - r.length).fill("")].map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
    return `Table ${i + 1}${t.caption ? `: ${t.caption}` : ""}\n${pad(t.rows[0])}\n|${" --- |".repeat(w)}\n${t.rows.slice(1).map(pad).join("\n")}`.trim();
  }).filter(Boolean).join("\n\n");
}

export function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const seen = new Set();
  const out = [];
  for (const a of select(parseHtml(html), "a[href]")) {
    let u;
    try {
      u = new URL(a.attrs.href, base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    u.hash = "";
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    out.push({ url: u.href, text: textOf(a).slice(0, 200), internal: u.origin === base.origin });
  }
  return out;
}

export function extractMeta(html, baseUrl) {
  const root = parseHtml(html);
  const meta = {};
  for (const m of select(root, "meta")) {
    const k = (m.attrs.name || m.attrs.property || "").toLowerCase();
    if (k && m.attrs.content != null && !(k in meta)) meta[k] = m.attrs.content;
  }
  const canon = select(root, "link[rel=canonical]")[0]?.attrs.href;
  let canonical = "";
  try {
    canonical = canon ? new URL(canon, baseUrl).href : "";
  } catch {
    /* ignore */
  }
  return {
    title: textOf(select(root, "title")[0] || { text: "" }),
    description: meta.description || meta["og:description"] || "",
    lang: select(root, "html")[0]?.attrs.lang || "",
    canonical,
    headings: select(root, "h1, h2").slice(0, 30).map((n) => `${n.tag}: ${textOf(n)}`),
    meta: Object.fromEntries(Object.entries(meta).filter(([k]) => /^(og:|twitter:|author|keywords|robots|description|generator)/.test(k)).slice(0, 40)),
  };
}

// ------------------------------------------------------------------ robots.txt and sitemaps

export function parseRobots(text) {
  const groups = [];
  let g = null;
  let lastWasAgent = false;
  const sitemaps = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) groups.push((g = { agents: [], rules: [], crawlDelay: 0 }));
      g.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") sitemaps.push(val);
    else if (g && (key === "allow" || key === "disallow")) g.rules.push({ allow: key === "allow", path: val });
    else if (g && key === "crawl-delay") g.crawlDelay = Number(val) || 0;
  }
  const pick = groups.find((x) => x.agents.some((a) => a !== "*" && UA.toLowerCase().includes(a))) || groups.find((x) => x.agents.includes("*"));
  return { rules: pick?.rules || [], crawlDelay: pick?.crawlDelay || 0, sitemaps };
}

const ruleRe = (p) => new RegExp(`^${p.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$")}`);

/** Longest matching rule wins; Allow wins ties; an empty Disallow allows everything. */
export function robotsAllows(robots, path) {
  let best = null;
  for (const r of robots.rules) {
    if (!r.path) continue;
    if (!ruleRe(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

export function parseSitemap(xml) {
  const locs = (tag) => [...String(xml).matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<loc>\\s*([^<\\s]+)\\s*</loc>`, "gi"))].map((m) => decode(m[1]));
  return { urls: locs("url"), sitemaps: locs("sitemap") };
}

// ------------------------------------------------------------------ crawl

const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(t);
    reject(signal.reason || new Error("Aborted."));
  }, { once: true });
});

/**
 * Same-origin breadth-first crawl with hard caps. Returns { pages: [{ url, title, text, depth }], skipped: [{ url, reason }], robots }.
 */
export async function crawl(startUrl, web, o = {}) {
  const w = normalizeWeb(web);
  const { fetchImpl = globalThis.fetch, sleep = defaultSleep, signal, onProgress } = o;
  const maxPages = Math.min(Math.max(1, o.maxPages || 10), CRAWL_CAPS.maxPages);
  const maxDepth = Math.min(Math.max(0, o.maxDepth ?? 1), CRAWL_CAPS.maxDepth);
  const start = checkUrl(startUrl, w);
  const prefix = o.pathPrefix || "/";
  const get = (u, extra = {}) => guardedFetch(u, w, { fetchImpl, signal, ...extra });
  let robots = { rules: [], crawlDelay: 0, sitemaps: [] };
  try {
    const r = await get(`${start.origin}/robots.txt`, { maxBytes: 512 * 1024 });
    robots = parseRobots(new TextDecoder().decode(r.bytes));
  } catch {
    /* no robots.txt (404 or unreachable): everything is allowed */
  }
  const delay = Math.min(Math.max(o.delayMs ?? 1000, robots.crawlDelay * 1000), CRAWL_CAPS.maxDelayMs);
  const queue = [{ url: start.href, depth: 0 }];
  const seen = new Set([start.href]);
  const enqueue = (u, depth) => {
    try {
      const x = new URL(u, start);
      x.hash = "";
      if (x.origin !== start.origin || !x.pathname.startsWith(prefix) || seen.has(x.href)) return;
      seen.add(x.href);
      queue.push({ url: x.href, depth });
    } catch {
      /* not a URL */
    }
  };
  let requests = 1;
  if (o.useSitemap) {
    const maps = robots.sitemaps.length ? robots.sitemaps.slice(0, 2) : [`${start.origin}/sitemap.xml`];
    for (const sm of maps) {
      try {
        if (new URL(sm).origin !== start.origin) continue;
        await sleep(delay, signal);
        requests++;
        const r = await get(sm, { maxBytes: 2 * 1024 * 1024 });
        for (const u of parseSitemap(new TextDecoder().decode(r.bytes)).urls.slice(0, maxPages * 4)) enqueue(u, 1);
      } catch {
        /* no sitemap */
      }
    }
  }
  const pages = [];
  const skipped = [];
  let total = 0;
  while (queue.length && pages.length < maxPages && total < CRAWL_CAPS.maxTotalChars) {
    if (signal?.aborted) throw signal.reason || new Error("Aborted.");
    const { url, depth } = queue.shift();
    const u = new URL(url);
    if (!robotsAllows(robots, u.pathname + u.search)) {
      skipped.push({ url, reason: "robots.txt" });
      continue;
    }
    if (requests++ > 0) await sleep(delay, signal);
    let r;
    try {
      r = await get(url, { accept: "text/html,application/xhtml+xml" });
    } catch (e) {
      skipped.push({ url, reason: e.message });
      continue;
    }
    if (r.type && !/html|xml/.test(r.type)) {
      skipped.push({ url, reason: r.type });
      continue;
    }
    const html = new TextDecoder().decode(r.bytes);
    const page = extractReadable(html, { baseUrl: r.url, maxChars: Math.min(CRAWL_CAPS.maxCharsPerPage, CRAWL_CAPS.maxTotalChars - total) });
    pages.push({ url: r.url, title: page.title, text: page.text, depth });
    total += page.text.length;
    onProgress?.({ done: pages.length, max: maxPages, url: r.url });
    if (depth < maxDepth) for (const l of extractLinks(html, r.url)) if (l.internal) enqueue(l.url, depth + 1);
  }
  return { pages, skipped, robots: { crawlDelay: robots.crawlDelay, rules: robots.rules.length }, capped: pages.length >= maxPages || total >= CRAWL_CAPS.maxTotalChars };
}

// ------------------------------------------------------------------ JSON APIs

const FORBIDDEN_HEADERS = /^(cookie|cookie2|host|origin|referer|connection|content-length|transfer-encoding|proxy-.*|sec-.*|upgrade|te|trailer|keep-alive)$/i;
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** True when `host` is on the API allowlist. */
export const apiAllowed = (host, web) => (normalizeWeb(web).apiDomains || []).some((p) => hostMatches(host, p));

/** Sends one request to an allowlisted JSON API. Returns { status, type, json?, text?, truncated }. */
export async function httpRequest(url, web, { method = "GET", headers = {}, body, fetchImpl = globalThis.fetch, signal } = {}) {
  const w = normalizeWeb(web);
  const u = checkUrl(url, w);
  if (!apiAllowed(u.hostname, w)) throw new Error(`“${u.hostname}” is not on the API allowlist. The user can add it under Settings ▸ Artificial intelligence ▸ Web access ▸ API domains.`);
  const m = String(method).toUpperCase();
  if (!METHODS.includes(m)) throw new Error(`Method ${method} is not allowed (${METHODS.join(", ")}).`);
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (FORBIDDEN_HEADERS.test(k)) throw new Error(`The header “${k}” cannot be set.`);
    h[k] = String(v);
  }
  let payload;
  if (body != null && m !== "GET") {
    payload = typeof body === "string" ? body : JSON.stringify(body);
    if (!Object.keys(h).some((k) => k.toLowerCase() === "content-type")) h["Content-Type"] = "application/json";
    if (payload.length > 256 * 1024) throw new Error("The request body is larger than 256 KiB.");
  }
  h.Accept ||= "application/json";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("The request timed out.")), w.timeoutMs);
  signal?.addEventListener("abort", () => ctl.abort(signal.reason), { once: true });
  try {
    const res = await fetchImpl(u.href, { method: m, headers: h, body: payload, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "manual", signal: ctl.signal });
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) throw new Error("The API answered with a redirect; redirects are not followed for API requests.");
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const buf = new Uint8Array(await res.arrayBuffer());
    const truncated = buf.length > w.maxPageBytes;
    const text = new TextDecoder().decode(truncated ? buf.slice(0, w.maxPageBytes) : buf);
    let json;
    if (/json/.test(type) && !truncated) {
      try {
        json = JSON.parse(text);
      } catch {
        /* keep text */
      }
    }
    return { status: res.status, ok: res.ok, type, ...(json !== undefined ? { json } : { text: text.slice(0, 40000) }), truncated };
  } finally {
    clearTimeout(timer);
  }
}
