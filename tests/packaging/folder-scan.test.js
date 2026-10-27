// Folder scan used when the OS hands OpenFini a folder: ignore rules, caps and path shape, with a fake file system.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isIgnoredDir, scanFolder } from "../../app/src/platform/folder-scan.js";

/** A tiny in-memory file system: { "/p/site": { "index.html": "x", css: { "a.css": "y" } } } (strings are files). */
function fakeFs(tree, { sizes = {}, link = [], broken = [] } = {}) {
  const at = (path) => path.split(/[\\/]+/).filter(Boolean).reduce((node, part) => node?.[part], tree);
  return {
    readDir: async (path) => {
      if (broken.includes(path)) throw new Error("forbidden path");
      const node = at(path);
      return Object.entries(node).map(([name, v]) => ({ name, isDirectory: typeof v === "object", isFile: typeof v === "string", isSymlink: link.includes(name) }));
    },
    stat: async (path) => ({ size: sizes[path] ?? at(path).length }),
    readFile: async (path) => new TextEncoder().encode(at(path)),
  };
}

describe("scanFolder", () => {
  const tree = { p: { site: { "index.html": "<h1>", css: { "a.css": "a{}" }, ".git": { config: "x" }, node_modules: { lib: { "i.js": "x" } }, ".env": "SECRET", dist: { "o.js": "x" }, "logo.svg": "<svg/>" } } };

  it("walks sorted, skips dot files, build folders and node_modules, and prefixes the folder name", async () => {
    const out = await scanFolder(fakeFs(tree), "/p/site");
    assert.equal(out.name, "site");
    assert.deepEqual(out.files.map((f) => f.path), ["site/css/a.css", "site/index.html", "site/logo.svg"]);
    assert.equal(out.stats.truncated, false);
    assert.ok(out.stats.ignored >= 4);
    assert.ok(out.files[0].bytes instanceof Uint8Array);
  });

  it("works with Windows paths and a drive root name", async () => {
    const out = await scanFolder(fakeFs({ "C:": { Work: { "a.md": "# a" } } }), "C:\\Work");
    assert.deepEqual(out.files.map((f) => f.path), ["Work/a.md"]);
  });

  it("never follows symbolic links", async () => {
    const out = await scanFolder(fakeFs({ s: { real: "x", loop: { a: "y" } } }, { link: ["loop"] }), "/s");
    assert.deepEqual(out.files.map((f) => f.path), ["s/real"]);
  });

  it("stops at the file-count and total-size caps and reports it", async () => {
    const many = { m: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.txt`, "xxxx"])) };
    const byCount = await scanFolder(fakeFs(many), "/m", { maxFiles: 3 });
    assert.equal(byCount.files.length, 3);
    assert.equal(byCount.stats.truncated, true);
    const bySize = await scanFolder(fakeFs(many), "/m", { maxTotalBytes: 9 });
    assert.equal(bySize.files.length, 2);
    assert.equal(bySize.stats.truncated, true);
  });

  it("skips single files above the per-file cap", async () => {
    const out = await scanFolder(fakeFs({ b: { "big.psd": "x", "ok.txt": "y" } }, { sizes: { "/b/big.psd": 999 } }), "/b", { maxFileBytes: 100 });
    assert.deepEqual(out.files.map((f) => f.path), ["b/ok.txt"]);
    assert.equal(out.stats.tooLarge, 1);
  });

  it("counts unreadable folders instead of throwing, and honors the depth limit and progress", async () => {
    const seen = [];
    const deep = { d: { a: { b: { c: { "x.txt": "x" } } }, "top.txt": "t" } };
    const out = await scanFolder(fakeFs(deep), "/d", { maxDepth: 2, onProgress: (p) => seen.push(p.files) });
    assert.deepEqual(out.files.map((f) => f.path), ["d/top.txt"]);
    assert.deepEqual(seen, [1]);
    const bad = await scanFolder(fakeFs({ x: {} }, { broken: ["/x"] }), "/x");
    assert.equal(bad.files.length, 0);
    assert.equal(bad.stats.unreadable, 1);
  });

  it("knows the ignored folder names", () => {
    for (const n of [".git", "node_modules", "dist", "build", "target", "__pycache__"]) assert.ok(isIgnoredDir(n), n);
    for (const n of ["src", "assets", "vendor", "images"]) assert.ok(!isIgnoredDir(n), n);
  });
});
