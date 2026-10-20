// The single list of interface languages. Adding a language = copy locales/en.json to locales/<code>.json,
// translate it and add ONE entry below (see docs/i18n.md). English is the source text: it needs no file at runtime.
//
// Each entry: code (BCP 47), name (in its own language), englishName, tag (full tag for <html lang> / Intl),
// url (the JSON catalog; a literal `new URL(..., import.meta.url)` so the build rewrites it), or null for the source language.

export const LOCALES = [
  { code: "en", tag: "en-US", name: "English (United States)", englishName: "English (United States)", url: null },
  { code: "de", tag: "de-DE", name: "Deutsch", englishName: "German", url: new URL("./locales/de.json", import.meta.url) },
];

export const SOURCE_LOCALE = "en";
export const supportedCodes = () => LOCALES.map((l) => l.code);
export const localeInfo = (code) => LOCALES.find((l) => l.code === code) || LOCALES[0];
