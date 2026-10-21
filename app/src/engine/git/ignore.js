// .gitignore matching (the common subset of gitignore(5): comments, negation, directory-only patterns, anchored
// patterns, *, ?, [set], ** and backslash escapes; nested .gitignore files apply to their folder). Pure.

/** Compiles one pattern line; returns null for blank lines and comments. */
export function compilePattern(line) {
  let p = line.replace(/\r$/, "");
  if (!p || p.startsWith("#")) return null;
  p = p.replace(/(?<!\\)\s+$/, "");
  if (!p) return null;
  let negate = false;
  if (p.startsWith("!")) {
    negate = true;
    p = p.slice(1);
  } else if (p.startsWith("\\!") || p.startsWith("\\#")) p = p.slice(1);
  let dirOnly = false;
  if (p.endsWith("/")) {
    dirOnly = true;
    p = p.replace(/\/+$/, "");
  }
  if (!p) return null;
  const anchored = p.includes("/");
  p = p.replace(/^\//, "");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        const before = i === 0 || p[i - 1] === "/";
        const after = p[i + 2] === "/" || i + 2 >= p.length;
        if (before && after) {
          if (p[i + 2] === "/") {
            re += "(?:.*/)?";
            i += 2;
          } else {
            re += ".*";
            i += 1;
          }
          continue;
        }
      }
      re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const close = p.indexOf("]", i + 2);
      if (close < 0) re += "\\[";
      else {
        let set = p.slice(i + 1, close);
        if (set.startsWith("!")) set = `^${set.slice(1)}`;
        re += `[${set.replace(/\\/g, "\\\\")}]`;
        i = close;
      }
    } else if (c === "\\" && i + 1 < p.length) re += p[++i].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    else re += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  let regex;
  try {
    regex = new RegExp(anchored ? `^${re}$` : `(?:^|/)${re}$`);
  } catch {
    return null;
  }
  return { negate, dirOnly, regex };
}

export function parseIgnore(text) {
  return String(text || "")
    .split("\n")
    .map(compilePattern)
    .filter(Boolean);
}

/**
 * Builds a matcher from the ignore files of a project.
 * @param {(path: string) => string | null} readText returns the text of a file (for ".gitignore", "sub/.gitignore", ".git/info/exclude")
 * @param {Iterable<string>} paths all project paths (used to find nested .gitignore files)
 * @returns {(path: string, isDir?: boolean) => boolean}
 */
export function createIgnore(readText, paths = []) {
  const scopes = new Map(); // folder ("" = root) -> rules
  const add = (dir, text) => {
    const rules = parseIgnore(text);
    if (rules.length) scopes.set(dir, [...(scopes.get(dir) || []), ...rules]);
  };
  const exclude = readText(".git/info/exclude");
  if (exclude) add("", exclude);
  for (const p of paths) {
    if (p === ".gitignore" || p.endsWith("/.gitignore")) {
      const t = readText(p);
      if (t) add(p === ".gitignore" ? "" : p.slice(0, -"/.gitignore".length), t);
    }
  }
  const dirs = [...scopes.keys()].sort((a, b) => a.length - b.length);
  const cache = new Map();
  const ignoredEntry = (path, isDir) => {
    let result = false;
    for (const dir of dirs) {
      if (dir && !path.startsWith(`${dir}/`)) continue;
      const rel = dir ? path.slice(dir.length + 1) : path;
      for (const r of scopes.get(dir)) {
        if (r.dirOnly && !isDir) continue;
        if (r.regex.test(rel)) result = !r.negate;
      }
    }
    return result;
  };
  return function ignored(path, isDir = false) {
    if (!dirs.length) return false;
    const key = `${isDir ? 1 : 0}${path}`;
    if (cache.has(key)) return cache.get(key);
    const parts = path.split("/");
    let acc = "";
    let res = false;
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      if (ignoredEntry(acc, i < parts.length - 1 || isDir)) {
        res = true;
        break;
      }
    }
    cache.set(key, res);
    return res;
  };
}
