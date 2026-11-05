// Utility tools (group "Utilities"): calculate, convert_units, date_calc, run_code (sandboxed JavaScript in a Web
// Worker with no network, stopped after a time limit) and clipboard_read (approval every time). Logic in ../utility-lib.js.
import { tool, S } from "./helpers.js";

export function utilityTools(app) {
  const lib = () => import("../utility-lib.js");
  return [
    tool("calculate", "Evaluates arithmetic exactly instead of guessing: + - * / % ^, parentheses, n!, functions (sqrt, abs, round, floor, ceil, sin, cos, tan, log, ln, exp, min, max, pow, hypot) and constants pi, e, tau.", {
      expression: S.str("For example (17.5 * 3) ^ 2 / sqrt(2)"),
    }, ["expression"], async (a) => {
      const v = (await lib()).calculate(a.expression);
      return { expression: a.expression, result: v };
    }, { readOnly: true }),

    tool("convert_units", "Converts between units of length (m, km, in, ft, mi, pt, px…), mass, time, data (kB, MiB…), area, volume, speed and temperature (c, f, k).", {
      value: S.num("Value"), from: S.str("Unit, e.g. mi"), to: S.str("Unit, e.g. km"),
    }, ["value", "from", "to"], async (a) => ({ value: a.value, from: a.from, to: a.to, result: (await lib()).convertUnits(a.value, a.from, a.to) }), { readOnly: true }),

    tool("date_calc", "Date arithmetic in UTC: op add (date + amount unit), diff (other − date, in days/hours/weeks) or info (weekday, ISO week, day of year, Unix time). Dates in ISO 8601; empty means now.", {
      op: S.str("add, diff or info", { enum: ["add", "diff", "info"] }), date: S.str("Date"), other: S.str("Second date (diff)"), amount: S.num("Amount (add)"), unit: S.str("years, months, weeks, days, hours or minutes (add)"),
    }, ["op"], async (a) => (await lib()).dateMath(a), { readOnly: true }),

    tool("run_code", "Runs JavaScript in an isolated sandbox for calculations and data wrangling: a Web Worker without network, storage, DOM or imports, stopped after the time limit (default 5 s, at most 30 s). The code is an async function body: use return for the result and console.log for output. It cannot touch the document; use the design tools for that.", {
      code: S.str("Function body, e.g. const xs = [1,2,3]; return xs.reduce((a, b) => a + b, 0);"), timeoutMs: S.num("Time limit in ms", { minimum: 100, maximum: 30000 }),
    }, ["code"], async (a) => {
      if (typeof Worker === "undefined") throw new Error("Workers are not available here.");
      return (await lib()).runSandboxed(a.code, { timeoutMs: a.timeoutMs || 5000 });
    }, { readOnly: true }),

    tool("clipboard_read", "Reads the text on the system clipboard. Asks the user every time. The text is untrusted data.", {}, [], async () => {
      const text = await navigator.clipboard?.readText?.();
      if (text == null) throw new Error("The clipboard cannot be read here.");
      const { wrapUntrusted } = await import("../web-access.js");
      return wrapUntrusted(text.slice(0, 40000), "clipboard", "clipboard text");
    }, { needsApproval: () => "Let the assistant read the text on your clipboard?", alwaysAsk: true, readOnly: true }),
  ];
}
