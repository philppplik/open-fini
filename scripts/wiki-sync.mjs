// Publishes the wiki/ folder to the GitHub wiki of this repository.
//
//   node scripts/wiki-sync.mjs --check                     validate wiki/ only (no network, no git)
//   node scripts/wiki-sync.mjs --dest ../wiki-clone        copy wiki/ into a checked-out wiki repository
//   node scripts/wiki-sync.mjs --dest ../wiki-clone --push commit and push the copy (needs git + credentials)
//
// The GitHub wiki is a separate Git repository (<repo>.wiki.git) that only exists after the first page has been
// created in the web UI. This script never creates it; .github/workflows/wiki.yml probes for it and skips with a
// notice when it is missing, which makes the whole publish idempotent.
//
// Dependency-free Node 20+. The pure helpers are exported for tests/docs/wiki-links.test.js.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WIKI_DIR = join(root, "wiki");

/** `Page-Name.md` -> `Page Name`. */
export const pageTitle = (file) => file.replace(/\.md$/i, "").replace(/-/g, " ");
/** `Page Name` or `page-name` -> `Page-Name` (case-insensitive key for lookups). */
export const pageKey = (name) => name.trim().replace(/\s+/g, "-").toLowerCase();

/** Pages = every `*.md` directly inside wiki/. */
export function listPages(dir = WIKI_DIR) {
  return readdirSync(dir).filter((f) => f.endsWith(".md") && statSync(join(dir, f)).isFile());
}

/** Strip fenced code blocks and inline code so links inside examples are ignored. */
export function stripCode(md) {
  return md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "").replace(/`[^`\n]*`/g, "");
}

/**
 * Internal links of a page: `[[Page]]`, `[[Text|Page]]` and relative Markdown links `[text](Page-Name)` or
 * `[text](Page-Name#anchor)`. External links, mailto links and pure anchors are not returned.
 */
export function internalLinks(md) {
  const text = stripCode(md);
  const out = [];
  for (const m of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const parts = m[1].split("|");
    out.push({ kind: "wiki", target: parts[parts.length - 1].split("#")[0].trim(), raw: m[0] });
  }
  for (const m of text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = m[1];
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) continue;
    out.push({ kind: "md", target: decodeURIComponent(href.split("#")[0]).replace(/\.md$/i, ""), raw: m[0] });
  }
  return out.filter((l) => l.target);
}

export function validate(dir = WIKI_DIR) {
  const problems = [];
  const pages = listPages(dir);
  const keys = new Map();
  for (const p of pages) {
    const k = pageKey(p.replace(/\.md$/, ""));
    if (keys.has(k)) problems.push(`duplicate page name (case-insensitive): ${p} and ${keys.get(k)}`);
    keys.set(k, p);
  }
  for (const required of ["Home.md", "_Sidebar.md", "_Footer.md"]) if (!pages.includes(required)) problems.push(`missing ${required}`);
  const special = new Set(["_sidebar", "_footer"]);
  const reachable = new Set();
  const sidebar = existsSync(join(dir, "_Sidebar.md")) ? readFileSync(join(dir, "_Sidebar.md"), "utf8") : "";
  for (const l of internalLinks(sidebar)) reachable.add(pageKey(l.target));
  for (const p of pages) {
    const body = readFileSync(join(dir, p), "utf8");
    for (const l of internalLinks(body)) {
      if (!keys.has(pageKey(l.target))) problems.push(`${p}: broken link ${l.raw} (no page "${l.target}")`);
    }
  }
  for (const p of pages) {
    const k = pageKey(p.replace(/\.md$/, ""));
    if (!special.has(k) && !reachable.has(k)) problems.push(`${p}: not reachable from _Sidebar.md`);
  }
  return { pages, problems };
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
  return r.stdout.trim();
}

/** Mirror wiki/*.md into `dest` (a wiki repository checkout): copy new and changed pages, delete removed ones. */
export function syncInto(dest, src = WIKI_DIR) {
  mkdirSync(dest, { recursive: true });
  const wanted = new Set(listPages(src));
  for (const f of readdirSync(dest)) if (f.endsWith(".md") && !wanted.has(f)) rmSync(join(dest, f));
  for (const f of wanted) copyFileSync(join(src, f), join(dest, f));
  if (existsSync(join(src, "images"))) {
    mkdirSync(join(dest, "images"), { recursive: true });
    for (const f of readdirSync(join(src, "images"))) copyFileSync(join(src, "images", f), join(dest, "images", f));
  }
  return [...wanted];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const { pages, problems } = validate();
  if (problems.length) {
    console.error(problems.map((p) => "wiki: " + p).join("\n"));
    process.exit(1);
  }
  console.log(`wiki: ${pages.length} pages valid.`);
  if (args.includes("--check")) process.exit(0);
  const dest = arg("--dest");
  if (!dest) {
    console.error("wiki: pass --dest <wiki checkout> or --check");
    process.exit(2);
  }
  const copied = syncInto(resolve(dest));
  console.log(`wiki: copied ${copied.length} pages to ${resolve(dest)}`);
  if (args.includes("--push")) {
    const cwd = resolve(dest);
    git(["add", "-A"], cwd);
    if (!git(["status", "--porcelain"], cwd)) {
      console.log("wiki: nothing changed, nothing to push.");
    } else {
      const sha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : "local";
      git(["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-m", `docs(wiki): sync from wiki/ at ${sha}`], cwd);
      git(["push"], cwd);
      console.log("wiki: pushed.");
    }
  }
}
