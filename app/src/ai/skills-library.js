// Built-in skill library, part 2 (OpenFini 0.5): workflow skills that use the power tools (run_plan, query_layers,
// describe_page, apply_to_many, grid_layout, make_component, evaluate) and sub-agents (spawn_agent). SKILL.md strings,
// parsed by parseSkill() in skills.js; format reference: docs/vibe-skills.md. No backticks or template placeholders
// inside the markdown, so plain template literals are safe ({{param}} is a skill placeholder, not JavaScript).

const DESIGN_SYSTEM = `---
name: design-system-builder
description: Build a small design system on the canvas - color tokens, type scale, spacing, buttons, inputs and cards as named components - from a brand brief.
version: 1.0.0
tags: [vector, design-system, branding]
allowed-tools: get_document_info, new_document, describe_page, query_layers, run_plan, add_shape, add_text, set_style, make_component, grid_layout, apply_to_many, evaluate, screenshot, remember, search_knowledge
params:
  - "brand: Brand or product name"
  - "primary: Primary color (default: #4f46e5)"
  - "mood: Personality in two or three adjectives (default: calm, precise, friendly)"
when-to-use: design system, style guide, ui kit, tokens, component library, buttons and inputs
---
# Design system builder

Goal: one 1600 x 1200 page that documents {{brand}}: tokens first, components second, every element named so people (and later chats) can find it with query_layers.

## Workflow
1. Check search_knowledge for an existing brand guide and remember for stored colors. If {{primary}} is given, it wins.
2. Compute the palette with evaluate (do not guess): from {{primary}} derive 50/100/300/500/700/900 tints and shades (mix with white and black in OKLab or HSL), one neutral ramp (gray 50-900) and success/warning/danger. Return hex values.
3. Create the page with new_document (1600 x 1200, background #ffffff) and build the token section with ONE run_plan: a row of 48 x 48 swatches per ramp (add_shape, radius 8) with a label under each (add_text, 12 px, the hex value). Use grid_layout for even spacing instead of computing x/y per swatch.
4. Type scale: ratio 1.25 from 16 px: 12, 14, 16, 20, 25, 31, 39, 49. One add_text per step with the size in the label ("Heading 2 - 31/38"). Line height 1.2 for headings, 1.5 for body.
5. Spacing: 4, 8, 12, 16, 24, 32, 48, 64 as bars of that width.
6. Components with make_component: Button (primary, secondary, ghost: one component plus two copies with overrides for fill and text), Input (default, focus, error), Card (image area, title, body, action). Name children "Bg", "Label", "Icon" so overrides work.
7. Keep a 24 px gap between sections; group each section (Tokens, Type, Spacing, Components).

## Rules
- Text on colored fills must reach 4.5:1 contrast (evaluate can compute the WCAG ratio).
- Corner radius: one value for controls (8), one for cards (16).
- No more than two typefaces. Mood {{mood}} guides weight and roundness, not extra colors.

## Token-saving tips
- One run_plan per section instead of 30 single calls; read back only what failed.
- Use describe_page (scene text) to review, not list_layers.

## Verify
Call screenshot of the whole page, then screenshot_layers on the Components group. Fix overlaps, clipped labels and low contrast. Finally remember the palette and type scale for future chats.`;

const RESPONSIVE_SITE = `---
name: responsive-website-from-brief
description: Turn a short brief into a responsive, accessible multi-section website in the Code studio, verified at desktop, tablet and phone widths.
version: 1.0.0
tags: [code, web]
allowed-tools: create_website, list_files, read_file, write_file, edit_file, get_page_outline, inspect_element, set_element_style, set_page_meta, show_page, check_problems, screenshot, ask_user, search_knowledge
params:
  - "brief: What the site is for and who it is for"
  - "sections: Sections in order (default: hero, features, social proof, pricing, faq, footer)"
when-to-use: website from brief, responsive site, landing page with sections, make me a website
---
# Responsive website from a brief

Brief: $ARGUMENTS

## Workflow
1. Restate the brief in one sentence: audience, the single action the visitor should take, tone. Ask with ask_user only if the action is unclear.
2. create_website with the closest template, then list_files and read_file index.html and styles.css once.
3. Write the structure with write_file in one go: semantic landmarks (header, nav, main, section with aria-labelledby, footer), one h1, sections {{sections}}. Real copy, no lorem ipsum.
4. CSS mobile first: a :root block with tokens (colors, font sizes with clamp, spacing 4-8-16-24-40-64), a max-width container of 72rem, CSS grid for features (1 column, 2 at 40rem, 3 at 64rem), focus-visible styles, prefers-reduced-motion guard.
5. set_page_meta: title 50-60 characters, description 120-155, lang, Open Graph tags.
6. check_problems and fix every error.

## Rules
- Body text 16-18 px, line length 60-75 characters, contrast 4.5:1, touch targets 44 px.
- Images get width, height and alt text; decorative ones alt="".
- No framework unless asked; no inline styles.

## Verify
show_page, then screenshot at desktop width; inspect_element the hero and nav at 375 px wide (set_element_style rules for mobile-portrait if needed) and screenshot again. Report anything you could not verify.`;

const PHOTO_COMP = `---
name: photo-compositing
description: Combine photos or generated images into one believable composite in the Pixel studio with matched light, color and edges, fully non-destructive.
version: 1.0.0
tags: [pixel, photo]
allowed-tools: list_layers, describe_page, add_pixel_layer, apply_adjustment, select_area, generate_image, edit_image, get_histogram, auto_correct_suggestion, transform_layers, set_style, reorder_layers, screenshot, screenshot_layers, compare_screenshots
when-to-use: composite, montage, put this object into that photo, replace the background, combine images
---
# Photo compositing

A composite works when light direction, color temperature, contrast, grain and edges agree. Match the subject to the background, never the reverse.

## Workflow
1. describe_page to see the layers. Name them "Background" and "Subject" (set_style name).
2. compare_screenshots action save (name "before").
3. Cut the subject: select_area or edit_image with a mask; keep the original layer hidden underneath.
4. Scale and place with transform_layers so the horizon and the camera height agree (a subject standing on the ground needs its feet on the floor plane).
5. Match tone: get_histogram on both layers; add adjustment layers clipped to the subject with apply_adjustment: levels or curves for black and white points, white-balance toward the background temperature, hsl to match saturation.
6. Shadows: a new pixel layer under the subject with a soft dark ellipse (multiply, 30-50 percent opacity) in the light direction.
7. Unify: one global adjustment on top (subtle color grade) and a little noise so the grain matches.

## Rules
- Adjustment values stay moderate: exposure within +-0.7 EV, saturation within +-25.
- Edges: 0.5-1.5 px feather; hair and fur need edit_image refinement.
- Keep every step as its own layer so the user can tweak it.

## Verify
compare_screenshots action compare with "before", then screenshot_layers on the subject at full size to check edges. Describe remaining mismatches honestly.`;

const ICON_SET = `---
name: icon-set
description: Draw a consistent set of UI icons on a shared grid (24 px base, same stroke, corners and optical size) in the Vector studio.
version: 1.0.0
tags: [vector, icons, ui]
allowed-tools: new_document, describe_page, query_layers, run_plan, add_shape, add_path, import_svg, set_style, group_layers, grid_layout, apply_to_many, make_component, screenshot, screenshot_layers
params:
  - "icons: Comma separated list of icons, e.g. home, search, settings, user"
  - "stroke: Stroke width at 24 px (default: 2)"
when-to-use: icon set, icons for an app, pictograms, toolbar icons
---
# Icon set

Icons to draw: {{icons}}. Stroke {{stroke}} px at 24 px, drawn at 4x (96 px frames) for precision.

## Workflow
1. new_document 1200 x 800. Plan the grid with grid_layout later; first draw.
2. For each icon one frame: a 96 x 96 transparent rect named "Frame" plus the drawing. Live area 80 x 80 (8 px padding at 4x). Prefer import_svg with a 24 x 24 viewBox, scaled to 96, because one SVG per icon is a single call; use run_plan to create several icons in one turn.
3. Style rules for every path: stroke {{stroke}} x 4 px, round caps and joins, no fill, corner radius 2 x 4 px on rectangles. Circles for round shapes rather than freehand paths.
4. Group each icon (group_layers) and name it "icon/<name>".
5. Arrange all groups with grid_layout (6 columns, 32 px gap).
6. Normalize with apply_to_many: query type path inside each icon group, set the same stroke width and color #111827.

## Rules
- Optical size: circles 10 percent larger than squares, triangles 15 percent larger.
- Same metaphor family: outline only, no mixed filled icons.
- Each icon must read at 16 px.

## Verify
screenshot the sheet; then screenshot_layers on two icons with lowRes to judge them at small size. Fix icons that look heavier or lighter than the rest.`;

const PRESENTATION = `---
name: presentation-layout
description: Lay out a slide deck (16:9 pages) with a title slide, section dividers and consistent content slides, using master-like repeated elements.
version: 1.0.0
tags: [layout, presentation]
allowed-tools: new_document, add_page, describe_page, run_plan, add_shape, add_text, add_chart, add_table, set_style, grid_layout, make_component, query_layers, apply_to_many, screenshot
params:
  - "topic: What the talk is about"
  - "slides: Number of slides (default: 8)"
when-to-use: presentation, slide deck, slides, keynote, pitch deck
---
# Presentation layout

Deck about {{topic}} with {{slides}} slides, 1920 x 1080 each.

## Workflow
1. Outline first in your reply: one line per slide (title + key message). Max one idea per slide.
2. new_document 1920 x 1080 (layout studio), then add_page for each further slide.
3. Build slide 1 (title) and one content slide with run_plan: background, title (64-80 px), body (32-36 px), slide number bottom right, small footer with the topic. Use a 12 column grid with 120 px outer margins.
4. Turn the repeated parts (footer, number, logo) into a component with make_component and copy them to every page.
5. Fill content slides: charts with add_chart, tables with add_table (max 5 rows), quotes as large text. Use grid_layout for two- or three-up content.
6. Section divider slides: full-bleed accent color, one big word.

## Rules
- Max 30 words per slide body. Titles say the takeaway ("Revenue doubled in Q3"), not the topic ("Revenue").
- Contrast 4.5:1, body never below 28 px on 1080 p.
- Consistent title position on every content slide (check with query_layers by name "Title").

## Verify
screenshot each slide (lowRes is enough), fix overflow and misaligned titles with apply_to_many on the "Title" layers.`;

const BROCHURE = `---
name: print-brochure
description: Lay out a print-ready brochure or flyer (A4/Letter, folds, bleed, margins, CMYK-safe colors) in the Layout studio.
version: 1.0.0
tags: [layout, print]
allowed-tools: new_document, add_page, describe_page, run_plan, add_shape, add_text, add_table, set_style, grid_layout, query_layers, screenshot, ask_user
params:
  - "format: a4, letter or tri-fold (default: a4)"
  - "subject: What the brochure promotes"
when-to-use: brochure, flyer, leaflet, print layout, trifold, booklet
---
# Print brochure

Subject: {{subject}}. Format: {{format}}.

## Sizes at 96 dpi (px)
- A4 portrait 794 x 1123; Letter 816 x 1056; tri-fold Letter landscape 1056 x 816 with panels of 352 px.
- Bleed 3 mm (12 px) on every side: backgrounds and images extend past the page edge by that much.
- Safe margin 12 mm (45 px) for text; 15 mm (57 px) on the fold side of a tri-fold.

## Workflow
1. new_document with the size (layout studio); add_page for the back side.
2. Build the grid: 12 columns or 3 panels; place guides mentally and keep text inside the safe margin.
3. With one run_plan per page: background (with bleed), headline (36-48 px), lead paragraph (14-16 px), body (11-12 pt = 15-16 px), images placeholders as rects named "Image", contact block.
4. Tables (prices, schedules) with add_table, max 6 columns.
5. Back page: call to action, address, QR placeholder (rect 120 x 120 named "QR").

## Rules
- Rich black for large areas only; text in 100 percent black.
- Avoid pure RGB neons; prefer colors that survive CMYK (no #00ff00, #ff00ff).
- Minimum text size 8 pt (11 px).

## Verify
screenshot each page; query_layers with within set to the trim box minus margins to find text outside the safe area and fix it.`;

const SOCIAL_KIT = `---
name: social-campaign-kit
description: Produce a matching set of social graphics (feed, story, link preview, banner) for one campaign message, as pages of one document with consistent styling.
version: 1.0.0
tags: [layout, social, marketing]
allowed-tools: new_document, add_page, describe_page, run_plan, add_shape, add_text, generate_image, set_style, make_component, grid_layout, query_layers, apply_to_many, spawn_agent, wait_agent, screenshot
params:
  - "message: The one campaign message"
  - "brand_color: Main color (default: #4f46e5)"
when-to-use: social campaign, instagram set, post and story, campaign assets, banner set
---
# Social campaign kit

Message: {{message}}. Brand color {{brand_color}}.

## Formats (one page each)
Feed 1080 x 1350, Story 1080 x 1920 (keep the top 250 px and bottom 340 px free), Link preview 1200 x 630, Banner 1500 x 500.

## Workflow
1. Design the feed post first (key visual): background, headline max 8 words, supporting line, call to action, logo. One run_plan.
2. Name the parts "Headline", "Sub", "CTA", "Logo", "Visual".
3. Create the other formats: for big kits, spawn_agent one agent per format with the exact sizes, colors and texts in its task (tools: design), then wait_agent. For small kits do it yourself with add_page and run_plan.
4. Harmonize with apply_to_many: same fonts and colors on every layer named Headline across pages.

## Rules
- Same headline wording on every format; only size and position change.
- Margins 7 percent of the shorter side. Text never within 40 px of an edge.
- Max two colors plus neutral.

## Copy
- Headline: the benefit in max 8 words ("Ship designs in half the time"), not the product name.
- Sub line: one concrete proof or detail (a number, a date, a place).
- Call to action: a verb plus the outcome ("Get the free kit"), 2-4 words, on a button shape with 4.5:1 contrast.
- Hashtags and handles go in the post caption, not on the image.

## Verify
screenshot each page with lowRes; check the story safe zones with query_layers (within the safe rectangle) and fix anything outside.`;

const MOBILE_UI = `---
name: ui-mockup-mobile
description: Design mobile app screens (390 x 844) with real UI structure - status bar, navigation, content, tab bar - using reusable components.
version: 1.0.0
tags: [vector, ui, mobile]
allowed-tools: new_document, add_page, describe_page, query_layers, run_plan, add_shape, add_text, import_svg, set_style, make_component, grid_layout, apply_to_many, screenshot, screenshot_layers
params:
  - "app: What the app does"
  - "screens: Screens to design (default: home, detail, profile)"
when-to-use: mobile app mockup, app screens, ios design, android design, ui mockup
---
# Mobile UI mockup

App: {{app}}. Screens: {{screens}}.

## Workflow
1. new_document 390 x 844 per screen (add_page for more). 8 px grid, 16 px side margins.
2. Shared chrome with make_component once, then copy: status bar (44 px), top app bar (56 px, title 17 px semibold), tab bar (83 px with 4-5 icons and labels 10 px).
3. Content per screen with one run_plan each: cards (radius 16, 16 px padding), list rows (56-72 px high, divider 1 px), primary button (48 px high, full width minus margins, radius 12).
4. Icons with import_svg (24 px, 2 px stroke) - reuse the same SVG for the same meaning.
5. Name everything ("Tab bar", "Card/Title", "Button/Primary") so query_layers and apply_to_many can fix things on all screens at once.

## Rules
- Touch targets at least 44 x 44 px; body text 15-17 px; contrast 4.5:1.
- One primary action per screen.
- Respect safe areas: nothing important in the top 44 px or bottom 34 px.

## Token-saving tips
- Build the first screen completely, then reuse its components; the other screens are mostly copies with overrides.
- Review with describe_page (scene text) instead of screenshots after every step; screenshot once per screen at the end.

## Verify
screenshot every screen; screenshot_layers on the tab bar and primary button to check alignment; fix inconsistent spacing with apply_to_many.`;

const DATAVIZ = `---
name: data-viz-report
description: Build a clear one- or two-page data report with linked tables and charts, a headline insight per chart and correct chart types.
version: 1.0.0
tags: [layout, data, charts]
allowed-tools: new_document, add_page, add_table, edit_table, read_table, import_csv_to_table, add_chart, edit_chart, read_chart, add_text, run_plan, evaluate, describe_page, grid_layout, screenshot
when-to-use: report, dashboard, chart, graph, kpi, data visualization, csv to chart
---
# Data visualization report

## Workflow
1. Get the data: import_csv_to_table for attached CSV text, or add_table. read_table to confirm types; use evaluate for totals, growth rates and averages instead of mental math.
2. Pick the chart by question: change over time - line; compare categories - bar (horizontal when labels are long); part of whole with 2-5 parts - stacked bar or donut; distribution - histogram (columns); relationship - scatter.
3. new_document 1240 x 1754 (A4 at 150 dpi) or 1920 x 1080 for screens. Header with title and one-sentence summary.
4. KPI row: 3-4 big numbers (40 px) with labels and change vs previous period, laid out with grid_layout.
5. Charts with add_chart linked to the table (tableId) so they update; one headline per chart that states the insight ("North grew 25 percent").
6. Sources and notes at the bottom in 12 px.

## Rules
- One accent color for the highlighted series, grays for the rest. Start bar axes at zero.
- Max 6 series per chart; label directly instead of a legend when possible.
- Round numbers sensibly (1.2k, 34 percent).

## Verify
read_chart to confirm series and labels, then screenshot the page. Check every headline against the numbers you computed.`;

const REFACTOR = `---
name: code-refactor-web
description: Refactor the HTML, CSS and JavaScript of the open website project safely - smaller files, tokens instead of magic numbers, no behavior change - with checks after each step.
version: 1.0.0
tags: [code, web, refactor]
allowed-tools: list_files, read_file, write_file, edit_file, rename_file, get_page_outline, check_problems, show_page, screenshot, search_knowledge
when-to-use: refactor, clean up code, reorganize css, split files, remove duplication
---
# Web code refactor

Refactoring changes structure, never behavior. Work in small verified steps.

## Workflow
1. list_files and read_file every file you will touch (once). check_problems for a baseline; screenshot for a visual baseline.
2. Plan the steps in your reply (max 6): e.g. extract CSS custom properties, merge duplicate selectors, split long JS into modules, replace inline handlers with addEventListener.
3. One step at a time with edit_file (small, exact replacements). Prefer edit_file over write_file for existing files so diffs stay reviewable.
4. After each step: check_problems; fix new problems before the next step.
5. Rename files with rename_file and update every reference (search the HTML for the old path with read_file).

## Rules
- Keep public ids, class names used by JS, and URLs unless asked.
- CSS: tokens in :root, no !important unless overriding third-party code, mobile-first media queries.
- JS: const and let, no globals, early returns, no dead code.

## Token-saving tips
- Read each file once and keep notes of line ranges; do not re-read a file after every edit unless an edit failed.
- Several small edit_file replacements beat rewriting a whole file with write_file.

## Verify
show_page and screenshot again; compare with the baseline. List what changed and what you deliberately left alone.`;

const SEO = `---
name: seo-and-meta-audit
description: Audit and fix on-page SEO and sharing metadata of the open website - titles, descriptions, headings, alt text, links, Open Graph - and report the rest.
version: 1.0.0
tags: [code, web, seo]
allowed-tools: list_files, read_file, edit_file, get_page_outline, list_elements, inspect_element, set_page_meta, set_element_attributes, check_problems, show_page, screenshot
when-to-use: seo, meta tags, open graph, search ranking, social preview, audit my site
---
# SEO and meta audit

## Checklist per page
1. get_page_outline: exactly one h1; headings in order without skipped levels; the h1 matches the page intent.
2. Title 50-60 characters with the main keyword first; meta description 120-155 characters that promise a benefit. Fix with set_page_meta.
3. lang attribute, viewport meta, canonical link, Open Graph title/description/image (1200 x 630) and twitter:card.
4. list_elements for img: every meaningful image gets descriptive alt (set_element_attributes); decorative images alt="". Width and height present.
5. Links: descriptive text (not "click here"), external links with rel="noopener".
6. Content: the main keyword appears in the first 100 words; paragraphs short; no duplicate titles across pages.

## Workflow
Inspect with read-only tools first and write a short findings table in your reply (issue, page, fix). Then fix what is safe automatically; ask before rewriting visible copy.

## Rules
- Never stuff keywords; write for people.
- Do not invent facts in descriptions.
- Be honest about limits: rankings depend on content, links and performance that an on-page audit cannot change.

## Verify
check_problems, then show_page and screenshot the page head area. Report the fixed items and the open ones.`;

const A11Y_FIX = `---
name: accessibility-fixes
description: Find and fix accessibility problems in designs and websites - contrast, text size, focus, labels, alt text, touch targets - with measured values, not guesses.
version: 1.0.0
tags: [accessibility, web, vector]
allowed-tools: describe_page, query_layers, apply_to_many, set_style, evaluate, get_page_outline, list_elements, inspect_element, set_element_attributes, set_element_style, check_problems, screenshot
when-to-use: accessibility, a11y, wcag, contrast check, screen reader, make it accessible
---
# Accessibility fixes

Measure, then fix. Report numbers.

## Designs (canvas)
1. describe_page; query_layers type text with fields text, fill, w, h.
2. For each text layer compute contrast against what is behind it with evaluate (WCAG relative luminance; 4.5:1 for normal text, 3:1 for text of 24 px or 19 px bold and up).
3. Fix failing colors with apply_to_many (darken text or the background in steps of about 10 percent lightness until it passes).
4. Text below 12 px: raise to 12 px minimum (16 px for body).
5. Interactive shapes (buttons) smaller than 44 x 44 px: enlarge.

## Websites (Code studio)
1. get_page_outline: landmarks, one h1, heading order.
2. list_elements for img, button, a, input: alt text, accessible names, labels (set_element_attributes aria-label only when there is no visible label).
3. Focus: set_element_style with a visible :focus-visible outline (2 px, offset 2 px). Never remove outlines.
4. Motion: wrap animations in prefers-reduced-motion.
5. Forms: every input has a visible label; errors are announced in text, not only by color.

## Token-saving tips
query_layers with fields text, fill returns exactly what the contrast check needs; run evaluate once over the whole list instead of once per layer.

## Verify
check_problems, then screenshot. List each fix with before and after values (contrast ratio, size).`;

const LOCALIZE = `---
name: copy-localization
description: Translate and adapt all text of a design or website into another language, keeping layout, tone and length limits, with text-fit checks.
version: 1.0.0
tags: [text, localization]
allowed-tools: query_layers, describe_page, apply_to_many, set_style, run_plan, read_file, edit_file, get_page_outline, transform_file_text, screenshot
params:
  - "language: Target language"
  - "tone: Voice to keep (default: same as the source)"
when-to-use: translate, localize, localization, german version, french version, language version
---
# Copy localization

Target: {{language}}. Tone: {{tone}}.

## Workflow (designs)
1. query_layers type text with fields id, text, w, h - this is your string table. Do not use list_layers.
2. Translate meaning, not words: idioms, units (cm and inch), date and number formats, currency, quotes. Keep brand names and product names.
3. Apply all strings in ONE run_plan of set_style text changes (one step per layer id).
4. Expansion: German and French run about 20-35 percent longer. If a text box would overflow, shorten wording first, then reduce the font size by at most 10 percent.

## Workflow (websites)
read_file each HTML file, translate text nodes and alt/title/aria-label attributes, set the lang attribute, update the page title and meta description; edit_file per file.

## Rules
- Never translate placeholders, code, URLs or variable names.
- Keep line breaks of headlines where they carry meaning.
- Keep the register (formal or informal address) consistent across all strings; for German decide du or Sie once.

## Token-saving tips
One query_layers call gives every string; one run_plan writes them all back. Avoid screenshots until the end.

## Verify
screenshot every page; query_layers again and compare text lengths with the box widths; read the final copy once more for tone {{tone}}.`;

const BRAND_FROM_LOGO = `---
name: brand-from-logo
description: Derive a brand identity (palette, type pairing, tone and usage rules) from an existing logo image or vector, and document it on a brand sheet.
version: 1.0.0
tags: [branding, vector]
allowed-tools: list_attachments, open_attachment, describe_page, query_layers, get_histogram, evaluate, new_document, run_plan, add_shape, add_text, make_component, grid_layout, screenshot, remember
when-to-use: brand from logo, extract colors from logo, brand guidelines from my logo, style from logo
---
# Brand from logo

## Workflow
1. Get the logo: list_attachments and open_attachment when the user attached it; otherwise use the open document (describe_page).
2. Extract colors: for vectors query_layers with fields fill; for images get_histogram. Cluster into 2-4 brand colors; compute tints, shades and contrast pairs with evaluate.
3. Read the shape language: geometric or organic, rounded or sharp corners, thin or heavy strokes. Choose a type pairing that echoes it (geometric sans for geometric marks, humanist sans or serif for organic ones).
4. Build a brand sheet (new_document 1600 x 1000) with one run_plan per section: logo area with clear space, palette swatches with hex and contrast notes, type specimen, do and do-not examples (made with make_component copies of the logo with wrong colors crossed out).
5. remember the palette and fonts.

## Rules
- The palette must include an accessible text color pair (4.5:1).
- Do not redraw or alter the logo itself.
- Name the colors by role (Primary, Accent, Ink, Paper) and give each its hex value and the text color that may sit on it.
- Clear space equals the height of the logo's main letter or symbol; minimum size is where details still read.

## Verify
screenshot the sheet and check that every swatch label matches its fill (query_layers fill).`;

const CSS_ANIM = `---
name: web-animation-css
description: Add tasteful, performant CSS animations and transitions to the open website (entrance, hover, scroll-linked), respecting reduced motion.
version: 1.0.0
tags: [code, web, animation]
allowed-tools: read_file, edit_file, write_file, get_page_outline, select_element, inspect_element, set_element_style, check_problems, show_page, screenshot
when-to-use: animation, animate, transitions, hover effect, motion, make it feel alive
---
# Web animation (CSS)

Motion should explain change, not decorate. Fewer, better animations.

## Workflow
1. read_file the CSS and get_page_outline; pick at most three targets: hero entrance, interactive hover/focus states, one scroll reveal.
2. Define tokens in :root: durations 150 ms (micro), 250 ms (UI), 400-600 ms (entrance); easing cubic-bezier(0.2, 0.8, 0.2, 1) for enter and ease-in for exit.
3. Animate only transform and opacity (GPU friendly); never width, height, top or left.
4. Entrance: @keyframes fade-up from translateY(12px) and opacity 0; stagger children with animation-delay steps of 60 ms.
5. Hover and focus-visible together; transitions on the property, not "all".
6. Scroll reveal without JS where possible (animation-timeline: view() with a fallback that shows content immediately).
7. Wrap everything in @media (prefers-reduced-motion: no-preference) or disable it in a reduce block.

## Rules
- Nothing loops forever except loading indicators. No motion longer than 800 ms.
- Content must be visible if animations fail.

## Verify
check_problems, show_page and screenshot; inspect_element a hovered button to confirm the transition rule exists and the reduced-motion block is present.`;

const PROJECT_LEAD = `---
name: multi-agent-project-lead
description: Lead a bigger job by splitting it into independent parts, delegating them to parallel sub-agents with spawn_agent, and integrating and verifying the results.
version: 1.0.0
tags: [agents, planning]
allowed-tools: update_plan, describe_page, query_layers, spawn_agent, wait_agent, list_agents, cancel_agent, run_plan, apply_to_many, screenshot, ask_user
when-to-use: big project, several parts, in parallel, multiple agents, delegate, brand kit with agents, whole campaign
---
# Multi-agent project lead

You are the lead. Sub-agents are fast, parallel and cheap, but they cannot see this conversation and they share the document with each other.

## When to delegate
- Delegate parts that are independent and take 3 or more tool calls each (one page of a kit, one section of a site, one icon group).
- Do it yourself when the work is small, strictly sequential, or needs the user's taste decisions.

## Workflow
1. update_plan with the parts. Decide shared constraints first (palette, fonts, sizes, page or group per agent) - write them once.
2. Prepare the canvas yourself (pages, empty named groups) so each agent gets its own area. Get ids with query_layers.
3. spawn_agent per part (max 3-4). Each task is self-contained: goal, exact area (page id or group id and coordinates), colors as hex, fonts, sizes, names to use, what to return. Give minimal tool sets (design, web, pixel, layout, read-only) and constraints like "only edit layers inside group g12".
4. wait_agent for all. Read the summaries and artifacts (layer ids, files).
5. Integrate: fix inconsistencies across parts with apply_to_many (fonts, colors, spacing), align with run_plan.
6. If an agent failed, either retry with a clearer task or finish the part yourself - say which.

## Rules
- Never give two agents the same area. Never let agents ask the user; collect questions and ask once.
- Keep tasks under 120 words; include numbers, not adjectives.

## Verify
screenshot the whole result, then describe_page to check names and positions. Report per part: done by which agent, what you changed while integrating.`;

// Facts below come from the developer's own public pages (https://philipp-paulik.de, https://github.com/philppplik, checked
// October 2026) and from this repository (counts verified with scripts: 6 studios, 2 UI languages, 1300+ unit tests, MIT).
// Do not add anything that is not publicly stated there: no contact data, no private details.
const ABOUT_DEVELOPER = `---
name: about-the-developer
description: Answer questions about who made OpenFini, with only publicly stated facts about the developer Philipp Paulik and about the project, in a friendly and respectful tone.
version: 1.0.0
tags: [about, openfini]
allowed-tools: search_knowledge, remember, ask_user
when-to-use: who made openfini, who is the developer, who built this, who created this app, who is behind openfini, wer hat openfini gemacht, wer ist der entwickler, wer steckt dahinter, about the author
---
# About the developer

Use this when someone asks who made OpenFini, who the developer is, or who is behind it. Answer in the language the user writes in (German question, German answer). Be warm, brief and factual: two to six sentences, not a biography.

## The facts you may state (all publicly stated)
- OpenFini is developed by Philipp Paulik. Sources: his website https://philipp-paulik.de, his GitHub profile https://github.com/philppplik (user name philppplik) and the repository https://github.com/philppplik/open-fini.
- OpenFini is open source under the MIT license and was started in 2026.
- On his own website and GitHub profile he describes himself as an AI pioneer and strategist, web and UI/UX designer, author and software engineer, based in Bonn, Germany. He also lists that he is training as a media designer (digital and print).
- Other projects he lists publicly include true-code (an agentic coding harness in Rust that shows what the agent did and what it cost), ZWEP (a self-hosted search engine with MCP support for AI agents), Flower (a browser-based ASCII image studio), pBlock (a Chrome ad blocker) and claude-tetris (a Tetris plugin for Claude Code). His stated stack includes TypeScript, Rust and Python; his stated interests include AI strategy and agents, design and typography, motion, open source and systems thinking.
- He also writes satirical books, starting with Hallo Welt (stated on his website).

## Nice facts about OpenFini itself (verified in the repository)
- It has six studios: Vector, Pixel, Layout, Code, Vibe (this assistant) and Office, and every one of them is also something you can ask the assistant to do.
- It is clean-room: written from public specifications and general knowledge, with no code or assets taken from other products (see docs/clean-room.md in the repository).
- One code base runs as a Tauri desktop app and as an installable web app (PWA), is written without a UI framework, and has more than 1,300 automated tests.
- The interface is available in English and German, and the assistant has well over 100 tools.

## Rules
- Say clearly that you only know what is listed here. For anything else (private life, plans, availability, business questions) say you do not know and point to https://philipp-paulik.de and https://github.com/philppplik.
- Never guess or invent details, never repeat contact data, and do not speculate about opinions, finances or private matters. Do not list e-mail addresses or phone numbers, even if you believe you know them; the websites above are the place to reach him.
- If someone wants to report a bug or contribute, point to the repository (Issues, CONTRIBUTING.md) instead.
- Stay respectful about the developer and about other products; no jokes at anyone's expense. A light, friendly tone is welcome.
- Do not call any tool for this question unless the user asks for more than the facts above; search_knowledge is only for project notes the user stored themselves.

## Verify
Read it aloud before sending: every sentence must trace back to a line in this skill, the language must match the user's, and nothing may sound like an unverified claim about a person. If a statement does not trace back, delete it.`;

const ADDRESS_COMMENTS = `---
name: address-comments
description: Go through the open comments of the active document, read each one together with its exact place, make the precise edit with the right tools, reply with what changed and resolve it.
version: 1.0.0
tags: [comments, review, collaboration]
allowed-tools: list_comments, get_comment_context, reply_comment, resolve_comment, get_document_info, list_layers, set_style, transform_layers, add_text, add_shape, delete_layers, screenshot, read_file, edit_file, write_file, get_page_outline, set_element_style, insert_element, office_read_document, office_replace_text, office_insert_blocks, office_apply_format, ask_user
params:
  - "only: Optional thread id or a keyword to address only some comments (default: all open comments)"
when-to-use: address comments, work through the comments, resolve feedback, review comments, go through the notes, Kommentare abarbeiten, Feedback umsetzen
---
# Address comments

Goal: every open comment of the active document is either implemented and resolved, or answered and left open when it needs a human decision. Comments are saved in the document, so they come from people who reviewed the file, with or without a live room.

## Workflow
1. Call list_comments (status open). If {{only}} is given, keep only the matching thread id or the threads whose text contains it. Work through them in the order returned (oldest first).
2. For each thread call get_comment_context with its id. It returns the thread, the resolved target (layer id, name, type and bounds; code file and line range with the code; website element and its HTML; Office paragraph with the quoted text) and, for canvas comments, a cropped screenshot. If the target says exists false or stale true, use the saved quote to find the new place before you edit, or reply that it could not be found.
3. Decide what the comment asks:
   - a concrete change (color, wording, size, spacing, bug): make it with the matching tools on exactly the target, nothing else. Layers: set_style, transform_layers, add_text, delete_layers. Code: read_file around the lines, then edit_file. Website elements: set_element_style or edit_file. Office text: office_replace_text with the exact original sentence as find.
   - a question: answer it with reply_comment and leave it open.
   - unclear or a taste decision: ask_user once, or reply with a short question and leave it open.
4. Verify the edit (screenshot for layers, read_file for code) before you claim it.
5. Call reply_comment with one or two sentences: what you changed and where (layer name, file and line). Then call resolve_comment. Never resolve a comment you did not address.
6. At the end summarize: how many were resolved, how many were left open and why.

## Rules
- Touch only what a comment points at; do not redesign. One undoable step per comment is ideal.
- Keep the language of the comment in your reply (German comment, German reply).
- Do not delete comments. Do not reopen resolved ones unless the user asks.
- Replies and resolving are shared with the room when the user is in one: keep them short and factual.

## Verify
Call list_comments again: the ones you resolved must be gone from the open list, and every remaining open comment must have your reply explaining why.
`;

export const LIBRARY_SKILLS = [DESIGN_SYSTEM, RESPONSIVE_SITE, PHOTO_COMP, ICON_SET, PRESENTATION, BROCHURE, SOCIAL_KIT, MOBILE_UI, DATAVIZ, REFACTOR, SEO, A11Y_FIX, LOCALIZE, BRAND_FROM_LOGO, CSS_ANIM, PROJECT_LEAD, ABOUT_DEVELOPER, ADDRESS_COMMENTS];
