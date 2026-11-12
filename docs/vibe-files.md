# Vibe: local files and native web reading

Two desktop-only capabilities of the assistant that a web page cannot have: reading and writing files in folders the
person grants, and reading web pages that do not allow cross-origin requests. Both are off by default. User guide:
[vibe-studio.md](vibe-studio.md); threat model: [security.md](security.md).

## Local files

*Settings ▸ Artificial intelligence ▸ Local files* (desktop app only; the switch is disabled in the browser).

| Tool | What it does | Approval |
| --- | --- | --- |
| `local_list_folders` | Lists the granted folders and their scope. | none (no file system access) |
| `local_list_files` | Lists a folder inside a grant, 1 to 4 levels, at most 2,000 entries; symbolic links are listed, not followed; subfolders that cannot be read are skipped. | every call |
| `local_read_file` | Reads a text file (default limit 1 MiB, adjustable up to 20 MiB); binary files are refused; the text is wrapped in `<untrusted_file_content>`. | every call |
| `local_write_file` | Creates or replaces a text file in a read-and-write grant, optionally creating folders; at most 20 MiB. | every call, showing path and size |

These tools ask in every permission mode, also in Auto, and the per-tool *Always allow* does not apply to them.

**Grants.** *Add folder (read only)…* and *Add folder (read and write)…* open the native folder picker **in the
desktop process** (`files_grant_pick`), so a compromised page cannot grant itself a path. A drive or file system root
cannot be granted. Grants are stored in `file-grants.json` in the app's config folder, survive restarts and can be
switched between read only and read and write, or revoked, at any time.

**Path sandbox (`src-tauri/src/fileaccess.rs`).** Every call canonicalizes the path (resolving `.`, `..` and
symbolic links) and requires the result to lie inside a granted folder, compared component by component (a sibling
`granted-evil` is not inside `granted`). For writes the deepest existing ancestor is canonicalized the same way, the
part that does not exist yet must be plain names, writing through a symbolic link is refused, on Unix a file with
several hard links is refused, and the granted folder itself is never written. Writes go to a temporary file that is
then renamed. Relative paths are refused.

**Audit log.** Every grant, scope change, revoke, listing, read and write is appended to
`file-access-audit.jsonl` in the app's log folder: time, operation, path, grant id, byte count, success or error. File
contents are never logged. The panel shows the newest 200 rows and can clear the log. At 2 MiB the log is rotated
(one previous file is kept).

**Limits.** Hard links cannot be detected on Windows. A file can change between approval and the write (the approval
shows the path, not a diff). The tools are separate from *File ▸ Open Folder* and from `run_command`: granting a
folder here does not let the assistant run programs there.

## Native web reading and keyless search

In the desktop app plain `GET` requests of the web tools (`fetch_page`, `scrape_page`, `crawl_site`,
`download_image`, `rag_add_source` with a URL, and the search backends without API keys) go through the native
command `web_get` (`src-tauri/src/webfetch.rs`) instead of the web view's `fetch`, so pages without CORS headers can be
read. Requests with custom headers (API keys), bodies or other methods (`http_request`, Brave, Tavily) keep using the
web view.

What still applies unchanged: the *Web access* switch, approval per domain, allow and block lists, size and time
limits, image checks and the `<untrusted_web_content>` wrapping (`app/src/vibe/web-access.js`). What the native side
adds or enforces again:

- only `http`/`https`, no user info, no control characters, ASCII host names (punycode);
- the host is resolved natively and **every** resolved address must be public (loopback, private, link-local, CGNAT,
  multicast, documentation, unspecified and IPv4-mapped forms are refused); the connection goes to the checked
  address, so DNS rebinding between check and connect does not work. The browser build cannot resolve names and only
  checks literal addresses and local names;
- redirects are returned, not followed, so the page checks and approves every hop;
- no cookies, credentials or `Referer`; `Accept-Encoding: identity`; the `User-Agent` names OpenFini;
- at most 25 MiB and 60 seconds per request.

**Keyless search.** The backend *DuckDuckGo (no key)* reads DuckDuckGo's plain HTML results page and parses titles,
links and snippets (`parseDuckDuckGo`). It is meant for occasional searches by a person: automated use may be rate
limited or answered with a human check, which OpenFini reports and never tries to solve. In the browser the results
page cannot be read, so this backend falls back to Wikipedia, and the approval card shows Wikipedia as the host that
is contacted.

**Not built: a headless browser.** Rendering pages with JavaScript in a hidden web view was considered and left out:
Tauri 2 offers no supported way to read a page's DOM back from a remote-origin web view without granting that page IPC
access, and a hidden window running arbitrary sites with the app's network position is a larger attack surface than
the plain GET above. Pages that only render with JavaScript return little text; the result says how many characters
were found.

## Code

| Part | Location |
| --- | --- |
| Native GET, URL and address checks, HTTP/1.1 reader (tests inside) | `src-tauri/src/webfetch.rs` |
| Grants, path sandbox, audit log (tests inside) | `src-tauri/src/fileaccess.rs` |
| Page side of the native GET | `app/src/vibe/native-web.js`; used by `web-access.js` and `web-scrape.js` |
| Tools | `app/src/vibe/tools/local-files.js` |
| Settings panel | `app/src/ui/vibe/panel-files.js` (lazy) |
| Command lists kept in sync | `tests/packaging/commands.test.js` (`generate_handler!`, `build.rs`, `capabilities/default.json`) |
| Tests | `tests/vibe/web-native.test.js`, `tests/vibe/local-files.test.js` |
