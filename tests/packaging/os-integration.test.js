// OS integration: file associations, "Open with" plumbing and the PWA file handler stay consistent with each other.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { FILE_TYPES, allExtensions, manifestAccept, ownedExtensions, tauriAssociations, typeOfName } from "../../app/src/platform/file-types.js";
import { LARGE_FILE_BYTES, createOpenBuffer, fileUrlToPath, normalizeOpenPaths, samePath } from "../../app/src/platform/open-paths.js";
import { SHARE_CACHE, takeSharedFiles } from "../../app/src/platform/pwa.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

describe("open-paths: argument and URL normalization", () => {
  it("converts file URLs on every platform", () => {
    assert.equal(fileUrlToPath("file:///home/me/my%20file.png"), "/home/me/my file.png");
    assert.equal(fileUrlToPath("file:///C:/Users/me/Bilder/%C3%A4.png"), "C:\\Users\\me\\Bilder\\\u00e4.png");
    assert.equal(fileUrlToPath("file://server/share/a%20b.ofini"), "\\\\server\\share\\a b.ofini");
    assert.equal(fileUrlToPath("file://localhost/tmp/a.svg"), "/tmp/a.svg");
    assert.equal(fileUrlToPath("https://example.com/a.png"), null);
    assert.equal(fileUrlToPath("file:///bad%zz"), null);
    assert.equal(fileUrlToPath("not a url"), null);
  });

  it("cleans lists of paths", () => {
    const list = ["/a/b.png", "  /a/b.png ", "--new-window", "", 7, null, "file:///c/d.svg", "C:\\x\\y.ofini"];
    assert.deepEqual(normalizeOpenPaths(list), ["/a/b.png", "/c/d.svg", "C:\\x\\y.ofini"]);
    assert.deepEqual(normalizeOpenPaths("nope"), []);
  });

  it("compares paths case-insensitively only for Windows paths", () => {
    assert.ok(samePath("C:\\Docs\\A.ofini", "c:/docs/a.ofini"));
    assert.ok(!samePath("/home/Me/a.png", "/home/me/a.png"));
    assert.ok(!samePath("", "x"));
    assert.ok(LARGE_FILE_BYTES > 1024 * 1024);
  });
});

describe("open-paths: buffer", () => {
  it("keeps files until somebody listens, then flushes once", () => {
    const buffer = createOpenBuffer();
    buffer.deliver(["a"]);
    buffer.deliver(["b", "c"]);
    buffer.deliver([]);
    assert.equal(buffer.pending, 3);
    const got = [];
    const off = buffer.subscribe((items) => got.push(items));
    assert.deepEqual(got, [["a", "b", "c"]]);
    assert.equal(buffer.pending, 0);
    buffer.deliver(["d"]);
    assert.deepEqual(got, [["a", "b", "c"], ["d"]]);
    off();
    buffer.deliver(["e"]);
    assert.equal(buffer.pending, 1);
    const again = [];
    buffer.subscribe((items) => again.push(items));
    assert.deepEqual(again, [["e"]]);
  });

  it("survives a failing listener", () => {
    const buffer = createOpenBuffer();
    const seen = [];
    const original = console.error;
    console.error = () => {};
    try {
      buffer.subscribe(() => {
        throw new Error("boom");
      });
      buffer.subscribe((items) => seen.push(items));
      buffer.deliver(["x"]);
    } finally {
      console.error = original;
    }
    assert.deepEqual(seen, [["x"]]);
  });
});

describe("file type table", () => {
  it("has unique extensions and MIME types and sane roles", () => {
    const exts = allExtensions();
    assert.equal(new Set(exts).size, exts.length);
    assert.equal(new Set(FILE_TYPES.map((t) => t.mime)).size, FILE_TYPES.length);
    for (const t of FILE_TYPES) {
      assert.ok(["Editor", "Viewer"].includes(t.role), t.id);
      assert.ok(t.ext.every((e) => /^[a-z0-9]+$/.test(e)), t.id);
    }
    assert.deepEqual(ownedExtensions(), ["ofini", "ofext"]);
    assert.equal(typeOfName("C:\\x\\Photo.JPG").id, "jpeg");
    assert.equal(typeOfName("noext"), null);
  });

  it("covers everything the Open Folder / drop handler opens", () => {
    const source = read("app/src/ui/open-folder.js");
    const match = /export const OPENABLE = \/\\\.\(([^)]*)\)\$\/i/.exec(source);
    assert.ok(match, "OPENABLE not found");
    const known = new Set(allExtensions());
    for (const ext of match[1].replace(/\?/g, "").split("|")) {
      if (ext === "jpe") continue; // alias of .jpg that is not worth an association
      assert.ok(known.has(ext), `.${ext} is openable but not registered as a file type`);
    }
  });
});

describe("tauri.conf.json file associations", () => {
  const strip = (list) => list.map(({ ext, mimeType, role, rank }) => ({ ext, mimeType, role, rank }));

  it("matches the file type table (macOS and Linux)", () => {
    const conf = json("src-tauri/tauri.conf.json").bundle.fileAssociations;
    assert.deepEqual(strip(conf), strip(tauriAssociations()));
    for (const a of conf) {
      assert.ok(a.name && a.description, a.ext.join());
      assert.equal(Boolean(a.exportedType), a.rank === "Owner", `${a.ext.join()}: only owned types export a UTI`);
    }
  });

  it("registers only the owned types as default handlers on Windows", () => {
    const win = json("src-tauri/tauri.windows.conf.json").bundle.fileAssociations;
    assert.deepEqual(strip(win), strip(tauriAssociations({ windows: true })));
    assert.ok(win.every((a) => a.rank === "Owner"));
    assert.ok(win.every((a) => /^OpenFini\.[A-Za-z]+$/.test(a.name)), "names are registry ProgIds");
  });

  it("never claims default rank for foreign types", () => {
    const conf = json("src-tauri/tauri.conf.json").bundle.fileAssociations;
    for (const a of conf) if (!["ofini", "ofext"].includes(a.ext[0])) assert.equal(a.rank, "Alternate", a.ext.join());
  });

  it("wires installer hooks, desktop template, resources and icon files that exist", () => {
    const conf = json("src-tauri/tauri.conf.json");
    assert.equal(conf.bundle.windows.nsis.installerHooks, "windows/open-with.nsh");
    assert.ok(existsSync(join(root, "src-tauri", conf.bundle.windows.nsis.installerHooks)));
    for (const kind of ["deb", "rpm"]) {
      assert.equal(conf.bundle.linux[kind].desktopTemplate, "linux/openfini.desktop");
      assert.ok(existsSync(join(root, "src-tauri", conf.bundle.linux[kind].desktopTemplate)));
    }
    for (const kind of ["deb", "rpm", "appimage"]) {
      for (const source of Object.values(conf.bundle.linux[kind].files)) assert.ok(existsSync(join(root, "src-tauri", source)), source);
    }
    const resources = [...Object.keys(json("src-tauri/tauri.windows.conf.json").bundle.resources), ...Object.keys(json("src-tauri/tauri.macos.conf.json").bundle.resources)];
    for (const source of resources) assert.ok(existsSync(join(root, "src-tauri", source)), source);
    assert.ok(existsSync(join(root, "app/icons/doc-icon.svg")));
  });
});

describe("installer files", () => {
  it("offers exactly the non-owned types under Open with on Windows", () => {
    const nsh = read("src-tauri/windows/open-with.nsh");
    const added = [...nsh.matchAll(/OPENFINI_OPENWITH_ADD "([a-z0-9]+)"/g)].map((m) => m[1]);
    const removed = [...nsh.matchAll(/OPENFINI_OPENWITH_REMOVE "([a-z0-9]+)"/g)].map((m) => m[1]);
    const expected = FILE_TYPES.filter((t) => !t.own).flatMap((t) => t.ext);
    assert.deepEqual(added, expected);
    assert.deepEqual(removed, expected);
    assert.match(nsh, /!macro NSIS_HOOK_POSTINSTALL/);
    assert.match(nsh, /!macro NSIS_HOOK_PREUNINSTALL/);
    assert.equal((nsh.match(/^!macro /gm) || []).length, (nsh.match(/^!macroend/gm) || []).length);
  });

  it("lists every MIME type in the Linux .desktop file and passes files to the app", () => {
    const desktop = read("src-tauri/linux/openfini.desktop");
    assert.match(desktop, /^Exec=\{\{exec\}\} %F$/m);
    const mimes = /^MimeType=(.*)$/m.exec(desktop)[1].split(";").filter(Boolean);
    assert.deepEqual(mimes, FILE_TYPES.map((t) => t.mime));
  });

  it("declares the owned MIME types in shared-mime-info", () => {
    const xml = read("src-tauri/linux/openfini-mime.xml");
    for (const t of FILE_TYPES.filter((x) => x.own)) {
      assert.ok(xml.includes(`type="${t.mime}"`), t.mime);
      for (const e of t.ext) assert.ok(xml.includes(`pattern="*.${e}"`), e);
    }
  });

  it("keeps the macOS Info.plist in sync with the exported types", () => {
    const plist = read("src-tauri/Info.plist");
    const conf = json("src-tauri/tauri.conf.json").bundle.fileAssociations.filter((a) => a.exportedType);
    for (const a of conf) {
      assert.ok(plist.includes(`<string>${a.exportedType.identifier}</string>`), a.exportedType.identifier);
      assert.ok(plist.includes(`<string>${a.mimeType}</string>`), a.mimeType);
      for (const e of a.ext) assert.ok(plist.includes(`<string>${e}</string>`), e);
    }
  });
});

describe("PWA", () => {
  const manifest = json("app/manifest.webmanifest");

  it("accepts the same types as the desktop app", () => {
    assert.deepEqual(manifest.file_handlers[0].accept, manifestAccept());
    assert.equal(manifest.file_handlers[0].launch_type, "single-client");
    assert.equal(manifest.launch_handler.client_mode, "focus-existing");
  });

  it("receives shared files by POST to ./share, inside the scope", () => {
    const target = manifest.share_target;
    assert.equal(target.method, "POST");
    assert.equal(target.enctype, "multipart/form-data");
    assert.equal(target.params.files[0].name, "files");
    assert.ok(new URL(target.action, "https://x.test/app/").pathname.startsWith(new URL(manifest.scope, "https://x.test/app/").pathname));
    const sw = read("app/sw.js");
    assert.ok(sw.includes('SHARE_PATH = "share"') && sw.includes(`SHARE_CACHE = "${SHARE_CACHE}"`));
    assert.ok(!SHARE_CACHE.startsWith("openfini-"), "version clean-up must not delete shared files");
  });

  it("takes shared files out of the cache in order and empties it", async () => {
    const store = new Map();
    const make = (url, body, type) => store.set(url, { request: { url }, response: new Response(body, { headers: { "content-type": type } }) });
    make("https://x.test/share-files/abc1/1/b%20two.txt", "two", "text/plain");
    make("https://x.test/share-files/abc1/0/a.png", "one", "image/png");
    make("https://x.test/share-files/other/0/z.png", "zzz", "image/png");
    const cache = {
      keys: async () => [...store.values()].map((e) => e.request),
      match: async (request) => store.get(request.url)?.response.clone(),
      delete: async (request) => store.delete(request.url),
    };
    const original = globalThis.caches;
    globalThis.caches = { open: async (name) => (name === SHARE_CACHE ? cache : assert.fail(name)) };
    try {
      const files = await takeSharedFiles("abc1");
      assert.deepEqual(files.map((f) => [f.name, f.mime, new TextDecoder().decode(f.bytes)]), [["a.png", "image/png", "one"], ["b two.txt", "text/plain", "two"]]);
      assert.equal(store.size, 1, "only the other share is left");
      assert.deepEqual(await takeSharedFiles("../evil"), []);
    } finally {
      globalThis.caches = original;
    }
  });
});
