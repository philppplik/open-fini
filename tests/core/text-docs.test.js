import test from "node:test";
import assert from "node:assert/strict";
import { isTextDocumentName } from "../../app/src/core/text-docs.js";

test("text documents are recognized by their real extension only", () => {
  for (const n of ["notes.txt", "README.md", "a.json", "config.ini", "x.TEX", "page.html", "data.csv"]) assert.equal(isTextDocumentName(n), true, n);
});

test("regression: .ofini documents are never text documents (an unescaped dot matched 'ini' at the end of '.ofini')", () => {
  for (const n of ["a.ofini", "Untitled.ofini", "B.OFINI", "x.ini.ofini", "poster.ofini"]) assert.equal(isTextDocumentName(n), false, n);
});

test("names that merely end in the letters of an extension are not text documents", () => {
  for (const n of ["xtxt", "notmd", "jsonx", "a.docx", "archive.zip", ""]) assert.equal(isTextDocumentName(n), false, n);
});
