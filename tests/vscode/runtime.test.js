// The `vscode` API shim (app/src/vscode/runtime-src.js) against a mock host: the shim runs in a vm context that
// stands in for the sandboxed frame; requests are answered by the handlers below.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { VSCODE_RUNTIME_SRC } from "../../app/src/vscode/runtime-src.js";
import { WEB_EXT_CODE } from "./fixtures.js";

function frame(code, { handlers = {}, cfg = {} } = {}) {
  const requests = [];
  const logs = [];
  const listeners = [];
  let ready;
  const readyP = new Promise((r) => (ready = r));
  const pending = new Map();
  let seq = 0;
  const parent = {
    postMessage(raw) {
      const m = JSON.parse(JSON.stringify(raw)); // like structured clone across the frame boundary
      if (m.t === "req") {
        requests.push(m);
        Promise.resolve()
          .then(() => {
            const h = handlers[m.m];
            return h ? h(m.p) : null;
          })
          .then((r) => deliver({ ofx: 1, t: "res", id: m.id, ok: true, r: r ?? null }), (e) => deliver({ ofx: 1, t: "res", id: m.id, ok: false, e: { message: e.message } }));
      } else if (m.t === "ready") ready(m);
      else if (m.t === "log") logs.push(m);
      else if (m.t === "ires") {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.ok ? p.resolve(m.r) : p.reject(new Error(m.e.message));
      }
    },
  };
  const deliver = (data) => setTimeout(() => listeners.forEach((fn) => fn({ source: parent, data })), 0);
  const ctx = { parent, console: { log() {}, info() {}, warn() {}, error() {}, debug() {} }, addEventListener: (type, fn) => type === "message" && listeners.push(fn), queueMicrotask, setTimeout, clearTimeout, Response, Headers, URL };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  const config = { extId: "pub.ext", compatVersion: "1.95.0", settings: {}, defaults: { "testUpper.greeting": "OpenFini" }, globalState: {}, workspaceState: {}, network: [], packageJSON: {}, ...cfg };
  vm.runInContext(`const __VSX_CFG = ${JSON.stringify(config)};\n${VSCODE_RUNTIME_SRC}`, ctx);
  vm.runInContext(`__vsxDefine(function (module, exports, require, process, global) {\n${code}\n});`, ctx);
  vm.runInContext("__vsxBoot()", ctx);
  const invoke = (m, p) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      deliver({ ofx: 1, t: "inv", id, m, p });
    });
  return { ready: readyP, requests, logs, invoke, ctx };
}

const editor = (text, sel) => ({ path: "src/a.js", languageId: "javascript", version: 3, text, selections: [sel] });

describe("vscode API shim", () => {
  it("activates a CommonJS web extension and registers its commands and providers", async () => {
    const f = frame(WEB_EXT_CODE);
    assert.equal((await f.ready).error, undefined);
    const regs = f.requests.filter((r) => r.m === "commands.register").map((r) => r.p.id);
    assert.deepEqual(regs, ["testUpper.upper", "testUpper.hello"]);
    const prov = f.requests.filter((r) => r.m === "providers.register").map((r) => [r.p.kind, r.p.selector]);
    assert.deepEqual(prov.map((p) => p[0]), ["completion", "hover", "format"]);
    assert.deepEqual(f.requests.find((r) => r.m === "providers.register").p.triggers, ["."]);
  });

  it("edits the active editor through ONE editor.edit request and keeps state", async () => {
    let edit = null;
    let stored = null;
    const f = frame(WEB_EXT_CODE, { handlers: { "editor.edit": (p) => ((edit = p), true), "storage.set": (p) => ((stored = p), null) } });
    await f.ready;
    await f.invoke("editor.update", { editor: editor("let a = 'hello';\nb", { anchor: { line: 0, character: 9 }, active: { line: 0, character: 14 } }) });
    assert.equal(await f.invoke("command.run", { id: "testUpper.upper" }), "done");
    assert.deepEqual(edit, { path: "src/a.js", version: 3, edits: [{ start: { line: 0, character: 9 }, end: { line: 0, character: 14 }, text: "HELLO" }] });
    assert.deepEqual(stored, { scope: "global", key: "runs", value: 1 });
  });

  it("answers completion, hover and formatting calls with plain data", async () => {
    const f = frame(WEB_EXT_CODE);
    await f.ready;
    const doc = { path: "src/a.js", languageId: "javascript", version: 1, text: "foo.bar  \nbaz" };
    const items = await f.invoke("provider.call", { handle: 1, kind: "completion", doc, pos: { line: 0, character: 4 }, trigger: "." });
    assert.equal(items[0].label, "upperCaseAll");
    assert.equal(items[0].snippet, "upperCaseAll(${1:text})");
    assert.equal(items[0].kind, 2);
    assert.match(items[0].documentation, /line 1/);
    assert.equal(items[1].insertText, null);
    const hover = await f.invoke("provider.call", { handle: 2, kind: "hover", doc, pos: { line: 1, character: 1 } });
    assert.deepEqual(hover.contents, ["Word: **baz**"]);
    const edits = await f.invoke("provider.call", { handle: 3, kind: "format", doc, tabSize: 2 });
    assert.deepEqual(edits, [{ start: { line: 0, character: 0 }, end: { line: 0, character: 9 }, text: "foo.bar" }]);
  });

  it("reads configuration defaults and user values and shows messages", async () => {
    let msg = null;
    const f = frame(WEB_EXT_CODE, { cfg: { settings: { "testUpper.greeting": "Hallo" } }, handlers: { "window.message": (p) => ((msg = p), null) } });
    await f.ready;
    await f.invoke("command.run", { id: "testUpper.hello" });
    assert.deepEqual(msg, { kind: "info", text: "Hello from Hallo", items: [], modal: false, detail: "" });
  });

  it("reports and refuses unsupported APIs with a helpful error", async () => {
    const code = `const vscode = require("vscode");
exports.activate = async () => {
  try { vscode.window.createWebviewPanel("x", "y", 1); } catch (e) { globalThis.err1 = e.message; }
  try { vscode.debug.startDebugging(); } catch (e) { globalThis.err2 = e.message; }
  try { require("child_process"); } catch (e) { globalThis.err3 = e.message; }
  try { await vscode.workspace.fs.writeFile(vscode.Uri.file("a"), new Uint8Array()); } catch (e) { globalThis.err4 = e.message; }
  globalThis.thenable = typeof vscode.then;
};`;
    const f = frame(code);
    assert.equal((await f.ready).error, undefined);
    assert.match(f.ctx.err1, /vscode\.window\.createWebviewPanel is not supported in OpenFini/);
    assert.match(f.ctx.err2, /vscode\.debug\.startDebugging is not supported/);
    assert.match(f.ctx.err3, /without Node\.js/);
    assert.match(f.ctx.err4, /read-only/);
    assert.equal(f.ctx.thenable, "undefined", "the module is not mistaken for a promise");
    const reported = f.requests.filter((r) => r.m === "api.unsupported").map((r) => r.p.api);
    assert.ok(reported.includes("window.createWebviewPanel") && reported.includes("debug.startDebugging"));
  });

  it("blocks fetch unless the user allowed the origin", async () => {
    const code = `exports.activate = async () => {
  try { await fetch("https://evil.example/x"); } catch (e) { globalThis.blocked = e.message; }
  globalThis.allowed = await (await fetch("https://api.example.com/data")).text();
};`;
    const f = frame(code, { cfg: { network: ["https://api.example.com"] }, handlers: { "network.fetch": (p) => ({ status: 200, headers: {}, text: `ok ${p.url}` }) } });
    assert.equal((await f.ready).error, undefined);
    assert.match(f.ctx.blocked, /blocked/);
    assert.equal(f.ctx.allowed, "ok https://api.example.com/data");
    assert.equal(f.requests.filter((r) => r.m === "network.fetch").length, 1);
  });

  it("implements the value classes like VS Code", async () => {
    const f = frame(`const v = require("vscode");
const r = new v.Range(2, 5, 1, 0);
globalThis.out = {
  swapped: r.start.line === 1 && r.end.line === 2,
  contains: r.contains(new v.Position(1, 9)),
  sel: new v.Selection(3, 1, 1, 0).isReversed,
  uri: v.Uri.joinPath(v.Uri.parse("file:///a/b"), "../c", "d.js").toString(),
  kind: v.CompletionItemKind.Snippet,
  ver: v.version,
  ws: (() => { const e = new v.WorkspaceEdit(); e.insert(v.Uri.file("x.js"), new v.Position(0, 0), "hi"); return e.size; })(),
  ev: (() => { const em = new v.EventEmitter(); let n = 0; const d = em.event((x) => (n += x)); em.fire(2); d.dispose(); em.fire(5); return n; })(),
};
exports.activate = () => {};`);
    await f.ready;
    assert.deepEqual({ ...f.ctx.out }, { swapped: true, contains: true, sel: true, uri: "file:///a/c/d.js", kind: 14, ver: "1.95.0", ws: 1, ev: 2 });
  });

  it("reports activation errors instead of hanging", async () => {
    const f = frame(`exports.activate = () => { throw new Error("boom"); };`);
    assert.match((await f.ready).error, /boom/);
  });
});
