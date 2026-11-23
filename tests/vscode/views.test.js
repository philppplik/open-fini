// Large-package unpacking (zip-index.js, VSIX_LIMITS), views and view containers in the manifest, webview documents
// and the codicon table.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { zipSync, strToU8 } from "../../app/vendor/fflate/fflate.js";
import { readZipIndex, readZipEntry } from "../../app/src/vscode/zip-index.js";
import { unpackVsix, VSIX_LIMITS } from "../../app/src/vscode/vsix.js";
import { normalizePackage, isWebAsset } from "../../app/src/vscode/manifest.js";
import { prepareWebviewHtml, themeVariables, WEBVIEW_CSP } from "../../app/src/vscode/webview.js";
import { CODICON_ICONS, codiconName } from "../../app/src/vscode/codicons.js";
import { createOpenVsx } from "../../app/src/vscode/openvsx.js";
import { makeVsix, WEB_EXT } from "./fixtures.js";

const pkg = (extra) => JSON.stringify({ name: "views", publisher: "openfini-test", version: "1.0.0", browser: "./dist/ext.js", engines: { vscode: "^1.80.0" }, ...extra });

describe("safe ZIP reading", () => {
  it("lists entries from the central directory and inflates one entry", () => {
    const z = zipSync({ "a.txt": [strToU8("hello hello hello"), { level: 9 }], "dir/b.bin": [new Uint8Array([1, 2, 3]), { level: 0 }] });
    const idx = readZipIndex(z);
    assert.deepEqual(idx.map((e) => [e.name, e.size]), [["a.txt", 17], ["dir/b.bin", 3]]);
    assert.equal(new TextDecoder().decode(readZipEntry(z, idx[0])), "hello hello hello");
    assert.deepEqual([...readZipEntry(z, idx[1])], [1, 2, 3]);
  });

  it("stops an entry that inflates past its declared size (forged header)", () => {
    const z = zipSync({ "x.txt": [new Uint8Array(100_000), { level: 9 }] });
    const [e] = readZipIndex(z);
    assert.throws(() => readZipEntry(z, { ...e, size: 1000 }), /more than its header says/);
    assert.throws(() => readZipEntry(z, e, { maxBytes: 10 }), /larger than/);
    assert.throws(() => readZipIndex(z, { maxEntries: 0 }), /more than 0 entries/);
    assert.throws(() => readZipIndex(new Uint8Array(30)), /not a valid ZIP/);
    const cut = z.slice(0, z.length - 30);
    assert.throws(() => readZipIndex(cut), /not a valid ZIP/);
  });

  it("accepts packages up to 512 MB and unpacks only what it needs, plus web assets on their own budget", () => {
    assert.equal(VSIX_LIMITS.maxPackageBytes, 512 * 1024 * 1024);
    const files = {
      "extension/package.json": pkg({ contributes: { views: { explorer: [{ id: "toy.tree", name: "Toy" }] } } }),
      "extension/dist/ext.js": "exports.activate = () => {};",
      "extension/media/main.css": "body{color:red}",
      "extension/media/icon.svg": "<svg/>",
      "extension/node_modules/big/index.js": "x",
      "extension/media/huge.js": new Uint8Array(3 * 1024 * 1024),
    };
    const r = unpackVsix(makeVsix(files), { limits: { maxAssetBytes: 1024 * 1024 } });
    assert.ok(r.files["media/main.css"] && r.files["media/icon.svg"], "web assets of a web extension are kept");
    assert.equal(r.files["node_modules/big/index.js"], undefined);
    assert.equal(r.files["media/huge.js"], undefined, "assets over their budget are skipped, not refused");
    const node = unpackVsix(makeVsix({ ...files, "extension/package.json": pkg({ browser: undefined, main: "./out/x.js" }) }));
    assert.equal(node.files["media/main.css"], undefined, "Node-only extensions get no web assets");
  });

  it("still rejects zip bombs, unsafe names and oversized required files", () => {
    assert.throws(() => unpackVsix(makeVsix({ ...WEB_EXT, "extension/README.md": new Uint8Array(8 * 1024 * 1024) })), /zip bomb/);
    assert.throws(() => unpackVsix(makeVsix({ ...WEB_EXT, "../evil": "x" })), /unsafe path/);
    assert.throws(() => unpackVsix(makeVsix(WEB_EXT), { limits: { maxPackageBytes: 100 } }), /larger than/);
  });
});

describe("views in the manifest", () => {
  it("normalizes views and containers into dockable panels", () => {
    const m = normalizePackage(JSON.parse(pkg({
      contributes: {
        viewsContainers: { activitybar: [{ id: "toyBar", title: "Toy", icon: "media/icon.svg" }], panel: [{ id: "toyPanel", title: "Toy output" }] },
        views: { toyBar: [{ id: "toy.tree", name: "Items" }, { id: "toy.web", name: "Preview", type: "webview" }], toyPanel: [{ id: "toy.log", name: "Log" }], explorer: [{ id: "toy.outline", name: "Outline" }], unknownContainer: [{ id: "x.y", name: "Lost" }], toyBar2: "nope" },
      },
    }))).manifest;
    assert.deepEqual(m.contributes.views.map((v) => [v.id, v.type, v.location]), [["toy.tree", "tree", "top"], ["toy.web", "webview", "top"], ["toy.log", "tree", "bottom"], ["toy.outline", "tree", "top"]]);
    assert.equal(m.contributes.views[0].icon, "media/icon.svg");
    assert.deepEqual(m.otherContributions, []);
  });

  it("knows what a web asset is", () => {
    for (const p of ["media/main.js", "out/webview/index.css", "icons/a.svg", "fonts/x.woff2", "wasm/x.wasm"]) assert.equal(isWebAsset(p), true, p);
    for (const p of ["node_modules/a/b.js", "dist/x.js.map", "src/x.ts", "bin/tool.exe", "a/b/c/d/e/f/g/h/i.js"]) assert.equal(isWebAsset(p), false, p);
  });
});

describe("webview documents", () => {
  const files = { "media/main.js": strToU8("console.log(1)"), "media/style.css": strToU8("@font-face{src:url(../fonts/a.woff2)} body{background:url('img/bg.png')}"), "fonts/a.woff2": new Uint8Array([1, 2]), "media/img/bg.png": new Uint8Array([137, 80]) };

  it("inlines extension files as data: URIs and adds the CSP, the API shim and theme variables first", () => {
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-1'"><link rel="stylesheet" href="openfini-ext://pub.ext/media/style.css"></head><body class="x"><script nonce="1" src="openfini-ext://pub.ext//media/main.js?v=2"></script><img src="openfini-ext://pub.ext/missing.png"></body></html>`;
    const doc = prepareWebviewHtml(html, { extId: "pub.ext", files, state: { n: 1 }, vars: { "--vscode-foreground": "#eee", "--evil": "x", "--vscode-x": "red;}</style>" }, dark: true });
    const headStart = doc.indexOf("<head>") + 6;
    assert.ok(doc.slice(headStart).startsWith(`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy"`), "our policy comes first");
    assert.ok(doc.indexOf("acquireVsCodeApi") < doc.indexOf("nonce-1"), "the shim runs before the extension's own policy");
    assert.match(doc, /src="data:text\/javascript;base64,Y29uc29sZS5sb2coMSk="/);
    assert.match(doc, /href="data:text\/css;base64,/);
    const css = Buffer.from(/href="data:text\/css;base64,([^"]+)"/.exec(doc)[1], "base64").toString();
    assert.match(css, /url\("data:font\/woff2;base64,AQI="\)/);
    assert.match(css, /url\("data:image\/png;base64,iVA="\)/);
    assert.match(doc, /src="data:image\/png;base64,"/, "unknown files become empty data URIs");
    assert.ok(!doc.includes("openfini-ext://"));
    assert.match(doc, /--vscode-foreground:#eee;/);
    assert.ok(!doc.includes("--evil") && !doc.includes("red;}</style>"));
    assert.match(doc, /<body class="vscode-dark x">/);
    assert.match(doc, /var state=\{"n":1\}/);
    assert.match(WEBVIEW_CSP, /connect-src 'none'/);
  });

  it("wraps fragments, disables scripts when asked and maps OpenFini colors", () => {
    const doc = prepareWebviewHtml("<p>hi</p>", { extId: "a.b", scripts: false, dark: false });
    assert.match(doc, /^<!doctype html><html><head>/);
    assert.match(doc, /script-src 'none'/);
    assert.ok(!doc.includes("acquireVsCodeApi"));
    assert.match(doc, /<body class="vscode-light">/);
    const v = themeVariables((n) => ({ "--of-text": "#111", "--of-accent": "#06f" })[n] || "");
    assert.equal(v["--vscode-foreground"], "#111");
    assert.equal(v["--vscode-button-background"], "#06f");
  });
});

describe("codicons and downloads", () => {
  it("maps codicons only to vendored icons", () => {
    for (const name of CODICON_ICONS) assert.ok(existsSync(new URL(`../../app/vendor/shoelace/assets/icons/${name}.svg`, import.meta.url)), name);
    assert.equal(codiconName("sync~spin"), "arrow-repeat");
    assert.equal(codiconName("does-not-exist"), null);
  });

  it("streams Open VSX downloads and stops past the cap", async () => {
    const body = (chunks) => ({ getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }), cancel: async () => {} }) });
    const progress = [];
    const ok = createOpenVsx({ fetch: async (url) => ({ ok: true, status: 200, url, headers: new Map(), body: body([new Uint8Array(4), new Uint8Array(6)]) }), assertNetwork: () => {} });
    const got = await ok.download("https://open-vsx.org/x.vsix", { onProgress: (n) => progress.push(n) });
    assert.equal(got.length, 10);
    assert.deepEqual(progress, [4, 10]);
    const big = createOpenVsx({ fetch: async (url) => ({ ok: true, status: 200, url, headers: new Map(), body: body([new Uint8Array(8), new Uint8Array(8)]) }), assertNetwork: () => {} });
    await assert.rejects(() => big.download("https://open-vsx.org/x.vsix", { maxBytes: 10 }), /larger than/);
  });
});
