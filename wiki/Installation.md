# Installation

OpenFini installs as a per-user desktop app on Windows, macOS and Linux, or runs in a browser and installs as a PWA. This page covers every route, the first-launch warnings of unsigned builds, verifying downloads, updating and uninstalling.

## Choose a route

| Route | Best for | Notes |
| --- | --- | --- |
| Desktop installer | Daily use, large files, native file dialogs | Uses the operating system's web view, so the installer is small. Works offline always. |
| PWA (browser) | Trying it out, Chromebooks, locked-down machines | Self-hosted from the PWA zip of the release. Works offline after the first visit. |
| From source | Contributors | See [[Development Setup]]. |

## Windows

1. Download `OpenFini_<version>_x64-setup.exe` (Intel/AMD) or `OpenFini_<version>_arm64-setup.exe` (ARM) from the [Releases](https://github.com/philppplik/open-fini/releases) page. Stable x64 releases also ship an `.msi`.
2. Run it. The NSIS installer installs **per user** and needs no administrator rights; the MSI installs per machine.
3. If **Windows protected your PC** (SmartScreen) appears, choose **More info**, then **Run anyway**. The builds are not code-signed unless the release notes say otherwise.

The desktop app needs WebView2 (part of Windows 11 and current Windows 10). The installer downloads it once if it is missing.

## macOS

1. Download `OpenFini_<version>_aarch64.dmg` (Apple Silicon) or `OpenFini_<version>_x64.dmg` (Intel) and drag OpenFini to Applications.
2. The build is not notarized. Control-click (right-click) OpenFini, choose **Open**, then **Open** again.
3. If macOS says the app is damaged, run this once in Terminal:

```sh
xattr -cr /Applications/OpenFini.app
```

The declared minimum is macOS 11 (Big Sur).

## Linux

| Package | Install |
| --- | --- |
| `.deb` | `sudo apt install ./<downloaded file>.deb` |
| `.rpm` | `sudo dnf install ./<downloaded file>.rpm` |
| `.AppImage` | `chmod +x OpenFini_*.AppImage`, then run it |

OpenFini needs WebKitGTK 4.1 on the host (preinstalled on most desktops). AppImages are built on Ubuntu 22.04, so they need glibc 2.35 or newer and FUSE 2 (or run with `--appimage-extract-and-run`). Alpine (musl) and 32-bit systems are not supported.

## Browser and PWA

Download `OpenFini-pwa-x.y.z.zip` from the release, unpack it on any HTTPS static host (or `localhost`) and open it. In Chrome, Edge, Brave or Opera use the install icon in the address bar. On Safari 16.4 or newer use Add to Home Screen (iOS, iPadOS) or Add to Dock (Safari 17 on macOS). Firefox runs the app in a tab and works offline through the service worker but cannot install it on desktop. Only Chromium browsers can save back to the same file (File System Access API); other browsers download a file on save. See [[Platform Support]] for the full comparison.

## Verify a download

Each release lists `SHA256SUMS.txt`:

```sh
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Updates

| Where | How updates work |
| --- | --- |
| Desktop | Install the new version over the old one. There is no auto-update. *Settings ▸ About ▸ Check for updates* compares your version with the latest GitHub release and links the installer; an optional daily check is off by default and honors offline mode. |
| PWA | The service worker downloads a new version in the background and applies it when you choose. |

## Uninstall

| System | Steps |
| --- | --- |
| Windows | *Settings ▸ Apps*, choose OpenFini, Uninstall. File associations the installer added are removed. |
| macOS | Drag OpenFini from Applications to the Bin. |
| Linux | Remove the package with your package manager (search for "openfini" among installed packages), or delete the AppImage. |
| PWA | Remove the installed app from the browser, then clear site data for the host. |

Your saved documents are ordinary files and are never touched. Local data (settings, autosaved session, AI keys) lives in the app profile; *Settings ▸ Security and privacy ▸ Delete all local data* removes it first if you want a clean exit (see [[Security and Privacy]]).

## Honest status

All installers are built by GitHub Actions. The maintainers have not yet run every one on hardware, in particular Windows ARM64 and the macOS Intel cross-build; please report problems with the issue template and include OS, architecture and web view version.

## See also

- [[Platform Support]]
- [[Quick Start]]
- [[Installer Notes]]
- [[Troubleshooting and Logs]]
