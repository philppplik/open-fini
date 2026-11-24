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
import { githubSlug, linkResolver, rewriteWikiLinks } from "../../site/lib/docs.js";
import { parseRoadmap } from "../../site/lib/extras.js";

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
  const names = ["home", "features", "download", "community", "press", "privacy", ...STUDIOS.map((s) => `studios/${s.id}`)];
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
    const paths = ["", "studios/", ...STUDIOS.map((s) => `studios/${s.id}/`), "features/", "download/", "changelog/", "roadmap/", "community/", "press/", "privacy/"];
    for (const p of paths) {
      for (const prefix of ["", "de/"]) assert.ok(existsSync(join(out, prefix, p, "index.html")), `${prefix}${p}`);
    }
    for (const f of ["404.html", "sitemap.xml", "robots.txt", "feed.xml", "favicon.svg", "assets/icons.svg", "assets/site.css", "assets/js/site.js", "assets/search.json", "press/openfini-press-kit.zip", "de/docs/index.html"]) {
      assert.ok(existsSync(join(out, f)), f);
    }
    // docs: every wiki page under /docs/, every docs/ page under /docs/dev/ (English only)
    const docsPages = pages.filter((p) => p.path.startsWith("docs/"));
    assert.ok(docsPages.filter((p) => p.lang === "en").length > 100);
    assert.ok(existsSync(join(out, "docs", "vector-studio", "index.html")));
    assert.ok(existsSync(join(out, "docs", "dev", "adr", "0001-desktop-shell-tauri", "index.html")));
    const doc = readFileSync(join(out, "docs", "vector-studio", "index.html"), "utf8");
    assert.match(doc, /href="\/open-fini\/docs\/keyboard-shortcuts\/"/, "[[Wiki Links]] point at site pages");
    assert.doesNotMatch(doc, /<link rel="alternate" hreflang="de"/, "English-only pages have no German alternate");
    assert.match(doc, /Edit on GitHub/);
    const index = JSON.parse(readFileSync(join(out, "assets", "search.json"), "utf8"));
    assert.ok(index.some((e) => e.t === "Vector Studio" && e.h.length > 0));
    // SEO: Open Graph, structured data, feed
    assert.match(readFileSync(join(out, "index.html"), "utf8"), /<meta property="og:image" content="https:\/\/example.test\/open-fini\/assets\/social\/home.jpg">/);
    assert.match(readFileSync(join(out, "download", "index.html"), "utf8"), /"@type":"SoftwareApplication"/);
    assert.match(readFileSync(join(out, "feed.xml"), "utf8"), /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
    for (const card of ["home", "docs", ...STUDIOS.map((s) => s.id)]) assert.ok(existsSync(join(out, "assets", "social", `${card}.jpg`)), card);
    // the roadmap is read from its concept page
    assert.match(readFileSync(join(out, "roadmap", "index.html"), "utf8"), /class="item__id">R1</);
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

test("docs links: wiki links, relative links and GitHub links become site URLs", () => {
  const docs = { bySource: new Map([["wiki/Quick-Start.md", { path: "docs/quick-start/" }], ["docs/security.md", { path: "docs/dev/security/" }]]) };
  const resolve = linkResolver("docs", docs, (p) => `/b/${p}`);
  assert.equal(resolve("security.md#app-lock", "link"), "/b/docs/dev/security/#app-lock");
  assert.equal(resolve("https://github.com/philppplik/open-fini/blob/main/wiki/Quick-Start.md", "link"), "/b/docs/quick-start/");
  assert.equal(resolve("../CHANGELOG.md", "link"), "https://github.com/philppplik/open-fini/blob/main/CHANGELOG.md");
  assert.equal(resolve("https://example.com/x", "link"), "https://example.com/x");
  assert.equal(resolve("#local", "link"), "#local");
  assert.equal(
    rewriteWikiLinks("See [[Quick Start]] and [[the tour|Quick Start]], not `[[Code]]`.", (n) => `/x/${n.replace(/ /g, "-")}`),
    "See [Quick Start](/x/Quick-Start) and [the tour](/x/Quick-Start), not `[[Code]]`.",
  );
  assert.equal(githubSlug("Snapping, guides and rulers"), "snapping-guides-and-rulers");
  assert.equal(githubSlug("R1 Publish and sign releases (Wave 0)"), "r1-publish-and-sign-releases-wave-0");
});

test("the roadmap table is read from the concept", () => {
  const road = parseRoadmap("Status: **concept**, not a plan.\n\n| # | Item | Theme | I | E | Score | Wave |\n| --- |\n| 1 | R1 Ship it | Trust | 5 | 1 | 9 | 0 |\n\n### R1 Ship it (Wave 0)\n");
  assert.deepEqual(road.items, [{ id: "R1", title: "Ship it", theme: "Trust", impact: 5, effort: 1, score: 9, wave: "0" }]);
  assert.equal(road.anchors.get("R1"), "r1-ship-it-wave-0");
});
