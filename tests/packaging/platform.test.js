import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  basename,
  dirname,
  extensionOf,
  isSafeExternalUrl,
  mimeFromName,
  normalizeExtension,
  normalizeFilters,
  toBlob,
  toUint8Array,
} from "../../app/src/platform/common.js";
import { createInstallPrompt, isServiceWorkerSupported, registerServiceWorker } from "../../app/src/platform/pwa.js";
import { platform as tauri } from "../../app/src/platform/tauri.js";
import { _pickerTypes, platform as web } from "../../app/src/platform/web.js";

describe("platform/common.js", () => {
  it("handles Windows and POSIX paths", () => {
    assert.equal(basename("C:\\Users\\me\\logo.svg"), "logo.svg");
    assert.equal(basename("/home/me/logo.svg"), "logo.svg");
    assert.equal(dirname("C:\\Users\\me\\logo.svg"), "C:\\Users\\me");
    assert.equal(dirname("/home/me/logo.svg"), "/home/me");
    assert.equal(dirname("logo.svg"), "");
    assert.equal(extensionOf("Photo.JPG"), "jpg");
    assert.equal(extensionOf(".hidden"), "");
  });

  it("guesses MIME types by extension", () => {
    assert.equal(mimeFromName("a.PNG"), "image/png");
    assert.equal(mimeFromName("a.jpeg"), "image/jpeg");
    assert.equal(mimeFromName("doc.ofini"), "application/x-openfini");
    assert.equal(mimeFromName("a.unknown"), "application/octet-stream");
  });

  it("normalizes extensions and filters", () => {
    assert.equal(normalizeExtension(" .PNG "), "png");
    assert.deepEqual(normalizeFilters([{ description: "Images", extensions: [".PNG", "jpg"] }, { extensions: [] }, null]), [
      { name: "Images", extensions: ["png", "jpg"] },
    ]);
    assert.deepEqual(normalizeFilters(undefined), []);
  });

  it("converts binary inputs", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    assert.equal(await toUint8Array(bytes), bytes);
    assert.deepEqual([...(await toUint8Array(bytes.buffer))], [1, 2, 3]);
    assert.deepEqual([...(await toUint8Array(new Blob([bytes])))], [1, 2, 3]);
    await assert.rejects(() => toUint8Array("text"), TypeError);
    assert.equal(toBlob(bytes, "image/png").type, "image/png");
  });

  it("only allows web and mail links to be opened externally", () => {
    assert.ok(isSafeExternalUrl("https://example.com/a?b=c"));
    assert.ok(isSafeExternalUrl("mailto:me@example.com"));
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "not a url", "ftp://x"]) {
      assert.ok(!isSafeExternalUrl(bad), bad);
    }
  });
});

describe("platform/web.js", () => {
  it("describes itself as the browser implementation", () => {
    assert.equal(web.isDesktop, false);
    assert.equal(web.os, "web");
  });

  it("groups extensions by MIME type for the File System Access API", () => {
    const types = _pickerTypes([{ description: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }, { description: "OpenFini", extensions: ["ofini"] }]);
    assert.deepEqual(types, [
      { description: "Images", accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"] } },
      { description: "OpenFini", accept: { "application/x-openfini": [".ofini"] } },
    ]);
    assert.deepEqual(_pickerTypes([]), []);
  });

  it("cannot save to a path and refuses unsafe links", async () => {
    await assert.rejects(() => web.saveFileTo("/x", new Uint8Array()), /desktop/);
    await assert.rejects(() => web.openExternal("javascript:alert(1)"), /Refusing/);
  });

  it("lets listeners subscribe to OS-opened files and unsubscribe again", async () => {
    const off = await web.onOpenFiles(() => {});
    assert.equal(typeof off, "function");
    off();
  });
});

describe("platform/pwa.js", () => {
  it("does nothing without a browser", async () => {
    assert.equal(isServiceWorkerSupported(), false);
    assert.equal(await registerServiceWorker({ onUpdate() {} }), null);
    const prompt = createInstallPrompt();
    assert.equal(prompt.canInstall, false);
    assert.equal(await prompt.prompt(), "unavailable");
    prompt.dispose();
  });
});

describe("platform/tauri.js (against a mocked window.__TAURI__)", () => {
  let calls;
  let listeners;
  let launchFiles;

  beforeEach(() => {
    calls = [];
    listeners = {};
    launchFiles = ["/tmp/launch.ofini"];
    globalThis.document = { title: "" };
    globalThis.window = {
      close: () => calls.push(["window.close"]),
      __TAURI__: {
        dialog: {
          open: async (options) => {
            calls.push(["open", options]);
            return options.multiple ? ["C:\\Users\\me\\a.PNG", "/tmp/b.svg"] : "C:\\Users\\me\\a.PNG";
          },
          save: async (options) => {
            calls.push(["save", options]);
            return options.defaultPath.includes("cancel") ? null : "C:\\Out\\drawing.svg";
          },
        },
        fs: {
          readFile: async (path) => {
            if (path.includes("missing")) throw "forbidden path: " + path;
            return new Uint8Array([path.length]);
          },
          writeFile: async (path, data) => void calls.push(["write", path, [...data]]),
        },
        path: { pictureDir: async () => "/home/me/Pictures", join: async (...parts) => parts.join("/") },
        opener: { openUrl: async (url) => void calls.push(["openUrl", url]) },
        window: { getCurrentWindow: () => ({ setTitle: async (title) => void calls.push(["title", title]) }) },
        event: { listen: async (name, callback) => ((listeners[name] = callback), () => {}) },
        core: {
          invoke: async (command) => {
            calls.push(["invoke", command]);
            return command === "take_launch_files" ? launchFiles : undefined;
          },
        },
      },
    };
  });
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
  });

  it("reports itself as the desktop implementation", () => {
    assert.equal(tauri.isDesktop, true);
    assert.ok(["windows", "macos", "linux"].includes(tauri.os));
  });

  it("opens files through the native dialog and reads them", async () => {
    const files = await tauri.openFiles({ accept: [{ description: "Images", extensions: [".png", "svg"] }], multiple: true });
    assert.deepEqual(calls[0], ["open", { multiple: true, directory: false, filters: [{ name: "Images", extensions: ["png", "svg"] }] }]);
    assert.deepEqual(
      files.map(({ name, path, mime }) => ({ name, path, mime })),
      [
        { name: "a.PNG", path: "C:\\Users\\me\\a.PNG", mime: "image/png" },
        { name: "b.svg", path: "/tmp/b.svg", mime: "image/svg+xml" },
      ],
    );
    assert.ok(files[0].bytes instanceof Uint8Array);
  });

  it("returns an empty list when the open dialog is cancelled", async () => {
    globalThis.window.__TAURI__.dialog.open = async () => null;
    assert.deepEqual(await tauri.openFiles(), []);
  });

  it("explains unreadable files", async () => {
    globalThis.window.__TAURI__.dialog.open = async () => "/x/missing.png";
    await assert.rejects(() => tauri.openFiles(), /Could not read \/x\/missing\.png: forbidden path/);
  });

  it("saves through the dialog, remembers the folder and supports cancel", async () => {
    const saved = await tauri.saveFile({ suggestedName: "drawing.svg", bytes: new Blob(["<svg/>"]), filters: [{ name: "SVG", extensions: ["svg"] }] });
    assert.deepEqual(saved, { name: "drawing.svg", path: "C:\\Out\\drawing.svg" });
    const write = calls.find((c) => c[0] === "write");
    assert.deepEqual(write, ["write", "C:\\Out\\drawing.svg", [...new TextEncoder().encode("<svg/>")]]);

    calls.length = 0;
    assert.equal(await tauri.saveFile({ suggestedName: "cancel.png", bytes: new Uint8Array([1]) }), null);
    assert.equal(calls.find((c) => c[0] === "save")[1].defaultPath, "C:\\Out/cancel.png", "starts in the last folder");
    assert.ok(!calls.some((c) => c[0] === "write"));
  });

  it("writes to a known path without a dialog", async () => {
    assert.deepEqual(await tauri.saveFileTo("/home/me/a.png", new Uint8Array([9])), { name: "a.png", path: "/home/me/a.png" });
    assert.deepEqual(calls, [["write", "/home/me/a.png", [9]]]);
  });

  it("sets the window title and opens links with the opener plugin", async () => {
    await tauri.setTitle("Doc - OpenFini");
    assert.equal(document.title, "Doc - OpenFini");
    assert.deepEqual(calls, [["title", "Doc - OpenFini"]]);
    await tauri.openExternal("https://example.com");
    assert.deepEqual(calls[1], ["openUrl", "https://example.com"]);
    await assert.rejects(() => tauri.openExternal("file:///etc/passwd"), /Refusing/);
  });

  it("delivers launch files and later OS 'open with' events to subscribers", async () => {
    const received = [];
    const off = await tauri.onOpenFiles((files) => received.push(files.map((f) => f.path)));
    assert.deepEqual(received, [["/tmp/launch.ofini"]], "launch file delivered once the listener is active");
    assert.ok(listeners["openfini://open-files"], "listens for the event emitted by Rust");

    await listeners["openfini://open-files"]({ payload: ["/tmp/second.png", "/tmp/missing.png"] });
    assert.deepEqual(received[1], ["/tmp/second.png"], "unreadable files are skipped");

    off();
    await listeners["openfini://open-files"]({ payload: ["/tmp/third.png"] });
    assert.equal(received.length, 2, "unsubscribed callbacks are not called");
  });

  it("quits through the Rust command", async () => {
    await tauri.quit();
    assert.deepEqual(calls, [["invoke", "quit_app"]]);
  });
});
