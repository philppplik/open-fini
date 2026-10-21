# Security and Privacy

OpenFini is local first: documents are files you choose, and settings, the autosaved session, recent files and optional AI keys stay in the app profile on your device. It makes no network requests of its own except for features you switch on. This page lists what stays on the device, the network kinds, the security tools, and, just as important, what they do not protect against. Report vulnerabilities privately as described in [SECURITY.md](https://github.com/philppplik/open-fini/blob/main/SECURITY.md).

## What stays on your device

| Data | Where | Leaves the device when |
| --- | --- | --- |
| Documents | Files you save | You share, publish or push them |
| Settings, recent files, autosaved session | App profile (`localStorage`, IndexedDB) | Never |
| AI keys, chats, memory, skills, knowledge | App profile, optionally encrypted | A request goes to the provider you chose |
| Publish and Git tokens | App profile, encrypted with the app lock | Sent only to the host of the configured target |
| Collaboration identity and keys | Memory only (nickname and picture on device) | Encrypted frames go through the relay |

There is no telemetry and no account. The offline-capable app makes no network calls after installation, except opt-in features: AI providers and MCP servers you add, publishing and Git remotes, extensions you grant network access, update checks (manual by default), OpenRouter sign-in, library downloads in the Code studio, and collaboration relays.

## Threat model in one paragraph

The risks addressed: leaking a key or private data through a log or bug report, data lying around unencrypted on a shared computer, running a website project you did not write, and an extension or AI tool doing more than you expected. **Not** defended against: malware or an attacker with administrator rights, a compromised operating system or web view, or someone watching your screen.

## Security check

*Settings ▸ Security and privacy* (or *Help ▸ Security Check…*) shows live status with fix buttons where possible: AI features and providers, whether stored keys are encrypted, extensions and their permissions, network-capable features in use and offline mode, the Content-Security-Policy and sandboxing, and storage encryption. The assistant can read the same data with `get_security_status` (never keys).

## Offline mode

*Offline mode* blocks every outbound feature at once, each with a clear message:

| Kind | Covers |
| --- | --- |
| `ai` | AI providers, image generation, MCP servers |
| `publish` | Publishing and deployment |
| `extension` | Network access of extensions |
| `cdn` | Remote scripts, fonts and images in website previews |
| `update` | Update checks |
| `oauth` | Sign-in with a provider |
| `collab` | Collaboration relays (rooms on this device and a relay on `localhost` keep working) |
| `other` | Anything else |

Loopback addresses (`localhost`, `127.x.x.x`, `::1`) are not blocked, so local models such as Ollama keep working. Links you click still open in your browser; *Ask before opening links* controls that.

## App lock

An optional passphrase lock screen on start, after an idle time, when the window is hidden, or on demand (*Lock OpenFini*, `Ctrl+Alt+L`). While on, the autosaved session, recent files and their stored copies, stored AI keys, Vibe chats and stored versions are **encrypted at rest** (PBKDF2-SHA256 with 250,000 iterations deriving an AES-GCM-256 key held only in memory while unlocked).

Honest limits: it protects data stored on the device (another person using the computer, a copied profile), not against malware or someone using the unlocked app. Open documents stay in memory while locked; the lock screen only covers the interface. Files you saved are **not** encrypted and settings are not encrypted (they contain no secrets). A forgotten passphrase cannot be recovered: the lock screen offers to delete the protected data and remove the lock, leaving your saved files untouched.

## Untrusted files: protected mode

On by default: a website project opened from a file or folder starts with preview scripts **off**; a banner offers *Enable scripts* for that project in this session. Projects you create in OpenFini are trusted. The preview is sandboxed either way (a frame without `allow-same-origin`, so page scripts cannot reach OpenFini).

## Other protections

- **Sandboxes:** website previews, custom Vibe tools and extensions run in sandboxed frames; extensions get a CSP with no network ([[Extensions]]).
- **Links:** only `http(s)`, `mailto` and `tel` links are ever opened.
- **Privacy tools:** clear recent files, the autosaved session, logs, added fonts, AI data, extension data, or all local data (type `DELETE`). *What OpenFini stores* lists every kind of stored data with its size (never values or file names).
- **Integrity self-check:** *Check app files* compares served files with hashes in the build's service-worker manifest (release builds only). It cannot detect a server that serves modified files and a matching manifest; compare installers with `SHA256SUMS.txt`.
- **Safe mode:** `?safe=1` (*Troubleshooting ▸ Restart in safe mode*) starts without session restore, extensions or AI, using default settings ([[Troubleshooting and Logs]]).
- **Logs:** never contain document contents. API keys, bearer tokens, credentials, URL token parameters, invite codes, e-mail addresses and user names in paths are redacted when an entry is recorded. Redaction is pattern based; an unusual secret format may slip through, so reports are shown to you before anything is opened or saved.

## AI and prompt injection

Text from outside (web pages, MCP replies, attachments, canvas text) is data, not instructions, but no model is immune to prompt injection. Use Careful or Balanced approval mode with untrusted content ([[Vibe Providers and Permissions]]).

## Collaboration rooms

End-to-end encrypted with signed envelopes; the relay sees only IP addresses, room ids, member counts, frame sizes and timing. See [[Collaboration]] for the threat table and limits, including no per-message forward secrecy.

## Desktop shell

The desktop Content-Security-Policy is restrictive: `connect-src` allows `https:`, `ws:`, `wss:` and localhost; scripts come from `self`, `data:` and three CDNs. File access is granted one exact file at a time for files opened through the OS, and the shell uses Tauri capabilities rather than broad permissions.

## See also

- [[Collaboration]]
- [[Extensions]]
- [[Troubleshooting and Logs]]
- [[Vibe Providers and Permissions]]
