---
title: Community
description: How to contribute to OpenFini: code, translations, extensions, bug reports and good first tasks. MIT licensed, developed in the open on GitHub.
headline: Built in the open. Come and help.
lead: >
  OpenFini is a small, fast, dependency-light creative suite, and contributions keep it that way. Fix a bug, add a
  filter, translate the interface, write an extension or improve the docs.
issues_title: Good first tasks
issues_empty: >
  No open issue carries the *good first issue* label right now. The [roadmap](site:roadmap/) and the
  [known limits](site-en:docs/dev/known-limits/) list what is missing, and the developer guide names small first
  contributions.
---

## Contribute code {code}

1. Open an issue for anything larger than a small fix, so the approach can be agreed first.
2. Create a branch such as `feat/short-name` or `fix/short-name`. `main` is protected; changes arrive through pull
   requests with passing CI.
3. Follow the conventions: ES modules, JSDoc on exported functions, pure engines without the DOM, every document
   change undoable.
4. Run `npm test`, `npm run build` and `npm run check:size`, then open a pull request that explains the problem, the
   approach and how you checked it.

Everything user-facing is US English, and only original work is accepted: read the
[clean-room policy](site-en:docs/dev/clean-room/). [Contributing guide](https://github.com/philppplik/open-fini/blob/main/CONTRIBUTING.md)

## Good starting points {start}

- Add an adjustment or filter as an `EffectModule`; it appears in the menus and panels automatically.
- Add a preset shape to the Vector studio.
- Improve hyphenation, line breaking or PDF output, with tests.
- Find and fix accessibility problems.

## Translate {translate}

The interface is in US English and German, and a new language is one translation file away. The
[internationalization guide](site-en:docs/dev/i18n/) explains the catalog, the checks and how to add a language; the
[glossary](site-en:docs/dev/i18n-glossary/) keeps terms consistent.

## Extensions and the SDK {extensions}

Sandboxed `.ofext` extensions add commands, panels, themes, templates and Vibe tools. `npm run ext:create` starts a
new one from a template and `npm run ext:pack` packs it. See the [extension guide](site-en:docs/extensions/) and the
[SDK reference](site-en:docs/extension-sdk-reference/).

## Report a bug {bugs}

Use the [issue templates](https://github.com/philppplik/open-fini/issues/new/choose). Include the OpenFini version
(*Help ▸ About*), your platform, steps to reproduce, and what you expected; attach a small `.ofini` file if you can.
Report **security** problems privately through the
[security advisory form](https://github.com/philppplik/open-fini/security/advisories/new), not as public issues.

## Code of conduct {conduct}

Be kind. Everyone who takes part agrees to the
[code of conduct](https://github.com/philppplik/open-fini/blob/main/CODE_OF_CONDUCT.md); reports go to the
maintainers privately, through the channel described in the security policy.
