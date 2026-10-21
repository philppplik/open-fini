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

## Repository security settings

Dependabot alerts, Dependabot security updates, secret scanning with push protection, private vulnerability reporting
(the advisory form above) and CodeQL code scanning are enabled. Dependabot version updates are configured in
`.github/dependabot.yml`. If a setting is ever switched off, the owner can restore it under Settings ▸ Code security.

## What counts

Examples of security-relevant issues: a crafted `.ofini`, SVG, image or font file that executes code,
reads files outside what the user opened, or crashes the app in a way that corrupts data; a flaw in the
desktop shell's permissions (`src-tauri/capabilities`) or content-security policy; a way to make the app
send data over the network.

Out of scope: problems that need a malicious browser extension or local administrator access, denial of
service by opening an enormous but valid document, and vulnerabilities in the operating system's WebView
(please report those to the vendor).

## Design notes

User-facing security tools (offline mode, app lock, protected mode, privacy tools, safe mode) and their honest limits
are described in [docs/security.md](docs/security.md); diagnostics in [docs/troubleshooting.md](docs/troubleshooting.md).

* OpenFini makes **no network requests** after installation unless you opt in to AI features (see below): no telemetry, no accounts, no remote fonts or
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
* **AI features (Vibe Studio)** are off by default (`aiEnabled`). When on, requests go only to the provider base URLs
  and MCP servers you add; the desktop Content-Security-Policy allows `connect-src` to `https:`, localhost
  and WebSockets for that purpose. API keys are stored on the device (IndexedDB / app storage), optionally encrypted
  with a passphrase (AES-GCM, PBKDF2-SHA256 250 000 iterations); they are never written to documents, logs or URLs and
  only sent to the provider's own base URL. Tool results, MCP responses, attached files and document text are treated
  as untrusted data (prompt-injection is a known limitation of every LLM agent): the permission modes ask before
  risky actions, custom tools run in a sandboxed frame without network access and can only call OpenFini tools through
  the same approvals, and the assistant cannot read your files, run commands or reach the network except through the
  connections you add. `scripts/mcp-gateway.mjs` listens on 127.0.0.1 only, checks the browser `Origin` and can
  require a bearer token.
* The service worker only serves the app's own precached files.
* Release artifacts are accompanied by `SHA256SUMS.txt`; see [docs/release-process.md](docs/release-process.md).
