// Referenced Scene media (R7.1): the project stores a path, size and fingerprint instead of the bytes; files load
// back from the path, next to the project or from a folder; old files with embedded media load unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "../../app/vendor/fflate/fflate.js";
import { Doc } from "../../app/src/core/doc.js";
import { OfficeProject, relativeTo } from "../../app/src/core/office.js";
import { saveOfini, loadOfini } from "../../app/src/core/ofini.js";
import * as M from "../../app/src/scene/model.js";
import { fingerprint, candidatePaths, resolveMedia, matchFolder, joinPath, dirName, baseName, isOffline, mediaFolderName } from "../../app/src/scene/media-refs.js";

const bytesOf = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

async function sceneWithRef(path = "C:\\Footage\\clip.mp4", bytes = bytesOf(5000)) {
  let m = M.emptyScene({ fps: 25 });
  const r = M.addMedia(m, { id: "md1", kind: "video", mime: "video/mp4", name: "clip.mp4", duration: 4, w: 64, h: 36, hasAudio: false, bytes, path, size: bytes.length, hash: await fingerprint(bytes) });
  m = M.placeMedia(r.model, "md1", { start: 0 }).model;
  m = M.addMedia(m, { id: "md2", kind: "image", mime: "image/png", name: "logo.png", w: 8, h: 8, bytes: bytesOf(64, 9) }).model;
  return { model: m, bytes };
}

test("fingerprint: same bytes, same print; a change at either end changes it", async () => {
  const a = bytesOf(3 << 20);
  const p = await fingerprint(a);
  assert.match(p, /^fp1:[0-9a-f]{64}$/);
  assert.equal(await fingerprint(a.slice()), p);
  const tail = a.slice();
  tail[tail.length - 1] ^= 1;
  assert.notEqual(await fingerprint(tail), p);
  const head = a.slice();
  head[0] ^= 1;
  assert.notEqual(await fingerprint(head), p);
  assert.notEqual(await fingerprint(a.subarray(0, a.length - 1)), p, "the size is part of the print");
});

test("path helpers handle Windows and POSIX paths", () => {
  assert.equal(relativeTo("C:\\Projects\\Trailer", "C:\\Projects\\Footage\\a.mp4"), "../Footage/a.mp4");
  assert.equal(relativeTo("c:\\projects", "C:\\Projects\\f\\a.mp4"), "f/a.mp4", "drive letters and names ignore case on Windows");
  assert.equal(relativeTo("C:\\Projects", "D:\\a.mp4"), null, "no relative path across drives");
  assert.equal(relativeTo("/home/u/p", "/home/u/p/f/a.mp4"), "f/a.mp4");
  assert.equal(joinPath("C:\\Projects\\Trailer", "../Footage/a.mp4"), "C:\\Projects\\Footage\\a.mp4");
  assert.equal(joinPath("/home/u", "Media/a.mp4"), "/home/u/Media/a.mp4");
  assert.equal(dirName("C:\\x.ofini"), "C:\\");
  assert.equal(dirName("/home/u/x.ofini"), "/home/u");
  assert.equal(baseName("C:\\a\\b.mp4"), "b.mp4");
  assert.equal(mediaFolderName("Trailer.ofini"), "Trailer Media");
  assert.deepEqual(candidatePaths({ path: "D:\\Footage\\a.mp4", rel: "../Footage/a.mp4" }, "E:\\Proj\\T.ofini"), [
    "D:\\Footage\\a.mp4", "E:\\Footage\\a.mp4", "E:\\Proj\\a.mp4", "E:\\Proj\\T Media\\a.mp4", "E:\\Proj\\Media\\a.mp4",
  ]);
});

test("a referenced item is saved as a path without bytes; the file stays small and opens with the item offline", async () => {
  const { model, bytes } = await sceneWithRef();
  const doc = new Doc({ name: "Refs", studio: "scene" });
  doc.office = new OfficeProject(model, "scene");
  doc.path = "C:\\Projects\\Refs.ofini";
  const data = await saveOfini(doc);
  const zip = unzipSync(data);
  const json = JSON.parse(strFromU8(zip["document.json"]));
  const md = json.office.media.md1;
  assert.equal(md.path, "C:\\Footage\\clip.mp4");
  assert.equal(md.size, bytes.length);
  assert.match(md.hash, /^fp1:/);
  assert.equal(md.rel, "../Footage/clip.mp4");
  assert.equal(md.file, undefined);
  assert.ok(!Object.keys(zip).some((k) => k.startsWith("office/scene/media/md1")), "no archive entry for referenced media");
  assert.ok(zip["office/scene/media/md2.png"], "pictures stay embedded");
  assert.ok(data.length < bytes.length + 4000);
  assert.equal(doc.office.saving, null, "the save options are cleared");

  const back = await loadOfini(data);
  const n = M.normalizeScene(back.office.model);
  assert.equal(n.version, M.SCENE_VERSION);
  assert.ok(n.media.md1 && !n.media.md1.bytes, "the item is kept without bytes");
  assert.ok(isOffline(n.media.md1));
  assert.equal(Object.values(n.clips).filter((c) => c.media === "md1").length, 1, "its clip is kept");
  assert.ok(n.media.md2.bytes?.length === 64);

  // the file is found where it was: hydrated in place
  const reads = [];
  const res = await resolveMedia(n, { docPath: "C:\\Projects\\Refs.ofini", read: async (p) => (reads.push(p), p === "C:\\Footage\\clip.mp4" ? bytes : Promise.reject(new Error("no"))) });
  assert.deepEqual(res, { found: ["md1"], missing: [], changed: [], moved: [] });
  assert.equal(n.media.md1.bytes, bytes);
  assert.deepEqual(reads, ["C:\\Footage\\clip.mp4"]);
});

test("embedMedia copies (sharing) write the bytes and drop the paths; old embedded files load unchanged", async () => {
  const { model, bytes } = await sceneWithRef();
  const doc = new Doc({ name: "Share", studio: "scene" });
  doc.office = new OfficeProject(model, "scene");
  const zip = unzipSync(await saveOfini(doc, { embedMedia: true }));
  const json = JSON.parse(strFromU8(zip["document.json"]));
  assert.equal(json.office.media.md1.path, undefined);
  assert.equal(json.office.media.md1.file, "office/scene/media/md1.mp4");
  assert.equal(zip["office/scene/media/md1.mp4"].length, bytes.length);
  const back = await loadOfini(await saveOfini(doc, { embedMedia: true }));
  assert.ok(back.office.model.media.md1.bytes?.length === bytes.length && !back.office.model.media.md1.path);

  // a version 3 scene with embedded media (written before referenced media existed)
  const old = new Doc({ name: "Old", studio: "scene" });
  const { path: _p, size: _s, hash: _h, ...plain } = model.media.md1;
  old.office = new OfficeProject({ ...model, version: 3, media: { ...model.media, md1: plain } }, "scene");
  const o = await loadOfini(await saveOfini(old));
  const n = M.normalizeScene(o.office.model);
  assert.equal(n.media.md1.bytes.length, bytes.length);
  assert.ok(!isOffline(n.media.md1));
});

test("resolveMedia: found next to the project (path updated), changed files are not used, missing ones reported", async () => {
  const a = bytesOf(4000, 1);
  const b = bytesOf(4000, 2);
  const c = bytesOf(4000, 3);
  const model = {
    media: {
      a: { id: "a", path: "/old/a.mp4", size: a.length, hash: await fingerprint(a) },
      b: { id: "b", path: "/old/b.mp4", size: b.length, hash: await fingerprint(b) },
      c: { id: "c", path: "/old/c.mp4", size: c.length, hash: await fingerprint(c) },
      e: { id: "e", bytes: bytesOf(10) },
    },
  };
  const disk = new Map([
    ["/proj/Show Media/a.mp4", a],
    ["/old/b.mp4", bytesOf(4000, 7)], // same name and size, other content
  ]);
  const seen = [];
  const res = await resolveMedia(model, { docPath: "/proj/Show.ofini", read: async (p) => (disk.has(p) ? disk.get(p) : Promise.reject(new Error("ENOENT"))), onItem: (id, s) => seen.push(`${id}:${s}`) });
  assert.deepEqual(res, { found: ["a"], missing: ["c"], changed: ["b"], moved: ["a"] });
  assert.equal(model.media.a.path, "/proj/Show Media/a.mp4");
  assert.equal(model.media.a.bytes, a);
  assert.equal(model.media.b.bytes, undefined);
  assert.deepEqual(seen, ["a:found", "b:changed", "c:missing"]);
});

test("matchFolder finds offline items by name and size", () => {
  const model = { media: { a: { id: "a", path: "D:\\x\\Clip.MP4", size: 10 }, b: { id: "b", path: "D:\\x\\b.wav", size: 5 }, c: { id: "c", path: "D:\\x\\c.mp4", bytes: bytesOf(3) } } };
  const hits = matchFolder(model, [{ path: "E:\\f\\clip.mp4", size: 10 }, { path: "E:\\f\\sub\\b.wav", size: 6 }, { path: "E:\\f\\c.mp4", size: 3 }]);
  assert.deepEqual(hits, [{ id: "a", path: "E:\\f\\clip.mp4" }]);
});

test("relinkMedia keeps the id and clips, shortens clips past a shorter file; embedMedia drops the paths", async () => {
  const { model } = await sceneWithRef();
  const clip = Object.values(model.clips).find((c) => c.media === "md1");
  assert.equal(clip.dur, 4);
  const nb = bytesOf(300, 4);
  const next = M.relinkMedia(model, "md1", { kind: "video", mime: "video/webm", name: "clip.webm", duration: 2, w: 64, h: 36, bytes: nb, path: "/new/clip.webm", size: nb.length, hash: "fp1:x" });
  assert.equal(next.media.md1.path, "/new/clip.webm");
  assert.equal(next.media.md1.mime, "video/webm");
  assert.equal(next.clips[clip.id].dur, 2);
  assert.throws(() => M.relinkMedia(model, "md1", { kind: "audio", name: "a.wav" }), /not a video file/);
  const emb = M.embedMedia(next);
  assert.equal(emb.media.md1.path, undefined);
  assert.equal(emb.media.md1.bytes, nb);
  assert.equal(M.embedMedia(emb), emb, "nothing left to embed");
  const offline = { ...model, media: { ...model.media, md1: { ...model.media.md1, bytes: undefined } } };
  assert.equal(M.embedMedia(offline).media.md1.path, "C:\\Footage\\clip.mp4", "offline items cannot be embedded");
});
