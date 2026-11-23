import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, performanceFacts } from "../../site/build.mjs";
import { highlights, parseChangelog, plain } from "../../site/lib/changelog.js";
import { splitSections } from "../../site/lib/content.js";
import { html, raw } from "../../site/lib/html.js";
import { LANGS, loadStrings, missingKeys, translator, urls } from "../../site/lib/i18n.js";
import { STUDIOS } from "../../site/lib/studios.js";

const SITE = new URL("../../site/", import.meta.url);

test("every template string exists in every language", () => {
  const strings = loadStrings(fileURLToPath(new URL("i18n", SITE)));
  for (const r of missingKeys(strings)) {
    assert.deepEqual(r.missing, [], `${r.lang} lacks keys`);
    assert.deepEqual(r.extra, [], `${r.lang} has keys English does not`);
  }
  const t = translator(strings, "de");
  assert.equal(t("label.comingIn", { v: "1.3.x" }), "Kommt mit 1.3.x");
  assert.throws(() => t("no.such.key"));
});

test("every page has its copy in English and German", () => {
  const names = ["home", "features", "download", ...STUDIOS.map((s) => `studios/${s.id}`)];
  for (const name of names) for (const lang of LANGS) assert.ok(existsSync(new URL(`content/${name}.${lang}.md`, SITE)), `${name}.${lang}.md`);
});

test("URLs carry the base path and the language prefix", () => {
  const u = urls("/open-fini", "https://philppplik.github.io");
  assert.equal(u.page("en"), "/open-fini/");
  assert.equal(u.page("de", "studios/pixel/"), "/open-fini/de/studios/pixel/");
  assert.equal(u.asset("site.css"), "/open-fini/assets/site.css");
  assert.equal(u.absolute("de", "download/"), "https://philppplik.github.io/open-fini/de/download/");
});

test("templates escape interpolated values unless they are raw", () => {
  assert.equal(html`<p title="${'a"b'}">${"<x>"}${raw("<b>ok</b>")}${[1, null, false, 2]}</p>`.value, '<p title="a&quot;b">&lt;x&gt;<b>ok</b>12</p>');
});

test("content sections keep stable ids and icons across languages", () => {
  const { sections } = splitSections("Intro\n\n## Files stay yours {files folder2-open}\n\nText.\n\n## Plain heading\n\nMore.");
  assert.deepEqual(sections.map((s) => [s.id, s.icon, s.title]), [["files", "folder2-open", "Files stay yours"], ["plain-heading", null, "Plain heading"]]);
});

test("reads versions and highlights from the changelog", () => {
  const text = "# Changelog\n\n## [Unreleased]\n\n### Added\n- Later\n\n## [1.2.0] — Docking panels\n\n### Fixed\n- A fix\n\n### Added\n- **In-app updates** ([docs](docs/updates.md)): more\n- `ofini`, a command line tool (`npm link`): info\n\n## [1.1.0] — Older\n";
  const versions = parseChangelog(text);
  assert.deepEqual(versions.map((v) => [v.version, v.title]), [["1.2.0", "Docking panels"], ["1.1.0", "Older"]]);
  assert.deepEqual(highlights(versions[0]), ["In-app updates", "ofini, a command line tool"]);
  assert.equal(plain("**Bold** [link](x) and `code`"), "Bold link and code");
});

test("start-up numbers come from docs/performance.md", () => {
  const facts = performanceFacts(readFileSync(new URL("../../docs/performance.md", import.meta.url), "utf8"));
  assert.match(facts.fcp, /^\d+ ms$/);
  assert.match(facts.dcl, /^\d+ ms$/);
});

test("builds the whole site offline with both languages and no broken links", async () => {
  const out = mkdtempSync(join(tmpdir(), "ofini-site-"));
  try {
    const { pages } = await build({ base: "/open-fini/", origin: "https://example.test", out, offline: true, update: false, strict: true, quiet: true });
    const paths = ["", "studios/", ...STUDIOS.map((s) => `studios/${s.id}/`), "features/", "download/"];
    assert.equal(pages.length, paths.length * LANGS.length);
    for (const p of paths) {
      for (const prefix of ["", "de/"]) assert.ok(existsSync(join(out, prefix, p, "index.html")), `${prefix}${p}`);
    }
    for (const f of ["404.html", "sitemap.xml", "robots.txt", "favicon.svg", "assets/icons.svg", "assets/site.css", "assets/js/site.js"]) assert.ok(existsSync(join(out, f)), f);
    const home = readFileSync(join(out, "index.html"), "utf8");
    assert.match(home, /<html lang="en-US">/);
    assert.match(home, /<link rel="alternate" hreflang="de" href="https:\/\/example.test\/open-fini\/de\/">/);
    assert.equal((home.match(/<h1\b/g) || []).length, 1);
    const de = readFileSync(join(out, "de", "studios", "proto", "index.html"), "utf8");
    assert.match(de, /<html lang="de-DE">/);
    assert.match(de, /Kommt mit 1\.3\.x/);
    // the download page is complete without JavaScript: the snapshot's files are in the table
    const dl = readFileSync(join(out, "download", "index.html"), "utf8");
    assert.match(dl, /_x64-setup\.exe/);
    assert.match(dl, /id="release-data"/);
    assert.ok(readdirSync(join(out, "assets", "shots")).length >= 28);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
