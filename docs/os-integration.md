# Operating system integration

"Open with OpenFini", double clicking `.ofini` files, the command line, and the PWA file handler and share target.
Everything a file receives from the system ends in `app.openFile(...)`, so a format that opens through
File ▸ Open also opens from the OS.

## File types

The single source of truth is `app/src/platform/file-types.js`. The installers and the manifest cannot import
JavaScript, so their lists are written out by hand and `tests/packaging/os-integration.test.js` fails when one drifts.

| Group | Extensions | What happens on open |
| --- | --- | --- |
| Owned (default handler) | `.ofini`, `.ofext` | OpenFini document; `.ofext` is an extension package (installing from a file works only when the extension system provides `app.installExtensionFile`, otherwise a message explains it) |
| Import | `.psd`, `.psb`, `.idml`, `.pdf` | Converted on open by the importers (PDF only where the PDF importer is present) |
| Images | `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.avif` | New image document |
| Code studio | `.md`, `.markdown`, `.html`, `.htm`, `.css`, `.js`, `.mjs`, `.json`, `.txt`, `.csv`, `.tex`, `.latex` | Opens like a one-file website project when no other importer claims the type |
| Other tools' files | `.ai`, `.afdesign`, `.afphoto`, `.afpub` | OpenFini explains how to export to an open format (it cannot read them) |

OpenFini never becomes the default app for anything except `.ofini` and `.ofext` just by being installed. Registering as
a viewer or editor only adds it to the "Open with" menu.

## Per operating system

**Windows** (NSIS `-setup.exe`, per user): `tauri.windows.conf.json` registers `.ofini` and `.ofext` as real
associations (Tauri writes the default program for every extension it lists, which is why the list is short).
`src-tauri/windows/open-with.nsh` (an NSIS installer hook) adds the other types as "Open with" candidates
(`OpenWithProgids`), registers OpenFini under *Settings ▸ Apps ▸ Default apps*, and sets the document icon. The MSI build
registers only the two owned types (no hook). Uninstalling removes the entries.

**macOS**: `bundle.fileAssociations` becomes `CFBundleDocumentTypes` with `LSHandlerRank` Owner (`.ofini`, `.ofext`) or
Alternate (everything else); `.ofini` and `.ofext` also export their own types (UTI `io.github.philppplik.openfini.*`).
`src-tauri/Info.plist` repeats the two exported type declarations to add the document icon (Tauri has no setting for it).
Finder, the Dock icon and "Open With" deliver files as an application event; files that arrive before the window is
ready are queued.

**Linux** (`.deb`, `.rpm`, AppImage): a custom `.desktop` template (`src-tauri/linux/openfini.desktop`) contains
`Exec=openfini %F` and the full `MimeType=` list. `openfini-mime.xml` registers the OpenFini and Affinity/PSB/IDML types
with shared-mime-info and the document icon is installed as `application-x-openfini` in the hicolor theme. The AppImage
shares the template, but integration into the menu needs a tool such as AppImageLauncher.

### Make OpenFini the default for a type

- Windows: right-click a file, *Open with ▸ Choose another app*, pick OpenFini, tick *Always*. Or *Settings ▸ Apps ▸
  Default apps*, search "OpenFini".
- macOS: select a file, press Command-I, choose OpenFini under *Open with*, click *Change All*.
- Linux: file manager ▸ Properties ▸ Open With, or `xdg-mime default openfini.desktop <mime type>`.

Settings ▸ General ▸ Open with OpenFini shows the same text. It has no button that opens the system settings:
the platform layer only opens http, https and mailto links, and the `ms-settings:` link would need a wider opener
permission, which was not worth it.

## Open folders from the file manager

A whole project folder can be opened from the OS: it becomes a website project in the Code studio, or its design files
open as documents, exactly like *File ▸ Open Folder…* or dropping a folder on the window (`openFolderEntries` in
`app/src/ui/open-folder.js`).

| OS | How | Notes |
| --- | --- | --- |
| Windows | Right-click a folder, or the empty space inside an open folder: **Open folder with OpenFini** | NSIS installer option "Add 'Open with OpenFini' to the folder right-click menu" (default on). Registry verbs under `Directory\shell` and `Directory\Background\shell`, HKCU for per-user installs. Windows 11 shows classic verbs under *Show more options* (Shift+F10). The MSI build has no hook and does not add them. |
| macOS | Finder: right-click a folder, *Open With ▸ OpenFini*; drop a folder on the Dock icon or the app | Declared as a `public.folder` document type (Viewer, Alternate). Finder has no built-in folder right-click item for apps; see the Quick Action below. |
| Linux | File manager *Open With* on a folder; `openfini ~/project` | `inode/directory` is in the `MimeType=` list. Nautilus, Dolphin and Thunar list it as an additional entry for folders; some managers ignore the list for `inode/directory` or never show an application there, and then the command line or *Open With ▸ Other application* is the way. It is not made the default folder handler. |

**macOS Quick Action (folder right-click item).** *Automator ▸ New Document ▸ Quick Action*; set "Workflow receives current
**folders** in **Finder**"; add *Run Shell Script*, "Pass input: as arguments", with the script `for f in "$@"; do open -a OpenFini "$f"; done`;
save as "Open in OpenFini". It then appears under *Quick Actions* and *Services* in the right-click menu of a folder. No
`.workflow` file is shipped because it could not be built and verified without a Mac.

Linux file managers (to add a custom right-click action yourself): Nautilus with the "Scripts" folder, Dolphin service menus,
Thunar custom actions with the command `openfini %f`.

How it works: `cli.rs` keeps existing folders as launch arguments (also from a second launch and macOS open events); a missing
path is dropped. `deliver_paths` grants the folder **recursively for this session** (`allow_directory`, only for paths the OS
handed us) and sends it with a trailing path separator, which `normalizeOpenItems` in `open-paths.js` turns into
`{ path, isDir: true }`. `open-router.js` routes it to `openFolderPath`, which reads the folder through the fs plugin
(`platform.readFolder`, `platform/folder-scan.js`): dot files and folders, `node_modules`, `dist`, `build`, `target`, `coverage`,
`__pycache__` and `venv` are skipped, symbolic links are never followed, and the caps are 3000 files, 50 MB per file, 200 MB in
total and 16 levels; when a cap hits, the folder opens with a notice. The status bar shows progress. Folders are remembered in
*Open Recent* (`{ name, path, isDir }`); reopening one reads it again by path and, if access was not kept (a folder outside
Desktop, Documents, Downloads, Pictures after a restart), opens the folder dialog on it once. The web/PWA build keeps the
directory picker (File System Access) and cannot register a right-click item.

## How files reach the app (desktop)

1. **First launch** with files (Open with, double click, `openfini a.png b.svg`): `src/cli.rs` turns the arguments into
   absolute paths (plain paths, `file://` URLs with percent encoding, UNC paths, relative paths against the working
   directory, unicode and spaces). Options, missing paths and duplicates are dropped; folders are kept (see above).
2. **Second launch** while the app runs: `tauri-plugin-single-instance` forwards the arguments and the working directory to
   the running instance, which focuses its window.
3. **macOS** file open events (Finder, Dock icon drop) arrive as `RunEvent::Opened`.
4. Allowed paths are added to the fs scope **one exact file at a time** (`allow_file`), or a handed-over folder recursively
   (`allow_directory`), for the session; there is no broad filesystem permission. The same grant lets "Save" write an opened `.ofini` back to where it came from (`doc.path`).
5. The paths are emitted as `openfini://open-files` (or returned by `take_launch_files` when the page was not ready).
   `platform/tauri.js` reads them, announces progress (`openfini:open-progress`) and delivers them through a buffer: files that
   arrive while nothing listens wait for the next `onOpenFiles` subscriber.
6. `platform/open-router.js` opens them: a file that is already open in a tab is brought to the front, large files (25 MB and
   more) show their size in the status bar, errors become toasts.

### Command line

```
openfini [--help] [--version] [FILE...]
```

`--help` and `--version` are answered before a window exists. On Windows the release build has no console of its own, so it
attaches to the console of the shell that started it (output cannot be piped from that build). `--new-window` is not
implemented: OpenFini is a single-window app with tabs.

## PWA

- `file_handlers` in `app/manifest.webmanifest` accept every type above (`launch_type: single-client`, so a second file
  opens in the existing window); `platform/web.js` consumes `window.launchQueue`.
- `share_target`: sharing files to OpenFini from another app POSTs them to `./share`. The service worker stores them in the
  `ofshare-v1` cache and redirects to `./?share=<id>`; the page opens them and empties the cache. Shared text and links are
  not accepted (files only). Works only in the production build with a registered service worker, in Chromium on Android and
  ChromeOS (and Windows for Edge/Chrome).
- `protocol_handlers` (`web+openfini`) were left out: nothing would use them.
- A plain browser tab cannot register file types; the app must be installed.

## Vibe

`get_platform_info` (OS, runtime, version, supported types, owned extensions, how to set the default) and `list_recent_files`,
both read-only.

## Limits and what was not verified

- **Not compiled here.** There is no Rust toolchain on the development machine, so `src-tauri/src/cli.rs` and `lib.rs` were
  written without `cargo check`. CI (`ci.yml`, `release.yml`) is the first compile; the unit tests in `cli.rs` run with
  `cargo test`.
- The NSIS hook, the macOS `Info.plist` merge (assumes Tauri replaces the `UTExportedTypeDeclarations` array) and the Linux
  desktop template (assumes the AppImage bundler uses the deb template) were checked against the Tauri 2.12 schema and
  installer template only, not by installing the bundles. Test an installer on each OS before relying on them.
- Folder opening (Explorer verbs, `public.folder` via `contentTypes` with an empty `ext` list, `inode/directory`, the Rust
  folder handling and the `read-dir`/`stat` permissions) is new: the NSIS script was compiled with makensis 3.11 against the
  rendered template, `cli.rs` unit tests exist, but the real Explorer, Finder and Linux file-manager behavior and the Rust
  compile were not verified here. Whether the Tauri bundler accepts a `fileAssociations` entry without extensions on every
  target is also unchecked.
- No recent-documents integration (Windows jump list, macOS Dock): Tauri has no API for it and it needs native code.
  OpenFini keeps its own recent list (File ▸ Open Recent).
- Opening recent files by path on the desktop is limited to the folders in `capabilities/default.json`; files opened through
  the OS are accessible because of the per-file grant above.
- Packaging tests (`npm test`, `tests/packaging/os-integration.test.js`) cover the pure logic and the consistency of the
  configuration files, not the operating system behavior.

## Custom title bar (desktop app)

The desktop window has no system title bar on Windows and Linux: the app header is the title bar (drag area, double-click
to maximize, minimize / maximize / close buttons on the right). On macOS the system traffic lights stay and float over the
header (`titleBarStyle: "Overlay"`). The browser and the PWA keep their own chrome. Code: `app/src/ui/titlebar.js`,
`app/src/platform/window-controls.js`.

Pitfalls:

- `src-tauri/tauri.conf.json` sets `decorations: false` and `shadow: true` (the shadow keeps the window edge visible on
  Windows 11). If the setting is not applied, the app asks the window (`isDecorated`) and draws no second title bar.
- Platform config files are merged with JSON merge patch and **arrays are replaced**, not merged. That is why
  `tauri.macos.conf.json` repeats the whole `app.windows` entry. Keep it in sync with `tauri.conf.json`.
- Every window call needs a capability in `src-tauri/capabilities/default.json` (minimize, maximize, toggle-maximize, close,
  destroy, start-dragging, is-maximized, is-decorated ...). A missing one fails silently in the UI and logs a console warning.
- `data-tauri-drag-region` only drags from the element that carries it, not from its children. Buttons and menus therefore
  stay clickable; containers between them carry the attribute too.
- Closing is intercepted (`onCloseRequested`): unsaved documents go through the usual Save / Don't Save / Cancel prompt
  (`app.confirmQuit`), then the window is destroyed (needs `allow-destroy`).
- Not verified here (no Rust toolchain, no desktop run): resize borders of the frameless window on Linux, the exact
  permission names against the installed Tauri version. CI builds the app; test the window on each OS.
- No window-state (size/position) plugin is installed, so the window size is not remembered.
