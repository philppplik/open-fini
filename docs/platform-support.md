# Platform support

OpenFini runs as an installable PWA in a current browser, and as a native desktop app built with
Tauri v2. The desktop app uses the web view of the operating system, so its capabilities follow
that web view.

## Desktop app

| OS | Architecture | Installer formats | Web view (engine) | Minimum OS | Built by CI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Windows | x64 | NSIS `*-setup.exe`, MSI | WebView2 (Chromium, Evergreen) | Windows 10, Windows 11 | `windows-latest` | Built in CI, not yet tested on hardware |
| Windows | ARM64 | NSIS `*-setup.exe` | WebView2 (Chromium, Evergreen) | Windows 11 on ARM (Windows 10 on ARM works if WebView2 is installed) | `windows-11-arm` | Built in CI, not yet tested on hardware |
| macOS | Apple Silicon (aarch64) | `.dmg` (contains the `.app`) | WKWebView (Safari engine of the OS) | macOS 11 Big Sur | `macos-latest` | Built in CI, not yet tested on hardware |
| macOS | Intel (x86_64) | `.dmg` (contains the `.app`) | WKWebView (Safari engine of the OS) | macOS 11 Big Sur | `macos-latest`, cross-compiled | Built in CI, not yet tested on hardware |
| Linux | x64 | `.deb`, `.rpm`, `.AppImage` | WebKitGTK 4.1 (libsoup 3) | Ubuntu 22.04, Debian 12, Fedora and Arch of the same era | `ubuntu-22.04` | Built in CI, not yet tested on hardware |
| Linux | ARM64 | `.deb`, `.rpm`, `.AppImage` | WebKitGTK 4.1 (libsoup 3) | Ubuntu 22.04, Debian 12, Fedora and Arch of the same era | `ubuntu-22.04-arm` | Built in CI, not yet tested on hardware |

Notes

- **Windows MSI** is built for x64 stable releases only. WiX needs numeric pre-release tags, and
  the ARM64 build is NSIS only. The NSIS installer is an x86 program that runs under emulation
  on ARM64; the installed application is a native ARM64 binary. The NSIS installer installs per user and needs
  no administrator rights; the MSI installs per machine.
- **WebView2** is part of Windows 11 and current Windows 10. If it is missing, the installer
  downloads it (internet connection needed once).
- **macOS 11** is the floor the app declares (`bundle.macOS.minimumSystemVersion`). Tauri itself
  supports macOS 10.15; the real floor is set by the WebKit features the app needs, so verify before
  lowering it. Builds are ad-hoc signed and not notarized unless signing secrets are configured
  (see [release-process.md](release-process.md)).
- **Linux AppImages** are built on Ubuntu 22.04, so they run on distributions with glibc 2.35 or
  newer. They still need WebKitGTK 4.1 on the host (the AppImage does not bundle it). The AppImage
  needs FUSE 2, or run it with `--appimage-extract-and-run`.
- **Wayland and X11** are both supported by WebKitGTK; no special setup.
- **Linux musl distributions** (Alpine) and **32-bit** systems are not supported.

### What differs between the desktop app and the browser

| Feature | Desktop app | Browser / PWA |
| --- | --- | --- |
| Open and save files | native dialogs, real paths, "Save" can rewrite the same file | File System Access API in Chromium; file chooser and download elsewhere |
| File associations | `.ofini` everywhere; images are offered under "Open With" (not on Windows) | `.ofini`, `.svg`, `.png`, `.jpg`, `.webp` through the PWA file handler (Chromium) |
| Offline | always (the app is inside the binary) | after the first visit (service worker) |
| Updates | install a new version (no auto-update yet) | automatic, applied when you choose |
| Clipboard images | native clipboard | async Clipboard API; needs a user gesture, Chromium and Safari |
| Several windows / tabs | one window per app instance; a second launch focuses it | normal browser tabs |

## Browser / PWA

| Browser | Run in a tab | Install as an app | File System Access | Notes |
| --- | --- | --- | --- | --- |
| Chrome, Edge, Brave, Opera (current) | yes | yes | yes | Full feature set, including file handlers and shortcuts |
| Safari 16.4 or newer (macOS, iOS, iPadOS) | yes | yes ("Add to Home Screen" on iOS and iPadOS, "Add to Dock" in Safari 17 on macOS) | no | Saves download a file |
| Firefox (current) | yes | no on desktop | no | Saves download a file; the service worker still gives offline use |

Older browsers are not tested. The build targets ES2022 (top-level `await`), which needs Chromium 94,
Firefox 93 or Safari 15.4 at the least; the web components used for the UI (Shoelace) and some
engine features may require newer versions.

## Status legend

- **Built in CI, not yet tested on hardware**: the release workflow produces the installer, but no
  maintainer has run it on that platform yet. Update this table as each platform is verified.
- Report platform problems with the issue template and mention the OS, architecture and web view
  version.
