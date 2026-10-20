// GitHub REST sync against an in-memory fake of the Git Data API (push, fetch/merge, clone, error mapping).
import test from "node:test";
import assert from "node:assert/strict";
import { GitRepo } from "../../app/src/engine/git/repo.js";
import { GitHubApi, pushToGitHub, fetchFromGitHub, cloneFromGitHub, commitFiles, parseGitHubRepo, isoWithTz, parseIso, markSynced, base64ToBytes } from "../../app/src/engine/git/github.js";
import { serializeCommit, parseCommit, hashObject, utf8 } from "../../app/src/engine/git/objects.js";

/** A fake api.github.com holding one repository. */
function fakeGitHub({ empty = false } = {}) {
  const store = new GitRepo(new Map());
  const refs = new Map();
  const log = [];
  const json = (status, body) => ({ status, ok: status < 400, json: async () => body });
  const person = (p) => ({ name: p.name, email: p.email, date: isoWithTz(p.ts, p.tz) });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const m = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    log.push(`${m} ${u.pathname}`);
    assert.equal(init.headers.Authorization, "Bearer tok");
    assert.equal(u.hostname, "api.github.com");
    const p = u.pathname.replace("/repos/o/r", "");
    let r;
    if (p === "" && m === "GET") return json(200, { default_branch: "main" });
    if ((r = /^\/git\/ref\/heads\/(.+)$/.exec(p))) return refs.has(r[1]) ? json(200, { object: { sha: refs.get(r[1]) } }) : json(404, { message: "Not Found" });
    if (p === "/git/blobs" && m === "POST") {
      if (empty && !refs.size && !store.files.size) return json(409, { message: "Git Repository is empty." });
      const bytes = base64ToBytes(body.content);
      return json(201, { sha: store.writeObject("blob", bytes) });
    }
    if ((r = /^\/git\/blobs\/(\w+)$/.exec(p))) return json(200, { encoding: "base64", content: Buffer.from(store.readBlob(r[1])).toString("base64") });
    if (p === "/git/trees" && m === "POST") {
      for (const e of body.tree) assert.ok(store.hasObject(e.sha), "tree references an unknown blob");
      return json(201, { sha: store.buildTree(new Map(body.tree.map((e) => [e.path, { oid: e.sha, mode: e.mode }]))) });
    }
    if ((r = /^\/git\/trees\/(\w+)$/.exec(p))) {
      const flat = store.flatten(r[1]);
      return json(200, { truncated: false, tree: [...flat].map(([path, v]) => ({ path, mode: v.mode, type: "blob", sha: v.oid })) });
    }
    if (p === "/git/commits" && m === "POST") {
      const au = body.author || { name: "Token User", email: "t@e.x", date: "2024-01-01T00:00:00+00:00" };
      const a = { name: au.name, email: au.email, ...parseIso(au.date) };
      const c = body.committer ? { name: body.committer.name, email: body.committer.email, ...parseIso(body.committer.date) } : a;
      // GitHub normalizes the message: it always ends without extra blank lines (and we keep the trailing newline off)
      return json(201, { sha: store.writeObject("commit", serializeCommit({ tree: body.tree, parents: body.parents, author: a, committer: c, message: body.message })) });
    }
    if ((r = /^\/git\/commits\/(\w+)$/.exec(p))) {
      const c = store.readCommit(r[1]);
      return json(200, { sha: c.oid, tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message, author: person(c.author), committer: person(c.committer) });
    }
    if (p === "/git/refs" && m === "POST") {
      refs.set(body.ref.replace("refs/heads/", ""), body.sha);
      return json(201, {});
    }
    if ((r = /^\/git\/refs\/heads\/(.+)$/.exec(p)) && m === "PATCH") {
      const cur = refs.get(r[1]);
      if (!body.force && !store.isAncestor(cur, body.sha)) return json(422, { message: "Update is not a fast forward" });
      refs.set(r[1], body.sha);
      return json(200, {});
    }
    return json(404, { message: `unhandled ${m} ${p}` });
  };
  return { fetch: fetchFn, refs, store, log };
}

const wtOf = (m) => ({ m, paths: () => [...m.keys()], get: (p) => m.get(p) ?? null, write: (p, b) => m.set(p, new TextDecoder().decode(b)), remove: (p) => m.delete(p) });
const me = { name: "Ada", email: "a@e.x" };
const at = (n) => new Date(1700000000000 + n * 60000);
function localRepo(files) {
  const r = GitRepo.init(new Map());
  const wt = wtOf(new Map(Object.entries(files)));
  r.stage(wt, wt.paths());
  r.commit({ message: "First", author: me, date: at(1) });
  return { r, wt };
}

test("repository and date helpers", () => {
  assert.deepEqual(parseGitHubRepo("https://github.com/me/site.git"), { owner: "me", name: "site" });
  assert.deepEqual(parseGitHubRepo("me/site"), { owner: "me", name: "site" });
  assert.equal(parseGitHubRepo("nonsense"), null);
  assert.equal(isoWithTz(1700000000, "+0200"), "2023-11-15T00:13:20+02:00");
  assert.deepEqual(parseIso("2023-11-15T00:13:20+02:00"), { ts: 1700000000, tz: "+0200" });
});

test("push creates the branch, a second push sends only new commits", async () => {
  const gh = fakeGitHub();
  const api = new GitHubApi({ token: "tok", fetch: gh.fetch });
  const { r, wt } = localRepo({ "index.html": "<h1>x</h1>\n", "a.css": "a{}\n" });
  const res = await pushToGitHub(r, api, { owner: "o", name: "r", branch: "main" });
  assert.equal(res.pushed, 1);
  assert.ok(gh.refs.get("main"));
  assert.equal(gh.store.readCommit(gh.refs.get("main")).message, "First\n");
  wt.m.set("a.css", "a{color:red}\n");
  r.stage(wt, ["a.css"]);
  r.commit({ message: "Second", author: me, date: at(2) });
  gh.log.length = 0;
  const res2 = await pushToGitHub(r, api, { owner: "o", name: "r", branch: "main" });
  assert.equal(res2.pushed, 1);
  assert.equal(gh.log.filter((l) => l === "POST /repos/o/r/git/blobs").length, 1, "only the changed file is uploaded");
  assert.equal((await pushToGitHub(r, api, { owner: "o", name: "r", branch: "main" })).pushed, 0);
  assert.equal(gh.store.log({ from: gh.refs.get("main") }).length, 2);
});

test("remote changes must be pulled first; fetch + merge brings them in", async () => {
  const gh = fakeGitHub();
  const api = new GitHubApi({ token: "tok", fetch: gh.fetch });
  const { r, wt } = localRepo({ "index.html": "<h1>x</h1>\n" });
  await pushToGitHub(r, api, { owner: "o", name: "r", branch: "main" });
  // someone else commits on GitHub
  const { sha: blob } = { sha: gh.store.writeObject("blob", utf8("remote\n")) };
  const old = gh.refs.get("main");
  const flat = gh.store.flatten(gh.store.readCommit(old).tree);
  flat.set("remote.txt", { oid: blob, mode: "100644" });
  const person = { name: "Bob", email: "b@e.x", ts: 1700009999, tz: "+0000" };
  gh.refs.set("main", gh.store.writeObject("commit", serializeCommit({ tree: gh.store.buildTree(flat), parents: [old], author: person, message: "Remote change" })));
  wt.m.set("local.txt", "l\n");
  r.stage(wt, ["local.txt"]);
  r.commit({ message: "Local change", author: me, date: at(5) });
  await assert.rejects(() => pushToGitHub(r, api, { owner: "o", name: "r", branch: "main" }), (e) => e.code === "REMOTE_AHEAD");
  const f = await fetchFromGitHub(r, api, { owner: "o", name: "r", branch: "main" });
  assert.equal(f.fetched, 1);
  assert.equal(r.readCommit(f.tip).message, "Remote change\n");
  const m = r.merge("origin/main", wt, wt, { author: me });
  assert.equal(m.result, "merged");
  assert.equal(wt.get("remote.txt"), "remote\n");
  markSynced(r, { owner: "o", name: "r", branch: "main", remoteHead: f.remoteHead });
  const p = await pushToGitHub(r, api, { owner: "o", name: "r", branch: "main" });
  assert.equal(p.pushed, 2); // the local commit and the merge commit
  assert.equal(gh.store.readCommit(gh.refs.get("main")).parents.length, 2);
});

test("clone reads the tree and history", async () => {
  const gh = fakeGitHub();
  const api = new GitHubApi({ token: "tok", fetch: gh.fetch });
  const { r } = localRepo({ "index.html": "<h1>hi</h1>\n", "img/p.png": "bin" });
  await pushToGitHub(r, api, { owner: "o", name: "r", branch: "main" });
  const c = await cloneFromGitHub(api, { owner: "o", name: "r" });
  assert.equal(c.branch, "main");
  assert.equal(new TextDecoder().decode(c.files.get("index.html")), "<h1>hi</h1>\n");
  const repo = new GitRepo(c.git);
  assert.equal(repo.log().length, 1);
  assert.equal(repo.status({ paths: () => [...c.files.keys()], get: (p) => new TextDecoder().decode(c.files.get(p)) }).changes.length, 0);
  assert.equal(repo.remotes()[0].url, "https://github.com/o/r.git");
});

test("errors are explained", async () => {
  assert.throws(() => new GitHubApi({ fetch }), (e) => e.code === "NO_TOKEN");
  const bad = new GitHubApi({ token: "t", fetch: async () => ({ status: 401, ok: false, json: async () => ({ message: "Bad credentials" }) }) });
  await assert.rejects(() => bad.repoInfo("o", "r"), (e) => e.code === "AUTH");
  const empty = fakeGitHub({ empty: true });
  const api = new GitHubApi({ token: "tok", fetch: empty.fetch });
  const { r } = localRepo({ "a.txt": "a" });
  await assert.rejects(() => pushToGitHub(r, api, { owner: "o", name: "r", branch: "main" }), (e) => e.code === "EMPTY_REPO");
});

test("commitFiles replaces the whole tree on a branch", async () => {
  const gh = fakeGitHub();
  const api = new GitHubApi({ token: "tok", fetch: gh.fetch });
  await commitFiles(api, { owner: "o", name: "r", branch: "gh-pages", files: [{ path: "index.html", bytes: utf8("1") }, { path: "old.html", bytes: utf8("o") }], message: "Deploy" });
  const res = await commitFiles(api, { owner: "o", name: "r", branch: "gh-pages", files: [{ path: "index.html", bytes: utf8("2") }], message: "Deploy 2" });
  assert.equal(res.created, false);
  const flat = gh.store.flatten(gh.store.readCommit(gh.refs.get("gh-pages")).tree);
  assert.deepEqual([...flat.keys()], ["index.html"]);
  assert.equal(gh.store.readCommit(gh.refs.get("gh-pages")).parents.length, 1);
});
