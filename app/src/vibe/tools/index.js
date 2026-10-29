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
import { officeTools } from "./office.js";
import { officeSuiteTools } from "./office-suite.js";
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

/**
 * @param {import("../../core/app.js").App} app
 * @param {object} ctx session context: { images, knowledge, memory, skills, ask, plan, customTools }
 */
export function createOpenFiniTools(app, ctx = {}) {
  return [...designTools(app, ctx), ...pixelTools(app, ctx), ...pixelAnalysisTools(app, ctx), ...webTools(app, ctx), ...webViewTools(app, ctx), ...gitTools(app, ctx), ...publishTools(app, ctx), ...metaTools(app, ctx), ...appearanceTools(app, ctx), ...systemTools(app, ctx), ...extensionTools(app, ctx), ...diagnosticsTools(app, ctx), ...importTools(app, ctx), ...layoutDataTools(app, ctx), ...frameworkTools(app, ctx), ...textcodecTools(app, ctx), ...customizationTools(app, ctx), ...officeTools(app, ctx), ...officeSuiteTools(app, ctx), ...formatTools(app, ctx), ...powerTools(app, ctx), ...agentTools(app, ctx), ...attachmentTools(app, ctx), ...saveTargetTools(app, ctx), ...collabTools(app, ctx), ...commentTools(app, ctx), ...vscodeTools(app, ctx), ...routingTools(app, ctx), ...webAccessTools(app, ctx)];
}

/** Tools grouped for the UI. */
export const TOOL_GROUPS = {
  Documents: ["get_document_info", "get_save_target", "new_document", "set_studio", "undo", "redo", "add_page"],
  "Layers and vector": ["list_layers", "get_selection", "select_layers", "screenshot", "add_shape", "add_text", "add_path", "import_svg", "set_style", "transform_layers", "group_layers", "delete_layers", "duplicate_layers", "reorder_layers", "align_layers", "boolean_layers"],
  Pixel: ["list_effects", "add_pixel_layer", "crop_image", "resize_image", "rotate_image", "trim_edges", "apply_adjustment", "select_area", "generate_image", "edit_image", "get_histogram", "auto_correct_suggestion"],
  "Code and websites": ["create_website", "list_files", "read_file", "write_file", "edit_file", "format_file", "delete_file", "rename_file", "get_page_outline", "select_element", "inspect_element", "list_elements", "insert_element", "insert_html", "set_element_style", "set_element_attributes", "set_page_meta", "show_page", "check_problems", "set_viewport", "get_viewport", "measure_element", "set_code_layout"],
  "Frameworks, libraries and documents": ["list_templates", "list_libraries", "search_packages", "add_library", "render_markdown", "convert_latex_preview", "create_markdown_document"],
  "Git and publishing": ["git_init", "git_status", "git_diff", "git_log", "git_commit", "git_branch", "git_checkout", "git_restore", "git_push", "git_pull", "list_publish_targets", "add_publish_target", "preflight_site", "publish_site"],
  "Tables and charts": ["add_table", "edit_table", "read_table", "list_tables", "import_csv_to_table", "add_chart", "edit_chart", "read_chart"],
  "Office documents": ["office_new_document", "office_read_document", "office_find", "office_insert_blocks", "office_replace_text", "office_set_style", "office_apply_format", "office_insert_table", "office_set_page_setup", "office_export"],
  "Office suite": ["office_formats", "office_list_documents", "office_describe", "office_new"],
  "Imported documents": ["get_import_report", "list_pdf_pages", "describe_document_pages", "extract_pdf_text"],
  "System and files": ["get_platform_info", "list_recent_files"],
  Extensions: ["list_extensions", "run_extension_command", "install_extension_from_url", "create_extension"],
  "VS Code extensions": ["search_vscode_extensions", "install_vscode_extension", "list_vscode_extensions", "describe_vscode_extension"],
  Web: ["web_search", "fetch_page", "download_image"],
  "Model routing": ["get_model_route", "set_model_route"],
  "Appearance and help": ["list_themes", "set_theme", "start_tour", "list_commands"],
  "File formats": ["list_supported_formats", "import_palette_from_text", "export_palette"],
  Customization: ["get_settings", "set_setting", "list_shortcuts", "set_shortcut", "export_profile"],
  "Diagnostics and security": ["get_app_logs", "get_diagnostics", "get_security_status"],
  "Text and encoding": ["encode_text", "decode_text", "transform_file_text"],
  Assistant: ["search_knowledge", "remember", "use_skill", "create_skill", "ask_user", "update_plan", "create_tool"],
  "Power tools": ["run_plan", "query_layers", "describe_page", "describe_selection", "apply_to_many", "evaluate", "screenshot_layers", "compare_screenshots", "grid_layout", "distribute_layers", "snap_layers", "make_component"],
  Agents: ["spawn_agent", "wait_agent", "list_agents", "cancel_agent"],
  Attachments: ["list_attachments", "open_attachment"],
  Comments: ["list_comments", "get_comment_context", "add_comment", "reply_comment", "resolve_comment"],
  Collaboration: ["get_collab_status", "read_chat", "post_chat_message", "list_versions", "save_version", "share_document", "get_sharing_status", "list_shared_documents"],
};
