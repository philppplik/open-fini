import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { TEMPLATES, getTemplate } from "../../app/src/engine/web/templates.js";
import { parseHtml, getAttr, classList, elementText } from "../../app/src/engine/web/html.js";
import { parseCss, flattenRules, mediaOf, normalizeMedia } from "../../app/src/engine/web/css.js";
import { buildPreview } from "../../app/src/engine/web/preview.js";
import { buildSite } from "../../app/src/engine/web/site.js";
import { resolveRef, extname } from "../../app/src/engine/web/paths.js";
import { makeFiles } from "./_helpers.js";

const IDS = ["blank", "landing", "portfolio", "blog", "docs", "link-in-bio"];
const lines = (s) => s.split("\n").length;

test("six templates with the required metadata", () => {
  assert.deepEqual(TEMPLATES.map((t) => t.id), IDS);
  assert.deepEqual(TEMPLATES.map((t) => t.name), ["Blank", "Landing page", "Portfolio", "Blog", "Documentation", "Link in bio"]);
  for (const t of TEMPLATES) {
    assert.ok(t.description.length > 20 && t.description.length < 160, t.id);
    assert.ok(["Starter", "Business", "Personal", "Content"].includes(t.category), t.id);
    assert.match(t.accent, /^#[0-9a-f]{6}$/);
    assert.ok(t.files["index.html"] && t.files["css/style.css"] && t.files["js/main.js"], t.id);
  }
  assert.equal(getTemplate("blog").files["posts/finding-your-pace.html"].includes("<article"), true);
  assert.equal(getTemplate("nope"), null);
  const copy = getTemplate("blank");
  copy.files["x.txt"] = "x";
  assert.equal(getTemplate("blank").files["x.txt"], undefined);
  assert.equal(Object.keys(TEMPLATES.find((t) => t.id === "docs").files).filter((f) => f.endsWith(".html")).length, 2);
});

for (const tpl of TEMPLATES) {
  test(`${tpl.name}: HTML pages are valid, accessible and free of problems`, () => {
    const pages = Object.keys(tpl.files).filter((p) => p.endsWith(".html"));
    assert.ok(pages.length >= 1);
    for (const path of pages) {
      const src = tpl.files[path];
      const p = parseHtml(src);
      assert.deepEqual(p.errors, [], `${tpl.id}/${path}: ${JSON.stringify(p.errors.slice(0, 3))}`);
      assert.ok(/^<!doctype html>/i.test(src), "doctype");
      const html = p.elements.find((e) => e.tag === "html");
      assert.equal(getAttr(html, "lang"), "en-US");
      assert.equal(p.elements.filter((e) => e.tag === "h1").length, 1, `${path}: exactly one h1`);
      assert.ok(p.elements.some((e) => e.tag === "main"), "main landmark");
      assert.ok(p.elements.filter((e) => e.tag === "title").length === 1 && elementText(p, p.elements.find((e) => e.tag === "title")).trim().length > 3);
      assert.ok(p.elements.some((e) => e.tag === "meta" && getAttr(e, "name") === "viewport"));
      for (const img of p.elements.filter((e) => e.tag === "img")) {
        assert.notEqual(getAttr(img, "alt"), null, `${path}: img alt`);
        assert.ok(getAttr(img, "width") && getAttr(img, "height"), `${path}: img size`);
      }
      assert.ok(p.elements.some((e) => e.tag === "a" && classList(e).includes("skip-link")), "skip link");
      // buttons have a type, labelled controls have names
      for (const b of p.elements.filter((e) => e.tag === "button")) assert.ok(getAttr(b, "type"));
      // no leftovers and no external requests
      assert.ok(!/lorem|ipsum|todo|fixme/i.test(src), "placeholder text");
      assert.ok(!/<(link|script|img|iframe|source)\b[^>]*(src|href)=["']?(https?:)?\/\//i.test(src.replace(/<a\b[^>]*>/gi, "")), "external request");
      assert.ok(!/ on[a-z]+=/i.test(src), "inline event handler");
    }
  });

  test(`${tpl.name}: stylesheet parses cleanly with a desktop-first cascade`, () => {
    const css = tpl.files["css/style.css"];
    const p = parseCss(css);
    assert.deepEqual(p.errors, []);
    const n = lines(css);
    assert.ok(n >= 100 && n <= 420, `${tpl.id}: ${n} lines`);
    const medias = p.rules.filter((r) => r.type === "at" && r.name === "media").map((r) => normalizeMedia(r.prelude));
    for (const m of ["(max-width: 991px)", "(max-width: 767px)", "(max-width: 478px)"]) assert.ok(medias.includes(m), `${tpl.id} lacks ${m}`);
    const widths = medias.filter((m) => m.startsWith("(max-width")).map((m) => parseInt(m.match(/\d+/)[0], 10));
    assert.deepEqual(widths, [...widths].sort((a, b) => b - a), "max-width blocks go from large to small");
    assert.equal(new Set(medias).size, medias.length, "one block per query");
    assert.ok(css.includes(":root {") && css.includes("var(--"), "custom properties");
    assert.ok(!/@import|url\(["']?https?:|@font-face/.test(css), "no web fonts or remote files");
    assert.ok(/prefers-reduced-motion/.test(css));
    // every class used in the html has a rule somewhere, except hooks that are only used by scripts
    const used = new Set();
    for (const [path, src] of Object.entries(tpl.files)) if (path.endsWith(".html")) for (const el of parseHtml(src).elements) classList(el).forEach((c) => used.add(c));
    const defined = new Set(flattenRules(p).flatMap((r) => r.selector.match(/\.[A-Za-z_][\w-]*/g) || []).map((s) => s.slice(1)));
    const missing = [...used].filter((c) => !defined.has(c));
    assert.ok(missing.length <= 3, `${tpl.id}: classes without styles: ${missing.join(", ")}`);
    for (const r of flattenRules(p)) if (mediaOf(r) === null) assert.ok(r.decls.length > 0 || r.rules.length > 0, `${r.selector} is empty`);
  });

  test(`${tpl.name}: every local reference exists and the script parses`, () => {
    const files = makeFiles(tpl.files);
    for (const path of Object.keys(tpl.files)) {
      assert.ok(!path.startsWith("/") && !path.includes(".."), path);
      assert.ok(["html", "css", "js", "svg"].includes(extname(path).slice(1)), `${path}: only text files, no raster images`);
      if (path.endsWith(".html")) {
        const res = buildPreview(files, path);
        assert.deepEqual(res.diagnostics, [], `${tpl.id}/${path}`);
        for (const el of parseHtml(tpl.files[path]).elements) {
          if (el.tag !== "a") continue;
          const href = getAttr(el, "href");
          const ref = href && resolveRef(path, href);
          if (ref) assert.ok(tpl.files[ref.path], `${path}: link to ${href}`);
        }
      }
      if (path.endsWith(".svg")) {
        const svg = tpl.files[path];
        assert.ok(svg.startsWith("<svg") && svg.includes('xmlns="http://www.w3.org/2000/svg"') && svg.includes("viewBox"));
        assert.equal(parseHtml(svg).errors.filter((d) => d.severity === "error").length, 0, path);
      }
    }
    assert.doesNotThrow(() => new vm.Script(tpl.files["js/main.js"], { filename: "main.js" }));
    // the whole site builds without warnings
    const site = buildSite(files);
    assert.deepEqual(site.warnings, []);
    assert.equal(site.files.length, Object.keys(tpl.files).length);
  });
}

test("landing page content: sections, pricing and FAQ", () => {
  const src = getTemplate("landing").files["index.html"];
  const p = parseHtml(src);
  const ids = p.elements.map((e) => getAttr(e, "id")).filter(Boolean);
  for (const id of ["features", "stories", "pricing", "faq", "main"]) assert.ok(ids.includes(id), id);
  assert.equal(p.elements.filter((e) => e.tag === "details").length, 4);
  assert.equal(p.elements.filter((e) => classList(e).includes("plan")).length, 3);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
});

test("blog article page uses relative paths to the shared files", () => {
  const files = getTemplate("blog").files;
  const art = files["posts/finding-your-pace.html"];
  assert.ok(art.includes('href="../css/style.css"') && art.includes('src="../js/main.js"') && art.includes('src="../assets/cover-1.svg"'));
  assert.ok(files["index.html"].includes('href="posts/finding-your-pace.html"'));
});

test("template scripts run: nav toggle, year and anchors", () => {
  const listeners = {};
  const toggle = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { listeners["toggle:" + t] = f; }, focus() {} };
  const nav = {
    classes: new Set(), classList: { toggle(c) { return nav.classes.has(c) ? (nav.classes.delete(c), false) : (nav.classes.add(c), true); }, remove(c) { nav.classes.delete(c); }, contains: (c) => nav.classes.has(c) },
    addEventListener(t, f) { listeners["nav:" + t] = f; },
  };
  const year = { textContent: "" };
  const document = {
    querySelector: (sel) => (sel === "[data-nav-toggle]" ? toggle : sel === "[data-nav]" ? nav : null),
    querySelectorAll: (sel) => (sel === "[data-year]" ? [year] : []),
    addEventListener(t, f) { listeners["doc:" + t] = f; },
    getElementById: () => null,
  };
  vm.runInNewContext(getTemplate("blank").files["js/main.js"], { document, window: { matchMedia: () => ({ matches: false }) }, history: {}, decodeURIComponent, String, Date });
  assert.equal(year.textContent, String(new Date().getFullYear()));
  listeners["toggle:click"]();
  assert.ok(nav.classes.has("is-open"));
  assert.equal(toggle.attrs["aria-expanded"], "true");
  listeners["toggle:click"]();
  assert.ok(!nav.classes.has("is-open"));
  assert.equal(toggle.attrs["aria-expanded"], "false");
  listeners["toggle:click"]();
  listeners["doc:keydown"]({ key: "Escape" });
  assert.ok(!nav.classes.has("is-open"));
});
