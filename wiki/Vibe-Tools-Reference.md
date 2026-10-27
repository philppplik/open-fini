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
| Code and websites | create website, read, write, edit, rename and delete files, page outline, element inspection and insertion, class-based style edits per breakpoint, page meta, problem check, `set_viewport`, `get_viewport`, `measure_element`, `set_code_layout` | |
| System and files | `get_platform_info`, `list_recent_files` | Read-only |
| Customization | `get_settings`, `set_setting`, `list_shortcuts`, `set_shortcut`, `export_profile` | `set_shortcut` asks; security settings and secrets are unreachable |
| Appearance and help | `list_themes`, `set_theme`, `start_tour`, `list_commands` | No tool runs arbitrary commands |
| Diagnostics and security | `get_app_logs`, `get_diagnostics`, `get_security_status` | Read-only and redacted; used when you ask about errors or setup |
| File formats | `list_supported_formats`, `import_palette_from_text`, `export_palette` | |
| Imported documents | `get_import_report`, `list_pdf_pages`, `describe_document_pages`, `extract_pdf_text` | |
| Tables and charts | `add_table`, `edit_table`, `read_table`, `list_tables`, `import_csv_to_table`, `add_chart`, `edit_chart`, `read_chart` | |
| Office documents | `office_new_document`, `office_read_document`, `office_find`, `office_insert_blocks`, `office_replace_text`, `office_set_style`, `office_apply_format`, `office_insert_table`, `office_set_page_setup`, `office_export` | Export asks first and opens a save dialog |
| Extensions | list, run a command, install from a URL, `create_extension`; tools from extensions appear as `ext_<id>_<tool>` | Extension tools always ask |
| Text and encoding | `encode_text`, `decode_text`, `transform_file_text` | More than one file needs approval |
| Assistant | knowledge search, remember, `use_skill`, `create_skill`, ask you a question, update the plan, create a tool | |
| Power tools | `run_plan`, `query_layers`, `describe_page`, `describe_selection`, `apply_to_many`, `evaluate`, `screenshot_layers`, `compare_screenshots`, `grid_layout`, `distribute_layers`, `snap_layers`, `make_component` | Fewer round trips; `run_plan` gives one approval and one undo step |
| Agents | `spawn_agent`, `wait_agent`, `list_agents`, `cancel_agent` | See [[Vibe Studio]] |
| Attachments | `list_attachments`, `open_attachment` | Attachments live in memory for the session |
| Collaboration | `get_collab_status`, `read_chat`, `list_comments`, `list_versions`, `resolve_comment`, `save_version`, `post_chat_message`, `add_comment`, `reply_comment` | Messages and comments ask |

There are well over 100 tools (counts quoted in older documents differ because the set grows with every release); the app's Tools list is the truth.

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
