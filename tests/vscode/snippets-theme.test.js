import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSnippetBody, toCodeMirror, parseSnippetFile, snippetVariables } from "../../app/src/vscode/snippets.js";
import { convertColorTheme, tokenColor, themeIdFor, loadThemeJson } from "../../app/src/vscode/theme.js";
import { validateTheme, contrast, resolveVars } from "../../app/src/ui/themes.js";
import { parseJsonc } from "../../app/src/vscode/jsonc.js";
import { THEME_EXT } from "./fixtures.js";

const enc = (s) => new TextEncoder().encode(s);

describe("vscode snippet syntax", () => {
  it("parses tab stops, placeholders, choices, variables and escapes", () => {
    const n = parseSnippetBody("a $1 ${2:def ${3:in}} ${4|x,y\\,z|} $TM_FILENAME ${FOO:bar} \\$5 $0");
    const kinds = n.filter((x) => x.t !== "text").map((x) => x.t);
    assert.deepEqual(kinds, ["tab", "tab", "choice", "var", "var", "tab"]);
    assert.deepEqual(n.find((x) => x.t === "choice").options, ["x", "y,z"]);
    assert.ok(n.some((x) => x.t === "text" && x.v.includes("$5")));
  });

  it("converts to CodeMirror templates", () => {
    assert.equal(toCodeMirror("console.log(${1:value});$0"), "console.log(${1:value});${0}");
    assert.equal(toCodeMirror(["function ${1:name}() {", "\t$0", "}"]), "function ${1:name}() \\{\n\t${0}\n\\}");
    assert.equal(toCodeMirror("${1|a,b|}"), "${1:a}");
    assert.equal(toCodeMirror("${1:outer ${2:inner}}"), "${1:outer inner}");
    assert.equal(toCodeMirror("// $TM_FILENAME", { TM_FILENAME: "a.js" }), "// a.js");
    assert.equal(toCodeMirror("${UNKNOWN}"), "${UNKNOWN}");
    assert.equal(toCodeMirror("${UNKNOWN:fallback}"), "fallback");
    assert.equal(toCodeMirror("#{x} ${1:{a}}"), "#\\{x\\} ${1:a}\\}", "like VS Code, the first } closes the placeholder");
    assert.equal(toCodeMirror("${TM_FILENAME/(.*)/${1:/upcase}/}", { TM_FILENAME: "a.js" }), "a.js");
    assert.equal(toCodeMirror("cost: \\$5"), "cost: $5");
    assert.equal(toCodeMirror("broken ${ and $"), "broken $\\{ and $", "a literal ${ stays literal in CodeMirror");
  });

  it("reads snippet files (prefix arrays, body arrays, scope)", () => {
    const list = parseSnippetFile(`{ "A": { "prefix": ["a", "aa"], "body": ["x", "y"], "description": "d" }, "B": { "prefix": "b", "body": "z", "scope": "css,html" }, "bad": 1 }`, "");
    assert.equal(list.length, 2);
    assert.deepEqual(list[0].prefix, ["a", "aa"]);
    assert.equal(list[0].body, "x\ny");
    assert.deepEqual(list[0].languages, ["*"]);
    assert.deepEqual(list[1].languages, ["css", "html"]);
    assert.deepEqual(parseSnippetFile(`{"A":{"prefix":"a","body":"x"}}`, "javascript")[0].languages, ["javascript"]);
  });

  it("provides VS Code variables", () => {
    const v = snippetVariables({ path: "src/app/main.js", selection: "sel", now: new Date(2026, 0, 5, 9, 3, 7), randomBytes: (n) => new Uint8Array(n).fill(7) });
    assert.equal(v.RANDOM, "777777");
    assert.equal(v.TM_FILENAME, "main.js");
    assert.equal(v.TM_FILENAME_BASE, "main");
    assert.equal(v.TM_DIRECTORY, "src/app");
    assert.equal(v.CURRENT_YEAR, "2026");
    assert.equal(v.CURRENT_MONTH, "01");
    assert.equal(v.CURRENT_DAY_NAME_SHORT, "Mon");
    assert.match(v.UUID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("vscode color themes", () => {
  const files = Object.fromEntries(Object.entries(THEME_EXT).filter(([k]) => k.startsWith("extension/")).map(([k, v]) => [k.slice(10), typeof v === "string" ? enc(v) : v]));

  it("matches TextMate scopes by longest prefix", () => {
    const rules = [{ scopes: ["keyword"], fg: "#111111" }, { scopes: ["keyword.operator"], fg: "#222222" }, { scopes: ["meta.tag string"], fg: "#333333" }];
    assert.equal(tokenColor(rules, "keyword.control"), "#111111");
    assert.equal(tokenColor(rules, "keyword.operator.new"), "#222222");
    assert.equal(tokenColor(rules, "string.quoted"), "#333333");
    assert.equal(tokenColor(rules, "comment"), null);
  });

  it("converts a dark theme with includes into a valid OpenFini theme", () => {
    const json = loadThemeJson(files, "themes/night.json");
    assert.equal(json.colors["sideBar.background"], "#101820", "include merged");
    const conv = convertColorTheme(json, { label: "Test Night", uiTheme: "vs-dark", id: themeIdFor("openfini-test.night-owl-lite", "Test Night") });
    assert.deepEqual(validateTheme(conv.def), []);
    assert.equal(conv.mode, "dark");
    const d = conv.def.dark.vars;
    assert.equal(d["--of-editor-bg"], "#011627");
    assert.equal(d["--of-bg-panel"], "#101820");
    assert.equal(d["--of-accent"], "#7e57c2");
    assert.equal(d["--of-syn-string"], "#ecc48d");
    assert.equal(d["--of-syn-keyword"], "#c792ea");
    assert.equal(d["--of-syn-op"], "#7fdbca");
    assert.equal(conv.def.light.vars["--of-syn-string"], "#ecc48d", "the other mode keeps the syntax colors");
    assert.equal(conv.def.light.vars["--of-bg-panel"], undefined, "…but not the dark surfaces");
    assert.match(conv.def.id, /^[a-z0-9][a-z0-9-]{0,39}$/);
  });

  it("repairs illegible colors with the contrast check", () => {
    const json = parseJsonc(new TextDecoder().decode(files["themes/paper.json"]));
    const conv = convertColorTheme(json, { label: "Paper", uiTheme: "vs", id: "vsc-paper" });
    assert.equal(conv.mode, "light");
    assert.ok(conv.adjusted.includes("--of-text"), "light-gray text on white is adjusted");
    assert.ok(conv.adjusted.includes("--of-syn-comment"));
    const v = resolveVars({ ...conv.def, neutrals: false }, "light");
    assert.ok(contrast(v["--of-text"], v["--of-bg-panel"]) >= 7);
    assert.ok(contrast(v["--of-syn-comment"], v["--of-editor-bg"]) >= 3);
  });

  it("ignores unsafe color values", () => {
    const conv = convertColorTheme({ type: "dark", colors: { "editor.background": "url(javascript:alert(1))", focusBorder: "red; x: y" }, tokenColors: [{ scope: "string", settings: { foreground: "expression(1)" } }] }, { label: "Bad", id: "vsc-bad" });
    assert.deepEqual(validateTheme(conv.def), []);
    assert.equal(conv.def.dark.vars["--of-accent"], undefined);
    assert.equal(conv.def.dark.vars["--of-syn-string"], undefined);
  });
});
