---
title: Download
description: Download OpenFini for Windows, macOS and Linux, or the web app to host yourself. All files with sizes and SHA-256 checksums.
headline: Download OpenFini
lead: >
  Installers for six platforms and a web app, built by GitHub Actions for every release. The Windows installer works
  per user and needs no administrator rights.
---

## The first launch {first-launch}

The builds are not code-signed yet, so the operating system warns once on first launch. The files are not broken.

- **Windows:** SmartScreen shows *Windows protected your PC*. Choose **More info**, then **Run anyway**.
- **macOS:** builds are ad-hoc signed but not notarized. Control-click OpenFini in Applications, choose **Open** and
  confirm. If macOS says the app is damaged, run `xattr -cr /Applications/OpenFini.app` once.
- **Linux:** make the AppImage executable with `chmod +x`, or install the `.deb` or `.rpm` package.

The installers are built in CI and have not been tested on every kind of hardware yet. Please
[report problems](https://github.com/philppplik/open-fini/issues).

## System requirements {requirements}

| System | Minimum | Web view |
| --- | --- | --- |
| Windows x64 | Windows 10 or 11 | WebView2 (part of Windows 11 and current Windows 10) |
| Windows ARM64 | Windows 11 on ARM | WebView2 |
| macOS | macOS 11 Big Sur, Apple Silicon or Intel | WKWebView of the system |
| Linux x64 and ARM64 | Ubuntu 22.04, Debian 12, Fedora and Arch of the same era | WebKitGTK 4.1, preinstalled on most desktops |

## The web app {web}

The PWA build is a ZIP of static files. Put it on any HTTPS static host and open it in a browser; it can be installed,
works offline, and your files stay on your device. See
[Building](https://github.com/philppplik/open-fini/blob/main/docs/building.md) for the details.

## Build from source {source}

You need Node.js 20 or newer and npm; Rust only for the desktop app.

```sh
git clone https://github.com/philppplik/open-fini.git
cd open-fini
npm install
npm start
```
