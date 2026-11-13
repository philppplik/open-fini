// File globbing for `ofini` (cmd.exe and PowerShell do not expand wildcards, and quoted patterns reach us unexpanded
// in every shell): `*`, `?`, `[abc]` within a path segment and `**` for any number of directories. A word without
// wildcards, or one that names an existing file literally, is returned unchanged.
import { readdirSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

const MAGIC = /[*?[]/;

function segmentRegex(seg) {
  let re = "";
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else if (ch === "[") {
      const end = seg.indexOf("]", i + 1);
      if (end < 0) re += "\\[";
      else {
        re += `[${seg.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else re += ch.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, process.platform === "win32" ? "i" : "");
}

/**
 * Expands one pattern relative to `cwd`. Results keep the pattern's form (relative stays relative).
 * @returns {string[]} sorted matches (files only); empty when nothing matches
 */
export function expandGlob(pattern, cwd = process.cwd(), { limit = 100000 } = {}) {
  const norm = pattern.replace(/\\/g, "/");
  if (!MAGIC.test(norm) || existsSync(resolve(cwd, pattern))) return [pattern];
  const parts = norm.split("/");
  let base = "";
  while (parts.length > 1 && !MAGIC.test(parts[0])) base += `${parts.shift()}/`;
  if (norm.startsWith("/") && !base) base = "/";
  const out = [];
  const walk = (dirRel, segs) => {
    if (out.length >= limit) return;
    const dirAbs = isAbsolute(dirRel || ".") ? dirRel : resolve(cwd, dirRel || ".");
    if (!segs.length) return;
    const [seg, ...rest] = segs;
    let list;
    try {
      list = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    if (seg === "**") {
      walk(dirRel, rest); // zero directories
      for (const e of list) if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") walk(join(dirRel, e.name), segs);
      return;
    }
    const re = segmentRegex(seg);
    for (const e of list) {
      if (!re.test(e.name) || (e.name.startsWith(".") && !seg.startsWith("."))) continue;
      const rel = dirRel ? join(dirRel, e.name) : e.name;
      if (!rest.length) {
        if (e.isFile()) out.push(rel);
      } else if (e.isDirectory()) walk(rel, rest);
    }
  };
  walk(base.replace(/\/$/, "") || (base === "/" ? "/" : ""), parts);
  return [...new Set(out)].sort();
}

/** Expands every pattern; patterns without a match are kept so the command can report them as missing. */
export function expandAll(patterns, cwd) {
  const out = [];
  for (const p of patterns) {
    if (p === "-") {
      out.push(p);
      continue;
    }
    const m = expandGlob(p, cwd);
    out.push(...(m.length ? m : [p]));
  }
  return out;
}
