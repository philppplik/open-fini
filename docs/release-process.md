# Release process

A release is a Git tag. Pushing the tag makes GitHub Actions build the installers for all six
desktop platforms and the PWA, and collect everything in **one draft release**. A maintainer
reviews the draft and publishes it by hand. Nothing becomes public automatically.

## Versioning

OpenFini uses [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`, with an optional
pre-release suffix such as `0.3.0-beta.1`.

- While the major version is `0`, minor releases may change behavior or file formats; patch releases
  only fix bugs.
- A tag is the version with a leading `v`: `v0.3.0`. Tags with a suffix (`v0.3.0-beta.1`) are
  published as **pre-releases**, and their Windows build is NSIS only (the MSI format cannot
  express text pre-release identifiers).
- Three files carry the version and must agree: `package.json`, `package-lock.json` and
  `src-tauri/Cargo.toml` (plus `src-tauri/Cargo.lock` once it exists). `tauri.conf.json` reads it from
  `package.json`. Never edit them by hand; use the script, which also checks the result:

```sh
node scripts/version.mjs set 0.3.0
node scripts/version.mjs check             # verify only
```

The release workflow runs the same check against the tag and stops if they differ.

## Changelog

Release notes come from the pull requests merged since the previous release: GitHub generates them
when the draft is created and groups them by label (`.github/release.yml`). The text from
`.github/release-body.md` (install table and first-launch hints for unsigned builds) is placed above
them.

- Give every pull request a label: `enhancement`, `bug`, `packaging`, `ci`, `dependencies` or
  `documentation`. Use `skip-changelog` to leave one out.
- Edit the draft before publishing: write two or three sentences at the top about what matters most
  and mention anything users must do (file format changes, breaking behavior).

## Checklist

Before tagging

- [ ] `main` is green: CI passed on Ubuntu, Windows and macOS, and the Rust job passed.
- [ ] Open the hosted PWA (GitHub Pages) and the desktop app from `npm run tauri:dev`; open, edit,
      export and save a document in each studio, open the Code studio, create a website from a template and export it.
- [ ] `node scripts/version.mjs set <version>` and commit ("Release <version>"). Push to `main` and
      wait for CI.
- [ ] `docs/platform-support.md` still describes reality.

Release

- [ ] `git tag v<version>` on that commit, then `git push origin v<version>`.
- [ ] Watch **Actions, Release**. It runs `prepare` (version check, tests, size budget), then
      `create-release`, then in parallel six `build` jobs and `pwa`, then `checksums`.
      A failed matrix job can be re-run on its own; uploads replace earlier files of the same name.
- [ ] Open the **draft** release. Expect these assets: `OpenFini_<v>_x64-setup.exe`, `.msi` (stable
      releases only), `OpenFini_<v>_arm64-setup.exe`, two `.dmg`, three Linux packages for each of
      x64 and ARM64, `OpenFini-<v>-pwa.zip` and `SHA256SUMS.txt`.
- [ ] Run the branded Windows installer once (wizard pages render with the sidebar and header, the
      "Windows integration" page works, finish-page checkboxes, uninstall with and without "Delete the
      application data") and open the macOS DMG (background, icon positions). See [installer.md](installer.md).
- [ ] Download and start at least one installer per operating system. On a machine without the
      development tools: install, double-click a `.ofini` file, check the window title and an
      "Open With" from the file manager, then uninstall.
- [ ] Edit the notes and click **Publish release** (tick *Set as a pre-release* if the tag has a suffix).

After publishing

- [ ] Pages already redeployed from the push to `main`; confirm the hosted app shows the new version.
      Existing PWA users see the "update ready" prompt.
- [ ] Update the status column in `docs/platform-support.md` for platforms you verified.

If something is wrong: delete the draft release and the tag
(`git push origin :refs/tags/v<version>`), fix, and tag again. Never reuse a tag that was
published.

## Setting up the repository (once)

1. Push the repository to GitHub as `philppplik/open-fini` (or change the owner in `package.json`,
   `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `.github/CODEOWNERS` and the links in
   `.github/ISSUE_TEMPLATE/config.yml` and `.github/release-body.md`).
2. **Settings, Pages**: set *Source* to **GitHub Actions**.
3. **Settings, Actions, General**: workflow permissions can stay at the read-only default; the
   workflows request what they need per job.
4. **Settings, Code security**: enable Dependabot alerts and *Private vulnerability reporting*
   (the issue chooser links to it).
5. Optional: protect `main` and require the CI jobs `Web / PWA` (three OS variants) and
   `Rust (src-tauri)`.
6. After the first successful CI run, commit `src-tauri/Cargo.lock` (see `src-tauri/README.md`).

## Code signing and notarization (optional)

Without secrets the release still works: Windows installers are unsigned, macOS apps are ad-hoc
signed (needed on Apple Silicon) but not notarized, Linux packages are unsigned. Users see the
warnings described in [building.md](building.md#running-unsigned-builds). Add repository secrets
(**Settings, Secrets and variables, Actions**) to switch signing on; the workflow detects them by
itself.

### macOS (Developer ID certificate and notarization)

Needs a paid Apple Developer account.

| Secret | Content |
| --- | --- |
| `APPLE_CERTIFICATE` | Your *Developer ID Application* certificate exported from Keychain Access as `.p12`, then `base64 -i certificate.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | Optional. For example `Developer ID Application: Your Name (TEAMID)` (`security find-identity -v -p codesigning`) |
| `APPLE_ID` | Apple ID e-mail, for notarization |
| `APPLE_PASSWORD` | An app-specific password for that Apple ID (appleid.apple.com), not the account password |
| `APPLE_TEAM_ID` | Your 10-character team id |

`APPLE_CERTIFICATE` and its password enable signing; adding the other three also notarizes.
Notarization with an App Store Connect API key is possible too (`APPLE_API_ISSUER`, `APPLE_API_KEY`,
`APPLE_API_KEY_PATH`); the workflow would have to be extended to write the key file.

### Windows

| Secret | Content |
| --- | --- |
| `WINDOWS_CERTIFICATE` | A code-signing certificate as `.pfx`, base64-encoded (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`) |
| `WINDOWS_CERTIFICATE_PASSWORD` | The `.pfx` password |

The workflow imports the certificate and signs the NSIS installer and the application with SHA-256
and a DigiCert timestamp. This path suits certificates you hold as a file. Certificates issued
since June 2023 live on hardware tokens or in a cloud service; for those use Azure Artifact Signing
or Key Vault through Tauri's `bundle.windows.signCommand` instead
(<https://v2.tauri.app/distribute/sign/windows/>). Even a signed installer shows SmartScreen
warnings until it has built up reputation (extended-validation certificates skip that).
Signing on the ARM64 runner has not been tried.

### Linux

Packages are not signed. Users verify downloads with `SHA256SUMS.txt`. The workflow also records a
build provenance attestation for the release assets (`gh attestation verify <file> --repo
philppplik/open-fini`).

## Not included yet

- **Automatic updates** for the desktop app (needs the Tauri updater plugin and a signing key pair).
  Users install new versions by hand; the PWA updates itself.
- Flatpak, Snap, Homebrew, winget and Microsoft Store packages.
