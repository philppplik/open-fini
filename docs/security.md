# Security and privacy tools

This guide describes the security features you can use in OpenFini and, just as important, what they do **not**
protect against. For reporting vulnerabilities see [SECURITY.md](../SECURITY.md).

Open **Settings ▸ Security and privacy** (or *Help ▸ Security Check…*). Everything below is on that page.

## Threat model in one paragraph

OpenFini is a local-first app. Documents live in files you choose; recovery copies, recent files, settings and
(optionally) AI keys live in the browser or app profile on your device. It makes no network requests of its own
except what you switch on: AI providers and MCP servers you add, publishing, extensions you grant network access,
update checks of the installed web app, sign-in with OpenRouter. The main risks we address are: leaking a key or
private data through a log or bug report, data lying around unencrypted on a shared computer, running a website
project you did not write, and an extension or AI tool doing more than you expected. We do **not** defend against
malware or an attacker with administrator rights on your computer, a compromised operating system or web view, or
someone watching your screen.

## Security check

A live list of what is on or off, with a plain explanation and a fix button where one exists:

* **AI features** on or off, which providers are connected and whether they run on this device.
* **Stored API keys**: encrypted with a passphrase (Vibe vault or app lock) or stored unencrypted, with a button to set a passphrase.
* **Extensions** installed, enabled, and the permissions they were granted (shown as a warning when they can use the
  network, read files or change documents). The list comes from the extension host; with none installed it says so.
* **Network-capable features in use** and offline mode.
* **Content-Security-Policy and sandboxing**: the desktop app enforces a restrictive CSP; in the browser the hosting
  server decides (the check reads the response header of this page and says when there is none). Website previews and
  custom tools run in sandboxed frames.
* **Storage encryption** (app lock).

The same data is available to the Vibe assistant as the `get_security_status` tool (never returns keys).

## Offline mode (network kill-switch)

*Settings ▸ Security and privacy ▸ Offline mode* blocks every outbound feature at once. Each of them refuses with
a clear message instead of failing silently:

| Kind (`app.network.allowed(kind)`) | What it covers |
| --- | --- |
| `ai` | AI providers, image generation, MCP servers |
| `publish` | Publishing and deployment |
| `extension` | Network access of extensions |
| `cdn` | Remote scripts, fonts and images in website previews (the preview gets a Content-Security-Policy that blocks them) |
| `update` | Update checks of the installed web app |
| `oauth` | Sign-in with a provider |
| `other` | Anything else (also used for unknown kinds) |

Loopback addresses (`localhost`, `127.x.x.x`, `::1`) are not blocked, so local models (Ollama, LM Studio) keep
working: nothing leaves the device. Offline mode does not stop links you click from opening in your browser; that
is controlled by *Ask before opening links*.

**For developers:** call `app.network.allowed(kind, url?)` or `app.network.assert(kind, url?)` (throws
`NetworkBlockedError`, `code === "offline_mode"`) before any outbound request. The policy is the pure module
`app/src/core/network.js`.

## App lock

An optional passphrase lock screen, on start, after a chosen idle time, when the window is hidden, or on demand
(*Lock OpenFini*, `Ctrl+Alt+L`, also in the OpenFini menu).

With the lock on, these are **encrypted at rest** on this device: the autosaved session, the recent-files list and
the stored copies behind it, stored AI API keys and Vibe chats. The encryption is the same WebCrypto vault as the AI
key passphrase: PBKDF2-SHA256 (250,000 iterations) derives an AES-GCM-256 key; the key lives only in memory while
unlocked and is dropped when the app locks.

Honest limits:

* It protects **data stored on this device** (another person using the computer, a copied or backed-up profile). It
  does not protect against malware, a compromised OS or someone with access to the running unlocked app.
* Open documents stay in memory while the app is locked; the lock screen covers and disables the interface.
* Documents you saved as files are **not** encrypted. Settings are not encrypted either (they contain no secrets).
* A forgotten passphrase cannot be recovered. The lock screen offers to delete the protected data and remove the
  lock; your saved files are untouched.
* The lock screen is a convenience layer in the page: someone who can edit the app's local storage can remove the
  screen, but the encrypted data stays encrypted.

## Opening untrusted files: protected mode

*Protected mode for files from outside* (on by default): a website project that you open from a file or folder
starts with preview scripts **off**. A banner in the preview offers *Enable scripts* for that project in this
session. Projects you create in OpenFini are trusted. Browsers and web views do not tell us whether a file came from
the internet, so every website project opened from a file is treated as outside. The existing *Run JavaScript in the
preview* setting still switches scripts off everywhere. The preview is sandboxed either way (see SECURITY.md).

## Links

*Ask before opening links in your browser* is honored in the website preview, Vibe chat links (which can come from
the model), help links and About. Only `http(s)`, `mailto` and `tel` links are ever opened.

## Privacy tools

Clear recent files, the autosaved session, logs, added fonts, AI data, extension data (the data extensions saved;
the extensions stay installed) and **all local data** (type `DELETE` to confirm; also removes the lock, AI keys and the
offline copy of the app, then reloads). *What OpenFini stores* lists every kind of stored data with its size and can
be saved as JSON: keys, descriptions and sizes only, never values or file names.

## Integrity self-check

*Check app files* compares the files this page was served with against the hashes recorded in the build's
`sw.js` precache manifest (12 hex characters of SHA-256 per file). It finds damaged downloads, stale caches and
half-applied updates. It is only available in release builds (the development server has no manifest) and it
cannot detect a server that serves modified files **and** a matching manifest: for that, compare the installer or
archive with `SHA256SUMS.txt` from the release page. By default libraries under `vendor/` are skipped (tick the box
to include them).

## Safe mode

Start with `?safe=1` (*Troubleshooting ▸ Restart in safe mode*): no session restore, extensions off, AI off, and your
saved settings are not applied (defaults are used). Nothing is deleted; changes you make to a setting in safe mode
are merged into your saved settings. See [troubleshooting.md](troubleshooting.md).

## What the logs contain

The log never contains document contents. API keys (`sk-…`, `AIza…`, `ghp_…` and similar), bearer tokens,
credentials and token query parameters in URLs, `password=` style pairs, e-mail addresses and your user name inside
file paths are removed **when an entry is recorded**, so they cannot reach the viewer, a report or a bundle.
Redaction is pattern based: an unusual secret format may slip through, which is why reports are shown to you before
anything is opened or saved. Logs stay on this device; a few recent errors are kept between sessions (clear them under
Privacy tools).
