import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "../../app/vendor/fflate/fflate.js";
import { sanitizeFileName, applyTemplate, buildJobs, renameNames, renamePlan, applyCase, zipStore, crc32, runExport, runRename, DEFAULT_TEMPLATE } from "../../extensions/batch-export/src/lib.js";
import { mockApi } from "./_mock.js";

test("file names are sanitized", () => {
  assert.equal(sanitizeFileName('a/b:c*"d'), "a-b-c-d");
  assert.equal(sanitizeFileName("  .hidden. "), "hidden");
  assert.equal(sanitizeFileName(""), "untitled");
  assert.ok(sanitizeFileName("x".repeat(500)).length <= 100);
});

test("templates replace known tokens and keep unknown ones", () => {
  assert.equal(applyTemplate(DEFAULT_TEMPLATE, { name: "Logo", scale: "2" }), "Logo@2x");
  assert.equal(applyTemplate("{index}-{name}-{foo}", { name: "A", index: 3 }), "3-A-{foo}");
  assert.equal(applyTemplate("", { name: "N", scale: 1 }), "N@1x");
});

test("buildJobs expands targets x scales x formats with unique names; SVG is exported once", () => {
  const jobs = buildJobs([{ id: "a", name: "Icon" }, { id: "b", name: "Icon" }], { scales: [1, 2], formats: ["png", "svg"], template: "{name}@{scale}x" });
  assert.deepEqual(jobs.map((j) => j.file), ["Icon@1x.png", "Icon@2x.png", "Icon@1x.svg", "Icon@1x-2.png", "Icon@2x-2.png", "Icon@1x-2.svg"]);
  assert.equal(jobs.filter((j) => j.format === "svg").length, 2);
  const folders = buildJobs([{ id: "a", name: "A" }], { scales: [1], formats: ["png", "webp"], folder: true });
  assert.deepEqual(folders.map((j) => j.file), ["png/A@1x.png", "webp/A@1x.webp"]);
  assert.equal(buildJobs([{ page: 0, name: "Home" }], { scales: [1.5], formats: ["jpg"] })[0].file, "Home@1.5x.jpg");
});

test("renameNames: find/replace, regex, case, prefix/suffix and numbering", () => {
  assert.deepEqual(renameNames(["Rectangle 1", "Rectangle 2"], { find: "rectangle", replace: "Card" }), ["Card 1", "Card 2"]);
  assert.deepEqual(renameNames(["a1", "b22"], { find: "\\d+", replace: "#", regex: true }), ["a#", "b#"]);
  assert.deepEqual(renameNames(["Rect"], { find: "rect", replace: "X", caseSensitive: true }), ["Rect"]);
  assert.deepEqual(renameNames(["x", "y"], { prefix: "btn-", suffix: "-on" }), ["btn-x-on", "btn-y-on"]);
  assert.deepEqual(renameNames(["x", "y", "z"], { number: true, start: 8, pad: 2 }), ["x 08", "y 09", "z 10"]);
  assert.deepEqual(renameNames(["x", "y"], { number: true, numberPosition: "prefix", separator: "_", pad: 1 }), ["1_x", "2_y"]);
  assert.deepEqual(renameNames(["a"], { find: "(", regex: true, replace: "" }), ["a"]); // invalid regex is ignored, not thrown
  assert.equal(applyCase("Hero Image Large", "kebab"), "hero-image-large");
  assert.equal(applyCase("heroImage", "snake"), "hero_image");
  assert.equal(applyCase("hello world", "title"), "Hello World");
});

test("renamePlan marks which layers change", () => {
  const plan = renamePlan([{ id: "1", name: "a" }, { id: "2", name: "b" }], { find: "a", replace: "z" });
  assert.deepEqual(plan.map((p) => p.changed), [true, false]);
});

test("zipStore produces a valid ZIP that fflate reads back", () => {
  const files = { "a.txt": new TextEncoder().encode("hello"), "dir/b.bin": new Uint8Array([0, 1, 2, 255]) };
  const out = unzipSync(zipStore(files));
  assert.deepEqual(Object.keys(out).sort(), ["a.txt", "dir/b.bin"]);
  assert.equal(new TextDecoder().decode(out["a.txt"]), "hello");
  assert.deepEqual([...out["dir/b.bin"]], [0, 1, 2, 255]);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("runExport exports every selected layer in every size and saves one ZIP", async () => {
  const api = mockApi({ selection: [{ id: "L1", name: "Logo", type: "group" }, { id: "L2", name: "Hero", type: "rect" }] });
  const res = await runExport(api, { source: "selection", scales: [1, 2], formats: ["png"], template: DEFAULT_TEMPLATE, zip: true });
  assert.equal(res.saved, true);
  assert.deepEqual(api.calls.filter((c) => c[0] === "export").map((c) => c[1]), [
    { format: "png", scale: 1, ids: ["L1"] }, { format: "png", scale: 2, ids: ["L1"] }, { format: "png", scale: 1, ids: ["L2"] }, { format: "png", scale: 2, ids: ["L2"] },
  ]);
  assert.equal(api.saved.length, 1);
  assert.match(api.saved[0].name, /\.zip$/);
  assert.deepEqual(Object.keys(unzipSync(api.saved[0].data)), ["Logo@1x.png", "Logo@2x.png", "Hero@1x.png", "Hero@2x.png"]);
});

test("runExport: one file is saved directly, pages are exported by index, nothing selected returns empty", async () => {
  const api = mockApi({ selection: [{ id: "L1", name: "Solo" }] });
  const one = await runExport(api, { source: "selection", scales: [2], formats: ["webp"], template: "{name}" });
  assert.equal(api.saved[0].name, "Solo.webp");
  assert.equal(one.files.length, 1);
  const pages = mockApi({ pages: [{ name: "Home", active: false }, { name: "About", active: true }] });
  await runExport(pages, { source: "pages", scales: [1], formats: ["png"], template: "{name}", zip: true });
  assert.deepEqual(pages.calls.filter((c) => c[0] === "export").map((c) => c[1].page), [0, 1]);
  const none = await runExport(mockApi({ selection: [] }), { source: "selection", scales: [1], formats: ["png"], template: "{name}" });
  assert.equal(none.empty, true);
});

test("runRename calls set_style only for layers whose name changes", async () => {
  const api = mockApi({ selection: [{ id: "1", name: "Rect 1" }, { id: "2", name: "Other" }] });
  await runRename(api, { find: "Rect", replace: "Card" });
  assert.deepEqual(api.calls, [["set_style", { ids: ["1"], name: "Card 1" }]]);
  const dry = mockApi({ selection: [{ id: "1", name: "a" }] });
  await runRename(dry, { prefix: "x" }, { apply: false });
  assert.equal(dry.calls.length, 0);
});
