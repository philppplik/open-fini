// The web engine is pure: no DOM, no window/document, no Blob/URL.createObjectURL, no fetch, no Node-only imports, so it
// runs in browsers, workers and Node.js. Each module also loads on its own.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "src", "engine", "web");
const MODULES = ["paths", "bytes", "html", "css", "edit", "css-props", "preview", "site", "templates", "elements", "highlight", "markdown", "latex", "libs", "frameworks", "ssg", "index"];

/**
 * Source text without comments, string literals, template literals and regular expression literals (a small scanner,
 * good enough to look for identifiers in this code base).
 */
function code(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  const skipString = (q) => {
    i++;
    while (i < n && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
    i++;
  };
  const skipTemplate = () => {
    i++;
    while (i < n && src[i] !== "`") {
      if (src[i] === "\\") i += 2;
      else if (src[i] === "$" && src[i + 1] === "{") {
        i += 2;
        let d = 1;
        while (i < n && d > 0) {
          if (src[i] === "{") d++;
          else if (src[i] === "}") d--;
          else if (src[i] === '"' || src[i] === "'") {
            skipString(src[i]);
            continue;
          } else if (src[i] === "`") {
            skipTemplate();
            continue;
          }
          i++;
        }
      } else i++;
    }
    i++;
  };
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
    } else if (c === '"' || c === "'") {
      skipString(c);
      out += '""';
    } else if (c === "`") {
      skipTemplate();
      out += "``";
    } else if (c === "/" && /[(,=:[!&|?{};+*%<>~^-]$/.test(out.trimEnd()) || (c === "/" && out.trim() === "")) {
      // regular expression literal
      i++;
      let cls = false;
      while (i < n && (src[i] !== "/" || cls)) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") cls = true;
        else if (src[i] === "]") cls = false;
        i++;
      }
      i++;
      while (i < n && /[a-z]/.test(src[i])) i++;
      out += "/re/";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function files() {
  const out = MODULES.map((m) => join(dir, m + ".js"));
  for (const f of readdirSync(join(dir, "tpl"))) out.push(join(dir, "tpl", f));
  return out;
}

test("modules only import relative engine files", () => {
  for (const file of files()) {
    const src = readFileSync(file, "utf8");
    // template files hold JavaScript sources inside strings: only their first lines are real imports
    const scanned = /[\\/]tpl[\\/]/.test(file) ? src.split("\n").slice(0, 12).join("\n") : src;
    for (const m of scanned.matchAll(/^\s*(?:import|export)\b[^;]*?\sfrom\s+["']([^"']+)["']/gm)) {
      assert.ok(m[1].startsWith("./") || m[1].startsWith("../"), `${file}: imports ${m[1]}`);
      assert.ok(!/node:|vendor|\.\.\/\.\.\//.test(m[1]), `${file}: imports ${m[1]}`);
    }
    assert.ok(!/\brequire\s*\(/.test(code(src)), file);
  }
});

test("modules use no DOM, browser or Node-only APIs", () => {
  const banned = /\b(document|window|navigator|localStorage|sessionStorage|XMLHttpRequest|Blob|FileReader|createObjectURL|fetch|Buffer|process|__dirname|__filename)\b/;
  for (const file of files()) {
    const stripped = code(readFileSync(file, "utf8"));
    const hit = banned.exec(stripped);
    assert.ok(!hit, `${file}: uses ${hit && hit[0]}`);
  }
});

test("every module loads on its own and templates and elements are plain data", async () => {
  for (const m of MODULES) {
    const mod = await import(pathToFileURL(join(dir, m + ".js")).href);
    assert.ok(Object.keys(mod).length > 0, m);
  }
  const { TEMPLATES } = await import(pathToFileURL(join(dir, "templates.js")).href);
  JSON.stringify(TEMPLATES);
  const { ELEMENT_CATEGORIES } = await import(pathToFileURL(join(dir, "elements.js")).href);
  JSON.stringify(ELEMENT_CATEGORIES);
});

test("source text uses US English spelling and has no leftovers", () => {
  const words = /\b(colour|neighbour|behaviour|favourite|centre|organis|normalis|licence|catalogue|honour|analyse)\w*/i;
  for (const file of files()) {
    const src = readFileSync(file, "utf8");
    const hit = words.exec(src);
    assert.ok(!hit, `${file}: ${hit && hit[0]}`);
    assert.ok(!/\bTODO\b|\bFIXME\b/.test(src), file);
  }
});
