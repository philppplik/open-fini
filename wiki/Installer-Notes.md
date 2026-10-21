# Installer Notes

OpenFini's Windows installer is a branded NSIS wizard, the macOS download is a styled DMG, and Linux ships `.deb`, `.rpm` and AppImage packages. This page records what the Tauri bundler can and cannot customize, the decision against a custom bootstrapper, how the assets are regenerated and what was and was not verified. Details are in the repository's `docs/installer.md`.

## The app icon

The icon is the near-black OpenFini mark on an off-white rounded tile (`app/icons/icon.svg`, a full-bleed `icon-maskable.svg` and a document icon `doc-icon.svg`). `npm run icons` regenerates every raster (desktop icons, PWA icons, document icons) from the SVGs with the Tauri CLI.

## What the bundler supports

| Target | Customizable |
| --- | --- |
| NSIS (Windows) | Template, header and sidebar images, installer and uninstaller icons, install mode (`currentUser`, `perMachine`, `both`), languages |
| WiX / MSI (Windows x64) | Banner and dialog images, template, fragments; not built for ARM64 |
| macOS DMG | Background image, window and icon positions |
| Linux deb, rpm, AppImage | Extra files, desktop template, dependencies, maintainer scripts |

NSIS can theme the welcome, finish and header images, colors and page texts, and add pages through `nsDialogs`. It cannot restyle the inner Win32 pages (license, folder, progress).

## Decision: branded NSIS, no custom bootstrapper

A fully custom-drawn installer needs a separate bootstrapper program. It was rejected because it adds another executable to build and keep alive for three architectures, depends on WebView2 itself (a chicken-and-egg problem), would replace the bundler's tested logic (per-user versus per-machine install, upgrade, uninstaller registration, silent and updater modes, WebView2 installation), and the gain is cosmetic.

## What was built

Sources are SVG files in `src-tauri/installer/`; `npm run installer:assets` renders the sidebar and header bitmaps and the DMG background (using Edge or Chrome in headless mode, override with `OPENFINI_BROWSER`).

- **Windows NSIS:** a copy of the stock template with marked blocks. Pages: welcome, license (MIT), install folder, a **Windows integration** page (associate `.ofini` and `.ofext`, offer "Open with" for images, PDF and code files without changing any default program), install, finish. Per-user install into `%LOCALAPPDATA%\OpenFini`, no admin prompt. Silent, passive and updater runs use defaults.
- **macOS DMG:** custom background with the app and Applications icon positions.
- **Linux:** a custom `.desktop` template with the full `MimeType=` list, shared-mime-info registration and a document icon.

File associations are described on [[Platform Support]].

## Verified and not verified

Installer packaging, `makensis` output and the macOS DMG layout are validated only by the release build, not by every maintainer machine. The NSIS hook, the macOS `Info.plist` merge and the Linux desktop template were checked against the Tauri schema and templates but not by installing every bundle. Windows ARM64 and the macOS Intel cross-build have not run on hardware. Please test an installer on each OS before relying on it, and report problems.

## Pitfalls

- Platform config files are merged with JSON merge patch and **arrays are replaced**, so `tauri.macos.conf.json` repeats the whole `app.windows` entry; keep it in sync with `tauri.conf.json`.
- Every window call needs an entry in `src-tauri/capabilities/default.json`; a missing one fails silently in the UI and logs a console warning.
- NSIS images must be uncompressed BMP (24-bit is the safe choice).
- The NSIS installer is an x86 program that runs under emulation on ARM64; the installed app is native ARM64.

## See also

- [[Installation]]
- [[Platform Support]]
- [[Git Workflow and Releases]]
- [[CI and Size Budgets]]
