// The Code studio UI uses the web engine through its index module. This test fails when a UI file refers to an
// engine export that does not exist (a renamed or removed function would otherwise only show up in the browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const uiDirs = [join(root, "app", "src", "ui", "code"), join(root, "app", "src", "commands"), join(root, "app", "src", "core")];
const engineIndex = "../../app/src/engine/web/index.js";

function sourceFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(dir, f));
}

test("every engine export used by the Code studio UI exists", async () => {
  const engine = await import(engineIndex);
  const missing = [];
  for (const dir of uiDirs) {
    for (const file of sourceFiles(dir)) {
      const src = readFileSync(file, "utf8");
      // import * as E from ".../engine/web/index.js"  → E.name
      const ns = /import\s+\*\s+as\s+(\w+)\s+from\s+["'][^"']*engine\/web\/index\.js["']/.exec(src);
      if (ns) {
        for (const m of src.matchAll(new RegExp(`\\b${ns[1]}\\.([A-Za-z_$][\\w$]*)`, "g"))) {
          if (!(m[1] in engine)) missing.push(`${file.replace(root, "")}: ${ns[1]}.${m[1]}`);
        }
      }
      // import { a, b as c } from ".../engine/web/index.js"
      for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*engine\/web\/index\.js["']/g)) {
        for (const part of m[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/)[0];
          if (name && !(name in engine)) missing.push(`${file.replace(root, "")}: { ${name} }`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test("the engine index re-exports the modules listed in docs/web-engine.md", async () => {
  const engine = await import(engineIndex);
  for (const name of ["parseHtml", "parseCss", "applyChanges", "setDeclarations", "buildPreview", "hotCss", "buildSite", "TEMPLATES", "ELEMENT_CATEGORIES", "planInsert", "STYLE_SECTIONS", "BREAKPOINTS", "normalizePath", "languageOf"]) {
    assert.ok(name in engine, `missing export ${name}`);
  }
});
