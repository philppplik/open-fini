// Shoelace <sl-option> values must not contain spaces ("Option values cannot include a space" console error).
// Lint: no literal sl-option value with a space, and every dynamic value built from user/extension data goes through optVal().
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { optVal, optDecode } from "../../app/src/core/util.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "src");
const files = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : n.endsWith(".js") ? [join(d, n)] : []));
const lines = (f) => readFileSync(f, "utf8").split("\n");

test("no sl-option literal value contains a space", () => {
  const bad = [];
  for (const f of files(SRC)) {
    for (const line of lines(f)) {
      if (!line.includes("sl-option")) continue;
      for (const m of line.matchAll(/value(?::\s*|=)(["'`])([^"'`$]*?)\1/g)) if (/\s/.test(m[2])) bad.push(`${f}: ${m[2]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("sl-option values built from data use optVal()", () => {
  const risky = [];
  for (const f of files(SRC)) {
    for (const [i, line] of lines(f).entries()) {
      const m = line.match(/h\("sl-option",\s*\{\s*value:\s*([^,}]+)/);
      if (!m) continue;
      const v = m[1].trim();
      // static literals, optVal()/enc() and values from fixed internal tables (ids, units, zoom factors, locale codes)
      if (/^["'`]/.test(v) || /^(optVal|enc)\(/.test(v) || /^(z\.v|u|p\.id|l\.code)$/.test(v) || (v === "o.value" && f.endsWith("appearance.js"))) continue; // appearance.js: fixed effect ids
      risky.push(`${f}:${i + 1}: ${v}`);
    }
  }
  assert.deepEqual(risky, []);
});

test("optVal removes spaces reversibly", () => {
  for (const s of ["Programming Languages", "a b  c", "100% sure", "%20 literal", "x"]) {
    assert.ok(!/\s/.test(optVal(s)));
    assert.equal(optDecode(optVal(s)), s);
  }
});
