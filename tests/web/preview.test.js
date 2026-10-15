import test from "node:test";
import assert from "node:assert/strict";
import { buildPreview, hotCss, scanModuleSpecifiers } from "../../app/src/engine/web/preview.js";
import { parseHtml, findByTag, getAttr } from "../../app/src/engine/web/html.js";
import { makeFiles } from "./_helpers.js";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const PNG_B64 = Buffer.from(PNG).toString("base64");
const slice = (text, d) => text.slice(d.start, d.end);

test("annotates every element with the parseHtml id and keeps everything else", () => {
  const src = '<!doctype html>\n<html lang="en-US">\n<head><title>T</title></head>\n<body>\n  <h1 class="a">Hi</h1>\n  <!-- c -->\n  <p>Text <b>bold</b><br/></p>\n</body>\n</html>\n';
  const files = makeFiles({ "index.html": src });
  const res = buildPreview(files, "index.html");
  assert.deepEqual(res.diagnostics, []);
  assert.deepEqual(res.pages, ["index.html"]);
  const parsed = parseHtml(src);
  const out = parseHtml(res.html);
  assert.equal(out.elements.length, parsed.elements.length);
  out.elements.forEach((el, i) => assert.equal(getAttr(el, "data-of"), String(i)));
  assert.equal(res.html.replace(/ data-of="\d+"/g, ""), src);
  // text, comments and raw text are untouched
  assert.ok(res.html.includes("<!-- c -->"));
  const noAnnotate = buildPreview(files, "index.html", { annotate: false });
  assert.equal(noAnnotate.html, src);
});

test("local stylesheets become <style data-of-file>, @import is inlined, url() becomes a data URL", () => {
  const files = makeFiles({
    "index.html": '<!doctype html><html><head><link rel="stylesheet" href="css/site.css" media="screen"><link rel="stylesheet" href="https://cdn.example.com/x.css"></head><body><p>x</p></body></html>',
    "css/site.css": '@import "base.css";\n@import url(theme/dark.css) (prefers-color-scheme: dark);\n.logo{background:url("../img/logo.png")}\n.miss{background:url(../img/none.png)}',
    "css/base.css": 'body{background:url(bg.png)}\n@import "site.css";',
    "css/bg.png": PNG,
    "css/theme/dark.css": "a{color:#fff;background:url(../bg.png)}",
    "img/logo.png": PNG,
  });
  const res = buildPreview(files, "index.html");
  const html = res.html;
  assert.match(html, /<style data-of="2" data-of-file="css\/site\.css" media="screen">/);
  assert.ok(html.includes('<link data-of="3" rel="stylesheet" href="https://cdn.example.com/x.css">'));
  assert.ok(!html.includes('href="css/site.css"'));
  // the style element is in the position of the link
  assert.ok(html.indexOf("<style data-of=") < html.indexOf("cdn.example.com"));
  assert.ok(html.includes(`body{background:url("data:image/png;base64,${PNG_B64}")}`));
  assert.ok(html.includes(`@media (prefers-color-scheme: dark) {\na{color:#fff;background:url("data:image/png;base64,${PNG_B64}")}\n}`));
  assert.ok(html.includes(`.logo{background:url("data:image/png;base64,${PNG_B64}")}`));
  assert.ok(html.includes(".miss{background:url(../img/none.png)}"));
  assert.ok(html.includes("circular @import skipped"));
  assert.deepEqual(res.styles, [{ file: "css/site.css", inline: false, index: 0 }]);
  const missing = res.diagnostics.filter((d) => d.code === "preview/missing-file");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].file, "css/site.css");
  assert.equal(slice(files.readText("css/site.css"), missing[0]), "../img/none.png");
  assert.ok(res.diagnostics.some((d) => d.code === "preview/css-cycle" && d.file === "css/base.css"));
});

test("@import depth is limited to 5 levels", () => {
  const f = { "index.html": '<link rel="stylesheet" href="a0.css">' };
  for (let i = 0; i < 8; i++) f[`a${i}.css`] = `/* ${i} */\n@import "a${i + 1}.css";`;
  f["a8.css"] = "/* end */";
  const res = buildPreview(makeFiles(f), "index.html");
  assert.ok(res.html.includes("/* 5 */"));
  assert.ok(!res.html.includes("/* 6 */"));
  assert.ok(res.diagnostics.some((d) => d.code === "preview/css-import-depth"));
});

test("inline <style> blocks are numbered and their url() references are rewritten", () => {
  const files = makeFiles({
    "pages/a.html": "<style>a{background:url(../x.png)}</style><body><style>b{color:red}</style></body>",
    "x.png": PNG,
  });
  const res = buildPreview(files, "pages/a.html");
  assert.ok(res.html.includes(`<style data-of="0" data-of-file="pages/a.html" data-of-inline="0">a{background:url("data:image/png;base64,${PNG_B64}")}</style>`));
  assert.match(res.html, /<style data-of="2" data-of-file="pages\/a\.html" data-of-inline="1">b\{color:red\}<\/style>/);
  assert.deepEqual(res.styles, [{ file: "pages/a.html", inline: true, index: 0 }, { file: "pages/a.html", inline: true, index: 1 }]);
});

test("project assets become asset URLs; missing files give warnings with exact offsets", () => {
  const src = '<img src="img/a.png" alt=""><img srcset="img/a.png 1x, img/b.png 2x, https://x.test/c.png 3x" alt=""><video poster="img/a.png"></video><link rel="icon" href="favicon.png"><div style="background: url(&quot;img/a.png&quot;)"></div><img src="img/missing.png" alt=""><source src="a/../img/a.png?v=1#frag"><a href="img/a.png">kept</a><form action="send.html"></form><input type="image" src="img/a.png">';
  const files = makeFiles({ "index.html": src, "img/a.png": PNG, "img/b.png": PNG, "favicon.png": PNG });
  const made = [];
  const res = buildPreview(files, "index.html", { makeAssetUrl: (p, bytes, mime) => (made.push([p, bytes.length, mime]), `blob:test/${p}`) });
  const h = res.html;
  assert.ok(h.includes('src="blob:test/img/a.png"'));
  assert.ok(h.includes('srcset="blob:test/img/a.png 1x, blob:test/img/b.png 2x, https://x.test/c.png 3x"'));
  assert.ok(h.includes('poster="blob:test/img/a.png"'));
  assert.ok(h.includes('href="blob:test/favicon.png"'));
  assert.ok(h.includes("style=\"background: url('blob:test/img/a.png')\""));
  assert.ok(h.includes('<source data-of="6" src="blob:test/img/a.png#frag">'));
  assert.ok(h.includes('<a data-of="7" href="img/a.png">kept</a>'));
  assert.ok(h.includes('action="send.html"'));
  assert.ok(h.includes('<input data-of="9" type="image" src="blob:test/img/a.png">'));
  // asset URLs are created once per file
  assert.equal(made.filter((m) => m[0] === "img/a.png").length, 1);
  assert.deepEqual(made.find((m) => m[0] === "img/a.png"), ["img/a.png", PNG.length, "image/png"]);
  const miss = res.diagnostics.filter((d) => d.code === "preview/missing-file");
  assert.equal(miss.length, 1);
  assert.equal(miss[0].severity, "warning");
  assert.equal(miss[0].file, "index.html");
  assert.equal(slice(src, miss[0]), "img/missing.png");
  // default: base64 data URLs
  const def = buildPreview(files, "index.html");
  assert.ok(def.html.includes(`src="data:image/png;base64,${PNG_B64}"`));
});

test("no <base> and no import map are emitted", () => {
  const files = makeFiles({
    "index.html": '<!doctype html><html><head><title>t</title></head><body><script type="module" src="js/main.js"></script></body></html>',
    "js/main.js": 'import { a } from "./util.js"; console.log(a);',
    "js/util.js": "export const a = 1;",
  });
  const res = buildPreview(files, "index.html", { makeScriptUrl: (code, info) => `blob:s/${info.file}` });
  assert.ok(!/<base\b/i.test(res.html));
  assert.ok(!/importmap/i.test(res.html));
  assert.ok(!res.html.includes("openfini-preview.invalid"));
  assert.equal(buildPreview(files, "index.html").diagnostics.length, 0);
});

test("scripts go through makeScriptUrl: local, inline classic, inline module, and the bridge", () => {
  const src = '<!doctype html><html><head><meta charset="utf-8"><script src="js/a.js" defer></script><script>var inlineClassic = 1;</script></head><body><script type="module">console.log("m")</script><script type="application/ld+json">{"a":1}</script><script src="https://x.test/e.js"></script><script src="js/none.js"></script></body></html>';
  const files = makeFiles({ "index.html": src, "js/a.js": "var fromFile = 1;" });
  const calls = [];
  const res = buildPreview(files, "index.html", {
    bridge: "/* bridge */ window.bridge = true;",
    config: { mode: "edit", tricky: "</script><!--" },
    makeScriptUrl: (code, info) => {
      calls.push({ code, info });
      return info.file === "openfini-bridge.js" ? "data:bridge" : info.file === "js/a.js" ? "data:a" : info.module ? "data:module" : "data:inline";
    },
  });
  const h = res.html;
  assert.equal(calls.length, 4);
  const bridgeCall = calls.find((c) => c.info.file === "openfini-bridge.js");
  assert.deepEqual(bridgeCall.info, { file: "openfini-bridge.js", module: false, inline: true });
  assert.match(bridgeCall.code, /^window\.__OF_CONFIG__=\{"mode":"edit","tricky":"\\u003c\/script>\\u003c!--"\};\n\/\* bridge \*\/ window\.bridge = true;$/);
  assert.deepEqual(calls.find((c) => c.info.file === "js/a.js"), { code: "var fromFile = 1;", info: { file: "js/a.js", module: false, inline: false } });
  assert.deepEqual(calls.find((c) => c.code === "var inlineClassic = 1;"), { code: "var inlineClassic = 1;", info: { file: "index.html", module: false, inline: true } });
  assert.deepEqual(calls.find((c) => c.info.module), { code: 'console.log("m")', info: { file: "index.html", module: true, inline: true } });
  // the bridge is the first script of <head>
  const headStart = h.indexOf("<head");
  assert.ok(h.indexOf('<script src="data:bridge"></script>') === h.indexOf("<script", headStart));
  assert.ok(h.indexOf('<script src="data:bridge"></script>') < h.indexOf("<meta"));
  assert.ok(h.includes('<script data-of="3" src="data:a" defer></script>'));
  // inline classic: content moved into the URL, defer/async dropped
  assert.ok(h.includes('<script data-of="4" src="data:inline"></script>'));
  assert.ok(h.includes('<script data-of="6" src="data:module" type="module"></script>'));
  assert.ok(h.includes('<script data-of="7" type="application/ld+json">{"a":1}</script>'));
  assert.ok(h.includes('<script data-of="8" src="https://x.test/e.js"></script>'));
  assert.ok(!h.includes("var inlineClassic"));
  assert.ok(res.diagnostics.some((d) => d.code === "preview/missing-file" && slice(src, d) === "js/none.js"));
});

test("without makeScriptUrl scripts are inlined", () => {
  const src = '<html><head></head><body><script src="a.js" async></script><script type="module" src="m.js"></script><script>inline()</script></body></html>';
  const files = makeFiles({ "index.html": src, "a.js": "var a = '</script>';", "m.js": "import './dep.js';\nexport const m = 1;", "dep.js": "export const d = 1;" });
  const res = buildPreview(files, "index.html", { bridge: "var bridge = 1;" });
  const h = res.html;
  assert.ok(h.includes('<script>var bridge = 1;</script>'));
  assert.ok(h.includes("<script data-of=\"3\" async>var a = '<\\/script>';</script>"));
  assert.match(h, /<script data-of="4" type="module">import 'data:text\/javascript;charset=utf-8,export%20const%20d%20%3D%201%3B';\nexport const m = 1;<\/script>/);
  assert.ok(h.includes('<script data-of="5">inline()</script>'));
  assert.ok(h.indexOf("var bridge") < h.indexOf("var a ="));
});

test("module graph: specifiers are rewritten to dependency URLs, dependencies first", () => {
  const files = makeFiles({
    "index.html": '<script type="module" src="js/main.js"></script>',
    "js/main.js": [
      'import def, { a } from "./lib/util.js";',
      "import * as ns from '../shared.js';",
      'import "./side.js";',
      'export { x } from "./lib/util.js";',
      'import bare from "lodash";',
      'import abs from "https://cdn.test/x.js";',
      '// import "./commented.js";',
      '/* import "./block.js"; */',
      'const s = "import \'./string.js\'";',
      "const t = `template ${ 1 + 1 } import './tpl.js'`;",
      'const lazy = () => import("./lazy.js");',
      "const re = /import 'x'/;",
      "export default 1;",
    ].join("\n"),
    "js/lib/util.js": 'import { deep } from "./deep.js";\nexport const a = deep; export const x = 1;',
    "js/lib/deep.js": "export const deep = 'deep';",
    "shared.js": "export const shared = 1;",
    "js/side.js": "console.log('side');",
    "js/lazy.js": "export default 'lazy';",
  });
  const calls = [];
  const res = buildPreview(files, "index.html", {
    makeScriptUrl: (code, info) => {
      calls.push(info.file);
      return `blob:m/${info.file}`;
    },
  });
  assert.deepEqual(res.diagnostics, []);
  // dependencies are created before the modules that import them
  assert.ok(calls.indexOf("js/lib/deep.js") < calls.indexOf("js/lib/util.js"));
  assert.ok(calls.indexOf("js/lib/util.js") < calls.indexOf("js/main.js"));
  assert.ok(calls.indexOf("shared.js") < calls.indexOf("js/main.js"));
  assert.equal(calls.length, new Set(calls).size, "every module is created once");
  const codes = {};
  buildPreview(files, "index.html", { makeScriptUrl: (code, info) => ((codes[info.file] = code), `blob:m/${info.file}`) });
  assert.match(codes["js/main.js"], /^import def, \{ a \} from "blob:m\/js\/lib\/util\.js";$/m);
  assert.match(codes["js/main.js"], /^import \* as ns from 'blob:m\/shared\.js';$/m);
  assert.match(codes["js/main.js"], /^import "blob:m\/js\/side\.js";$/m);
  assert.match(codes["js/main.js"], /^export \{ x \} from "blob:m\/js\/lib\/util\.js";$/m);
  assert.match(codes["js/main.js"], /import\("blob:m\/js\/lazy\.js"\)/);
  assert.ok(codes["js/main.js"].includes('import bare from "lodash";'));
  assert.ok(codes["js/main.js"].includes('import abs from "https://cdn.test/x.js";'));
  assert.ok(codes["js/main.js"].includes('// import "./commented.js";'));
  assert.ok(codes["js/main.js"].includes('/* import "./block.js"; */'));
  assert.ok(codes["js/main.js"].includes("import './string.js'"));
  assert.ok(codes["js/main.js"].includes("import './tpl.js'"));
  assert.ok(codes["js/main.js"].includes("/import 'x'/"));
  assert.match(codes["js/lib/util.js"], /from "blob:m\/js\/lib\/deep\.js"/);
  assert.ok(res.html.includes('src="blob:m/js/main.js"'));
});

test("module cycles keep the specifier and report preview/module-cycle; missing modules report missing-file", () => {
  const files = makeFiles({
    "index.html": '<script type="module" src="a.js"></script>',
    "a.js": 'import "./b.js";\nimport "./gone.js";\nexport const a = 1;',
    "b.js": 'import { a } from "./a.js";\nexport const b = a;',
  });
  const codes = {};
  const res = buildPreview(files, "index.html", { makeScriptUrl: (code, info) => ((codes[info.file] = code), `blob:${info.file}`) });
  assert.ok(codes["b.js"].includes('from "./a.js"'), "specifier of the cycle edge is unchanged");
  assert.ok(codes["a.js"].includes('import "blob:b.js"'));
  const cycle = res.diagnostics.filter((d) => d.code === "preview/module-cycle");
  assert.equal(cycle.length, 1);
  assert.equal(cycle[0].severity, "warning");
  assert.equal(cycle[0].file, "b.js");
  assert.equal(slice(files.readText("b.js"), cycle[0]), "./a.js");
  const miss = res.diagnostics.filter((d) => d.code === "preview/missing-file");
  assert.equal(miss.length, 1);
  assert.equal(miss[0].file, "a.js");
  assert.equal(slice(files.readText("a.js"), miss[0]), "./gone.js");
  // a self import is a cycle too
  const self = makeFiles({ "index.html": '<script type="module" src="s.js"></script>', "s.js": 'import "./s.js";' });
  assert.ok(buildPreview(self, "index.html", { makeScriptUrl: () => "blob:x" }).diagnostics.some((d) => d.code === "preview/module-cycle"));
});

test("inline event handlers are replaced by one generated script before </body>", () => {
  const src = '<!doctype html><html><head></head><body><button id="b" onclick="count++; return false" class="x">Go</button><form onsubmit="return check(event)"><input oninput="v = this.value"></form><a href="javascript:void(0)" onmouseover=\'say("&quot;hi&quot;")\'>l</a><div data-online="1" one="2">no handler</div></body></html>';
  const files = makeFiles({ "index.html": src });
  const calls = [];
  const res = buildPreview(files, "index.html", { makeScriptUrl: (code, info) => (calls.push({ code, info }), "blob:handlers") });
  const h = res.html;
  assert.ok(!/\son(click|submit|input|mouseover)=/.test(h));
  assert.ok(h.includes('<button data-of="3" id="b" class="x">Go</button>'));
  assert.ok(h.includes('href="javascript:void(0)"'));
  assert.ok(h.includes('data-online="1" one="2"'));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].info, { file: "index.html", module: false, inline: true });
  assert.ok(calls[0].code.includes(`(function(){var e=document.querySelector('[data-of="3"]');if(e)e.onclick=function(event){count++; return false\n};})();`));
  assert.ok(calls[0].code.includes(`querySelector('[data-of="4"]');if(e)e.onsubmit=function(event){return check(event)\n};`));
  assert.ok(calls[0].code.includes(`e.oninput=function(event){v = this.value\n};`));
  assert.ok(calls[0].code.includes(`e.onmouseover=function(event){say("\\"hi\\"")`.replace('\\"hi\\"', '"hi"')));
  assert.ok(h.includes('<script src="blob:handlers"></script></body>'));
  // data-of ids point at the right elements
  const out = parseHtml(h);
  assert.equal(getAttr(out.elements.find((e) => e.tag === "form"), "data-of"), "4");
  // inline when no makeScriptUrl; annotate:false keeps the attributes
  const inline = buildPreview(files, "index.html");
  assert.match(inline.html, /<script>\(function\(\)\{var e=document\.querySelector\('\[data-of="3"\]'\);if\(e\)e\.onclick=function\(event\)\{count\+\+; return false\n\};\}\)\(\);/);
  const plain = buildPreview(files, "index.html", { annotate: false });
  assert.equal(plain.html, src);
  // handlers script goes to the end of the document when there is no body
  const frag = buildPreview(makeFiles({ "index.html": '<p onclick="a()">x</p>' }), "index.html");
  assert.ok(frag.html.endsWith("</script></body>"));
  assert.ok(frag.html.includes('<p data-of="0">x</p><script>'));
});

test("document structure: head, doctype and fragments", () => {
  const bridge = "var b=1;";
  const full = buildPreview(makeFiles({ "index.html": "<html><body><p>x</p></body></html>" }), "index.html", { bridge }).html;
  assert.equal(full, '<!doctype html>\n<html data-of="0"><head><script>var b=1;</script></head><body data-of="1"><p data-of="2">x</p></body></html>');
  const noHtml = buildPreview(makeFiles({ "index.html": "<body><p>x</p></body>" }), "index.html", { bridge }).html;
  assert.equal(noHtml, '<!doctype html>\n<head><script>var b=1;</script></head><body data-of="0"><p data-of="1">x</p></body>');
  const frag = buildPreview(makeFiles({ "index.html": "<h1>Hi</h1>" }), "index.html", { bridge }).html;
  assert.equal(frag, '<!doctype html>\n<head><script>var b=1;</script></head><body><h1 data-of="0">Hi</h1></body>');
  const withHead = buildPreview(makeFiles({ "index.html": '<!DOCTYPE html><html><head lang=x><title>t</title></head></html>' }), "index.html", { bridge }).html;
  assert.equal(withHead, '<!DOCTYPE html><html data-of="0"><head data-of="1" lang=x><script>var b=1;</script><title data-of="2">t</title></head></html>');
  assert.equal(buildPreview(makeFiles({ "index.html": "<p>x</p>" }), "index.html", { annotate: false }).html, "<!doctype html>\n<head></head><body><p>x</p></body>");
  // missing entry still renders a page (with the bridge) and reports an error
  const missing = buildPreview(makeFiles({ "a.html": "x" }), "index.html", { bridge });
  assert.ok(missing.html.includes("File not found") && missing.html.includes("var b=1;"));
  assert.equal(missing.diagnostics[0].code, "preview/missing-entry");
  assert.equal(missing.diagnostics[0].severity, "error");
  assert.deepEqual(missing.pages, ["a.html"]);
});

test("hotCss returns the rewritten stylesheet", () => {
  const files = makeFiles({ "css/a.css": '@import "b.css";\n.a{background:url(../x.png)}', "css/b.css": ".b{c:d}", "x.png": PNG });
  const css = hotCss(files, "css/a.css", { makeAssetUrl: (p) => `blob:${p}` });
  assert.equal(css, '.b{c:d}\n.a{background:url("blob:x.png")}');
  assert.equal(hotCss(files, "nope.css"), "");
});

test("scanModuleSpecifiers", () => {
  const code = 'import a from "./a.js";import{b}from\'./b.js\';import * as c from "c";export*from"./d.js";export {e} from \'./e.js\';import "./f.js";\nconst g = await import("./g.js");const h = import(\n  "./h.js", { with: {} });obj.import("./no.js");const dyn = import(name);x.from("./no2.js");const q = {from: "./no3.js"};';
  const got = scanModuleSpecifiers(code).map((s) => s.specifier);
  assert.deepEqual(got, ["./a.js", "./b.js", "c", "./d.js", "./e.js", "./f.js", "./g.js", "./h.js"]);
  for (const s of scanModuleSpecifiers(code)) assert.equal(code.slice(s.start, s.end), s.specifier);
  assert.equal(scanModuleSpecifiers(code).filter((s) => s.dynamic).length, 2);
  assert.deepEqual(scanModuleSpecifiers("a = b / c; d = 'x' / 2; import './z.js'; e = /[/]'/.test(f)").map((s) => s.specifier), ["./z.js"]);
  assert.deepEqual(scanModuleSpecifiers("const s = `a ${ `b ${ import('./n.js') }` } c`;").map((s) => s.specifier), ["./n.js"]);
  assert.deepEqual(scanModuleSpecifiers('import "unterminated'), []);
  assert.deepEqual(scanModuleSpecifiers(""), []);
});
