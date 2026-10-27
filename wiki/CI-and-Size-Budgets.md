# CI and Size Budgets

Every pull request runs the same checks that gate a release: tests on three operating systems, a production build, a gzip size budget and a Rust build. This page lists the workflows, the budgets and what to do when a check fails.

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| CI (`ci.yml`) | Push to `main`, pull requests | **Web / PWA** on Ubuntu, Windows and macOS (Node 24): `npm ci`, `npm test`, `npm run build`, `npm run check:size`, uploads the web build from Ubuntu. **Rust** on Ubuntu 22.04: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo check` |
| CodeQL (`codeql.yml`) | Push and pull requests to `main`, weekly schedule | Static analysis |
| Release (`release.yml`) | Tag `v*` | Version check, tests, size budget, six desktop builds plus PWA, checksums, draft release ([[Git Workflow and Releases]]) |
| Wiki (`wiki.yml`) | Push to `main` touching `wiki/**` | Validates and publishes the wiki ([[Wiki Style Guide]]) |

The required checks for merging are Web/PWA (three systems) and Rust. A Rust job can flake while installing apt packages: re-run the failed jobs.

## Size budgets

`npm run check:size` (`scripts/check-size.mjs`) measures gzip level 9 sizes of the build against `scripts/size-budget.json`:

| Budget | Value | Meaning |
| --- | --- | --- |
| `startupJsGzipKiB` | 380 | JavaScript that must load before the app is usable (index modules and their static imports) |
| `shellJsGzipKiB` | 1180 | Every `.js` file outside `vendor/`: the app, its lazy studios, panels and engines, and the service worker |
| `totalGzipKiB` | 2048 | Everything the browser downloads from `dist/` except fonts, license texts and on-demand libraries (PDF import, KaTeX), which are not precached |

The 0.7.0 collaboration code added 50 KiB to the shell budget because it is all lazy; start-up only gained small command stubs. Budgets are raised deliberately and in the same PR that explains why.

### Staying within budget

- Load anything not needed at start with `import()`.
- Heavy libraries go in `app/vendor/` and load on demand.
- Prefer pure functions and plain data over frameworks.
- Check locally with `npm run build && npm run check:size`, which prints startup, total app and download sizes.

## When a check fails

| Failure | What to do |
| --- | --- |
| Tests fail on one OS only | Line endings, path separators or timing; reproduce with that OS and avoid `\` in paths |
| `check:size` fails | Find what grew (bundle output in `dist/assets`), make it lazy, or justify and raise the budget |
| `i18n:check` fails | Run `npm run i18n:extract` and update translations |
| `ext:pack-all --check` fails | Run `npm run ext:pack-all` and commit the packages |
| Packaging tests fail | A file-type list drifted; update `file-types.js` and the hand-written installer lists |
| `wiki:shortcuts` check fails | Run `npm run wiki:shortcuts` and commit the page |
| Rust fmt or clippy fails | `cargo fmt --all` and fix the warnings |

## Other automation

Dependabot updates npm and GitHub Actions dependencies. Issue and PR templates live in `.github/`; release notes are generated from labeled PRs (`.github/release.yml`).

## See also

- [[Testing]]
- [[Git Workflow and Releases]]
- [[Performance and Low Power]]
- [[Installer Notes]]
