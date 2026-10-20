// Locale detection (pure, unit-tested in tests/i18n/detect.test.js).
//
// Order: ?lang= override -> user preference (anything but "auto") -> navigator.languages -> OS locale (platform layer)
// -> "en". A tag such as "de-AT" or "de_CH" matches the supported base language "de".
// Public API: matchSupported(tag, codes), detectLocale({...}) -> { locale, source }, textDirection(code).

/** Returns the supported code that best matches a BCP 47 tag ("de-AT" -> "de"), or null. */
export function matchSupported(tag, codes) {
  if (typeof tag !== "string" || !tag) return null;
  const norm = tag.replace(/_/g, "-").toLowerCase();
  const exact = codes.find((c) => c.toLowerCase() === norm);
  if (exact) return exact;
  const base = norm.split("-")[0];
  return codes.find((c) => c.toLowerCase() === base) || codes.find((c) => c.toLowerCase().split("-")[0] === base) || null;
}

/**
 * @param {object} o
 * @param {string[]} o.supported   locale codes, first one is the source language
 * @param {string} [o.override]    ?lang= value
 * @param {string} [o.pref]        the `language` preference ("auto" or a code)
 * @param {string[]} [o.languages] navigator.languages
 * @param {string} [o.os]          locale reported by the OS through the platform layer
 * @returns {{locale: string, source: "override"|"pref"|"browser"|"os"|"default"}}
 */
export function detectLocale({ supported, override, pref, languages = [], os } = {}) {
  const fallback = supported[0] || "en";
  const o = matchSupported(override, supported);
  if (o) return { locale: o, source: "override" };
  if (pref && pref !== "auto") {
    const p = matchSupported(pref, supported);
    if (p) return { locale: p, source: "pref" };
  }
  for (const tag of languages) {
    const m = matchSupported(tag, supported);
    if (m) return { locale: m, source: "browser" };
  }
  const m = matchSupported(os, supported);
  if (m) return { locale: m, source: "os" };
  return { locale: fallback, source: "default" };
}

const RTL = new Set(["ar", "he", "fa", "ur", "ps", "sd", "yi", "dv"]);
/** "rtl" or "ltr" for a language code. */
export const textDirection = (code) => (RTL.has(String(code).toLowerCase().split("-")[0]) ? "rtl" : "ltr");
