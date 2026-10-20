# 0008: Bundled extensions are data, packed from source, installed on demand

Status: Accepted

## Context

We want useful extensions that ship with OpenFini without being installed or enabled by default, work in the web/PWA
and desktop builds, go through the normal consent dialog and stay out of the application's size budget. The extension
runtime loads one `main` script per extension and has no module loader in its sandbox.

## Decision

- Extensions live in `extensions/<folder>/` as source (manifest, `src/lib*.js` pure modules, `src/main.js`, panel files).
- `scripts/pack-extensions.mjs` validates the manifests with the app's validator, bundles by concatenation (stripping
  `export`, inlining `_shared` imports) and writes committed `extensions/packages/*.ofext` plus `extensions/catalog.json`.
  A test fails when they are stale.
- The build copies the catalog and packages to `dist/extensions/` as plain data, excluded from the service worker precache;
  the dev server maps the same URLs. The gallery is part of the lazy extension manager and installs through
  `ExtensionHost.install` with the consent dialog.
- Missing API (image export) was added additively behind a new permission, `export`, instead of giving the extension more
  powerful permissions.

## Consequences

Packages are committed binaries (small, deterministic, checked in CI). Bundled extensions are first-party but are
sandboxed exactly like third-party ones; their permissions are pinned by a test. Concatenation means lib files cannot
import each other freely (only `_shared/` and sibling `lib*.js`).
