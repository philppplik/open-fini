// Office Toolkit: number formats shared by the number-format menu (toolkit/ui.js ▸ numberFormatMenu), spreadsheet
// cells and chart labels. A format is a small JSON object, never a code string, so files cannot smuggle code in.
// Pure (Intl only); tests in tests/office/toolkit.test.js.
//
// Public API
//   NUMBER_FORMATS: [{ id, label, fmt }]                       the menu presets
//   formatValue(value, fmt, locale = "en-US") → string          numbers, dates (serial days or ms) and text
//   normalizeFormat(fmt) → fmt                                   clamps and drops unknown fields
// fmt: { type: "general"|"number"|"percent"|"currency"|"scientific"|"date"|"time"|"datetime"|"text",
//        decimals?: 0..10, grouping?: boolean, currency?: "USD"|"EUR"|…, negativeParens?: boolean }
// Dates: spreadsheet serial days (1900 system, day 1 = 1900-01-01, with the Lotus leap-year bug) when < 1e6,
// otherwise epoch milliseconds. Invariant: never throws; unknown types fall back to "general".

const TYPES = ["general", "number", "percent", "currency", "scientific", "date", "time", "datetime", "text"];

export const NUMBER_FORMATS = [
  { id: "general", label: "General", fmt: { type: "general" } },
  { id: "number", label: "Number", fmt: { type: "number", decimals: 2, grouping: true } },
  { id: "integer", label: "Whole number", fmt: { type: "number", decimals: 0, grouping: true } },
  { id: "currency", label: "Currency", fmt: { type: "currency", decimals: 2, currency: "USD" } },
  { id: "euro", label: "Currency (EUR)", fmt: { type: "currency", decimals: 2, currency: "EUR" } },
  { id: "accounting", label: "Accounting", fmt: { type: "currency", decimals: 2, currency: "USD", negativeParens: true } },
  { id: "percent", label: "Percent", fmt: { type: "percent", decimals: 0 } },
  { id: "scientific", label: "Scientific", fmt: { type: "scientific", decimals: 2 } },
  { id: "date", label: "Date", fmt: { type: "date" } },
  { id: "time", label: "Time", fmt: { type: "time" } },
  { id: "datetime", label: "Date and time", fmt: { type: "datetime" } },
  { id: "text", label: "Text", fmt: { type: "text" } },
];

export function normalizeFormat(fmt) {
  const type = TYPES.includes(fmt?.type) ? fmt.type : "general";
  const out = { type };
  if (Number.isFinite(fmt?.decimals)) out.decimals = Math.max(0, Math.min(10, Math.round(fmt.decimals)));
  if (typeof fmt?.grouping === "boolean") out.grouping = fmt.grouping;
  if (typeof fmt?.currency === "string" && /^[A-Z]{3}$/.test(fmt.currency)) out.currency = fmt.currency;
  if (fmt?.negativeParens) out.negativeParens = true;
  return out;
}

const DAY = 86400000;
const EPOCH_1900 = Date.UTC(1899, 11, 30); // serial 0 incl. the 1900 leap-year bug offset (serial 60 = 1900-02-29)
const toDate = (v) => new Date(Math.abs(v) < 1e6 ? EPOCH_1900 + v * DAY : v);

export function formatValue(value, fmt = { type: "general" }, locale = "en-US") {
  const f = normalizeFormat(fmt);
  if (value == null || value === "") return "";
  if (f.type === "text" || typeof value !== "number" || !Number.isFinite(value)) return String(value);
  const d = f.decimals;
  try {
    switch (f.type) {
      case "number":
        return new Intl.NumberFormat(locale, { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2, useGrouping: f.grouping !== false }).format(value);
      case "percent":
        return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: d ?? 0, maximumFractionDigits: d ?? 0 }).format(value);
      case "currency": {
        const s = new Intl.NumberFormat(locale, { style: "currency", currency: f.currency || "USD", minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 }).format(f.negativeParens ? Math.abs(value) : value);
        return f.negativeParens && value < 0 ? `(${s})` : s;
      }
      case "scientific":
        return value.toExponential(d ?? 2).replace("e+", "E+").replace("e-", "E-");
      case "date":
        return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(toDate(value));
      case "time":
        return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(toDate(value));
      case "datetime":
        return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(toDate(value));
      default: {
        // general: up to 10 significant digits, no grouping, no trailing zeros
        const abs = Math.abs(value);
        if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) return value.toExponential(5).replace(/\.?0+e/, "e").replace("e+", "E+").replace("e-", "E-");
        return String(Number(value.toPrecision(10)));
      }
    }
  } catch {
    return String(value);
  }
}
