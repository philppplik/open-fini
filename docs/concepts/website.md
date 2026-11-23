# Concept: the OpenFini website

Status: **concept**, not built. A multi-page website for OpenFini, hosted on GitHub Pages, built from this repository
(`/site`) and deployed by a GitHub Actions workflow. This page covers the information architecture, the visual
direction, the technology decision, quality targets (performance, accessibility, SEO, English and German) and a build
plan of small tasks.

Related: [roadmap-next-major.md](roadmap-next-major.md) (the roadmap page of the site renders from it and from
[known-limits.md](../known-limits.md)), [launch-screen.md](../launch-screen.md) (the artwork), [i18n.md](../i18n.md),
[wiki-maintenance.md](../wiki-maintenance.md), [release-process.md](../release-process.md).

## Goals

1. **Explain in ten seconds** what OpenFini is: one light, open-source app with Vector, Pixel, Layout, Code, Vibe (AI),
   Office and Scene studios, on the web and as a small native app, no account, AI optional.
2. **Get people to a working install** with one click on the right file for their system.
3. **Be the front door for docs** without duplicating them: render `docs/` and `wiki/` from the repository.
4. **Look like OpenFini**, not like a template. The app's own artwork, colors and real screenshots carry the design.
5. **Stay as light as the app**: no framework runtime on the page, fast on a phone, works without JavaScript.

Non-goals: a blog engine, user accounts, analytics with cookies, a web shop, hosting the PWA itself (the PWA keeps its
own deploy; the site links to it).

## Information architecture

```text
/                      Home
/studios/              Studios overview
/studios/vector/       one page per studio: vector, pixel, layout, code, vibe, office, scene
                       (office has sections for Document, Spreadsheet, Presentation, Whiteboard;
                        a "proto" page is added when the Proto Studio ships)
/features/             Everything that is not a studio: files and formats, collaboration, extensions,
                       customization, privacy and security, performance, CLI, accessibility
/download/             OS-detected primary button + all installers + PWA + package managers + checksums
/docs/                 Docs index (rendered from docs/ and wiki/)
/docs/<page>/          one page per Markdown file
/changelog/            Rendered from CHANGELOG.md, one anchor per version
/roadmap/              Rendered from docs/concepts/roadmap-next-major.md (waves) + known limits summary
/community/            Contribute, code of conduct, translations, extensions/SDK, where to ask
/press/                Press kit: logos, artwork, screenshots, boilerplate text, facts, contact
/privacy/              Privacy statement for the site and the app (no tracking; what the app sends and when)
/de/...                German mirror of every page above
/404.html              Helpful not-found page with search links
```

Navigation: a slim top bar with **Studios**, **Features**, **Docs**, **Download** (a filled button), and a language
switch (EN / DE); secondary items (Changelog, Roadmap, Community, Press, Privacy, GitHub) live in the footer. The
studio pages have a sticky studio switcher (seven small icons in studio order) so visitors can move sideways like in the
app header.

### Page contents

| Page | Content | Source of truth |
| --- | --- | --- |
| Home | Hero with the launch artwork and one sentence; the studio strip (seven studios, one screenshot each); three proof points (light: installer size and start-up numbers from `docs/performance.md`; private: no account, no telemetry; open: MIT, GitHub stars); "what is new in X.Y" from the latest changelog section; download button | `site/content/home.{en,de}.md` + data from `CHANGELOG.md`, `package.json` |
| Studio pages | What it is for, 4–6 feature blocks with real screenshots, "coming from" box (Affinity, Photoshop, Office, VS Code, DaVinci as fits), honest limits (pulled from the studio's *Known limits*), link to its docs | `site/content/studios/<id>.{en,de}.md`; limits from the docs page |
| Features | One section per cross-cutting feature with an icon (the app's own Bootstrap icon set) | `site/content/features.{en,de}.md` |
| Download | Detected OS and architecture → one primary button; table of all assets; PWA "open in browser"; checksums; "unsigned build" notice while R1.3 is open; system requirements from `docs/platform-support.md` | GitHub Releases API at runtime + build-time snapshot |
| Docs | Left nav grouped like `wiki/_Sidebar.md`; page search (pre-built JSON index, no service); "Edit on GitHub" link | `wiki/*.md` (user docs) and `docs/*.md` (developer docs) |
| Changelog | Versions with dates, anchors, "Latest" badge; Keep-a-Changelog sections styled | `CHANGELOG.md` |
| Roadmap | Waves as columns, items as cards with impact/effort; link to known limits | `docs/concepts/roadmap-next-major.md` |
| Community | How to contribute (from `CONTRIBUTING.md`), good first tasks (issues with a label, fetched at build time), translations, SDK | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `sdk/` |
| Press kit | Downloadable ZIP (logos SVG/PNG, artwork, screenshots light/dark, boilerplate EN/DE), fact sheet | `site/press/` (generated) |
| Privacy | Site: GitHub Pages logs only, no cookies, no analytics (or a cookieless, self-hosted counter if ever needed). App: summarize `docs/security.md` network section | `site/content/privacy.{en,de}.md` |

### Docs: render from `docs/` or the wiki?

Both, with a clear split: **`wiki/`** is the user-facing manual (it already has a sidebar, summaries and "See also"
sections enforced by `tests/docs/wiki-links.test.js`), so it becomes `/docs/`. **`docs/`** is developer and decision
documentation; it becomes `/docs/dev/` with its own index (ADRs listed with status). Links between them are rewritten at
build time (`[[Page]]` wiki links and relative `.md` links become site URLs). German docs are not translated by hand at
first: the German site shows the English docs with a note, and translated pages are added as `wiki/de/*.md` later.

## Visual direction

**Idea: "the studio at night".** The app's dark default (`--of-bg-app #1d1e22`, panel `#2a2b31`, accent violet
`#8b7cf6`) and the launch artwork (`app/assets/launch/artwork.webp`) set the mood: a calm, dark, workshop-like
surface where the artwork and real screenshots are the only saturated things on the page. It should feel like opening
the app, not like a SaaS landing page.

What makes it not look like an AI template:

- **No gradient blobs, no glassy cards in a 3-column grid, no stock 3D illustrations, no emoji bullets.** Every visual
  is either the launch artwork or a real, current screenshot.
- **Editorial typography:** a characterful serif display face for headlines (for example *Fraunces* or *Instrument
  Serif*, self-hosted, variable, subset) against a plain grotesk for text (*Inter* or the system UI stack). Large,
  tight headlines, generous line length limits (65–72 ch).
- **The studio strip** as the signature element: seven tall, narrow screenshot panels side by side like the app's
  studio tabs; hovering or focusing one widens it (CSS `flex-grow` transition, no JavaScript), with the studio name set
  vertically. On phones it becomes a horizontal scroll-snap row.
- **Interface details as ornament:** hairline borders like the app's panels, the 24/28 px control heights, the panel
  tab style for section switches, keyboard shortcut chips (`Ctrl+K`) in copy. Section headings carry a small mono
  label such as `STUDIO 03 / LAYOUT`.
- **Light theme too**, from the app's light tokens (`#e9eaee` background, accent `#6b58e8`), following
  `prefers-color-scheme` with a toggle; the artwork sits on a dark card in both, as on the launch screen.
- **Motion:** only small, purposeful transitions (strip widening, screenshot crossfade between light and dark);
  everything off under `prefers-reduced-motion`.

### Imagery plan

| Asset | Where it comes from |
| --- | --- |
| Hero artwork | `app/assets/launch/artwork.webp` (108 KB), served as AVIF + WebP at 640/1280/1920 widths, with the launch screen's gradient as placeholder |
| Screenshots | **Generated, not hand-made:** a script opens the built app in headless Chromium with a fixed demo document per studio, light and dark, 1x and 2x, and saves them to `site/assets/shots/`. Re-run per release so the site never shows an old UI |
| Studio icons, feature icons | The app's vendored Bootstrap icon subset (`scripts/vendor-icons.mjs`) as an SVG sprite |
| Logo / wordmark | The existing OpenFini mark and wordmark (from the launch card and `app/icons/`) as SVG |
| Social cards | Generated per page at build time: artwork crop + page title in the display face (SVG → PNG) |

The repository has no screenshots today, so the screenshot script (task W6) comes before the studio pages.

## Technology decision

**Decision: a plain Node build script with no new dependencies** (`site/build.mjs`), producing static HTML and CSS
into `site/dist/`, deployed with the official GitHub Pages actions.

| Option | For | Against |
| --- | --- | --- |
| **Plain Node script (chosen)** | Matches the project's "no framework" rule and its existing build style (`scripts/*.mjs`, esbuild); **reuses the app's own Markdown renderer** `app/src/engine/web/markdown.js` (CommonMark + GFM, heading ids, sanitizer) and syntax highlighter, so docs render exactly like the app's preview; zero new dependencies to audit; contributors only need Node | We write templating, i18n routing, sitemap and the docs nav ourselves (each a few dozen lines with tagged template literals) |
| Astro | Excellent static output, islands, i18n routing, image pipeline, content collections | Adds a large dependency tree and a second toolchain to an app that avoids frameworks; its Markdown pipeline would differ from the app's; upgrades become maintenance |
| Eleventy | Small, flexible, no client runtime | Still a new dependency and template language; less gain than Astro, more than zero |
| Jekyll (GitHub Pages default) | No build step in CI | Ruby toolchain, limited control over i18n, images and the docs link rewriting; does not reuse the app's renderer |

What the script does: read content (`site/content/**/*.{en,de}.md` with front matter, plus `wiki/`, `docs/`,
`CHANGELOG.md`), render with `renderMarkdown`, wrap in page templates (`site/templates/*.js`, functions returning HTML
strings with escaping), copy and resize assets, write `sitemap.xml`, `robots.txt`, `feed.xml` (changelog), a search
index JSON and `404.html`. Image resizing uses the platform where available: `sharp` is **not** added; instead the
screenshot script writes all needed sizes directly from Chromium, and the hero artwork variants are produced once
and committed (they change only with a release artwork).

Client JavaScript: one small module (`site/assets/site.js`, target under 6 KiB) for the theme toggle, the download OS
detection and docs search. Every page works without it.

### Download page and the latest release

- At **build time** the workflow fetches `GET /repos/philppplik/open-fini/releases/latest` (with the workflow token)
  and writes the asset list into the page, so the page is complete without JavaScript and without API rate limits.
- At **run time** `site.js` refetches `releases/latest` (unauthenticated, cached in `sessionStorage` for an hour) and
  updates the list when a newer release exists than the build saw; on failure the build-time list stays.
- **OS detection:** `navigator.userAgentData.getHighEntropyValues(["platform", "architecture", "bitness"])` where
  available (Chromium), otherwise the user agent string. Mapping: Windows x64 → NSIS `.exe` (MSI listed),
  Windows ARM64 → ARM64 `.exe`, macOS → `.dmg` (Apple Silicon vs Intel; Safari cannot tell, so offer both with Apple
  Silicon first), Linux → AppImage primary with `.deb` / `.rpm`, phones → "Open the web app". Asset names are matched by
  patterns taken from `release.yml` targets, in one table in `site.js` with unit tests.
- **Drafts:** the API's `latest` ignores drafts and pre-releases, so the page always shows a published release (today
  1.1.3; see roadmap R1). A rebuild is triggered by `release: published`.
- Checksums: if the release has a `SHA256SUMS` asset, it is shown next to each file (adding it to `release.yml` is
  task W12).

### Deploy

`.github/workflows/pages.yml`:

- Triggers: push to `main` touching `site/**`, `wiki/**`, `docs/**`, `CHANGELOG.md`, `app/assets/launch/**`;
  `release: published`; `workflow_dispatch`.
- Jobs: `build` (checkout, setup Node 24, `npm ci`, `node site/build.mjs`, link check, `actions/upload-pages-artifact`)
  then `deploy` (`actions/deploy-pages`) with `permissions: pages: write, id-token: write`, `concurrency: pages`.
- Pull requests run the build and link check only (in CI), no deploy.
- One-time owner step: *Settings ▸ Pages ▸ Source: GitHub Actions*. Optional custom domain later (`CNAME` in
  `site/static/`); until then `https://philppplik.github.io/open-fini/`, so all URLs are built with a configurable
  base path.

## Quality targets

### Performance

- Every page: HTML + critical CSS under 50 KB compressed, total under 300 KB on the home page including the hero
  image at mobile width; no render-blocking JavaScript; fonts subset and `font-display: swap`, at most two font files
  preloaded.
- Images: AVIF/WebP with `srcset`, explicit `width`/`height`, `loading="lazy"` below the fold, `fetchpriority="high"`
  on the hero only.
- Targets: Lighthouse 100/100/100/100 on Home, a studio page, Download and a docs page (mobile), LCP < 1.5 s on a
  simulated 4G phone, CLS 0. Checked in CI with Lighthouse CI against the built `dist/` (task W15).

### Accessibility

- WCAG 2.2 AA: contrast checked for both themes (the dark accent `#8b7cf6` on `#1d1e22` is about 5:1 and passes; the
  light accent `#6b58e8` on `#e9eaee` is about 4.1:1 and fails for body text, so light-theme links use a darker tint
  such as `#5843d6` and the build checks every token pair), visible focus rings, skip link, landmarks, one `h1` per page, heading order.
- The studio strip is a list of links; widening on hover is mirrored on `:focus-visible`; names are real text, not
  only rotated labels (rotated text has `aria-hidden` and a visible horizontal label on small screens).
- Screenshots have meaningful `alt` text written in the content files (the screenshot script names the scene, the
  content file describes it).
- `axe-core` run in CI on every built page (task W15).

### SEO and sharing

- Unique `<title>` and meta description per page and language; canonical URLs; `hreflang` pairs (`en`, `de`,
  `x-default`); `sitemap.xml` with alternates; `robots.txt`.
- Open Graph and Twitter cards with the generated social image; JSON-LD `SoftwareApplication` (name, OS list,
  license, offers price 0, download URL, version from `package.json`) on Home and Download.
- Clean URLs (`/studios/pixel/`), stable anchors for changelog versions (`/changelog/#1-2-0`).

### i18n (en + de)

- Content files per language (`*.en.md`, `*.de.md`); UI strings of templates in `site/i18n/{en,de}.json`, reusing the
  app's terminology from [i18n-glossary.md](../i18n-glossary.md) so the site and app say the same German words.
- English at `/`, German at `/de/`. The language switch links to the same page in the other language. No automatic
  redirect by `Accept-Language` (Pages cannot do it server-side, and forced redirects hurt SEO); instead a one-time,
  dismissible banner suggests the German site when the browser prefers German.
- Missing translations fall back to English with a visible note; the build reports missing keys and fails in CI only
  for template strings (not for docs pages).
- Dates and numbers formatted with `Intl` at build time per locale.

## Repository layout

```text
site/
  build.mjs              build entry (no dependencies beyond Node and the app's engine modules)
  lib/                   templates, routing, i18n, docs link rewriting, sitemap, search index
  templates/             page layouts as JS functions
  content/               page copy: home, studios/*, features, community, press, privacy (.en.md / .de.md)
  i18n/                  en.json, de.json (template strings)
  assets/                css/, fonts/, img/ (artwork variants), shots/ (generated), site.js
  static/                files copied as-is (favicon, CNAME later)
  dist/                  build output (git-ignored)
scripts/site-shots.mjs   screenshot generator (headless Chromium against the built app)
tests/site/              unit tests: routing, OS detection mapping, link rewriting, i18n completeness
.github/workflows/pages.yml
```

## Build plan

Small tasks, each one pull request. Order matters for the first five; after W5 most can run in parallel.

| # | Task | Acceptance | Size |
| --- | --- | --- | --- |
| W1 | **Skeleton**: `site/build.mjs`, base template, one Home page in EN, `npm run site:build` and `site:serve` (reuse `scripts/serve.mjs` with a root argument), `dist/` ignored | `npm run site:build` writes `site/dist/index.html`; no new dependencies in `package.json` | S |
| W2 | **Pages workflow**: `.github/workflows/pages.yml` (build + deploy, PR build only in CI); base path configurable | Deploys to `https://philppplik.github.io/open-fini/` after the owner enables Pages | S |
| W3 | **Design tokens and base CSS**: colors from the app's tokens (dark + light), type scale, self-hosted subset fonts, layout grid, focus styles, reduced motion | Style guide page (`/styleguide/`, not in nav) shows every token and component in both themes | M |
| W4 | **i18n routing**: `.en.md` / `.de.md`, `/de/` mirror, language switch, `hreflang`, fallback note, missing-key report | EN and DE Home build; switch keeps the page | S |
| W5 | **Header, footer, navigation**, skip link, theme toggle (`site.js`), 404 page | Keyboard-only navigation works; works with JavaScript off | S |
| W6 | **Screenshot generator**: `scripts/site-shots.mjs` builds the app, opens each studio with a demo document in headless Chromium (via the Chrome DevTools Protocol from Node, or Playwright only as a dev dependency if the owner agrees), light and dark, 1x and 2x, AVIF/WebP | 7 studios × 2 themes × 2 densities written to `site/assets/shots/`; documented in this file | M |
| W7 | **Hero and artwork**: committed artwork variants (AVIF/WebP, 3 widths), hero layout with gradient placeholder | LCP image is the hero; no layout shift | S |
| W8 | **Studio strip** component (CSS-only expand, scroll-snap on phones) | Works with mouse, keyboard, touch; reduced motion respected | S |
| W9 | **Home page** content EN + DE (proof points read from `docs/performance.md` numbers and `package.json`; latest changelog section) | Lighthouse 100s on mobile | M |
| W10 | **Studio pages** (7), one task per studio or two per PR: copy EN + DE, screenshots, "coming from" box, limits pulled from docs | Each page links to its docs; limits text matches the docs | M each (S for small studios) |
| W11 | **Features page** EN + DE | All cross-cutting features from `README.md` covered | M |
| W12 | **Download page**: build-time release snapshot, `site.js` OS/arch detection with a tested mapping table, runtime refresh, all-assets table, PWA link, requirements; add `SHA256SUMS` to `release.yml` | Correct primary button on Windows x64/ARM64, macOS, Linux, Android, iOS (unit tests on UA samples); page complete without JS | M |
| W13 | **Docs section**: render `wiki/` as `/docs/` and `docs/` as `/docs/dev/`, sidebar from `_Sidebar.md`, link rewriting, "Edit on GitHub", search index + `site.js` search | No broken internal links (checked in build); search finds page titles and headings | M |
| W14 | **Changelog, Roadmap, Community, Press, Privacy** pages from their sources; press ZIP generated | All pages in EN; DE copy for Community, Press, Privacy | M |
| W15 | **Quality gates in CI**: link check, `axe-core` on every page, Lighthouse CI budgets on 4 pages, HTML validation | CI fails on a broken link, an a11y violation or a budget overrun | M |
| W16 | **SEO**: meta, canonical, Open Graph, generated social images, JSON-LD, `sitemap.xml`, `robots.txt`, `feed.xml` | Rich-result test passes for `SoftwareApplication`; sitemap lists both languages | S |
| W17 | **Repo integration**: link the site from `README.md`, `package.json` `homepage`, the app's *Help* menu and the wiki footer; `docs/website.md` maintenance page (how to edit copy, regenerate shots, deploy) | Links live; maintenance doc reviewed | S |
| W18 | **Launch review**: design critique pass in both themes and languages on phone, tablet, desktop; fix list | Sign-off by the owner | S |

Total: roughly 4–6 weeks of part-time work; W1–W5 and W12 give a useful, deployable site within the first week.

## Open questions

- Custom domain (for example `openfini.org`)? It changes canonical URLs, so decide before W16.
- Screenshots: is Playwright acceptable as a dev-only dependency, or should W6 use the DevTools Protocol directly
  (more code, zero dependencies)?
- Should the PWA be hosted under the same Pages site (`/app/`)? It would make "Try it in the browser" one click, but
  ties the app deploy to the site deploy. Recommendation: separate path, separate workflow job, same Pages artifact.
- Translated docs: start with the five most visited wiki pages in German after launch, or keep docs English-only?
