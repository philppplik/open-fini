// The complete OpenFini tool set the Vibe assistant can call.
import { designTools } from "./design.js";
import { pixelTools } from "./pixel.js";
import { pixelAnalysisTools } from "./pixel-analysis.js";
import { webTools } from "./web.js";
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

/**
 * @param {import("../../core/app.js").App} app
 * @param {object} ctx session context: { images, knowledge, memory, skills, ask, plan, customTools }
 */
export function createOpenFiniTools(app, ctx = {}) {
  return [...designTools(app, ctx), ...pixelTools(app, ctx), ...pixelAnalysisTools(app, ctx), ...webTools(app, ctx), ...gitTools(app, ctx), ...publishTools(app, ctx), ...metaTools(app, ctx), ...appearanceTools(app, ctx), ...systemTools(app, ctx), ...extensionTools(app, ctx), ...diagnosticsTools(app, ctx), ...importTools(app, ctx), ...layoutDataTools(app, ctx), ...frameworkTools(app, ctx)];
}

/** Tools grouped for the UI. */
export const TOOL_GROUPS = {
  Documents: ["get_document_info", "new_document", "set_studio", "undo", "redo", "add_page"],
  "Layers and vector": ["list_layers", "get_selection", "select_layers", "screenshot", "add_shape", "add_text", "add_path", "import_svg", "set_style", "transform_layers", "group_layers", "delete_layers", "duplicate_layers", "reorder_layers", "align_layers", "boolean_layers"],
  Pixel: ["list_effects", "add_pixel_layer", "apply_adjustment", "select_area", "generate_image", "edit_image", "get_histogram", "auto_correct_suggestion"],
  "Code and websites": ["create_website", "list_files", "read_file", "write_file", "edit_file", "delete_file", "rename_file", "get_page_outline", "select_element", "inspect_element", "list_elements", "insert_element", "insert_html", "set_element_style", "set_element_attributes", "set_page_meta", "show_page", "check_problems"],
  "Frameworks, libraries and documents": ["list_templates", "list_libraries", "search_packages", "add_library", "render_markdown", "convert_latex_preview", "create_markdown_document"],
  "Git and publishing": ["git_init", "git_status", "git_diff", "git_log", "git_commit", "git_branch", "git_checkout", "git_restore", "git_push", "git_pull", "list_publish_targets", "add_publish_target", "preflight_site", "publish_site"],
  "Tables and charts": ["add_table", "edit_table", "read_table", "list_tables", "import_csv_to_table", "add_chart", "edit_chart", "read_chart"],
  "Imported documents": ["get_import_report", "list_pdf_pages", "describe_document_pages", "extract_pdf_text"],
  "System and files": ["get_platform_info", "list_recent_files"],
  Extensions: ["list_extensions", "run_extension_command", "install_extension_from_url", "create_extension"],
  "Appearance and help": ["list_themes", "set_theme", "start_tour", "list_commands"],
  "Diagnostics and security": ["get_app_logs", "get_diagnostics", "get_security_status"],
  Assistant: ["search_knowledge", "remember", "use_skill", "ask_user", "update_plan", "create_tool"],
};
