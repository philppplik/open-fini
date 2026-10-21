# Wiki maintenance

The user and developer manual is a GitHub Wiki (<https://github.com/philppplik/open-fini/wiki>). The source of truth is the `wiki/` folder in this repository; a workflow publishes it. This page records the technical approach, the one-time setup, how to edit, and the limits. Conventions for writing pages are in `wiki/Wiki-Style-Guide.md`.

## Decision: repository folder plus sync, not UI editing

A GitHub wiki is a separate Git repository (`<repo>.wiki.git`). Editing it in the web UI would bypass review, tests and versioning, and the content would drift from the code. Instead:

- `wiki/` holds GitHub-wiki-format Markdown: `Home.md`, `_Sidebar.md`, `_Footer.md` and one file per page (`Page-Name.md`; links `[[Page Name]]`).
- `scripts/wiki-sync.mjs` (dependency-free Node 20+) validates the pages and mirrors them into a checkout of the wiki repository, committing and pushing when something changed.
- `.github/workflows/wiki.yml` runs on pushes to `main` that touch `wiki/**` (and on manual dispatch) with `permissions: contents: write`.
- `tests/docs/wiki-links.test.js` runs in `npm test` and in CI.
- `scripts/wiki-shortcuts.mjs` (`npm run wiki:shortcuts`) generates `wiki/Keyboard-Shortcuts.md` from the command registry.

### Why the default `GITHUB_TOKEN` is enough

`actions/checkout` can check out `<owner>/<repo>.wiki` with `token: ${{ github.token }}`, and the token's `contents: write` permission covers pushes to the wiki repository. The workflow therefore needs no personal access token.

## One-time setup (owner)

The wiki repository does not exist until the first page has been created in the web UI, even when the wiki feature is enabled (`has_wiki` is true). A push of an initial commit to `https://github.com/philppplik/open-fini.wiki.git` is refused with "Repository not found" until then. So, once:

1. Open the **Wiki** tab of the repository.
2. Click **Create the first page** (any title and content, for example "Home") and **Save**.
3. Re-run the workflow **Publish wiki** (Actions tab, *Run workflow*) or push any change under `wiki/`.

Until step 1 is done the workflow succeeds, prints a notice ("Wiki not initialized") and publishes nothing, so it is safe to merge before the wiki exists. After step 3 the sync replaces the placeholder page with the whole manual, so nothing needs to be copied by hand.

## Editing

1. Change or add files under `wiki/`; add new pages to `_Sidebar.md`.
2. Run `npm run wiki:shortcuts` if you changed a shortcut or command, then `npm test`.
3. Open a pull request. After the merge to `main`, the workflow publishes.

Never edit in the web UI: the sync deletes pages that are not in `wiki/` and overwrites the rest.

## What the checks enforce

- Unique page names (case-insensitive) and valid file names.
- `Home.md`, `_Sidebar.md`, `_Footer.md` exist.
- Every `[[Page]]` and relative `[text](Page-Name)` link resolves to a page; links inside code are ignored.
- Every page is reachable from `_Sidebar.md`.
- Each content page has an H1, a summary paragraph directly after it, and a `## See also` section (Home is exempt from the last).
- No private paths, no personal data, no emoji, code fences tagged and closed, pages at most 500 lines.
- `Keyboard-Shortcuts.md` equals the generator's output.

Links from the wiki to repository files use absolute `https://github.com/philppplik/open-fini/blob/main/...` URLs. They follow the branch, so they stay valid when files change but not when a file is renamed; check them when you move a document.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Workflow notice "Wiki not initialized" | Do the one-time setup above |
| Push to the wiki fails with 403 | Repository setting: *Settings ▸ Actions ▸ General ▸ Workflow permissions* must allow write, or the workflow's `contents: write` was removed |
| Tests fail on `Keyboard-Shortcuts.md` | Run `npm run wiki:shortcuts` and commit |
| A deleted page is still online | The sync removes `.md` files absent from `wiki/`; re-run the workflow |
| Images | Optional: put files in `wiki/images/`; they are copied, and pages reference them with `images/name.png` after publishing |

## Limits

The sync was verified locally (validation, copy and the shortcut generator) and by the tests. The first publish to the real wiki repository could not be run before the wiki existed; the first workflow run after the one-time setup is the real verification.

## See also

- `wiki/Wiki-Style-Guide.md`
- [development.md](development.md)
- [release-process.md](release-process.md)
