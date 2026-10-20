// Smart-HTTP fetch/push against the real `git http-backend` (skipped when Git is not installed), plus pack and zip import
// of repositories created by real Git (including packfiles with deltas).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { zipSync } from "../../app/vendor/fflate/fflate.js";
import { GitRepo } from "../../app/src/engine/git/repo.js";
import { fetchRemote, pushRemote, proxied, discoverRefs, basicAuth } from "../../app/src/engine/git/smart.js";
import { importRepoZip } from "../../app/src/engine/git/archive.js";
import { writePack, readPack } from "../../app/src/engine/git/pack.js";
import { utf8, hashObject } from "../../app/src/engine/git/objects.js";

const haveGit = spawnSync("git", ["--version"]).status === 0;
const execPath = haveGit ? spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim() : "";
const gitq = (cwd, ...a) => {
  const r = spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@e.x", "-c", "safe.directory=*", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

const gitA = (cwd, ...a) => new Promise((res, rej) => { const p = spawn("git", ["-c", "user.name=T", "-c", "user.email=t@e.x", "-c", "safe.directory=*", ...a], { cwd }); let e = ""; p.stderr.on("data", (c) => (e += c)); p.on("close", (c) => (c ? rej(new Error(a.join(" ") + ": " + e)) : res())); });

/** Serves a bare repository through git http-backend (CGI). */
function backendServer(root) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      const env = { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", REQUEST_METHOD: req.method, PATH_INFO: u.pathname, QUERY_STRING: u.search.slice(1), CONTENT_TYPE: req.headers["content-type"] || "", REMOTE_USER: "tester", REMOTE_ADDR: "127.0.0.1", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" };
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        env.CONTENT_LENGTH = String(body.length);
        const cgi = spawn(join(execPath, "git-http-backend"), [], { env });
        const out = [];
        cgi.stdout.on("data", (c) => out.push(c));
        cgi.stdin.end(body);
        cgi.on("close", () => {
          const buf = Buffer.concat(out);
          let sep = buf.indexOf("\r\n\r\n");
          let sepLen = 4;
          if (sep < 0) {
            sep = buf.indexOf("\n\n");
            sepLen = 2;
          }
          const head = buf.subarray(0, sep).toString().split(/\r?\n/);
          let status = 200;
          const headers = {};
          for (const l of head) {
            const i = l.indexOf(":");
            if (i < 0) continue;
            const k = l.slice(0, i).trim();
            if (k.toLowerCase() === "status") status = parseInt(l.slice(i + 1), 10);
            else headers[k] = l.slice(i + 1).trim();
          }
          res.writeHead(status, headers);
          res.end(buf.subarray(sep + sepLen));
        });
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ofini-smart-"));
  const work = join(dir, "work");
  mkdirSync(work);
  gitq(work, "init");
  mkdirSync(join(work, "css"));
  writeFileSync(join(work, "index.html"), `<h1>${"Hello world ".repeat(200)}</h1>\n`);
  writeFileSync(join(work, "css/a.css"), "a{color:red}\n".repeat(50));
  gitq(work, "add", "-A");
  gitq(work, "commit", "-m", "one");
  writeFileSync(join(work, "index.html"), `<h1>${"Hello world ".repeat(200)}</h1>\n<p>more</p>\n`);
  gitq(work, "commit", "-am", "two");
  gitq(work, "tag", "v1");
  const bare = join(dir, "srv", "site.git");
  mkdirSync(join(dir, "srv"));
  gitq(dir, "clone", "--bare", work, bare);
  gitq(bare, "config", "http.receivepack", "true");
  gitq(bare, "gc", "--aggressive"); // packfiles with deltas
  return { dir, work, bare };
}

test("proxy URL forms and auth header", () => {
  assert.equal(proxied("https://h/x", ""), "https://h/x");
  assert.equal(proxied("https://h/x", "https://p.example/"), "https://p.example/https://h/x");
  assert.equal(proxied("https://h/x?a=1", "https://p.example/?u={url}"), "https://p.example/?u=https%3A%2F%2Fh%2Fx%3Fa%3D1");
  assert.equal(basicAuth("me", "tok"), `Basic ${Buffer.from("me:tok").toString("base64")}`);
});

test("pack writer output is accepted by readPack", () => {
  const objs = [{ type: "blob", content: utf8("hello\n") }, { type: "blob", content: utf8("x".repeat(100000)) }];
  const back = readPack(writePack(objs));
  assert.deepEqual(back.map((o) => o.oid), objs.map((o) => hashObject(o.type, o.content)));
});

test("clone, fetch and push against git http-backend", { skip: !haveGit }, async () => {
  const { dir, bare } = setup();
  const { srv, url } = await backendServer(join(dir, "srv"));
  try {
    const repoUrl = `${url}/site.git`;
    const info = await discoverRefs({ url: repoUrl, fetch });
    assert.ok(info.refs.has("refs/heads/main") && info.refs.has("refs/tags/v1"));
    const repo = GitRepo.init(new Map());
    const res = await fetchRemote(repo, { url: repoUrl, fetch });
    assert.ok(res.objects >= 6);
    const remoteMain = gitq(bare, "rev-parse", "main");
    assert.equal(repo.readRef("refs/remotes/origin/main"), remoteMain);
    assert.equal(repo.readRef("refs/tags/v1"), remoteMain);
    assert.deepEqual(repo.log({ from: "origin/main" }).map((c) => c.message.trim()), ["two", "one"]);
    const flat = repo.flatten(repo.readCommit(remoteMain).tree);
    assert.ok(new TextDecoder().decode(repo.readBlob(flat.get("index.html").oid)).endsWith("<p>more</p>\n"));
    // check out, commit locally and push
    const files = new Map();
    const wt = { paths: () => [...files.keys()], get: (p) => files.get(p) ?? null, write: (p, b) => files.set(p, new TextDecoder().decode(b)), remove: (p) => files.delete(p) };
    repo.reset(remoteMain, wt, wt, { hard: true });
    assert.equal(repo.status(wt).changes.length, 0);
    files.set("new.txt", "pushed from OpenFini\n");
    repo.stage(wt, ["new.txt"]);
    const oid = repo.commit({ message: "Add new.txt", author: { name: "Ada", email: "a@e.x" } });
    const pushed = await pushRemote(repo, { url: repoUrl, fetch });
    assert.ok(pushed.ok && pushed.objects >= 3);
    assert.equal(gitq(bare, "rev-parse", "main"), oid);
    assert.equal(gitq(bare, "fsck", "--strict").includes("error"), false);
    assert.equal(gitq(bare, "show", "main:new.txt"), "pushed from OpenFini");
    // a second push is a no-op; a fresh clone sees the new commit via an incremental fetch
    assert.match((await pushRemote(repo, { url: repoUrl, fetch })).message, /up to date/);
    // diverged remote: refuse
    const other = join(dir, "other");
    await gitA(dir, "clone", repoUrl, other);
    writeFileSync(join(other, "z.txt"), "z");
    gitq(other, "add", "-A");
    gitq(other, "commit", "-m", "remote change");
    await gitA(other, "push", "origin", "main");
    files.set("q.txt", "q");
    repo.stage(wt, ["q.txt"]);
    repo.commit({ message: "local", author: { name: "Ada", email: "a@e.x" } });
    await assert.rejects(() => pushRemote(repo, { url: repoUrl, fetch }), (e) => e.code === "REMOTE_AHEAD");
    await fetchRemote(repo, { url: repoUrl, fetch });
    const m = repo.merge("origin/main", wt, wt, { author: { name: "Ada", email: "a@e.x" } });
    assert.equal(m.result, "merged");
    await pushRemote(repo, { url: repoUrl, fetch });
    assert.equal(gitq(bare, "rev-parse", "main"), repo.head().oid);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("importing a zipped real repository with packfiles", { skip: !haveGit }, () => {
  const { dir, work } = setup();
  try {
    gitq(work, "gc", "--aggressive");
    const zip = {};
    const walk = (d) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else zip[`site-main/${relative(work, f).replaceAll("\\", "/")}`] = readFileSync(f);
      }
    };
    walk(work);
    const { files, git } = importRepoZip(zipSync(zip));
    assert.ok(git && files.has("index.html") && files.has("css/a.css"));
    const repo = new GitRepo(git);
    assert.equal(repo.head().oid, gitq(work, "rev-parse", "HEAD"));
    assert.deepEqual(repo.log().map((c) => c.message.trim()), ["two", "one"]);
    // the real git index is understood: nothing is modified
    const wt = { paths: () => [...files.keys()], get: (p) => (files.has(p) ? new TextDecoder().decode(files.get(p)) : null) };
    assert.equal(repo.status(wt).changes.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
