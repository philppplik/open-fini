// The expression language of Proto prototypes (docs/concepts/proto-studio.md §6.1, §14.2). Pure: no DOM.
//
// Conditions (`if`) and variable values (`set`) are plain JSON data, interpreted here with a step and depth limit.
// There is no `eval`, no `Function`, no property access on host objects: a variable is read only through the `vars`
// callback, by id.
//
//   expr := null | boolean | finite number | string (≤ 4,000 characters)
//         | { "var": "<variable id>" }                         the variable's current value
//         | { "op": "<operator>", "args": [expr, …] }         an operator applied to its arguments
//         | { "var": "<id>", "op": "<operator>", "value": expr }   shorthand for { op, args: [{ var }, value] }
//   operators: == != < > <= >= (comparison), and or not (logic, short-circuit), + - * / % (arithmetic; "+" with a
//              string concatenates), neg, min, max, concat (strings), if (three arguments: condition, then, else)
//
// Public API
//   evaluate(expr, { vars, maxSteps }) → { ok: true, value } | { ok: false, error }   never throws
//   check(expr) → problems: string[]     static check (shape, operators, arity, limits); [] when well-formed
//   varsOf(expr) → Set<string>           the variable ids an expression reads
//   truthy(value) → boolean

export const OPERATORS = Object.freeze(["==", "!=", "<", ">", "<=", ">=", "and", "or", "not", "+", "-", "*", "/", "%", "neg", "min", "max", "concat", "if"]);
const ARITY = { "==": [2, 2], "!=": [2, 2], "<": [2, 2], ">": [2, 2], "<=": [2, 2], ">=": [2, 2], and: [1, 16], or: [1, 16], not: [1, 1], "+": [1, 16], "-": [2, 2], "*": [1, 16], "/": [2, 2], "%": [2, 2], neg: [1, 1], min: [1, 16], max: [1, 16], concat: [1, 16], if: [3, 3] };
export const LIMITS = Object.freeze({ steps: 2000, depth: 32, string: 4000 });

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

class ExprError extends Error {}

/** True for a value that counts as true in a condition. */
export function truthy(v) {
  return !(v === false || v === null || v === undefined || v === 0 || v === "" || (typeof v === "number" && Number.isNaN(v)));
}

/** The canonical form `{ op, args }` of a node, or null for literals and variable reads. */
function opForm(e) {
  if (own(e, "op") && own(e, "var") && !own(e, "args")) return { op: e.op, args: [{ var: e.var }, own(e, "value") ? e.value : null] };
  if (own(e, "op")) return { op: e.op, args: e.args };
  return null;
}

/**
 * Static check of an expression's shape (no variable values needed).
 * @param {unknown} expr
 * @returns {string[]}
 */
export function check(expr) {
  const out = [];
  let nodes = 0;
  const walk = (e, depth, path) => {
    if (out.length > 20) return;
    if (++nodes > LIMITS.steps) return void out.push("The expression is too large.");
    if (depth > LIMITS.depth) return void out.push(`${path}: nested too deeply.`);
    if (e === null || typeof e === "boolean") return;
    if (typeof e === "number") return void (Number.isFinite(e) || out.push(`${path}: numbers must be finite.`));
    if (typeof e === "string") return void (e.length <= LIMITS.string || out.push(`${path}: the text is too long.`));
    if (!isObj(e)) return void out.push(`${path}: expected a value, { var } or { op, args }.`);
    const f = opForm(e);
    if (!f) {
      if (!own(e, "var") || Object.keys(e).length !== 1) return void out.push(`${path}: expected { var } or { op, args }.`);
      if (typeof e.var !== "string" || !ID_RE.test(e.var)) out.push(`${path}.var: expected a variable id.`);
      return;
    }
    if (own(e, "var") && (typeof e.var !== "string" || !ID_RE.test(e.var))) out.push(`${path}.var: expected a variable id.`);
    for (const k of Object.keys(e)) if (!["op", "args", "var", "value"].includes(k)) out.push(`${path}: unknown key “${k}”.`);
    if (typeof f.op !== "string" || !own(ARITY, f.op)) return void out.push(`${path}.op: unknown operator “${String(f.op)}”.`);
    if (!Array.isArray(f.args)) return void out.push(`${path}.args: expected a list.`);
    const [lo, hi] = ARITY[f.op];
    if (f.args.length < lo || f.args.length > hi) out.push(`${path}: “${f.op}” takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? "" : "s"}.`);
    f.args.forEach((a, i) => walk(a, depth + 1, `${path}.args[${i}]`));
  };
  walk(expr, 0, "expr");
  return out;
}

/** The variable ids an expression reads. */
export function varsOf(expr, out = new Set(), depth = 0) {
  if (depth > LIMITS.depth || !isObj(expr)) return out;
  if (typeof expr.var === "string") out.add(expr.var);
  const f = opForm(expr);
  if (f && Array.isArray(f.args)) for (const a of f.args.slice(0, 16)) varsOf(a, out, depth + 1);
  return out;
}

const num = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return v == null ? 0 : NaN;
};
const str = (v) => (v == null ? "" : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : String(v));
const clampStr = (s) => (s.length > LIMITS.string ? s.slice(0, LIMITS.string) : s);
const finite = (n) => (Number.isFinite(n) ? n : 0);

function equal(a, b) {
  if (typeof a === typeof b) return a === b;
  if ((typeof a === "number" || typeof a === "boolean") && (typeof b === "number" || typeof b === "boolean")) return num(a) === num(b);
  if ((typeof a === "number" && typeof b === "string") || (typeof a === "string" && typeof b === "number")) return num(a) === num(b);
  return (a ?? null) === (b ?? null);
}
function compare(op, a, b) {
  if (typeof a === "string" && typeof b === "string") {
    const c = a < b ? -1 : a > b ? 1 : 0;
    return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
  }
  const x = num(a);
  const y = num(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  return op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y;
}

/**
 * Evaluates an expression. Never throws: malformed expressions, unknown operators and exceeded limits return an error.
 * @param {unknown} expr
 * @param {{ vars?: (id: string) => unknown, maxSteps?: number }} [o]
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function evaluate(expr, { vars = () => undefined, maxSteps = LIMITS.steps } = {}) {
  let steps = 0;
  const readVar = (id) => {
    if (typeof id !== "string" || !ID_RE.test(id)) throw new ExprError("Expected a variable id.");
    const v = vars(id);
    // only plain values leave the host: objects and functions read as null
    return v === undefined || v === null ? null : typeof v === "number" ? finite(v) : typeof v === "string" ? clampStr(v) : typeof v === "boolean" ? v : null;
  };
  const ev = (e, depth) => {
    if (++steps > maxSteps) throw new ExprError("The expression takes too many steps.");
    if (depth > LIMITS.depth) throw new ExprError("The expression is nested too deeply.");
    if (e === null || typeof e === "boolean") return e;
    if (typeof e === "number") {
      if (!Number.isFinite(e)) throw new ExprError("Numbers must be finite.");
      return e;
    }
    if (typeof e === "string") return clampStr(e);
    if (!isObj(e)) throw new ExprError("Expected a value, { var } or { op, args }.");
    const f = opForm(e);
    if (!f) {
      if (!own(e, "var") || Object.keys(e).length !== 1) throw new ExprError("Expected { var } or { op, args }.");
      return readVar(e.var);
    }
    if (typeof f.op !== "string" || !own(ARITY, f.op)) throw new ExprError(`Unknown operator “${String(f.op)}”.`);
    if (!Array.isArray(f.args)) throw new ExprError("Expected a list of arguments.");
    const [lo, hi] = ARITY[f.op];
    if (f.args.length < lo || f.args.length > hi) throw new ExprError(`“${f.op}” takes ${lo === hi ? lo : `${lo} to ${hi}`} arguments.`);
    const a = (i) => ev(f.args[i], depth + 1);
    const all = () => f.args.map((_, i) => a(i));
    switch (f.op) {
      case "==":
        return equal(a(0), a(1));
      case "!=":
        return !equal(a(0), a(1));
      case "<":
      case ">":
      case "<=":
      case ">=":
        return compare(f.op, a(0), a(1));
      case "and": {
        let v = true;
        for (let i = 0; i < f.args.length; i++) if (!truthy((v = a(i)))) return false;
        return truthy(v);
      }
      case "or": {
        for (let i = 0; i < f.args.length; i++) if (truthy(a(i))) return true;
        return false;
      }
      case "not":
        return !truthy(a(0));
      case "+": {
        const vs = all();
        if (vs.some((v) => typeof v === "string")) return clampStr(vs.map(str).join(""));
        return finite(vs.reduce((s, v) => s + num(v), 0));
      }
      case "-":
        return finite(num(a(0)) - num(a(1)));
      case "*":
        return finite(all().reduce((s, v) => s * num(v), 1));
      case "/": {
        const d = num(a(1));
        return d === 0 ? 0 : finite(num(a(0)) / d);
      }
      case "%": {
        const d = num(a(1));
        return d === 0 ? 0 : finite(num(a(0)) % d);
      }
      case "neg":
        return finite(-num(a(0)));
      case "min":
        return finite(Math.min(...all().map(num)));
      case "max":
        return finite(Math.max(...all().map(num)));
      case "concat":
        return clampStr(all().map(str).join(""));
      case "if":
        return truthy(a(0)) ? a(1) : a(2);
    }
    throw new ExprError("Unknown operator.");
  };
  try {
    return { ok: true, value: ev(expr, 0) };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.message };
    if (e instanceof RangeError) return { ok: false, error: "The expression is nested too deeply." };
    return { ok: false, error: String(e?.message || e) };
  }
}
