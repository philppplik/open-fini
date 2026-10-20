// Internationalization runtime. See docs/i18n.md and docs/adr/0007-i18n-english-as-key.md.
//
// The English text is the key: t("Save As…") returns "Speichern unter…" in German and falls back to the English text when
// no translation exists. Ambiguous strings get an explicit id: t("menu.file", "File") (the id is the catalog key).
//
// Public API
//   t(text, params?) / t(id, defaultText, params?)   translate + format (ICU-lite, see format.js)
//   N_(text)                                          marks a string for extraction without translating it now
//                                                     (use for static data; call t(value) at render time)
//   initI18n({ pref, osLocale, search, languages })   detect + load the active locale (call once at boot; returns detection info)
//   ready                                              promise resolved when the first locale finished loading
//   locale() / localeTag() / detected()               active code ("de"), full tag ("de-DE"), { locale, source }
//   setLocale(codeOrAuto)                              switch live; fires onLocaleChange listeners
//   onLocaleChange(fn) -> unsubscribe
//   translateDom(root)                                 applies data-i18n, data-i18n-title/-aria-label/-placeholder
//   formatNumber / formatDate / formatRelative / formatList   Intl helpers bound to the active locale
//   loadCatalog(code) / addCatalog(code, obj)          lower level, used by tests and extensions
// Invariants: t() never throws and never returns undefined; only the active locale's JSON is fetched; ?i18n=keys shows keys.

import { formatMessage } from "./format.js";
import { detectLocale, textDirection } from "./detect.js";
import { LOCALES, SOURCE_LOCALE, supportedCodes, localeInfo } from "./locales.js";

let active = SOURCE_LOCALE;
let catalog = Object.create(null);
let info = { locale: SOURCE_LOCALE, source: "default" };
let showKeys = false;
const listeners = new Set();
const loaded = new Map(); // code -> catalog object
let settle;
/** Resolves once the first locale is loaded (immediately usable: before it resolves t() returns English). */
export const ready = new Promise((r) => (settle = r));
let lastOpts = {};

export const N_ = (text) => text;

/** @param {string} a text or id  @param {string|object} [b] default text (when a is an id) or params  @param {object} [c] params */
export function t(a, b, c) {
  if (typeof a !== "string") return a == null ? "" : String(a);
  let key = a;
  let def = a;
  let params = b;
  if (typeof b === "string") {
    def = b;
    params = c;
  }
  if (showKeys) return String(key);
  let msg = def;
  if (active !== SOURCE_LOCALE) {
    const hit = catalog[key];
    if (typeof hit === "string" && hit) msg = hit;
  }
  return formatMessage(msg, params, active);
}

export const locale = () => active;
export const localeTag = () => localeInfo(active).tag;
export const detected = () => ({ ...info });
export const isKeyMode = () => showKeys;

/** Fetches (once) the JSON catalog of `code`; resolves {} for the source language or on failure. */
export async function loadCatalog(code) {
  if (loaded.has(code)) return loaded.get(code);
  const entry = LOCALES.find((l) => l.code === code);
  let data = {};
  if (entry?.url) {
    try {
      const res = await fetch(entry.url);
      if (res.ok) data = await res.json();
    } catch {
      /* offline or blocked: English text is used */
    }
  }
  loaded.set(code, data);
  return data;
}

/** Registers a catalog object directly (tests, extensions). */
export function addCatalog(code, obj) {
  loaded.set(code, { ...(loaded.get(code) || {}), ...obj });
}

function applyDocument(code) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.lang = localeInfo(code).tag;
  root.dir = textDirection(code);
}

function readSearch(search) {
  try {
    return new URLSearchParams(search ?? globalThis.location?.search ?? "");
  } catch {
    return new URLSearchParams("");
  }
}

/** Detects and activates the locale. Safe to call again (e.g. tests). */
export async function initI18n(opts = {}) {
  lastOpts = { ...lastOpts, ...opts };
  const q = readSearch(lastOpts.search);
  showKeys = q.get("i18n") === "keys";
  let osLocale = lastOpts.osLocale;
  if (typeof osLocale === "function") {
    try {
      osLocale = await osLocale();
    } catch {
      osLocale = undefined;
    }
  }
  // test hook (no Tauri needed): ?navlang=de-DE,en pretends navigator.languages has these values
  const fake = q.get("navlang");
  const languages = lastOpts.languages || (fake ? fake.split(",") : globalThis.navigator?.languages?.length ? [...globalThis.navigator.languages] : [globalThis.navigator?.language].filter(Boolean));
  lastOpts.languages = languages;
  info = detectLocale({ supported: supportedCodes(), override: q.get("lang"), pref: lastOpts.pref, languages, os: osLocale });
  await activate(info.locale);
  settle();
  return detected();
}

async function activate(code) {
  catalog = await loadCatalog(code);
  const changed = active !== code;
  active = code;
  applyDocument(code);
  if (changed) for (const fn of [...listeners]) fn(code);
}

/** Switches the language. "auto" re-runs detection. Returns the detection info. */
export async function setLocale(codeOrAuto) {
  lastOpts.pref = codeOrAuto;
  const q = readSearch(lastOpts.search);
  const languages = lastOpts.languages || (globalThis.navigator?.languages ? [...globalThis.navigator.languages] : []);
  let os = lastOpts.osLocale;
  if (typeof os === "function") os = await Promise.resolve(os()).catch(() => undefined);
  // an explicit choice in the UI beats the ?lang= test override
  info = detectLocale({ supported: supportedCodes(), override: codeOrAuto === "auto" ? q.get("lang") : undefined, pref: codeOrAuto, languages, os });
  await activate(info.locale);
  return detected();
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const ATTRS = [
  ["data-i18n-title", "title"],
  ["data-i18n-aria-label", "aria-label"],
  ["data-i18n-tip", "data-tip"],
  ["data-i18n-placeholder", "placeholder"],
];

/** Translates `root` and its descendants: data-i18n (text), data-i18n-title / -aria-label / -placeholder (attributes).
 *  The attribute value is the English text (or id); the English source is remembered so a switch back works. */
export function translateDom(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll("[data-i18n]")) {
    let key = el.getAttribute("data-i18n");
    if (!key) el.setAttribute("data-i18n", (key = el.textContent.trim())); // remember the English source
    el.textContent = t(key);
  }
  for (const [data, attr] of ATTRS) {
    for (const el of root.querySelectorAll(`[${data}]`)) el.setAttribute(attr, t(el.getAttribute(data)));
  }
}

// ---- formatting helpers (Intl with the active locale; never throw)
export function formatNumber(n, options) {
  try {
    return new Intl.NumberFormat(localeTag(), options).format(n);
  } catch {
    return String(n);
  }
}
export function formatDate(d, options = { dateStyle: "medium" }) {
  try {
    return new Intl.DateTimeFormat(localeTag(), options).format(d instanceof Date ? d : new Date(d));
  } catch {
    return String(d);
  }
}
export function formatRelative(value, unit) {
  try {
    return new Intl.RelativeTimeFormat(localeTag(), { numeric: "auto" }).format(value, unit);
  } catch {
    return `${value} ${unit}`;
  }
}
export function formatList(items, type = "conjunction") {
  try {
    return new Intl.ListFormat(localeTag(), { style: "long", type }).format(items);
  } catch {
    return items.join(", ");
  }
}

export { LOCALES, SOURCE_LOCALE };
