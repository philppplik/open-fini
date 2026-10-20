// CI guard for the translation catalogs (same checks as `npm run i18n:check`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extract, localeCodes, readLocale, checkLocale, checkEnglishMessages, LOCALE_DIR, IMPLICIT } from "../../scripts/i18n-extract.mjs";
import { LOCALES } from "../../app/src/i18n/locales.js";

const { catalog } = extract();

test("extractor finds t(), N_() and explicit ids in source text", () => {
  const text = 'const a = t("Hello {n}", { n }); const b = t("menu.file", "File"); const c = N_("Static"); t(`dyn ${x}`);\nconst d = t("It\\u2019s");';
  const r = extract([{ path: "/x/app/src/a.js", text }], "/x/app/src");
  assert.deepEqual(r.catalog, { "Hello {n}": "Hello {n}", "It’s": "It’s", "menu.file": "File", Static: "Static" });
  assert.equal(r.warnings.length, 1);
});

test("implicit patterns cover command and menu tables", () => {
  assert.ok(IMPLICIT.length >= 3);
  assert.ok("Save As…" in catalog && "File" in catalog && "Undo" in catalog);
});

test("en.json is up to date (run `npm run i18n:extract`)", () => {
  const onDisk = readFileSync(join(LOCALE_DIR, "en.json"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(onDisk, JSON.stringify(catalog, null, 2) + "\n");
});

test("English messages have valid syntax", () => {
  assert.deepEqual(checkEnglishMessages(catalog), []);
});

test("every locale in LOCALES has a file and a clean catalog", () => {
  const codes = localeCodes();
  for (const l of LOCALES) if (l.code !== "en") assert.ok(codes.includes(l.code), `locales/${l.code}.json missing`);
  for (const code of codes) {
    assert.ok(LOCALES.some((l) => l.code === code), `${code}.json is not registered in locales.js`);
    const r = checkLocale(code, readLocale(code), catalog);
    assert.deepEqual(r.errors, [], r.errors.join("\n"));
  }
});

test("German is complete for every extracted key", () => {
  const r = checkLocale("de", readLocale("de"), catalog);
  assert.deepEqual(r.missing, []);
});

test("checkLocale flags placeholder mismatches, bad plurals and unknown keys", () => {
  const cat = { "Hi {name}": "Hi {name}", "{n, plural, one {# a} other {# b}}": "{n, plural, one {# a} other {# b}}" };
  const r = checkLocale("xx", { "Hi {name}": "Hallo {nom}", "{n, plural, one {# a} other {# b}}": "{n, plural, one {# a}}", Gone: "x" }, cat);
  assert.equal(r.errors.length, 3);
});
