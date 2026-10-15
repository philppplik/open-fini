# 0001 — Tauri (system WebView) as the desktop shell

**Status:** Accepted

## Context

OpenFini must run on Windows (x64 and ARM64), macOS (Intel and Apple Silicon) and Linux (x64 and ARM64),
and it must be *light*: small installers, low memory, fast start-up on weak machines.

## Options considered

| Option | Installer | Idle memory | ARM64 | Notes |
| --- | --- | --- | --- | --- |
| Electron / NW.js | ~80-120 MB | 200+ MB | yes | Bundles Chromium; the opposite of "very light". |
| Neutralinojs | ~2 MB | low | partial (Windows ARM64 runs under x64 emulation) | Tiny, but a thin native API and a smaller ecosystem. |
| **Tauri 2** | a few MB | low | yes (all six targets) | Rust core, OS WebView, official plugins, installers (NSIS / MSI / DMG / AppImage / deb / rpm), file associations, single instance. |
| Pure PWA | none | n/a | n/a | Kept as a first-class second target, but not enough alone (file associations, offline-first updates). |

## Decision

Use **Tauri v2** for the desktop app and ship the same web app as an installable **PWA**. The frontend uses
no Tauri npm packages: the platform bridge (`app/src/platform`) talks to the injected globals, so the same
code runs in a plain browser.

## Consequences

* Rendering depends on the system WebView (WebView2, WKWebView, WebKitGTK). We therefore avoid features that
  are missing in WebKit (see ADR 0002) and test in Chromium and Firefox.
* Building the desktop app needs the Rust toolchain; the web app does not.
* Installers are unsigned until certificates are configured.
