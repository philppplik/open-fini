# Installer and app icon

How the OpenFini installers are branded, what the Tauri bundler can and cannot do, and how to change it.
Pinned versions: `@tauri-apps/cli` 2.12.2 (`package.json`: `^2.12.2`), which embeds `tauri-bundler` 2.10.2;
the Rust crates are `tauri` 2.12 and `tauri-build` 2.7 (`src-tauri/Cargo.toml`). NSIS 3.11 and
`nsis_tauri_utils` 0.5.3 are downloaded by the bundler itself.

## App icon

The icon is the near-black OpenFini mark on an off-white rounded tile (`app/icons/icon.svg`, full-bleed
variant `icon-maskable.svg`, document icon `doc-icon.svg`). The earlier gradient tile with a white mark was
retired; the gradient mark `app/icons/mark.svg` remains only for the in-app brand button on the dark UI.
The source artwork `app/icons/ofini-app-icon.png` (750x750, black mark, transparent background) was compared
pixel by pixel with the vector master `app/icons/mark-black.svg`: rendered at the same scale the two overlap
by 99.5 % (the rest is anti-aliasing), so the vector path is the new mark and is used unchanged.

`npm run icons` regenerates every raster (`src-tauri/icons/*`, PWA icons, apple-touch icon, document icons)
from the SVGs with the Tauri CLI. The installer artwork follows the light look (off-white sidebar and DMG
background, dark mark).

## What the Tauri bundler supports (v2, bundler 2.10.2)

Verified against `node_modules/@tauri-apps/cli/config.schema.json` and the bundler sources at tag
`tauri-cli-v2.12.2` (`crates/tauri-bundler/src/bundle/windows/nsis/{installer.nsi,mod.rs}`).

| Target | Configurable keys | Notes |
| --- | --- | --- |
| NSIS (`bundle.windows.nsis`) | `template`, `headerImage`, `sidebarImage`, `installerIcon`, `uninstallerIcon`, `uninstallerHeaderImage`, `installMode` (`currentUser` / `perMachine` / `both`), `languages`, `customLanguageFiles`, `displayLanguageSelector`, `compression`, `startMenuFolder`, `installerHooks`, `minimumWebview2Version` | `template` replaces the whole `.nsi` (Handlebars placeholders). `installerHooks` only injects `NSIS_HOOK_PRE/POSTINSTALL` and `PRE/POSTUNINSTALL` macros; it cannot add pages. |
| WiX / MSI (`bundle.windows.wix`) | `bannerPath` (493x58), `dialogImagePath` (493x312), `template`, `fragmentPaths`, `componentRefs`, `language`, `upgradeCode`, ... | Windows x64/x86 only, not ARM64, and not built by our release workflow for the ARM64 build. Not used for branding here. |
| macOS DMG (`bundle.macOS.dmg`) | `background` (png/jpg/gif), `windowPosition`, `windowSize`, `appPosition`, `applicationFolderPosition` | Layout is applied by the bundled `create-dmg` script. No Retina (multi-resolution TIFF) background, no custom volume icon key. |
| Linux deb / rpm / AppImage | `files`, `desktopTemplate`, `section`, `depends`, `preInstallScript` / `postInstallScript` (deb, rpm) | Already used for the MIME type files and the desktop entry. |

NSIS Modern UI 2 (MUI2) can theme: the welcome/finish bitmap (`MUI_WELCOMEFINISHPAGE_BITMAP`, 164x314 BMP),
the header bitmap (`MUI_HEADERIMAGE_BITMAP`, 150x57 BMP), the icon, `MUI_BGCOLOR`/`MUI_TEXTCOLOR` for the
header and welcome/finish pages, the texts of every page (`MUI_WELCOMEPAGE_TITLE/TEXT`,
`MUI_FINISHPAGE_*`, ...), and it allows extra pages through `nsDialogs` (`Page custom`). It cannot restyle the
inner pages (license, directory, progress): those are native Win32 dialogs and look like the OS. Images must be
uncompressed BMP; 24-bit is the safe choice.

## Decision: branded NSIS, no custom bootstrapper

A fully custom-drawn installer (own window chrome, animations, web UI) needs a separate bootstrapper program
(for example a small Tauri or WebView2 app that unpacks and registers the main app). We evaluated that and
decided against it:

- Another executable to build, sign and keep alive for three architectures, plus a second WebView2 dependency
  that the installer would itself have to install before it could show a UI (chicken and egg).
- It would replace the bundler's tested logic: per-user vs per-machine install, upgrade and downgrade handling,
  uninstaller registration, silent (`/S`), passive and updater (`/UPDATE`) modes, running-app detection, and
  WebView2 installation. All of that comes for free with the stock NSIS template.
- The gain is cosmetic. A branded MUI2 wizard (sidebar, header, custom texts, one extra page) already looks
  deliberate and is what users expect from a Windows installer.

If this is ever revisited, the stock updater flow (`/UPDATE`, `/P`) is the part that must keep working.

## What was built

All sources live in `src-tauri/installer/` as SVG; `npm run installer:assets` (`scripts/installer-assets.mjs`)
renders them and writes the committed binaries. Rendering uses Edge or Chrome in headless mode (override the
browser with `OPENFINI_BROWSER`); PNG decoding and BMP/PNG encoding are done in the script with `node:zlib`.

| File | Format | Used by |
| --- | --- | --- |
| `sidebar.svg` -> `sidebar.bmp` | 164x314, 24-bit BMP | NSIS welcome and finish pages (`sidebarImage`) |
| `header.svg` -> `header.bmp` | 150x57, 24-bit BMP | NSIS page header, installer and uninstaller (`headerImage`, `uninstallerHeaderImage`) |
| `dmg-background.svg` -> `dmg-background.png` | 660x400 | DMG window (`macOS.dmg.background`, size and icon positions match) |
| `dmg-background@2x.png` | 1320x800 | Not used by the bundler (single image only); kept for a future multi-resolution TIFF |

### Windows (NSIS, `src-tauri/windows/installer.nsi`)

This is a copy of the stock 2.10.2 template with blocks marked `OPENFINI`. Pages: welcome (custom text) ->
license (the MIT `LICENSE`) -> install folder -> **Windows integration** -> install -> finish.

- **Per user, no admin prompt:** `installMode: currentUser`, default folder `%LOCALAPPDATA%\OpenFini`. The
  folder page still lets the user pick another location.
- **Windows integration page** (skipped for silent, passive and updater runs, which use the defaults or the
  choices remembered under `HKCU\Software\<publisher>\OpenFini`):
  - Associate OpenFini documents (.ofini, .ofext), recommended, default on.
  - Offer OpenFini in "Open with" for images, PDF and code files, default on. This only adds `OpenWithProgids`
    entries; it never changes the default program of an extension. Implemented by `windows/open-with.nsh`
    (conditional on this choice; its uninstall cleanup is unchanged).
  - Create a desktop shortcut, default off.
- **Finish page:** "Run OpenFini" (checked, started as the normal user) and "Open the quick-start guide
  (online)" (unchecked; opens the README on the project homepage in the browser). The desktop shortcut checkbox of the
  stock template moved to the integration page.
- **Uninstaller:** the stock "Delete the application data" checkbox is kept. It removes
  `%APPDATA%\io.github.philppplik.openfini` and `%LOCALAPPDATA%\io.github.philppplik.openfini` (the WebView2
  profile, i.e. settings and local storage) and the installer's registry values. The folder name is the
  bundle identifier, so it is reliable. Documents are never touched. Not checked on updates.
- **Language:** English and German. `displayLanguageSelector` is false, so there is no dialog: NSIS picks the
  language from the Windows display language and falls back to English (the first entry). The strings of our
  custom pages are `LangString`s in `installer.nsi` (English block and a German block); the bundler ships the
  translations of its own strings. To add a language, add it to `bundle.windows.nsis.languages` (it must be one
  the bundler has strings for) and copy the German block with the new `${LANG_<NAME>}`. The DMG and Linux
  packages stay English.

Limits and honest status: MUI2 cannot restyle the inner pages, so the look is "branded sidebar and header on a
standard Windows wizard", not a fully dark installer. Colored welcome/finish pages via `MUI_BGCOLOR` were
considered and left out because they cannot be checked without running the wizard. `makensis` is not installed
on the development machine and the installer was **not built or run locally**; the unit tests in
`tests/packaging/installer.test.js` check image formats, config references, placeholders and balanced block
directives only. The first real validation is the release workflow on `windows-latest`.

### macOS (DMG)

`bundle.macOS.dmg` sets the background, the 660x400 window and the positions of the app (180,170) and the
Applications link (480,170); the arrow in the background sits between them. The background is light, matching
the icon: Finder draws icon labels in the system label color, so dark mode may show white labels on it (not
verified on hardware). Finder shows the single PNG unscaled on Retina displays.

### Linux

Unchanged: the `.deb`/`.rpm`/AppImage packages use the new icons and the existing desktop template and MIME
files.

## Upgrading the Tauri CLI

The custom NSIS template pins the behavior of the bundler version it was copied from. After raising
`@tauri-apps/cli`, diff `src-tauri/windows/installer.nsi` against the upstream template of the new
`crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi`, merge upstream fixes and re-apply the
`OPENFINI` blocks, then run a release build.

## Sources

- Tauri config schema shipped with the CLI: `node_modules/@tauri-apps/cli/config.schema.json`
- Tauri bundler NSIS template and `mod.rs`:
  <https://github.com/tauri-apps/tauri/tree/tauri-cli-v2.12.2/crates/tauri-bundler/src/bundle/windows/nsis>
- Tauri Windows installer guide: <https://v2.tauri.app/distribute/windows-installer/>
- Tauri DMG guide: <https://v2.tauri.app/distribute/dmg/>
- NSIS Modern UI 2 reference: <https://nsis.sourceforge.io/Docs/Modern%20UI%202/Readme.html>
- nsDialogs: <https://nsis.sourceforge.io/Docs/nsDialogs/Readme.html>
