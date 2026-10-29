// Spreadsheet number format codes (the Excel / OpenDocument "#,##0.00" language) for cell display, TEXT() and the
// XLSX / ODS codecs. The toolkit presets (toolkit/numfmt.js ▸ NUMBER_FORMATS, small JSON objects) convert to codes
// with fmtToCode, so a sheet stores one thing: the code string. Pure; tests in tests/office/sheet-formula.test.js.
//
// Public API
//   formatCode(value, code) → { text, color? }    number, date/time (serial days, 1900 system), text and booleans
//   fmtToCode(fmt) → code                         toolkit preset → code
//   isDateCode(code) → boolean                    date/time codes (the value is a serial day number)
//   generalText(n) → string                       "General": up to 10 significant digits
//   serialToDate(serial) → Date (UTC) / dateToSerial(y, m, d) → serial
// Supported: sections (positive;negative;zero;text), 0 # ? placeholders, decimals, grouping, thousands scaling,
// %, E+ scientific, "literals", \x, _x (space), *x (ignored), [Color], [$€-407] currency, @, date/time tokens
// (yyyy yy mmmm mmm mm m dddd ddd dd d hh h mm ss AM/PM [h]). Invariant: never throws.

const DAY = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);
export const serialToDate = (v) => new Date(EPOCH + Math.round(v * DAY));
export const dateToSerial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COLORS = { black: "#000000", blue: "#0000ff", cyan: "#00ffff", green: "#008000", magenta: "#ff00ff", red: "#ff0000", white: "#ffffff", yellow: "#ffff00" };
const SYMBOLS = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CHF: "CHF ", CNY: "¥", INR: "₹" };

export function generalText(n) {
  if (!Number.isFinite(n)) return "#NUM!";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) return n.toExponential(5).replace(/\.?0+e/, "e").replace("e", "E");
  return String(Number(n.toPrecision(10)));
}

export function fmtToCode(fmt) {
  const d = Number.isFinite(fmt?.decimals) ? Math.max(0, Math.min(10, fmt.decimals)) : null;
  const dec = (n) => (n ? `.${"0".repeat(n)}` : "");
  switch (fmt?.type) {
    case "number":
      return `${fmt.grouping === false ? "0" : "#,##0"}${dec(d ?? 2)}`;
    case "percent":
      return `0${dec(d ?? 0)}%`;
    case "currency": {
      const sym = SYMBOLS[fmt.currency || "USD"] || `${fmt.currency} `;
      const body = `#,##0${dec(d ?? 2)}`;
      const pos = sym === "$" || sym === "£" || sym === "¥" ? `"${sym}"${body}` : sym === "€" ? `${body} "€"` : `"${sym}"${body}`;
      return fmt.negativeParens ? `${pos}_);(${pos})` : pos;
    }
    case "scientific":
      return `0${dec(d ?? 2)}E+00`;
    case "date":
      return "yyyy-mm-dd";
    case "time":
      return "hh:mm";
    case "datetime":
      return "yyyy-mm-dd hh:mm";
    case "text":
      return "@";
    default:
      return "General";
  }
}

/** Splits a code into sections at ";" outside quotes and brackets. */
function sections(code) {
  const out = [];
  let cur = "";
  let q = false;
  let br = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "\\" && !q) {
      cur += ch + (code[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') q = !q;
    else if (!q && ch === "[") br = true;
    else if (!q && ch === "]") br = false;
    if (ch === ";" && !q && !br) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Tokens: { lit } | { ph: "0"|"#"|"?" } | { dot } | { comma } | { pct } | { exp: "E+"|"E-" } | { date: tok } | { at } */
function lex(sec) {
  const toks = [];
  let color = null;
  let elapsed = false;
  for (let i = 0; i < sec.length; i++) {
    const ch = sec[i];
    const rest = sec.slice(i);
    if (ch === '"') {
      const j = sec.indexOf('"', i + 1);
      toks.push({ lit: sec.slice(i + 1, j < 0 ? sec.length : j) });
      i = j < 0 ? sec.length : j;
    } else if (ch === "\\") {
      toks.push({ lit: sec[i + 1] ?? "" });
      i++;
    } else if (ch === "_") {
      toks.push({ lit: " " });
      i++;
    } else if (ch === "*") i++;
    else if (ch === "[") {
      const j = sec.indexOf("]", i);
      const inner = sec.slice(i + 1, j < 0 ? sec.length : j);
      i = j < 0 ? sec.length : j;
      if (/^\$/.test(inner)) toks.push({ lit: inner.slice(1).split("-")[0] });
      else if (/^h+$|^m+$|^s+$/i.test(inner)) {
        elapsed = true;
        toks.push({ date: inner.toLowerCase(), elapsed: true });
      } else if (COLORS[inner.toLowerCase()]) color = COLORS[inner.toLowerCase()];
    } else if (/^(AM\/PM|A\/P)/i.test(rest)) {
      const m = /^(AM\/PM|A\/P)/i.exec(rest)[0];
      toks.push({ date: m.toUpperCase() });
      i += m.length - 1;
    } else if (/^general/i.test(rest)) {
      toks.push({ general: true });
      i += 6;
    } else if (/[yYdD]/.test(ch) || /[hHsS]/.test(ch) || /[mM]/.test(ch)) {
      let j = i;
      while (j < sec.length && sec[j].toLowerCase() === ch.toLowerCase()) j++;
      toks.push({ date: sec.slice(i, j).toLowerCase() });
      i = j - 1;
    } else if (ch === "0" || ch === "#" || ch === "?") toks.push({ ph: ch });
    else if (ch === ".") toks.push({ dot: true });
    else if (ch === ",") toks.push({ comma: true });
    else if (ch === "%") toks.push({ pct: true });
    else if ((ch === "E" || ch === "e") && (sec[i + 1] === "+" || sec[i + 1] === "-")) {
      toks.push({ exp: sec[i + 1] });
      i++;
    } else if (ch === "@") toks.push({ at: true });
    else toks.push({ lit: ch });
  }
  // m after h / before s means minutes
  const dates = toks.filter((t) => t.date);
  for (let k = 0; k < dates.length; k++) {
    const t = dates[k];
    if (t.date !== "m" && t.date !== "mm") continue;
    const prev = dates[k - 1]?.date || "";
    const next = dates[k + 1]?.date || "";
    if (prev.startsWith("h") || next.startsWith("s")) t.minute = true;
  }
  return { toks, color, elapsed };
}

const cache = new Map();
function compile(code) {
  let c = cache.get(code);
  if (!c) {
    c = sections(String(code || "General")).slice(0, 4).map(lex);
    if (cache.size > 2000) cache.clear();
    cache.set(code, c);
  }
  return c;
}

export function isDateCode(code) {
  if (!code) return false;
  const c = compile(code)[0];
  return c.toks.some((t) => t.date && t.date !== "AM/PM" && t.date !== "A/P") && !c.toks.some((t) => t.ph);
}

const pad = (n, w) => String(n).padStart(w, "0");

function formatDate(v, toks) {
  const d = serialToDate(v);
  const hasAmPm = toks.some((t) => t.date === "AM/PM" || t.date === "A/P");
  const H = d.getUTCHours();
  let out = "";
  for (const t of toks) {
    if (t.lit != null) {
      out += t.lit;
      continue;
    }
    if (t.ph || t.dot || t.comma) {
      out += t.ph ? "" : t.dot ? "." : ",";
      continue;
    }
    if (!t.date) continue;
    const k = t.date;
    if (t.elapsed) {
      const total = v * 24;
      out += k[0] === "h" ? pad(Math.floor(total), k.length) : k[0] === "m" ? pad(Math.floor(total * 60), k.length) : pad(Math.floor(total * 3600), k.length);
    } else if (k === "AM/PM") out += H < 12 ? "AM" : "PM";
    else if (k === "A/P") out += H < 12 ? "A" : "P";
    else if (k[0] === "y") out += k.length <= 2 ? pad(d.getUTCFullYear() % 100, 2) : String(d.getUTCFullYear());
    else if (k[0] === "d") out += k.length === 1 ? d.getUTCDate() : k.length === 2 ? pad(d.getUTCDate(), 2) : k.length === 3 ? DAYS[d.getUTCDay()].slice(0, 3) : DAYS[d.getUTCDay()];
    else if (k[0] === "h") {
      const h12 = hasAmPm ? H % 12 || 12 : H;
      out += k.length === 1 ? h12 : pad(h12, 2);
    } else if (k[0] === "s") out += pad(d.getUTCSeconds(), k.length === 1 ? 1 : 2);
    else if (k[0] === "m") {
      if (t.minute) out += k.length === 1 ? d.getUTCMinutes() : pad(d.getUTCMinutes(), 2);
      else {
        const M = d.getUTCMonth();
        out += k.length === 1 ? M + 1 : k.length === 2 ? pad(M + 1, 2) : k.length === 3 ? MONTHS[M].slice(0, 3) : k.length === 4 ? MONTHS[M] : MONTHS[M][0];
      }
    }
  }
  return out;
}

function group(s) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatNumber(v, toks, signed) {
  const first = toks.findIndex((t) => t.ph);
  if (first < 0) {
    // no digits: literals only (a "zero" section like "-") or General
    if (toks.some((t) => t.general)) return toks.map((t) => (t.general ? generalText(signed ? v : Math.abs(v)) : t.lit ?? (t.pct ? "%" : ""))).join("");
    return toks.map((t) => t.lit ?? (t.pct ? "%" : t.at ? "" : "")).join("");
  }
  let last = toks.length - 1;
  while (last > first && !(toks[last].ph || toks[last].dot || toks[last].comma || toks[last].exp)) last--;
  // exponent digits belong to the number part
  const expAt = toks.findIndex((t) => t.exp);
  if (expAt > 0) {
    last = expAt;
    while (last + 1 < toks.length && toks[last + 1].ph) last++;
  }
  const num = toks.slice(first, last + 1);
  const pct = toks.filter((t) => t.pct).length;
  let x = Math.abs(v) * Math.pow(100, pct);
  const dotAt = num.findIndex((t) => t.dot);
  const intToks = (dotAt < 0 ? num : num.slice(0, dotAt)).filter((t) => !t.exp);
  const fracToks = dotAt < 0 ? [] : num.slice(dotAt + 1).filter((t) => t.ph && (expAt < 0 || true));
  // trailing commas scale by 1000
  let scale = 0;
  for (let k = intToks.length - 1; k >= 0 && intToks[k].comma; k--) scale++;
  x /= Math.pow(1000, scale);
  const grouping = intToks.some((t, k) => t.comma && k < intToks.length - scale);
  const minInt = intToks.filter((t) => t.ph === "0").length;
  let body;
  if (expAt > 0) {
    const fracCount = dotAt < 0 ? 0 : num.slice(dotAt + 1, num.findIndex((t) => t.exp)).filter((t) => t.ph).length;
    const expDigits = num.slice(num.findIndex((t) => t.exp) + 1).filter((t) => t.ph).length || 1;
    const sign = num.find((t) => t.exp).exp;
    const s = x.toExponential(fracCount);
    const [m, e] = s.split("e");
    const en = Number(e);
    body = `${m}E${en < 0 ? "-" : sign === "+" ? "+" : ""}${pad(Math.abs(en), expDigits)}`;
  } else {
    const fracReq = fracToks.filter((t) => t.ph === "0").length;
    const fracMax = fracToks.length;
    let s = x.toFixed(Math.min(20, fracMax));
    let [ip, fp = ""] = s.split(".");
    while (fp.length > fracReq && fp.endsWith("0")) fp = fp.slice(0, -1);
    if (ip === "0" && minInt === 0) ip = "";
    ip = ip.padStart(minInt, "0");
    if (grouping) ip = group(ip);
    body = ip + (fp.length ? `.${fp}` : "");
    if (!body) body = "0";
  }
  const before = toks.slice(0, first).map((t) => t.lit ?? (t.pct ? "%" : "")).join("");
  const after = toks.slice(last + 1).map((t) => t.lit ?? (t.pct ? "%" : "")).join("");
  return `${signed && v < 0 ? "-" : ""}${before}${body}${after}`;
}

/** Formats a value with a number format code. */
export function formatCode(value, code) {
  try {
    if (value == null || value === "") return { text: "" };
    const secs = compile(code || "General");
    if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE" };
    if (typeof value !== "number") {
      const s = String(value);
      const textSec = secs[3] || (secs.length === 1 && secs[0].toks.some((t) => t.at) ? secs[0] : null);
      if (!textSec) return { text: s };
      return { text: textSec.toks.map((t) => (t.at ? s : t.lit ?? "")).join(""), color: textSec.color || undefined };
    }
    if (!Number.isFinite(value)) return { text: "#NUM!" };
    let sec = secs[0];
    let signed = true;
    if (value < 0 && secs.length > 1) {
      sec = secs[1];
      signed = false;
    } else if (value === 0 && secs.length > 2) sec = secs[2];
    const isDate = sec.toks.some((t) => t.date) && !sec.toks.some((t) => t.ph);
    if (isDate) {
      if (value < 0 || value > 2958466) return { text: "#".repeat(8) };
      return { text: formatDate(value, sec.toks), color: sec.color || undefined };
    }
    if (sec.toks.length === 0) return { text: "" };
    if (sec.toks.every((t) => t.general || t.lit != null) && sec.toks.some((t) => t.general)) return { text: sec.toks.map((t) => (t.general ? generalText(signed ? value : Math.abs(value)) : t.lit)).join(""), color: sec.color || undefined };
    return { text: formatNumber(value, sec.toks, signed), color: sec.color || undefined };
  } catch {
    return { text: String(value) };
  }
}
