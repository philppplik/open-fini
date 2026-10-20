import { test } from "node:test";
import assert from "node:assert/strict";
import { t, N_, initI18n, setLocale, locale, onLocaleChange, addCatalog, formatNumber, formatDate, detected } from "../../app/src/i18n/index.js";

addCatalog("de", { "Save As…": "Speichern unter…", "menu.file": "Datei", "{n, plural, one {# file} other {# files}}": "{n, plural, one {# Datei} other {# Dateien}}" });

test("English is the default and the key is the text", async () => {
  await initI18n({ search: "", languages: ["en-US"], pref: "auto" });
  assert.equal(locale(), "en");
  assert.equal(t("Save As…"), "Save As…");
  assert.equal(t("menu.file", "File"), "File");
  assert.equal(t("Hi {name}", { name: "Ada" }), "Hi Ada");
  assert.equal(N_("Static"), "Static");
});

test("German via navigator.languages, with fallback to English for missing keys", async () => {
  await initI18n({ search: "", languages: ["de-AT"], pref: "auto" });
  assert.equal(locale(), "de");
  assert.deepEqual(detected(), { locale: "de", source: "browser" });
  assert.equal(t("Save As…"), "Speichern unter…");
  assert.equal(t("menu.file", "File"), "Datei");
  assert.equal(t("{n, plural, one {# file} other {# files}}", { n: 2 }), "2 Dateien");
  assert.equal(t("Not translated yet"), "Not translated yet");
});

test("live switch notifies listeners; explicit choice beats ?lang=", async () => {
  await initI18n({ search: "?lang=de", languages: ["en"], pref: "auto" });
  assert.equal(locale(), "de");
  const seen = [];
  const off = onLocaleChange((c) => seen.push(c));
  await setLocale("en");
  assert.equal(locale(), "en");
  assert.equal(t("Save As…"), "Save As…");
  await setLocale("de");
  off();
  assert.deepEqual(seen, ["en", "de"]);
});

test("?i18n=keys shows keys; non-string input is safe", async () => {
  await initI18n({ search: "?i18n=keys", languages: ["en"] });
  assert.equal(t("menu.file", "File"), "menu.file");
  await initI18n({ search: "", languages: ["en"] });
  assert.equal(t(undefined), "");
  assert.equal(t(5), "5");
});

test("Intl helpers follow the locale", async () => {
  await initI18n({ search: "", languages: ["de"], pref: "auto" });
  assert.equal(formatNumber(1234.5), "1.234,5");
  assert.match(formatDate(new Date(Date.UTC(2026, 0, 5, 12)), { dateStyle: "medium", timeZone: "UTC" }), /2026/);
  await setLocale("en");
  assert.equal(formatNumber(1234.5), "1,234.5");
});
