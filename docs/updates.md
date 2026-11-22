# In-app updates

The desktop app can update itself: **Help ▸ Check for Updates** (and *Settings ▸ About ▸ Check for updates*) shows the new
version, its date and release notes, then **Download and install** with a progress bar, then **Restart now** or **Later**.
It uses the official Tauri v2 updater plugin. Until the owner adds a signing key (below) the app behaves as before and
points to the release page; nothing breaks and no error is shown.

## How it works

1. The app asks `https://github.com/philppplik/open-fini/releases/latest/download/latest.json`. GitHub serves that name only
   for the latest *published* release (drafts and pre-releases are never offered).
2. `latest.json` lists, per platform, the update file and its minisign signature. The Release workflow creates it
   (tauri-action, `uploadUpdaterJson`) from the signed artifacts: Windows x64 and ARM64 (the NSIS installer),
   macOS Apple Silicon and Intel (`.app.tar.gz`), Linux x64 and ARM64 (AppImage).
3. The plugin compares versions (no downgrade), downloads over https and **verifies the signature against the public key
   built into the app**. A bad signature stops the update with a clear message; nothing is installed.
4. "Restart now" first autosaves the open documents into the recovery store (restored at the next start), then installs
   and relaunches. On Windows the NSIS installer closes the app itself, so the dialog tells people to save files first.
   "Later" keeps the downloaded update for this session only; it is offered again at the next check.

The flow is a small state machine (`app/src/core/update-flow.js`, tested with a fake plugin). The update policy is the
existing setting: automatic checks off (default), on (a quiet toast, at most once a day, at start-up) and, with
*Download updates in the background*, the update is also downloaded and verified. Nothing is ever installed or restarted
without the user choosing *Restart now*. Offline mode blocks the check; a network failure shows "could not reach github.com".

### Where updating is not offered

| Install | What the app shows |
| --- | --- |
| Windows, installed with the NSIS setup | in-app update |
| Windows portable copy, MSI installs, development builds | release page |
| macOS app in Applications | in-app update |
| macOS app run from a disk image or quarantined (translocated) | release page |
| Linux AppImage | in-app update |
| Linux .deb, .rpm, Flatpak, any distribution package | "Update it with your package manager" |
| Build without a public key (forks, local builds) | release page |
| Web / PWA | "Reload the page"; the service worker fetches the new version in the background |

## Switching it on (owner, once)

1. Create the key pair on your own machine (keep the private key out of the repository):

   ```
   npx tauri signer generate -w ~/.tauri/openfini.key
   ```

   Choose a password. This writes `openfini.key` (private) and `openfini.key.pub` (public).
2. In the GitHub repository, **Settings ▸ Secrets and variables ▸ Actions**:
   - Secret `TAURI_SIGNING_PRIVATE_KEY`: the content of `openfini.key`.
   - Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password (omit if empty).
   - **Variable** (not a secret) `TAURI_UPDATER_PUBKEY`: the content of `openfini.key.pub`.
3. Push a `v*` tag as usual. `scripts/updater-config.mjs` writes a config overlay (`plugins.updater.pubkey`, the https
   endpoint, `bundle.createUpdaterArtifacts`) for the build; the updater plugin is registered only because that public key
   is present (`src-tauri/src/updater.rs`). Without the secret or the variable the workflow prints a warning, builds the
   release exactly as before and skips update artifacts and `latest.json`.
4. Lose the private key and installed apps can never be updated in place again (they would need a manual reinstall with a
   new public key), so back it up. Do not rotate it casually.

The first release built with the key cannot update older installs (they have no updater); from the next release on, apps
update themselves.

## Verifying

- After the release build, the draft release has `latest.json` and `*.sig` files next to the installers. Check that
  `latest.json` has all six platform entries and the right version.
- Publish the release, then open `https://github.com/philppplik/open-fini/releases/latest/download/latest.json`.
- Install the previous signed release, choose *Check for Updates*: it should show the new version, download, and restart.
- Negative test: edit a `.sig` in a copy of the release; the app must refuse with the signature message.

## Security

See [security.md](security.md#in-app-updates).
