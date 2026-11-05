// The complete OpenFini tool set the Vibe assistant can call.
import { designTools } from "./design.js";
import { pixelTools } from "./pixel.js";
import { pixelAnalysisTools } from "./pixel-analysis.js";
import { webTools } from "./web.js";
import { webViewTools } from "./web-view.js";
import { gitTools } from "./git.js";
import { publishTools } from "./publish.js";
import { metaTools } from "./meta.js";
import { appearanceTools } from "./appearance.js";
import { systemTools } from "./system.js";
import { extensionTools } from "./extensions.js";
import { diagnosticsTools } from "./diagnostics.js";
import { importTools } from "./import.js";
import { layoutDataTools } from "./layout-data.js";
import { frameworkTools } from "./frameworks.js";
import { latexTools } from "./latex.js";
import { officeTools } from "./office.js";
import { officeSuiteTools } from "./office-suite.js";
import { slidesTools } from "./office-slides.js";
import { officeSheetTools } from "./office-sheet.js";
import { officeSheetDepthTools } from "./office-sheet-depth.js";
import { officeBoardTools } from "./office-board.js";
import { officeSemanticTools } from "./office-semantic.js";
import { textcodecTools } from "./textcodec.js";
import { customizationTools } from "./customization.js";
import { formatTools } from "./formats.js";
import { powerTools } from "./power.js";
import { agentTools } from "./agents.js";
import { attachmentTools } from "./attachments.js";
import { saveTargetTools } from "./save-target.js";
import { collabTools } from "./collab.js";
import { commentTools } from "./comments.js";
import { vscodeTools } from "./vscode.js";
import { routingTools } from "./routing.js";
import { webAccessTools } from "./web-access.js";
import { colorTools } from "./color.js";
import { pixelEditTools } from "./pixel-edit.js";
import { knowledgeTools } from "./knowledge.js";
import { utilityTools } from "./utility.js";
import { terminalTools } from "./terminal.js";

/**
 * @param {import("../../core/app.js").App} app
 * @param {object} ctx session context: { images, knowledge, memory, skills, ask, plan, customTools }
 */
export function createOpenFiniTools(app, ctx = {}) {
  return withVerifyHints([...designTools(app, ctx), ...pixelTools(app, ctx), ...pixelAnalysisTools(app, ctx), ...webTools(app, ctx), ...webViewTools(app, ctx), ...gitTools(app, ctx), ...publishTools(app, ctx), ...metaTools(app, ctx), ...appearanceTools(app, ctx), ...systemTools(app, ctx), ...extensionTools(app, ctx), ...diagnosticsTools(app, ctx), ...importTools(app, ctx), ...layoutDataTools(app, ctx), ...frameworkTools(app, ctx), ...latexTools(app, ctx), ...textcodecTools(app, ctx), ...customizationTools(app, ctx), ...officeTools(app, ctx), ...officeSuiteTools(app, ctx), ...officeSheetTools(app, ctx), ...officeSheetDepthTools(app, ctx), ...slidesTools(app, ctx), ...officeBoardTools(app, ctx), ...officeSemanticTools(app, ctx), ...formatTools(app, ctx), ...powerTools(app, ctx), ...agentTools(app, ctx), ...attachmentTools(app, ctx), ...saveTargetTools(app, ctx), ...collabTools(app, ctx), ...commentTools(app, ctx), ...vscodeTools(app, ctx), ...routingTools(app, ctx), ...webAccessTools(app, ctx), ...colorTools(app, ctx), ...pixelEditTools(app, ctx), ...knowledgeTools(app, ctx), ...utilityTools(app, ctx), ...terminalTools(app, ctx)]);
}

/** Tools grouped for the UI. */
export const TOOL_GROUPS = {
  Documents: ["get_document_info", "get_save_target", "new_document", "set_studio", "undo", "redo", "add_page"],
  "Layers and vector": ["list_layers", "get_selection", "select_layers", "screenshot", "add_shape", "add_text", "add_path", "import_svg", "set_style", "transform_layers", "group_layers", "delete_layers", "duplicate_layers", "reorder_layers", "reorder_pages", "align_layers", "boolean_layers"],
  Pixel: ["list_effects", "add_pixel_layer", "crop_image", "resize_image", "rotate_image", "transform_layer_3d", "trim_edges", "apply_adjustment", "select_area", "generate_image", "edit_image", "get_histogram", "auto_correct_suggestion"],
  "Image editing": ["edit_pixels", "remove_background", "select_subject"],
  "Code and websites": ["create_website", "list_files", "read_file", "write_file", "edit_file", "format_file", "delete_file", "rename_file", "apply_patch", "file_search", "get_page_outline", "select_element", "inspect_element", "list_elements", "insert_element", "insert_html", "set_element_style", "set_element_attributes", "set_page_meta", "show_page", "check_problems", "set_viewport", "get_viewport", "measure_element", "set_code_layout"],
  "Frameworks, libraries and documents": ["list_templates", "list_libraries", "search_packages", "add_library", "render_markdown", "convert_latex_preview", "create_markdown_document"],
  LaTeX: ["latex_outline", "latex_compile", "latex_insert_snippet", "latex_insert_table", "latex_insert_figure", "latex_insert_bibliography", "latex_fix_errors"],
  "Git and publishing": ["git_init", "git_status", "git_diff", "git_log", "git_commit", "git_branch", "git_checkout", "git_restore", "git_push", "git_pull", "list_publish_targets", "add_publish_target", "preflight_site", "publish_site"],
  "Tables and charts": ["add_table", "edit_table", "read_table", "list_tables", "import_csv_to_table", "add_chart", "edit_chart", "read_chart"],
  "Office documents": ["office_new_document", "office_read_document", "office_find", "office_insert_blocks", "office_replace_text", "office_set_style", "office_apply_format", "office_insert_table", "office_set_page_setup", "office_export", "office_list_sections", "office_read_section", "office_rewrite_section", "office_move_section", "office_check_accessibility"],
  "Office suite": ["office_formats", "office_list_documents", "office_describe", "office_new", "office_tables_to_sheet", "office_sheet_to_document", "office_document_to_slides"],
  Presentation: ["slides_describe", "slides_add_slide", "slides_delete", "slides_set_text", "slides_add_shape", "slides_add_image", "slides_apply_layout", "slides_apply_theme", "slides_reorder", "slides_set_notes", "slides_set_transition"],
  Spreadsheets: ["sheet_describe", "sheet_read_range", "sheet_write_range", "sheet_set_formula", "sheet_format", "sheet_add_sheet", "sheet_add_chart", "sheet_add_rule", "sheet_format_table", "sheet_define_name", "sheet_set_validation", "sheet_paste_special", "sheet_group", "sheet_page_setup", "sheet_pivot", "sheet_add_sparkline", "sheet_chart_data"],
  Whiteboard: ["board_describe", "board_add_shape", "board_add_sticky", "board_add_text", "board_add_connector", "board_update", "board_delete", "board_arrange", "board_page", "board_import", "board_export"],
  "Imported documents": ["get_import_report", "list_pdf_pages", "describe_document_pages", "extract_pdf_text"],
  "System and files": ["get_platform_info", "list_recent_files"],
  Extensions: ["list_extensions", "run_extension_command", "install_extension_from_url", "create_extension"],
  "VS Code extensions": ["search_vscode_extensions", "install_vscode_extension", "list_vscode_extensions", "describe_vscode_extension"],
  Web: ["web_search", "fetch_page", "scrape_page", "crawl_site", "http_request", "download_image"],
  "Knowledge base": ["rag_add_source", "rag_search", "rag_list", "rag_remove"],
  Utilities: ["calculate", "convert_units", "date_calc", "run_code", "clipboard_read"],
  Terminal: ["run_command"],
  "Model routing": ["get_model_route", "set_model_route"],
  "Appearance and help": ["list_themes", "set_theme", "start_tour", "list_commands"],
  Color: ["set_color_mode", "convert_colors", "preflight_pdf"],
  "File formats": ["list_supported_formats", "import_palette_from_text", "export_palette"],
  Customization: ["get_settings", "set_setting", "list_shortcuts", "set_shortcut", "export_profile"],
  "Diagnostics and security": ["get_app_logs", "get_diagnostics", "get_security_status"],
  "Text and encoding": ["encode_text", "decode_text", "transform_file_text"],
  Assistant: ["search_knowledge", "remember", "use_skill", "create_skill", "ask_user", "update_plan", "create_tool"],
  "Power tools": ["run_plan", "query_layers", "describe_page", "describe_selection", "apply_to_many", "evaluate", "screenshot_layers", "compare_screenshots", "grid_layout", "distribute_layers", "snap_layers", "make_component"],
  Agents: ["spawn_agent", "wait_agent", "list_agents", "cancel_agent", "plan_work", "work_task", "blackboard"],
  Attachments: ["list_attachments", "open_attachment"],
  Comments: ["list_comments", "get_comment_context", "add_comment", "reply_comment", "resolve_comment"],
  Collaboration: ["get_collab_status", "read_chat", "post_chat_message", "list_versions", "save_version", "share_document", "get_sharing_status", "list_shared_documents"],
};

/** How to check the result of a write tool, per UI group (appended as "Verify with ..." unless the tool says it). */
export const VERIFY_WITH = {
  Documents: "get_document_info",
  "Layers and vector": "describe_page or screenshot",
  Pixel: "screenshot or get_histogram",
  "Image editing": "screenshot",
  "Code and websites": "check_problems and screenshot",
  "Frameworks, libraries and documents": "list_files and check_problems",
  "Git and publishing": "git_status",
  "Tables and charts": "read_table or read_chart",
  "Office documents": "office_read_document",
  "Office suite": "office_describe",
  Presentation: "slides_describe",
  Spreadsheets: "sheet_read_range",
  Whiteboard: "board_describe",
  "Imported documents": "get_import_report",
  "System and files": "get_platform_info",
  Extensions: "list_extensions",
  "VS Code extensions": "list_vscode_extensions",
  Web: "the returned data",
  "Model routing": "get_model_route",
  "Appearance and help": "list_themes",
  Color: "preflight_pdf or screenshot",
  "File formats": "export_palette",
  Customization: "get_settings or list_shortcuts",
  "Diagnostics and security": "get_diagnostics",
  "Text and encoding": "read_file",
  Assistant: "the returned result",
  "Power tools": "describe_page or screenshot_layers",
  Agents: "work_task or list_agents",
  Attachments: "list_attachments",
  Comments: "list_comments",
  Collaboration: "get_collab_status or list_versions",
  LaTeX: "latex_outline and check_problems",
  "Knowledge base": "rag_list or rag_search",
  Utilities: "the returned result",
  Terminal: "the exit code and output",
};

function withVerifyHints(tools) {
  const groupOf = new Map();
  for (const [g, names] of Object.entries(TOOL_GROUPS)) for (const n of names) groupOf.set(n, g);
  for (const t of tools) {
    if (t.readOnly || /\bverif/i.test(t.description)) continue;
    const hint = VERIFY_WITH[groupOf.get(t.name)];
    if (hint) t.description = `${t.description.trimEnd()} Verify with ${hint}.`;
  }
  return tools;
}
