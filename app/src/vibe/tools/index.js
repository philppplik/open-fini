// The complete OpenFini tool set the Vibe assistant can call.
import { designTools } from "./design.js";
import { pixelTools } from "./pixel.js";
import { webTools } from "./web.js";
import { metaTools } from "./meta.js";

/**
 * @param {import("../../core/app.js").App} app
 * @param {object} ctx session context: { images, knowledge, memory, skills, ask, plan, customTools }
 */
export function createOpenFiniTools(app, ctx = {}) {
  return [...designTools(app, ctx), ...pixelTools(app, ctx), ...webTools(app, ctx), ...metaTools(app, ctx)];
}

/** Tools grouped for the UI. */
export const TOOL_GROUPS = {
  Documents: ["get_document_info", "new_document", "set_studio", "undo", "redo", "add_page"],
  "Layers and vector": ["list_layers", "get_selection", "select_layers", "screenshot", "add_shape", "add_text", "add_path", "import_svg", "set_style", "transform_layers", "group_layers", "delete_layers", "duplicate_layers", "reorder_layers", "align_layers", "boolean_layers"],
  Pixel: ["list_effects", "add_pixel_layer", "apply_adjustment", "select_area", "generate_image", "edit_image"],
  "Code and websites": ["create_website", "list_files", "read_file", "write_file", "edit_file", "delete_file", "rename_file", "get_page_outline", "select_element", "inspect_element", "list_elements", "insert_element", "insert_html", "set_element_style", "set_element_attributes", "set_page_meta", "show_page", "check_problems"],
  Assistant: ["search_knowledge", "remember", "use_skill", "ask_user", "update_plan", "create_tool"],
};
