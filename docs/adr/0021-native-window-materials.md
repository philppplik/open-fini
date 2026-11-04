# 0021: Native window materials instead of Liquid glass refraction

Status: Accepted (supersedes [0015](0015-liquid-glass-refraction.md))

## Context

Liquid glass (ADR 0015) bent the backdrop of floating surfaces with SVG displacement maps in `backdrop-filter: url()`.
It only worked in Chromium engines, needed a probe and a fallback path, cost about 2 KiB gzip of start-up JS plus a lazy
module, and still looked uneven (edges, scaling, dispersion artifacts). Users asked instead for "real" glass in the desktop
app: the wallpaper and other windows visible through OpenFini, like native Windows 11 and macOS apps.

## Decision

1. Remove Liquid glass. Migrate stored `surfaceStyle: "liquid"` (prefs, profiles, theme recommendations) to `"glass"`.
2. In the desktop app, add a **window material** for Glass and Sea glass using Tauri 2's built-in window effects
   (`WebviewWindow::set_effects`, `set_background_color`). Tauri already depends on the `window-vibrancy` crate for this, so
   **no new dependency** is added; a direct `window-vibrancy` dependency would duplicate what Tauri exposes.
   The `windowEffects` config key was not used because it applies the effect at start-up for everyone; the effect must be
   opt-in and switchable at run time.
3. The main window is created `transparent: true`, but keeps an opaque webview background until a material is chosen, so
   the default look is unchanged. macOS needs `macOSPrivateApi` (Cargo feature `macos-private-api`) for a transparent
   webview; OpenFini does not target the Mac App Store, which is what that rules out.
4. Support is detected at run time (`window_materials` command): Mica only on Windows build 22000+, Acrylic on Windows,
   NSVisualEffectView materials on macOS, plain transparency on Linux. The UI only shows what the shell reports.
5. Contrast: the window opacity acts as the scrim in `ui/glass.js`; the existing `minAlpha()`/`liftedText()` helpers then
   raise panel opacity and lift text until AA holds against white, black and the accent behind that scrim.

## Consequences

- The browser and the PWA keep the in-app background layer ("fake glass"); nothing changes there.
- Start-up JS shrinks (refraction removed) while the new code adds about 1 KiB.
- Linux has no blur API in Tauri: only transparency, and only with a compositing window manager; without one the window may
  show black behind the panels, which the user can undo by picking "None".
- Pop-out windows stay opaque (they are created at run time without transparency).
- Not verified on hardware in CI; see `docs/platform-notes.md`.
