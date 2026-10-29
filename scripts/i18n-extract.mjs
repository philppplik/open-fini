// i18n catalog tooling. See docs/i18n.md.
//
//   node scripts/i18n-extract.mjs            extract + report (writes app/src/i18n/locales/en.json)
//   node scripts/i18n-extract.mjs --check    CI mode: nothing is written; exits 1 when en.json is stale, a locale file has
//                                            keys that are not in the catalog, placeholders differ from English or a plural
//                                            message has invalid syntax. Missing translations are only reported
//                                            (add --strict to fail on them as well).
//   node scripts/i18n-extract.mjs --missing de   list the untranslated keys of one locale
//
// What is scanned in app/src: t("text"), t("text", {params}), t("id", "Default text"), N_("text") and, because command and menu
// tables are static data that is translated at render time, the implicit patterns in IMPLICIT below.
// Dynamic keys (template literals with ${}) cannot be extracted and are reported as warnings.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { placeholders, validateMessage } from "../app/src/i18n/format.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SRC = join(root, "app", "src");
export const LOCALE_DIR = join(SRC, "i18n", "locales");

/** Files whose static tables are translated at render time: [path test, regex with the text in group 1 (double-quoted literal)]. */
const STR = String.raw`"((?:[^"\\\n]|\\.)*)"`;
const slidesFile = (p) => p.startsWith("office/slides/") || p === "commands/office-slides.js";
export const IMPLICIT = [
  { test: (p) => p === "ui/menus.js" || p === "studios/office.js", re: new RegExp(String.raw`\blabel:\s*${STR}`, "g") },
  { test: (p) => p.startsWith("commands/"), re: new RegExp(String.raw`\bdef\(\s*"[\w.\-]+"\s*,\s*${STR}`, "g") },
  // DOM helpers (i18n/dom.js) and icon buttons (their label is the tooltip and aria-label, translated by iconButton itself)
  { test: () => true, re: new RegExp(String.raw`\btspan\(\s*${STR}`, "g") },
  { test: () => true, re: new RegExp(String.raw`\bta\(\{([^}]*)\}\)`, "g"), inner: new RegExp(String.raw`:\s*${STR}`, "g") },
  { test: () => true, re: new RegExp(String.raw`\biconButton\(\{[^}]*?\blabel:\s*${STR}`, "g") },
  // static content tables, translated by their renderers (tour.js, onboarding.js, shell.js, studio-bar.js, titlebar.js)
  { test: (p) => p === "ui/tour-steps.js" || p === "ui/whats-new.js", re: new RegExp(String.raw`\b(?:title|body|text):\s*${STR}`, "g") },
  { test: (p) => p === "studios/index.js", re: new RegExp(String.raw`\bblurb:\s*${STR}`, "g") },
  { test: (p) => p === "ui/titlebar.js", re: new RegExp(String.raw`\bcontrolButton\(\s*"\w+"\s*,\s*${STR}`, "g") },
  { test: (p) => p === "ui/titlebar.js", re: new RegExp(String.raw`const label = on \? ${STR} : ${STR}`, "g") },
  // dialogs, import/export and the context menus: property texts and literal toasts (translated centrally by the helpers
  // in ui/controls.js, ui/dialogs.js, ui/menus.js and the toast listener in ui/shell.js)
  { test: (p) => ["ui/export-dialog.js", "ui/import-dialogs.js", "ui/context-menu/providers.js", "ui/dialogs.js", "ui/color-settings.js"].includes(p), re: new RegExp(String.raw`\b(?:label|title|hint|placeholder|message|ok|cancel):\s*${STR}`, "g") },
  { test: (p) => ["ui/export-dialog.js", "ui/import-dialogs.js", "ui/dialogs.js"].includes(p) || p === "commands/file.js" || p === "commands/edit.js", re: new RegExp(String.raw`\.toast\(\s*${STR}`, "g") },
  { test: (p) => p === "ui/dialogs.js", re: new RegExp(String.raw`\["((?:[^"\\\n]|\\.)*)",\s*[\d.]+,\s*[\d.]+,\s*"(?:px|mm|in)"`, "g") },
  { test: (p) => p === "ui/dialogs.js", re: new RegExp(String.raw`^\s{2}(Screen|Print|Photo|Social|Icon):`, "gm") },
  // settings schema: property texts and the sw()/seg()/num() helpers (translated by tr() when the dialog renders)
  { test: (p) => p === "ui/settings-dialog.js", re: new RegExp(String.raw`\b(?:label|text|hint|title|lead|button|placeholder):\s*${STR}`, "g") },
  { test: (p) => p === "ui/settings-dialog.js", re: new RegExp(String.raw`\b(?:sw|seg)\(\s*"[\w.]+"\s*,\s*${STR}(?:\s*,\s*${STR})?`, "g") },
  { test: (p) => p === "ui/settings-dialog.js", re: new RegExp(String.raw`\bnum\(\s*"[\w.]+"\s*,\s*${STR}\s*,[^"\n]*"[^"\n]*"(?:\s*,\s*${STR})?`, "g") },
  { test: (p) => p === "ui/settings-dialog.js", re: new RegExp(String.raw`\}\]\s*,\s*${STR}[,)]`, "g") },
  { test: (p) => p.startsWith("commands/"), re: new RegExp(String.raw`\bregisterCommand\(\s*"[\w.\-]+"\s*,\s*\{\s*label:\s*${STR}`, "g") },
  // color management: button() labels (translated by ui/controls.js) and the preflight message templates of the pure
  // engine, which marks them with a local N_ (it cannot import the i18n runtime)
  { test: (p) => p === "ui/color-settings.js", re: new RegExp(String.raw`\bbutton\(\s*${STR}`, "g") },
  { test: (p) => p === "engine/color/preflight.js", re: new RegExp(String.raw`\bN_\(\s*${STR}`, "g") },
  // Office Suite apps: toolkit control and dialog texts, manifests, undo labels and model errors (translated by the
  // toolkit, openDialog, commitOffice callers and the apps' toasts)
  { test: (p) => p.startsWith("office/sheet/") || p.startsWith("office/toolkit/"), re: new RegExp(String.raw`\b(?:label|title|description|blurb):\s*${STR}`, "g") },
  { test: (p) => p.startsWith("office/sheet/"), re: /\bcommit\(([^,]*?),/g, inner: new RegExp(String.raw`(?:^\s*|[?:]\s*)${STR}`, "g") },
  { test: (p) => p === "office/sheet/model.js", re: new RegExp(String.raw`\bnew Error\(\s*${STR}`, "g") },
  // collaboration UI: literal toasts and dialog texts (translated by app.toast / confirmDialog / promptDialog) and tab labels
  { test: (p) => p.startsWith("ui/collab/"), re: new RegExp(String.raw`\.toast\(\s*${STR}`, "g") },
  { test: (p) => p.startsWith("ui/collab/"), re: new RegExp(String.raw`\b(?:title|message|ok|label):\s*${STR}`, "g") },
  // Presentation app: static labels (manifest, layouts, themes, menus), toolkit buttons and undo-step names
  { test: slidesFile, re: new RegExp(String.raw`\b(?:label|description|blurb):\s*${STR}`, "g") },
  { test: slidesFile, re: /\bname:\s*"([A-Z][^"\\\n]*)"/g },
  { test: slidesFile, re: new RegExp(String.raw`\b(?:cmd|btn)\(\s*"[\w-]+"\s*,\s*${STR}`, "g") },
  { test: slidesFile, re: new RegExp(String.raw`\b(?:commit|deckOp|insertElement)\(\s*${STR}`, "g") },
  { test: slidesFile, re: new RegExp(String.raw`\b(?:toggleStyle|format)\([^;]*?,\s*${STR}\)`, "g") },
  { test: (p) => p === "office/slides/model.js", re: /"(Click to add [a-z]+)"/g },
];

/** Implicit patterns also hit units, numbers and technical tokens that need no translation. */
const NOISE = new Set(["px", "mm", "cm", "in", "pt", "max", "min", "dpi", "DPI", "MB", "KB"]);
const isNoise = (s) => !/\p{L}/u.test(s) || NOISE.has(s) || s.length < 2;

function unescapeJs(s, quote) {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, c) => {
    if (c[0] === "u" && c.length > 1) return String.fromCodePoint(parseInt(c.replace(/^u\{?|\}$/g, ""), 16));
    if (c[0] === "x" && c.length > 1) return String.fromCharCode(parseInt(c.slice(1), 16));
    return { n: "\n", t: "\t", r: "\r", "\n": "" }[c] ?? c;
  });
}

const LIT = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`)";
const CALL = new RegExp(String.raw`(?<![\w$.])(t|N_)\(\s*${LIT}(?:\s*,\s*${LIT})?`, "g");
const DYN = new RegExp(String.raw`(?<![\w$.])(?:t|N_)\(\s*\x60[^\x60]*\$\{`, "g");

function litValue(lit) {
  const q = lit[0];
  return unescapeJs(lit.slice(1, -1), q);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "locales") continue;
      walk(full, out);
    } else if (/\.m?js$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Extracts {catalog: {key: defaultText}, warnings: string[], uses: {key: [file:line]}} from sources (default: app/src). */
export function extract(files = walk(SRC).map((f) => ({ path: f, text: readFileSync(f, "utf8") })), base = SRC) {
  const catalog = {};
  const uses = {};
  const warnings = [];
  const add = (key, def, file, text, index) => {
    const line = text.slice(0, index).split("\n").length;
    const where = `${file}:${line}`;
    if (key in catalog && catalog[key] !== def) warnings.push(`${where}: id "${key}" is used with different default texts`);
    catalog[key] = def;
    (uses[key] ||= []).push(where);
  };
  for (const { path, text } of files) {
    const rel = relative(base, path).split(sep).join("/");
    if (rel.startsWith("i18n/")) continue;
    // Only files that import the i18n runtime call the real t(); other files may have a local helper named t.
    const usesI18n = /from\s+["'][^"']*i18n\/index\.js["']/.test(text);
    for (const m of usesI18n ? text.matchAll(CALL) : []) {
      const first = litValue(m[2]);
      if (m[2][0] === "`" && m[2].includes("${")) continue;
      if (m[3] !== undefined && m[1] === "t") add(first, litValue(m[3]), rel, text, m.index);
      else add(first, first, rel, text, m.index);
    }
    for (const m of usesI18n ? text.matchAll(DYN) : []) warnings.push(`${rel}:${text.slice(0, m.index).split("\n").length}: dynamic t() key cannot be extracted`);
    for (const rule of IMPLICIT) {
      if (!rule.test(rel)) continue;
      for (const m of text.matchAll(rule.re)) {
        const found = rule.inner ? [...m[1].matchAll(rule.inner)].map((x) => x[1]) : m.slice(1);
        for (const g of found) if (g && !isNoise(g)) add(unescapeJs(g), unescapeJs(g), rel, text, m.index);
      }
    }
  }
  const sorted = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b, "en")));
  return { catalog: sorted, warnings, uses };
}

export function readLocale(code) {
  const p = join(LOCALE_DIR, `${code}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

export const localeCodes = () => readdirSync(LOCALE_DIR).filter((f) => f.endsWith(".json") && f !== "en.json").map((f) => f.slice(0, -5));

/** Compares a locale to the catalog. Returns {errors, missing, unused}. */
export function checkLocale(code, data, catalog) {
  const errors = [];
  const missing = [];
  const unused = [];
  for (const [key, value] of Object.entries(data)) {
    if (!(key in catalog)) {
      unused.push(key);
      errors.push(`${code}: key not in the catalog: ${JSON.stringify(key)}`);
      continue;
    }
    if (typeof value !== "string") {
      errors.push(`${code}: value of ${JSON.stringify(key)} is not a string`);
      continue;
    }
    const bad = validateMessage(value);
    if (bad) errors.push(`${code}: invalid message syntax in ${JSON.stringify(key)}: ${bad}`);
    const want = placeholders(catalog[key]).join(",");
    const got = placeholders(value).join(",");
    if (!bad && want !== got) errors.push(`${code}: placeholders differ in ${JSON.stringify(key)} (English: ${want || "none"}; ${code}: ${got || "none"})`);
  }
  for (const key of Object.keys(catalog)) if (!(key in data) || data[key] === "") missing.push(key);
  return { errors, missing, unused };
}

export function checkEnglishMessages(catalog) {
  return Object.entries(catalog).flatMap(([k, v]) => {
    const bad = validateMessage(v);
    return bad ? [`en: invalid message syntax in ${JSON.stringify(k)}: ${bad}`] : [];
  });
}

const stringify = (o) => JSON.stringify(o, null, 2) + "\n";

function main(argv) {
  const check = argv.includes("--check");
  const strict = argv.includes("--strict");
  const mi = argv.indexOf("--missing");
  const { catalog, warnings } = extract();
  const enPath = join(LOCALE_DIR, "en.json");
  const errors = checkEnglishMessages(catalog);
  const current = existsSync(enPath) ? readFileSync(enPath, "utf8").replace(/\r\n/g, "\n") : "";
  if (check) {
    if (current !== stringify(catalog)) errors.push("en.json is out of date: run `npm run i18n:extract` and commit the result.");
  } else if (current !== stringify(catalog)) {
    writeFileSync(enPath, stringify(catalog));
    console.log(`Wrote ${relative(root, enPath)} (${Object.keys(catalog).length} keys).`);
  }
  for (const w of warnings) console.warn(`warning: ${w}`);
  let missingTotal = 0;
  for (const code of localeCodes()) {
    const data = readLocale(code);
    const r = checkLocale(code, data, catalog);
    errors.push(...r.errors);
    missingTotal += r.missing.length;
    const pct = Math.round(((Object.keys(catalog).length - r.missing.length) / Math.max(1, Object.keys(catalog).length)) * 100);
    console.log(`${code}: ${pct}% translated, ${r.missing.length} missing, ${r.unused.length} unused`);
    if (mi >= 0 && argv[mi + 1] === code) for (const k of r.missing) console.log(`  missing: ${JSON.stringify(k)}`);
  }
  if (strict && missingTotal) errors.push(`${missingTotal} untranslated keys (--strict).`);
  for (const e of errors) console.error(`error: ${e}`);
  console.log(`${Object.keys(catalog).length} catalog keys.`);
  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
