// The prototype expression language (engine/proto/expr.js, task T9): the operators, the static check, limits, and a
// fuzz test that random data never throws, never reaches the host and only ever yields plain values.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, check, varsOf, truthy, OPERATORS } from "../../app/src/engine/proto/expr.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";

const vars = { v1: 3, v2: "Ada", v3: true, v4: null };
const ev = (e) => {
  const r = evaluate(e, { vars: (id) => vars[id] });
  assert.ok(r.ok, `${JSON.stringify(e)}: ${r.error}`);
  return r.value;
};

test("operators, short-circuit logic, coercion and the shorthand condition", () => {
  assert.equal(ev(1), 1);
  assert.equal(ev("x"), "x");
  assert.equal(ev(null), null);
  assert.equal(ev({ var: "v1" }), 3);
  assert.equal(ev({ var: "missing" }), null);
  assert.equal(ev({ var: "v1", op: "==", value: 3 }), true);
  assert.equal(ev({ var: "v1", op: "==", value: "3" }), true, "numbers and numeric strings compare");
  assert.equal(ev({ op: "!=", args: [{ var: "v2" }, "Ada"] }), false);
  assert.equal(ev({ op: "<", args: [1, 2] }), true);
  assert.equal(ev({ op: ">=", args: ["b", "a"] }), true);
  assert.equal(ev({ op: "and", args: [true, { var: "v3" }, 1] }), true);
  assert.equal(ev({ op: "or", args: [false, 0, ""] }), false);
  assert.equal(ev({ op: "not", args: [{ var: "v4" }] }), true);
  assert.equal(ev({ op: "+", args: [{ var: "v1" }, 2, 0.5] }), 5.5);
  assert.equal(ev({ op: "+", args: ["Hi ", { var: "v2" }, "!"] }), "Hi Ada!", "+ with text concatenates");
  assert.equal(ev({ op: "concat", args: ["n=", { var: "v1" }] }), "n=3");
  assert.equal(ev({ op: "-", args: [10, 4] }), 6);
  assert.equal(ev({ op: "*", args: [2, 3, 4] }), 24);
  assert.equal(ev({ op: "/", args: [1, 0] }), 0, "no infinities");
  assert.equal(ev({ op: "%", args: [7, 3] }), 1);
  assert.equal(ev({ op: "neg", args: [2] }), -2);
  assert.equal(ev({ op: "min", args: [3, 1, 2] }), 1);
  assert.equal(ev({ op: "max", args: [3, 1, 2] }), 3);
  assert.equal(ev({ op: "if", args: [{ var: "v3" }, "yes", "no"] }), "yes");
  // `or` does not evaluate past the first true value (the error would surface otherwise)
  assert.equal(ev({ op: "or", args: [true, { op: "nope", args: [] }] }), true);
  assert.equal(truthy(0), false);
  assert.equal(truthy("0"), true);
  assert.deepEqual([...varsOf({ op: "and", args: [{ var: "a" }, { var: "b", op: "==", value: { var: "c" } }] })].sort(), ["a", "b", "c"]);
});

test("the static check names what is wrong", () => {
  assert.deepEqual(check({ op: "+", args: [1, { var: "v1" }] }), []);
  assert.deepEqual(check({ var: "v1", op: "==", value: 2 }), []);
  assert.match(check({ op: "eval", args: [] }).join(), /unknown operator/);
  assert.match(check({ op: "not", args: [1, 2] }).join(), /takes 1 argument/);
  assert.match(check({ op: "+" }).join(), /args/);
  assert.match(check({ var: "../x" }).join(), /variable id/);
  assert.match(check({ var: "v1", extra: 1 }).join(), /expected \{ var \}/);
  assert.match(check(Infinity).join(), /finite/);
  assert.match(check("x".repeat(5000)).join(), /too long/);
  assert.match(check([1]).join(), /expected a value/);
  let deep = 1;
  for (let i = 0; i < 40; i++) deep = { op: "neg", args: [deep] };
  assert.match(check(deep).join(), /nested too deeply/);
  assert.equal(evaluate(deep).ok, false);
});

test("limits: steps, depth and host values never leak", () => {
  let wide = 0;
  for (let i = 0; i < 20; i++) wide = { op: "+", args: Array(16).fill(wide).slice(0, 2) };
  const r = evaluate(wide);
  assert.equal(r.ok, false);
  assert.match(r.error, /too many steps|nested too deeply/);
  const host = { v: { toString: () => "leak" }, f: () => 1, big: Infinity, s: "x".repeat(10000) };
  assert.equal(evaluate({ var: "v" }, { vars: (id) => host[id] }).value, null, "objects read as null");
  assert.equal(evaluate({ var: "f" }, { vars: (id) => host[id] }).value, null, "functions read as null");
  assert.equal(evaluate({ var: "big" }, { vars: (id) => host[id] }).value, 0);
  assert.equal(evaluate({ var: "s" }, { vars: (id) => host[id] }).value.length, 4000);
  for (const name of ["__proto__", "constructor", "toString"]) {
    assert.equal(evaluate({ op: name, args: [] }).ok, false, name);
    const r = evaluate({ var: name }, { vars: (id) => ({})[id] });
    assert.ok(!r.ok || r.value === null, name);
  }
});

test("fuzz: random data never throws and yields only plain values", () => {
  const rnd = seededRandom(2026);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const KEYS = ["op", "args", "var", "value", "x", "__proto__", "constructor"];
  const gen = (d) => {
    const k = rnd();
    if (d > 6 || k < 0.25) return pick([0, -1, 1.5, NaN, Infinity, "", "a", "3", true, false, null, undefined, [], {}]);
    if (k < 0.45) return { var: pick(["v1", "v2", "v3", "v4", "nope", "", "../x", 5, null]) };
    if (k < 0.85) return { op: pick([...OPERATORS, "eval", "Function", "__proto__", 7]), args: Array.from({ length: Math.floor(rnd() * 5) }, () => gen(d + 1)) };
    const o = {};
    for (let i = 0; i < 3; i++) o[pick(KEYS)] = gen(d + 1);
    return o;
  };
  let ok = 0;
  for (let i = 0; i < 3000; i++) {
    const e = gen(0);
    let r;
    assert.doesNotThrow(() => (r = evaluate(e, { vars: (id) => vars[id] })));
    let problems;
    assert.doesNotThrow(() => (problems = check(e)));
    // what the static check accepts evaluates (short-circuit logic may also evaluate some it rejects)
    if (!problems.length) assert.ok(r.ok || /steps/.test(r.error), `${JSON.stringify(e)}: ${r.error}`);
    if (r.ok) {
      ok++;
      assert.ok(r.value === null || ["number", "string", "boolean"].includes(typeof r.value), JSON.stringify(e));
      if (typeof r.value === "number") assert.ok(Number.isFinite(r.value), JSON.stringify(e));
    }
  }
  assert.ok(ok > 300, `some random expressions are valid (${ok})`);
});
