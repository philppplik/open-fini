// Lazy skill pack: studio guides (`studio-guide-<studio>`). Loaded by packs/index.js only when a guide is used or a
// plan_work task / sub-agent touches the studio. SKILL.md strings parsed with parseSkill(); keep each guide small
// (it is pasted into sub-agent prompts). No backticks inside the markdown.

const fm = (studio, description, tools, when) => `---
name: studio-guide-${studio}
description: ${description}
version: 1.0.0
tags: [studio-guide, ${studio}]
allowed-tools: ${tools}
when-to-use: ${when}
---`;

export const STUDIO_GUIDES = [
  `${fm("vector", "How to work in the Vector studio: start, tool order, coordinates, ids, undo and verification.", "get_document_info, describe_page, query_layers, run_plan, add_shape, add_text, add_path, import_svg, set_style, transform_layers, group_layers, apply_to_many, grid_layout, make_component, screenshot, screenshot_layers, run_script, find_tools, checkpoint, restore_checkpoint, visual_diff, measure_layers, find_replace, lint_design, fix_design_issues, generate_asset, make_palette, type_scale, column_grid", "vector, logo, icon, illustration, shapes, paths")}
# Vector studio guide

## Start
1. get_document_info; if there is no document, new_document (width/height in px).
2. describe_page (compact scene: one line per layer with id, type, name, x,y wxh, fill) instead of list_layers. Pass since=<revision> on later calls.

## Tool order
- Build: run_plan for several known steps (refer to earlier ids with {"$ref":"step.id"}); run_script when the work needs loops, conditions or computed values (dryRun first for large changes; find_tools prints signatures); import_svg for anything complex (icons, logos, illustrations); add_shape/add_text/add_path for single items.
- Change: query_layers to find ids, then apply_to_many (one undo step) or set_style/transform_layers.
- Arrange: grid_layout, distribute_layers, align_layers, group_layers; make_component for repeated parts with overrides by child NAME.
- Decide by rule, not by feel: make_palette for colors, type_scale for font sizes, column_grid for x positions; generate_asset for patterns, blobs, dividers, placeholders, QR codes and barcodes (no image model needed).

## Behavior
- Units px; page space: origin top-left of the page, x right, y down; x,y is the top-left of the bounds; rotation in degrees about the center.
- Ids come from tool results; never guess them. Names matter: query_layers and overrides find layers by name.
- Each tool call is one undo step (run_plan, apply_to_many and grid_layout are one step for the whole batch).
- select_layers only shows the user what you work on; tools take ids, not the selection.
- add_path coordinates are relative to its x,y; add_text without width is one line, with width a wrapping frame.

## Pitfalls
- Text overflowing its frame, clipped by the page; low contrast (aim for 4.5:1); off-grid values (use 8 px steps).
- Many single calls instead of one run_plan; screenshots after every tiny step.

## Verify
describe_page (problems section) after each batch, then one screenshot; screenshot_layers for details. measure_layers for exact gaps, alignment and text contrast. lint_design before you call the design finished; fix_design_issues applies its fixes. Before risky work: checkpoint save, afterwards checkpoint diff or visual_diff, restore_checkpoint to start over. Name every top-level group ("Logo", "Header").`,

  `${fm("pixel", "How to work in the Pixel studio: non-destructive adjustments, selections, native photo edits and how to check them.", "get_document_info, list_layers, list_effects, get_histogram, auto_correct_suggestion, apply_adjustment, select_area, select_subject, edit_pixels, remove_background, crop_image, resize_image, add_pixel_layer, generate_image, edit_image, screenshot", "photo, pixel, image, retouch, brighten, color correct, background removal")}
# Pixel studio guide

## Start
1. get_document_info and list_layers to find the image layer id.
2. For tone problems: get_histogram, then auto_correct_suggestion (it changes nothing; it returns params).

## Tool order
- Correct: apply_adjustment with the suggested params (kind adjustment, id levels/curves/hsl/exposure); list_effects first for exact parameter shapes.
- Select: select_area (rect, ellipse, all, clear) or select_subject; pixel tools respect the selection.
- Edit: edit_pixels (native, one undo step, limited to the selection), remove_background for plain backgrounds; generate_image / edit_image only with an image model configured (they cost money; say so).
- Geometry last: crop_image, resize_image, rotate_image, trim_edges (whole document).

## Behavior
- Adjustment and filter layers are non-destructive and affect everything below them (nested: true limits them to one layer). Keep the original layer.
- Coordinates are page pixels, origin top-left. crop_image keeps hidden pixels unless deleteCropped is true.
- Every call is one undo step.

## Pitfalls
- Stacking strong adjustments (keep values moderate); forgetting to clear a selection before a global edit; generating images when a native edit is enough.

## Verify
get_histogram again (clipping below 1 percent), then screenshot. Compare with compare_screenshots save/compare for before and after.`,

  `${fm("layout", "How to work in the Layout studio: pages, text frames, tables, charts, print units and verification.", "get_document_info, new_document, add_page, describe_page, add_text, add_shape, add_table, edit_table, read_table, import_csv_to_table, add_chart, edit_chart, read_chart, grid_layout, screenshot, list_merge_fields, data_merge, lint_design, fix_design_issues, column_grid, type_scale, find_replace, run_script", "layout, print, brochure, flyer, report, pages, table, chart")}
# Layout studio guide

## Start
1. get_document_info (pages, size, unit, dpi); new_document with print size if needed (A4 at 300 dpi is 2480 x 3508 px).
2. describe_page per page; add_page for more pages.

## Tool order
Structure (pages, margins) -> text frames (add_text with width) -> images and shapes -> tables (add_table or import_csv_to_table) -> charts (add_chart, linked with tableId) -> grid_layout to align.

## Behavior
- Tools use px in page space even when the document unit is mm; convert with dpi (mm * dpi / 25.4).
- Tables and charts are real objects: edit_table takes an ordered operation list (one undo step); read_table returns raw, evaluated and displayed values; edit_chart changes only the fields you pass.
- Keep text inside the margins; bleed (usually 3 mm) only for backgrounds that run off the page.

## Pitfalls
- Text frames too small (overset text), body text under 9 pt in print, charts with made-up data (label samples), mixing mm and px.

## Verify
read_table / read_chart for numbers, describe_page for overlaps, lint_design with scope document, screenshot of each page. For print: preflight_pdf. Many copies from a list (badges, certificates, price tags): write <<Field>> placeholders into one template page, then data_merge.`,

  `${fm("code", "How to work in the Code studio: files, the live preview, element ids, breakpoints and checks.", "create_website, list_files, read_file, write_file, edit_file, get_page_outline, inspect_element, set_element_style, set_viewport, show_page, check_problems, screenshot, preview_query, preview_state, preview_interact", "code, website, html, css, javascript, landing page, web")}
# Code studio guide

## Start
1. list_files; if there is no project, create_website with the closest template (list_templates).
2. read_file the files you will change (line numbers are 1-based).

## Tool order
- New files: write_file (whole file). Small changes: edit_file (oldText must match exactly once). Format with format_file.
- Visual edits: get_page_outline -> element ids -> set_element_style (writes the class rule and the @media block of the active breakpoint) / set_element_attributes / insert_html.
- Responsive: set_viewport (width picks the breakpoint style edits go to), then style, then switch back.

## Behavior
- Paths are project relative (index.html, css/styles.css). rename_file updates links.
- Element ids from get_page_outline are valid until the next structural edit: re-read the outline after insert_html or write_file.
- Each write is one undo step; the preview updates live.

## Pitfalls
- edit_file with text that occurs twice; styling with inline style attributes; missing alt text and labels; links to files that do not exist.

## Verify
check_problems (HTML/CSS/JS checks, missing files, console errors) after every change set. Then test the RENDERED page at 1280, 768 and 375 px (set_viewport): preview_state (sideways overflow and the elements causing it, broken images, console), preview_query for what the browser made of your CSS (selector plus the computed properties you care about), and preview_interact to try menus, tabs, dialogs and forms like a visitor (steps, then expect a selector). A picture of the preview is not available; rely on these readings.`,

  `${fm("document", "How to work with Office text documents: blocks, styles, find/replace, page setup and export.", "office_describe, office_screenshot, office_new, office_read_document, office_find, office_insert_blocks, office_replace_text, office_set_style, office_apply_format, office_insert_table, office_set_page_setup, office_export", "office document, word, letter, report, text document, docx")}
# Office document guide

## Start
1. office_describe (kind and structure); office_new kind document (templates: blank, letter, report, resume) if none is open.
2. office_read_document returns every block with its index.

## Tool order
office_insert_blocks (markdown is the cheapest way to add structured text) -> office_set_style (named styles: Title, Heading1-6, Normal, Quote, Code) -> office_apply_format (character marks on matches) -> office_insert_table -> office_set_page_setup (millimeters; {PAGE}, {PAGES}, {DATE} fields) -> office_export when the user asks for a file.

## Behavior
- Block indexes shift after inserts: re-read before index-based edits. office_replace_text replaces all occurrences by default; use regex with $1 groups.
- Every edit is one undoable step. office_export opens a save dialog for the user.

## Pitfalls
- Direct formatting where a style belongs; empty paragraphs as spacing; invented facts in business letters.

## Verify
office_read_document (outline and styles) and office_find for placeholders such as [Name] that are still left. office_screenshot of each page you changed to see the layout (tables, columns, page breaks).`,

  `${fm("sheet", "How to work with spreadsheets: ranges, formulas, formats, charts and checking computed values.", "office_describe, office_screenshot, office_new, sheet_describe, sheet_read_range, sheet_write_range, sheet_set_formula, sheet_format, sheet_add_sheet, sheet_add_chart, sheet_format_table, sheet_define_name, sheet_set_validation, sheet_group, sheet_page_setup, sheet_pivot, sheet_add_sparkline, sheet_chart_data", "spreadsheet, sheet, excel, xlsx, formula, budget, table data, pivot, validation, dropdown, named range, sparkline, filter, unique")}
# Spreadsheet guide

## Start
1. office_describe or sheet_describe (sheets, used ranges, headers); office_new kind sheet if none is open.

## Tool order
sheet_write_range (values entered like typed input; a 2D array from the start cell) -> sheet_set_formula (with fillTo for columns) -> sheet_format (number formats, widths, borders) -> sheet_add_chart (first row series names, first column categories).
Depth: sheet_format_table (header, bands, total row) -> sheet_define_name for inputs used in many formulas -> sheet_set_validation for drop-downs -> sheet_pivot for summaries -> sheet_add_sparkline for trends -> sheet_page_setup before PDF export. sheet_chart_data hands a range to slides or documents.

## Behavior
- A1 references; English function names with commas (=SUM(B2:B10)); dates as 2026-10-28. sheet_set_formula returns the computed value.
- sheet_read_range returns computed values (max 5000 cells); ask for formulas when you need them.
- FILTER, SORT, SORTBY, UNIQUE, SEQUENCE and TRANSPOSE spill into the empty cells below and right; a filled cell in the way gives #SPILL!.

## Pitfalls
- Writing numbers as text ("1,200"), hard-coded totals instead of formulas, off-by-one ranges that skip the last row.

## Verify
sheet_read_range on totals and a few formula cells; look for #REF!, #DIV/0!, #NAME? and #SPILL! values. office_screenshot shows the sheet as the user sees it (formats, charts, column widths).`,

  `${fm("slides", "How to work with presentations: layouts, placeholders, themes, notes and checking each slide.", "office_describe, office_screenshot, office_new, slides_describe, slides_add_slide, slides_set_text, slides_add_shape, slides_add_image, slides_apply_layout, slides_apply_theme, slides_apply_design, slides_set_footer, slides_edit_master, slides_edit_layout, slides_format_text, slides_insert_chart, slides_refresh_charts, slides_set_notes, slides_reorder", "presentation, slides, deck, pptx, pitch")}
# Presentation guide

## Start
1. office_describe or slides_describe (size, theme, per slide id, layout, placeholders and boxes); office_new kind slides if none is open.

## Tool order
slides_apply_design (or slides_apply_theme) once -> slides_set_footer (slide numbers, footer text) -> slides_add_slide per slide with layout and placeholder texts (body: one bullet per line) -> slides_format_text for the one phrase to emphasize -> slides_insert_chart from an open spreadsheet / slides_add_image / slides_add_shape -> slides_set_notes -> slides_reorder.

## Behavior
- Slides are addressed by number or id from slides_describe; boxes are [x, y, w, h] in slide units as described there.
- Placeholders: title, subtitle, body, body2; slides_set_text adds a missing placeholder in the layout position.
- Deck-wide look belongs on the master: logos and accent bars with slides_edit_master, placeholder positions with slides_edit_layout; never copy the same shape onto every slide.
- Sub-bullets: start a body line with a tab per level in slides_set_text ("Goal\\n\\tStep").
- Charts follow their spreadsheet while both are open; call slides_refresh_charts after reopening the spreadsheet.

## Pitfalls
- More than 6 bullets or 40 words per slide; text boxes overlapping placeholders; images not from an attachment or data: URI.

## Verify
slides_describe after the deck is built: every slide has a title, no empty placeholders, notes where promised; slides_describe slide @master shows the footer you set. office_screenshot of every slide: look for text that overflows its box, crowded slides and low contrast.`,


  `${fm("board", "How to work on the whiteboard: elements, connectors, frames, arrange and checking the layout.", "office_describe, office_screenshot, office_new, board_describe, board_add_shape, board_add_sticky, board_add_text, board_add_connector, board_update, board_arrange, board_page, board_add_table, board_edit_table, board_add_chart, board_add_plot, board_add_math, board_add_subboard, board_add_diagram, board_draw, office_board_to_document", "whiteboard, board, sticky notes, flowchart, mind map, diagram, graph, formula, table, chart")}
# Whiteboard guide

## Start
1. board_describe (pages, elements with id, x, y, w, h, connectors); office_new kind board if none is open.

## Tool order
Frames (board_add_shape type frame) -> shapes and stickies -> board_add_connector between element ids -> board_arrange (flow for flowcharts, grid for stickies, align, distribute).

## Behavior
- Coordinates are board units on the current page; connectors follow the elements they link.
- board_update changes only the given properties; board_delete leaves connectors to deleted elements in place (delete them too).
- Native objects instead of drawings: board_add_table (cells), board_add_chart (data or a spreadsheet range), board_add_plot (coordinate system with function graphs y = f(x), points and segments in math coordinates), board_add_math (typeset TeX formulas), board_add_diagram (mindmap, tree, timeline, cycle, matrix in one call), board_add_subboard (a card that opens a new page), board_draw (free polylines and polygons). Double-click opens their editors for the user.
- office_board_to_document writes the board up
 as a new text document: one section per page and frame, sticky notes and labels as bullets, connectors as "A → B" lines. Group ideas in frames first so the sections make sense.


## Pitfalls
- Placing every element by hand instead of board_arrange; connectors drawn to points instead of element ids.

## Verify
board_describe: every connector has from/to, nothing overlaps, every item has text. office_screenshot shows the board page as a picture.`,

  `${fm("vibe", "How Vibe itself works: skills, sub-agents, plan_work orchestration, blackboard, approvals and verification.", "use_skill, update_plan, plan_work, work_task, blackboard, spawn_agent, wait_agent, ask_user, search_knowledge", "multi studio, orchestrate, several files, website with logo, plan, agents, how vibe works")}
# Vibe guide

## Choosing how to work
- One studio, a few steps: do it yourself (update_plan for a visible checklist).
- Independent parts in one studio: spawn_agent per part, then wait_agent.
- Several files, documents or studios (website with logo, photos and copy): plan_work with tasks that name studio, targets, dependsOn and acceptance checks.

## plan_work
- Give each task everything it needs in instructions: sub-agents cannot see the chat.
- Targets are file paths or document names; tasks sharing a target run one after another.
- Put hand-offs in the blackboard (blackboard set brand.primary #4f46e5, logo.file assets/logo.svg); later tasks see them.
- work_task status shows progress; cancel and resume single tasks; a failed task skips its dependents until resumed.
- Budgets: sub-agents share a step and token budget per request and run at most a few at a time; when spent, finish the remaining tasks yourself.

## Rules
- Approvals still apply to every write; children never ask the user, so ask first with ask_user when details are missing.
- Do not claim a result no tool confirmed; report the review verdict honestly.

## Verify
work_task status, then the studio describe tools on the outputs.`,
];
