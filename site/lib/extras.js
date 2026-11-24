// Build-time extras: the roadmap read from its concept, the press kit ZIP, the Atom feed and the search index.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "../../app/vendor/fflate/fflate.js";
import { esc } from "./html.js";
import { githubSlug } from "./docs.js";

/**
 * The prioritized list of docs/concepts/roadmap-next-major.md: "| # | Rn Title | Theme | I | E | Score | Wave |" rows.
 * @param {string} text
 */
export function parseRoadmap(text) {
  const items = [];
  for (const m of text.matchAll(/^\|\s*\d+\s*\|\s*(R\d+)\s+(.+?)\s*\|\s*([^|]+?)\s*\|\s*(\d)\s*\|\s*(\d)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*$/gm)) {
    items.push({ id: m[1], title: m[2].replace(/`/g, ""), theme: m[3], impact: Number(m[4]), effort: Number(m[5]), score: Number(m[6]), wave: m[7] });
  }
  const intro = /^Status:([\s\S]*?)\n\n/m.exec(text)?.[1].replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim() ?? "";
  const notPlanned = /^Not planned for[^\n]*(?:\n[^\n]+)*/m.exec(text)?.[0].replace(/\s+/g, " ") ?? "";
  // the "### Rn Title (Wave n)" heading of each item, for links into the concept page
  const anchors = new Map([...text.matchAll(/^### (R\d+) (.+)$/gm)].map((m) => [m[1], githubSlug(`${m[1]} ${m[2]}`)]));
  return { items, intro: `Status: ${intro.replace(/`/g, "")}`, notPlanned, anchors };
}

/**
 * The press kit: logos, artwork, screenshots and text files in one ZIP (fflate is already vendored for the app).
 * @param {{ root: string, site: string, boiler: Record<string, { short: string, long: string }>, facts: string }} o
 * @returns {Uint8Array}
 */
export function pressZip({ root, site, boiler, facts }) {
  const file = (p) => new Uint8Array(readFileSync(p));
  const text = (s) => new TextEncoder().encode(s.replace(/\n/g, "\r\n"));
  const shots = ["vector", "pixel", "layout", "code", "vibe", "office", "scene"].flatMap((id) => ["dark", "light"].map((th) => [`screenshots/${id}-${th}.webp`, file(join(site, "assets/shots", `${id}-${th}@2x.webp`))]));
  const entries = {
    "logo/openfini-mark.svg": file(join(root, "app/icons/mark.svg")),
    "logo/openfini-mark-white.svg": file(join(root, "app/icons/mark-white.svg")),
    "logo/openfini-mark-black.svg": file(join(root, "app/icons/mark-black.svg")),
    "logo/openfini-app-icon.svg": file(join(root, "app/icons/icon.svg")),
    "logo/openfini-app-icon-512.png": file(join(root, "app/icons/icon-512.png")),
    "artwork/openfini-artwork-1600x670.webp": file(join(root, "app/assets/launch/artwork.webp")),
    ...Object.fromEntries(shots),
    "text/boilerplate-en.txt": text(`${boiler.en.short}\n\n${boiler.en.long}\n`),
    "text/boilerplate-de.txt": text(`${boiler.de.short}\n\n${boiler.de.long}\n`),
    "text/facts.txt": text(facts),
  };
  // stored, not deflated: the images are compressed already; a fixed date keeps the file identical between builds
  return zipSync(entries, { level: 0, mtime: new Date("2026-01-01T00:00:00Z") });
}

/**
 * An Atom feed of the changelog: one entry per published version.
 * @param {{ versions: { version: string, title: string, html: string }[], dates: Map<string, string>, self: string, page: string }} o
 */
export function atomFeed({ versions, dates, self, page }) {
  const published = versions.filter((v) => dates.has(v.version));
  const updated = published.length ? dates.get(published[0].version) : new Date(0).toISOString();
  const entries = published
    .map((v) => `  <entry>
    <title>${esc(`OpenFini ${v.version}${v.title ? `: ${v.title}` : ""}`)}</title>
    <id>${esc(`${page}#${v.version.replace(/[^\w]+/g, "-")}`)}</id>
    <link href="${esc(`${page}#${v.version.replace(/[^\w]+/g, "-")}`)}"/>
    <updated>${dates.get(v.version)}</updated>
    <content type="html">${esc(v.html)}</content>
  </entry>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>OpenFini changelog</title>
  <id>${esc(page)}</id>
  <link rel="self" href="${esc(self)}"/>
  <link href="${esc(page)}"/>
  <updated>${updated}</updated>
  <author><name>OpenFini contributors</name></author>
${entries}
</feed>
`;
}

/** A human-readable file size for the press kit button. */
export const fileSize = (path) => `${(statSync(path).size / 1e6).toFixed(1)} MB`;

/**
 * The docs search index: title, URL, section and the h2/h3 headings of every page (no body text, so it stays small).
 * @param {{ title: string, url: string, section: string, headings: { level: number, text: string, id: string }[] }[]} docs
 */
export function searchIndex(docs) {
  return JSON.stringify(docs.map((d) => ({ t: d.title, u: d.url, s: d.section, h: d.headings.filter((h) => h.level === 2 || h.level === 3).map((h) => [h.text, h.id]) })));
}
