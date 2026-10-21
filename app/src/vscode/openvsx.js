// Open VSX registry client (https://open-vsx.org, Eclipse Foundation). Pure: `fetch` and the network policy are
// injected, so it is unit-tested with a fake fetch. The Visual Studio Marketplace is NOT used: its terms allow
// Marketplace offerings only in Microsoft's in-scope products (see docs/vscode-extensions.md).
//
// Public API
//   OPEN_VSX                                   base URL
//   searchUrl({query, category, size, offset}) the search endpoint URL
//   parseSearch(json)                          -> { total, items: [summary] } (validated, length-capped)
//   parseDetails(json)                         -> details (license, files, engines, …)
//   createOpenVsx({fetch, assertNetwork})      -> { search(o), details(ns, name), download(url, {maxBytes}), text(url) }
//
// Invariants: only https URLs on open-vsx.org or its download CDN (openvsx.eclipsecontent.org) are fetched; requests
// carry no credentials and no referrer; responses are size-capped; every call asks `assertNetwork` first (offline mode).

export const OPEN_VSX = "https://open-vsx.org";
const ALLOWED_HOSTS = new Set(["open-vsx.org", "openvsx.eclipsecontent.org"]);
export const CATEGORIES = ["Themes", "Snippets", "Programming Languages", "Formatters", "Linters", "Keymaps", "Other"];

const s = (x, max = 300) => (typeof x === "string" ? x.slice(0, max) : "");
const n = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** Is this URL one the client may fetch? */
export function allowedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function searchUrl({ query = "", category = "", size = 24, offset = 0 } = {}) {
  const p = new URLSearchParams();
  if (query) p.set("query", String(query).slice(0, 120));
  if (category) p.set("category", String(category).slice(0, 60));
  p.set("size", String(Math.max(1, Math.min(50, size | 0))));
  if (offset) p.set("offset", String(Math.max(0, offset | 0)));
  p.set("sortBy", query ? "relevance" : "downloadCount");
  p.set("sortOrder", "desc");
  return `${OPEN_VSX}/api/-/search?${p}`;
}

function summary(e) {
  const files = e.files && typeof e.files === "object" ? e.files : {};
  return {
    namespace: s(e.namespace, 100),
    name: s(e.name, 100),
    id: `${s(e.namespace, 100)}.${s(e.name, 100)}`.toLowerCase(),
    displayName: s(e.displayName, 100) || s(e.name, 100),
    description: s(e.description, 400),
    version: s(e.version, 60),
    downloads: n(e.downloadCount),
    rating: e.averageRating == null ? null : Math.round(n(e.averageRating) * 10) / 10,
    reviews: n(e.reviewCount),
    verified: e.verified === true,
    deprecated: e.deprecated === true,
    timestamp: s(e.timestamp, 40),
    download: allowedUrl(files.download) ? files.download : null,
    icon: allowedUrl(files.icon) ? files.icon : null,
  };
}

export function parseSearch(json) {
  const list = Array.isArray(json?.extensions) ? json.extensions.slice(0, 50) : [];
  return { total: n(json?.totalSize), offset: n(json?.offset), items: list.filter((e) => e && typeof e === "object" && e.namespace && e.name).map(summary) };
}

export function parseDetails(json) {
  if (!json || typeof json !== "object" || json.error) throw new Error(s(json?.error, 200) || "Open VSX returned no extension.");
  const files = json.files && typeof json.files === "object" ? json.files : {};
  const pick = (k) => (allowedUrl(files[k]) ? files[k] : null);
  return {
    ...summary(json),
    license: s(json.license, 100),
    categories: Array.isArray(json.categories) ? json.categories.slice(0, 10).map((c) => s(c, 40)) : [],
    tags: Array.isArray(json.tags) ? json.tags.slice(0, 20).map((c) => s(c, 40)) : [],
    engines: json.engines && typeof json.engines === "object" ? { vscode: s(json.engines.vscode, 60) } : {},
    extensionKind: Array.isArray(json.extensionKind) ? json.extensionKind.slice(0, 4).map((k) => s(k, 20)) : [],
    repository: s(json.repository, 300),
    homepage: s(json.homepage, 300),
    publishedBy: s(json.publishedBy?.loginName, 100),
    files: { download: pick("download"), readme: pick("readme"), license: pick("license"), manifest: pick("manifest"), changelog: pick("changelog"), icon: pick("icon") },
  };
}

/**
 * @param {{fetch: typeof fetch, assertNetwork: (url: string) => void}} o
 */
export function createOpenVsx({ fetch: doFetch, assertNetwork }) {
  async function get(url, { maxBytes = 2 * 1024 * 1024, timeoutMs = 20_000 } = {}) {
    if (!allowedUrl(url)) throw new Error("OpenFini only downloads VS Code extensions from open-vsx.org.");
    assertNetwork(url);
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "follow", signal: ctl?.signal });
      if (res.url && !allowedUrl(res.url)) throw new Error("Open VSX redirected to an unexpected address.");
      if (!res.ok) throw new Error(`Open VSX answered HTTP ${res.status}.`);
      const len = +(res.headers?.get?.("content-length") || 0);
      if (len > maxBytes) throw new Error(`The download is larger than ${Math.round(maxBytes / 1048576)} MB.`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > maxBytes) throw new Error(`The download is larger than ${Math.round(maxBytes / 1048576)} MB.`);
      return bytes;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Open VSX did not answer in time.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  const json = async (url) => {
    const b = await get(url);
    try {
      return JSON.parse(new TextDecoder().decode(b));
    } catch {
      throw new Error("Open VSX returned an invalid answer.");
    }
  };
  return {
    async search(o) {
      return parseSearch(await json(searchUrl(o)));
    },
    async details(namespace, name) {
      if (!/^[\w.-]{1,100}$/.test(namespace) || !/^[\w.-]{1,100}$/.test(name)) throw new Error("Invalid extension id.");
      return parseDetails(await json(`${OPEN_VSX}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`));
    },
    download: (url, { maxBytes = 64 * 1024 * 1024 } = {}) => get(url, { maxBytes, timeoutMs: 120_000 }),
    async text(url, maxBytes = 512 * 1024) {
      return new TextDecoder().decode(await get(url, { maxBytes }));
    },
  };
}
