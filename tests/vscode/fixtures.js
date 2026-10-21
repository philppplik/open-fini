// Tiny hand-made VS Code extensions for the tests (our own manifests and code; no third-party extension is
// redistributed). `node tests/vscode/fixtures.js <dir>` writes them as .vsix files for manual checks in the browser.
import { zipSync, strToU8 } from "../../app/vendor/fflate/fflate.js";

const enc = (x) => (typeof x === "string" ? strToU8(x) : x);

/** Builds a .vsix (ZIP) from { "extension/package.json": "...", ... }. */
export function makeVsix(files) {
  const entries = {};
  for (const [k, v] of Object.entries(files)) entries[k] = [enc(v), { level: 6 }];
  return zipSync(entries);
}

const contentTypes = `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/></Types>`;

export const THEME_EXT = {
  "[Content_Types].xml": contentTypes,
  "extension.vsixmanifest": "<PackageManifest/>",
  "extension/package.json": JSON.stringify({
    name: "night-owl-lite",
    displayName: "%displayName%",
    publisher: "openfini-test",
    version: "1.0.0",
    license: "MIT",
    engines: { vscode: "^1.70.0" },
    categories: ["Themes"],
    contributes: { themes: [{ label: "Test Night", uiTheme: "vs-dark", path: "./themes/night.json" }, { label: "Test Paper", uiTheme: "vs", path: "./themes/paper.json" }] },
  }),
  "extension/package.nls.json": JSON.stringify({ displayName: "Test Night Theme" }),
  "extension/README.md": "# Test Night\n\nA *test* theme. <script>alert(1)</script> ![remote](https://example.com/x.png)",
  "extension/LICENSE.txt": "MIT License (test fixture)",
  "extension/themes/base.json": `{ "colors": { "sideBar.background": "#101820" } }`,
  "extension/themes/night.json": `// a comment
{
  "type": "dark",
  "include": "./base.json",
  "colors": {
    "editor.background": "#011627",
    "editor.foreground": "#d6deeb",
    "focusBorder": "#7e57c2",
    "statusBar.background": "#011627",
    "editor.selectionBackground": "#1d3b53",
  },
  "tokenColors": [
    { "scope": ["comment", "punctuation.definition.comment"], "settings": { "foreground": "#637777", "fontStyle": "italic" } },
    { "scope": "string", "settings": { "foreground": "#ecc48d" } },
    { "scope": "keyword", "settings": { "foreground": "#c792ea" } },
    { "scope": "keyword.operator", "settings": { "foreground": "#7fdbca" } },
    { "scope": "entity.name.function", "settings": { "foreground": "#82aaff" } },
    { "scope": "constant.numeric", "settings": { "foreground": "#f78c6c" } },
  ],
}`,
  "extension/themes/paper.json": JSON.stringify({ type: "light", colors: { "editor.background": "#ffffff", "editor.foreground": "#bbbbbb", "sideBar.background": "#f4f4f4" }, tokenColors: [{ scope: "comment", settings: { foreground: "#eeeeee" } }] }),
  "extension/node_modules/big/huge.bin": new Uint8Array(200_000),
};

export const SNIPPET_EXT = {
  "[Content_Types].xml": contentTypes,
  "extension/package.json": JSON.stringify({
    name: "web-snippets",
    displayName: "Test Web Snippets",
    publisher: "openfini-test",
    version: "0.2.0",
    engines: { vscode: "^1.60.0" },
    categories: ["Snippets"],
    contributes: {
      snippets: [{ language: "javascript", path: "./snippets/js.code-snippets" }, { language: "html", path: "./snippets/html.json" }],
      languages: [{ id: "toylang", aliases: ["Toy"], extensions: [".toy"], configuration: "./toy.language-configuration.json" }],
    },
  }),
  "extension/snippets/js.code-snippets": `{
  // VS Code snippet syntax
  "Log value": { "prefix": ["clog", "log"], "body": ["console.log('\${1:value}', \${1:value});", "$0"], "description": "Log a value" },
  "Function": { "prefix": "fn", "body": "function \${1:name}(\${2|a,b,c|}) {\\n\\t$0\\n}" },
  "File header": { "prefix": "hdr", "body": "// $TM_FILENAME ($CURRENT_YEAR)" },
}`,
  "extension/snippets/html.json": JSON.stringify({ Card: { prefix: "card", body: ['<div class="card">', "\t$0", "</div>"] } }),
  "extension/toy.language-configuration.json": `{ "comments": { "lineComment": "#", "blockComment": ["(*", "*)"] }, "autoClosingPairs": [["(", ")"], { "open": "'", "close": "'" }, ["begin", "end"]] }`,
};

/** A web extension: an uppercase command, a completion provider, a hover provider and a formatter. */
export const WEB_EXT_CODE = `"use strict";
const vscode = require("vscode");
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("testUpper.upper", async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) { vscode.window.showWarningMessage("No editor"); return "no-editor"; }
      const ok = await ed.edit((b) => { for (const s of ed.selections) b.replace(s, ed.document.getText(s).toUpperCase()); });
      await context.globalState.update("runs", (context.globalState.get("runs", 0)) + 1);
      return ok ? "done" : "rejected";
    }),
    vscode.commands.registerCommand("testUpper.hello", () => vscode.window.showInformationMessage("Hello from " + vscode.workspace.getConfiguration("testUpper").get("greeting", "?"))),
    vscode.languages.registerCompletionItemProvider({ language: "javascript" }, {
      provideCompletionItems(doc, pos) {
        const item = new vscode.CompletionItem("upperCaseAll", vscode.CompletionItemKind.Function);
        item.detail = "Test Upper";
        item.insertText = new vscode.SnippetString("upperCaseAll(\${1:text})");
        item.documentation = new vscode.MarkdownString("Upper-cases **text** on line " + (pos.line + 1));
        return [item, new vscode.CompletionItem("lowerCaseAll", vscode.CompletionItemKind.Function)];
      },
    }, "."),
    vscode.languages.registerHoverProvider("javascript", { provideHover(doc, pos) { const r = doc.getWordRangeAtPosition(pos); return r ? new vscode.Hover("Word: **" + doc.getText(r) + "**") : null; } }),
    vscode.languages.registerDocumentFormattingEditProvider("javascript", { provideDocumentFormattingEdits(doc) { const out = []; for (let i = 0; i < doc.lineCount; i++) { const l = doc.lineAt(i); const t = l.text.replace(/\\s+$/, ""); if (t !== l.text) out.push(vscode.TextEdit.replace(l.range, t)); } return out; } }),
  );
}
function deactivate() {}
module.exports = { activate, deactivate };
`;

export const WEB_EXT = {
  "[Content_Types].xml": contentTypes,
  "extension/package.json": JSON.stringify({
    name: "test-upper",
    displayName: "Test Upper",
    publisher: "openfini-test",
    version: "1.1.0",
    engines: { vscode: "^1.80.0" },
    browser: "./dist/web/extension",
    activationEvents: ["onLanguage:javascript"],
    contributes: {
      commands: [{ command: "testUpper.upper", title: "Upper-case selection", category: "Test Upper" }, { command: "testUpper.hello", title: "Say hello", category: "Test Upper" }],
      keybindings: [{ command: "testUpper.upper", key: "ctrl+alt+u" }, { command: "testUpper.hello", key: "ctrl+k ctrl+h" }],
      configuration: { title: "Test Upper", properties: { "testUpper.greeting": { type: "string", default: "OpenFini", description: "Greeting" }, "testUpper.loud": { type: "boolean", default: false, description: "Shout" } } },
    },
  }),
  "extension/dist/web/extension.js": WEB_EXT_CODE,
};

export const NODE_EXT = {
  "extension/package.json": JSON.stringify({ name: "node-only", publisher: "openfini-test", version: "3.0.0", main: "./out/extension.js", engines: { vscode: "^1.80.0" }, contributes: { commands: [{ command: "x.run", title: "Run" }], views: { explorer: [{ id: "x", name: "X" }] } } }),
  "extension/out/extension.js": "module.exports = { activate() { require('child_process'); } };",
  "extension/bin/helper.node": new Uint8Array(10),
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()) && process.argv[2]) {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(process.argv[2], { recursive: true });
  for (const [name, files] of Object.entries({ "test-night-theme.vsix": THEME_EXT, "test-web-snippets.vsix": SNIPPET_EXT, "test-upper.vsix": WEB_EXT, "node-only.vsix": NODE_EXT })) writeFileSync(join(process.argv[2], name), makeVsix(files));
  console.log("written to", process.argv[2]);
}
