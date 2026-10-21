import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLocale, matchSupported, textDirection } from "../../app/src/i18n/detect.js";

const supported = ["en", "de"];

test("regional tags match the base language", () => {
  assert.equal(matchSupported("de-AT", supported), "de");
  assert.equal(matchSupported("de_CH", supported), "de");
  assert.equal(matchSupported("EN-gb", supported), "en");
  assert.equal(matchSupported("fr-FR", supported), null);
  assert.equal(matchSupported("", supported), null);
});

test("detection order: override, preference, browser, OS, default", () => {
  assert.deepEqual(detectLocale({ supported, override: "de", pref: "en", languages: ["en-US"] }), { locale: "de", source: "override" });
  assert.deepEqual(detectLocale({ supported, pref: "en", languages: ["de-DE"] }), { locale: "en", source: "pref" });
  assert.deepEqual(detectLocale({ supported, pref: "auto", languages: ["fr-FR", "de-AT", "en"] }), { locale: "de", source: "browser" });
  assert.deepEqual(detectLocale({ supported, pref: "auto", languages: ["fr-FR"], os: "de_DE" }), { locale: "de", source: "os" });
  assert.deepEqual(detectLocale({ supported, pref: "auto", languages: ["fr-FR"] }), { locale: "en", source: "default" });
  assert.deepEqual(detectLocale({ supported, pref: "xx", languages: ["de"] }), { locale: "de", source: "browser" });
});

test("text direction", () => {
  assert.equal(textDirection("de"), "ltr");
  assert.equal(textDirection("ar"), "rtl");
  assert.equal(textDirection("he-IL"), "rtl");
});
