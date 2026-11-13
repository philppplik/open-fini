// The `ofini` command line tool (cli/, docs/cli.md): every command run in-process through main() against real files
// in a temporary folder, with exit codes, JSON output and the helpers (arguments, globbing, completion).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "../../app/vendor/fflate/fflate.js";
import { main, COMMANDS, EXIT_CODES } from "../../cli/lib/main.mjs";
import { parseArgs, splitWords, parsePages, UsageError } from "../../cli/lib/args.mjs";
import { expandGlob } from "../../cli/lib/glob.mjs";
import { completionScript } from "../../cli/lib/completion.mjs";
import { complete } from "../../cli/lib/repl.mjs";
import { table, useColor } from "../../cli/lib/term.mjs";

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "ofini-cli-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

function sink(isTTY = false) {
  const chunks = [];
  return { isTTY, write: (s) => (chunks.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8")), true), text: () => chunks.join("") };
}
async function ofini(...argv) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { stdout, stderr, env: {}, cwd: dir, tmpdir: dir });
  return { code, out: stdout.text(), err: stderr.text() };
}
const json = (r) => JSON.parse(r.out);
const p = (name) => join(dir, name);

test("new creates a project of every kind that validates cleanly", async () => {
  for (const kind of ["vector", "pixel", "layout", "code", "document", "sheet", "slides", "board", "scene"]) {
    const r = await ofini("new", kind, `${kind}.ofini`);
    assert.equal(r.code, 0, r.err);
    const v = await ofini("validate", `${kind}.ofini`, "--json");
    assert.equal(v.code, 0, v.out);
    assert.equal(json(v).ok, true);
    assert.equal(json(v).counts.warning, 0, `${kind}: ${v.out}`);
  }
  const t = await ofini("new", "sheet", "budget", "--template", "budget");
  assert.equal(t.code, 0);
  assert.ok(existsSync(p("budget.ofini")), ".ofini is added to the name");
  assert.equal((await ofini("new", "sheet", "budget.ofini")).code, 3, "existing files need --force");
  assert.equal((await ofini("new", "sheet", "budget.ofini", "--force", "--template", "budget")).code, 0);
  assert.equal((await ofini("new", "nope", "x.ofini")).code, 2);
  assert.equal((await ofini("new", "sheet", "x.ofini", "--template", "nope")).code, 2);
  const list = await ofini("new", "--list", "--json");
  assert.ok(json(list).document.some((x) => x.id === "letter"));
  const lay = await ofini("new", "layout", "flyer.ofini", "--size", "a5", "--pages", "3");
  assert.equal(lay.code, 0);
  assert.equal(json(await ofini("info", "flyer.ofini", "--json")).info.pages.length, 3);
  assert.equal((await ofini("new", "vector", "bad.ofini", "--size", "0x10")).code, 2);
});

test("info and ls describe projects; --json is machine-readable", async () => {
  const r = await ofini("info", "code.ofini", "--json");
  assert.equal(r.code, 0);
  const i = json(r);
  assert.equal(i.info.kind, "website");
  assert.ok(i.info.websiteFiles > 0);
  const txt = await ofini("info", "budget.ofini", "--no-color");
  assert.match(txt.out, /kind\s+sheet/);
  assert.ok(!txt.out.includes("\x1b["), "no colors when not a terminal");
  const many = await ofini("info", "*.ofini", "--json");
  assert.ok(Array.isArray(json(many)) && json(many).length >= 9, "wildcards are expanded");
  const ls = await ofini("ls", "code.ofini", "--json");
  assert.equal(json(ls).entries[0].name, "mimetype");
  assert.ok(json(ls).entries.some((e) => e.name.startsWith("web/files/")));
  assert.equal((await ofini("info", "missing.ofini")).code, 3);
});

test("doctor reports, repairs a copy, repairs in place with a backup, and checks the environment", async () => {
  // break a project: unpack, damage document.json and add a stray file, pack again
  assert.equal((await ofini("unpack", "vector.ofini", "broken", "--pretty")).code, 0);
  const docPath = p("broken/document.json");
  const j = JSON.parse(readFileSync(docPath, "utf8"));
  j.pages[0].w = -1;
  j.pages[0].root.children.push({ id: "dup", type: "rect", m: [1, 0, 0, 1, 0, 0], w: 1, h: 1 }, { id: "dup", type: "image", assetId: "gone", m: [1, 0, 0, 1, 0, 0] });
  writeFileSync(docPath, JSON.stringify(j));
  mkdirSync(p("broken/assets"), { recursive: true });
  writeFileSync(p("broken/assets/stray.png"), "x");
  assert.equal((await ofini("pack", "broken", "broken.ofini")).code, 1, "pack reports the errors");

  const r = await ofini("doctor", "broken.ofini", "--json");
  assert.equal(r.code, 1);
  const codes = json(r).findings.map((f) => f.code);
  for (const c of ["page-size", "duplicate-id", "dangling-asset", "orphan-file"]) assert.ok(codes.includes(c), c);

  const safe = await ofini("doctor", "--fix", "broken.ofini");
  assert.equal(safe.code, 1, "the missing picture needs --fix=all");
  assert.ok(existsSync(p("broken.repaired.ofini")));
  assert.match(safe.out, /wrote broken\.repaired\.ofini/);

  const inPlace = await ofini("doctor", "--fix=all", "--in-place", "broken.ofini");
  assert.equal(inPlace.code, 0, inPlace.out + inPlace.err);
  assert.ok(existsSync(p("broken.ofini.bak")));
  assert.equal((await ofini("validate", "broken.ofini")).code, 0);
  assert.equal((await ofini("doctor", "--fix=all", "--in-place", "broken.ofini.bak", "--name", "x.ofini")).code, 0);
  assert.equal((await ofini("doctor", "--fix=all", "--in-place", "broken.ofini")).code, 0, "nothing left to repair");
  assert.equal((await ofini("doctor", "--fix=bogus", "broken.ofini")).code, 2);
  assert.equal((await ofini("doctor", "--in-place", "broken.ofini")).code, 2, "--in-place needs --fix");

  // a truncated file
  const full = readFileSync(p("code.ofini"));
  writeFileSync(p("cut.ofini"), full.subarray(0, full.length - 60));
  const cut = await ofini("doctor", "--fix", "cut.ofini", "--out", "cut-fixed.ofini");
  assert.match(cut.out, /container damaged/);
  assert.equal((await ofini("info", "cut-fixed.ofini")).code, 0);

  const env = await ofini("doctor", "--json");
  assert.equal(env.code, 0);
  assert.ok(json(env).environment.some((x) => x.code === "node"));
});

test("export and convert use the pure writers; raster output is refused with exit code 4", async () => {
  for (const [file, fmt] of [["budget.ofini", "xlsx"], ["budget.ofini", "csv"], ["budget.ofini", "ods"], ["document.ofini", "docx"], ["document.ofini", "md"], ["document.ofini", "pdf"], ["slides.ofini", "pptx"], ["board.ofini", "svg"], ["board.ofini", "excalidraw"], ["code.ofini", "zip"], ["vector.ofini", "json"], ["vector.ofini", "ofini"]]) {
    const r = await ofini("export", file, "-t", fmt, "-o", `out/${file}.${fmt}`);
    assert.equal(r.code, 0, `${file} -> ${fmt}: ${r.err}`);
    assert.ok(readFileSync(p(`out/${file}.${fmt}`)).length > 0);
  }
  const svg = await ofini("export", "flyer.ofini", "-t", "svg", "-o", "flyer.svg");
  assert.equal(svg.code, 0);
  assert.deepEqual(["flyer-1.svg", "flyer-2.svg", "flyer-3.svg"].map((f) => existsSync(p(f))), [true, true, true]);
  assert.match(readFileSync(p("flyer-1.svg"), "utf8"), /<svg /);
  const one = await ofini("export", "flyer.ofini", "-t", "svg", "--pages", "2", "-o", "-");
  assert.match(one.out, /^<\?xml/);
  const pdf = await ofini("export", "flyer.ofini", "-t", "pdf", "-o", "flyer.pdf");
  assert.equal(pdf.code, 0);
  assert.equal(readFileSync(p("flyer.pdf")).subarray(0, 5).toString(), "%PDF-");
  assert.equal((await ofini("export", "pixel.ofini", "-t", "png")).code, 4);
  assert.equal((await ofini("export", "scene.ofini", "-t", "mp4")).code, 4);
  assert.equal((await ofini("export", "flyer.ofini", "-t", "svg", "--pages", "9")).code, 2);
  assert.equal((await ofini("export", "flyer.ofini")).code, 2, "a format is required");

  // Office files in, other formats out
  assert.equal((await ofini("convert", "out/budget.ofini.xlsx", "budget-copy.ofini")).code, 0);
  assert.equal(json(await ofini("info", "budget-copy.ofini", "--json")).info.kind, "sheet");
  assert.equal((await ofini("convert", "out/document.ofini.docx", "doc.md")).code, 0);
  writeFileSync(p("notes.md"), "# Title\n\nSome *text*.\n");
  const md = await ofini("convert", "notes.md", "notes.html");
  assert.equal(md.code, 0, md.err);
  assert.match(readFileSync(p("notes.html"), "utf8"), /Title/);
  assert.equal((await ofini("convert", "notes.md", "notes.docx")).code, 0);
  writeFileSync(p("pic.psd"), "8BPS");
  assert.equal((await ofini("convert", "pic.psd", "pic.ofini")).code, 4);
  const formats = await ofini("formats", "budget.ofini", "--json");
  assert.ok(json(formats).formats.some((f) => f.id === "xlsx"));
});

test("extract writes assets, prints text and JSON; pack and unpack round-trip", async () => {
  const text = await ofini("extract", "budget.ofini", "--text");
  assert.match(text.out, /Monthly budget/);
  const js = await ofini("extract", "vector.ofini", "--json");
  assert.equal(JSON.parse(js.out).format, "openfini");
  const assets = await ofini("extract", "code.ofini", "--assets", "-o", "code-assets");
  assert.equal(assets.code, 0);
  assert.ok(readdirSync(p("code-assets/website")).includes("index.html"));
  assert.equal((await ofini("extract", "code.ofini")).code, 2, "one of --assets, --text, --json");

  assert.equal((await ofini("unpack", "code.ofini", "site")).code, 0);
  assert.equal((await ofini("unpack", "code.ofini", "site")).code, 3, "a non-empty folder needs --force");
  assert.equal((await ofini("pack", "site", "site.ofini")).code, 0);
  const a = unzipSync(readFileSync(p("code.ofini")));
  const b = unzipSync(readFileSync(p("site.ofini")));
  assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort());
  assert.equal(Object.keys(b)[0], "mimetype");
  assert.equal(strFromU8(b["web/files/index.html"]), strFromU8(a["web/files/index.html"]));
  assert.equal((await ofini("pack", "nowhere")).code, 3);
});

test("diff compares projects structurally", async () => {
  const same = await ofini("diff", "code.ofini", "site.ofini");
  assert.equal(same.code, 0, same.out);
  const d = await ofini("diff", "vector.ofini", "broken.ofini", "--json");
  assert.equal(d.code, 1);
  assert.ok(json(d).changes.some((c) => c.what === "rect layers"));
});

test("usage errors, help, version and completion", async () => {
  assert.equal((await ofini()).code, 2);
  const unk = await ofini("frobnicate");
  assert.equal(unk.code, 2);
  assert.match(unk.err, /Unknown command/);
  assert.equal((await ofini("info", "--bogus", "x")).code, 2);
  assert.equal((await ofini("info")).code, 2);
  const help = await ofini("help");
  assert.equal(help.code, 0);
  for (const name of Object.keys(COMMANDS)) assert.ok(help.out.includes(name), name);
  for (const [code] of EXIT_CODES) assert.ok(help.out.includes(String(code)));
  assert.match((await ofini("doctor", "--help")).out, /--in-place/);
  assert.match((await ofini("help", "doctor")).out, /prune-orphans/);
  assert.equal((await ofini("help", "nope")).code, 2);
  const v = await ofini("--version");
  assert.match(v.out, /^ofini \d+\.\d+\.\d+/);
  assert.equal(json(await ofini("version", "--json")).format >= 1, true);
  for (const sh of ["bash", "zsh", "fish", "powershell"]) {
    const r = await ofini("completion", sh);
    assert.equal(r.code, 0);
    assert.ok(r.out.includes("doctor") && r.out.includes("fix"), sh);
  }
  assert.equal((await ofini("completion", "tcsh")).code, 2);
  assert.ok(completionScript("bash", COMMANDS).includes("complete -o filenames -F _ofini ofini"));
});

test("argument parsing, page lists, word splitting, globbing, tables and colors", () => {
  const spec = { out: { type: "string", short: "o" }, force: { type: "bool", short: "f" }, fix: { type: "bool", optional: true } };
  assert.deepEqual(parseArgs(["a", "-fo", "x", "--fix=all", "--", "--b"], spec), { flags: { force: true, out: "x", fix: "all" }, args: ["a", "--b"] });
  assert.deepEqual(parseArgs(["--fix", "-", "--no-color"], spec).flags, { fix: true, "no-color": true, color: false });
  assert.throws(() => parseArgs(["--out"], spec), UsageError);
  assert.throws(() => parseArgs(["--force=1"], spec), UsageError);
  assert.deepEqual(parsePages("1,3-4", 5), [0, 2, 3]);
  assert.deepEqual(parsePages("4-", 5), [3, 4]);
  assert.deepEqual(parsePages("all", 2), [0, 1]);
  assert.throws(() => parsePages("x", 2), UsageError);
  assert.deepEqual(splitWords(`info "my file.ofini" a\\ b 'c d'`), ["info", "my file.ofini", "a b", "c d"]);
  assert.throws(() => splitWords(`info "x`), UsageError);
  assert.ok(expandGlob("*.ofini", dir).includes("vector.ofini"));
  assert.ok(expandGlob("**/index.html", dir).some((f) => f.replace(/\\/g, "/") === "site/web/files/index.html"));
  assert.deepEqual(expandGlob("plain.txt", dir), ["plain.txt"]);
  assert.equal(table(["A", "B"], [["x", 10], ["long", 2]], { align: ["l", "r"] }), "A      B\nx     10\nlong   2");
  assert.equal(useColor({ isTTY: true }, {}), true);
  assert.equal(useColor({ isTTY: true }, { NO_COLOR: "1" }), false);
  assert.equal(useColor({ isTTY: false }, { FORCE_COLOR: "1" }), true);
  assert.equal(useColor({ isTTY: true }, {}, false), false);
});

test("interactive mode completes commands, options, kinds and paths", () => {
  assert.deepEqual(complete("do", { commands: COMMANDS, cwd: dir })[0], ["doctor"]);
  assert.ok(complete("doctor --f", { commands: COMMANDS, cwd: dir })[0].includes("--fix"));
  assert.deepEqual(complete("new sh", { commands: COMMANDS, cwd: dir })[0], ["sheet"]);
  assert.deepEqual(complete("new sc", { commands: COMMANDS, cwd: dir })[0], ["scene"]);
  assert.ok(complete("info vec", { commands: COMMANDS, cwd: dir })[0].includes("vector.ofini"));
  assert.ok(complete("info si", { commands: COMMANDS, cwd: dir })[0].includes("site/"));
});

test("the bin entry runs in a separate Node process with exit codes", () => {
  const bin = fileURLToPath(new URL("../../cli/ofini.mjs", import.meta.url));
  const ok = spawnSync(process.execPath, [bin, "validate", "vector.ofini"], { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /ok\s+vector\.ofini/);
  const bad = spawnSync(process.execPath, [bin, "validate", "cut.ofini"], { cwd: dir, encoding: "utf8" });
  assert.equal(bad.status, 1);
  const none = spawnSync(process.execPath, [bin], { cwd: dir, encoding: "utf8", input: "" });
  assert.equal(none.status, 2, "no arguments without a terminal prints usage");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.bin.ofini, "cli/ofini.mjs");
});
