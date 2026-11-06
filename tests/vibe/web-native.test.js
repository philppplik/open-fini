import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuckDuckGo, webSearch, guardedFetch, searchEndpoint } from "../../app/src/vibe/web-access.js";
import { nativeEligible, toResponse } from "../../app/src/vibe/native-web.js";

const DDG = `<html><body>
<div class="result results_links result--ad"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
<div class="result results_links results_links_deep web-result "><div class="links_main">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa%3Fx%3D1&amp;rut=abc">Example <b>Domain</b></a></h2>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">This domain is for &amp; use in examples.</a></div></div>
<div class="result results_links web-result"><a class="result__a" href="https://docs.example.com/guide">Guide</a><div class="result__snippet">Read the guide.</div></div>
</body></html>`;

test("parseDuckDuckGo reads results, unwraps redirects and skips ads", () => {
  const r = parseDuckDuckGo(DDG);
  assert.deepEqual(r, [
    { title: "Example Domain", url: "https://example.org/a?x=1", snippet: "This domain is for & use in examples." },
    { title: "Guide", url: "https://docs.example.com/guide", snippet: "Read the guide." },
  ]);
  assert.equal(parseDuckDuckGo(DDG, 1).length, 1);
  assert.deepEqual(parseDuckDuckGo("<html>nothing</html>"), []);
});

test("only plain GETs go native", () => {
  assert.ok(nativeEligible({}));
  assert.ok(nativeEligible({ method: "get", headers: { Accept: "text/html" } }));
  assert.ok(!nativeEligible({ method: "POST", body: "{}" }));
  assert.ok(!nativeEligible({ headers: { "X-Subscription-Token": "k" } }), "API keys never take the native path");
});

test("native responses behave like fetch responses, redirects stay visible", async () => {
  const res = toResponse({ status: 302, url: "https://a.example/", contentType: "text/html", location: "http://127.0.0.1/", body: btoa("hi"), truncated: false });
  assert.equal(res.ok, false);
  assert.equal(res.headers.get("Location"), "http://127.0.0.1/");
  assert.equal(await res.text(), "hi");
  // guardedFetch refuses the private redirect target
  const fetchImpl = async () => res;
  await assert.rejects(guardedFetch("https://a.example/", { enabled: true }, { fetchImpl }), /private|local/);
});

test("DuckDuckGo search: native path parses, browser falls back to Wikipedia with a note", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.startsWith("https://html.duckduckgo.com/")) return toResponse({ status: 200, url, contentType: "text/html", body: Buffer.from(DDG).toString("base64") });
    return { ok: true, status: 200, json: async () => ({ query: { search: [{ title: "Coffee", snippet: "A <b>drink</b>" }] } }) };
  };
  const web = { enabled: true, searchBackend: "duckduckgo" };
  const native = await webSearch("example", web, { fetchImpl, native: true });
  assert.equal(native[0].url, "https://example.org/a?x=1");
  assert.ok(seen[0].startsWith("https://html.duckduckgo.com/html/?q=example"));
  const browser = await webSearch("coffee", web, { fetchImpl, native: false });
  assert.equal(browser[0].title, "Coffee");
  assert.match(browser.note, /desktop app/);
  assert.equal(searchEndpoint(web, false, false), "https://en.wikipedia.org/w/api.php", "approval shows the host really contacted");
});
