# OpenFini desktop shell (Tauri v2)

This folder turns the web app in `app/` into a small native application. It uses the
operating system's own WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on
Linux), so no browser engine is bundled and the installers stay in the single-digit
megabytes.

You do not need any of this to work on the web app. `npm start` is enough for that.

## What is here

| Path | Purpose |
| --- | --- |
| `Cargo.toml` | Crate `openfini`: Tauri 2, the dialog, fs, opener, clipboard and single-instance plugins. The release profile is tuned for size (`opt-level = "s"`, LTO, `panic = "abort"`, stripped). |
| `tauri.conf.json` | App identity, window, strict CSP, installers and file associations. The version is read from `../package.json`. |
| `tauri.windows.conf.json` | Windows-only override: register `.ofini` only (see "File associations"). |
| `capabilities/default.json` | The permissions the main window gets. Nothing outside this list is reachable from JavaScript. |
| `src/lib.rs`, `src/main.rs` | Plugin registration, single-instance forwarding, "open with" delivery. |
| `icons/` | Generated from `app/icons/icon.svg` by `npm run icons`. Do not edit by hand. |
| `linux/` | `openfini.desktop` (Exec with `%F`, MIME list), `openfini-mime.xml` (shared-mime-info) and the MIME icon, installed by `.deb`, `.rpm` and AppImage. |
| `windows/open-with.nsh` | NSIS hook: "Open with" registration for non-owned types, document icon. |
| `Info.plist`, `tauri.macos.conf.json` | macOS: document type icon for `.ofini` / `.ofext`. |
| `src/cli.rs` | `--help`, `--version`, argument and `file://` URL parsing (with unit tests). |

The frontend is built with `npm run build` into `../dist` and embedded (compressed) in the
binary. `app.withGlobalTauri` is on, so `app/src/platform/tauri.js` uses `window.__TAURI__`
and no npm package is needed.

## Prerequisites

Rust 1.90 or newer (Tauri 2.12 and its plugins require it), Node.js 20 or newer
(24 recommended) and the system libraries below.

### Windows (x64 and ARM64)

1. **Microsoft C++ Build Tools** (Visual Studio Build Tools 2022): select the workload
   *Desktop development with C++*. For the **ARM64** target also tick the individual component
   *MSVC v143 - VS 2022 C++ ARM64/ARM64EC build tools (Latest)*.
2. **WebView2 runtime**: already part of Windows 11 and current Windows 10.
3. **Rust** from <https://rustup.rs> (or `winget install --id Rustlang.Rustup`) and
   `rustup default stable-msvc`.
   - On an ARM64 PC rustup picks the `aarch64-pc-windows-msvc` host automatically.
   - On an x64 PC, to build for ARM64 as well: `rustup target add aarch64-pc-windows-msvc`.
4. **Node.js** from <https://nodejs.org> (the ARM64 build exists for Windows 11 on ARM).

Installer formats: NSIS (`-setup.exe`) works everywhere. MSI needs the WiX toolset (downloaded
automatically) and the optional Windows feature *VBSCRIPT*; **build NSIS only on ARM64**:

```powershell
npm run tauri:build -- --bundles nsis
```

The NSIS installer itself is an x86 program that runs under emulation on ARM64; the installed
app is a native ARM64 binary.

### macOS (Intel and Apple Silicon)

```sh
xcode-select --install                       # Command Line Tools (full Xcode is not required)
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

macOS 11 or newer is the minimum the app is built for (`bundle.macOS.minimumSystemVersion`).

### Linux

Debian / Ubuntu (22.04 or newer):

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf xdg-utils
```

Fedora:

```sh
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel patchelf
sudo dnf group install "c-development"
```

Arch:

```sh
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg xdotool patchelf
```

`patchelf` and `xdg-utils` are only needed to produce the AppImage.

## Everyday commands

Run these from the repository root (not from `src-tauri`):

```sh
npm ci                  # once
npm run tauri:dev       # starts the dev server (npm start) and opens the app; reloads on edits
npm run tauri:build     # runs npm run build, compiles in release mode, creates the installers
```

Installers appear in `src-tauri/target/release/bundle/` (or `target/<triple>/release/bundle/` when
`--target` is used). The plain binary is `src-tauri/target/release/openfini[.exe]`.

Pass extra options after `--`:

```sh
npm run tauri:build -- --target x86_64-apple-darwin      # Intel build on an Apple Silicon Mac
npm run tauri:build -- --bundles deb,appimage             # only some formats
npm run tauri:build -- --no-bundle                        # just the binary
```

Checks that CI also runs:

```sh
cd src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
```

`cargo check` and `clippy` need `../dist` to exist (the app is embedded at compile time), so run
`npm run build` once first.

## Cross-compiling

Only the combinations below are practical. The release workflow avoids all of the others by
building every target on a runner of its own architecture.

| From | To | Works? |
| --- | --- | --- |
| macOS Apple Silicon | macOS Intel | Yes: `rustup target add x86_64-apple-darwin`, then `--target x86_64-apple-darwin`. This is what CI does. |
| macOS Intel | macOS Apple Silicon | Yes, the same way with `aarch64-apple-darwin`. |
| Windows x64 | Windows ARM64 | Yes with the ARM64 build tools and `--target aarch64-pc-windows-msvc --bundles nsis`. |
| Windows ARM64 | Windows x64 | Yes with `--target x86_64-pc-windows-msvc`. |
| Linux or macOS | Windows | NSIS only, with [`cargo-xwin`](https://github.com/rust-cross/cargo-xwin): `npm run tauri:build -- --runner cargo-xwin --target x86_64-pc-windows-msvc`. Not used by CI. |
| Linux x64 | Linux ARM64 | Not for AppImage (its tool, linuxdeploy, cannot cross-compile). Use an ARM64 machine or runner. |

## How the frontend talks to this crate

- **Plugins** (used directly from JavaScript through `window.__TAURI__`): `dialog` for native
  open and save dialogs, `fs` to read and write the files the user picked, `opener` for web links,
  `clipboard-manager` for images.
- **`take_launch_files`** (command): returns files the OS asked us to open before the UI was ready,
  such as the document that launched the app. After that call, files arrive as
  **`openfini://open-files`** events (payload: `string[]` of absolute paths): double clicks on `.ofini`
  files, "Open with", dropping a file on the Dock icon (macOS), and a second launch with a file
  argument (the running instance gets the arguments and comes to the front).
- **`quit_app`** (command): exits the application.

Files that arrive from the OS are added to the file-system scope at runtime, so the frontend can
read and save them wherever they live. Files picked in the dialogs are added by the dialog plugin.

## Security model

- The page is local; nothing is loaded from the network. The CSP in `tauri.conf.json` allows only
  the app's own origin plus `data:` and `blob:` images, Web Workers from `blob:`, and Tauri's IPC.
  `style-src` allows `'unsafe-inline'` because Shoelace and the UI set inline styles;
  `dangerousDisableAssetCspModification: ["style-src"]` stops Tauri from adding a nonce, which
  would silently turn that off. There is no `wasm-unsafe-eval`: the engines are plain JavaScript.
  Add it only if WebAssembly is introduced.
- `capabilities/default.json` is the allow-list. File access outside the picked files is limited to
  Desktop, Documents, Downloads, Pictures and the app data folder.
- `app.windows[0].dragDropEnabled` is `false`. With it on, Tauri swallows file drops and the web
  app's normal HTML5 drag and drop (dropping images, reordering layers) would not work on Windows.
  The frontend therefore receives dropped files as ordinary DOM `File` objects, exactly like in
  the browser.

## File associations

The complete description (what each installer registers, how to make OpenFini the default, the command line) is in
[docs/os-integration.md](../docs/os-integration.md). In short: `.ofini` and `.ofext` are owned types; all other types
are registered as alternates (macOS `LSHandlerRank` Alternate, Linux `MimeType=`, Windows through
`windows/open-with.nsh`) so OpenFini shows up under "Open with" without taking over anything.
`tauri.windows.conf.json` lists only the owned types because Tauri's NSIS and MSI templates write the default program
for every listed extension. The list comes from `app/src/platform/file-types.js`; a test checks that every file stays in
sync.

## Dependencies and the lockfile

`Cargo.lock` is not committed yet because the first build has to create it. After the first
successful CI run (or a local `cargo generate-lockfile`), commit `src-tauri/Cargo.lock` so builds
become reproducible and Dependabot can update the Rust dependencies; then add `--locked` to the
`cargo` calls in `.github/workflows/ci.yml`.

## Troubleshooting

- *"The `frontendDist` configuration is set to `../dist` but this path doesn't exist"*: run
  `npm run build`.
- *Blank window in `tauri:dev`*: port 4173 may be taken. Stop the other process, or change the port
  in both `tauri.conf.json` (`build.devUrl`) and `package.json` (`start`).
- *`failed to run light.exe` on Windows*: enable the optional feature VBSCRIPT, or build NSIS only.
- *Linux: `webkit2gtk-4.1` not found*: your distribution is too old. Ubuntu 22.04, Debian 12 and
  current Fedora and Arch releases have it.
