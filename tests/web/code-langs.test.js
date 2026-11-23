// More file types in the Code studio: the language table, the open dispatch, MIME types and the text round trip of
// source files through "save back to the original format".
import test from "node:test";
import assert from "node:assert/strict";
import { CODE_LANGUAGES, TEXT_FILE_EXTS, codeLanguageOf, isCodeFileName } from "../../app/src/engine/web/code-langs.js";
import { languageOf, isTextPath, mimeOf } from "../../app/src/engine/web/paths.js";
import { isTextDocumentName, TEXT_DOC_EXTS } from "../../app/src/core/text-docs.js";
import { Doc } from "../../app/src/core/doc.js";
import { WebProject } from "../../app/src/core/web.js";
import { decodeText, encodeText, describeSource, canSaveAsSource } from "../../app/src/core/source-format.js";
import { OPEN_FILTERS } from "../../app/src/core/io.js";
import { existsSync } from "node:fs";

test("common source and config files have a language", () => {
  const cases = {
    "a.py": "python", "x/run.sh": "shell", "build.bat": "batch", "build.CMD": "batch", "setup.ps1": "powershell", "App.tsx": "javascript", "App.jsx": "javascript",
    "index.php": "php", "lib.rb": "ruby", "main.go": "go", "main.rs": "rust", "Main.java": "java", "Main.kt": "kotlin", "App.swift": "swift",
    "a.c": "c", "a.h": "c", "a.cpp": "cpp", "a.hpp": "cpp", "Program.cs": "csharp", "init.lua": "lua", "schema.sql": "sql", "Cargo.toml": "toml",
    "php.ini": "properties", "ci.yaml": "yaml", "ci.yml": "yaml", "pom.xml": "xml", "App.vue": "html", "App.svelte": "html", "Dockerfile": "dockerfile",
    "api.dockerfile": "dockerfile", "Dockerfile.dev": "dockerfile", ".env": "properties", ".env.local": "properties", "server.log": "log",
    ".gitignore": "ignore", "sub/.gitignore": "ignore", "Makefile": "makefile", "data.csv": "csv", "data.tsv": "csv", "styles.scss": "scss",
  };
  for (const [p, lang] of Object.entries(cases)) assert.equal(languageOf(p), lang, p);
  // the ids the formatter, linter and preview rely on are unchanged
  assert.equal(languageOf("index.html"), "html");
  assert.equal(languageOf("a.css"), "css");
  assert.equal(languageOf("a.mjs"), "javascript");
  assert.equal(languageOf("site.webmanifest"), "json");
  assert.equal(languageOf("doc.tex"), "latex");
  assert.equal(languageOf("a.properties"), "properties");
  assert.equal(languageOf("logo.svg"), "xml");
  assert.equal(languageOf("unknown.zzz"), "text");
  assert.equal(languageOf("photo.png"), "text");
});

test("source files are text in projects, with sensible MIME types", () => {
  for (const p of ["a.py", "Dockerfile", ".gitignore", "run.bat", "x.rs", "LICENSE", "README", "CMakeLists.txt"]) assert.equal(isTextPath(p), true, p);
  for (const p of ["a.png", "a.woff2", "a.zip", "noext"]) assert.equal(isTextPath(p), false, p);
  assert.equal(mimeOf("a.py"), "text/x-python");
  assert.equal(mimeOf("Makefile"), "text/x-makefile");
  assert.equal(mimeOf("a.html"), "text/html");
  assert.equal(mimeOf("a.tga"), "image/x-tga");
  assert.equal(mimeOf("a.bin"), "application/octet-stream");
});

test("File ▸ Open sends every listed type to the Code studio, but never SVG or .ofini", () => {
  for (const p of ["a.py", "a.ps1", "a.bat", "a.cmd", "a.sh", "a.tsx", "a.php", "a.rb", "a.go", "a.rs", "a.java", "a.kt", "a.swift", "a.c", "a.h", "a.cpp", "a.cs", "a.lua", "a.sql", "a.toml", "a.ini", "a.yaml", "a.xml", "a.vue", "a.svelte", "a.dockerfile", "Dockerfile", ".env", "x.log", ".gitignore", "a.csv", "a.tsv", "a.c++"]) {
    assert.equal(isTextDocumentName(p), true, p);
  }
  for (const p of ["a.svg", "a.ofini", "a.docx", "a.png", "x.zip", "a.unknown", "noext"]) assert.equal(isTextDocumentName(p), false, p);
  assert.ok(!TEXT_DOC_EXTS.includes("svg"));
  const all = OPEN_FILTERS[0].extensions;
  for (const e of ["py", "rs", "go", "bat", "ps1", "tga", "toml"]) assert.ok(all.includes(e), e);
});

test("every row is well formed and every icon is vendored", () => {
  const seen = new Set();
  for (const l of CODE_LANGUAGES) {
    assert.ok(l.id && l.name && l.mime && l.icon, JSON.stringify(l));
    for (const e of l.ext) {
      assert.match(e, /^[a-z0-9+_-]+$/, e);
      assert.ok(!seen.has(e), `duplicate extension ${e}`);
      seen.add(e);
    }
    assert.ok(existsSync(new URL(`../../app/vendor/shoelace/assets/icons/${l.icon}.svg`, import.meta.url)), l.icon);
  }
  assert.equal(TEXT_FILE_EXTS.length, seen.size);
  assert.equal(isCodeFileName("x.py"), true);
  assert.equal(codeLanguageOf(""), null);
});

test("every stream mode a row names exists in the on-demand bundle or the app modes", async () => {
  const modes = await import("../../app/vendor/codemirror-modes/modes.js");
  for (const l of CODE_LANGUAGES) {
    if (!l.mode || l.mode.startsWith("builtin:") || l.mode.startsWith("app:")) continue;
    assert.equal(typeof modes[l.mode]?.token, "function", `${l.name}: ${l.mode}`);
  }
  assert.equal(typeof modes.clike, "function"); // the PHP mode is built on it
});

function textDoc(name, bytes) {
  const { text, bom, eol } = decodeText(bytes);
  const doc = new Doc({ name, studio: "code" });
  doc.web = WebProject.fromFiles({ [name]: text }, { entry: name });
  const src = describeSource({ name, bytes }, doc);
  doc.source = { ...src, bom, eol, entry: name, original: bytes, snapshot: text };
  return doc;
}

test("source files save back in their own format, byte for byte when unchanged and with CRLF kept when edited", () => {
  const enc = (s) => new TextEncoder().encode(s);
  for (const [name, content] of [
    ["main.py", "def f():\n    return 1\n"],
    ["build.bat", "@echo off\r\nset X=1\r\n"],
    ["deploy.ps1", "﻿Write-Host 'hi'\r\n"],
    ["Dockerfile", "FROM node:20\nRUN npm ci\n"],
    [".gitignore", "node_modules/\n*.log\n"],
    ["lib.rs", "fn main() {}\n"],
    ["data.tsv", "a\tb\n1\t2\n"],
  ]) {
    const bytes = enc(content);
    const doc = textDoc(name, bytes);
    assert.equal(doc.source.kind, "text", name);
    const d = canSaveAsSource(doc);
    assert.equal(d.ok, true, name);
    assert.equal(d.name, name);
    assert.deepEqual([...encodeText(doc.web.files.get(name).text, doc.source)], [...bytes], name);
  }
  const bat = textDoc("x.bat", enc("echo 1\r\necho 2\r\n"));
  assert.equal(new TextDecoder().decode(encodeText("echo 1\necho 3\n", bat.source)), "echo 1\r\necho 3\r\n");
  assert.equal(canSaveAsSource(textDoc("Dockerfile", enc("FROM x\n"))).label, "Dockerfile");
  assert.equal(canSaveAsSource(textDoc("a.py", enc("x=1\n"))).label, ".py");
});
