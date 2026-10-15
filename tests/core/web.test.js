import { test } from "node:test";
import assert from "node:assert/strict";
import { WebProject, ensureWeb } from "../../app/src/core/web.js";

const sample = () =>
  WebProject.fromFiles({
    "index.html": "<!doctype html><title>Home</title>",
    "css/style.css": "body{margin:0}",
    "js/main.js": "console.log(1)",
    "assets/logo.png": new Uint8Array([137, 80, 78, 71]),
  });

test("files: text and binary storage, lookups and pages", () => {
  const w = sample();
  assert.equal(w.files.size, 4);
  assert.equal(w.text("index.html"), "<!doctype html><title>Home</title>");
  assert.equal(w.isText("assets/logo.png"), false);
  assert.deepEqual([...w.bytes("assets/logo.png")], [137, 80, 78, 71]);
  assert.ok(w.bytes("css/style.css") instanceof Uint8Array);
  assert.deepEqual(w.pages(), ["index.html"]);
  assert.equal(w.source.readText("js/main.js"), "console.log(1)");
  assert.equal(w.source.readText("assets/logo.png"), null);
  assert.deepEqual(w.source.list().sort(), [...w.files.keys()].sort());
});

test("setText bumps the revision and notifies once, ignores identical text", () => {
  const w = sample();
  const events = [];
  w.on("text", (e) => events.push(e));
  const rev = w.rev;
  assert.equal(w.setText("css/style.css", "body{margin:1px}", "editor"), true);
  assert.equal(w.setText("css/style.css", "body{margin:1px}", "editor"), false);
  assert.equal(w.rev, rev + 1);
  assert.deepEqual(events, [{ path: "css/style.css", origin: "editor" }]);
  assert.throws(() => w.setText("assets/logo.png", "x"), /not a text file/);
});

test("create validates paths and starter content", () => {
  const w = sample();
  const f = w.create("about.html");
  assert.match(f.text, /<!doctype html>/);
  assert.match(f.text, /<title>About<\/title>/);
  assert.throws(() => w.create("about.html"), /already exists/);
  assert.throws(() => w.create("css"), /already exists/);
  assert.throws(() => w.create("index.html/x.html"), /inside a file/);
  assert.equal(w.create("../../etc/evil.css").path, "etc/evil.css");
  assert.equal(w.createUnique("about.html").path, "about-2.html");
  assert.equal(w.create("data.json").text, "{}\n");
});

test("rename and move: files, folders, entry page, collisions", () => {
  const w = sample();
  w.create("css/extra.css", "a{}");
  const pairs = w.rename("css", "styles");
  assert.deepEqual(pairs.map((p) => p[1]).sort(), ["styles/extra.css", "styles/style.css"]);
  assert.equal(w.has("css/style.css"), false);
  assert.equal(w.text("styles/style.css"), "body{margin:0}");
  w.rename("index.html", "home.html");
  assert.equal(w.entry, "home.html");
  assert.throws(() => w.rename("home.html", "js/main.js"), /already exists/);
  assert.throws(() => w.rename("styles", "styles/inner"), /into itself/);
  assert.throws(() => w.rename("missing.txt", "x.txt"), /does not exist/);
  assert.deepEqual(w.rename("home.html", "home.html"), []);
});

test("remove deletes folders, fixes the entry and reports the paths", () => {
  const w = sample();
  w.create("about.html");
  const gone = w.remove("css");
  assert.deepEqual(gone, ["css/style.css"]);
  w.remove("index.html");
  assert.equal(w.entry, "about.html");
  assert.deepEqual(w.remove("nothing"), []);
});

test("duplicate picks a free name next to the file", () => {
  const w = sample();
  const d = w.duplicate("css/style.css");
  assert.equal(d.path, "css/style-copy.css");
  assert.equal(w.duplicate("css/style.css").path, "css/style-copy-2.css");
  assert.equal(w.text(d.path), "body{margin:0}");
});

test("put replaces text and binary files and creates missing ones", () => {
  const w = sample();
  const enc = new TextEncoder();
  w.put("js/main.js", enc.encode("console.log(2)"));
  assert.equal(w.text("js/main.js"), "console.log(2)");
  w.put("assets/logo.png", new Uint8Array([1, 2, 3]));
  assert.deepEqual([...w.bytes("assets/logo.png")], [1, 2, 3]);
  w.put("assets/new.svg", enc.encode("<svg/>"));
  assert.equal(w.isText("assets/new.svg"), true);
  w.put("assets/photo.jpg", new Uint8Array([255, 216]));
  assert.equal(w.isText("assets/photo.jpg"), false);
});

test("tree lists folders first and sorts naturally", () => {
  const w = sample();
  w.create("css/z10.css", "");
  w.create("css/z2.css", "");
  const t = w.tree();
  assert.deepEqual(t.map((n) => n.name), ["assets", "css", "js", "index.html"]);
  const css = t.find((n) => n.name === "css");
  assert.deepEqual(css.children.map((n) => n.name), ["style.css", "z2.css", "z10.css"]);
});

test("manifest and archive entries round-trip", () => {
  const w = sample();
  w.settings.view = "design";
  w.settings.openFiles = ["index.html", "gone.html"];
  w.settings.activeFile = "index.html";
  const manifest = JSON.parse(JSON.stringify(w.manifest()));
  assert.deepEqual(manifest.settings.openFiles, ["index.html"]);
  const entries = w.entries();
  const back = WebProject.fromManifest(manifest, (p) => entries[`web/files/${p}`]);
  assert.equal(back.entry, "index.html");
  assert.equal(back.settings.view, "design");
  assert.equal(back.text("css/style.css"), "body{margin:0}");
  assert.deepEqual([...back.bytes("assets/logo.png")], [137, 80, 78, 71]);
  assert.equal(back.isText("assets/logo.png"), false);
});

test("ensureWeb wires the dirty flag to the document", async () => {
  const doc = { saved: true, modifiedAt: 0, events: [], emit(t, p) { this.events.push([t, p]); } };
  const web = ensureWeb(doc, { "index.html": "<p>hi</p>" });
  assert.equal(doc.web, web);
  web.setText("index.html", "<p>bye</p>");
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(doc.saved, false);
  assert.ok(doc.modifiedAt > 0);
  assert.deepEqual(doc.events.at(-1), ["change", { web: true }]);
});
