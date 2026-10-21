# Development Setup

You can work on OpenFini with only Node.js and Git: the application has no build step in development. Rust is needed only for the desktop shell. This page covers prerequisites, the commands you will use, the dev server flags, and how to build the PWA and the desktop app.

## Prerequisites

| To | You need |
| --- | --- |
| Work on the web app, run tests, build the PWA | Node.js 20 or newer (24 LTS recommended) and npm |
| Build the desktop app | Additionally Rust 1.90 or newer and your platform's libraries: Visual Studio Build Tools with the ARM64 component on Windows, Xcode Command Line Tools on macOS, `webkit2gtk-4.1` packages on Linux (see `src-tauri/README.md`) |

## Get the code and run it

```sh
git clone https://github.com/philppplik/open-fini.git
cd open-fini
npm install       # esbuild, the Tauri CLI, CodeMirror, KaTeX, polygon-clipping
npm start         # http://localhost:4173, serves app/ as is: edit and reload
npm test          # all tests (Node built-in runner, no browser)
npm run build     # production PWA in dist/
npm run check:size
```

`npm start` runs `scripts/serve.mjs`, a tiny static server with `Cache-Control: no-store`. Flags:

| Flag | Effect |
| --- | --- |
| `--port 8080` | Another port (use your own port when several checkouts run) |
| `--host 0.0.0.0` | Reachable from a phone on your network |
| `--root dist` | Serve the production build (how to test the PWA and service worker) |
| `--csp` | Also send the desktop app's Content-Security-Policy, so violations show in the console before you build the desktop app |

During development the service worker is inert; it only works in builds that inject the version and file list. The app is exposed as `window.openfini` for scripting in the browser console (`setStudio`, `run(commandId)`, `prefs`, `doc`, `toast`, `emit` and `on`). Useful URL parameters: `?studio=code`, `?fresh=1` (no session restore), `?safe=1`, `?lang=de`, `?i18n=keys`, `?notour`.

## Desktop app

```sh
npm run tauri:dev     # desktop app with live reload (needs Rust)
npm run tauri:build   # installers for your platform
```

The Rust shell cannot be compiled on every dev machine; CI is the first real build, so keep Rust changes small and `cargo fmt` clean.

## Other scripts

| Script | Purpose |
| --- | --- |
| `npm run relay` | Collaboration relay ([[Collaboration Relay Setup]]) |
| `npm run mcp:gateway` | stdio MCP gateway ([[MCP and Knowledge]]) |
| `npm run publish:helper` | FTP, SFTP, rsync and SMTP helper ([[Export and Publish]]) |
| `npm run i18n:extract`, `npm run i18n:check` | Translation catalog ([[Internationalization]]) |
| `npm run ext:create`, `ext:pack`, `ext:pack-all` | Extension tooling ([[Extension SDK Reference]]) |
| `npm run icons`, `installer:assets` | Regenerate icons and installer art |
| `npm run wiki:shortcuts`, `wiki:check` | Wiki tooling ([[Wiki Style Guide]]) |
| `node scripts/version.mjs set <version>` | Release version bump ([[Git Workflow and Releases]]) |

## What `npm run build` does

It copies `app/` to `dist/` (without sourcemaps and unused Shoelace translations), bundles and minifies each module script of `app/index.html` with esbuild (ES2022, split at `import()`), keeps `app/vendor/shoelace/` as separate files, hashes assets, writes the service worker precache manifest and copies the extension catalog and packages.

## Windows notes

Use Git Bash or PowerShell; the scripts are cross-platform Node. Prefer an editor that preserves UTF-8 and LF line endings.

## See also

- [[Repository Map]]
- [[Testing]]
- [[CI and Size Budgets]]
- [[Contributing]]
