// Builds the OpenFini website into site/dist (docs/concepts/website.md). No dependencies beyond Node and the app's
// own Markdown renderer.
//
//   npm run site:build                         base path "/", release from the GitHub API or the snapshot
//   node site/build.mjs --base /open-fini/     as deployed on GitHub Pages (the workflow passes this)
//   node site/build.mjs --offline              never touch the network (tests, CI without a token)
//   node site/build.mjs --update-snapshot      also rewrite site/data/release.json from the API
//   node site/build.mjs --strict               fail when a template string is missing in a language
//
// Environment: SITE_BASE, SITE_ORIGIN (default https://philppplik.github.io), GITHUB_TOKEN (optional, for the API).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadContent, md } from "./lib/content.js";
import { highlights, parseChangelog } from "./lib/changelog.js";
import { LANGS, LOCALES, loadStrings, missingKeys, translator, urls } from "./lib/i18n.js";
import { loadGoodFirstIssues, loadRelease } from "./lib/release.js";
import { collectDocs, linkResolver, renderDoc } from "./lib/docs.js";
import { atomFeed, fileSize, parseRoadmap, pressZip, searchIndex } from "./lib/extras.js";
import { STUDIOS } from "./lib/studios.js";
import { classifyAsset, formatSize } from "./assets/js/platforms.js";
import { layout } from "./templates/layout.js";
import { downloadPage, featuresPage, homePage, notFoundPage, studioPage, studiosIndexPage, styleguidePage } from "./templates/pages.js";
import { devIndex, docPage, docsLanding } from "./templates/docs.js";
import { changelogPage, communityPage, pressPage, privacyPage, roadmapPage } from "./templates/project.js";

const SITE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SITE, "..");

// Bootstrap icons (app/vendor/shoelace/assets/icons) used by the templates and the features content.
const ICONS = ["download", "circle-half", "bounding-box", "folder2-open", "people", "puzzle", "sliders", "shield-lock", "cpu", "terminal", "universal-access", "translate", "clipboard", "check2"];

function parseArgs(argv) {
  const o = { base: process.env.SITE_BASE || "/", origin: process.env.SITE_ORIGIN || "https://philppplik.github.io", out: join(SITE, "dist"), offline: false, update: false, strict: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const n = argv[++i];
      if (n === undefined) throw new Error(`Missing value for ${a}`);
      return n;
    };
    if (a === "--base") o.base = v();
    else if (a === "--origin") o.origin = v().replace(/\/$/, "");
    else if (a === "--out") o.out = resolve(v());
    else if (a === "--offline") o.offline = true;
    else if (a === "--update-snapshot") o.update = true;
    else if (a === "--strict") o.strict = true;
    else if (a === "--quiet") o.quiet = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!o.base.startsWith("/")) o.base = `/${o.base}`;
  if (!o.base.endsWith("/")) o.base += "/";
  return o;
}

/** Start-up numbers from docs/performance.md, so the home page never disagrees with the measurements. */
export function performanceFacts(text) {
  const row = (name) => new RegExp(`^\\|\\s*${name}\\s*\\|\\s*([^|]+?)\\s*\\|`, "mi").exec(text)?.[1] ?? null;
  return { fcp: row("First contentful paint"), dcl: row("DOMContentLoaded") };
}

/** An SVG sprite: the app's studio icons (s-<id>) and the Bootstrap icons above. */
function sprite() {
  const symbol = (id, file) => {
    const svg = readFileSync(file, "utf8");
    const open = /<svg\b([^>]*)>/.exec(svg);
    const attrs = open[1];
    const keep = ["viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"]
      .map((k) => new RegExp(`\\s${k}="([^"]*)"`).exec(attrs))
      .filter(Boolean)
      .map((m) => m[0])
      .join("");
    const inner = svg.slice(open.index + open[0].length, svg.lastIndexOf("</svg>"));
    return `<symbol id="${id}"${keep}>${inner.trim()}</symbol>`;
  };
  const studios = STUDIOS.filter((s) => !s.planned).map((s) => symbol(`s-${s.id}`, join(ROOT, "app/assets/icons", `${s.id}.svg`)));
  const bi = ICONS.map((n) => symbol(n, join(ROOT, "app/vendor/shoelace/assets/icons", `${n}.svg`)));
  return `<svg xmlns="http://www.w3.org/2000/svg">${[...studios, ...bi].join("")}</svg>\n`;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/**
 * Every href/src inside the site that points at a missing file.
 * @returns {string[]} "page: url" entries
 */
export function brokenLinks(out, base) {
  const broken = [];
  for (const file of walk(out).filter((f) => f.endsWith(".html"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\s(?:href|src)="([^"]+)"|\s(?:srcset)="([^"]+)"/g)) {
      const urlsIn = m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().split(/\s+/)[0]);
      for (const raw of urlsIn) {
        let url = raw.replace(/&amp;/g, "&");
        if (url.startsWith("#") || /^[a-z]+:/i.test(url)) continue;
        if (!url.startsWith(base)) {
          broken.push(`${relative(out, file)}: ${url} (not under the base path ${base})`);
          continue;
        }
        url = decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]);
        const target = join(out, url, url === "" || url.endsWith("/") ? "index.html" : "");
        if (!existsSync(target)) broken.push(`${relative(out, file)}: ${raw}`);
      }
    }
  }
  return broken;
}

/**
 * Builds the site.
 * @param {ReturnType<typeof parseArgs>} opts
 */
export async function build(opts) {
  const log = (s) => opts.quiet || console.log(`site: ${s}`);
  const t0 = Date.now();
  const strings = loadStrings(join(SITE, "i18n"));
  const report = missingKeys(strings).filter((r) => r.missing.length || r.extra.length);
  for (const r of report) log(`i18n ${r.lang}: missing ${r.missing.join(", ") || "none"}; unused ${r.extra.join(", ") || "none"}`);
  if (opts.strict && report.some((r) => r.missing.length)) throw new Error("template strings are missing (see above)");

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const release = await loadRelease({ snapshot: join(SITE, "data", "release.json"), offline: opts.offline, update: opts.update, token: process.env.GITHUB_TOKEN, log });
  const issues = await loadGoodFirstIssues({ offline: opts.offline, token: process.env.GITHUB_TOKEN, log });
  const perf = performanceFacts(readFileSync(join(ROOT, "docs", "performance.md"), "utf8"));
  const versions = parseChangelog(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
  const section = versions.find((v) => v.version === release?.version) ?? versions[0];
  const changelog = section ? { version: section.version, title: section.title, items: highlights(section) } : null;
  const installer = release?.assets.find((a) => classifyAsset(a.name)?.kind === "exe" && classifyAsset(a.name)?.arch === "x64");
  const dates = new Map((release?.history ?? []).map((h) => [h.tag.replace(/^v/, ""), h.publishedAt]));

  rmSync(opts.out, { recursive: true, force: true });
  mkdirSync(opts.out, { recursive: true });
  cpSync(join(SITE, "assets"), join(opts.out, "assets"), { recursive: true });
  cpSync(join(SITE, "static"), opts.out, { recursive: true });
  mkdirSync(join(opts.out, "assets", "fonts"), { recursive: true });
  for (const f of ["inter-latin-wght-normal.woff2", "Inter-OFL.txt"]) cpSync(join(ROOT, "app/vendor/fonts", f), join(opts.out, "assets/fonts", f));
  cpSync(join(ROOT, "app/icons/icon.svg"), join(opts.out, "favicon.svg"));
  cpSync(join(ROOT, "app/icons/apple-touch-icon.png"), join(opts.out, "apple-touch-icon.png"));
  writeFileSync(join(opts.out, "assets", "icons.svg"), sprite());

  const cacheKey = createHash("sha256")
    .update(readFileSync(join(SITE, "assets/site.css")))
    .update(readFileSync(join(SITE, "assets/js/site.js")))
    .update(readFileSync(join(SITE, "assets/js/platforms.js")))
    .digest("hex")
    .slice(0, 10);
  const u = urls(opts.base, opts.origin);
  const pages = [];
  const write = (path, htmlText) => {
    const file = join(opts.out, path, path.endsWith(".html") ? "" : "index.html");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, htmlText);
  };

  // ---------------------------------------------------------------- docs (English): render once, used by every language
  const docs = collectDocs(ROOT);
  const pageUrl = (p) => u.page("en", p);
  const rendered = new Map(docs.pages.map((p) => [p.source, renderDoc(ROOT, p, docs, pageUrl)]));
  const titles = new Map([...rendered].map(([k, v]) => [k, v.title]));
  const docsResolve = linkResolver("site/content", docs, pageUrl);
  const changelogResolve = linkResolver("", docs, pageUrl);
  const versionsHtml = versions.map((v) => ({ ...v, html: md(v.body.replace(/^### /gm, "#### "), changelogResolve).replace(/<h4>/g, '<h3 class="label">').replace(/<\/h4>/g, "</h3>") }));
  const roadmapSource = "docs/concepts/roadmap-next-major.md";
  const road = parseRoadmap(readFileSync(join(ROOT, roadmapSource), "utf8"));
  const roadPage = docs.bySource.get(roadmapSource);
  const limitsDoc = docs.bySource.get("docs/known-limits.md");
  const roadmap = {
    items: road.items.map((i) => ({ ...i, href: `${pageUrl(roadPage.path)}${road.anchors.has(i.id) ? `#${road.anchors.get(i.id)}` : ""}` })),
    intro: road.intro,
    notPlanned: md(road.notPlanned, changelogResolve).trim().replace(/^<p>|<\/p>$/g, ""),
    limits: rendered.get(limitsDoc.source).headings.filter((h) => h.level === 2).map((h) => ({ text: h.text, href: `${pageUrl(limitsDoc.path)}#${h.id}` })),
    sourceHref: pageUrl(roadPage.path),
  };

  // ---------------------------------------------------------------- press kit
  const boiler = Object.fromEntries(LANGS.map((l) => [l, (({ meta }) => ({ short: meta.boilerplate_short, long: meta.boilerplate_long }))(loadContent(join(SITE, "content"), "press", l))]));
  const firstRelease = [...dates.values()].sort()[0] ?? null;
  const zipName = "press/openfini-press-kit.zip";
  mkdirSync(join(opts.out, "press"), { recursive: true });
  writeFileSync(join(opts.out, zipName), pressZip({
    root: ROOT,
    site: SITE,
    boiler,
    facts: `OpenFini\nLicense: MIT\nVersion: ${release?.version ?? pkg.version}\nPlatforms: Windows x64/ARM64, macOS Apple Silicon/Intel, Linux x64/ARM64, PWA\n${firstRelease ? `First public release: ${firstRelease.slice(0, 10)}\n` : ""}Source: https://github.com/philppplik/open-fini\nWebsite: ${u.absolute("en")}\n`,
  }));
  const logos = [
    ["mark.svg", "Mark", "light"],
    ["mark-white.svg", "Mark, white", "dark"],
    ["mark-black.svg", "Mark, black", "light"],
    ["icon.svg", "App icon", "light"],
  ].map(([f, name, bg]) => {
    cpSync(join(ROOT, "app/icons", f), join(opts.out, "press", `openfini-${f}`));
    return { path: `press/openfini-${f}`, name, bg };
  });
  const kit = { zip: zipName, size: fileSize(join(opts.out, zipName)), logos, firstRelease };

  const appJsonld = (lang) => ({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "OpenFini",
    applicationCategory: "DesignApplication",
    operatingSystem: "Windows, macOS, Linux, Web",
    softwareVersion: release?.version ?? pkg.version,
    license: "https://opensource.org/licenses/MIT",
    url: u.absolute(lang),
    downloadUrl: u.absolute(lang, "download/"),
    image: `${u.origin}${u.asset("img/artwork-1600.webp")}`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  });

  for (const lang of LANGS) {
    const t = translator(strings, lang);
    const cache = new Map();
    const resolve = (url, kind) => {
      if (url.startsWith("site-en:")) return u.page("en", url.slice(8));
      if (url.startsWith("site:")) return u.page(lang, url.slice(5));
      return docsResolve(url, kind);
    };
    const ctx = {
      t,
      tOther: translator(strings, lang === "en" ? "de" : "en"),
      u,
      lang,
      locale: LOCALES[lang],
      version: release?.version ?? pkg.version, // the version people can download
      cacheKey,
      release,
      changelog,
      titles,
      resolve,
      md: (s) => md(s, resolve),
      facts: {
        installer: installer ? formatSize(installer.size, lang) : "",
        fcp: perf.fcp ?? "",
        dcl: perf.dcl ?? "",
        version: pkg.version,
      },
      content(name) {
        if (!cache.has(name)) cache.set(name, loadContent(join(SITE, "content"), name, lang, resolve));
        return cache.get(name);
      },
    };
    const prefix = lang === "en" ? "" : `${lang}/`;
    const add = (path, page) => {
      write(`${prefix}${path}`, layout(ctx, { path, ...page }));
      if (!page.noindex) pages.push({ lang, path, langs: page.langs ?? LANGS });
    };
    const home = ctx.content("home");
    add("", { title: home.meta.title, description: home.meta.description, body: homePage(ctx), fallback: home.fallback, jsonld: appJsonld(lang) });
    add("studios/", { title: t("studios.title"), description: home.meta.description, body: studiosIndexPage(ctx), section: "studios", card: "studios" });
    for (const s of STUDIOS) {
      const c = ctx.content(`studios/${s.id}`);
      add(`studios/${s.id}/`, { title: c.meta.title, description: c.meta.description, body: studioPage(ctx, s.id), section: "studios", fallback: c.fallback, card: s.id });
    }
    const feat = ctx.content("features");
    add("features/", { title: feat.meta.title, description: feat.meta.description, body: featuresPage(ctx), section: "features", fallback: feat.fallback, card: "features" });
    const dl = ctx.content("download");
    add("download/", { title: dl.meta.title, description: dl.meta.description, body: downloadPage(ctx), section: "download", fallback: dl.fallback, card: "download", jsonld: appJsonld(lang) });
    add("changelog/", { title: t("changelog.label"), description: t("changelog.lead"), body: changelogPage(ctx, versionsHtml), card: "changelog" });
    add("roadmap/", { title: t("roadmap.label"), description: t("roadmap.lead"), body: roadmapPage(ctx, roadmap), card: "roadmap" });
    for (const [name, render] of [["community", () => communityPage(ctx, issues)], ["press", () => pressPage(ctx, kit)], ["privacy", () => privacyPage(ctx)]]) {
      const c = ctx.content(name);
      add(`${name}/`, { title: c.meta.title, description: c.meta.description, body: render(), fallback: c.fallback, card: name });
    }

    if (lang === "en") {
      // the documentation exists in English only; the German switch leads to /de/docs/
      for (const p of docs.pages) {
        const d = rendered.get(p.source);
        add(p.path, { title: d.title, description: d.description, body: docPage(ctx, docs, p, d), section: "docs", langs: ["en"], switchTo: { de: "docs/" }, card: "docs" });
      }
      add("docs/dev/", { title: t("docs.dev"), description: t("docs.devLead"), body: devIndex(ctx, docs, rendered), section: "docs", langs: ["en"], switchTo: { de: "docs/" }, card: "docs" });
      // GitHub Pages serves the root 404.html for every missing path; it links to both languages
      add("404.html", { title: t("notfound.title"), description: t("notfound.lead"), body: notFoundPage(ctx), noindex: true, switchTo: { de: "" } });
      add("styleguide/", { title: "Style guide", description: "Tokens and components of the OpenFini website.", body: styleguidePage(ctx), noindex: true, switchTo: { de: "" } });
    } else {
      add("docs/", { title: t("docs.title"), description: t("docs.englishOnly"), body: docsLanding(ctx, docs), section: "docs", langs: [lang], switchTo: { en: "docs/" }, card: "docs" });
    }
  }

  // ---------------------------------------------------------------- search index, feed, sitemap, robots
  writeFileSync(join(opts.out, "assets", "search.json"), searchIndex(docs.pages.map((p) => ({
    title: rendered.get(p.source).title,
    url: pageUrl(p.path),
    section: p.kind === "wiki" ? p.group || "Manual" : `Developer · ${p.group}`,
    headings: rendered.get(p.source).headings,
  }))));
  writeFileSync(join(opts.out, "feed.xml"), atomFeed({ versions: versionsHtml, dates, self: `${u.origin}${u.base}feed.xml`, page: u.absolute("en", "changelog/") }));
  const alternates = (p) => (p.langs.length > 1 ? p.langs.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${u.absolute(l, p.path)}"/>`).join("") : "");
  const sitemap = pages.map((p) => `  <url><loc>${u.absolute(p.lang, p.path)}</loc>${alternates(p)}</url>`).join("\n");
  writeFileSync(join(opts.out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${sitemap}\n</urlset>\n`);
  writeFileSync(join(opts.out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${opts.origin}${u.base}sitemap.xml\n`);

  const broken = brokenLinks(opts.out, u.base);
  if (broken.length) throw new Error(`broken internal links:\n  ${broken.join("\n  ")}`);
  const files = walk(opts.out);
  const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
  log(`${pages.length} pages, ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB in ${relative(ROOT, opts.out).split(sep).join("/")} (${Date.now() - t0} ms)`);
  return { pages, out: opts.out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await build(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(`site: ${err.message}`);
    process.exit(1);
  }
}

export { parseArgs };
