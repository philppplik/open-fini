// Human wording for what the assistant is doing right now ("AI is adding shapes…"), used by the AI progress pill.
// Pure: no DOM.

const EXACT = {
  thinking: "thinking",
  writing: "writing a reply",
  screenshot: "checking the result",
  screenshot_layers: "checking the result",
  compare_screenshots: "comparing before and after",
  run_plan: "running a plan",
  spawn_agent: "starting helper agents",
  wait_agent: "waiting for helper agents",
  list_agents: "checking on helper agents",
  query_layers: "looking at the layers",
  list_layers: "looking at the layers",
  describe_page: "looking at the page",
  describe_selection: "looking at the selection",
  get_document_info: "looking at the document",
  get_selection: "looking at the selection",
  apply_to_many: "changing many layers",
  set_style: "styling layers",
  transform_layers: "moving layers",
  align_layers: "aligning layers",
  grid_layout: "arranging a grid",
  distribute_layers: "spacing layers",
  generate_image: "generating an image",
  edit_image: "editing an image",
  apply_adjustment: "adjusting the image",
  new_document: "creating a document",
  create_website: "creating a website",
  write_file: "writing files",
  edit_file: "editing files",
  read_file: "reading files",
  search_knowledge: "searching your knowledge base",
  use_skill: "loading a skill",
  evaluate: "calculating",
  open_attachment: "opening an attachment",
  ask_user: "waiting for your answer",
  update_plan: "planning",
  route_fallback: "switching to a fallback model",
};

const VERB = { add: "adding", insert: "inserting", set: "setting", delete: "deleting", duplicate: "duplicating", group: "grouping", import: "importing", list: "looking at", get: "reading", read: "reading", edit: "editing", git: "working with Git", publish: "publishing" };

/**
 * @param {string} name tool name, or "thinking" / "writing"
 * @returns {string} e.g. "adding shapes"
 */
export function activityLabel(name) {
  if (!name) return "working";
  if (EXACT[name]) return EXACT[name];
  if (/^mcp_/.test(name)) return "using a connected tool";
  if (/^ext_/.test(name)) return "using an extension";
  const [verb, ...rest] = String(name).split("_");
  const v = VERB[verb];
  if (!v) return "working";
  if (verb === "git" || verb === "publish") return v;
  let obj = rest.join(" ");
  if (verb === "add" && obj && !/s$/.test(obj) && obj !== "text") obj += "s";
  return obj ? `${v} ${obj}` : v;
}

/** Pill text for a set of running tasks. */
export function pillText(tasks) {
  if (!tasks.length) return "";
  if (tasks.length > 1) return `${tasks.length} AI tasks running`;
  const t = tasks[0];
  if (t.waiting) return "AI needs your approval";
  return `AI is ${activityLabel(t.activity)}…`;
}
