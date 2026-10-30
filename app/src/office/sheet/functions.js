// Function library of the spreadsheet formula engine (office/sheet/formula.js). Each entry is
// { fn(args, ctx), lazy?, allowErrors? }: plain functions get evaluated arguments (values or range objects
// { range, sid, r0, c0, r1, c1 }); lazy ones get thunks (IF, IFERROR, CHOOSE …). Pure; errors are FErr values.
// The list is documented in docs/office-sheet.md ▸ Functions. Tests: tests/office/sheet-formula.test.js.
import { FErr, isErr, ERR, toNum, toText, compareValues, scalar } from "./values.js";
import { formatCode, dateToSerial, serialToDate } from "./numfmt-code.js";

const MAX_CELLS = 2_000_000;

/** Cells of a range as a 2D array of values. */
export function rangeValues(rg, ctx) {
  const rows = rg.r1 - rg.r0 + 1;
  const cols = rg.c1 - rg.c0 + 1;
  if (rows * cols > MAX_CELLS) throw ERR["#NUM!"];
  const out = [];
  for (let r = rg.r0; r <= rg.r1; r++) {
    const row = [];
    for (let c = rg.c0; c <= rg.c1; c++) row.push(ctx.get(rg.sid, r, c));
    out.push(row);
  }
  return out;
}

/** Every value of the arguments, flattened. In ranges only numbers count for numeric functions (`numbersOnly`). */
function each(args, ctx, cb, { numbersOnly = true, keepErrors = false } = {}) {
  for (const a of args) {
    if (a && a.range) {
      for (let r = a.r0; r <= a.r1; r++)
        for (let c = a.c0; c <= a.c1; c++) {
          const v = ctx.get(a.sid, r, c);
          if (isErr(v)) {
            if (!keepErrors) throw v;
            cb(v, true);
          } else if (!numbersOnly || typeof v === "number") cb(v, true);
        }
    } else cb(a, false);
  }
}

function nums(args, ctx) {
  const out = [];
  each(args, ctx, (v, inRange) => {
    if (inRange) {
      if (typeof v === "number") out.push(v);
      return;
    }
    if (v == null) return;
    const n = toNum(v);
    if (isErr(n)) throw n;
    out.push(n);
  });
  return out;
}

const num = (v, ctx) => {
  const n = toNum(scalar(v, ctx));
  if (isErr(n)) throw n;
  return n;
};
const str = (v, ctx) => {
  const s = scalar(v, ctx);
  if (isErr(s)) throw s;
  return toText(s);
};
const bool = (v, ctx) => {
  const s = scalar(v, ctx);
  if (isErr(s)) throw s;
  if (typeof s === "boolean") return s;
  if (typeof s === "string") {
    if (/^true$/i.test(s)) return true;
    if (/^false$/i.test(s)) return false;
    throw ERR["#VALUE!"];
  }
  return toNum(s) !== 0;
};
const opt = (args, i, d) => (args[i] === undefined || args[i] === null ? d : args[i]);
const check = (n) => {
  if (!Number.isFinite(n)) throw ERR["#NUM!"];
  return n;
};
const roundTo = (x, d, mode) => {
  const f = Math.pow(10, d);
  const y = x * f;
  const r = mode === "up" ? Math.sign(y) * Math.ceil(Math.abs(y) - 1e-9) : mode === "down" ? Math.trunc(y) : Math.sign(y) * Math.round(Math.abs(y) + 1e-9 * Math.sign(Math.abs(y)));
  return Number((r / f).toPrecision(15));
};

/** A criteria string ("<5", ">=10", "<>x", "a*", 3) → predicate (COUNTIF, SUMIF …). */
export function criteria(c) {
  if (typeof c === "number" || typeof c === "boolean") return (v) => v === c || (typeof v === "string" && compareValues(toNum(v), c) === 0 && v.trim() !== "");
  const s = c == null ? "" : String(c);
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(s);
  const op = m[1] || "=";
  const raw = m[2];
  const n = raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
  if (n !== null) {
    return (v) => {
      if (typeof v !== "number") return op === "<>";
      return op === "=" ? v === n : op === "<>" ? v !== n : op === "<" ? v < n : op === ">" ? v > n : op === "<=" ? v <= n : v >= n;
    };
  }
  if (op === "=" || op === "<>") {
    if (raw === "") return (v) => (op === "=" ? v == null || v === "" : !(v == null || v === ""));
    const re = wildcard(raw);
    return (v) => {
      const hit = v != null && !isErr(v) && re.test(toText(v));
      return op === "=" ? hit : !hit;
    };
  }
  return (v) => {
    if (typeof v !== "string") return false;
    const k = compareValues(v, raw);
    return op === "<" ? k < 0 : op === ">" ? k > 0 : op === "<=" ? k <= 0 : k >= 0;
  };
}

function wildcard(p) {
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "~" && i + 1 < p.length) re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (ch === "*") re += "[\\s\\S]*";
    else if (ch === "?") re += "[\\s\\S]";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

const asRange = (a) => {
  if (!a || !a.range) throw ERR["#VALUE!"];
  return a;
};

/** Pairs of (criteria range, criteria) → rows/cols offsets that match all. */
function matchAll(pairs, ctx) {
  const first = asRange(pairs[0][0]);
  const h = first.r1 - first.r0 + 1;
  const w = first.c1 - first.c0 + 1;
  const preds = pairs.map(([rg, c]) => {
    const g = asRange(rg);
    if (g.r1 - g.r0 + 1 !== h || g.c1 - g.c0 + 1 !== w) throw ERR["#VALUE!"];
    return [g, criteria(scalar(c, ctx))];
  });
  const hits = [];
  for (let i = 0; i < h; i++)
    for (let j = 0; j < w; j++) if (preds.every(([g, p]) => p(ctx.get(g.sid, g.r0 + i, g.c0 + j)))) hits.push([i, j]);
  return hits;
}

const at = (g, i, j, ctx) => ctx.get(g.sid, g.r0 + i, g.c0 + j);

/** Lookup in a 1-D list of values. mode 0 exact (wildcards for text), 1 largest ≤, -1 smallest ≥. */
function lookupIndex(list, key, mode, { wild = true, reverse = false } = {}) {
  if (mode === 0 || mode === 2) {
    const re = typeof key === "string" && wild && /[*?~]/.test(key) ? wildcard(key) : null;
    const n = list.length;
    for (let k = 0; k < n; k++) {
      const i = reverse ? n - 1 - k : k;
      const v = list[i];
      if (re ? typeof v === "string" && re.test(v) : v != null && typeof v === typeof key && compareValues(v, key) === 0) return i;
    }
    return -1;
  }
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v == null || typeof v !== typeof key) continue;
    const c = compareValues(v, key);
    if (c === 0) return i;
    if (mode === 1 && c < 0 && (best < 0 || compareValues(v, list[best]) > 0)) best = i;
    if (mode === -1 && c > 0 && (best < 0 || compareValues(v, list[best]) < 0)) best = i;
  }
  return best;
}

function line(g, ctx) {
  const vertical = g.c0 === g.c1;
  const n = vertical ? g.r1 - g.r0 + 1 : g.c1 - g.c0 + 1;
  const list = [];
  for (let k = 0; k < n; k++) list.push(vertical ? ctx.get(g.sid, g.r0 + k, g.c0) : ctx.get(g.sid, g.r0, g.c0 + k));
  return { list, vertical };
}

const today = () => {
  const d = new Date();
  return dateToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

const statN = (args, ctx) => {
  const v = nums(args, ctx);
  if (!v.length) throw ERR["#DIV/0!"];
  return v;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const variance = (v, sample) => {
  if (v.length < (sample ? 2 : 1)) throw ERR["#DIV/0!"];
  const m = mean(v);
  return v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - (sample ? 1 : 0));
};

const F = {};
const def = (names, fn, o = {}) => {
  for (const n of names.split(" ")) F[n] = { fn, ...o };
};

// ---- math and statistics
def("SUM", (a, ctx) => nums(a, ctx).reduce((x, y) => x + y, 0));
def("AVERAGE AVG", (a, ctx) => mean(statN(a, ctx)));
def("MIN", (a, ctx) => {
  const v = nums(a, ctx);
  return v.length ? Math.min(...v) : 0;
});
def("MAX", (a, ctx) => {
  const v = nums(a, ctx);
  return v.length ? Math.max(...v) : 0;
});
def("COUNT", (a, ctx) => {
  let n = 0;
  each(a, ctx, (v, inRange) => (typeof v === "number" || (!inRange && v != null && !isErr(toNum(v))) ? n++ : 0), { numbersOnly: false, keepErrors: true });
  return n;
}, { allowErrors: true });
def("COUNTA", (a, ctx) => {
  let n = 0;
  each(a, ctx, (v) => (v != null && v !== "" ? n++ : 0), { numbersOnly: false, keepErrors: true });
  return n;
}, { allowErrors: true });
def("COUNTBLANK", (a, ctx) => {
  let n = 0;
  each([asRange(a[0])], ctx, (v) => (v == null || v === "" ? n++ : 0), { numbersOnly: false, keepErrors: true });
  return n;
});
def("PRODUCT", (a, ctx) => nums(a, ctx).reduce((x, y) => x * y, 1));
def("MEDIAN", (a, ctx) => {
  const v = statN(a, ctx).sort((x, y) => x - y);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
});
def("MODE MODE.SNGL", (a, ctx) => {
  const counts = new Map();
  for (const v of nums(a, ctx)) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  for (const [v, c] of counts) if (c > 1 && (best === null || c > counts.get(best))) best = v;
  if (best === null) throw ERR["#N/A"];
  return best;
});
def("STDEV STDEV.S", (a, ctx) => Math.sqrt(variance(nums(a, ctx), true)));
def("STDEVP STDEV.P", (a, ctx) => Math.sqrt(variance(nums(a, ctx), false)));
def("VAR VAR.S", (a, ctx) => variance(nums(a, ctx), true));
def("VARP VAR.P", (a, ctx) => variance(nums(a, ctx), false));
def("LARGE", (a, ctx) => {
  const v = nums([a[0]], ctx).sort((x, y) => y - x);
  const k = Math.trunc(num(a[1], ctx));
  if (k < 1 || k > v.length) throw ERR["#NUM!"];
  return v[k - 1];
});
def("SMALL", (a, ctx) => {
  const v = nums([a[0]], ctx).sort((x, y) => x - y);
  const k = Math.trunc(num(a[1], ctx));
  if (k < 1 || k > v.length) throw ERR["#NUM!"];
  return v[k - 1];
});
def("RANK RANK.EQ", (a, ctx) => {
  const x = num(a[0], ctx);
  const v = nums([a[1]], ctx);
  const asc = a[2] != null && num(a[2], ctx) !== 0;
  if (!v.includes(x)) throw ERR["#N/A"];
  return 1 + v.filter((y) => (asc ? y < x : y > x)).length;
});
def("ROUND", (a, ctx) => roundTo(num(a[0], ctx), Math.trunc(num(opt(a, 1, 0), ctx))));
def("ROUNDUP", (a, ctx) => roundTo(num(a[0], ctx), Math.trunc(num(opt(a, 1, 0), ctx)), "up"));
def("ROUNDDOWN TRUNC", (a, ctx) => roundTo(num(a[0], ctx), Math.trunc(num(opt(a, 1, 0), ctx)), "down"));
def("INT", (a, ctx) => Math.floor(num(a[0], ctx)));
def("ABS", (a, ctx) => Math.abs(num(a[0], ctx)));
def("SIGN", (a, ctx) => Math.sign(num(a[0], ctx)));
def("SQRT", (a, ctx) => {
  const x = num(a[0], ctx);
  if (x < 0) throw ERR["#NUM!"];
  return Math.sqrt(x);
});
def("POWER", (a, ctx) => check(Math.pow(num(a[0], ctx), num(a[1], ctx))));
def("EXP", (a, ctx) => check(Math.exp(num(a[0], ctx))));
def("LN", (a, ctx) => {
  const x = num(a[0], ctx);
  if (x <= 0) throw ERR["#NUM!"];
  return Math.log(x);
});
def("LOG", (a, ctx) => {
  const x = num(a[0], ctx);
  const b = num(opt(a, 1, 10), ctx);
  if (x <= 0 || b <= 0 || b === 1) throw ERR["#NUM!"];
  return Math.log(x) / Math.log(b);
});
def("LOG10", (a, ctx) => {
  const x = num(a[0], ctx);
  if (x <= 0) throw ERR["#NUM!"];
  return Math.log10(x);
});
def("MOD", (a, ctx) => {
  const x = num(a[0], ctx);
  const d = num(a[1], ctx);
  if (d === 0) throw ERR["#DIV/0!"];
  return x - d * Math.floor(x / d);
});
def("QUOTIENT", (a, ctx) => {
  const d = num(a[1], ctx);
  if (d === 0) throw ERR["#DIV/0!"];
  return Math.trunc(num(a[0], ctx) / d);
});
def("CEILING CEILING.MATH", (a, ctx) => {
  const x = num(a[0], ctx);
  const s = Math.abs(num(opt(a, 1, 1), ctx)) || 1;
  return Number((Math.ceil(x / s - 1e-12) * s).toPrecision(15));
});
def("FLOOR FLOOR.MATH", (a, ctx) => {
  const x = num(a[0], ctx);
  const s = Math.abs(num(opt(a, 1, 1), ctx)) || 1;
  return Number((Math.floor(x / s + 1e-12) * s).toPrecision(15));
});
def("PI", () => Math.PI);
def("RAND", () => Math.random());
def("RANDBETWEEN", (a, ctx) => {
  const lo = Math.ceil(num(a[0], ctx));
  const hi = Math.floor(num(a[1], ctx));
  if (hi < lo) throw ERR["#NUM!"];
  return lo + Math.floor(Math.random() * (hi - lo + 1));
});
def("SUMSQ", (a, ctx) => nums(a, ctx).reduce((x, y) => x + y * y, 0));
def("SUMPRODUCT", (a, ctx) => {
  const gs = a.map((x) => (x && x.range ? rangeValues(x, ctx) : [[scalar(x, ctx)]]));
  const h = gs[0].length;
  const w = gs[0][0]?.length || 0;
  if (gs.some((g) => g.length !== h || (g[0]?.length || 0) !== w)) throw ERR["#VALUE!"];
  let s = 0;
  for (let i = 0; i < h; i++)
    for (let j = 0; j < w; j++) {
      let p = 1;
      for (const g of gs) {
        const v = g[i][j];
        if (isErr(v)) throw v;
        p *= typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : 0;
      }
      s += p;
    }
  return s;
});

// ---- conditional aggregates
def("COUNTIF", (a, ctx) => matchAll([[a[0], a[1]]], ctx).length);
def("COUNTIFS", (a, ctx) => {
  const pairs = [];
  for (let i = 0; i + 1 < a.length; i += 2) pairs.push([a[i], a[i + 1]]);
  if (!pairs.length) throw ERR["#VALUE!"];
  return matchAll(pairs, ctx).length;
});
const sumIf = (a, ctx, avg) => {
  const g = asRange(a[0]);
  const tgt = a[2] != null ? asRange(a[2]) : g;
  let s = 0;
  let n = 0;
  for (const [i, j] of matchAll([[g, a[1]]], ctx)) {
    const v = at(tgt, i, j, ctx);
    if (typeof v === "number") (s += v), n++;
  }
  if (avg && !n) throw ERR["#DIV/0!"];
  return avg ? s / n : s;
};
def("SUMIF", (a, ctx) => sumIf(a, ctx, false));
def("AVERAGEIF", (a, ctx) => sumIf(a, ctx, true));
const ifs = (a, ctx, reduce) => {
  const tgt = asRange(a[0]);
  const pairs = [];
  for (let i = 1; i + 1 < a.length; i += 2) pairs.push([a[i], a[i + 1]]);
  if (!pairs.length) throw ERR["#VALUE!"];
  const vals = matchAll(pairs, ctx).map(([i, j]) => at(tgt, i, j, ctx)).filter((v) => typeof v === "number");
  return reduce(vals);
};
def("SUMIFS", (a, ctx) => ifs(a, ctx, (v) => v.reduce((x, y) => x + y, 0)));
def("AVERAGEIFS", (a, ctx) => ifs(a, ctx, (v) => {
  if (!v.length) throw ERR["#DIV/0!"];
  return mean(v);
}));
def("MAXIFS", (a, ctx) => ifs(a, ctx, (v) => (v.length ? Math.max(...v) : 0)));
def("MINIFS", (a, ctx) => ifs(a, ctx, (v) => (v.length ? Math.min(...v) : 0)));

// ---- logic
def("IF", (t, ctx) => {
  const c = scalar(t[0](), ctx);
  if (isErr(c)) return c;
  let b;
  try {
    b = bool(c, ctx);
  } catch (e) {
    return e;
  }
  return b ? (t[1] ? t[1]() : true) : t[2] ? t[2]() : false;
}, { lazy: true });
def("IFERROR", (t, ctx) => {
  const v = scalar(t[0](), ctx);
  return isErr(v) ? (t[1] ? t[1]() : 0) : v;
}, { lazy: true });
def("IFNA", (t, ctx) => {
  const v = scalar(t[0](), ctx);
  return isErr(v) && v.code === "#N/A" ? (t[1] ? t[1]() : 0) : v;
}, { lazy: true });
def("IFS", (t, ctx) => {
  for (let i = 0; i + 1 < t.length; i += 2) {
    const c = scalar(t[i](), ctx);
    if (isErr(c)) return c;
    if (bool(c, ctx)) return t[i + 1]();
  }
  return ERR["#N/A"];
}, { lazy: true });
def("SWITCH", (t, ctx) => {
  const v = scalar(t[0](), ctx);
  if (isErr(v)) return v;
  let i = 1;
  for (; i + 1 < t.length; i += 2) if (compareValues(scalar(t[i](), ctx), v) === 0) return t[i + 1]();
  return i < t.length ? t[i]() : ERR["#N/A"];
}, { lazy: true });
def("CHOOSE", (t, ctx) => {
  const i = Math.trunc(num(t[0](), ctx));
  if (i < 1 || i >= t.length) return ERR["#VALUE!"];
  return t[i]();
}, { lazy: true });
const logic = (a, ctx, fold, init) => {
  let acc = init;
  let seen = false;
  each(a, ctx, (v, inRange) => {
    if (inRange && typeof v !== "boolean" && typeof v !== "number") return;
    if (v == null) return;
    seen = true;
    acc = fold(acc, bool(v, ctx));
  }, { numbersOnly: false });
  if (!seen) throw ERR["#VALUE!"];
  return acc;
};
def("AND", (a, ctx) => logic(a, ctx, (x, y) => x && y, true));
def("OR", (a, ctx) => logic(a, ctx, (x, y) => x || y, false));
def("XOR", (a, ctx) => logic(a, ctx, (x, y) => x !== y, false));
def("NOT", (a, ctx) => !bool(a[0], ctx));
def("TRUE", () => true);
def("FALSE", () => false);

// ---- information
const info = (test) => (a, ctx) => test(scalar(a[0], ctx));
def("ISBLANK", info((v) => v == null), { allowErrors: true });
def("ISNUMBER", info((v) => typeof v === "number"), { allowErrors: true });
def("ISTEXT", info((v) => typeof v === "string"), { allowErrors: true });
def("ISNONTEXT", info((v) => typeof v !== "string"), { allowErrors: true });
def("ISLOGICAL", info((v) => typeof v === "boolean"), { allowErrors: true });
def("ISERROR", info((v) => isErr(v)), { allowErrors: true });
def("ISERR", info((v) => isErr(v) && v.code !== "#N/A"), { allowErrors: true });
def("ISNA", info((v) => isErr(v) && v.code === "#N/A"), { allowErrors: true });
def("ISEVEN", (a, ctx) => Math.trunc(num(a[0], ctx)) % 2 === 0);
def("ISODD", (a, ctx) => Math.abs(Math.trunc(num(a[0], ctx)) % 2) === 1);
def("NA", () => ERR["#N/A"]);
def("N", (a, ctx) => {
  const v = scalar(a[0], ctx);
  return typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : 0;
});

// ---- lookup and reference
def("VLOOKUP", (a, ctx) => lookupTable(a, ctx, true));
def("HLOOKUP", (a, ctx) => lookupTable(a, ctx, false));
function lookupTable(a, ctx, vertical) {
  const key = scalar(a[0], ctx);
  if (isErr(key)) throw key;
  const g = asRange(a[1]);
  const idx = Math.trunc(num(a[2], ctx));
  const approx = a[3] == null ? true : bool(a[3], ctx);
  const span = vertical ? g.c1 - g.c0 + 1 : g.r1 - g.r0 + 1;
  if (idx < 1) throw ERR["#VALUE!"];
  if (idx > span) throw ERR["#REF!"];
  const keys = vertical ? line({ ...g, c1: g.c0 }, ctx).list : line({ ...g, r1: g.r0 }, ctx).list;
  const i = lookupIndex(keys, key, approx ? 1 : 0);
  if (i < 0) throw ERR["#N/A"];
  return vertical ? ctx.get(g.sid, g.r0 + i, g.c0 + idx - 1) : ctx.get(g.sid, g.r0 + idx - 1, g.c0 + i);
}
def("MATCH", (a, ctx) => {
  const key = scalar(a[0], ctx);
  if (isErr(key)) throw key;
  const g = asRange(a[1]);
  if (g.r0 !== g.r1 && g.c0 !== g.c1) throw ERR["#N/A"];
  const mode = a[2] == null ? 1 : Math.sign(Math.trunc(num(a[2], ctx)));
  const i = lookupIndex(line(g, ctx).list, key, mode);
  if (i < 0) throw ERR["#N/A"];
  return i + 1;
});
def("XMATCH", (a, ctx) => {
  const key = scalar(a[0], ctx);
  if (isErr(key)) throw key;
  const g = asRange(a[1]);
  const mode = a[2] == null ? 0 : Math.trunc(num(a[2], ctx));
  const search = a[3] == null ? 1 : Math.trunc(num(a[3], ctx));
  const i = lookupIndex(line(g, ctx).list, key, mode === 2 ? 2 : mode, { wild: mode === 2, reverse: search < 0 });
  if (i < 0) throw ERR["#N/A"];
  return i + 1;
});
def("XLOOKUP", (a, ctx) => {
  const key = scalar(a[0], ctx);
  if (isErr(key)) throw key;
  const look = asRange(a[1]);
  const ret = asRange(a[2]);
  const mode = a[4] == null ? 0 : Math.trunc(num(a[4], ctx));
  const search = a[5] == null ? 1 : Math.trunc(num(a[5], ctx));
  const { list, vertical } = line(look, ctx);
  const i = lookupIndex(list, key, mode === 2 ? 2 : mode, { wild: mode === 2, reverse: search < 0 });
  if (i < 0) {
    if (a[3] != null && a[3] !== undefined && a.length > 3) return scalar(a[3], ctx);
    throw ERR["#N/A"];
  }
  return vertical ? { range: true, sid: ret.sid, r0: ret.r0 + i, r1: ret.r0 + i, c0: ret.c0, c1: ret.c1 } : { range: true, sid: ret.sid, r0: ret.r0, r1: ret.r1, c0: ret.c0 + i, c1: ret.c0 + i };
}, { allowErrors: true });
def("LOOKUP", (a, ctx) => {
  const key = scalar(a[0], ctx);
  const look = asRange(a[1]);
  const ret = a[2] ? asRange(a[2]) : look;
  const i = lookupIndex(line(look, ctx).list, key, 1);
  if (i < 0) throw ERR["#N/A"];
  return line(ret, ctx).list[i] ?? ERR["#N/A"];
});
def("INDEX", (a, ctx) => {
  const g = asRange(a[0]);
  const h = g.r1 - g.r0 + 1;
  const w = g.c1 - g.c0 + 1;
  let r = Math.trunc(num(opt(a, 1, 0), ctx));
  let c = Math.trunc(num(opt(a, 2, 0), ctx));
  if (h === 1 && a[2] == null) [r, c] = [1, r];
  if (r < 0 || c < 0 || r > h || c > w) throw ERR["#REF!"];
  return { range: true, sid: g.sid, r0: r ? g.r0 + r - 1 : g.r0, r1: r ? g.r0 + r - 1 : g.r1, c0: c ? g.c0 + c - 1 : g.c0, c1: c ? g.c0 + c - 1 : g.c1 };
});
def("ROW", (a, ctx) => (a[0] && a[0].range ? a[0].r0 + 1 : ctx.r != null ? ctx.r + 1 : ERR["#VALUE!"]));
def("COLUMN", (a, ctx) => (a[0] && a[0].range ? a[0].c0 + 1 : ctx.c != null ? ctx.c + 1 : ERR["#VALUE!"]));
def("ROWS", (a) => asRange(a[0]).r1 - a[0].r0 + 1);
def("COLUMNS", (a) => asRange(a[0]).c1 - a[0].c0 + 1);

// ---- text
def("LEN", (a, ctx) => str(a[0], ctx).length);
def("LEFT", (a, ctx) => str(a[0], ctx).slice(0, Math.max(0, Math.trunc(num(opt(a, 1, 1), ctx)))));
def("RIGHT", (a, ctx) => {
  const s = str(a[0], ctx);
  const n = Math.max(0, Math.trunc(num(opt(a, 1, 1), ctx)));
  return n ? s.slice(-n) : "";
});
def("MID", (a, ctx) => {
  const s = str(a[0], ctx);
  const st = Math.trunc(num(a[1], ctx));
  const n = Math.trunc(num(a[2], ctx));
  if (st < 1 || n < 0) throw ERR["#VALUE!"];
  return s.substr(st - 1, n);
});
def("UPPER", (a, ctx) => str(a[0], ctx).toUpperCase());
def("LOWER", (a, ctx) => str(a[0], ctx).toLowerCase());
def("PROPER", (a, ctx) => str(a[0], ctx).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, p, c) => p + c.toUpperCase()));
def("TRIM", (a, ctx) => str(a[0], ctx).trim().replace(/ {2,}/g, " "));
def("CLEAN", (a, ctx) => str(a[0], ctx).replace(/[\u0000-\u001f]/g, ""));
def("CONCAT CONCATENATE", (a, ctx) => {
  let s = "";
  each(a, ctx, (v) => (s += toText(v)), { numbersOnly: false });
  return s;
});
def("TEXTJOIN", (a, ctx) => {
  const sep = str(a[0], ctx);
  const skip = bool(a[1], ctx);
  const parts = [];
  each(a.slice(2), ctx, (v) => {
    const s = toText(v);
    if (!(skip && s === "")) parts.push(s);
  }, { numbersOnly: false });
  return parts.join(sep);
});
def("REPT", (a, ctx) => {
  const n = Math.trunc(num(a[1], ctx));
  if (n < 0 || n > 32767) throw ERR["#VALUE!"];
  return str(a[0], ctx).repeat(n);
});
def("SUBSTITUTE", (a, ctx) => {
  const s = str(a[0], ctx);
  const from = str(a[1], ctx);
  const to = str(a[2], ctx);
  if (!from) return s;
  if (a[3] == null) return s.split(from).join(to);
  const k = Math.trunc(num(a[3], ctx));
  let i = -1;
  for (let n = 0; n < k; n++) {
    i = s.indexOf(from, i + 1);
    if (i < 0) return s;
  }
  return s.slice(0, i) + to + s.slice(i + from.length);
});
def("REPLACE", (a, ctx) => {
  const s = str(a[0], ctx);
  const st = Math.trunc(num(a[1], ctx));
  const n = Math.trunc(num(a[2], ctx));
  if (st < 1 || n < 0) throw ERR["#VALUE!"];
  return s.slice(0, st - 1) + str(a[3], ctx) + s.slice(st - 1 + n);
});
const findFn = (ci) => (a, ctx) => {
  let needle = str(a[0], ctx);
  let hay = str(a[1], ctx);
  const st = Math.trunc(num(opt(a, 2, 1), ctx));
  if (st < 1 || st > hay.length + 1) throw ERR["#VALUE!"];
  if (ci) {
    const re = wildcard(needle);
    const src = re.source.slice(1, -1);
    const m = new RegExp(src, "i").exec(hay.slice(st - 1));
    if (!m) throw ERR["#VALUE!"];
    return st + m.index;
  }
  const i = hay.indexOf(needle, st - 1);
  if (i < 0) throw ERR["#VALUE!"];
  return i + 1;
};
def("FIND", findFn(false));
def("SEARCH", findFn(true));
def("EXACT", (a, ctx) => str(a[0], ctx) === str(a[1], ctx));
def("VALUE", (a, ctx) => {
  const v = scalar(a[0], ctx);
  if (typeof v === "number") return v;
  const n = toNum(str(v, ctx));
  if (isErr(n)) throw n;
  return n;
});
def("TEXT", (a, ctx) => {
  const v = scalar(a[0], ctx);
  const code = str(a[1], ctx);
  const n = typeof v === "string" && !isErr(toNum(v)) && v.trim() !== "" ? toNum(v) : v;
  return formatCode(n, code).text;
});
def("FIXED", (a, ctx) => formatCode(num(a[0], ctx), `${a[2] && bool(a[2], ctx) ? "0" : "#,##0"}${Math.trunc(num(opt(a, 1, 2), ctx)) > 0 ? `.${"0".repeat(Math.min(10, Math.trunc(num(opt(a, 1, 2), ctx))))}` : ""}`).text);
def("CHAR", (a, ctx) => String.fromCharCode(Math.trunc(num(a[0], ctx))));
def("CODE", (a, ctx) => {
  const s = str(a[0], ctx);
  if (!s) throw ERR["#VALUE!"];
  return s.charCodeAt(0);
});
def("T", (a, ctx) => {
  const v = scalar(a[0], ctx);
  return typeof v === "string" ? v : "";
});

// ---- date and time (serial days, 1900 system)
def("TODAY", () => today());
def("NOW", () => {
  const d = new Date();
  return today() + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
});
def("DATE", (a, ctx) => {
  let y = Math.trunc(num(a[0], ctx));
  if (y < 1900) y += 1900;
  const s = dateToSerial(y, Math.trunc(num(a[1], ctx)), Math.trunc(num(a[2], ctx)));
  if (s < 0) throw ERR["#NUM!"];
  return s;
});
def("TIME", (a, ctx) => {
  const s = (num(a[0], ctx) * 3600 + num(a[1], ctx) * 60 + num(a[2], ctx)) / 86400;
  return s - Math.floor(s);
});
const dpart = (fn) => (a, ctx) => {
  const v = num(a[0], ctx);
  if (v < 0) throw ERR["#NUM!"];
  return fn(serialToDate(v), v);
};
def("YEAR", dpart((d) => d.getUTCFullYear()));
def("MONTH", dpart((d) => d.getUTCMonth() + 1));
def("DAY", dpart((d) => d.getUTCDate()));
def("HOUR", dpart((d) => d.getUTCHours()));
def("MINUTE", dpart((d) => d.getUTCMinutes()));
def("SECOND", dpart((d) => d.getUTCSeconds()));
def("WEEKDAY", (a, ctx) => {
  const d = serialToDate(num(a[0], ctx)).getUTCDay();
  const type = Math.trunc(num(opt(a, 1, 1), ctx));
  return type === 2 ? ((d + 6) % 7) + 1 : type === 3 ? (d + 6) % 7 : d + 1;
});
def("EDATE", (a, ctx) => {
  const d = serialToDate(num(a[0], ctx));
  const m = Math.trunc(num(a[1], ctx));
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m + 1, 0)).getUTCDate();
  return dateToSerial(d.getUTCFullYear(), d.getUTCMonth() + 1 + m, Math.min(day, last));
});
def("EOMONTH", (a, ctx) => {
  const d = serialToDate(num(a[0], ctx));
  const m = Math.trunc(num(a[1], ctx));
  return dateToSerial(d.getUTCFullYear(), d.getUTCMonth() + 2 + m, 0);
});
def("DAYS", (a, ctx) => Math.trunc(num(a[0], ctx)) - Math.trunc(num(a[1], ctx)));
def("DATEDIF", (a, ctx) => {
  const s = num(a[0], ctx);
  const e = num(a[1], ctx);
  if (e < s) throw ERR["#NUM!"];
  const u = str(a[2], ctx).toUpperCase();
  const d0 = serialToDate(s);
  const d1 = serialToDate(e);
  const months = (d1.getUTCFullYear() - d0.getUTCFullYear()) * 12 + d1.getUTCMonth() - d0.getUTCMonth() - (d1.getUTCDate() < d0.getUTCDate() ? 1 : 0);
  if (u === "D") return Math.trunc(e) - Math.trunc(s);
  if (u === "M") return months;
  if (u === "Y") return Math.floor(months / 12);
  throw ERR["#NUM!"];
});
def("NETWORKDAYS", (a, ctx) => {
  let s = Math.trunc(num(a[0], ctx));
  let e = Math.trunc(num(a[1], ctx));
  const sign = e < s ? -1 : 1;
  if (sign < 0) [s, e] = [e, s];
  if (e - s > 100000) throw ERR["#NUM!"];
  let n = 0;
  for (let d = s; d <= e; d++) {
    const w = serialToDate(d).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n * sign;
});
def("DATEVALUE", (a, ctx) => {
  const s = str(a[0], ctx).trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) || null;
  if (m) return dateToSerial(+m[1], +m[2], +m[3]);
  const u = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (u) return dateToSerial(+u[3], +u[1], +u[2]);
  const g = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (g) return dateToSerial(+g[3], +g[2], +g[1]);
  throw ERR["#VALUE!"];
});

// ---- finance (the common three)
def("PMT", (a, ctx) => {
  const r = num(a[0], ctx);
  const n = num(a[1], ctx);
  const pv = num(a[2], ctx);
  const fv = num(opt(a, 3, 0), ctx);
  const type = num(opt(a, 4, 0), ctx) ? 1 : 0;
  if (n === 0) throw ERR["#NUM!"];
  if (r === 0) return -(pv + fv) / n;
  const f = Math.pow(1 + r, n);
  return -(r * (pv * f + fv)) / ((1 + r * type) * (f - 1));
});
def("FV", (a, ctx) => {
  const r = num(a[0], ctx);
  const n = num(a[1], ctx);
  const pmt = num(a[2], ctx);
  const pv = num(opt(a, 3, 0), ctx);
  const type = num(opt(a, 4, 0), ctx) ? 1 : 0;
  if (r === 0) return -(pv + pmt * n);
  const f = Math.pow(1 + r, n);
  return -(pv * f + (pmt * (1 + r * type) * (f - 1)) / r);
});
def("PV", (a, ctx) => {
  const r = num(a[0], ctx);
  const n = num(a[1], ctx);
  const pmt = num(a[2], ctx);
  const fv = num(opt(a, 3, 0), ctx);
  const type = num(opt(a, 4, 0), ctx) ? 1 : 0;
  if (r === 0) return -(fv + pmt * n);
  const f = Math.pow(1 + r, n);
  return -(fv + (pmt * (1 + r * type) * (f - 1)) / r) / f;
});

export const FUNCTIONS = F;
export const FUNCTION_NAMES = Object.keys(F).sort();
export { FErr };
