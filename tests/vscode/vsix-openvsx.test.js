import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unpackVsix, isZip, readText } from "../../app/src/vscode/vsix.js";
import { createOpenVsx, searchUrl, parseSearch, parseDetails, allowedUrl } from "../../app/src/vscode/openvsx.js";
import { buildFrameDocument, cmpVersion } from "../../app/src/vscode/host.js";
import { makeVsix, THEME_EXT, SNIPPET_EXT, WEB_EXT, NODE_EXT } from "./fixtures.js";

describe("vsix unpacking", () => {
  it("unpacks only the files OpenFini uses and localizes the manifest", () => {
    const r = unpackVsix(makeVsix(THEME_EXT));
    assert.equal(r.manifest.id, "openfini-test.night-owl-lite");
    assert.equal(r.manifest.displayName, "Test Night Theme");
    assert.ok(r.files["themes/night.json"] && r.files["themes/base.json"] && r.files["README.md"] && r.files["LICENSE.txt"]);
    assert.equal(r.files["node_modules/big/huge.bin"], undefined, "unreferenced files are not decompressed");
    assert.ok(r.names.includes("node_modules/big/huge.bin"));
  });

  it("resolves the browser entry and keeps it", () => {
    const r = unpackVsix(makeVsix(WEB_EXT));
    assert.equal(r.manifest.browser, "dist/web/extension.js");
    assert.match(readText(r.files, "dist/web/extension.js"), /registerCommand/);
    const s = unpackVsix(makeVsix(SNIPPET_EXT));
    assert.ok(s.files["snippets/js.code-snippets"] && s.files["toy.language-configuration.json"]);
    const n = unpackVsix(makeVsix(NODE_EXT));
    assert.equal(n.files["out/extension.js"], undefined, "Node code is never even unpacked");
    assert.ok(n.names.includes("bin/helper.node"));
  });

  it("rejects what is not a VS Code extension", () => {
    assert.equal(isZip(new TextEncoder().encode("hello world, not a zip file")), false);
    assert.throws(() => unpackVsix(new TextEncoder().encode("hello world, not a zip file")), /not a ZIP/);
    assert.throws(() => unpackVsix(makeVsix({ "readme.txt": "x" })), /no extension\/package\.json/);
    assert.throws(() => unpackVsix(makeVsix({ "extension/package.json": "{nope" })), /not valid JSON/);
    assert.throws(() => unpackVsix(makeVsix({ "extension/package.json": JSON.stringify({ name: "a" }) })), /publisher/);
  });

  it("rejects path traversal, too many entries and oversized content", () => {
    assert.throws(() => unpackVsix(makeVsix({ ...WEB_EXT, "extension/../../evil.js": "x" })), /unsafe path/);
    assert.throws(() => unpackVsix(makeVsix({ ...WEB_EXT, "C:/evil.js": "x" })), /unsafe path/);
    const many = { ...THEME_EXT };
    for (let i = 0; i < 30; i++) many[`extension/f${i}.txt`] = "x";
    assert.throws(() => unpackVsix(makeVsix(many), { limits: { maxEntries: 20 } }), /more than 20 entries/);
    assert.throws(() => unpackVsix(makeVsix({ ...WEB_EXT, "extension/README.md": "x".repeat(3 * 1024 * 1024) }), { limits: { maxFileBytes: 1024 * 1024 } }), /larger than 1 MB/);
    const bomb = { ...THEME_EXT, "extension/README.md": new Uint8Array(8 * 1024 * 1024) };
    assert.throws(() => unpackVsix(makeVsix(bomb)), /zip bomb/);
    assert.throws(() => unpackVsix(makeVsix(WEB_EXT), { limits: { maxPackageBytes: 100 } }), /larger than/);
  });
});

describe("Open VSX client", () => {
  const sample = { totalSize: 1, offset: 0, extensions: [{ namespace: "jdinhlife", name: "gruvbox", displayName: "Gruvbox Theme", version: "1.29.1", downloadCount: 240251, averageRating: 5, reviewCount: 6, description: "Gruvbox Theme", verified: true, files: { download: "https://open-vsx.org/api/jdinhlife/gruvbox/1.29.1/file/x.vsix", icon: "https://evil.example/icon.png" } }, { bogus: true }] };

  it("builds search URLs and parses answers defensively", () => {
    const u = new URL(searchUrl({ query: "theme", category: "Themes", size: 999 }));
    assert.equal(u.origin + u.pathname, "https://open-vsx.org/api/-/search");
    assert.equal(u.searchParams.get("size"), "50");
    assert.equal(u.searchParams.get("category"), "Themes");
    const r = parseSearch(sample);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].id, "jdinhlife.gruvbox");
    assert.equal(r.items[0].icon, null, "files outside open-vsx.org are dropped");
    assert.ok(r.items[0].download.startsWith("https://open-vsx.org/"));
    const d = parseDetails({ ...sample.extensions[0], license: "MIT", categories: ["Themes"], engines: { vscode: "^1.67.2" }, files: { readme: "https://open-vsx.org/r.md", license: "http://open-vsx.org/l" } });
    assert.equal(d.license, "MIT");
    assert.equal(d.files.readme, "https://open-vsx.org/r.md");
    assert.equal(d.files.license, null, "http is refused");
    assert.throws(() => parseDetails({ error: "Extension not found" }), /not found/);
    assert.ok(allowedUrl("https://openvsx.eclipsecontent.org/a.vsix"));
    assert.ok(!allowedUrl("https://marketplace.visualstudio.com/x"));
  });

  it("uses no credentials, honors offline mode and caps sizes", async () => {
    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push([url, init]);
      const body = new TextEncoder().encode(JSON.stringify(sample));
      return { ok: true, status: 200, url, headers: new Map([["content-length", String(body.length)]]), arrayBuffer: async () => body.buffer };
    };
    let offline = false;
    const c = createOpenVsx({ fetch: fakeFetch, assertNetwork: () => { if (offline) throw new Error("offline"); } });
    const r = await c.search({ query: "gruvbox" });
    assert.equal(r.items[0].displayName, "Gruvbox Theme");
    assert.equal(calls[0][1].credentials, "omit");
    assert.equal(calls[0][1].referrerPolicy, "no-referrer");
    offline = true;
    await assert.rejects(() => c.search({ query: "x" }), /offline/);
    offline = false;
    await assert.rejects(() => c.download("https://open-vsx.org/x.vsix", { maxBytes: 10 }), /larger than/);
    await assert.rejects(() => c.download("https://example.com/x.vsix"), /only downloads/);
    await assert.rejects(() => c.details("../x", "y"), /Invalid/);
    const redirecting = createOpenVsx({ fetch: async () => ({ ok: true, status: 200, url: "https://evil.example/x", headers: new Map(), arrayBuffer: async () => new ArrayBuffer(1) }), assertNetwork: () => {} });
    await assert.rejects(() => redirecting.download("https://open-vsx.org/x.vsix"), /unexpected address/);
  });
});

describe("vscode host helpers", () => {
  it("builds a sandbox document with the strict CSP and the wrapped bundle", () => {
    const doc = buildFrameDocument({ extId: "a.b", x: "</script>" }, "module.exports = {};");
    assert.match(doc, /Content-Security-Policy" content="default-src 'none'; script-src data:;[^"]*connect-src 'none'/);
    assert.ok(!doc.includes("</script><script>"), "no inline scripts");
    const scripts = [...doc.matchAll(/src="data:text\/javascript;charset=utf-8,([^"]*)"/g)].map((m) => decodeURIComponent(m[1]));
    assert.equal(scripts.length, 3);
    assert.ok(scripts[0].includes("\\u003c/script>"), "config cannot close the script");
    assert.match(scripts[1], /^__vsxDefine\(function \(module, exports, require, process, global\) \{\nmodule\.exports = \{\};\n\}\);$/);
    assert.equal(scripts[2], "__vsxBoot()");
  });

  it("compares versions", () => {
    assert.equal(cmpVersion("1.10.0", "1.9.9"), 1);
    assert.equal(cmpVersion("1.0.0", "1.0.0"), 0);
    assert.equal(cmpVersion("0.9.0", "1.0.0"), -1);
  });
});
