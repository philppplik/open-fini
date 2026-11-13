// Argument parsing for `ofini`: `--flag`, `--flag=value`, `--flag value` (for flags that take a value), `-x` short
// aliases, `--` ends options, a lone `-` is a positional (stdin or stdout). Unknown flags are usage errors.

export class UsageError extends Error {}

/** Flags every command accepts. */
export const GLOBAL_FLAGS = {
  json: { type: "bool", desc: "Machine-readable JSON output" },
  quiet: { type: "bool", short: "q", desc: "Print only results and errors" },
  "no-color": { type: "bool", desc: "Plain output without colors (also NO_COLOR=1)" },
  color: { type: "bool", desc: "Force colors (also FORCE_COLOR=1)" },
  help: { type: "bool", short: "h", desc: "Help for the command" },
};

/**
 * @param {string[]} argv
 * @param {Record<string, { type: "bool"|"string", short?: string, optional?: boolean }>} spec command flags
 * @returns {{ flags: Record<string, any>, args: string[] }}
 */
export function parseArgs(argv, spec = {}) {
  const all = { ...GLOBAL_FLAGS, ...spec };
  const short = {};
  for (const [k, v] of Object.entries(all)) if (v.short) short[v.short] = k;
  const flags = {};
  const args = [];
  let rest = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (rest || a === "-" || !a.startsWith("-")) {
      args.push(a);
      continue;
    }
    if (a === "--") {
      rest = true;
      continue;
    }
    let name;
    let value;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      value = eq > 0 ? a.slice(eq + 1) : undefined;
    } else {
      // -q, -o value, -qo value
      const letters = a.slice(1);
      for (let j = 0; j < letters.length - 1; j++) {
        const n = short[letters[j]];
        if (!n || all[n].type !== "bool") throw new UsageError(`Unknown option -${letters[j]}.`);
        flags[n] = true;
      }
      name = short[letters[letters.length - 1]];
      if (!name) throw new UsageError(`Unknown option -${letters[letters.length - 1]}.`);
    }
    const def = all[name];
    if (!def) throw new UsageError(`Unknown option --${name}.`);
    if (def.type === "bool") {
      if (value !== undefined && !def.optional) throw new UsageError(`--${name} takes no value.`);
      flags[name] = value === undefined ? true : value;
      continue;
    }
    if (value === undefined) {
      if (def.optional) {
        flags[name] = true;
        continue;
      }
      value = argv[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value.`);
    }
    flags[name] = value;
  }
  if (flags["no-color"]) flags.color = false;
  return { flags, args };
}

/** Splits a command line into words (for the interactive mode): quotes and backslash escapes like a POSIX shell. */
export function splitWords(line) {
  const out = [];
  let cur = "";
  let q = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === q) q = null;
      else if (ch === "\\" && q === '"' && i + 1 < line.length) cur += line[++i];
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      has = true;
    } else if (ch === "\\" && i + 1 < line.length && /[\s"'\\]/.test(line[i + 1])) cur += line[++i];
    else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else cur += ch;
  }
  if (q) throw new UsageError("Unclosed quote.");
  if (cur || has) out.push(cur);
  return out;
}

/** Parses a page list such as "1", "1-3", "2,4-5" or "all" against a page count; returns 0-based indexes. */
export function parsePages(spec, count) {
  if (!spec || spec === "all") return Array.from({ length: count }, (_, i) => i);
  const out = new Set();
  for (const part of String(spec).split(",")) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)?\s*)?$/.exec(part);
    if (!m) throw new UsageError(`Invalid page list “${spec}” (use 1, 1-3, 2,5 or all).`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : part.includes("-") ? count : a;
    if (a < 1 || b < a) throw new UsageError(`Invalid page range “${part.trim()}”.`);
    for (let i = a; i <= Math.min(b, count); i++) out.add(i - 1);
  }
  if (!out.size) throw new UsageError(`No page in “${spec}” exists (the document has ${count}).`);
  return [...out].sort((x, y) => x - y);
}
