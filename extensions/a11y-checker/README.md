# Accessibility Checker

Audits the open document and explains how to fix what it finds. Works in every studio. Not installed by default:
*Studio ▸ Extensions… ▸ Available extensions*.

**Permissions:** `document.read` (layers, project files), `document.write` (the "Fix" buttons), `ui`, `files` (saving
the Markdown report through the system dialog), `storage` (remembers the last result).

## What it checks

**Vector, Pixel, Layout (current page)**

| Rule | Severity | Fix |
| --- | --- | --- |
| Text contrast against the color behind it (4.5:1, 3:1 for large text; opacity is taken into account) | error below 3:1, else warning | set a suggested text color |
| Text smaller than 12 px | warning (error below 9 px) | set to 12 px |
| Image without alt text | warning | adds a placeholder alt text you then edit |
| Reading order of text layers (stack vs visual order) | note | none |
| Text over images or gradients, empty text layers | note | none |

The "color behind" is the first layer below the text whose opaque solid fill covers the text's center, else the page
color (white is assumed when none is set, and the message says so).

**Code studio (all HTML and CSS files of the project)**

Missing `lang`, missing `<title>`, no `<main>` landmark, zoom disabled in the viewport meta tag, images without `alt`,
form fields without labels, buttons and links without names, generic link text ("click here"), heading order and
multiple `h1`, positive `tabindex`, duplicate ids, iframes without titles, click handlers on non-interactive elements,
videos without captions, CSS color pairs below WCAG contrast within one rule, removed focus outlines. It also lists what
the app's own problem engine reports (`check_problems`) as notes. Fixes: add `lang="en"`, add a marked alt placeholder,
add an `aria-label` from a placeholder, remove a positive `tabindex`.

## Using it

*Screenshot, described:* a toolbar (*Run audit*, *Fix all*, *Export report (.md)*, a severity filter), a one-line
summary ("5 errors, 3 warnings, 2 notes"), and a list of issue cards with a colored left border by severity, the
message, the location and rule, a *Select* button (selects the layer, or the element in the Code studio designer) and
a *Fix* button when a safe fix exists. *Export report* writes a Markdown file grouped by severity.

## Limits

Automatic checks cover a subset of WCAG 2.2 and cannot judge meaning, cognitive load or real assistive-technology
behavior; a clean result does not mean the document is accessible. Placeholder alt texts must be replaced by you.
Element selection in the Code studio matches the n-th element of a tag in the page outline and can miss after
structural edits; run the audit again. Contrast over images and gradients cannot be measured and is reported as a note.

## Code layout

`src/lib.js` (design and HTML/CSS audits, report, runners; tests in `tests/extensions-bundled/a11y-checker.test.js`),
`extensions/_shared/color.js` (contrast math shared with Palette Pro), `src/main.js`, `src/panel.js` + `panel/`.
