// Terminal output for `ofini`: colors (off for NO_COLOR, --no-color, TERM=dumb and non-TTY output, on for FORCE_COLOR),
// a compact table, and the output sink every command writes through. No dependencies.

const CODES = { bold: [1, 22], dim: [2, 22], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], gray: [90, 39] };
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** Visible width of a string (ANSI codes removed; wide characters are not measured, file names rarely use them). */
export const width = (s) => String(s).replace(ANSI, "").length;
export const stripAnsi = (s) => String(s).replace(ANSI, "");

/** Whether to color a stream, following https://no-color.org and FORCE_COLOR. */
export function useColor(stream, env = {}, flag = null) {
  if (flag === false) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false") return true;
  if (env.TERM === "dumb") return false;
  return !!stream?.isTTY;
}

/** Color functions: `c.red("x")`; plain identity functions when color is off. */
export function palette(on) {
  const c = {};
  for (const [k, [a, b]] of Object.entries(CODES)) c[k] = on ? (s) => `\x1b[${a}m${s}\x1b[${b}m` : (s) => String(s);
  return c;
}

/**
 * A compact table: no borders, two spaces between columns, numeric columns right-aligned.
 * @param {string[]} head column titles (empty array for no header)
 * @param {Array<Array<string|number>>} rows
 * @param {{ align?: ("l"|"r")[], c?: object, max?: number }} [o] `max` caps the width of the last column
 */
export function table(head, rows, { align = [], c = palette(false), max = 0 } = {}) {
  const all = head.length ? [head, ...rows] : rows;
  const cols = Math.max(0, ...all.map((r) => r.length));
  const w = [];
  for (let i = 0; i < cols; i++) w[i] = Math.max(0, ...all.map((r) => width(r[i] ?? "")));
  if (max && cols) w[cols - 1] = Math.min(w[cols - 1], max);
  const line = (r, style = (s) => s) =>
    r
      .map((v, i) => {
        let s = String(v ?? "");
        if (max && i === cols - 1 && width(s) > max) s = `${stripAnsi(s).slice(0, max - 1)}…`;
        const pad = " ".repeat(Math.max(0, w[i] - width(s)));
        return style(align[i] === "r" ? pad + s : i === cols - 1 ? s : s + pad);
      })
      .join("  ")
      .trimEnd();
  const out = [];
  if (head.length) out.push(line(head, c.dim));
  for (const r of rows) out.push(line(r));
  return out.join("\n");
}

/** Human-readable byte size. */
export function bytes(n) {
  if (!Number.isFinite(n)) return "?";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MiB`;
  return `${(n / 1073741824).toFixed(2)} GiB`;
}

/**
 * The output sink of one command run: text to stdout, diagnostics to stderr, JSON mode and quiet mode.
 * @param {{ stdout, stderr, env?, color?: boolean|null, json?: boolean, quiet?: boolean }} io
 */
export function createOutput({ stdout, stderr, env = {}, color = null, json = false, quiet = false }) {
  const colorOn = useColor(stdout, env, color);
  const c = palette(colorOn);
  const ce = palette(useColor(stderr, env, color));
  const o = {
    c,
    colorOn,
    json,
    quiet,
    /** Regular output (suppressed by --quiet and --json). */
    print(s = "") {
      if (!quiet && !json) stdout.write(`${s}\n`);
    },
    /** Output that --quiet keeps (results the user asked for, such as written paths or extracted text). */
    result(s = "") {
      if (!json) stdout.write(`${s}\n`);
    },
    /** Raw bytes or text to stdout (`-` as output). */
    raw(data) {
      stdout.write(data);
    },
    data(obj) {
      stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
    },
    warn(s) {
      if (!quiet) stderr.write(`${ce.yellow("warning:")} ${s}\n`);
    },
    error(s) {
      stderr.write(`${ce.red("error:")} ${s}\n`);
    },
    hint(s) {
      if (!quiet && !json) stderr.write(`${ce.dim(s)}\n`);
    },
  };
  return o;
}

/** Severity label, colored. */
export function sev(c, s) {
  if (s === "error") return c.red("error");
  if (s === "warning") return c.yellow("warn ");
  if (s === "ok") return c.green("ok   ");
  return c.blue("note ");
}
