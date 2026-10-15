import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";

import { MIME_TYPES, createServer, desktopCsp, resolveRequestPath } from "../../scripts/serve.mjs";

/** Sends a request with the path exactly as given (fetch() would normalize "..", which hides bugs). */
function raw(port, path, method = "GET") {
  return new Promise((resolveRequest, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolveRequest({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("scripts/serve.mjs", () => {
  let dir;
  let server;
  let port;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "openfini-serve-"));
    await mkdir(join(dir, "public", "sub"), { recursive: true });
    await writeFile(join(dir, "secret.txt"), "top secret");
    await writeFile(join(dir, "public", "index.html"), "<h1>home</h1>");
    await writeFile(join(dir, "public", "sub", "index.html"), "<h1>sub</h1>");
    await writeFile(join(dir, "public", "app.webmanifest"), "{}");
    await writeFile(join(dir, "public", "engine.wasm"), "\0asm");
    await writeFile(join(dir, "public", "a b.svg"), "<svg/>");
    server = createServer({ root: join(dir, "public") });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  it("serves files with the right MIME type and no-store caching", async () => {
    const home = await raw(port, "/");
    assert.equal(home.status, 200);
    assert.equal(home.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(home.headers["cache-control"], "no-store");
    assert.equal(home.body, "<h1>home</h1>");

    assert.equal((await raw(port, "/app.webmanifest")).headers["content-type"], MIME_TYPES[".webmanifest"]);
    assert.equal((await raw(port, "/engine.wasm")).headers["content-type"], "application/wasm");
    assert.equal((await raw(port, "/a%20b.svg")).headers["content-type"], "image/svg+xml");
  });

  it("serves index.html for directories and 404s for missing files", async () => {
    assert.equal((await raw(port, "/sub/")).body, "<h1>sub</h1>");
    assert.equal((await raw(port, "/nope.js")).status, 404);
  });

  it("answers HEAD without a body and rejects other methods", async () => {
    const head = await raw(port, "/", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal((await raw(port, "/", "POST")).status, 405);
  });

  it("cannot be tricked into serving files outside the root", async () => {
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2fsecret.txt", "/sub/../../secret.txt", "/..%5csecret.txt", "/%00"]) {
      const res = await raw(port, path);
      assert.notEqual(res.status, 200, `${path} must not succeed`);
      assert.ok(!res.body.includes("top secret"), `${path} must not leak`);
    }
  });

  it("resolveRequestPath maps URLs to files below the root only", () => {
    const root = resolve("/srv/app");
    assert.equal(resolveRequestPath(root, "/a/b.js?x=1"), resolve("/srv/app/a/b.js"));
    assert.equal(resolveRequestPath(root, "/"), root);
    // URL parsing collapses (encoded) dot segments at the root, so this stays inside it.
    assert.equal(resolveRequestPath(root, "/%2e%2e/x"), resolve("/srv/app/x"));
    // Encoded slashes survive parsing and are caught by the containment check.
    assert.equal(resolveRequestPath(root, "/..%2f..%2fetc/passwd"), null);
    assert.equal(resolveRequestPath(root, "/..%5cx"), null, "backslashes are refused");
    assert.equal(resolveRequestPath(root, "/%E0%A4%A"), null, "malformed escapes are rejected");
  });

  it("can send the desktop app's Content-Security-Policy", async () => {
    const policy = await desktopCsp();
    assert.match(policy, /script-src 'self'/);
    assert.match(policy, /connect-src [^;]*ipc:/);
    const secured = createServer({ root: join(dir, "public"), csp: policy });
    await new Promise((r) => secured.listen(0, "127.0.0.1", r));
    try {
      const res = await raw(secured.address().port, "/");
      assert.equal(res.headers["content-security-policy"], policy);
    } finally {
      await new Promise((r) => secured.close(r));
    }
    assert.equal((await raw(port, "/")).headers["content-security-policy"], undefined, "off by default");
  });

  it("serves a single-page fallback only when asked to", async () => {
    const spa = createServer({ root: join(dir, "public"), spa: true });
    await new Promise((r) => spa.listen(0, "127.0.0.1", r));
    try {
      const { port: spaPort } = spa.address();
      assert.equal((await raw(spaPort, "/some/route")).body, "<h1>home</h1>");
      assert.equal((await raw(spaPort, "/missing.js")).status, 404);
    } finally {
      await new Promise((r) => spa.close(r));
    }
  });
});
