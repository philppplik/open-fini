// Tiny HTML templating: a tagged template that escapes every interpolated value unless it is wrapped in raw().
// Arrays are joined, null/undefined/false render nothing. Pure, no dependencies.

const RAW = Symbol("raw");

/** Marks a string as trusted HTML. */
export const raw = (s) => ({ [RAW]: true, value: String(s ?? "") });

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function part(v) {
  if (v === null || v === undefined || v === false) return "";
  if (Array.isArray(v)) return v.map(part).join("");
  if (typeof v === "object" && v[RAW]) return v.value;
  return esc(v);
}

/**
 * @param {TemplateStringsArray} strings
 * @param {...any} values
 * @returns {{ value: string }} trusted HTML (can be nested in other html`` calls)
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return raw(out);
}

/** The string of a trusted HTML value. */
export const str = (h) => (h && h[RAW] ? h.value : esc(h));
