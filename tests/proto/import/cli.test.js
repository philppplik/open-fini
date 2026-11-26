// `ofini proto import` (cli/lib/proto-import.mjs, task T8): new designs from HTML, SVG, Sketch and Penpot, imports
// into an existing design, JSON output and exit codes. In-process through main().
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "../../../app/vendor/fflate/fflate.js";
import { loadModel } from "../../../app/src/engine/proto/format.js";
import { validate } from "../../../app/src/engine/proto/validate.js";
import { main } from "../../../cli/lib/main.mjs";
import { sketchFixture, penpotFixture } from "./fixtures.js";

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "ofini-proto-import-"));
  writeFileSync(join(dir, "page.html"), `<!doctype html><title>Demo</title><style>.row{display:flex;gap:8px;padding:12px;background:#eef}</style><div class="row"><b>One</b><i>Two</i></div><script>alert(1)</script>`);
  writeFileSync(join(dir, "icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" rx="4" fill="#4f46e5"/></svg>`);
  writeFileSync(join(dir, "kit.sketch"), sketchFixture());
  writeFileSync(join(dir, "login.penpot"), penpotFixture());
  writeFileSync(join(dir, "design.fig"), "fig-kiwi");
});
after(() => rmSync(dir, { recursive: true, force: true }));

function sink() {
  const chunks = [];
  return { isTTY: false, write: (s) => (chunks.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8")), true), text: () => chunks.join("") };
}
async function run(...argv) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { stdout, stderr, env: {}, cwd: dir, tmpdir: dir });
  return { code, out: stdout.text(), err: stderr.text() };
}
const modelOf = (file) => loadModel(JSON.parse(strFromU8(unzipSync(readFileSync(join(dir, file)))["document.json"])).office).model;

test("ofini proto import: HTML, SVG, Sketch and Penpot become valid designs", async () => {
  let r = await run("proto", "import", "page.html");
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(dir, "page.ofini")));
  let m = modelOf("page.ofini");
  assert.deepEqual(validate(m).errors, []);
  assert.ok(Object.values(m.nodes).some((n) => n.name === "Row" && n.layout?.type === "flex" && n.layout.gap === 8));
  assert.match(r.out, /not imported/);
  r = await run("proto", "import", "kit.sketch", "-o", "kit.ofini", "--json");
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.format, "Sketch");
  assert.equal(j.pages, 2);
  m = modelOf("kit.ofini");
  assert.equal(Object.keys(m.pages).length, 2);
  assert.ok(Object.values(m.nodes).some((n) => n.type === "component"));
  r = await run("proto", "import", "login.penpot", "-o", "login.ofini");
  assert.equal(r.code, 0, r.err);
  assert.ok(Object.values(modelOf("login.ofini").nodes).some((n) => n.type === "instance"));
  // an existing file is not replaced without --force
  r = await run("proto", "import", "page.html");
  assert.notEqual(r.code, 0);
});

test("ofini proto import --into adds to a design; unsupported formats exit 4", async () => {
  let r = await run("proto", "import", "page.html", "-o", "base.ofini", "--force");
  assert.equal(r.code, 0, r.err);
  const before = Object.keys(modelOf("base.ofini").nodes).length;
  r = await run("proto", "import", "icon.svg", "--into", "base.ofini", "--in-place");
  assert.equal(r.code, 0, r.err);
  const m = modelOf("base.ofini");
  assert.equal(Object.keys(m.nodes).length, before + 2);
  assert.ok(Object.values(m.nodes).some((n) => n.type === "rect" && n.radius === 4));
  r = await run("proto", "import", "icon.svg", "--into", "base.ofini");
  assert.equal(r.code, 2, "--into needs --out, --in-place or --dry-run");
  r = await run("proto", "import", "design.fig");
  assert.equal(r.code, 4);
  assert.match(r.err, /no public specification/);
});
