# Internationalization

OpenFini ships in US English and German. The language is chosen automatically from the system and can be changed in *Settings ▸ General ▸ Language*. The English text of every string is its translation key, so adding a language means translating one JSON file. This page covers using the language setting, wrapping strings in code, adding a language and the known gaps.

## For users

| Setting | Behavior |
| --- | --- |
| Automatic (default) | Follows the system language (`navigator.languages`); `de-AT` and `de-CH` match German |
| English (United States) or Deutsch | Fixed choice; switches live |

Detection order: the `?lang=` URL override, the `language` preference, then the browser or system language, then English. The Vibe assistant replies in the interface language unless you write in another one; built-in skills, tool descriptions and system instructions stay English because they are instructions to the model. Documentation and this wiki are English only.

## For developers

Code lives in `app/src/i18n/` (runtime `index.js`, pure `format.js` and `detect.js`, DOM helpers `dom.js`, the list of languages `locales.js`, and catalogs in `locales/`).

```js
import { t, N_ } from "../i18n/index.js";
t("Save As…");                                         // English text is the key
t("Open {name}", { name });                            // named placeholder
t("{n, plural, one {# page} other {# pages}}", { n }); // plural; # is the formatted number
t("menu.file", "File");                                // explicit id for ambiguous strings
const LABEL = N_("Undo");                              // mark static data now, call t(LABEL) when rendering
```

Rules: call `t()` when the text is shown, not at module load; never build sentences from fragments; never wrap user data; escape literal braces as `\{` and `\}`; `other` is mandatory in plurals. For UI built once use `ta({ "aria-label": "Undo" })` and `tspan("Export")` from `i18n/dom.js`; plain HTML may use `data-i18n` attributes. Command labels, menu tables, tour steps, What's new, studio blurbs, the settings schema, dialog helpers and toasts are translated automatically when rendered.

Dev flags: `?lang=de` forces a language, `?i18n=keys` shows keys instead of text, `?navlang=de-DE,en` pretends the browser languages.

## Add a language

1. Copy `app/src/i18n/locales/en.json` to `<code>.json` and translate the values (keep placeholders and plural structure; delete entries you do not translate, they fall back to English).
2. Add one entry to `LOCALES` in `app/src/i18n/locales.js` (`code`, `tag`, `name` in its own language, `englishName`, `url`).
3. Run `npm run i18n:check` (it is part of `npm test`); `node scripts/i18n-extract.mjs --missing <code>` lists untranslated keys.
4. Add new terms to the glossary [i18n-glossary.md](https://github.com/philppplik/open-fini/blob/main/docs/i18n-glossary.md).

The language list in Settings is generated from `LOCALES`. Changing an English string changes its key: run `npm run i18n:extract` and update the translations.

## Tooling

`npm run i18n:extract` rewrites `locales/en.json` from the sources and prints per-locale coverage. `npm run i18n:check` fails when `en.json` is stale, a locale has unknown keys, placeholders differ, a plural lacks `other` or the syntax is invalid; `--strict` also fails on untranslated keys.

## Extensions

Manifest strings may use `%key%` placeholders resolved from `locales/<code>.json` in the package ([[Extension SDK Reference]]). `openfini.i18n` is not exposed inside the sandbox yet.

## Known gaps

- Right-to-left is wired (`dir` follows the locale) but no RTL language exists yet.
- Some areas are not fully wrapped yet, for example parts of the export and import dialogs, diagnostics and some panel and tool names (see `docs/i18n.md` for the current list).
- The OS locale hook of the desktop shell is not implemented; the web view's languages already follow the OS.
- The Windows installer is localized separately ([[Installer Notes]]).

## See also

- [[Settings Reference]]
- [[Extending OpenFini]]
- [[Glossary]]
- [[Accessibility]]
