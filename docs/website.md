# The website: maintenance

The OpenFini website (<https://philppplik.github.io/open-fini/>) is built from this repository by `site/build.mjs` and
deployed by `.github/workflows/pages.yml`. Design, information architecture and the build plan are in the
[concept](concepts/website.md). This page is the how-to.

## Run it locally

```sh
npm run site:build      # site/dist; release from the GitHub API, or site/data/release.json without network
npm run site:serve      # http://localhost:4174, with the 404 page
```

`node site/build.mjs --offline` never touches the network; `--base /open-fini/` builds with the deployed base path;
`--strict` fails on a missing template string (CI uses it). The build fails on any broken internal link.

## Edit copy

| What | Where |
| --- | --- |
| Home, features, download, community, press, privacy | `site/content/<page>.en.md` and `.de.md` |
| Studio pages | `site/content/studios/<id>.en.md` and `.de.md` (front matter: title, lead, for, output, alt, coming from, limits) |
| Header, footer, buttons, labels | `site/i18n/en.json` and `de.json` (both must have the same keys; a test checks it) |
| Documentation | Nothing to do: `/docs/` renders `wiki/`, `/docs/dev/` renders `docs/`, `docs/concepts/` and `docs/adr/` |
| Changelog, roadmap | Rendered from `CHANGELOG.md` and the prioritized list in `docs/concepts/roadmap-next-major.md` |

Body sections start with `## Title {id}` or `## Title {id icon}`; the id keeps anchors identical in both languages and
`icon` is a Bootstrap icon name (add new ones to `ICONS` in `site/build.mjs`). In content files, `site:path/` links to
a page in the same language and `site-en:docs/...` to the English documentation. Facts such as the installer size, the
start-up time and "New in X.Y" are read at build time from the release, `docs/performance.md` and `CHANGELOG.md`; do
not type them into the copy.

Docs links are rewritten at build time: `[[Wiki Links]]`, relative `.md` links and GitHub links to `wiki/` or `docs/`
files become site URLs; links to other repository files go to GitHub. Heading anchors follow GitHub's rules, so
existing `#anchors` keep working. The German site has a `/de/docs/` entry page; the documentation itself is English.

## Screenshots and images

```sh
npm run site:shots                    # every studio, light and dark, 1x and 2x, artwork variants, social cards
node scripts/site-shots.mjs --social-only
node scripts/site-shots.mjs --only pixel,code --themes dark --scales 1
```

It needs Chrome, Edge or Chromium (`CHROME_PATH` overrides). Re-run it for every release and commit the results in
`site/assets/shots`, `site/assets/img` and `site/assets/social`. The scenes are built with the app's own templates and
Vibe tools (`SCENES` in the script); the social cards (`CARDS`) are 1200 × 630 JPEGs used for Open Graph.

## Release snapshot

`site/data/release.json` holds the latest published release (assets, SHA-256 checksums, publication dates). CI
refreshes it from the API on every build; refresh the committed copy with `node site/build.mjs --update-snapshot` after
publishing a release. The Download page also refreshes from the API in the browser when a newer release exists.

## Quality gates

The *Site quality gates* job runs on pull requests that touch the site, the docs or the changelog:

| Check | How | Run it locally |
| --- | --- | --- |
| Internal links | `site/build.mjs` (every `href`, `src` and `srcset`) | `npm run site:build` |
| HTML | html-validate with `site/.htmlvalidate.json` | `npx html-validate@11 --config site/.htmlvalidate.json "site/dist/**/*.html"` |
| Accessibility | `scripts/site-check.mjs`: axe-core, WCAG 2.2 A/AA, every page (light; non-docs pages also dark) | `node scripts/site-check.mjs --axe <axe-core>/axe.min.js` |
| Performance, SEO, best practices | Lighthouse CI on Home, Vector, Download and a docs page (`site/lighthouserc.json`) | `npx @lhci/cli@0.16 autorun --config=site/lighthouserc.json` |

The checkers are installed into a temporary folder in CI; they are not project dependencies. HTML rules that are off,
and why: `no-redundant-role` (lists keep `role="list"` because Safari drops list semantics with `list-style: none`),
`doctype-style` and `no-trailing-whitespace` (generated output), `no-inline-style` (Markdown table alignment);
`valid-id` is relaxed because changelog anchors are version numbers (`#1-2-0`), and `long-title` allows 120 characters
for docs page titles.

## Deploy

Pushes to `main` that touch the site, the docs, the changelog or the launch artwork, a published release and manual
runs build and deploy. The deploy runs only when *Settings ▸ Pages ▸ Source* is **GitHub Actions**; otherwise the
workflow posts a notice and skips it. The base path comes from the repository name; a custom domain would need a
`CNAME` in `site/static/` and `SITE_ORIGIN` / `SITE_BASE` in the workflow.

## Links into the site

The README, `package.json` (`homepage`), the wiki footer and *Help ▸ OpenFini Website* in the app point at the site.
