// Guards the wiki/ folder: unique page names, no broken internal links, every page reachable from the sidebar,
// a summary and a "See also" section on every content page, no private paths, tagged code fences, and a
// generated shortcuts page that is current.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WIKI_DIR, internalLinks, listPages, pageKey, stripCode, validate } from "../../scripts/wiki-sync.mjs";

const pages = listPages();
const read = (p) => readFileSync(join(WIKI_DIR, p), "utf8").replace(/\r\n/g, "\n");
const SPECIAL = new Set(["_Sidebar.md", "_Footer.md"]);

test("wiki: required pages exist and names are unique", () => {
  for (const p of ["Home.md", "_Sidebar.md", "_Footer.md", "Wiki-Style-Guide.md", "Keyboard-Shortcuts.md"]) assert.ok(pages.includes(p), p);
  const keys = pages.map((p) => pageKey(p.replace(/\.md$/, "")));
  assert.equal(new Set(keys).size, keys.length);
  for (const p of pages) assert.match(p, /^[A-Za-z0-9_][A-Za-z0-9_-]*\.md$/, `page file name ${p}`);
});

test("wiki: every internal link resolves and every page is reachable from the sidebar", () => {
  const { problems } = validate();
  assert.deepEqual(problems, []);
});

test("wiki: link parser understands both syntaxes and ignores code", () => {
  const links = internalLinks("See [[Vector Studio]], [[the pen|Pixel Studio#tools]], [x](Home) and [y](https://example.org) and `[[Not A Link]]`.\n```md\n[[Also Not]]\n```\n");
  assert.deepEqual(links.map((l) => l.target), ["Vector Studio", "Pixel Studio", "Home"]);
  assert.equal(stripCode("a `b` c").includes("b"), false);
});

test("wiki: content pages have a title, a summary paragraph and a See also section", () => {
  for (const p of pages) {
    if (SPECIAL.has(p)) continue;
    const md = read(p);
    assert.match(md, /^# .+/m, `${p}: no H1`);
    const afterTitle = md.split("\n").slice(1).join("\n").trimStart();
    assert.ok(/^[^#>|\-*`\n]/.test(afterTitle), `${p}: the first thing after the title must be a summary paragraph`);
    if (p !== "Home.md") assert.match(md, /^## See also$/m, `${p}: no "See also" section`);
  }
});

test("wiki: no private paths, personal data or untagged code fences", () => {
  const bad = [/[A-Za-z]:\\Users\\/i, /\/home\/[a-z0-9_-]+\//i, /\/Users\/[a-z0-9_-]+\//i, /Downloads[\\/]OpenFini/i, /philipp\.paulik/i, /AppData[\\/](Local|Roaming)/i, /\.claude/i];
  for (const p of pages) {
    const md = read(p);
    for (const re of bad) assert.doesNotMatch(md, re, `${p}: private path or data (${re})`);
    let open = false;
    for (const line of md.split("\n")) {
      const m = line.match(/^(```|~~~)(.*)$/);
      if (!m) continue;
      if (!open) {
        assert.ok(m[2].trim().length > 0, `${p}: untagged code fence`);
        open = true;
      } else open = false;
    }
    assert.equal(open, false, `${p}: unclosed code fence`);
  }
});

test("wiki: pages stay under 500 lines and avoid emoji", () => {
  for (const p of pages) {
    const md = read(p);
    assert.ok(md.split("\n").length <= 500, `${p} is longer than 500 lines`);
    assert.doesNotMatch(md, /\p{Extended_Pictographic}/u, `${p}: emoji`);
  }
});

test("wiki: the shortcuts page is current (npm run wiki:shortcuts)", async () => {
  const { buildPage } = await import("../../scripts/wiki-shortcuts.mjs");
  assert.equal(read("Keyboard-Shortcuts.md"), await buildPage());
});
