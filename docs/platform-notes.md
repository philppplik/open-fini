# Platform notes (desktop app)

OS-specific behavior of the Tauri shell and how the frontend detects it. Supported OS versions and installer formats are in
[platform-support.md](platform-support.md).

## Detecting the platform in JS

`app/src/platform/os-info.js`:

- `osInfo()` returns `{ os: "windows" | "macos" | "linux", desktop }` (user agent; `desktop` is true inside the Tauri shell).
- `markOs(root)` sets `<html data-os="…">` and `data-desktop` once at start-up (from `ui/glass-dom.js`), for CSS that must
  differ per platform.
- `loadMaterials()` asks the shell which window materials exist (`window_materials` command); `null` in the browser.
- `applyMaterial(id)` switches the material (`set_window_material`).

Rust code paths are gated with `#[cfg(target_os = "…")]` in `src-tauri/src/effects.rs` and `lib.rs`.

## Window materials (true transparency)

See [themes.md](themes.md#native-window-material-desktop-app) and [ADR 0021](adr/0021-native-window-materials.md).

| OS | Materials | Notes and limits |
| --- | --- | --- |
| Windows 11 (22000+) | Mica, Mica Alt (`tabbed`), Acrylic | DWM system backdrop. The build number is read once from `cmd /c ver` (no console window). Mica follows the desktop wallpaper only, not other windows; Acrylic blurs the windows behind. |
| Windows 10 1809+ | Acrylic | Acrylic can lag while dragging or resizing the window on some Windows 10 builds (a DWM limitation). |
| macOS 11+ | Sidebar, Under window, HUD, Window background | `NSVisualEffectView`, follows the window's active state. Needs `macOSPrivateApi` (transparent WKWebView); fine outside the Mac App Store. |
| Linux | Transparent | Tauri has no blur API on Linux. The window is transparent where the compositor supports it (GNOME, KDE, most Wayland compositors; X11 needs a compositing window manager). KDE can add blur behind via its own window rules. Without a compositor the area behind the panels may be black: pick "None". |

The main window is created `transparent: true` with an opaque webview background (`#1c1d21`), so nothing changes until a
material is chosen. Pop-out windows stay opaque. Low-power mode, High contrast and the system's reduced-transparency setting
turn the material off.

## Linux: WebKitGTK on NVIDIA

WebKitGTK's DMA-BUF renderer shows a blank, white or flickering window with the proprietary NVIDIA driver. At start-up the
shell sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` when `/proc/driver/nvidia/version` exists and the variable is not set yet
(`linux_webkit_workarounds` in `lib.rs`). To opt out, start OpenFini with `WEBKIT_DISABLE_DMABUF_RENDERER=0`. If a window
still renders black, `WEBKIT_DISABLE_COMPOSITING_MODE=1` is the heavier fallback (disables accelerated compositing; slower).

## Already in place (for reference)

- **File associations**: `.ofini` and `.ofext` per OS (`tauri.windows.conf.json`, `tauri.macos.conf.json`, Linux desktop
  file MIME types from the bundle config); files opened from the OS reach the running instance (single-instance plugin).
- **macOS**: overlay title bar with the traffic lights over the app header (`titleBarStyle: "Overlay"`); Tauri's default
  app menu provides the standard Edit roles, so Cmd+C / Cmd+V / Cmd+Z work in text fields.
- **Windows**: custom title bar (`decorations: false`) with the system shadow.

## Considered and not done

- **Windows Snap Layouts on the custom maximize button**: needs `WM_NCHITTEST` returning `HTMAXBUTTON` from a subclassed
  window procedure that WebView2 sits on top of; not feasible safely in this change. Win+Z and dragging to the screen edge work.
- **Taskbar / Dock progress** (`set_progress_bar`): no long-running task reports progress through one channel yet.
- **WebView2 browser flags**: the defaults (hardware acceleration and smooth scrolling are on) are already right; extra
  flags would only add risk.
