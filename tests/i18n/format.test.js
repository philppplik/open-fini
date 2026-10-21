import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMessage, parseMessage, placeholders, validateMessage } from "../../app/src/i18n/format.js";

test("plain text and named placeholders", () => {
  assert.equal(formatMessage("Save", {}), "Save");
  assert.equal(formatMessage("Hello {name}!", { name: "Ada" }), "Hello Ada!");
  assert.equal(formatMessage("Missing {x}", {}), "Missing {x}");
  assert.equal(formatMessage("It's {n} o'clock", { n: 5 }), "It's 5 o'clock"); // apostrophes are literal
});

test("escaping braces and backslashes", () => {
  assert.equal(formatMessage("Use \\{braces\\}", {}), "Use {braces}");
  assert.equal(formatMessage("a \\\\ b", {}), "a \\ b");
});

test("plural uses CLDR categories of the locale", () => {
  const m = "{n, plural, =0 {No files} one {# file} other {# files}}";
  assert.equal(formatMessage(m, { n: 0 }, "en"), "No files");
  assert.equal(formatMessage(m, { n: 1 }, "en"), "1 file");
  assert.equal(formatMessage(m, { n: 1234 }, "en"), "1,234 files");
  assert.equal(formatMessage("{n, plural, one {# Seite} other {# Seiten}}", { n: 1234 }, "de"), "1.234 Seiten");
  // Russian has few/many
  assert.equal(formatMessage("{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}", { n: 3 }, "ru"), "3 файла");
});

test("nested placeholders inside plural branches and select", () => {
  assert.equal(formatMessage("{n, plural, one {{who} has # item} other {{who} has # items}}", { n: 2, who: "Ada" }), "Ada has 2 items");
  assert.equal(formatMessage("{k, select, a {Alpha} b {Beta} other {Other}}", { k: "b" }), "Beta");
  assert.equal(formatMessage("{k, select, a {Alpha} other {Other}}", { k: "zzz" }), "Other");
});

test("validation and placeholder extraction", () => {
  assert.equal(validateMessage("Hello {name}"), null);
  assert.match(validateMessage("{n, plural, one {# x}}"), /other/);
  assert.match(validateMessage("Unclosed {name"), /./);
  assert.match(validateMessage("Stray }"), /Unmatched/);
  assert.match(validateMessage("{n, bogus, other {x}}"), /Unknown/);
  assert.deepEqual(placeholders("{b} and {a} and {n, plural, one {{c} #} other {#}}"), ["a", "b", "c", "n"]);
});

test("formatMessage never throws on broken input", () => {
  assert.equal(formatMessage("Broken {", {}), "Broken {");
  assert.equal(typeof formatMessage(undefined), "string");
  assert.ok(parseMessage("x"));
});
