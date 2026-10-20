# 0007 — Internationalization: the English text is the key

**Status:** Accepted

## Context

OpenFini has about 330 UI modules with hard-coded US English strings. We want German as the first translation, chosen
automatically from the system language, with a path to more languages, and we cannot afford a rewrite of every module.

## Decision

* `t("Save As…")` — the **English source text is the key**. A missing translation falls back to the English text for free,
  code stays readable, and conversion of existing code is mechanical. Ambiguous strings get an explicit id with a default:
  `t("menu.file", "File")` (the id is the catalog key).
* Static data tables (menus, command labels, tour steps) keep plain English strings and are translated **when read or
  rendered**: `App.registerCommand` exposes `label` as a getter that calls `t()`, menus call `t()` while building, so a
  language switch needs no re-registration.
* A script (`scripts/i18n-extract.mjs`) scans the sources and generates the catalog `app/src/i18n/locales/en.json`; locale
  files are JSON maps `key -> translation`. CI fails on a stale catalog, unknown keys, placeholder mismatches and invalid
  plural syntax; missing translations are reported, not fatal.
* Message syntax is a small ICU subset (named placeholders, `plural`, `select`, `\{ \}` escapes). Apostrophes are literal
  because English text is the key and is full of them.
* Only the active locale is fetched (lazy JSON, `new URL(..., import.meta.url)` so the build rewrites it).
* Adding a language is data-driven: one entry in `app/src/i18n/locales.js` plus `locales/<code>.json`.

## Alternatives considered

* **Opaque ids everywhere** (`t("menu.file.saveAs")`): robust against copy edits, but unreadable code, a huge up-front
  migration and every missed string shows an id. Rejected; ids stay available for the ambiguous cases.
* **A library (i18next, FormatJS):** adds weight to a startup budget of 380 KiB gzip and a build step for something the
  `Intl` APIs already cover. Rejected.

## Consequences

* Editing an English string changes its key: the translation falls back to English until the catalog is updated (the check
  lists it as missing). That is the accepted price of readable code; use an explicit id for strings that change often.
* Strings assembled from fragments cannot be translated; use placeholders (`t("Open {name}", { name })`) instead.
* Built-in Vibe skills and tool descriptions stay English: they are instructions to the model, not UI.
