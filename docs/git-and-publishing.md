# Git and publishing (Code studio)

Two features sit on top of the website project: **Source Control** (real Git, stored inside the document) and
**Publish** (one-click deployment). Both are lazy: nothing loads until you open the Source Control pane or the
Publish tab, and no network request is made without an explicit confirmation.

## Source Control

Open the *Source Control* pane (branch icon in the Code studio's activity bar). *Initialize repository* creates
the repository; from then on the pane shows changes, staging, a commit box, history with a graph and search,
branches, tags and the remote. The Explorer shows `A` / `M` / `D` / `U` badges, and the editor marks lines that
are added (green bar), modified (blue bar) or have lines removed below (red notch) compared with the last commit.

| Task | How |
| --- | --- |
| Stage / unstage / discard | Row buttons, section buttons, right-click. Discard asks for confirmation; untracked files are deleted. |
| Commit | Message box, `Ctrl+Enter`. With nothing staged you are offered "stage all and commit". Author name and email: Settings ▸ Code studio ▸ Source control. |
| History | Graph + list, search by message, author or id. Click a commit for per-file diffs (unified or side by side), *Restore this file*, *Compare with working copy*, *Check out (detached)*, *New branch here*, *Tag*. |
| Branches | Create (and switch), switch (double-click), delete (refuses unmerged branches unless confirmed), merge. |
| Merge | Fast-forward, or a three-way merge. Files changed on both sides are merged line by line; overlapping or adjacent edits become conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in the file. Resolve, stage, commit. *Abort merge* restores the last commit. Binary conflicts keep your version. |
| Tags | Lightweight or annotated. |
| Restore a file | Any commit's context menu, or right-click a changed file ▸ *Restore from a commit…*. |
| `.gitignore` | Honored (patterns, negation, `**`, nested files). *Add to .gitignore* in the context menu. |
| Export | *Export ZIP with .git*: the project files plus a real `.git` folder. `git log`, `git fsck --strict` and `git status` work on the extracted folder (tested against real Git). |
| Import | *Open a repository ZIP…*: a ZIP with a `.git` folder (loose objects or packfiles, with deltas) becomes a new project with its history. |

Not included: stash, rebase, cherry-pick, submodules, line-ending conversion, signed commits, rename detection
(a rename shows as delete + add).

### How it is stored

The repository is a genuine Git object database kept as `web/git/<path under .git>` entries in the `.ofini` ZIP:
`HEAD`, `config`, `refs/…`, `index` (a standard version-2 index), and one loose zlib-compressed object per blob,
tree and commit (`objects/ab/cdef…`). Because it is the same layout as `.git/`, history travels with the file.
Older OpenFini versions ignore the `web/git/` entries. Two non-standard files exist and are ignored by Git:
`openfini-conflicts` (paths of unresolved merge conflicts) and `openfini-github.json` (the id mapping of the
GitHub API sync, below). Object ids are real Git ids (the blob id of `hello\n` is `ce013625…`).

The engine is `app/src/engine/git/` (pure, synchronous, no dependencies except the vendored fflate for zlib):
`objects.js` (SHA-1, blob/tree/commit/tag), `repo.js` (refs, index, status, commit, checkout, merge, restore),
`diff.js` (Myers diff, hunks, three-way merge), `ignore.js`, `pack.js` (pack reader/writer, delta resolution, a
zlib inflater that reports stream ends), `archive.js` (ZIP import/export), `smart.js` and `github.js` (remotes).
The UI service is `app/src/ui/code/git-service.js`.

**Why not isomorphic-git?** It was evaluated (MIT, solid). It needs a Node-style `fs` adapter with real stat
semantics, Node polyfills for hashing and streams, and adds roughly 150 KB; this project keeps the working tree in
a `Map` and has a strict size budget, so a small purpose-built engine (about 1,500 lines, tested against real Git
for `fsck`, `log`, `status`, packfiles and smart-HTTP clone/push) was the better trade. Nothing is vendored for
Git, so no third-party notice is needed.

### Remotes: what works from a browser

Browsers and the desktop webview cannot talk to most Git hosts directly: GitHub's git endpoints
(`github.com/owner/repo.git/info/refs`, `git-upload-pack`) send no CORS headers, and the app has no Rust-side
network plugin. So:

1. **GitHub through its REST / Git Data API** (works from the browser). Use a personal access token
   (fine-grained, *Contents: read and write*). *Push* uploads new blobs, trees and commits and moves the branch
   (fast-forward only). *Pull* reads new commits and trees through the API, then merges them locally. *Clone from
   GitHub* creates a new project from the tree and the last 100 commits. GitHub re-serializes commits, so commit ids
   may differ from your local ones; the mapping is stored in `openfini-github.json`. The remote repository must
   already have a commit (create a README on GitHub first).
2. **Any other HTTPS Git server** (GitLab, Gitea, your own) speaks the standard smart-HTTP protocol (v0), implemented
   in `smart.js` (fetch and push, with packfiles). From a web page this only works through a **CORS proxy that you
   configure** (Remote settings ▸ CORS proxy: a prefix URL such as `https://proxy.example/`, or a template with
   `{url}`). The proxy can read your token and your code: use one you run or trust. The same code works directly
   (no proxy) wherever CORS is not an issue, for example a server that sends CORS headers. Verified end to end
   against the real `git http-backend` in the test suite.
3. A native Tauri Git command is **not** available (no Rust plugins were added).

The token is stored privately (see Security) and sent only to `api.github.com` or the configured proxy/server.
Push and Pull always show a confirmation naming the destination.

## Publish

*Publish* button in the Code studio toolbar, or *Export ▸ Publish* tab. A **target** (profile) is saved with the
project: type, non-secret settings, include/exclude patterns. Its secret is stored on this device only.

Flow: *Check and list files* (dry run: the exact files that will upload, excluded files, and the pre-publish
checks) → *Publish…* → confirmation (number of files, size, destination host, warnings) → progress with *Cancel* →
result with the address, *Copy address* and *Open site*. Every deploy is added to the **deploy history** (time,
target, URL, files, bytes) shown in the tab.

Pre-publish checks (`engine/publish/preflight.js`, the Vibe tool `preflight_site`): broken links and missing files,
dead `#anchors`, images without alt text, missing title / description / viewport / `lang`, `http://` resources on
https sites, files over 10 MB, a missing entry page. Errors do not block publishing, but the confirmation says so.

| Target | How it deploys | Needs | Notes |
| --- | --- | --- | --- |
| Netlify | `POST /api/v1/sites` (new site), then a ZIP deploy `POST /api/v1/sites/{id}/deploys`, polled until `ready` | Personal access token | Site id is remembered in the target. |
| Vercel | Files uploaded with `POST /v2/files` (SHA-1 digest), then `POST /v13/deployments`, polled until `READY` | Access token | Optional team id. Production alias is used when present. |
| GitHub Pages | One commit with the whole site to a branch (default `gh-pages`) through the Git Data API, then `POST /repos/{o}/{r}/pages` | Token with Contents and Pages access | Replaces everything on that branch; refuses the repository's default branch. Adds `.nojekyll`. |
| WebDAV / HTTP PUT | `MKCOL` for folders, `PUT` per file (Basic or Bearer auth) | Password or token | Nextcloud, ownCloud, own servers. The server must send CORS headers (allow `PUT`, `MKCOL`, `Authorization`). Credentials travel only over https (or to localhost). |
| FTP / FTPS server (desktop app) | Built into the desktop app (`src-tauri/src/ftp.rs`, below): FTPS with explicit TLS (default), implicit TLS (port 990) or plain FTP; passive mode; folders created with `MKD` | Password (kept in the key store) | Desktop only; the web build says so. *Test connection* signs in without uploading. |
| SFTP server (desktop app) | **Not built in yet** | | Use FTPS, or SFTP through the publish helper. |
| Server: FTP, FTPS, SFTP, rsync, SMTP | Through the **publish helper** (below) | Helper token; server password per upload | Browsers cannot open TCP sockets. When the helper does not answer, the dialog explains how to install Node.js and start it. |
| Cloudflare Pages | **Not available.** Direct Upload needs BLAKE3 content hashing and the Cloudflare API does not allow calls from web pages. | | Use GitHub Pages or Netlify, or connect an exported repository to Cloudflare Pages. |

These targets are written against each vendor's documented HTTP API and unit-tested with a mock `fetch`
(request shapes, polling, errors, cancellation). **Not verified here:** live calls to the vendors (no accounts or
network were used) and whether each vendor currently allows cross-origin requests from a web page; if a request is
blocked the dialog says so and suggests the helper or a different target.

### Built-in FTP/FTPS and Send by email (desktop app)

The desktop app has its own FTP/FTPS and SMTP clients in Rust ([ADR 0018](adr/0018-built-in-network-services.md);
`src-tauri/src/ftp.rs`, `smtp.rs`, shared `netio.rs`), so publishing to a classic web host and mailing an export need no
helper program and no Node.js.

* **FTP / FTPS target**: server, encryption (FTPS explicit TLS = default; implicit TLS on 990; plain FTP is offered but
  labeled as unencrypted), port, user, remote folder, public address. Passive mode (`EPSV`, then `PASV`); the data
  connection always goes to the control connection's address. File names with `..`, empty segments, backslashes or
  control characters are refused. *Cancel* stops between files.
* **Send by email** (*Export ▸ Send by email…*, uses the *Image & PDF* settings): the export is attached to a mail sent
  through your own SMTP server (STARTTLS on 587 = default, TLS on 465, or none for a server on this computer), `AUTH
  PLAIN` or `LOGIN`, MIME multipart with base64 attachments (25 MB limit), RFC 2047 subjects. The account (server, port,
  encryption, user, sender) is the `smtpAccount` setting; *Test connection* signs in without sending. The password is
  sent only over TLS (or to localhost).
* **Credentials**: the FTP and SMTP passwords are stored like the other publish secrets (`ui/code/secrets.js`: this
  device's private storage, sealed with the Vibe vault passphrase when the vault is on, encrypted by the app lock). They
  are handed to the Rust command for one call and are never logged; error messages never contain them.
* **Certificates (trust on first use)**: TLS uses the operating system's stack and trusted certificates (`native-tls`:
  SChannel on Windows, Secure Transport on macOS, OpenSSL on Linux). When verification fails, a second connection that
  sends nothing reads the server's certificate and the app asks *Trust this certificate?* with its SHA-256 fingerprint.
  On *Trust* the fingerprint is pinned (`pinnedCert` in the target, or in `smtpAccount`) and from then on exactly that
  certificate is accepted, without host name or chain checks. A different certificate later shows *Certificate
  changed* (possible interception) and needs a new confirmation. Changing the SMTP server clears its pin.
* **In the browser / PWA** these features are unavailable (no raw TCP); the target and the mail dialog say so and offer
  WebDAV, a hosted service, the helper, or saving the file instead.
* **SFTP** is not built in: an SSH client (`russh`) would add a large async crypto dependency tree for one target. Use
  FTPS, or SFTP/rsync through the helper.
* Tested: Rust unit tests (reply parsing, EPSV/PASV, paths, MIME, dot-stuffing, addresses, dates, fingerprints), and
  during development a throwaway harness drove the Rust code against local fake servers on Windows (plain FTP upload,
  FTPS explicit TLS with a protected data channel, SMTP plain/STARTTLS/implicit TLS, self-signed → fingerprint → pinned).
  **Not tested:** real FTP/mail servers and providers, macOS and Linux TLS stacks at runtime (CI only compiles them),
  servers that require TLS session reuse on the FTPS data channel (for example vsftpd with `require_ssl_reuse=YES`;
  `native-tls` cannot reuse the session explicitly, so such servers may refuse uploads).

### Publish helper

```
npm run publish:helper                # prints  Address: http://127.0.0.1:4310  and a Token
npm run publish:helper -- --port 4310 --token secret --origin https://my.app.example
```

`scripts/publish-helper.mjs` is a dependency-free Node (20+) program. Add its address and token to a *Server
(FTP / SFTP / rsync / SMTP) via helper* target. The app sends a ZIP of the site; the helper streams progress back.

* **FTP / FTPS** (explicit TLS, passive mode with `EPSV`/`PASV`, folders created automatically) and **SMTP**
  (`STARTTLS` or implicit TLS, `AUTH PLAIN`/`LOGIN`, the site mailed as a ZIP attachment) are implemented with Node's
  `net` and `tls`. The data connection always goes to the control host (the address in a `PASV` reply is ignored).
* **SFTP and rsync** use the system `sftp` / `rsync` / `ssh` binaries with **key authentication** only
  (`BatchMode=yes`; first-seen host keys are accepted and recorded unless the target requires strict checking).
  Password logins for SFTP are not supported.
* Security: listens on 127.0.0.1 only (refuses other addresses), checks the browser `Origin` (localhost, the hosted
  app, the desktop app; more with `--origin`), requires a bearer token (constant-time compare), allows one upload at
  a time (256 MB limit), rejects ZIP entries with `..`, absolute paths or control characters, validates host, user,
  port and paths (no shell is ever used; arguments are passed as arrays), never writes passwords to disk, and errors
  never echo credentials. A cancelled request aborts the upload.
* Tested against local fake FTP and SMTP servers and the HTTP interface. **Not tested here:** FTPS handshakes against
  real servers, real SFTP/rsync (needs ssh servers), and real mail servers.

## Security

* Tokens and passwords are never written into documents. They live in this device's storage (key `publish.secrets`),
  encrypted by the app lock when it is on, and sealed with the Vibe vault passphrase when the vault is enabled.
  They are sent only to the host of the target you configured; offline mode (`app.network`) blocks every outward
  call. Nothing is logged with a credential.
* Every upload, push, pull and clone goes through a confirmation dialog that names the destination. The Vibe tools
  add their own approval, and in "auto" approval mode `git_push`, `git_pull` and `publish_site` still show a dialog.
* The assistant never receives a token: `add_publish_target` stores settings only and asks the person to paste the
  secret into the dialog.

## Vibe tools

`git_init`, `git_status`, `git_diff`, `git_log` (read-only), `git_commit` (local; asks in careful mode),
`git_branch` (list, create, delete, merge), `git_checkout`, `git_restore` (asks), `git_push` and `git_pull` (ask:
network), `list_publish_targets`, `add_publish_target`, `preflight_site` (read-only) and `publish_site` (asks; names
the target and file count). "Commit this with a good message" runs `git_status`, `git_diff`, `git_commit`.

## Tests

`tests/git/` (engine against known hashes and real Git, packs, merges, smart-HTTP against `git http-backend`,
GitHub API against a fake server) and `tests/publish/` (request builders per target with a mock `fetch`, preflight,
the helper with fake FTP/SMTP servers). Git-dependent tests skip themselves when `git` is not installed.
