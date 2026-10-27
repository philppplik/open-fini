// Static import graph of the app sources, without dependencies (used by tests/architecture and the audit scripts).
//
// Public API:
//   buildGraph({ roots, projectRoot })  -> Graph: Map<file, { static: Set<file>, dynamic: Set<file>, exports: Set<name>,
//                                         reexports: [{ from, names|null }], uses: Map<file, Set<name>|"*"> }>
//   findCycles(graph, filter?)          -> string[][] strongly connected components (size > 1, static edges only)
//   staticClosure(graph, entries)       -> Set<file> reachable through static imports
//   pathTo(graph, entries, target)      -> string[] | null shortest static import chain (for "why is X at start-up?")
//
// Files are absolute paths with forward slashes. The parser is regex-based on comment-stripped source: it understands
// `import ... from "x"`, `import "x"`, `export ... from "x"`, `import("x")` with a string literal (the build requires
// literals, see docs/building.md) and `new URL("x", import.meta.url)` (workers). Specifiers that do not resolve to an
// existing file (template code inside generators, bare package names) are ignored. Good enough for ranking and
// guardrails; not a JavaScript parser (for example `export const a = 1, b = 2` records only `a`).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const posix = (p) => p.split(sep).join("/");

/**
 * Removes comments with a small scanner that skips over string, template and regular expression literals (so
 * "assets/*.svg" or "https://..." in a string never starts a comment). Literals are kept: import specifiers are strings.
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  const copyQuoted = (q) => {
    const start = i++;
    while (i < n && src[i] !== q && !(q !== "`" && src[i] === "\n")) i += src[i] === "\\" ? 2 : 1;
    i++;
    out += src.slice(start, i);
  };
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      copyQuoted(c);
    } else if (c === "/" && /(^|[(,=:[!&|?{};+*%<>~^-]|\breturn|\btypeof)\s*$/.test(out.slice(-12))) {
      // regular expression literal
      const start = i++;
      let cls = false;
      while (i < n && src[i] !== "\n" && (src[i] !== "/" || cls)) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") cls = true;
        else if (src[i] === "]") cls = false;
        i++;
      }
      i++;
      out += src.slice(start, i);
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.m?js$/.test(entry.name)) out.push(posix(full));
  }
  return out;
}

function resolveSpec(from, spec) {
  if (!spec.startsWith(".")) return null;
  const target = posix(resolve(dirname(from), spec.split(/[?#]/)[0]));
  try {
    return statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

const NAMED = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/;

/** Parses `a, b as c, default as d` into [[imported, local]]. */
function specifiers(list) {
  return list
    .split(",")
    .map((s) => s.trim().replace(/^type\s+/, ""))
    .filter(Boolean)
    .map((s) => s.match(NAMED))
    .filter(Boolean)
    .map((m) => [m[1], m[2] ?? m[1]]);
}

/**
 * Parses one module.
 * @param {string} file absolute posix path
 * @param {string} src
 */
export function parseModule(file, src) {
  const code = stripComments(src);
  const node = { static: new Set(), dynamic: new Set(), exports: new Set(), reexports: [], uses: new Map() };
  const use = (target, names) => {
    if (!target) return;
    const prev = node.uses.get(target);
    if (prev === "*" || names === "*") node.uses.set(target, "*");
    else node.uses.set(target, new Set([...(prev ?? []), ...names]));
  };
  // import ... from "x"
  for (const m of code.matchAll(/(^|[;\n}])\s*import\s+([^"'`;]*?)\s+from\s*["']([^"']+)["']/g)) {
    const target = resolveSpec(file, m[3]);
    if (!target) continue;
    node.static.add(target);
    const clause = m[2].trim();
    const names = [];
    let all = false;
    if (/\*\s+as\s+/.test(clause)) all = true;
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) for (const [imported] of specifiers(braces[1])) names.push(imported);
    const def = clause.replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+[\w$]+/, "").replace(/,/g, " ").trim();
    if (def) names.push("default");
    use(target, all ? "*" : names);
  }
  // import "x"
  for (const m of code.matchAll(/(^|[;\n}])\s*import\s*["']([^"']+)["']/g)) {
    const target = resolveSpec(file, m[2]);
    if (target) {
      node.static.add(target);
      use(target, []);
    }
  }
  // export ... from "x"
  for (const m of code.matchAll(/(^|[;\n}])\s*export\s+(\*(?:\s+as\s+([\w$]+))?|\{([^}]*)\})\s*from\s*["']([^"']+)["']/g)) {
    const target = resolveSpec(file, m[5]);
    if (!target) continue;
    node.static.add(target);
    if (m[4] !== undefined) {
      const pairs = specifiers(m[4]);
      for (const [, exported] of pairs) node.exports.add(exported);
      node.reexports.push({ from: target, names: pairs });
    } else if (m[3]) {
      node.exports.add(m[3]);
      use(target, "*");
    } else {
      node.reexports.push({ from: target, names: null });
    }
  }
  // import("x") and new URL("x", import.meta.url)
  for (const m of code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const target = resolveSpec(file, m[1]);
    if (target) {
      node.dynamic.add(target);
      use(target, "*");
    }
  }
  for (const m of code.matchAll(/new\s+URL\(\s*["']([^"']+\.m?js)["']\s*,\s*import\.meta\.url\s*\)/g)) {
    const target = resolveSpec(file, m[1]);
    if (target) {
      node.dynamic.add(target);
      use(target, "*");
    }
  }
  // local exports
  for (const m of code.matchAll(/(^|[;\n}])\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/g)) node.exports.add(m[2]);
  for (const m of code.matchAll(/(^|[;\n}])\s*export\s+default\b/g)) node.exports.add("default");
  for (const m of code.matchAll(/(^|[;\n}])\s*export\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const [, exported] of specifiers(m[2])) node.exports.add(exported);
  }
  return node;
}

/**
 * @param {{ roots: string[] }} options absolute folders (or files) to scan
 * @returns {Map<string, ReturnType<typeof parseModule>>}
 */
export function buildGraph({ roots }) {
  const graph = new Map();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const files = statSync(root).isDirectory() ? walk(root) : [posix(root)];
    for (const file of files) graph.set(file, parseModule(file, readFileSync(file, "utf8")));
  }
  return graph;
}

/** Strongly connected components with more than one module (Tarjan), over static edges. */
export function findCycles(graph, filter = () => true) {
  let index = 0;
  const stack = [];
  const meta = new Map();
  const out = [];
  const visit = (v) => {
    meta.set(v, { index, low: index, on: true });
    index++;
    stack.push(v);
    for (const w of graph.get(v)?.static ?? []) {
      if (!graph.has(w) || !filter(w)) continue;
      if (!meta.has(w)) {
        visit(w);
        meta.get(v).low = Math.min(meta.get(v).low, meta.get(w).low);
      } else if (meta.get(w).on) meta.get(v).low = Math.min(meta.get(v).low, meta.get(w).index);
    }
    if (meta.get(v).low === meta.get(v).index) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        meta.get(w).on = false;
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) out.push(scc.sort());
    }
  };
  for (const v of graph.keys()) if (filter(v) && !meta.has(v)) visit(v);
  return out;
}

export function staticClosure(graph, entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const t of graph.get(f)?.static ?? []) queue.push(t);
  }
  return seen;
}

export function pathTo(graph, entries, target) {
  const prev = new Map(entries.map((e) => [e, null]));
  const queue = [...entries];
  while (queue.length) {
    const f = queue.shift();
    if (f === target) {
      const chain = [];
      for (let c = f; c; c = prev.get(c)) chain.unshift(c);
      return chain;
    }
    for (const t of graph.get(f)?.static ?? []) {
      if (!prev.has(t)) {
        prev.set(t, f);
        queue.push(t);
      }
    }
  }
  return null;
}
