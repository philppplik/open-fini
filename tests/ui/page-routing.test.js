import { test } from "node:test";
import assert from "node:assert/strict";
import { previewPageFor, isHtmlPath } from "../../app/src/ui/code/page-routing.js";

const pages = ["index.html", "about.html", "docs/guide.htm"];

test("activating another HTML page switches the preview to it", () => {
  assert.equal(previewPageFor("about.html", { pages, current: "index.html" }), "about.html");
  assert.equal(previewPageFor("docs/guide.htm", { pages, current: "about.html" }), "docs/guide.htm");
});

test("the page already shown, CSS, JS, images and no file keep the preview", () => {
  assert.equal(previewPageFor("index.html", { pages, current: "index.html" }), null);
  for (const f of ["style.css", "app.js", "logo.png", null, ""]) assert.equal(previewPageFor(f, { pages, current: "about.html" }), null);
});

test("keepPage (search hits, style rule jumps) and files that are not project pages do not switch", () => {
  assert.equal(previewPageFor("about.html", { pages, current: "index.html", keepPage: true }), null);
  assert.equal(previewPageFor("partials/header.html", { pages, current: "index.html" }), null);
});

test("isHtmlPath", () => {
  assert.ok(isHtmlPath("a.HTML") && isHtmlPath("b.htm") && !isHtmlPath("c.css") && !isHtmlPath(undefined));
});
