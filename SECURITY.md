# Security policy

## Supported versions

OpenFini is in alpha. Only the **latest release** receives security fixes.

| Version | Supported |
| --- | --- |
| latest `0.x` release | yes |
| older releases | no |

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private
[security advisory form](https://github.com/philppplik/open-fini/security/advisories/new)
(Security tab ▸ *Report a vulnerability*). Include:

* what is affected (version, platform, desktop app or PWA),
* steps or a file that reproduce the problem,
* the impact you believe it has.

You can expect an acknowledgement within **5 working days** and a status update within **14 days**. We
will coordinate a fix and a disclosure date with you and credit you in the release notes unless you prefer
otherwise.

## What counts

Examples of security-relevant issues: a crafted `.ofini`, SVG, image or font file that executes code,
reads files outside what the user opened, or crashes the app in a way that corrupts data; a flaw in the
desktop shell's permissions (`src-tauri/capabilities`) or content-security policy; a way to make the app
send data over the network.

Out of scope: problems that need a malicious browser extension or local administrator access, denial of
service by opening an enormous but valid document, and vulnerabilities in the operating system's WebView
(please report those to the vendor).

## Design notes

* OpenFini makes **no network requests** after installation: no telemetry, no accounts, no remote fonts or
  scripts (a website project previewed in the Code studio loads only what that project references). The desktop app ships a restrictive Content-Security-Policy (`src-tauri/tauri.conf.json`).
* Files are opened by explicit user action (dialog, drop, OS file association). The desktop app's
  permissions (`src-tauri/capabilities/default.json`) allow reading and writing only inside the Desktop,
  Documents, Downloads, Pictures and application-data folders, plus files the user picks in native dialogs;
  there is no shell or process-spawning permission.
* SVG import is parsed with `DOMParser` into OpenFini's own node types; scripts, event handlers and
  external references in SVG are never executed or fetched.
* The Code studio previews website projects in an `<iframe sandbox="allow-scripts …">` **without**
  `allow-same-origin`: project scripts cannot read the application, its storage or other documents, and the
  inspector talks to the app only through `postMessage` (messages are accepted from that frame's window only).
  The preview inherits the app's Content-Security-Policy (`data:` scripts, `https:` media, no `fetch` to other
  servers in the desktop app). Opening an untrusted project runs its scripts in that sandbox — do so as you
  would open an untrusted web page.
* The service worker only serves the app's own precached files.
* Release artifacts are accompanied by `SHA256SUMS.txt`; see [docs/release-process.md](docs/release-process.md).
