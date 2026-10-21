# Platform Support

OpenFini runs as a Tauri v2 desktop app on six OS/architecture combinations and as a PWA in current browsers. This page lists the matrix, what differs between desktop and browser, and how files reach the app from the operating system (file associations, the command line, the PWA file handler).

## Desktop matrix

| OS | Arch | Formats | Web view | Minimum OS | Status |
| --- | --- | --- | --- | --- | --- |
| Windows | x64 | NSIS `-setup.exe`, MSI | WebView2 | Windows 10 | Built in CI, not yet hardware-tested |
| Windows | ARM64 | NSIS `-setup.exe` | WebView2 | Windows 11 on ARM | Built in CI, not yet hardware-tested |
| macOS | Apple Silicon | `.dmg` | WKWebView | macOS 11 | Built in CI, not yet hardware-tested |
| macOS | Intel | `.dmg` | WKWebView | macOS 11 | Cross-compiled in CI, not yet hardware-tested |
| Linux | x64 | `.deb`, `.rpm`, `.AppImage` | WebKitGTK 4.1 | Ubuntu 22.04, Debian 12 or newer | Built in CI, not yet hardware-tested |
| Linux | ARM64 | `.deb`, `.rpm`, `.AppImage` | WebKitGTK 4.1 | same | Built in CI, not yet hardware-tested |

Wayland and X11 both work. Capabilities follow the web view of the operating system.

## Desktop versus browser

| Feature | Desktop app | Browser / PWA |
| --- | --- | --- |
| Open and save | Native dialogs, real paths, Save rewrites the same file | File System Access API in Chromium; file chooser and download elsewhere |
| File associations | `.ofini` and `.ofext` open on double click; 23 other types appear under "Open with" | The same types through the PWA file handler (Chromium) and share target |
| Offline | Always | After the first visit |
| Updates | Install a new version | Automatic, applied when you choose |
| Command line | `openfini [--help] [--version] [FILE...]` | Not applicable |
| Windows | Pop-out windows are real OS windows | Pop-ups of the same origin (see [[Multi-Window]]) |

## Browsers

| Browser | Run in a tab | Install | File System Access |
| --- | --- | --- | --- |
| Chrome, Edge, Brave, Opera (current) | yes | yes | yes |
| Safari 16.4 or newer | yes | yes | no (saves download) |
| Firefox (current) | yes | no on desktop | no (saves download) |

The build targets ES2022, which needs Chromium 94, Firefox 93 or Safari 15.4 at minimum; older browsers are not tested. In a normal tab a few shortcuts (`Ctrl+N`, `Ctrl+W`, `Ctrl+T`) are reserved by the browser; install the PWA for the full set.

## File types and "Open with"

The list of file types lives in one place in the code (`app/src/platform/file-types.js`); installers and the web manifest are kept in sync by a test.

| Group | Extensions | What happens |
| --- | --- | --- |
| Owned | `.ofini`, `.ofext` | OpenFini is the default handler |
| Import | `.psd`, `.psb`, `.idml`, `.pdf` | Converted on open |
| Images | `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.avif` | New image document |
| Code studio | `.md`, `.markdown`, `.html`, `.htm`, `.css`, `.js`, `.mjs`, `.json`, `.txt`, `.csv`, `.tex`, `.latex` | One-file website project |
| Other tools' files | `.ai`, `.afdesign`, `.afphoto`, `.afpub` | OpenFini explains how to export to an open format |

Installing OpenFini never makes it the default app for anything except `.ofini` and `.ofext`. To make it the default for another type:

- **Windows:** right-click a file, *Open with ▸ Choose another app*, pick OpenFini, tick *Always*; or *Settings ▸ Apps ▸ Default apps*.
- **macOS:** select a file, press `Cmd+I`, choose OpenFini under *Open with*, click *Change All*.
- **Linux:** file manager *Properties ▸ Open With*, or `xdg-mime default openfini.desktop <mime type>`.

## Command line

```sh
openfini --version
openfini --help
openfini poster.ofini photo.png
```

A second launch while the app is running forwards its files to the running window, which opens them in new tabs. There is no `--new-window` flag; use *File ▸ New Window* (see [[Multi-Window]]).

## Desktop window

On Windows and Linux the app header is the title bar (drag to move, double-click to maximize). On macOS the system window controls float over the header. The window size is not remembered.

## Not verified

The Rust shell and the installers were written against the Tauri 2 documentation and verified by CI builds, not by installing on every system. The NSIS hook, the macOS `Info.plist` merge and the Linux desktop template deserve a manual check per OS.

## See also

- [[Installation]]
- [[Installer Notes]]
- [[File Formats]]
- [[Multi-Window]]
