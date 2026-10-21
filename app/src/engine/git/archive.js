// Export a repository + working tree as a real folder layout (".git/…" plus the project files) or ZIP, and import a
// zipped repository (loose objects and packfiles). Pure.
import { zipSync, unzipSync } from "../../../vendor/fflate/fflate.js";
import { GitRepo } from "./repo.js";
import { readPack } from "./pack.js";
import { utf8 } from "./objects.js";

const NONSTANDARD = new Set(["openfini-conflicts"]);

/** @param {GitRepo} repo @param {{ paths(): string[], get(p: string): string | Uint8Array | null }} wt @returns {Map<string, Uint8Array>} */
export function exportRepoFiles(repo, wt) {
  const out = new Map();
  for (const [p, b] of repo.files) if (!NONSTANDARD.has(p)) out.set(`.git/${p}`, b);
  for (const p of wt.paths()) {
    const c = wt.get(p);
    if (c != null) out.set(p, typeof c === "string" ? utf8(c) : c);
  }
  return out;
}

/** ZIP bytes of the project with a real `.git` folder. */
export function exportRepoZip(repo, wt) {
  const zip = {};
  for (const [p, b] of exportRepoFiles(repo, wt)) zip[p] = [b, { level: p.startsWith(".git/objects/") || /\.(png|jpe?g|gif|webp|avif|woff2?|mp4|webm|mp3)$/i.test(p) ? 0 : 6 }];
  return zipSync(zip);
}

/**
 * Reads a ZIP that contains a `.git` folder (optionally inside one top-level folder).
 * @returns {{ files: Map<string, Uint8Array>, git: Map<string, Uint8Array> | null, prefix: string }} `git` is null for a plain ZIP
 */
export function importRepoZip(zipBytes) {
  const entries = unzipSync(zipBytes);
  const names = Object.keys(entries).filter((n) => !n.endsWith("/"));
  const gitHead = names.find((n) => /(^|\/)\.git\/HEAD$/.test(n));
  if (!gitHead) return { files: new Map(names.map((n) => [n, entries[n]])), git: null, prefix: "" };
  const prefix = gitHead.slice(0, gitHead.length - ".git/HEAD".length);
  const git = new Map();
  const repo = new GitRepo(git);
  const files = new Map();
  const packs = [];
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const rel = n.slice(prefix.length);
    if (rel.startsWith(".git/")) {
      const g = rel.slice(5);
      if (/^objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(g) || g === "HEAD" || g === "config" || g === "packed-refs" || g === "info/exclude" || g === "index" || g.startsWith("refs/")) git.set(g, entries[n]);
      else if (/^objects\/pack\/.*\.pack$/.test(g)) packs.push(entries[n]);
    } else files.set(rel, entries[n]);
  }
  for (const pack of packs) {
    for (const o of readPack(pack, { external: (oid) => (repo.hasObject(oid) ? repo.readObject(oid) : null) })) repo.writeObject(o.type, o.content);
  }
  return { files, git, prefix };
}
