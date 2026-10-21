import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { GitRepo, GitError, validRefName } from "../../app/src/engine/git/repo.js";
import { hashObject, utf8, sha1Hex } from "../../app/src/engine/git/objects.js";
import { diffBlocks, diffHunks, unifiedDiff, merge3, splitLines, lineMarks } from "../../app/src/engine/git/diff.js";
import { createIgnore } from "../../app/src/engine/git/ignore.js";
import { exportRepoFiles } from "../../app/src/engine/git/archive.js";

/** An in-memory working tree. */
function tree(files = {}) {
  const m = new Map(Object.entries(files));
  return {
    m,
    paths: () => [...m.keys()],
    get: (p) => m.get(p) ?? null,
    write: (p, b) => m.set(p, /\.(png|bin)$/.test(p) ? b : new TextDecoder().decode(b)),
    remove: (p) => m.delete(p),
  };
}
const me = { name: "Ada", email: "ada@example.com" };
const at = (n) => new Date(1700000000000 + n * 60000);
const commit = (r, wt, msg, n) => {
  r.stage(wt, r.status(wt).changes.map((c) => c.path));
  return r.commit({ message: msg, author: me, date: at(n) });
};

test("object hashes match Git", () => {
  assert.equal(hashObject("blob", utf8("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
  assert.equal(hashObject("blob", utf8("")), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  assert.equal(hashObject("tree", new Uint8Array(0)), "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  assert.equal(sha1Hex(utf8("abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
  assert.equal(sha1Hex(utf8("a".repeat(1000))), "291e9a6c66994949b57ba5e650361e98fc36b1ba");
});

test("init, stage, commit, status and history", () => {
  const r = GitRepo.init(new Map());
  const wt = tree({ "index.html": "<h1>Hi</h1>\n", "css/a.css": "a{}\n" });
  let st = r.status(wt);
  assert.deepEqual(st.changes.map((c) => [c.path, c.staged, c.unstaged]), [["css/a.css", null, "U"], ["index.html", null, "U"]]);
  assert.throws(() => r.commit({ message: "x", author: me }), (e) => e.code === "NOTHING_TO_COMMIT");
  r.stage(wt, ["index.html"]);
  assert.equal(r.status(wt).changes.find((c) => c.path === "index.html").staged, "A");
  const c1 = r.commit({ message: "First", author: me, date: at(1) });
  assert.equal(r.head().oid, c1);
  assert.equal(r.readCommit(c1).message, "First\n");
  wt.m.set("index.html", "<h1>Hello</h1>\n");
  st = r.status(wt);
  assert.equal(st.changes.find((c) => c.path === "index.html").unstaged, "M");
  const c2 = commit(r, wt, "Second", 2);
  assert.deepEqual(r.log().map((c) => c.oid), [c2, c1]);
  assert.deepEqual(r.log({ path: "css/a.css" }).map((c) => c.oid), [c2]);
  assert.equal(r.resolve("HEAD~1"), c1);
  assert.equal(r.resolve(c2.slice(0, 8)), c2);
  assert.deepEqual(r.commitChanges(c2).map((d) => [d.path, d.status]), [["css/a.css", "A"], ["index.html", "M"]]);
  assert.equal(r.status(wt).changes.length, 0);
});

test("unstage, discard and .gitignore", () => {
  const r = GitRepo.init(new Map());
  const wt = tree({ "a.txt": "1\n", ".gitignore": "*.log\nbuild/\n!keep.log\n", "x.log": "l", "build/o.js": "o" });
  commit(r, wt, "init", 1);
  assert.equal(r.status(wt).changes.length, 0);
  wt.m.set("new.txt", "n");
  wt.m.set("keep.log", "k");
  wt.m.set("y.log", "y");
  assert.deepEqual(r.status(wt).changes.map((c) => c.path), ["keep.log", "new.txt"]);
  wt.m.set("a.txt", "2\n");
  r.stage(wt, ["a.txt"]);
  assert.equal(r.status(wt).changes.find((c) => c.path === "a.txt").staged, "M");
  r.unstage(["a.txt"]);
  assert.equal(r.status(wt).changes.find((c) => c.path === "a.txt").staged, null);
  r.discard(wt, wt, ["a.txt", "new.txt"]);
  assert.equal(wt.get("a.txt"), "1\n");
  assert.equal(wt.get("new.txt"), null);
  const ig = createIgnore((p) => ({ ".gitignore": "/root.txt\ndocs/**/tmp\n*.tmp\n" }[p] ?? null), [".gitignore"]);
  assert.ok(ig("root.txt") && !ig("sub/root.txt") && ig("docs/a/b/tmp") && ig("x/y.tmp"));
});

test("branches, checkout, fast-forward and tags", () => {
  const r = GitRepo.init(new Map());
  const wt = tree({ "a.txt": "1\n" });
  const c1 = commit(r, wt, "one", 1);
  r.checkoutNewBranch("feature", wt, wt);
  assert.equal(r.head().branch, "feature");
  wt.m.set("b.txt", "b\n");
  const c2 = commit(r, wt, "feature work", 2);
  r.checkout("main", wt, wt);
  assert.equal(wt.get("b.txt"), null);
  assert.equal(r.head().oid, c1);
  const m = r.merge("feature", wt, wt, { author: me });
  assert.equal(m.result, "fast-forward");
  assert.equal(wt.get("b.txt"), "b\n");
  assert.equal(r.head().oid, c2);
  assert.equal(r.merge("feature", wt, wt).result, "up-to-date");
  r.createTag("v1", { message: "Release", tagger: { ...me, ts: 1, tz: "+0000" } });
  r.createTag("light");
  assert.deepEqual(r.tags().map((t) => [t.name, t.annotated]), [["light", false], ["v1", true]]);
  assert.equal(r.resolve("v1"), c2);
  r.deleteBranch("feature");
  assert.throws(() => r.deleteBranch("main"), (e) => e.code === "CURRENT_BRANCH");
  assert.equal(validRefName("a b"), false);
  assert.equal(validRefName("feature/x-1"), true);
});

test("checkout refuses to overwrite uncommitted changes", () => {
  const r = GitRepo.init(new Map());
  const wt = tree({ "a.txt": "1\n" });
  commit(r, wt, "one", 1);
  r.checkoutNewBranch("other", wt, wt);
  wt.m.set("a.txt", "other\n");
  commit(r, wt, "other", 2);
  r.checkout("main", wt, wt);
  wt.m.set("a.txt", "dirty\n");
  assert.throws(() => r.checkout("other", wt, wt), (e) => e instanceof GitError && e.code === "DIRTY");
  r.checkout("other", wt, wt, { force: true });
  assert.equal(wt.get("a.txt"), "other\n");
});

test("three-way merge: clean merge commit and conflicts", () => {
  const r = GitRepo.init(new Map());
  const wt = tree({ "a.txt": "1\n2\n3\n4\n5\n6\n7\n", "b.txt": "b\n" });
  commit(r, wt, "base", 1);
  r.checkoutNewBranch("topic", wt, wt);
  wt.m.set("a.txt", "1\n2\n3\n4\n5\n6\nseven\n");
  wt.m.set("c.txt", "c\n");
  commit(r, wt, "topic", 2);
  r.checkout("main", wt, wt);
  wt.m.set("a.txt", "one\n2\n3\n4\n5\n6\n7\n");
  const mainC = commit(r, wt, "main", 3);
  let res = r.merge("topic", wt, wt, { author: me, date: at(4) });
  assert.equal(res.result, "merged");
  assert.equal(wt.get("a.txt"), "one\n2\n3\n4\n5\n6\nseven\n");
  assert.equal(wt.get("c.txt"), "c\n");
  assert.equal(r.readCommit(r.head().oid).parents.length, 2);
  assert.equal(r.readCommit(r.head().oid).parents[0], mainC);

  // conflict
  r.checkoutNewBranch("x", wt, wt);
  wt.m.set("b.txt", "from x\n");
  commit(r, wt, "x", 5);
  r.checkout("main", wt, wt);
  wt.m.set("b.txt", "from main\n");
  commit(r, wt, "m", 6);
  res = r.merge("x", wt, wt, { author: me });
  assert.equal(res.result, "conflict");
  assert.deepEqual(res.conflicts, ["b.txt"]);
  assert.match(wt.get("b.txt"), /<<<<<<< main\nfrom main\n=======\nfrom x\n>>>>>>> x\n/);
  assert.throws(() => r.commit({ message: "m", author: me }), (e) => e.code === "CONFLICTS");
  assert.ok(r.status(wt).changes.find((c) => c.path === "b.txt").conflict);
  assert.throws(() => r.stage(wt, ["b.txt"]), (e) => e.code === "CONFLICT_MARKERS");
  wt.m.set("b.txt", "resolved\n");
  r.stage(wt, ["b.txt"]);
  const merged = r.commit({ message: "Merge x", author: me, date: at(7) });
  assert.equal(r.readCommit(merged).parents.length, 2);
  assert.equal(r.mergeState(), null);
  // abort
  r.checkoutNewBranch("y", wt, wt);
  wt.m.set("b.txt", "y\n");
  commit(r, wt, "y", 8);
  r.checkout("main", wt, wt);
  wt.m.set("b.txt", "mm\n");
  commit(r, wt, "mm", 9);
  assert.equal(r.merge("y", wt, wt).result, "conflict");
  r.abortMerge(wt, wt);
  assert.equal(wt.get("b.txt"), "mm\n");
  assert.equal(r.mergeState(), null);
  assert.equal(r.status(wt).changes.length, 0);
});

test("restore a file from an older commit; reset", () => {
  const r = GitRepo.init(new Map());
  const wt = tree({ "a.txt": "v1\n" });
  const c1 = commit(r, wt, "v1", 1);
  wt.m.set("a.txt", "v2\n");
  commit(r, wt, "v2", 2);
  r.restoreFile("a.txt", c1, wt, wt);
  assert.equal(wt.get("a.txt"), "v1\n");
  assert.equal(r.status(wt).changes[0].unstaged, "M");
  assert.throws(() => r.restoreFile("nope.txt", c1, wt, wt), (e) => e.code === "NO_FILE");
  r.reset(c1, wt, wt, { hard: true });
  assert.equal(r.head().oid, c1);
  assert.equal(r.status(wt).changes.length, 0);
});

test("binary files round-trip and the index is a valid DIRC file", () => {
  const r = GitRepo.init(new Map());
  const png = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 255]);
  const wt = tree({ "logo.png": png });
  commit(r, wt, "logo", 1);
  const idx = r.files.get("index");
  assert.equal(new TextDecoder().decode(idx.subarray(0, 4)), "DIRC");
  assert.equal(r.readIndex().get("logo.png").size, 8);
  assert.deepEqual([...r.readBlob(r.readIndex().get("logo.png").oid)], [...png]);
});

test("Myers diff, hunks and unified output", () => {
  const a = splitLines("a\nb\nc\nd\ne\nf\ng\nh\n");
  const b = splitLines("a\nB\nc\nd\ne\nf\ng\nh\ni\n");
  assert.deepEqual(diffBlocks(a, b), [{ aStart: 1, aLen: 1, bStart: 1, bLen: 1 }, { aStart: 8, aLen: 0, bStart: 8, bLen: 1 }]);
  assert.deepEqual(diffBlocks([], ["x"]), [{ aStart: 0, aLen: 0, bStart: 0, bLen: 1 }]);
  const u = unifiedDiff("f.txt", "a\nb\nc\n", "a\nx\nc\n");
  assert.equal(u, "--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+x\n c\n");
  assert.equal(diffHunks("1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n", "1\nX\n3\n4\n5\n6\n7\n8\n9\n10\n11\nY\n", 1).length, 2);
  assert.deepEqual(lineMarks("a\nb\nc\n", "a\nB\nc\nd\n"), { added: [4], modified: [2], removed: [] });
  assert.deepEqual(lineMarks("a\nb\nc\n", "a\nc\n").removed, [1]);
  // random round trip: applying the blocks reproduces b
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 40; t++) {
    const x = Array.from({ length: 30 }, () => String(Math.floor(rnd() * 6)));
    const y = Array.from({ length: 30 }, () => String(Math.floor(rnd() * 6)));
    const out = [];
    let i = 0;
    for (const k of diffBlocks(x, y)) {
      while (i < k.aStart) out.push(x[i++]);
      out.push(...y.slice(k.bStart, k.bStart + k.bLen));
      i += k.aLen;
    }
    while (i < x.length) out.push(x[i++]);
    assert.deepEqual(out, y);
  }
});

test("merge3 rules", () => {
  assert.deepEqual(merge3("a\nb\nc\n", "a\nB\nc\n", "a\nb\nc\nd\n"), { text: "a\nB\nc\nd\n", conflicts: 0, clean: true });
  const c = merge3("a\nb\nc\n", "a\nX\nc\n", "a\nY\nc\n");
  assert.equal(c.conflicts, 1);
  assert.equal(c.text, "a\n<<<<<<< ours\nX\n=======\nY\n>>>>>>> theirs\nc\n");
  assert.equal(merge3("a\n", "a\nb\n", "a\nb\n").clean, true);
});

test("export produces a real .git folder that Git accepts", { skip: spawnSync("git", ["--version"]).status !== 0 }, () => {
  const r = GitRepo.init(new Map());
  const wt = tree({ "index.html": "<h1>Hi</h1>\n", "css/a.css": "a{}\n", "logo.png": new Uint8Array([0, 1, 2, 3, 250]) });
  commit(r, wt, "First commit", 1);
  wt.m.set("css/a.css", "a{color:red}\n");
  commit(r, wt, "Second commit", 2);
  r.checkoutNewBranch("dev", wt, wt);
  r.createTag("v1", { message: "rel", tagger: { ...me, ts: 1700000000, tz: "+0000" } });
  const dir = mkdtempSync(join(tmpdir(), "ofini-git-"));
  try {
    for (const [p, b] of exportRepoFiles(r, wt)) {
      const f = join(dir, p);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, b);
    }
    const git = (...a) => spawnSync("git", ["-c", "safe.directory=*", ...a], { cwd: dir, encoding: "utf8" });
    const fsck = git("fsck", "--strict");
    assert.equal(fsck.status, 0, fsck.stderr);
    assert.equal(git("log", "--format=%s", "dev").stdout.trim(), "Second commit\nFirst commit");
    assert.equal(git("rev-parse", "HEAD").stdout.trim(), r.head().oid);
    assert.equal(git("status", "--porcelain").stdout.trim(), "", git("status", "--porcelain").stdout);
    assert.equal(git("branch", "--show-current").stdout.trim(), "dev");
    assert.match(git("tag", "-n").stdout, /v1\s+rel/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
