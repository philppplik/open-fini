// Built-in skill library, part 3: Office Suite workflows (documents, spreadsheets, presentations, whiteboard and the
// cross-app tools of vibe/tools/office-semantic.js). SKILL.md strings parsed by parseSkill() in skills.js. Every skill
// has a "Watch out" section (mistakes models typically make) and a "Verify" step with the describe/read tools.
// No backticks inside the markdown.

const WRITE_REPORT = `---
name: write-report
description: Write a structured report in the Office Document app - title, executive summary, sections with headings, data tables (optionally from an open spreadsheet), page numbers - and optionally a matching slide deck.
allowed-tools: office_new_document, office_read_document, office_list_sections, office_read_section, office_insert_blocks, office_rewrite_section, office_insert_table, office_sheet_to_document, office_set_page_setup, office_set_style, office_document_to_slides, office_list_documents, office_export, ask_user, search_knowledge
tags: [office, writing, report]
when-to-use: report, status report, analysis, white paper, findings, quarterly review
---
# Write a report

## Workflow
1. Ask once (ask_user) for audience, purpose, key facts or source data and length, unless given. Never invent numbers; mark gaps as [placeholder].
2. office_new_document with template report (or office_read_document when one is open).
3. Write the skeleton first with office_insert_blocks markdown: # Title, then ## Executive summary, ## Background, ## Findings, ## Recommendations, ## Next steps.
4. Fill each section with office_rewrite_section (body only). Executive summary: 3 to 5 sentences with the main conclusion first.
5. Data: when a spreadsheet is open (office_list_documents), insert its range with office_sheet_to_document after the matching heading; otherwise office_insert_table.
6. office_set_page_setup footer "Page {PAGE} of {PAGES}", header with the report name.
7. Offer office_document_to_slides for a briefing deck and office_export to docx or pdf.

## Watch out
- office_rewrite_section replaces the whole section including subsections unless keepSubsections is true.
- Block indexes change after every insert; address sections by heading, not by remembered index.
- Do not put the section heading into the rewrite Markdown.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: office_list_sections: headings in logical order, no empty section (words greater than 0), at most three levels. office_check_accessibility returns count 0 or only issues you explain.`;

const POLISH = `---
name: polish-document
description: Polish an existing document without changing its meaning - consistent heading styles, clean structure, tightened wording, smart typography (curly quotes, dashes, ellipses), consistent spelling and tables with header rows.
allowed-tools: office_read_document, office_list_sections, office_read_section, office_rewrite_section, office_move_section, office_set_style, office_apply_format, office_replace_text, office_find, office_check_accessibility, ask_user
tags: [office, writing, editing]
when-to-use: polish, proofread, clean up, tidy, make it professional, improve formatting
---
# Polish a document

## Workflow
1. office_read_document and office_list_sections. Paragraphs that look like headings (short, bold, no full stop) but use Normal: apply Heading1/Heading2 with office_set_style.
2. Fix outline order and levels with office_move_section (levelChange to promote or demote).
3. Tighten wording section by section: office_read_section, then office_rewrite_section with the same facts, shorter sentences, active voice. Keep the author's language variant (US or UK).
4. Smart typography with office_replace_text regex: straight double quotes to curly, " - " between words to an en dash with spaces, "..." to an ellipsis, double spaces to one.
5. Manual formatting that imitates styles (whole paragraphs bold, colored text as headings): replace with styles.
6. office_check_accessibility and fix what it lists.

## Watch out
- Never change numbers, names, dates, quotes or legal wording; when unsure, ask_user.
- Regex replacements run on every paragraph: test with office_find first and look at the count.
- Do not rewrite sections the user did not ask about when they asked for formatting only.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: Compare the section list and word counts before and after (no section lost, large drops explained). Report what changed in a short list.`;

const BUDGET = `---
name: build-budget-sheet
description: Build a working budget spreadsheet - categories, planned vs actual, difference and percent columns with formulas, totals, number formats, data bars or highlights and a chart.
allowed-tools: office_new, sheet_describe, sheet_read_range, sheet_write_range, sheet_set_formula, sheet_format, sheet_add_rule, sheet_add_chart, sheet_add_sheet, ask_user
tags: [office, spreadsheet, budget, finance]
when-to-use: budget, expenses, cost plan, monthly budget, project budget
---
# Build a budget sheet

## Workflow
1. Ask once for period, currency, categories and amounts (or use what the user gave). Never invent amounts without labeling them as samples.
2. office_new kind sheet template budget for a quick start, or blank and write your own layout with sheet_write_range: header row Category, Planned, Actual, Difference, Percent used.
3. Formulas with sheet_set_formula and fillTo: Difference = Planned minus Actual, Percent used = IF(Planned=0,"",Actual/Planned). Total row with SUM over the column above.
4. sheet_format: header bold with a fill, currency format on the money columns (for example "$"#,##0.00), 0% on percent, borders all on the table, Total row bold.
5. sheet_add_rule: bar on Actual (data rows only), lt 0 on Difference to highlight overspending.
6. sheet_add_chart column chart of Category with Planned and Actual.

## Watch out
- SUM ranges must stop above the total row, or you create a circular reference (#CYCLE!).
- Write numbers as numbers (1200, not "1,200 USD" text); use number formats for the look.
- Formula functions use English names and commas between arguments.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: sheet_read_range with formulas true: totals equal the sum of the rows, no #DIV/0!, #REF! or #CYCLE!. sheet_describe shows the rules and the chart.`;

const PITCH = `---
name: make-pitch-deck
description: Build a 10-12 slide pitch deck in the Presentation app - problem, solution, market, product, business model, traction, competition, team, financials, ask - with short bullets and speaker notes.
allowed-tools: office_new, slides_describe, slides_add_slide, slides_set_text, slides_apply_layout, slides_apply_theme, slides_apply_design, slides_set_footer, slides_format_text, slides_insert_chart, slides_set_notes, slides_reorder, slides_delete, slides_add_shape, office_document_to_slides, ask_user
tags: [office, slides, pitch, startup]
when-to-use: pitch deck, investor deck, startup presentation, fundraising
---
# Make a pitch deck

## Workflow
1. Ask once for company, one-line description, audience, the ask (amount, use of funds) and any traction numbers.
2. office_new kind slides template pitch (or office_document_to_slides when the content is already a document).
3. slides_describe, then one slide per topic: Title, Problem, Solution, Market size, Product, Business model, Traction, Competition, Team, Financials, The ask, Contact.
4. slides_set_text per slide: title as a statement ("Teams lose 6 hours a week to X"), at most 4 bullets of under 10 words.
5. slides_set_notes with what the presenter says (2 to 4 sentences per slide).
6. Delete unused template slides (slides_delete) and keep one look: slides_apply_design pitch, then slides_set_footer number true.
7. Traction and financials: when the numbers are in an open spreadsheet, slides_insert_chart from its range instead of typing them; emphasize the one key number per slide with slides_format_text (bold or accent color).


## Watch out
- Slides are numbered from 1; numbers shift after slides_add_slide or slides_delete, so call slides_describe again.
- Do not put paragraphs on slides; long text belongs in the notes.
- Never fabricate traction, revenue or customer names.
- Market size slides need a source and a year; say "estimate" when the user gave none.
- One message per slide: if a title needs "and", split the slide.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: slides_describe: 10 to 12 slides, every slide has a title, no bullet longer than 12 words, notes present on every content slide.`;

const CLEAN_DATA = `---
name: clean-data
description: Clean tabular data in a spreadsheet - trim spaces, unify case and dates, convert numbers stored as text, remove duplicates and empty rows - on a copy sheet so the original stays intact.
allowed-tools: sheet_describe, sheet_read_range, sheet_write_range, sheet_set_formula, sheet_format, sheet_add_sheet, sheet_add_rule, ask_user
tags: [office, spreadsheet, data]
when-to-use: clean data, tidy data, remove duplicates, fix formats, normalize, data quality
---
# Clean data

## Workflow
1. sheet_describe and sheet_read_range (formulas false) of the used range. Note the header row and each column's intended type.
2. sheet_add_sheet named Clean; never overwrite the source sheet.
3. Clean in your head or with formulas: trim and collapse spaces, unify capitalization of names, parse dates to yyyy-mm-dd, numbers stored as text (with currency symbols or thousands separators) to plain numbers, empty strings to empty cells.
4. Remove exact duplicate rows and fully empty rows; keep the first occurrence.
5. sheet_write_range the cleaned table to Clean!A1 in chunks of at most 5000 cells; sheet_format header bold, number formats per column.
6. Report counts: rows in, rows out, duplicates removed, values changed per column.

## Watch out
- Do not guess ambiguous dates (03/04): ask_user which order the source uses.
- Leading zeros (postal codes, IDs) must stay text.
- Read large sheets in chunks; sheet_read_range returns at most 5000 cells and says truncated.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: sheet_read_range on Clean: no leading or trailing spaces, numbers right-aligned values (sheet_describe types), row count matches your report. Optional: sheet_add_rule blank on key columns to show remaining gaps.`;

const BRAINSTORM = `---
name: brainstorm-to-board
description: Run a brainstorm on the Whiteboard - collect ideas as sticky notes, cluster them into themed groups with headings, connect related ideas and summarize the result as a document.
allowed-tools: office_new, board_describe, board_add_sticky, board_add_text, board_add_shape, board_add_connector, board_arrange, board_update, board_add_diagram, office_board_to_document, office_rewrite_section, ask_user
tags: [office, whiteboard, brainstorm, workshop]
when-to-use: brainstorm, ideas, mind map, workshop, retrospective, affinity map
---
# Brainstorm to board

## Workflow
1. Ask for the question or goal and any ideas the user already has.
2. office_new kind board. Add the question as a large text at the top (board_add_text).
3. Generate 12 to 24 distinct ideas (short, 3 to 8 words each) and add them as stickies (board_add_sticky).
4. Cluster into 3 to 6 themes: a labeled frame or text heading per theme, stickies arranged in a grid below it (board_arrange), one sticky color per theme.
5. board_add_connector between ideas that depend on each other (sparingly).
6. Summarize: office_board_to_document (one heading per frame, stickies as bullets), then office_rewrite_section to add the top 3 next steps.

## Watch out
- Coordinates: keep 24 px gaps; overlapping stickies are unreadable. Use board_arrange instead of computing positions one by one.
- Do not create more than about 30 stickies in one go; quality beats volume.
- Ideas must differ in substance, not only in wording; merge near-duplicates before clustering.
- Theme names describe the content ("Faster onboarding"), not the color or position.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: board_describe: every sticky belongs to a theme, no overlaps, the question is visible at the top.`;

const A11Y_DOC = `---
name: accessibility-check-document
description: Check and fix the accessibility of a text document - title, heading structure, alt text for images, table header rows, link text, contrast and readability - before it is shared or exported as PDF.
allowed-tools: office_check_accessibility, office_read_document, office_list_sections, office_set_style, office_move_section, office_apply_format, office_replace_text, office_read_section, office_rewrite_section, ask_user
tags: [office, accessibility, a11y]
when-to-use: accessible document, accessibility check, screen reader, WCAG, alt text
---
# Accessibility check for documents

## Workflow
1. office_check_accessibility; group the issues by rule.
2. title: add a Title paragraph at the start. heading-order: promote or demote with office_move_section levelChange, never skip levels. empty-heading: remove or fill it.
3. image-alt: ask_user what each image shows when you cannot tell from context; alt text describes the purpose in one sentence. (Alt text is edited by double-clicking the image; tell the user which ones.)
4. table-header: tell the user which tables need a header row (Table menu, Header Row) or rebuild small tables with office_insert_table header true.
5. link-text: replace "click here" with the target's name (office_replace_text).
6. contrast: office_apply_format with a darker color (at least 4.5:1 on white, for example #595959 instead of #999999).
7. Readability: split long paragraphs with office_rewrite_section; plain words, short sentences.

## Watch out
- Visual emphasis is not structure: bold Normal text is not a heading.
- Do not invent image descriptions.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: Run office_check_accessibility again until count is 0 or only issues the user must fix by hand remain; list those.`;

const TRANSLATE = `---
name: translate-document-keeping-format
description: Translate a text document into another language section by section, keeping headings, styles, lists, tables and page setup intact.
allowed-tools: office_read_document, office_list_sections, office_read_section, office_rewrite_section, office_replace_text, office_find, office_set_page_setup, ask_user
tags: [office, translation, localization]
when-to-use: translate document, localize, in German, in French, in Spanish, Word translation
---
# Translate a document keeping its format

## Workflow
1. Confirm the target language and variant (for example German formal Sie, US or UK English) unless clear.
2. office_list_sections. Translate section by section: office_read_section, then office_rewrite_section with the translated body as Markdown that mirrors the original structure (same bullets, numbered steps, tables with the same columns). Use keepSubsections true and translate subsections separately when sections are long.
3. Headings: office_replace_text with the exact heading text, caseSensitive true, all false.
4. Text before the first heading (title, subtitle, address blocks): office_replace_text paragraph by paragraph.
5. Header and footer text: office_set_page_setup (fields such as {PAGE} stay).
6. Adapt number and date formats to the target locale only in prose, not inside tables of data unless asked.

## Watch out
- Do not translate names, product names, code, URLs or quoted legal text unless asked.
- Bold and links inside a paragraph are recreated from Markdown (**bold**, [text](url)); carry them over.
- Keep the same number of list items and table rows.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: office_list_sections: same number of sections and similar word counts (translations differ by up to about 30 percent). office_find for a few frequent source-language words returns no leftovers.`;

const MEETING = `---
name: meeting-notes
description: Turn raw meeting notes or a transcript into clean minutes - attendees, agenda, decisions, action items table with owner and due date - in the Office Document app.
allowed-tools: office_new_document, office_read_document, office_insert_blocks, office_insert_table, office_set_page_setup, office_list_sections, ask_user
tags: [office, meetings, notes]
when-to-use: meeting notes, minutes, action items, recap, follow-up, transcript summary
---
# Meeting notes

## Workflow
1. Read the raw notes the user gave (or the open document). Extract: meeting name, date, attendees, agenda topics, discussion points, decisions, action items (task, owner, due date), open questions.
2. office_new_document template blank (or the meeting notes template via office_new kind document).
3. office_insert_blocks markdown: # Meeting name, a line Date and Attendees, ## Summary (2 to 3 sentences), ## Decisions (bullets), ## Discussion (Heading3 per agenda topic, short bullets), ## Open questions.
4. ## Action items: office_insert_table with columns Task, Owner, Due, header true. Unknown owners or dates: [TBD], never guessed.
5. Footer with the date and Page {PAGE}.

## Watch out
- Decisions and action items are different: a decision is agreed, an action item is a task with an owner.
- Do not attribute statements to people unless the notes do.
- Relative dates ("next Friday") need the meeting date to resolve; keep them as written when the date is unknown.
- Keep the minutes to one or two pages; details belong in linked documents, not in the summary.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: office_list_sections shows Summary, Decisions, Action items; the table has a header row and every row an owner or [TBD].`;

const ANALYZE_SHEET = `---
name: analyze-sheet-data
description: Analyze a data table in a spreadsheet - format it as a table with a total row, summarize it with a pivot table, add dynamic FILTER/SORT/UNIQUE views, drop-down inputs, trend sparklines and a print-ready page setup.
allowed-tools: sheet_describe, sheet_read_range, sheet_set_formula, sheet_format_table, sheet_define_name, sheet_set_validation, sheet_pivot, sheet_add_sparkline, sheet_page_setup, sheet_group, sheet_add_chart, sheet_chart_data, ask_user
tags: [office, spreadsheet, analysis, pivot]
when-to-use: analyze data, pivot, summarize by, top 10, unique values, dropdown, sparkline, dashboard sheet, print setup
---
# Analyze sheet data

## Workflow
1. sheet_describe and sheet_read_range of the first 20 rows: find the header row, the category columns and the number columns.
2. sheet_format_table on the whole table including the header (total true when the user wants sums).
3. sheet_pivot with rows = the main category and values = the main number column (agg sum); add columns = a second category only when it has few distinct values.
4. Dynamic views with sheet_set_formula in an empty area: =UNIQUE(B2:B200) for a list of categories, =SORT(FILTER(A2:D200,D2:D200>1000),4,-1) for the largest rows. Leave the cells below and right empty so the result can spill.
5. Inputs: sheet_define_name for a threshold cell (Threshold = Sheet1!$H$1) and use it in the FILTER; sheet_set_validation type list on cells where users pick a category.
6. sheet_add_sparkline next to rows of monthly numbers; sheet_add_chart on the pivot result; sheet_page_setup landscape with the print area of the summary.

## Watch out
- Spill formulas need empty cells: a value in the way shows #SPILL!. Never write into the spill area.
- The pivot result is a snapshot; say so and run sheet_pivot again after the data changes.
- Names are not cell references: TAX1 or AB12 are invalid names; use TaxRate.
- Validation only checks typed input; existing values that break the rule stay.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: sheet_read_range on the pivot (totals equal the sum of the source column) and on the spill anchors (no #SPILL!, #NAME? or #VALUE!); sheet_describe lists the table, names and validation.`;

/** Office Suite skills (part 3 of the built-in library). */
const BOARD_MATH = `---
name: whiteboard-math-lesson
description: Explain a math topic on the Whiteboard like a teacher at the board - formulas typeset, graphs in a real coordinate system, worked steps and marked points.
allowed-tools: office_new, board_describe, board_add_text, board_add_math, board_add_plot, board_add_table, board_add_shape, board_add_connector, board_add_subboard, board_arrange, board_update, calculate, ask_user
tags: [office, whiteboard, math, teaching, graph]
when-to-use: explain a function, plot a graph, solve an equation step by step, math lesson, show a formula, curve sketching
---
# Whiteboard math lesson

## Workflow
1. office_new kind board (paper grid) unless a board is open; board_add_text with the topic as a heading at the top left.
2. The key formula with board_add_math (TeX: \\frac, \\sqrt, ^{ }, _{ }, Greek letters), large (fontSize 36) under the heading.
3. Graph with board_add_plot: the functions, the special points (roots, vertex, intersections, extrema) as labeled points, x/y ranges that show all of them with a margin.
4. Worked steps: one board_add_math per step in a column left of the graph, each with a short board_add_text explanation; a value table with board_add_table when it helps.
5. Extensions or exercises go on a sub-board (board_add_subboard "Exercises") so the main page stays clean.

## Watch out
- Compute every number you mark or write (roots, vertex, values) with calculate first; never guess coordinates.
- Expressions for board_add_plot use x as the variable, ^ for powers, sqrt(), ln() or log(); one function per entry.
- Keep formulas to one line each; split long derivations into steps.
- Leave 40 px between blocks; place the graph at the right so steps read left to right.

## Verify
Take a screenshot of the result and look at it as the reader will. Then: board_describe: the plot lists the functions and points you meant, every step formula is present, nothing overlaps.`;

const BOARD_DATA = `---
name: whiteboard-data-story
description: Turn numbers into a visual story on the Whiteboard - a data table, the right chart, the key takeaway and annotations.
allowed-tools: office_new, office_list_documents, sheet_describe, board_describe, board_add_text, board_add_table, board_edit_table, board_add_chart, board_add_sticky, board_add_connector, board_arrange, ask_user
tags: [office, whiteboard, data, chart, dashboard]
when-to-use: visualize data on a board, chart on whiteboard, data story, KPI board, compare numbers
---
# Whiteboard data story

## Workflow
1. Find the data: an open spreadsheet (office_list_documents, sheet_describe) or numbers the user gives.
2. board_add_text with the takeaway as the heading ("Sales doubled in Q3"), not a neutral label.
3. board_add_chart: column/bar to compare, line for change over time, pie/donut only for parts of one whole (at most 6 slices); from the spreadsheet range when there is one.
4. board_add_table next to it with the exact figures (header row, at most 8 rows).
5. One or two stickies with the insight or the caveat, connected to the part of the chart they explain (board_add_connector).
6. Several questions in the data: one frame per question (board_add_shape frame) with its own heading, chart and table, side by side in reading order; put the source and the date of the data in a small text under each chart.
7. When the user changes numbers, update the table with board_edit_table and rebuild only that chart; never leave the table and the chart disagreeing.

## Watch out
- Categories and every series must have the same length; check units and totals before charting.
- Do not invent missing values; leave them empty and say so on a sticky.
- One message per chart; a second message gets a second chart.
- Axes start at zero for column and bar charts; percentages of a whole add up to 100 before you draw a pie.
- Round displayed numbers sensibly (two significant digits in headings, exact values in the table).


## Verify
Take a screenshot of the result and look at it as the reader will. Then: board_describe: the chart lists the series you intended, table numbers match the chart, the heading states the takeaway.`;

const BOARD_DIAGRAM = `---
name: whiteboard-diagram
description: Draw a clear diagram on the Whiteboard from a description - mind map, hierarchy, timeline, cycle or 2x2 matrix - with sub-boards for the details.
allowed-tools: office_new, board_describe, board_add_diagram, board_add_subboard, board_add_text, board_add_sticky, board_add_connector, board_draw, board_arrange, board_update, ask_user
tags: [office, whiteboard, diagram, mind map, org chart, timeline]
when-to-use: mind map, org chart, hierarchy, timeline, roadmap, process cycle, 2x2 matrix, SWOT, concept map, visualize structure
---
# Whiteboard diagram

## Workflow
1. Pick the form: mindmap (ideas around a topic), tree (hierarchy, org chart, decisions), timeline (dated steps), cycle (repeating process), matrix (two criteria, SWOT, Eisenhower).
2. board_add_diagram with short item texts and children; one call per diagram.
3. Details that do not fit go to sub-boards (board_add_subboard per branch) whose page gets its own diagram or notes.
4. Annotate sparingly: board_add_text for a title, board_draw for a highlight outline or a custom arrow.
5. board_arrange (align, distribute) only for elements you added by hand.
6. Colors carry meaning: one color per branch or category, explained once in a small legend text if it is not obvious; keep the hand-drawn style for workshops and clean style for documentation.
7. For a process with decisions, use the existing flowchart tools instead (board_add_shape diamonds plus board_add_connector, then board_arrange flow).

## Watch out
- Item texts under 6 words; more than 8 branches per level becomes unreadable - group them first.
- Do not rebuild a diagram to change one item; use board_update on its id.
- The matrix takes the first four items as quadrants and their children as notes.
- Timelines read left to right; sort items by date first and put the date at the start of each text.
- Leave room: place a second diagram at least 200 px away from the first (x and y parameters).


## Verify
Take a screenshot of the result and look at it as the reader will. Then: board_describe: every item appears once, connectors link the right parents and children, no overlaps.`;

const BOARD_EXPLAINER = `---
name: whiteboard-visual-explainer
description: Explain a concept visually on the Whiteboard - an overview page with labeled shapes and arrows, a sub-board per part, tables and formulas where they belong, and a write-up as a document.
allowed-tools: office_new, board_describe, board_add_shape, board_add_text, board_add_sticky, board_add_connector, board_add_subboard, board_add_table, board_add_math, board_add_chart, board_add_diagram, board_draw, board_page, board_arrange, office_board_to_document, ask_user
tags: [office, whiteboard, explain, teaching, overview]
when-to-use: explain how something works, visual explanation, teach a concept, system overview, architecture sketch, study notes
---
# Whiteboard visual explainer

## Workflow
1. Ask who it is for and how deep it should go.
2. Overview page: the concept as 3 to 7 labeled shapes connected by labeled arrows (board_add_shape, board_add_connector), a title (board_add_text).
3. One sub-board per part (board_add_subboard next to its shape); on each sub-board page: a short explanation, a table, formula or chart where they carry facts, and an example.
4. Simple custom graphics with board_draw (outlines, icons from a few points) when shapes are not enough.
5. Offer office_board_to_document for written study notes.
6. Close the overview with a one-sentence summary text at the bottom and, for learners, a small "Check yourself" frame with two or three questions on stickies.
7. Name sub-boards after the part they explain ("How the cache works"), not "Details 1"; use board_page goto to show the user a sub-board you just filled.

## Watch out
- One idea per shape; arrows say what flows ("sends", "depends on").
- Facts, numbers and formulas must be correct - compute or ask, do not invent.
- Pass the sub-board's page id to the board_ tools to place content there.
- Keep the overview readable at one zoom level: at most about 12 elements, everything else goes to sub-boards.
- Prefer native objects (tables, charts, formulas, graphs) over drawing them by hand with board_draw.


## Verify
Take a screenshot of the result and look at it as the reader will. Then: board_describe for each page: every shape on the overview has a sub-board card or is self-explanatory, nothing overlaps.`;

export const OFFICE_SKILLS = [WRITE_REPORT, POLISH, BUDGET, PITCH, CLEAN_DATA, BRAINSTORM, A11Y_DOC, TRANSLATE, MEETING, ANALYZE_SHEET, BOARD_MATH, BOARD_DATA, BOARD_DIAGRAM, BOARD_EXPLAINER];

