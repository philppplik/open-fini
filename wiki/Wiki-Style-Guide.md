# Wiki Style Guide

This wiki is written in US English from the repository's `wiki/` folder and published automatically to the GitHub wiki. This page defines how pages are named, structured and written, which checks apply, and how to edit and publish. Follow it so the manual stays consistent and accurate.

## Source of truth and publishing

- Edit files in `wiki/` of the repository, through a normal pull request. **Do not edit pages in the GitHub web UI**: the next sync overwrites them.
- On every push to `main` that touches `wiki/**`, the workflow `.github/workflows/wiki.yml` validates the pages and mirrors them into the wiki repository with `scripts/wiki-sync.mjs`. See `docs/wiki-maintenance.md` for the technical details and the one-time setup.
- Run `npm test` (or `npm run wiki:check`) before you push; the tests in `tests/docs/wiki-links.test.js` enforce the rules below.

## Page names and files

| Rule | Detail |
| --- | --- |
| File name | `Title-Case-With-Hyphens.md`; the page title shown on GitHub is the file name with hyphens turned into spaces |
| Uniqueness | Names must be unique, also ignoring case |
| Special files | `Home.md`, `_Sidebar.md`, `_Footer.md` |
| Reachability | Every page is linked from `_Sidebar.md` |
| Length | Under about 500 lines; split a page that grows |

## Links

- Link to wiki pages with `[[Page Name]]` or `[[text|Page Name]]`; the name uses spaces, for example `[[Vector Studio]]` for `Vector-Studio.md`. Relative Markdown links `[text](Page-Name)` also work.
- Link to repository files and deep documentation with absolute URLs on `https://github.com/philppplik/open-fini/blob/main/...`, never relative paths (they would break in the wiki).
- The link checker ignores code blocks and inline code.

## Page structure

1. `# Title` (exactly one H1).
2. One summary paragraph directly under the title: what the page covers and who it is for. No list or quote first.
3. Sections with `##` and `###`; sentence case headings.
4. A final `## See also` section with three to five related links (the Home page and sidebar are exempt).

## Writing rules

- US English spelling and punctuation, active voice, present tense, second person for instructions.
- State facts that you verified in the code or the repository docs. Never invent features. Mark limits honestly in plain words ("not supported yet", "not verified").
- Use "since 0.x" only when the CHANGELOG confirms the version.
- No marketing language, no superlatives, no emoji.
- Menus and settings: *Settings ▸ General ▸ Language* with the menu arrow `▸` and italics for UI paths; **bold** for button and control labels; `code` for keys, ids, commands, file names and paths.
- Keyboard shortcuts: `Mod+Shift+S` notation, where `Mod` is `Ctrl` on Windows and Linux and `Cmd` on macOS; say so once per page that uses it.
- Product names of other companies only where needed to describe file-format compatibility, never with logos, and never in comparative claims ([[Clean-Room Policy]]).
- Every code block has a language tag (`sh`, `js`, `json`, `text`, `markdown` and so on). Use `text` for diagrams and plain listings.
- Prefer tables for reference material and short lists for steps; keep table cells free of the pipe character.
- No private paths, user names or e-mail addresses.
- Screenshots are not required: describe the UI in text.

## Generated content

[[Keyboard Shortcuts]] is generated from the command registry and tool classes by `npm run wiki:shortcuts`. Do not edit it by hand; a test fails when it is stale. Regenerate it whenever you change a shortcut.

## Checklist for a new or changed page

- [ ] File name follows the pattern and the page is in `_Sidebar.md`.
- [ ] Summary paragraph and See also section present.
- [ ] Claims verified against the code or `docs/`; limits stated.
- [ ] Links resolve; code blocks tagged; no emoji.
- [ ] `npm test` passes.

## See also

- [[Contributing]]
- [[Repository Map]]
- [[Development Setup]]
- [[Extending OpenFini]]
