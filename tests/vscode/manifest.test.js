import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { localizePackage, normalizePackage, compatibility, scanApiUsage, vscodeChord, languageIdOf, selectorMatches, engineSatisfied, globToRegExp, languageData, configurationProperties, referencedFiles, resolveEntry } from "../../app/src/vscode/manifest.js";
import { parseJsonc } from "../../app/src/vscode/jsonc.js";

const base = { name: "x", publisher: "pub", version: "1.0.0" };
const norm = (pkg) => {
  const r = normalizePackage({ ...base, ...pkg });
  assert.ok(r.ok, r.errors.join());
  return r.manifest;
};

describe("vscode manifest", () => {
  it("localizes %key% placeholders from package.nls bundles (first bundle wins)", () => {
    const out = localizePackage({ displayName: "%name%", contributes: { commands: [{ title: "%cmd%" }] }, other: "%missing%" }, { name: "Deutsch" }, { name: "English", cmd: { message: "Run" } });
    assert.equal(out.displayName, "Deutsch");
    assert.equal(out.contributes.commands[0].title, "Run");
    assert.equal(out.other, "%missing%");
  });

  it("validates publisher, name and version", () => {
    assert.equal(normalizePackage({ name: "x", version: "1.0.0" }).ok, false);
    assert.equal(normalizePackage({ ...base, version: "latest" }).ok, false);
    assert.equal(normalizePackage(null).ok, false);
    const m = norm({ publisher: "Pub", displayName: "Nice", extensionKind: "web", contributes: { themes: [{ label: "T", path: ".\\themes\\t.json" }, { label: "no path" }] } });
    assert.equal(m.id, "pub.x");
    assert.deepEqual(m.extensionKind, ["web"]);
    assert.equal(m.contributes.themes.length, 1);
    assert.equal(m.contributes.themes[0].path, "themes/t.json");
  });

  it("rates declarative, web, Node and empty extensions honestly", () => {
    const theme = norm({ contributes: { themes: [{ label: "T", path: "t.json" }] } });
    assert.equal(compatibility(theme).level, "full");
    assert.match(compatibility(theme).label, /declarative only/);

    const grammar = norm({ contributes: { snippets: [{ language: "js", path: "s.json" }], grammars: [{ language: "x", scopeName: "source.x", path: "x.tmLanguage.json" }] } });
    const g = compatibility(grammar);
    assert.equal(g.level, "partial");
    assert.match(g.label, /TextMate/);

    const web = norm({ browser: "./dist/web.js", contributes: { commands: [{ command: "a", title: "A" }] } });
    assert.equal(compatibility(web, { code: "const v=require('vscode');v.window.showInformationMessage('x')" }).level, "full");
    const webBad = compatibility(web, { code: "n.window.createWebviewPanel(1);n.debug.registerDebugAdapterDescriptorFactory()" });
    assert.equal(webBad.level, "partial");
    assert.deepEqual(webBad.apis, ["debug.registerDebugAdapterDescriptorFactory", "window.createWebviewPanel"]);
    assert.match(webBad.label, /uses unsupported APIs: debug\.register.*window\.createWebviewPanel/);

    const node = norm({ main: "./out/ext.js", contributes: { commands: [{ command: "a", title: "A" }] } });
    const n = compatibility(node, { names: ["bin/x.node"] });
    assert.equal(n.level, "none");
    assert.equal(n.label, "Not supported: needs Node or native code");
    assert.ok(n.reasons.some((r) => /native binaries/.test(r)));
    assert.equal(n.runsCode, false);

    const nodeTheme = norm({ main: "./out/ext.js", contributes: { themes: [{ label: "T", path: "t.json" }] } });
    assert.equal(compatibility(nodeTheme).level, "partial");
    assert.match(compatibility(nodeTheme).label, /contributions only/);

    const pack = norm({ extensionPack: ["a.b"] });
    assert.equal(compatibility(pack).level, "none");
  });

  it("records runtime-detected unsupported APIs", () => {
    const web = norm({ browser: "e.js" });
    assert.deepEqual(compatibility(web, { runtimeUnsupported: ["window.createTreeView"] }).apis, ["window.createTreeView"]);
  });

  it("scans only known API names (no false alarms for ordinary code)", () => {
    assert.deepEqual(scanApiUsage("this.window.location; a.workspace.foo; x.languages.registerHoverProvider()"), []);
    assert.deepEqual(scanApiUsage("e.languages.registerDefinitionProvider(); e.tasks.registerTaskProvider()"), ["languages.registerDefinitionProvider", "tasks.registerTaskProvider"]);
  });

  it("checks engines.vscode against the reported compatibility version", () => {
    assert.equal(engineSatisfied("^1.67.2"), true);
    assert.equal(engineSatisfied(">=1.99.0"), false);
    assert.equal(engineSatisfied("^2.0.0"), false);
    assert.equal(engineSatisfied("*"), true);
  });

  it("converts key bindings and refuses multi-step chords", () => {
    assert.equal(vscodeChord("ctrl+shift+u"), "Mod+Shift+U");
    assert.equal(vscodeChord("cmd+alt+k"), "Mod+Alt+K");
    assert.equal(vscodeChord("ctrl+k ctrl+c"), null);
    assert.equal(vscodeChord("f5"), "F5");
  });

  it("resolves language ids, contributed languages first", () => {
    assert.equal(languageIdOf("src/app.tsx"), "typescriptreact");
    assert.equal(languageIdOf("a/b.py"), "python");
    assert.equal(languageIdOf("x.toy", [{ id: "toylang", extensions: [".toy"] }]), "toylang");
    assert.equal(languageIdOf("Makefile", [{ id: "make", extensions: [], filenames: ["Makefile"] }]), "make");
    assert.equal(languageIdOf("README"), "plaintext");
  });

  it("matches document selectors", () => {
    assert.ok(selectorMatches("javascript", "javascript"));
    assert.ok(selectorMatches({ language: "javascript", scheme: "file" }, "javascript"));
    assert.ok(selectorMatches([{ language: "css" }, "javascript"], "javascript"));
    assert.ok(!selectorMatches({ language: "css" }, "javascript"));
    assert.ok(!selectorMatches({ scheme: "untitled-remote" }, "javascript"));
    assert.ok(selectorMatches("*", "anything"));
  });

  it("turns globs into regular expressions", () => {
    assert.ok(globToRegExp("**/*.js").test("a/b/c.js"));
    assert.ok(globToRegExp("**/*.js").test("c.js"));
    assert.ok(!globToRegExp("*.js").test("a/c.js"));
    assert.ok(globToRegExp("src/**/*.{ts,tsx}").test("src/x/y.tsx"));
    assert.ok(!globToRegExp("src/*.md").test("srcxmd"));
  });

  it("reads language configurations and settings schemas", () => {
    const d = languageData({ comments: { lineComment: "#", blockComment: ["(*", "*)"] }, autoClosingPairs: [["(", ")"], { open: "'", close: "'" }, ["begin", "end"]] });
    assert.deepEqual(d, { commentTokens: { line: "#", block: { open: "(*", close: "*)" } }, closeBrackets: { brackets: ["(", "'"] } });
    assert.deepEqual(languageData({ comments: "bad" }), {});
    const props = configurationProperties({ contributes: { configuration: [{ title: "A", properties: { "a.b": { type: ["string", "null"], default: "x", enum: ["x", "y", {}] }, "bad key!": {} } }] } });
    assert.deepEqual(Object.keys(props), ["a.b"]);
    assert.equal(props["a.b"].type, "string");
    assert.deepEqual(props["a.b"].enum, ["x", "y"]);
  });

  it("lists the files it needs and resolves extension-less entries", () => {
    const m = norm({ browser: "./dist/web/extension", icon: "icon.png", contributes: { languages: [{ id: "x", configuration: "./lc.json" }] } });
    const files = referencedFiles(m);
    for (const p of ["dist/web/extension.js", "icon.png", "lc.json"]) assert.ok(files.has(p), p);
    assert.equal(resolveEntry("dist/web/extension", new Set(["dist/web/extension.js"])), "dist/web/extension.js");
    assert.equal(resolveEntry("dist/missing", new Set()), null);
  });

  it("parses JSONC without touching strings", () => {
    assert.deepEqual(parseJsonc(`// c\n{ "a": "// not a comment, }", /* x */ "b": [1, 2,], }`), { a: "// not a comment, }", b: [1, 2] });
    assert.deepEqual(parseJsonc('﻿{"s": "a, ]"}'), { s: "a, ]" });
    assert.throws(() => parseJsonc("{ a: 1 }"));
  });
});
