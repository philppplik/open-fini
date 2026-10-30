// Friendly guidance for the optional helper programs that need Node.js (publish helper, MCP gateway). Shown instead
// of a raw "could not be sent" error when such a helper does not answer: what it is, how to install Node.js, the
// exact command (copyable) and where to run it, and the built-in alternative when there is one. Lazy.
import { h } from "../core/util.js";
import { t, N_ } from "../i18n/index.js";
import { openDialog } from "./dialogs.js";

export const NODE_TOOLS = {
  "publish-helper": {
    title: N_("Start the publish helper"),
    what: N_("The publish helper is a small program on your computer that uploads to SFTP, rsync and other servers a browser cannot reach."),
    cmd: "npm run publish:helper",
    alt: N_("No installation needed in the OpenFini desktop app: use the target “FTP / FTPS server” instead."),
  },
  "mcp-gateway": {
    title: N_("Start the MCP gateway"),
    what: N_("The MCP gateway is a small program on your computer that starts a local MCP server and lets OpenFini talk to it."),
    cmd: "npm run mcp:gateway -- --port 3939 -- <command of the MCP server>",
    alt: "",
  },
};

/** Does this error look like "nothing listens there" (helper not started)? */
export function looksUnreachable(err) {
  const s = `${err?.code || ""} ${err?.message || err || ""}`;
  return /NETWORK|Failed to fetch|NetworkError|Load failed|ECONNREFUSED|could not be sent|refused/i.test(s);
}

/** The steps for a helper (plain data, also used by tests). */
export function nodeToolSteps(id) {
  const tool = NODE_TOOLS[id];
  if (!tool) return [];
  return [
    t("Install Node.js (the LTS version) from nodejs.org. This is needed once."),
    t("Open a terminal in the OpenFini project folder (the folder that contains package.json). Running the command in another folder fails with “ENOENT … package.json”."),
    t("Run: {cmd}", { cmd: tool.cmd }),
    t("Keep the terminal open while you use it, then try again here."),
  ];
}

/** Opens the guidance dialog. */
export function nodeToolDialog(app, id) {
  const tool = NODE_TOOLS[id];
  if (!tool) return null;
  const copy = h("button.of-btn", { type: "button" }, t("Copy command"));
  copy.addEventListener("click", () => navigator.clipboard?.writeText(tool.cmd).then(() => app?.toast?.("Copied.", "success", 1400)).catch(() => {}));
  const site = h("button.of-btn", { type: "button" }, t("Open nodejs.org"));
  site.addEventListener("click", () => import("./links.js").then((m) => m.openLink("https://nodejs.org/", { app })));
  const body = h(
    "div.of-form",
    h("p", t(tool.what)),
    h("ol", ...nodeToolSteps(id).map((s) => h("li", s))),
    h("pre", tool.cmd),
    h("div.of-row", copy, site),
    tool.alt ? h("p.of-hint", t(tool.alt)) : null,
  );
  return openDialog({ title: tool.title, body, width: 520, buttons: [{ label: N_("Close"), variant: "primary", onClick: (c) => c() }] });
}
