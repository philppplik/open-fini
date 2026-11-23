// The docs section (docs/concepts/website.md, task W13): wiki/ becomes /docs/ (the user manual, grouped like
// wiki/_Sidebar.md) and docs/ becomes /docs/dev/ (developer docs, concepts and decision records). Links are rewritten at
// build time: [[Wiki Links]], relative .md links and GitHub links to these files point at site pages; everything else
// in the repository points at GitHub.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { renderMarkdown } from "../../app/src/engine/web/markdown.js";

export const REPO_BLOB = "https://github.com/philppplik/open-fini/blob/main/";
const RAW = "https://raw.githubusercontent.com/philppplik/open-fini/main/";
const SELF = /^https:\/\/github\.com\/philppplik\/open-fini\/(?:blob|tree)\/main\/([^?#]+)(#.*)?$/i;

/** @typedef {{ source: string, path: string, slug: string, kind: "wiki"|"dev", group: string, title?: string, status?: string }} DocPage */

const slugOf = (name) => name.replace(/\.md$/i, "").toLowerCase();

/**
 * Lists every page of the docs section.
 * @param {string} root repository root
 * @returns {{ pages: DocPage[], bySource: Map<string, DocPage>, sidebar: { title: string, items: DocPage[] }[] }}
 */
export function collectDocs(root) {
  const pages = [];
  for (const f of readdirSync(join(root, "wiki")).filter((f) => f.endsWith(".md") && !f.startsWith("_"))) {
    const slug = slugOf(f);
    pages.push({ source: `wiki/${f}`, path: slug === "home" ? "docs/" : `docs/${slug}/`, slug, kind: "wiki", group: "" });
  }
  const dev = [
    ["docs", "docs/dev/", "guides"],
    ["docs/concepts", "docs/dev/concepts/", "concepts"],
    ["docs/adr", "docs/dev/adr/", "adr"],
  ];
  for (const [dir, base, group] of dev) {
    for (const f of readdirSync(join(root, dir)).filter((f) => f.endsWith(".md"))) {
      pages.push({ source: `${dir}/${f}`, path: `${base}${slugOf(f)}/`, slug: slugOf(f), kind: "dev", group });
    }
  }
  const bySource = new Map(pages.map((p) => [p.source, p]));

  // sidebar: **Group** lines followed by "- [[Page]]" items
  const sidebar = [];
  for (const line of readFileSync(join(root, "wiki", "_Sidebar.md"), "utf8").split(/\r?\n/)) {
    const g = /^\*\*(?!\[\[)(.+?)\*\*\s*$/.exec(line.trim());
    if (g) sidebar.push({ title: g[1], items: [] });
    const item = /^-\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(line.trim());
    if (item && sidebar.length) {
      const page = bySource.get(`wiki/${(item[2] ?? item[1]).trim().replace(/\s+/g, "-")}.md`);
      if (page) {
        sidebar.at(-1).items.push(page);
        page.group = sidebar.at(-1).title;
      }
    }
  }
  return { pages, bySource, sidebar };
}

/**
 * Small fixes to rendered Markdown for the accessibility gate: code blocks that scroll can be focused with the
 * keyboard, and task-list checkboxes (read-only) get a name.
 */
export function a11yFixes(html) {
  return html
    .replace(/<(pre|table)(?=[\s>])/g, '<$1 tabindex="0"')
    .replace(/<input type="checkbox" disabled checked>/g, '<input type="checkbox" disabled checked aria-label="Done">')
    .replace(/<input type="checkbox" disabled>/g, '<input type="checkbox" disabled aria-label="Open">');
}

/** GitHub-compatible heading anchor, so links written for GitHub keep working on the site. */
export function githubSlug(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/**
 * Replaces [[Page]] and [[text|Page]] outside code with Markdown links.
 * @param {string} md
 * @param {(page: string) => string} target
 */
export function rewriteWikiLinks(md, target) {
  let fence = null;
  return md
    .split("\n")
    .map((line) => {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
        return line;
      }
      if (f) {
        fence = f[1];
        return line;
      }
      // keep inline code spans as they are
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) => (i % 2 ? part : part.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => `[${a.trim()}](${target((b ?? a).trim())})`)))
        .join("");
    })
    .join("\n");
}

/**
 * Renders one docs page.
 * @param {string} root
 * @param {DocPage} page
 * @param {{ bySource: Map<string, DocPage> }} docs
 * @param {(path: string) => string} pageUrl turns a site path into a URL with the base path
 * @returns {{ html: string, title: string, headings: { level: number, text: string, id: string }[], description: string }}
 */
export function renderDoc(root, page, docs, pageUrl) {
  let source = readFileSync(join(root, page.source), "utf8");
  const dir = posix.dirname(page.source);
  const wikiTarget = (name) => {
    const p = docs.bySource.get(`wiki/${name.replace(/\s+/g, "-")}.md`);
    return p ? pageUrl(p.path) : `${REPO_BLOB}wiki/${name.replace(/\s+/g, "-")}.md`;
  };
  if (page.kind === "wiki") source = rewriteWikiLinks(source, wikiTarget);

  const resolveUrl = linkResolver(dir, docs, pageUrl);

  const r = renderMarkdown(source, { headingIds: false, highlight: true, resolveUrl, externalLinkAttrs: false });
  // GitHub-style ids, unique per page, with a visible anchor link
  const seen = new Map();
  const headings = [];
  let html = r.html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (m, level, inner) => {
    const text = decode(inner.replace(/<[^>]+>/g, "")).trim();
    let id = githubSlug(text) || "section";
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n) id = `${id}-${n}`;
    headings.push({ level: Number(level), text, id });
    if (level === "1") return `<h1 id="${id}">${inner}</h1>`;
    return `<h${level} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`;
  });
  const title = headings.find((h) => h.level === 1)?.text || page.slug;
  html = a11yFixes(html);
  const first = /<p>([\s\S]*?)<\/p>/.exec(html);
  const description = first ? decode(first[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim().slice(0, 180) : title;
  const status = page.group === "adr" || page.group === "concepts" ? /^\s*\**Status:?\**:?\s*\**\s*([^\n.*(—]+)/im.exec(source)?.[1]?.trim() : undefined;
  return { html, title, headings, description, status };
}

/**
 * A resolveUrl for renderMarkdown: links of a Markdown file in `dir` (repository-relative) become site or GitHub URLs.
 * @param {string} dir
 * @param {{ bySource: Map<string, DocPage> }} docs
 * @param {(path: string) => string} pageUrl
 */
export function linkResolver(dir, docs, pageUrl) {
  return (url, kind) => {
    if (/^(#|mailto:|data:|\/(?!\/))/i.test(url)) return url; // anchors and site URLs (already rewritten wiki links)
    const self = SELF.exec(url);
    let repoPath;
    let hash = "";
    if (self) {
      repoPath = decodeURIComponent(self[1]);
      hash = self[2] ?? "";
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) {
      return url;
    } else {
      const m = /^([^#?]*)(?:\?[^#]*)?(#.*)?$/.exec(url);
      hash = m[2] ?? "";
      repoPath = posix.normalize(posix.join(dir, decodeURIComponent(m[1])));
      if (m[1] === "") return hash || url;
    }
    if (kind === "image") return `${RAW}${repoPath}`;
    // wiki pages link to each other without .md (GitHub wiki style)
    const candidates = [repoPath, `${repoPath}.md`];
    for (const c of candidates) {
      const target = docs.bySource.get(c);
      if (target) return `${pageUrl(target.path)}${hash}`;
    }
    if (repoPath.startsWith("..")) return url;
    return `${REPO_BLOB}${repoPath}${hash}`;
  };
}

/** The title (first # heading) of a Markdown file, cheaply. */
export function titleOf(root, source) {
  const text = existsSync(join(root, source)) ? readFileSync(join(root, source), "utf8") : "";
  return /^#\s+(.+)$/m.exec(text)?.[1].replace(/[*_`]/g, "").trim() ?? source;
}
