// Built-in LaTeX skills (Code studio, tool group "LaTeX"). SKILL.md strings parsed by parseSkill() in skills.js; format
// reference: docs/vibe-skills.md. No backticks or template placeholders inside the markdown.

const WRITE_PAPER = `---
name: write-paper
description: Write or extend a scientific paper or thesis chapter in LaTeX in the Code studio: structure, sections, math, figures, tables, citations and a bibliography, then compile and fix errors.
version: 1.0.0
tags: [latex, writing, science]
allowed-tools: latex_outline, latex_insert_snippet, latex_insert_table, latex_insert_figure, latex_insert_bibliography, latex_compile, latex_fix_errors, list_files, read_file, write_file, edit_file, create_website, ask_user
params:
  - "topic: What the paper is about"
  - "class: Document class (default article)"
when-to-use: write a paper, LaTeX paper, thesis, Hausarbeit, wissenschaftliche Arbeit, Abschlussarbeit in LaTeX
---
# Write a paper in LaTeX

## Workflow
1. Call latex_outline. If there is no .tex file, write main.tex with write_file (or latex_insert_snippet with snippet article into a new file): documentclass, amsmath, graphicx, hyperref, title, author, abstract.
2. Agree on the structure once with ask_user when the topic is vague: Introduction, Related work, Method, Results, Discussion, Conclusion is a safe default.
3. Write section by section with edit_file. Give every section, figure, table and equation a label (sec:, fig:, tab:, eq:) and refer to them with ref or eqref, never with hard-coded numbers.
4. Figures: latex_insert_figure with a project image. Tables: latex_insert_table, numbers right-aligned, units in the header.
5. Citations: put entries in references.bib with latex_insert_bibliography and cite keys with cite. Never invent references: ask the user for sources or mark placeholders clearly as TODO.
6. Call latex_compile (asks for approval). If there are errors call latex_fix_errors, fix the reported lines with edit_file and compile again, at most three rounds.

## Rules
- Math in $...$ or equation environments; escape special characters in text: \\% \\& \\_ \\# \\$.
- One sentence per line keeps diffs readable.
- Without a TeX engine (web or none installed) the approximate preview still works; say that the PDF needs the desktop app.

## Verify
latex_compile reports no errors (or, without an engine, latex_outline shows every section and no missingKeys). Read each line aloud in your head for the abstract and the first paragraph: short, concrete, no filler.
`;

const FIX_ERRORS = `---
name: fix-latex-errors
description: Find and fix LaTeX compile errors and warnings from the log (undefined commands, missing packages, unbalanced braces, math mode, undefined references and citations).
version: 1.0.0
tags: [latex, debugging]
allowed-tools: latex_compile, latex_fix_errors, latex_outline, read_file, edit_file, ask_user
when-to-use: LaTeX error, fix latex, does not compile, Undefined control sequence, Missing $ inserted, LaTeX Fehler, kompiliert nicht
---
# Fix LaTeX errors

1. Call latex_fix_errors. If there is no log yet, call latex_compile first (it asks for approval).
2. Fix the first error first: TeX errors cascade, later ones often disappear. Read the context lines and the hint.
3. Typical fixes: add the missing usepackage to the preamble; escape _ % & # in text; close the brace or environment that the hint points to; put math into $...$; correct a misspelled command.
4. Warnings about undefined references or citations: check latex_outline (labels, cited and missingKeys). A missing key belongs in the .bib file; never invent bibliographic data, ask the user.
5. Compile again. Stop after three rounds and report what is left, with file and line.

## Common messages
- Undefined control sequence: a typo (\\beign) or a command from a package that is not loaded.
- Missing $ inserted: math characters (_ ^) in text, or a math command outside math mode.
- File not found: a missing image, an input file with a wrong path, or a package that is not installed.
- Runaway argument or paragraph ended before ... was complete: a brace that never closes.
- LaTeX Error: \\begin ... ended by \\end ...: environments are crossed or misspelled.
- Overfull hbox: a line is too wide; reword, allow hyphenation or break a long URL with the url package. It is only a warning.

## Verify
latex_compile ends with ok true and no errors in the problems list. Read each line aloud that you changed to make sure the text still says the same thing; fixes must not change the meaning.
`;

const BEAMER = `---
name: make-beamer
description: Create a LaTeX Beamer presentation (slides) from an outline or an existing paper, with a title slide, sections and one message per frame.
version: 1.0.0
tags: [latex, slides]
allowed-tools: latex_outline, latex_insert_snippet, latex_insert_figure, latex_compile, latex_fix_errors, write_file, edit_file, read_file, list_files, ask_user
params:
  - "source: Paper file or topic to turn into slides"
when-to-use: beamer, latex slides, latex presentation, Folien in LaTeX
---
# Make a Beamer presentation

1. If a paper exists, call latex_outline on it and use its sections as the agenda.
2. Write slides.tex with write_file: documentclass beamer, a simple theme (default or metropolis if installed), title, author, date, a title frame and one section per part.
3. One message per frame: a frame title that states the point, at most five bullets of a few words, or one figure (latex_insert_figure with width 0.9 linewidth).
4. Equations only when the audience needs them; use the same symbols as the paper.
5. Finish with a summary frame and a frame for questions or contact.
6. Compile with latex_compile and fix errors with latex_fix_errors.

## Design rules
- 16:9 aspect ratio (documentclass[aspectratio=169]{beamer}) unless the user needs 4:3.
- Large type: no text below footnotesize, at most about 40 words per frame.
- Show data as figures, not tables of numbers; highlight the one number that matters.
- Use pause or overlays sparingly; they make handouts harder to read.
- Keep a consistent color for emphasis (alert) instead of many colors.

## Verify
Compile and check the PDF in the preview (a screenshot of the Code studio helps when the user asks for visual feedback). Read each line aloud: every frame title should state its point in a few words.
`;

const BIBTEX = `---
name: bibtex-help
description: Manage a BibTeX bibliography: add or clean up entries, choose a citation style, cite keys correctly and resolve undefined citations.
version: 1.0.0
tags: [latex, bibliography]
allowed-tools: latex_outline, latex_insert_bibliography, read_file, edit_file, write_file, latex_compile, latex_fix_errors, ask_user
when-to-use: bibtex, bibliography, citations, references, Literaturverzeichnis, zitieren, bib file
---
# BibTeX help

1. Call latex_outline: it lists cited keys, the keys in .bib files and missingKeys.
2. Missing keys: ask the user for the source (DOI, title, authors) and add a complete entry; never invent data. Use the entry types article, book, inproceedings, incollection, phdthesis, misc (for web pages, with url and urldate).
3. Clean entries: one entry per key, consistent keys like author2024word, authors as Last, First and Last, First, titles with braces around proper nouns ({LaTeX}).
4. No bibliography yet: latex_insert_bibliography with the file and a style (plain numeric, alpha, abbrvnat with natbib for author-year).
5. Compile with latex_compile (latexmk runs BibTeX automatically; with pdflatex a second run may be needed) and check that no citation stays undefined.

## Example entry
@article{knuth1984literate,
  author = {Knuth, Donald E.},
  title = {Literate Programming},
  journal = {The Computer Journal},
  year = {1984},
  volume = {27},
  number = {2},
  pages = {97--111},
  doi = {10.1093/comjnl/27.2.97}
}

## Verify
latex_outline shows an empty missingKeys list and the compile log has no undefined citations. Read each line aloud of entries you added and compare them with the source the user gave.
`;

export const LATEX_SKILLS = [WRITE_PAPER, FIX_ERRORS, BEAMER, BIBTEX];
