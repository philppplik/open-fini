import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePath, dirname, basename, extname, joinPath, resolveRef, relativeRef, mimeOf, isTextPath, languageOf,
  sanitizeFileName, uniquePath, isExternalRef,
} from "../../app/src/engine/web/paths.js";
import { bytesToBase64, utf8Bytes, utf8Text, lineOf } from "../../app/src/engine/web/bytes.js";

test("normalizePath resolves dots, slashes and never escapes the root", () => {
  assert.equal(normalizePath("a/./b/../c.txt"), "a/c.txt");
  assert.equal(normalizePath("/a//b/"), "a/b");
  assert.equal(normalizePath("a\\b\\c.css"), "a/b/c.css");
  assert.equal(normalizePath("../x"), "x");
  assert.equal(normalizePath("a/../../../x/y"), "x/y");
  assert.equal(normalizePath(""), "");
  assert.equal(normalizePath(null), "");
});

test("dirname, basename, extname, joinPath", () => {
  assert.equal(dirname("a/b/c.css"), "a/b");
  assert.equal(dirname("c.css"), "");
  assert.equal(basename("a/b/c.css"), "c.css");
  assert.equal(basename("a/b/c.css", ".css"), "c");
  assert.equal(basename("a/b/.css", ".css"), ".css");
  assert.equal(extname("a/b/c.min.js"), ".js");
  assert.equal(extname("a/.gitignore"), "");
  assert.equal(extname("Makefile"), "");
  assert.equal(joinPath("a", "", "../b", "c.js"), "b/c.js");
});

test("resolveRef handles relative, root-relative, query, hash and external references", () => {
  assert.deepEqual(resolveRef("pages/a.html", "../css/s.css?v=2#x"), { path: "css/s.css", query: "?v=2", hash: "#x" });
  assert.deepEqual(resolveRef("index.html", "/img/a.png"), { path: "img/a.png", query: "", hash: "" });
  assert.deepEqual(resolveRef("posts/p.html", "img/my%20pic.png"), { path: "posts/img/my pic.png", query: "", hash: "" });
  assert.deepEqual(resolveRef("a/b.html", "other.html#top"), { path: "a/other.html", query: "", hash: "#top" });
  for (const ext of ["https://x.com/a", "http://x", "//cdn.x/a.js", "data:text/plain,hi", "blob:abc", "mailto:a@b.c", "tel:123", "javascript:void(0)", "#top", "", "  "]) {
    assert.equal(resolveRef("index.html", ext), null, ext);
  }
  assert.equal(isExternalRef("HTTPS://X"), true);
  assert.equal(isExternalRef("a/b"), false);
});

test("relativeRef", () => {
  assert.equal(relativeRef("pages/a.html", "css/s.css"), "../css/s.css");
  assert.equal(relativeRef("index.html", "css/s.css"), "css/s.css");
  assert.equal(relativeRef("a/b/c.html", "a/d.png"), "../d.png");
  assert.equal(relativeRef("a/b.html", "a/c.html"), "c.html");
  assert.equal(relativeRef("a/b.html", "a/x/y.html"), "x/y.html");
  const from = "docs/guide/page.html";
  const to = "assets/logo.svg";
  assert.equal(resolveRef(from, relativeRef(from, to)).path, to);
});

test("mime types, text detection and language", () => {
  assert.equal(mimeOf("a/b.HTML"), "text/html");
  assert.equal(mimeOf("x.svg"), "image/svg+xml");
  assert.equal(mimeOf("x.woff2"), "font/woff2");
  assert.equal(mimeOf("x.webmanifest"), "application/manifest+json");
  assert.equal(mimeOf("x.unknown"), "application/octet-stream");
  for (const p of ["a.html", "a.css", "a.js", "a.mjs", "a.json", "a.svg", "a.txt", "a.md", "a.xml", "a.webmanifest", "a.csv"]) assert.ok(isTextPath(p), p);
  for (const p of ["a.png", "a.woff2", "a.pdf", "a.mp4"]) assert.ok(!isTextPath(p), p);
  assert.equal(languageOf("a.html"), "html");
  assert.equal(languageOf("a.htm"), "html");
  assert.equal(languageOf("a.css"), "css");
  assert.equal(languageOf("a.mjs"), "javascript");
  assert.equal(languageOf("a.json"), "json");
  assert.equal(languageOf("a.md"), "markdown");
  assert.equal(languageOf("a.svg"), "xml");
  assert.equal(languageOf("a.bin"), "text");
});

test("sanitizeFileName and uniquePath", () => {
  assert.equal(sanitizeFileName('a<b>:c"d/e\\f|g?h*.txt'), "abcdefgh.txt");
  assert.equal(sanitizeFileName("  ..name.. "), "name");
  assert.equal(sanitizeFileName("..."), "");
  assert.equal(sanitizeFileName("con.txt"), "_con.txt");
  assert.equal(uniquePath("a.css", ["b.css"]), "a.css");
  assert.equal(uniquePath("a.css", ["a.css"]), "a-2.css");
  assert.equal(uniquePath("css/a.css", ["css/a.css", "css/a-2.css"]), "css/a-3.css");
  assert.equal(uniquePath("A.css", new Set(["a.CSS"])), "A-2.css");
  assert.equal(uniquePath("Makefile", ["Makefile"]), "Makefile-2");
});

test("bytes helpers", () => {
  const enc = (s) => bytesToBase64(utf8Bytes(s));
  for (const s of ["", "f", "fo", "foo", "foob", "fooba", "foobar", "héllo wörld ✓"]) {
    assert.equal(enc(s), Buffer.from(s, "utf8").toString("base64"), JSON.stringify(s));
  }
  const big = new Uint8Array(100000).map((_, i) => (i * 31) & 255);
  assert.equal(bytesToBase64(big), Buffer.from(big).toString("base64"));
  assert.equal(utf8Text(utf8Bytes("﻿hi")), "hi");
  assert.equal(lineOf("a\nb\nc", 0), 1);
  assert.equal(lineOf("a\nb\nc", 2), 2);
  assert.equal(lineOf("a\nb\nc", 4), 3);
});
