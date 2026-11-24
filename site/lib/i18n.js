// Languages, template strings and URLs. English lives at the site root, German under /de/ (docs/concepts/website.md).
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const LANGS = ["en", "de"];
export const DEFAULT_LANG = "en";
export const LOCALES = { en: "en-US", de: "de-DE" };

/** @param {string} dir site/i18n */
export function loadStrings(dir) {
  return Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(join(dir, `${l}.json`), "utf8"))]));
}

/**
 * Keys that the English strings have and another language lacks (or the other way round).
 * @param {Record<string, Record<string, string>>} strings
 * @returns {{ lang: string, missing: string[], extra: string[] }[]}
 */
export function missingKeys(strings) {
  const base = Object.keys(strings[DEFAULT_LANG]);
  return LANGS.filter((l) => l !== DEFAULT_LANG).map((lang) => {
    const keys = Object.keys(strings[lang]);
    return { lang, missing: base.filter((k) => !keys.includes(k)), extra: keys.filter((k) => !base.includes(k)) };
  });
}

/**
 * A translator for one language: t("key", { v: "1.2" }) fills {v}; missing keys fall back to English.
 * @param {Record<string, Record<string, string>>} strings
 * @param {string} lang
 */
export function translator(strings, lang) {
  return (key, vars = {}) => {
    const s = strings[lang]?.[key] ?? strings[DEFAULT_LANG][key];
    if (s === undefined) throw new Error(`site: unknown string key "${key}"`);
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  };
}

/**
 * URL helpers bound to a base path ("/" locally, "/open-fini/" on GitHub Pages).
 * Page paths are written without a leading slash and with a trailing one ("studios/vector/"); "" is the home page.
 * @param {string} base
 * @param {string} origin e.g. https://philppplik.github.io
 */
export function urls(base, origin) {
  const b = base.endsWith("/") ? base : `${base}/`;
  const page = (lang, path = "") => `${b}${lang === DEFAULT_LANG ? "" : `${lang}/`}${path}`;
  return {
    base: b,
    origin,
    page,
    asset: (path) => `${b}assets/${path}`,
    absolute: (lang, path = "") => `${origin}${page(lang, path)}`,
  };
}
