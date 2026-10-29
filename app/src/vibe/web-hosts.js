// Tiny host helpers of the web tools, kept separate so the approval policy loads without the rest of web-access.js.

/** Splits a host list (one per line or comma separated) into clean lowercase entries. */
export function parseDomainList(text) {
  return [...new Set(String(text || "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean))];
}

/** "example.com" matches itself and subdomains; "*.example.com" also matches the bare domain. */
export function hostMatches(host, pattern) {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase().replace(/^\*\./, "");
  return h === p || h.endsWith(`.${p}`);
}

/** Hosts a web tool call would contact. Throws for an unusable URL. */
export function hostsOf(name, input, web = {}) {
  if (name === "web_search") {
    if (input?.kind === "images") return ["api.openverse.org"];
    const b = web.searchBackend || "wikipedia";
    if (b === "searxng") return [new URL(web.searxngUrl).hostname.toLowerCase()];
    return [{ brave: "api.search.brave.com", tavily: "api.tavily.com" }[b] || "en.wikipedia.org"];
  }
  return [new URL(String(input?.url)).hostname.toLowerCase()];
}

/** True when every host is on the allowlist. */
export const allAllowed = (hosts, web) => hosts.length > 0 && hosts.every((h) => (web.allowDomains || []).some((p) => hostMatches(h, p)));

/** Hosts for the "Always allow this domain" button of a web tool approval (empty for other tools). */
export const WEB_TOOL_NAMES = new Set(["web_search", "fetch_page", "download_image"]);
