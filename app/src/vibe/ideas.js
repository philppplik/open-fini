// Start suggestions of the Vibe empty state: a curated pool grouped by studio/capability. A handful is shown at a time,
// the studio you came from first; "More ideas" rotates through the rest. Every prompt only asks for things the
// registered Vibe tools can do (tests/vibe/ideas.test.js checks the tool names in `tools` against the registry).
//
// Public API
//   IDEAS                       frozen pool: { id, group, title, prompt, tools: [tool names] }
//   GROUPS                      group ids in display order
//   pickIdeas(studio, round, n) n ideas (default 4): round 0 prefers `studio`, later rounds walk the pool; stable, no repeats
import { N_ } from "../i18n/index.js";

export const GROUPS = Object.freeze(["vector", "pixel", "layout", "code", "office", "scene", "automation"]);

const I = (id, group, title, prompt, tools) => ({ id, group, title, prompt, tools });

export const IDEAS = Object.freeze([
  I("logo", "vector", N_("Design a logo"), N_("Design a clean, memorable logo for a coffee roaster called “Ember & Oak” and show me three color variations."), ["add_shape", "add_path", "make_palette"]),
  I("icons", "vector", N_("Draw an icon set"), N_("Draw a set of six consistent line icons (home, search, heart, bell, user, settings) on a 24 px grid and align them in a row."), ["add_path", "align_layers", "distribute_layers"]),
  I("palette", "vector", N_("Build a color palette"), N_("Extract a palette from my selection, add two complementary accents and show them as labeled swatches."), ["extract_palette", "make_palette", "add_shape"]),
  I("lint", "vector", N_("Check my design"), N_("Run the design linter on this document and fix the issues you can fix safely, then tell me what is left."), ["lint_design", "fix_design_issues"]),
  I("retouch", "pixel", N_("Retouch a photo"), N_("Open my photo, brighten the shadows, add warmth and a subtle vignette using adjustment layers."), ["apply_adjustment", "get_histogram"]),
  I("fill", "pixel", N_("Remove something"), N_("Select the distracting object I describe and remove it with content-aware fill so the background looks natural."), ["select_area", "content_aware_fill"]),
  I("horizon", "pixel", N_("Straighten the horizon"), N_("Straighten the horizon in this photo, then crop away the empty edges."), ["straighten_horizon", "trim_edges"]),
  I("cutout", "pixel", N_("Cut out the subject"), N_("Remove the background of this image and put the subject on a soft gradient."), ["remove_background", "select_subject"]),
  I("poster", "layout", N_("Make a poster"), N_("Make a 1080×1350 poster for a jazz night on Friday at 8 pm with a bold headline, a geometric background and event details."), ["new_document", "add_text", "add_shape"]),
  I("cards", "layout", N_("Merge business cards"), N_("Design a business card and merge it with the data of my table so every person gets their own card."), ["list_merge_fields", "data_merge"]),
  I("social", "layout", N_("Social media set"), N_("Create three matching social posts (square) announcing a spring sale, with the same grid, type and colors."), ["add_page", "add_text", "grid_layout"]),
  I("landing", "code", N_("Build a landing page"), N_("Create a landing page for a note-taking app called Fieldnote: hero, three features, pricing and a footer. Calm colors, modern type."), ["create_website", "write_file", "check_problems"]),
  I("a11y", "code", N_("Audit my site"), N_("Check this website for problems and accessibility issues and fix them one by one."), ["check_problems", "edit_file"]),
  I("research", "code", N_("Research, then build"), N_("Search the web for current best practices for a pricing table, summarize them in five bullets and apply them to my page."), ["web_search", "fetch_page", "edit_file"]),
  I("report", "office", N_("Write a report"), N_("Write a two-page project status report with a title, a summary, a table of milestones and a table of contents."), ["office_new_document", "office_insert_blocks", "office_insert_toc"]),
  I("budget", "office", N_("Build a budget sheet"), N_("Create a monthly household budget spreadsheet with categories, formulas for totals and a chart of spending by category."), ["office_new", "sheet_write_range", "sheet_add_chart"]),
  I("deck", "office", N_("Make a slide deck"), N_("Make a six-slide pitch deck for a bike-sharing startup: problem, solution, market, product, team, ask."), ["slides_add_slide", "slides_apply_theme", "slides_set_text"]),
  I("whiteboard", "office", N_("Map it on a whiteboard"), N_("Put the steps of a product launch on a whiteboard with sticky notes, connectors and a timeline."), ["board_add_sticky", "board_add_connector", "board_arrange"]),
  I("cut", "scene", N_("Cut out the silences"), N_("Transcribe my clip, remove the silences and filler words and tell me how much shorter it got."), ["scene_transcribe", "scene_remove_silences", "scene_remove_fillers"]),
  I("captions", "scene", N_("Add captions"), N_("Add automatic captions to my video in a bold style with the keywords highlighted."), ["scene_auto_captions", "scene_captions"]),
  I("motion", "scene", N_("Motion title"), N_("Create a 5-second animated title card “Summer Recap” with a lower third and a fade transition at the end."), ["scene_new", "scene_title", "scene_lower_third", "scene_transition"]),
  I("reel", "scene", N_("Highlight reel"), N_("Find the best moments in my footage and build a 30-second highlight reel cut to the beat."), ["scene_detect_shots", "scene_highlight_reel", "scene_beat_cuts"]),
  I("script", "automation", N_("Automate with a script"), N_("Write and run a script that renames every layer in this document by its type and position, then show me the result."), ["run_script", "list_layers"]),
  I("memory", "automation", N_("Remember my style"), N_("Remember that my brand colors are deep teal and warm sand and that I prefer rounded sans-serif type, then use them from now on."), ["remember", "recall_memory"]),
  I("files", "automation", N_("Work with local files"), N_("List the files in my connected folder, summarize what is in it and write the summary to a notes file."), ["local_list_folders", "local_list_files", "local_write_file"]),
  I("generate", "automation", N_("Generate an image"), N_("Generate an illustration of a lighthouse at dusk in flat style and place it on the page."), ["generate_image", "generate_asset"]),
]);

/**
 * `n` ideas. Round 0 starts with the ideas of `studio` (when a group matches), then rotates through groups so a handful
 * always mixes areas; round r skips the first r*n ideas of that order (wrapping), so rounds cycle through the whole pool.
 */
export function pickIdeas(studio, round = 0, n = 4) {
  const lead = IDEAS.filter((i) => i.group === studio);
  const rest = GROUPS.filter((g) => g !== studio).map((g) => IDEAS.filter((i) => i.group === g));
  const order = [...lead];
  for (let k = 0; rest.some((l) => l[k]); k++) for (const l of rest) if (l[k]) order.push(l[k]);
  const len = order.length;
  const start = (Math.max(0, round | 0) * n) % len;
  return Array.from({ length: Math.min(n, len) }, (_, k) => order[(start + k) % len]);
}
