# Building OpenFini

OpenFini is a static web app (`app/`, plain ES modules, no framework). The same build runs as

- a **PWA** (installable, works offline), served from any static host, and
- a **desktop app** (Tauri v2, system WebView, no bundled Chromium) for Windows, macOS and Linux.

Everything below is run from the repository root.

## Prerequisites

| You want to | You need |
| --- | --- |
| work on the web app, run tests, build the PWA | **Node.js 20 or newer** (24 LTS recommended) |
| build the desktop app | additionally **Rust 1.90 or newer** and your platform's system libraries |

Platform setup (Visual Studio Build Tools with the ARM64 component on Windows, Xcode Command Line
Tools on macOS, `webkit2gtk-4.1` packages on Linux) is listed step by step in
[`src-tauri/README.md`](../src-tauri/README.md).

## The web app

```sh
npm ci            # install dependencies (esbuild, the Tauri CLI, polygon-clipping)
npm start         # dev server on http://localhost:4173, serves app/ as is
npm test          # unit tests (node --test)
npm run build     # production build into dist/
npm run check:size
```

`npm start` runs `scripts/serve.mjs`: a tiny static server that sends everything with
`Cache-Control: no-store`, so edits show up on reload. Options: `--port 8080`, `--host 0.0.0.0` (to
test on a phone), `--root dist` (serve the production build; this is how to test the PWA), `--csp` (also send the
desktop app's Content-Security-Policy from `tauri.conf.json`, so violations show up in the browser
console before you ever build the desktop app).

During development the service worker is inert: `app/sw.js` only works in builds, because
`npm run build` injects the version and the file list into it. If it finds neither, it unregisters
itself and deletes its caches, so you never see stale files while editing.

### What `npm run build` does

`scripts/build.mjs` reads `app/index.html` and treats it as the source of truth:

1. Copies `app/` to `dist/` (without sourcemaps, OS junk and the unused Shoelace translations).
2. Bundles and minifies every `<script type="module" src="...">` with esbuild (target ES2022) into
   `dist/assets/<name>-<hash>.js`. Code is split at `import()`; shared code goes into
   `dist/assets/chunk-<hash>.js`.
3. Leaves `app/vendor/shoelace/` as separate files. Its autoloader imports components by URL at
   runtime, so any import that resolves into that folder stays external and is rewritten to a
   relative URL.
4. Minifies the `<link rel="stylesheet" href>` files into hashed files. Files below `vendor/` are
   copied unchanged.
5. Rewrites `index.html` to the hashed names and adds `modulepreload` hints for the entry's static
   imports.
6. Deletes the source files that now live inside bundles, so nothing ships twice.
7. Injects the build version and the **precache manifest** (every file with a content hash) into
   `sw.js`, then writes `dist/build-info.json`.

Rules the app code has to follow so the build can do this safely:

- Entry points are `<script type="module" src>` tags in `index.html`. Inline module scripts are not
  bundled.
- `import("./x.js")` must use a **string literal**; computed specifiers are left alone and will not
  find their target after bundling. `new URL("./file", import.meta.url)` may be a string literal or a
  template literal whose folder part is static, such as ``new URL(`../assets/icons/${name}.svg`, import.meta.url)``;
  the build rewrites the folder so it still points at the right place from `dist/assets/`.
- Web Workers: write `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`. The
  build detects this form, bundles the worker file in place (same path in `dist/`, so its own
  relative URLs still work) and fixes the URL in the calling code. Other ways of starting a worker
  are not detected.
- Top-level `await` is fine: the build targets ES2022, which every supported WebView understands
  (Chromium 94+, Safari 15.4+). To support older engines pass `--target es2020` in the `build`
  script, and remove top-level `await` first.
- Reference Shoelace only through files below `app/vendor/shoelace/`.

### Size budget

`npm run check:size` prints raw, gzip and brotli sizes per group and fails when a budget in
`scripts/size-budget.json` is exceeded:

| Budget | Default | Covers |
| --- | --- | --- |
| `shellJsGzipKiB` | 400 | all JavaScript outside `vendor/` (the app shell and the service worker) |
| `totalGzipKiB` | 2048 | everything the browser downloads, except fonts and license texts |

CI runs it on every push. Raise a budget only deliberately, in its own commit.

## The PWA

`app/manifest.webmanifest` and `app/sw.js` make OpenFini installable and offline-capable.

- **Offline:** on first load the service worker downloads the whole app (the precache) in the
  background. From then on the app starts from the cache, with or without a connection.
- **Updates never interrupt editing:** a new version installs silently and then *waits*. The page
  decides when to switch (`applyUpdate()` below), which reloads it. Files that did not change are
  copied from the old cache instead of being downloaded again.
- **Hosting:** any HTTPS static host. All URLs are relative, so a sub-path such as
  `https://<user>.github.io/open-fini/` works. The repository ships a GitHub Pages workflow
  (`.github/workflows/pages.yml`); enable it once under *Settings, Pages, Source: GitHub Actions*.
- **Shortcuts and file handlers** declared in the manifest: `./?studio=vector`, `?studio=pixel`,
  `?studio=layout`, `?studio=code`, and `.ofini`, `.svg`, `.png`, `.jpg`, `.webp` files (delivered
  through `platform.onOpenFiles`).

Wire it up once at startup (this is the host application's job, in `app/src/main.js`):

```js
import { registerServiceWorker, createInstallPrompt } from "./platform/pwa.js";

registerServiceWorker({
  onUpdate: (applyUpdate) => showToast("A new version is ready", { action: "Update", onClick: applyUpdate }),
  onOfflineReady: () => showToast("OpenFini now works offline"),
});

const install = createInstallPrompt({ onChange: (canInstall) => installButton.hidden = !canInstall });
installButton.onclick = () => install.prompt();
```

Both do nothing inside the desktop app. `index.html` should also contain
`<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">` for iOS.

## The platform bridge

`app/src/platform/index.js` exports one `platform` object that hides whether the app runs in a
browser or in the desktop shell:

```js
import { platform } from "./platform/index.js";

platform.isDesktop;                                  // boolean
platform.os;                                         // 'windows' | 'macos' | 'linux' | 'web'
const files = await platform.openFiles({ accept: [{ description: "Images", extensions: ["png", "jpg"] }], multiple: true });
await platform.saveFile({ suggestedName: "logo.svg", bytes, mime: "image/svg+xml", filters: [{ name: "SVG", extensions: ["svg"] }] });
await platform.onOpenFiles((files) => files.forEach(openDocument));   // files opened through the OS
```

Files are `{ name, path?, bytes: Uint8Array, mime }`; `path` exists on desktop only. See the JSDoc in
`index.js` for every function (`saveFileTo`, `setTitle`, `openExternal`, clipboard images, `quit`).
In the browser the File System Access API is used where it exists (Chromium) with `<input>` and
download-link fallbacks elsewhere.

## The desktop app

```sh
npm run tauri:dev      # dev server + native window, reloads on edits
npm run tauri:build    # production installers for the current platform
```

Details, prerequisites, cross-compiling notes and troubleshooting are in
[`src-tauri/README.md`](../src-tauri/README.md). Installers end up in
`src-tauri/target/release/bundle/`. On **Windows ARM64** build NSIS only:
`npm run tauri:build -- --bundles nsis`.

`tauri.conf.json` takes the version from `package.json`. Keep `package.json`, `package-lock.json` and
`src-tauri/Cargo.toml` in sync with `node scripts/version.mjs set 1.2.3`.

### Icons

`app/icons/icon.svg` (tile with transparent corners) and `app/icons/icon-maskable.svg` (full-bleed
for adaptive icons) are the sources. `npm run icons` regenerates every PNG, `.ico` and `.icns`
(desktop in `src-tauri/icons`, PWA in `app/icons`) with the Tauri CLI; no other tool is needed.

## Running unsigned builds

Until the project is code-signed, operating systems warn once on first launch. The files are not
broken.

**Windows.** SmartScreen shows "Windows protected your PC". Click **More info**, then **Run
anyway**. If you downloaded a `.zip`, right-click the file, choose *Properties* and tick *Unblock*
before extracting.

**macOS.** Builds are ad-hoc signed, which Apple Silicon requires, but not notarized.
Control-click (or right-click) OpenFini in Applications, choose **Open**, and confirm. If macOS
says the app is *damaged* or cannot be verified, remove the download quarantine flag once:

```sh
xattr -cr /Applications/OpenFini.app
```

Recent macOS versions may also ask you to allow the app under *System Settings, Privacy &
Security* (**Open Anyway**).

**Linux.** An AppImage must be executable:

```sh
chmod +x OpenFini_*.AppImage
./OpenFini_*.AppImage
```

On systems without FUSE 2 run it with `--appimage-extract-and-run`. For `.deb` use
`sudo apt install ./OpenFini_*.deb` (this pulls the dependencies); for `.rpm` use
`sudo dnf install ./OpenFini-*.rpm`.

Verify any download against `SHA256SUMS.txt` from the same release:

```sh
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Releasing

In short: `node scripts/version.mjs set 0.2.0`, commit, `git tag v0.2.0`, `git push origin v0.2.0`.
GitHub Actions then builds the installers for Windows (x64, ARM64), macOS (Apple Silicon, Intel) and
Linux (x64, ARM64), plus the PWA zip and `SHA256SUMS.txt`, and collects them in a **draft** release
that you review and publish by hand.

The full procedure, checklist and the optional code-signing secrets are in
[release-process.md](release-process.md). Supported platforms and installer formats:
[platform-support.md](platform-support.md).
