# Contributing

Contributions are welcome: code, tests, docs, translations, bug reports and accessibility fixes. This page summarizes the ground rules, the path from idea to merged pull request, good first contributions and the Code of Conduct. The repository's `CONTRIBUTING.md` is the canonical text.

## Ground rules

- Be kind: participation means you accept the [Code of Conduct](https://github.com/philppplik/open-fini/blob/main/CODE_OF_CONDUCT.md).
- **Original work only.** Follow the [[Clean-Room Policy]]: no code, assets, icons, fonts or file formats from proprietary products, no decompiled code.
- Everything user-facing is **US English**: UI text, docs, commit messages and comments.
- Keep it light: no new runtime dependencies without discussion; vendored code must be MIT-compatible and listed in `THIRD_PARTY_NOTICES.md`.

## From idea to merged PR

1. Open an issue for anything larger than a small fix so the approach can be agreed.
2. Set up ([[Development Setup]]) and create a branch `feat/...`, `fix/...`, `docs/...` or `refactor/...`.
3. Write the code following the conventions below.
4. Add tests ([[Testing]]); run `npm test` and `npm run build && npm run check:size`.
5. Commit with Conventional Commits and open a PR using the template ([[Git Workflow and Releases]]).
6. Wait for green checks ([[CI and Size Budgets]]) and respond to review.

## Code conventions

- ES modules, 2-space indent, double quotes, semicolons; follow the surrounding style and `.editorconfig`.
- JSDoc types on exported functions; comments explain why, not what; every new module gets a header comment (purpose, public API, invariants).
- **Engines are pure:** no DOM, canvas or `window` in `engine/*` and `ai/*`.
- Every document change is undoable through `doc.tx(...)` or `doc.set(...)`.
- New actions are commands; new tools extend `Tool`; new Vibe capabilities are Vibe tools; see [[Extending OpenFini]].
- Everything user-visible goes through `t()` ([[Internationalization]]); no hard-coded colors, use the `--of-*` variables ([[Themes and Surface Styles]]).
- Accessible by default: keyboard operation, ARIA labels, focus handling, contrast, reduced motion ([[Accessibility]]).
- Keep new features lazy to respect the size budgets.
- Document honestly: state limits, never claim what you did not test.

## Good first contributions

- Pick an item marked missing in [[Roadmap and Known Limits]].
- Add an adjustment or filter (an effect module under `app/src/engine/pixel`; it appears in menus and panels automatically).
- Add a preset shape in `app/src/engine/vector/presets.js`.
- Improve hyphenation, line breaking or PDF output with tests in `tests/layout`.
- Translate the interface or fix accessibility problems.
- Improve this wiki ([[Wiki Style Guide]]).

## Reporting bugs and requesting features

Use the issue templates. For bugs include the OpenFini version (*Help ▸ About*), your platform, steps to reproduce, what you expected and what happened, and a minimal `.ofini` file if possible; *Help ▸ Troubleshooting… ▸ Report an issue* prefills the form ([[Troubleshooting and Logs]]). Report **security** problems privately through the repository's security advisory form (see [SECURITY.md](https://github.com/philppplik/open-fini/blob/main/SECURITY.md)): you can expect an acknowledgement within 5 working days and a status update within 14 days.

## Code of Conduct

The project follows a Code of Conduct based on respectful, harassment-free collaboration. Read the full text in [CODE_OF_CONDUCT.md](https://github.com/philppplik/open-fini/blob/main/CODE_OF_CONDUCT.md); report concerns as described there.

## Licensing

OpenFini is released under the MIT License. By contributing you agree your work is provided under it.

## See also

- [[Development Setup]]
- [[Clean-Room Policy]]
- [[Extending OpenFini]]
- [[Git Workflow and Releases]]
