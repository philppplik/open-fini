// Built-in skills for Vibe, as SKILL.md style markdown strings. Parsed by parseSkill() in skills.js.
// Tool names refer to the "OpenFini tool names" list in docs/ai-engine.md.
// (No backticks or template placeholders inside the markdown, so plain template literals are safe.)

const LOGO = `---
name: logo-design
description: Design a simple, memorable logo and its variants (full color, one color, reversed) in the Vector studio. Use for brand marks, wordmarks and app icons.
allowed-tools: get_document_info, add_shape, add_path, add_text, set_style, align_layers, group_layers, transform_layers, screenshot, ask_user, remember
tags: [vector, branding]
---
# Logo design

A good logo is simple, distinctive and works at 16 px and on a billboard. Aim for one idea, not three.

## Workflow
1. Gather the brief. If you do not know the name, the industry, the audience and two or three adjectives for the personality (for example "calm, precise, friendly"), ask once with ask_user. Check search_knowledge for an existing brand guide.
2. Pick one concept: a wordmark (name set in type), a symbol plus wordmark, or a monogram. Describe the idea in one sentence before drawing.
3. Create a square artboard (1024 x 1024 px) with get_document_info to confirm the size. Build the mark first, on its own, centered.
4. Build with primitives: circles, rounded rectangles and add_path for custom curves. Keep node counts low. Use consistent stroke widths (multiples of 8 px at 1024) and one corner radius throughout.
5. Add the name with add_text. Choose one typeface with real personality; set tracking +2 to +6 percent for all caps, 0 to -2 percent for lowercase display sizes. Align the optical baseline of the symbol and the text with align_layers.
6. Group every part (group_layers) and name the groups: "Mark", "Wordmark", "Lockup".

## Design rules
- Maximum 2 colors plus neutral, chosen with intent. Check contrast of the mark against white and against the dark background: at least 3:1.
- Use a grid: construct shapes from circles and squares of related sizes (ratios such as 1:2 or 1:1.618). Equal visual weight beats equal geometry, so nudge shapes optically.
- Clear space around the lockup equals the height of the symbol's main shape divided by two. Minimum size: the mark must stay legible at 16 px.
- Avoid gradients, thin hairlines under 2 px at 1024, effects and stock clip art.

## Variants to deliver
Full color on white, one-color black, one-color white on a dark square, and a compact icon version (mark only) in a rounded square.

## Verify
Call screenshot. Then scale a duplicate of the lockup down to about 32 px (transform_layers) and screenshot again: if details disappear, simplify. Finally use remember to store the final colors and fonts.`;

const SOCIAL = `---
name: social-post
description: Design social media graphics (feed posts, stories, link previews) with a clear single message, readable type and correct sizes.
allowed-tools: get_document_info, add_shape, add_text, set_style, align_layers, group_layers, generate_image, edit_image, screenshot, ask_user, search_knowledge
tags: [layout, social, marketing]
---
# Social post

One post, one message. If a viewer cannot read it in two seconds on a phone, it is too busy.

## Sizes (px)
- Feed square 1080 x 1080, portrait 1080 x 1350 (best reach on Instagram), landscape 1080 x 566.
- Stories and Reels 1080 x 1920. Keep the top 250 px and the bottom 340 px free of important content (app interface).
- Link preview and Open Graph 1200 x 630. X/Twitter image 1600 x 900. LinkedIn 1200 x 627.
Create the page with the right size first (add_page or get_document_info to check).

## Workflow
1. Clarify platform, goal (announce, sell, teach, entertain) and the single message. Ask with ask_user only if it is unclear. Use search_knowledge for brand colors, fonts and tone.
2. Choose the layout: full-bleed image with text on a scrim, split layout (image and color block), or typographic post.
3. Background: a solid brand color, a gradient of two close hues, or a generated or provided photo (generate_image / edit_image). If text goes over a photo add a dark or light overlay shape at 40 to 60 percent opacity.
4. Type with add_text. Headline first, then the supporting line, then the call to action or handle.
5. Align with align_layers to a shared left edge or center axis. Group and name layers.

## Rules
- Margins at least 80 px on 1080 canvases (about 7 percent). Never place text within 40 px of the edge.
- Type scale on a 1080 px canvas: headline 72 to 120 px (bold, max 8 words, 2 to 3 lines), supporting text 36 to 48 px, small print never below 28 px.
- Contrast: 4.5:1 for text under 24 px and 3:1 for large text. White on a mid-tone photo needs an overlay.
- Maximum 2 typefaces and 3 colors. Use one accent color for the single thing that matters.
- Line length: 20 to 30 characters per line for headlines. Left-align multi-line text.
- Leave at least 20 percent of the canvas empty.

## Verify
Call screenshot. Squint test: shrink your mental view; the headline must still be the first thing you see. Check nothing sits in the story safe zones, then summarize the choices in two sentences and offer two variants (for example another color or crop).`;

const PHOTO = `---
name: photo-retouch
description: Non-destructive photo correction and retouching in the Pixel studio (exposure, color, contrast, cleanup, sharpening) with a before and after check.
allowed-tools: get_document_info, list_layers, select_layers, add_pixel_layer, apply_adjustment, list_effects, edit_image, set_style, screenshot, get_histogram, auto_correct_suggestion, ask_user
tags: [pixel, photo]
---
# Photo retouch

Work non-destructively and in a fixed order. Small moves add up; big moves look fake.

## Workflow
1. Inspect: get_document_info and list_layers. Take a screenshot to see the original. Call get_histogram first (composite, channel luma) and read its assessment: exposure, contrast, clipping and color cast decide the next steps; auto_correct_suggestion returns ready-made levels, curves and exposure params for apply_adjustment. Never edit the original layer; duplicate it or use adjustment layers.
2. Crop and straighten first (horizon level, remove distractions at the edges, keep the subject on a third line).
3. Exposure and white balance: use apply_adjustment for exposure and temperature/tint. Neutral grays should look neutral; skin should stay warm but not orange.
4. Contrast: lift shadows and recover highlights before adding global contrast. Use a gentle curve (S-curve of 5 to 10 percent) instead of a heavy contrast slider.
5. Color: raise vibrance before saturation. Typical safe range: vibrance +10 to +25, saturation 0 to +10. Fix single problem colors with hue/saturation targeted at that range.
6. Local fixes: dodge and burn on separate pixel layers (add_pixel_layer, soft low-opacity brush areas, 10 to 20 percent). Remove blemishes on their own layer.
7. Noise reduction (only if needed, luminance 10 to 30 percent) comes before sharpening.
8. Sharpen last with apply_adjustment (kind filter, id unsharp-mask; call list_effects for the parameters): amount 40 to 80 percent, radius 0.8 to 1.5 px for web, 1.5 to 3 px for print).

## Rules
- Check the histogram intent (get_histogram again after the adjustments): do not clip more than about 1 percent of pixels to pure black or white unless the look demands it.
- Keep skin tones consistent across the frame. Avoid heavy skin smoothing: keep pores visible.
- Keep every step on its own named layer so the user can switch it off.
- Export-ready images: sRGB, long edge 2048 px for web unless the user says otherwise.

## Verify
Screenshot the result and describe the before and after in two or three bullet points. If the user asked for a style (moody, bright, film), name which adjustments create it and offer a milder or stronger version.`;

const LANDING = `---
name: landing-page
description: Build a responsive, accessible, fast landing page (HTML and CSS, optional JS) in the Code studio with a proven section structure and clear copy.
allowed-tools: list_files, read_file, write_file, edit_file, insert_element, set_element_style, set_page_meta, search_knowledge, screenshot, ask_user, remember
tags: [code, web, marketing]
---
# Landing page

One page, one goal (sign up, buy, download). Everything supports a single primary call to action.

## Workflow
1. Clarify product, audience, primary action and tone; check search_knowledge for brand material. Ask with ask_user only for what you truly cannot infer.
2. list_files, then write index.html and styles.css (plus script.js only when needed). Keep it dependency-free: no frameworks, no external fonts unless asked (use a system font stack).
3. Structure, top to bottom: header with logo and one nav CTA, hero (headline, one sentence of support, primary button, visual), social proof (logos or a short quote), three benefits, how it works (3 steps), testimonial or numbers, pricing or final CTA, FAQ (4 to 6 questions), footer with legal links.
4. Set metadata with set_page_meta: title (50 to 60 characters), meta description (120 to 155), viewport, lang, Open Graph title, description and image.
5. Refine with edit_file, insert_element and set_element_style instead of rewriting whole files.

## HTML rules
- Semantic landmarks: header, nav, main, section with headings, footer. One h1, headings in order.
- Buttons are button or a elements with visible text. Images have alt text (empty alt for decoration) and width and height attributes. Add loading="lazy" below the fold.
- Forms: every input has a label; use autocomplete and the right input type.

## CSS rules
- Custom properties for colors, spacing (4 or 8 px scale) and radii. Fluid type with clamp(): body 1rem to 1.125rem, h1 clamp(2.25rem, 5vw + 1rem, 4rem).
- Layout: max-width 1100 px for sections, 65 characters for paragraphs, CSS grid with auto-fit minmax(260px, 1fr) for cards. Mobile first; breakpoints at 640 and 960 px.
- Contrast 4.5:1 for body text, 3:1 for large text and UI. Visible focus styles. Respect prefers-reduced-motion. Tap targets at least 44 x 44 px.
- Performance: no layout shift (reserve image space), under 100 KB total CSS and JS, no blocking scripts.

## Copy rules
Headline states the outcome in 6 to 10 words; the subhead names who it is for and how; the button says what happens next ("Start free trial", not "Submit").

## Verify
screenshot at desktop width and at 375 px width (set the preview width if the tool supports it). Check text wraps, nothing overflows horizontally, and the first screen shows headline plus button without scrolling. Summarize what you built and what content the user should replace.`;

const POSTER = `---
name: poster-layout
description: Lay out posters and flyers with a strong focal point, clear hierarchy, a grid, print-safe margins and bleed.
allowed-tools: get_document_info, add_page, add_shape, add_text, add_path, set_style, align_layers, group_layers, reorder_layers, generate_image, screenshot, ask_user, search_knowledge
tags: [layout, print, poster]
---
# Poster layout

A poster is read from several meters away, then from one. It needs one focal point, three levels of text and plenty of air.

## Setup
- Common sizes: A3 (297 x 420 mm), A2 (420 x 594 mm), 18 x 24 in, 24 x 36 in. At 150 ppi that is 3508 x 4961 px for A3; for screen drafts use a width of about 1200 px with the same ratio.
- Bleed 3 mm (0.125 in) on all sides. Keep text and logos inside a safe margin of at least 5 percent of the width. Create the page with add_page and confirm with get_document_info.

## Workflow
1. Ask or infer: event or message, date, place, audience, tone. Collect required details (date, time, venue, URL or QR code) so none is forgotten.
2. Choose the focal element: a large image, an illustration, or the headline itself as typography. Place it on a rule-of-thirds line or centered on purpose.
3. Build a modular grid: 6 columns by 8 rows, 5 percent margins, 2 percent gutters. Snap blocks to it with align_layers.
4. Three levels of text. Level 1 headline: at least 8 percent of the page height, 1 to 6 words. Level 2: 2.5 to 4 percent of height (date, place). Level 3: 1.5 to 2 percent of height (details, credits, URL). A scale ratio of 1.5 between levels works well.
5. Add the background and shapes, then text, then arrange the stacking with reorder_layers (background at the bottom, text on top). Group the information block.

## Rules
- Max 2 typefaces and 3 colors. One dominant color, one accent used sparingly.
- Contrast 7:1 is a good target for the headline, never below 4.5:1 for small text. Add scrims over busy images.
- Whitespace is a feature: leave at least 25 percent of the area empty or calm.
- Align to the grid. Left-aligned text with a ragged right edge reads best; avoid more than 4 alignments in total.
- Images for print need at least 150 ppi at final size; if you generate an image, use the largest size offered and upscale only slightly.

## Verify
screenshot, then check: (1) can I find the date and place within five seconds, (2) is there exactly one focal point, (3) is anything closer than 5 percent to the edge, (4) is every required fact present. Fix and screenshot again.`;

const BRAND = `---
name: brand-kit
description: Create a compact brand kit - color palette with accessible pairs, type system, logo usage rules and design tokens - as a document page plus a tokens file.
allowed-tools: get_document_info, add_page, add_shape, add_text, set_style, align_layers, group_layers, write_file, search_knowledge, remember, ask_user, screenshot
tags: [branding, layout, code]
---
# Brand kit

A brand kit is a short, usable reference. Make decisions, document them, and make them easy to reuse.

## Workflow
1. Gather inputs: name, what the company does, audience, three personality words, existing assets (search_knowledge). Ask with ask_user for anything essential that is missing.
2. Color: one primary, one secondary, one accent, a neutral ramp of 9 steps (50 to 900) and four semantic colors (success, warning, danger, info). Name each color and give HEX and RGB.
3. Verify contrast: compute the WCAG contrast ratio, (L1 + 0.05) / (L2 + 0.05), where L is relative luminance. Document which text and background pairs pass AA (4.5:1 normal text, 3:1 large text and UI) and which are decoration only.
4. Typography: at most two families (one for display or headings, one for text). Define a scale with ratio 1.25 (major third): 12, 14, 16, 20, 25, 31, 39, 49 px, with line heights 1.5 for body and 1.1 to 1.2 for headings. Prefer fonts with open licenses or system fallbacks.
5. Logo usage: clear space, minimum size, allowed backgrounds, and three "do not" examples (stretch, recolor, add effects).
6. Layout and shape: spacing scale (4, 8, 12, 16, 24, 32, 48, 64), corner radius, shadow levels, icon style, image style.
7. Build one overview page (add_page, 1920 x 1080) with swatches (add_shape), type specimens (add_text) and rules. Align and group in sections.
8. Write design tokens with write_file as tokens.css using CSS custom properties (--color-primary, --space-4, --radius-md ...).
9. Store the essentials with remember (colors, fonts, tone) so later tasks stay on brand.

## Rules
- Palette harmony: derive secondary and accent from the primary by hue shifts of 30 to 60 degrees or a complementary hue, and keep saturation within a similar range.
- Do not rely on color alone to carry meaning.
- Keep the kit to what will actually be used. Fewer, clearer decisions beat a long list.

## Verify
screenshot the overview page; confirm every swatch is labeled with name, HEX and a contrast note, and that tokens.css contains every color and size shown on the page.`;

const A11Y = `---
name: accessibility-audit
description: Audit designs and web pages for accessibility (WCAG 2.2 AA) - contrast, text size, structure, keyboard and screen reader basics - and fix the findings.
allowed-tools: list_layers, get_selection, get_document_info, screenshot, list_files, read_file, edit_file, set_element_style, insert_element, set_page_meta, set_style, ask_user
tags: [code, design, accessibility]
---
# Accessibility audit

Check, report with severity, fix, and re-check. Be specific: name the element, the problem, the rule and the fix.

## Design documents (Vector, Pixel, Layout)
1. List text layers and their colors and backgrounds (list_layers, get_selection). For each pair compute the contrast ratio: relative luminance L = 0.2126 R + 0.7152 G + 0.0722 B using linearized sRGB channels (c / 12.92 if c <= 0.04045, otherwise ((c + 0.055) / 1.055) ^ 2.4); ratio = (L1 + 0.05) / (L2 + 0.05).
2. Thresholds: 4.5:1 for normal text; 3:1 for large text (at least 24 px, or 18.66 px bold) and for icons and UI component boundaries.
3. Type size: body text at least 16 px on screen (12 pt in print); avoid text under 12 px. Line height at least 1.4. Line length 45 to 80 characters.
4. Do not use color as the only signal (add icon, label or pattern). Text over images needs a scrim.
5. Fix by adjusting colors with set_style: darken text or lighten backgrounds in small steps until the ratio passes, keeping the brand hue.

## Web pages (Code studio)
1. read_file index.html and the CSS. Check:
   - lang attribute on html; unique descriptive title; viewport meta without user-scalable=no.
   - Landmarks (header, nav, main, footer), exactly one h1, headings not skipping levels.
   - Images: meaningful alt, empty alt for decoration. Icon-only buttons: aria-label.
   - Forms: label tied to every control, error messages in text, autocomplete attributes.
   - Links: text that makes sense out of context (no "click here"); do not open new tabs silently.
   - Keyboard: everything reachable and operable, logical tab order, visible focus (never outline: none without a replacement), no keyboard traps.
   - Target size at least 24 x 24 CSS px (aim for 44).
   - Motion: honor prefers-reduced-motion; no autoplay audio; nothing flashes more than 3 times per second.
   - Reflow: no horizontal scroll at 320 px width; text can zoom to 200 percent.
2. Fix with edit_file, insert_element or set_element_style in small steps.

## Report format
A short table: severity (blocker, serious, minor), location, problem, fix applied or recommended. End with what you could not verify (screen reader behavior, real keyboard use) and suggest a manual check.

## Verify
screenshot after fixes and re-run the contrast math on every pair you changed.`;

const COPY = `---
name: copywriting
description: Write clear, persuasive, on-brand copy - headlines, calls to action, microcopy and short-form text - with variants and length limits.
allowed-tools: search_knowledge, remember, ask_user, add_text, edit_file, set_page_meta
tags: [writing, marketing]
---
# Copywriting

Clear beats clever. Write for one person, in their words, about their outcome.

## Workflow
1. Define audience, goal, channel and voice. Check search_knowledge for brand voice, glossary and existing copy. If you have no voice, ask in one question (formal or casual, playful or serious).
2. Lead with the benefit, then the proof, then the action. Pick a frame: Problem, Agitate, Solve for pain-driven offers; Before, After, Bridge for transformations; AIDA for ads.
3. Write three variants that differ in angle (benefit, curiosity, proof), not just wording. Recommend one and say why in a sentence.
4. Apply the copy where it belongs with add_text, edit_file or set_page_meta, then re-read it in context.

## Length limits
- Headline: 6 to 10 words (under 60 characters). Subhead: under 20 words.
- Button: 2 to 4 words, starts with a verb, says what happens next ("Get my free report").
- Meta title 50 to 60 characters; meta description 120 to 155. Social caption: first line carries the hook (about 125 characters before truncation).
- Error messages: say what happened and how to fix it, in one or two short sentences. Empty states: explain the value and offer one action.

## Style rules
- Plain US English, active voice, short sentences, concrete numbers instead of adjectives ("saves 4 hours a week").
- Avoid jargon, filler (very, really, just), exclamation marks (max one per page), all caps and unproven superlatives ("best", "revolutionary").
- Use you and your; use we sparingly. Be consistent with terms: pick one word per concept.
- Never invent facts, testimonials, prices or statistics. Mark placeholders clearly, for example [add real number].
- Accessibility: link text makes sense alone, no text embedded in images without a text alternative.

## Verify
Read each line aloud. Cut every word that does not change the meaning. Check against the limits above and against the brand voice. Offer to adapt the winner for other channels. Use remember to save the chosen voice and key phrases.`;

const HELP = `---
name: help-me-use-openfini
description: Explain how to do something in OpenFini (where a tool or command is, its shortcut, which studio to use), switch themes, and start a guided tour. Use when the user is new, lost or asks "how do I ...".
allowed-tools: list_commands, list_themes, set_theme, start_tour, get_document_info, set_studio, screenshot, ask_user
tags: [help, onboarding]
---
# Help me use OpenFini

Answer with the shortest path: name the studio, the menu or panel, and the shortcut. Never invent a command: look it up first.

## Workflow
1. Find out where the user is. get_document_info tells you the open document and the studio. If the task belongs in another studio, say which one and offer to switch with set_studio.
2. Look the feature up with list_commands, using one or two key words ("export", "align", "zoom"). The result lists each command with its shortcut. You cannot run commands yourself, so describe how the user reaches it: the menu name, the shortcut, or the command palette (Ctrl+K, or Cmd+K on macOS, or F1).
3. If the user looks lost or is new, offer a tour and call start_tour (welcome for the whole interface, or vector, pixel, layout, code or vibe for one studio). Tell them they can leave it with Esc.
4. For "make it darker", "use a calmer look" or accessibility needs, call list_themes, suggest one or two themes by name, then call set_theme. Every theme has a dark and a light variant; mode can be dark, light or auto. The High contrast theme is the most legible. Ask with ask_user only when the choice is unclear.

## Where things live
- Vector: logos, icons, illustration. Pixel: photos and painting. Layout: pages and text flow. Code: websites. Vibe: the AI assistant.
- Export is the button at the top right (Ctrl+Shift+E) and works from every studio.
- Settings: the OpenFini menu at the top left, then Settings (Ctrl+comma). Appearance holds themes, accent, density and scale; Accessibility holds motion and contrast.
- Shift+F1 turns on What's this?: the user clicks anything to read what it does.

## Rules
- Be concrete: "Press Ctrl+Shift+E" beats "use the export feature".
- If list_commands finds nothing, say so and suggest the command palette or the Help menu rather than guessing.
- Keep answers to a few lines; offer the tour instead of a long explanation.

## Verify
Check the shortcut you quote against the list_commands result. After set_theme, take a screenshot and confirm the interface changed, then tell the user how to go back (Settings, Appearance).`;

const REPORT = `---
name: report-with-charts
description: Build a report or dashboard page with real tables and charts (editable, vector, linked to each other): KPI cards, a data table with totals, and a matching chart. Use for sales reports, price lists, project status, survey results and one-page summaries.
allowed-tools: get_document_info, new_document, add_text, add_shape, add_table, edit_table, read_table, list_tables, add_chart, edit_chart, read_chart, import_csv_to_table, align_layers, group_layers, screenshot, ask_user
tags: [layout, data, report]
---
# Report with tables and charts

Real data objects beat drawings: add_table and add_chart create editable objects that stay editable after saving and export as vectors.

## Workflow
1. Get the data. If the user gave numbers or CSV text, use them exactly (import_csv_to_table for pasted CSV). If not, ask once with ask_user for the metric, the periods or categories and the values; never invent figures without saying they are samples.
2. Start a page (new_document, studio layout, 1240 x 1754 px portrait or 1754 x 1240 landscape) or use the open one. Check get_document_info for its size.
3. Add a title and a one-line takeaway with add_text (the takeaway states the finding, such as "Revenue grew 18 percent, driven by Online").
4. Optional KPI row: add_chart with type kpi (one series; the last value is the number, earlier values give the change and the sparkline), 3 cards of equal size in one row.
5. Add the table: add_table with data (header row first), headerRows 1, headerCols 1 if the first column holds labels, a style (striped or clean), numberFormats per column letter (currency, percent), and formulas for totals such as =SUM(B2:B5). Put a Total row at the bottom and format it bold with edit_table.
6. Add the chart linked to the table: add_chart with tableId (it then updates when the table changes). Choose the type by the question: comparison of categories = column or bar (bar when labels are long), trend over time = line or area, share of a whole = pie or donut (at most 5 slices), correlation = scatter, progress toward a goal = progress or ring. Give it a title that states what is shown and an alt text.
7. Align and size everything on a grid with margins of at least 60 px: table and chart share the left edge; chart width equals the content width or half of it. Use align_layers.
8. Verify with screenshot, then read_table to confirm the formula results and fix anything wrong with edit_table.

## Rules
- One message per chart. At most 5 series or 8 colors; sort bars by value when order does not matter (options sort desc).
- Label units in axis titles or number formats. Start bar and column axes at zero.
- Use one palette per page. The colorblind palette is safe for everyone.
- Keep table text at 12 px or larger (print) and right-align numbers (automatic for numeric columns).
- Large tables: split them across pages in the app with Table > Flow Table Across Pages (header rows repeat).

## Verify
screenshot the page, check that no text is cut off, that totals match read_table and that the chart title matches the table content.`;


/** Built-in skills as SKILL.md markdown strings (logo-design, social-post, photo-retouch, landing-page, poster-layout, brand-kit, accessibility-audit, copywriting). */
export const BUILTIN_SKILLS = [LOGO, SOCIAL, PHOTO, LANDING, POSTER, BRAND, A11Y, COPY, HELP, REPORT];
