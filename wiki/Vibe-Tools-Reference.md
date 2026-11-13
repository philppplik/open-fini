# Vibe Tools Reference

The Vibe assistant acts through tools: named functions with schemas that call into OpenFini's documents and settings. This page lists the tool groups, what is read-only, which tools ask for approval, and where the authoritative list lives. The exact current list is always *Settings ▸ Artificial intelligence ▸ Tools* in the app.

## How tools behave

- Tools are listed in *Settings ▸ Artificial intelligence ▸ Tools*; you can switch off any single tool or set it to *Always allow* ([[Vibe Providers and Permissions]]).
- Pure reads are marked read-only and run in parallel without the document write lock. Writes are serialized per document and recorded for **Undo this run**.
- Tools that reach outside (network, publishing, pushing, installing, messaging other people) return an approval request naming the effect.
- The assistant never receives secrets: tokens, invite codes and keys are not exposed by any tool.

## Groups

| Group | Examples | Notes |
| --- | --- | --- |
| Documents | new document, document info, `get_save_target`, studio switch, undo and redo, pages | Inside Vibe Studio the assistant does not switch studios behind your back |
| Layers and vector | list layers, selection, screenshots, shapes, text, paths, SVG import, styles, transforms, grouping, ordering, alignment, boolean operations, duplicate, delete | |
| Pixel | effect catalog, pixel layers, adjustments, live filters, selections, image generation and editing, `get_histogram`, `auto_correct_suggestion` | Image generation uses the image model you configure |
| Git and publishing | `git_init`, `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_checkout`, `git_restore`, `git_push`, `git_pull`, `list_publish_targets`, `add_publish_target`, `preflight_site`, `publish_site` | Push, pull and publish ask for approval |
| Frameworks, libraries, documents | `list_templates`, `list_libraries`, `search_packages`, `add_library`, `render_markdown`, `convert_latex_preview`, `create_markdown_document` | `search_packages` and `add_library` use the network and ask |
| Code and websites | create website, read, write, edit, rename and delete files, page outline, element inspection and insertion, class-based style edits per breakpoint, page meta, problem check, `set_viewport`, `get_viewport`, `measure_element`, `set_code_layout`, `preview_query`, `preview_state`, `preview_interact` | The preview tools read the rendered page (elements, computed styles, overflow, broken images, console) and try it out (click, type, submit …) inside the sandboxed preview; page content is untrusted data |
| System and files | `get_platform_info`, `list_recent_files` | Read-only |
| Customization | `get_settings`, `set_setting`, `list_shortcuts`, `set_shortcut`, `export_profile` | `set_shortcut` asks; security settings and secrets are unreachable |
| Appearance and help | `list_themes`, `set_theme`, `start_tour`, `list_commands` | No tool runs arbitrary commands |
| Diagnostics and security | `get_app_logs`, `get_diagnostics`, `get_security_status`, `run_doctor` | Read-only and redacted; used when you ask about errors or setup |
| File formats | `list_supported_formats`, `import_palette_from_text`, `export_palette` | |
| Export | `list_export_options`, `export_document` | Same options and presets as File ▸ Export…; the user approves and picks the file |
| Imported documents | `get_import_report`, `list_pdf_pages`, `describe_document_pages`, `extract_pdf_text` | |
| Tables and charts | `add_table`, `edit_table`, `read_table`, `list_tables`, `import_csv_to_table`, `add_chart`, `edit_chart`, `read_chart` | |
| Spreadsheets | `sheet_describe`, `sheet_read_range`, `sheet_write_range`, `sheet_set_formula`, `sheet_format`, `sheet_add_sheet`, `sheet_add_chart`, `sheet_add_rule`, `sheet_format_table`, `sheet_define_name`, `sheet_set_validation`, `sheet_paste_special`, `sheet_group`, `sheet_page_setup`, `sheet_pivot`, `sheet_refresh_pivots`, `sheet_add_sparkline`, `sheet_chart_data` | Each edit is one undo step; `sheet_chart_data` only reads |
| Office suite | `office_formats`, `office_list_documents`, `office_describe`, `office_screenshot`, `office_new` | Any Office kind (document, sheet, slides, board); `office_screenshot` renders one page, sheet, slide or board page as an image |
| Office documents | `office_new_document`, `office_read_document`, `office_find`, `office_insert_blocks`, `office_replace_text`, `office_set_style`, `office_apply_format`, `office_insert_table`, `office_set_page_setup`, `office_export`, `office_list_sections`, `office_read_section`, `office_rewrite_section`, `office_move_section`, `office_check_accessibility`, `office_tables_to_sheet`, `office_sheet_to_document`, `office_document_to_slides` | Export asks first and opens a save dialog |
| Extensions | list, run a command, install from a URL, `create_extension`; tools from extensions appear as `ext_<id>_<tool>` | Extension tools always ask |
| Text and encoding | `encode_text`, `decode_text`, `transform_file_text` | More than one file needs approval |
| Assistant | knowledge search, remember, `use_skill`, `create_skill`, ask you a question, update the plan, create a tool | |
| Power tools | `run_plan`, `query_layers`, `describe_page`, `describe_selection`, `apply_to_many`, `evaluate`, `screenshot_layers`, `compare_screenshots`, `grid_layout`, `distribute_layers`, `snap_layers`, `make_component` | Fewer round trips; `run_plan` gives one approval and one undo step |
| Scripting and checks | `run_script`, `find_tools`, `call_tool`, `read_result`, `checkpoint`, `restore_checkpoint`, `visual_diff`, `measure_layers`, `find_replace` | Code mode: a script in an isolated worker calls tools in loops, one undo step, `dryRun` returns the diff and reverts. Tools that ask on every call are refused inside a script. Restoring a checkpoint asks. `call_tool` runs a tool that the compact tool list (Settings ▸ Artificial intelligence ▸ Models ▸ Engine) does not show, with that tool's own approval; `read_result` pages through a result that was cut |
| Design checks and assets | `lint_design`, `fix_design_issues`, `generate_asset`, `make_palette`, `extract_palette`, `type_scale`, `column_grid`, `list_merge_fields`, `data_merge` | A design linter with ready fixes; patterns, blobs, QR codes and Code 128 barcodes as editable paths; palettes by color theory; variable data from records or CSV. No image model needed |
| Agents | `spawn_agent`, `wait_agent`, `list_agents`, `cancel_agent` | See [[Vibe Studio]] |
| Web | `web_search`, `fetch_page`, `download_image` | Off by default (Settings ▸ Artificial intelligence ▸ Web access); ask per domain in every mode; local and private addresses blocked; results are untrusted data. See [[Vibe Studio]] |
| Attachments | `list_attachments`, `open_attachment` | Attachments live in memory for the session |
| Comments | `list_comments`, `get_comment_context`, `add_comment`, `reply_comment`, `resolve_comment` | Work without a room; every comment comes with its exact place. Add/reply ask only in a room |
| Color | `set_color_mode`, `convert_colors`, `preflight_pdf` | Loading an ICC profile stays a user action; the preflight is not a certified PDF/X validation ([[Color Management]]) |
| Scene | `scene_describe`, `scene_catalog`, `scene_new`, `scene_set_format`, `scene_track`, `scene_import_media`, `scene_place_media`, `scene_add_layer`, `scene_move_clips`, `scene_trim_clip`, `scene_split`, `scene_delete_clips`, `scene_set_speed`, `scene_update_clips`, `scene_transition`, `scene_keyframes`, `scene_set_easing`, `scene_precompose`, `scene_effect`, `scene_audio`, `scene_markers`, `scene_cut_ranges`, `scene_captions`, `scene_captions_export`, `scene_render_frame`, `scene_show`, `scene_export` | Video editing in the Scene Studio; one undo step per call; `scene_render_frame` returns a frame or a contact sheet to look at; importing from a URL asks per domain, export always asks ([[Scene Studio]]) |
| Scene understanding | `scene_transcribe`, `scene_set_transcript`, `scene_transcript`, `scene_detect_shots`, `scene_analyze_audio`, `scene_sample_frames`, `scene_index_note`, `scene_search` | Transcription uses a batch speech engine from the engine registry (asks before an online one); shots and sound are analysed in a background worker |
| Scene motion | `scene_parent`, `scene_behavior`, `scene_stagger`, `scene_keyframe_edit`, `scene_clip_time`, `scene_link`, `scene_effect_order`, `scene_animate_with_sound`, `scene_beat_markers` | Parenting and null objects, behaviors, sequence layers, keyframe edits, reverse / freeze / remap, links, effect order, sound-driven keyframes, beat markers |
| Scene automation | `scene_cut_transcript`, `scene_remove_silences`, `scene_remove_fillers`, `scene_auto_captions`, `scene_highlight_reel`, `scene_reframe`, `scene_animate_clip`, `scene_title`, `scene_lower_third`, `scene_slideshow`, `scene_beat_cuts` | Edits from the analysis and motion presets, as ordinary editable clips and keyframes |
| Collaboration | `get_collab_status`, `read_chat`, `list_versions`, `save_version`, `post_chat_message`, `share_document` | Messages ask |

There are well over 100 tools (counts quoted in older documents differ because the set grows with every release); the app's Tools list is the truth.

## Code mode example

`run_script` with a dry run first, then for real:

```json
{
  "code": "const { ids } = await openfini.query_layers({ selector: 'text[name^=\"Price\"]' });\nlet n = 0;\nfor (const id of ids) { await openfini.set_style({ ids: [id], text: (args.base + n * args.step).toFixed(2) + ' €' }); n++; }\nreturn n;",
  "args": { "base": 9.9, "step": 5 },
  "dryRun": true
}
```

The result lists the tool calls per tool and, for a dry run, the layers that would be added, removed or changed.
`find_tools` with `{ "query": "align distribute" }` returns the matching signatures.

## Power tool examples

```json
{ "tool": "run_plan", "steps": [
  { "id": "a", "tool": "add_shape", "args": { "type": "rect", "x": 40, "y": 40, "w": 300, "h": 120 } },
  { "id": "b", "tool": "set_style", "args": { "id": { "$ref": "a.id" }, "fill": "#4f46e5" } }
] }
```

```text
query_layers: rect[name^="Card"][w>100]
```

`run_plan` stops on error, shows one approval listing every step and records one undo step. Selectors in `query_layers` support type, name globs, fill, text, within, intersects and parent, with paging.

## Writing your own tools

Describe a function to the assistant (it uses `create_tool`) or write one in *Tools ▸ New tool*. Custom tools are small JavaScript functions in a sandboxed frame with no network or DOM access to the app; they call OpenFini only through `openfini.call(name, args)`, which passes through the same approvals, and they ask before each run. Extensions can register tools too ([[Extension SDK Reference]]). Developers add built-in tools as described in [[Extending OpenFini]].

## See also

- [[Vibe Studio]]
- [[Vibe Providers and Permissions]]
- [[Skills Authoring]]
- [[Extending OpenFini]]
