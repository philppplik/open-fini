# Lorem & Data Filler

Placeholder content for designs and prototypes: lorem ipsum (words, sentences, paragraphs), realistic fake names,
emails, phone numbers, addresses, dates, prices, product names and companies, initials avatars, all deterministic by
seed. Code studio: fake-data lists, tables and card grids. Not installed by default: *Studio ▸ Extensions… ▸ Available
extensions*.

**Permissions:** `document.read`, `document.write` (set text, add shapes and text, insert HTML), `ui`. No network, no
storage; the data is generated locally.

## What you get

- **Panel "Data Filler"**. *Screenshot, described:* a row of preset buttons (Article block, Headline, People names,
  Product + price, Email, Smart fill), a content menu and a seed field, *Fill selected text layers* and *New seed*, a
  preview box that shows what the current settings produce (with a count and *Copy*), and either an *Avatars* section
  (design studios) or a *Code studio* section with *List*, *Table* and *Card grid* buttons.
- **Commands:** *Fill Selected Text with Placeholder Data…* (Text menu), *Insert Initials Avatars…*, *Insert HTML List /
  Table / Card Grid with Fake Data…* (Code studio), *Open Panel*.

## Smart fill

With *Smart (by layer name)* a layer named "Email" gets an email address, "Price" a price, "Headline" a few words,
"Description" a paragraph, and so on. Short text boxes get short text. The same seed always gives the same content, so a
design can be regenerated identically.

## Limits

The API has no access to the text cursor of the Code editor, so HTML blocks are inserted into the page body (use
*Insert HTML* semantics of the designer) and you move them where you want. Names and addresses are invented from small
word lists; any resemblance to real people is coincidental. Dates and prices are US formats.

## Code layout

`src/lib.js` (PRNG, generators, HTML blocks, runners; tested in `tests/extensions-bundled/data-filler.test.js`),
`src/main.js`, `src/panel.js` + `panel/`.
