# Git Workflow and Releases

All changes reach `main` through pull requests; releases are Git tags that trigger a GitHub Actions build into one draft release. This page covers branches, commits, pull requests, the shared-file etiquette and the release procedure. Maintainers follow the repository's `docs/release-process.md` for the full checklist.

## Branches and commits

- `main` is protected. Required checks: Web/PWA on Ubuntu, macOS and Windows, and Rust.
- Branch names: `feat/...`, `fix/...`, `docs/...`, `refactor/...`. One topic per branch.
- Commits use Conventional Commits: `type(scope): imperative summary`, with a body that explains what and why. Types: `feat`, `fix`, `refactor`, `docs`, `test`, `build`, `perf`, `chore`.
- Pull requests are squash-merged, so the PR title becomes the history line.

```text
feat(code): add pixel-exact viewport bar

Adds width and height fields, presets and breakpoint markers to the
Code studio preview so responsive checks do not need a browser resize.
```

## Pull requests

1. Open an issue first for anything larger than a small fix.
2. Describe: Summary, What changed, How verified, Limits and what was not verified, Docs. Never claim a test you did not run.
3. Label it (`enhancement`, `bug`, `packaging`, `ci`, `dependencies`, `documentation`; `skip-changelog` to leave it out of the release notes).
4. Wait for green checks (the Rust job can flake on apt: re-run failed jobs), then squash-merge and delete the branch.
5. If another PR touched the same files, fetch, rebase onto `main`, resolve, and push with `--force-with-lease`.

## Shared files

`core/app.js`, `ui/shell.js`, `ui/menus.js`, `ui/settings-dialog.js`, `commands/index.js`, `vibe/tools/index.js`, `CHANGELOG.md` and `app/index.html` are conflict hot spots: make small additive edits, put new code in new files and new CSS in your own stylesheet, and merge `main` often.

## Changelog

Add a bullet under `## [Unreleased]` in `CHANGELOG.md` (Keep a Changelog format, one bullet group per area). Do not edit other headings or bump versions in a feature PR.

## Versioning

Semantic Versioning; while below 1.0 minor versions may change behavior or file formats. Three files carry the version (`package.json`, `package-lock.json`, `src-tauri/Cargo.toml`) and must agree; never edit them by hand:

```sh
node scripts/version.mjs set 0.8.0
node scripts/version.mjs check
```

## Release procedure (maintainers)

1. `main` is green; try the hosted PWA and the desktop app (`npm run tauri:dev`) through each studio.
2. `node scripts/version.mjs set <version>`, commit "release: OpenFini <version>", push and wait for CI.
3. Tag `v<version>` and push the tag. The release workflow runs `prepare` (version check, tests, size budget), `create-release`, six desktop build jobs plus the PWA, then checksums, and collects everything in a **draft** release. Tags with a suffix (`v0.8.0-beta.1`) are pre-releases and build NSIS only on Windows.
4. Review the draft: expected assets are the installers per platform, the PWA zip and `SHA256SUMS.txt`. Edit the notes (two or three sentences on what matters, plus anything users must do), then publish by hand. Nothing becomes public automatically.

## Documentation and decisions

Update the docs of the area you changed; hard-to-reverse decisions get an ADR ([[Decision Records]]). This wiki publishes from `wiki/` on pushes to `main` ([[Wiki Style Guide]]).

## See also

- [[Contributing]]
- [[CI and Size Budgets]]
- [[Installer Notes]]
- [[Decision Records]]
