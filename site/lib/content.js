// Page copy: site/content/<name>.<lang>.md with front matter. The body is split at its "## " headings into sections;
// a heading may end with "{id}" or "{id icon}" so anchors and icons stay the same in every language.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontMatter, renderMarkdown } from "../../app/src/engine/web/markdown.js";
import { DEFAULT_LANG } from "./i18n.js";

/** Markdown to HTML with the app's own renderer; links stay as written. */
export function md(source) {
  return renderMarkdown(String(source ?? ""), { headingIds: false, highlight: true, externalLinkAttrs: false }).html;
}

/** Inline Markdown (one paragraph) without the surrounding <p>. */
export function mdInline(source) {
  return md(source).trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1");
}

/**
 * @param {string} body
 * @returns {{ intro: string, sections: { id: string, icon: string|null, title: string, html: string }[] }}
 */
export function splitSections(body) {
  const parts = body.split(/^## /m);
  const intro = parts.shift() ?? "";
  const sections = parts.map((p) => {
    const nl = p.indexOf("\n");
    let heading = (nl < 0 ? p : p.slice(0, nl)).trim();
    const text = nl < 0 ? "" : p.slice(nl + 1);
    let id = null;
    let icon = null;
    const m = /\s*\{([\w-]+)(?:\s+([\w-]+))?\}\s*$/.exec(heading);
    if (m) {
      heading = heading.slice(0, m.index).trim();
      id = m[1];
      icon = m[2] ?? null;
    }
    return { id: id ?? heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), icon, title: heading, html: md(text) };
  });
  return { intro: md(intro), sections };
}

/**
 * Loads one content file in a language, falling back to English.
 * @param {string} dir site/content
 * @param {string} name e.g. "home" or "studios/vector"
 * @param {string} lang
 * @returns {{ meta: Record<string, any>, intro: string, sections: any[], lang: string, fallback: boolean }}
 */
export function loadContent(dir, name, lang) {
  let file = join(dir, `${name}.${lang}.md`);
  let used = lang;
  if (!existsSync(file)) {
    file = join(dir, `${name}.${DEFAULT_LANG}.md`);
    used = DEFAULT_LANG;
  }
  const { meta, body } = parseFrontMatter(readFileSync(file, "utf8"));
  return { meta, ...splitSections(body), lang: used, fallback: used !== lang };
}
