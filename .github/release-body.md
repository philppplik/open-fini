## Install

| Platform | File |
| --- | --- |
| Windows x64 | `OpenFini_<version>_x64-setup.exe` (or the `.msi`) |
| Windows ARM64 | `OpenFini_<version>_arm64-setup.exe` |
| macOS, Apple Silicon | `OpenFini_<version>_aarch64.dmg` |
| macOS, Intel | `OpenFini_<version>_x64.dmg` |
| Linux x64 | `.deb`, `.rpm` or `.AppImage` (`amd64` / `x86_64`) |
| Linux ARM64 | `.deb`, `.rpm` or `.AppImage` (`arm64` / `aarch64`) |
| Browser | `OpenFini-<version>-pwa.zip`, or use the hosted app and install it as a PWA |

Verify a download with `SHA256SUMS.txt` (`sha256sum -c SHA256SUMS.txt --ignore-missing`).

## First launch of unsigned builds

These builds are not code-signed unless the release notes say otherwise, so the operating system warns once:

- **Windows:** SmartScreen says "Windows protected your PC". Choose **More info**, then **Run anyway**.
- **macOS:** Control-click (right-click) OpenFini, choose **Open**, then **Open** again. If macOS says the app is damaged, run `xattr -cr /Applications/OpenFini.app` once.
- **Linux AppImage:** make it executable first: `chmod +x OpenFini_*.AppImage`.

More in [docs/building.md](https://github.com/philppplik/open-fini/blob/main/docs/building.md).
