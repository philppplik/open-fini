// Settings ▸ Artificial intelligence ▸ Tools: OpenFini's built-in tools, your custom tools, and MCP servers.
import { h, empty, uid } from "../../core/util.js";
import { vibeStore } from "../../vibe/store.js";
import { TOOL_GROUPS } from "../../vibe/tools/index.js";
import { confirmDialog } from "../dialogs.js";
import { iconEl } from "../toolbox.js";
import { createMcpSignInRow } from "./account-ui.js";

const EXAMPLE = `// args = the arguments, openfini.call(tool, args) runs any OpenFini tool
const { width = 1080, height = 1080 } = args;
await openfini.call("new_document", { name: "Square post", width, height, studio: "vector" });
const bg = await openfini.call("add_shape", { type: "rect", x: 0, y: 0, w: width, h: height, fill: { type: "linear", angle: 135, stops: [{ color: "#7c6df2" }, { color: "#38bdf8" }] } });
return { background: bg.id };`;

export function createToolsPanel(vs) {
  const { app, session } = vs;
  const el = h("div.of-vtools");

  async function render() {
    empty(el);
    const s = vibeStore.settings;
    const all = await session.toolList().catch(() => []);
    const names = new Set(all.map((t) => t.name));
    // ---- built-in tools
    const builtin = h("div.of-vcard", h("div.of-vcard__head", h("strong", `OpenFini tools (${[...names].filter((n) => Object.values(TOOL_GROUPS).flat().includes(n)).length})`)), h("p.of-hint", "Everything the assistant can do inside your studios. Turn off what you do not want it to touch."));
    for (const [group, list] of Object.entries(TOOL_GROUPS)) {
      const det = h("details.of-vgroup", h("summary", group));
      for (const n of list) {
        const t = all.find((x) => x.name === n) || { name: n, description: "" };
        const sw = h("sl-switch", { size: "small", "aria-label": n });
        sw.checked = !s.disabledTools.includes(n);
        sw.addEventListener("sl-change", () => vibeStore.saveSettings({ disabledTools: sw.checked ? s.disabledTools.filter((x) => x !== n) : [...s.disabledTools, n] }));
        det.append(h("div.of-vtool", h("div", h("code", n), h("small", (t.description || "").split(". ")[0].slice(0, 110))), sw));
      }
      builtin.append(det);
    }
    el.append(builtin);

    // ---- tools added by extensions (always ask for approval; the origin is shown)
    const extTools = app.extensions?.vibeToolInfos() || [];
    if (extTools.length) {
      const card = h("div.of-vcard", h("div.of-vcard__head", h("strong", `Extension tools (${extTools.length})`)), h("p.of-hint", "Added by installed extensions. Each one asks for your approval before it runs. Manage extensions under Studio ▸ Extensions."));
      for (const t of extTools) {
        const sw = h("sl-switch", { size: "small", "aria-label": t.name });
        sw.checked = !s.disabledTools.includes(t.name);
        sw.addEventListener("sl-change", () => vibeStore.saveSettings({ disabledTools: sw.checked ? s.disabledTools.filter((x) => x !== t.name) : [...s.disabledTools, t.name] }));
        card.append(h("div.of-vtool", h("div", h("code", t.name), h("small", `From extension “${t.extName}” (${t.ext}) — ${(t.description || "").slice(0, 90)}`)), sw));
      }
      el.append(card);
    }

    // ---- custom tools
    const custom = h("div.of-vcard", h("div.of-vcard__head", h("strong", "Your tools"), h("button.of-btn", { type: "button", onclick: () => editTool(null) }, iconEl("plus-lg"), "New tool")), h("p.of-hint", "Small JavaScript functions that can call OpenFini's tools. They run in a sandbox and ask before each run. Vibe can also write them for you."));
    for (const t of vibeStore.customTools) {
      const sw = h("sl-switch", { size: "small" });
      sw.checked = t.enabled !== false;
      sw.addEventListener("sl-change", () => vibeStore.saveCustomTools(vibeStore.customTools.map((x) => (x.name === t.name ? { ...x, enabled: sw.checked } : x))));
      custom.append(h("div.of-vtool", h("div", h("code", t.name), h("small", t.description)), h("div.of-vrow", h("button.of-btn", { type: "button", onclick: () => editTool(t) }, "Edit"), sw)));
    }
    if (!vibeStore.customTools.length) custom.append(h("div.of-empty", "No custom tools yet."));
    el.append(custom);

    // ---- MCP
    const mcp = h("div.of-vcard", h("div.of-vcard__head", h("strong", "MCP servers"), h("button.of-btn", { type: "button", onclick: () => editMcp(null) }, iconEl("plus-lg"), "Add")), h("p.of-hint", "Connect any Model Context Protocol server that speaks HTTP: its tools appear next to OpenFini's. Programs that run locally (such as REA) connect through the bundled gateway — see below."));
    for (const srv of vibeStore.mcpServers) {
      const sw = h("sl-switch", { size: "small" });
      sw.checked = srv.enabled !== false;
      sw.addEventListener("sl-change", () => vibeStore.saveMcp(vibeStore.mcpServers.map((x) => (x.id === srv.id ? { ...x, enabled: sw.checked } : x))));
      const status = h("small", srv.url);
      mcp.append(h("div.of-vtool", h("div", h("strong", srv.name), status), h("div.of-vrow", h("button.of-btn", { type: "button", onclick: async () => { status.textContent = "Connecting…"; try { const t = await session.mcpStatus(srv); status.textContent = `${t.length} tools: ${t.slice(0, 4).map((x) => x.name).join(", ")}${t.length > 4 ? "…" : ""}`; } catch (e) { status.textContent = e.status === 401 ? "This server asks for a sign-in: use Sign in." : e.message; const nt = await import("../node-tools.js"); if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(srv.url || "") && nt.looksUnreachable(e)) status.append(" ", h("button.of-btn", { type: "button", onclick: () => nt.nodeToolDialog(app, "mcp-gateway") }, "How to start the gateway")); } } }, "Test"), h("button.of-btn", { type: "button", onclick: () => editMcp(srv) }, "Edit"), createMcpSignInRow(vs, srv, status, render), sw)));
    }
    if (!vibeStore.mcpServers.length) mcp.append(h("div.of-empty", "No MCP servers connected."));
    mcp.append(h("details.of-vgroup", h("summary", "Connect a local program (stdio) — for example REA"), h("div.of-vhow", h("p", "Browsers cannot start programs. The gateway in this repository starts any stdio MCP server and exposes it on 127.0.0.1:"), h("pre", "npm run mcp:gateway -- --port 3939 -- node _vendor/rea/scripts/rea.mjs"), h("p", "Then add the server here with the URL ", h("code", "http://127.0.0.1:3939/mcp"), ". The gateway only listens on your own machine and only allows this app's origin."))));
    el.append(mcp);
  }

  function editTool(t) {
    const name = h("input.of-vfield__in", { value: t?.name || "", placeholder: "snake_case_name", spellcheck: false });
    const desc = h("input.of-vfield__in", { value: t?.description || "", placeholder: "What it does and when to use it" });
    const schema = h("textarea.of-vfield__in.mono", { rows: 4, spellcheck: false }, JSON.stringify(t?.inputSchema || { type: "object", properties: { width: { type: "number" }, height: { type: "number" } } }, null, 2));
    const code = h("textarea.of-vfield__in.mono", { rows: 12, spellcheck: false }, t?.code || EXAMPLE);
    const err = h("div.of-vstatus.bad");
    for (const i of [name, desc, schema, code]) i.addEventListener("keydown", (e) => e.stopPropagation());
    const save = async () => {
      try {
        if (!/^[a-z][a-z0-9_]{2,40}$/.test(name.value)) throw new Error("The name must be snake_case (3–41 letters, digits, underscores).");
        const inputSchema = JSON.parse(schema.value);
        const rec = { name: name.value, description: desc.value, inputSchema, code: code.value, enabled: t?.enabled !== false };
        await vibeStore.saveCustomTools([...vibeStore.customTools.filter((x) => x.name !== (t?.name || rec.name) && x.name !== rec.name), rec]);
        render();
      } catch (e) {
        err.textContent = e.message;
      }
    };
    el.replaceChildren(h("div.of-vform", h("strong", t ? "Edit tool" : "New tool"), h("label.of-vfield", h("span", "Name"), name), h("label.of-vfield", h("span", "Description"), desc), h("label.of-vfield", h("span", "Arguments (JSON Schema)"), schema), h("label.of-vfield", h("span", "Code (async function body)"), code), err, h("div.of-vrow", h("button.of-btn.of-btn--primary", { type: "button", onclick: save }, "Save"), h("button.of-btn", { type: "button", onclick: render }, "Cancel"), t ? h("button.of-btn", { type: "button", onclick: async () => { if (await confirmDialog({ title: "Delete tool", message: `Delete “${t.name}”?`, ok: "Delete", danger: true })) { await vibeStore.saveCustomTools(vibeStore.customTools.filter((x) => x.name !== t.name)); render(); } } }, "Delete") : null)));
  }

  function editMcp(srv) {
    const name = h("input.of-vfield__in", { value: srv?.name || "", placeholder: "e.g. REA" });
    const url = h("input.of-vfield__in", { value: srv?.url || "", placeholder: "https://…/mcp or http://127.0.0.1:3939/mcp", spellcheck: false });
    const auth = h("input.of-vfield__in", { type: "password", value: (srv?.headers?.Authorization || "").replace(/^Bearer /, ""), placeholder: "Optional bearer token", autocomplete: "off" });
    for (const i of [name, url, auth]) i.addEventListener("keydown", (e) => e.stopPropagation());
    const status = h("div.of-vstatus");
    const rec = () => ({ id: srv?.id || uid("mcp"), name: name.value.trim() || "MCP server", url: url.value.trim(), headers: auth.value ? { Authorization: `Bearer ${auth.value.trim()}` } : {}, enabled: srv?.enabled !== false });
    el.replaceChildren(h("div.of-vform", h("strong", srv ? "Edit MCP server" : "Add MCP server"), h("label.of-vfield", h("span", "Name"), name), h("label.of-vfield", h("span", "URL (Streamable HTTP)"), url), h("label.of-vfield", h("span", "Token"), auth), status, h("div.of-vrow", h("button.of-btn.of-btn--primary", { type: "button", onclick: async () => {
      const r = rec();
      if (!/^https?:\/\//.test(r.url)) return (status.textContent = "Enter a full URL starting with http:// or https://");
      status.textContent = "Connecting…";
      try {
        const tools = await session.mcpStatus(r);
        await vibeStore.saveMcp([...vibeStore.mcpServers.filter((x) => x.id !== r.id), r]);
        app.toast(`Connected to ${r.name}: ${tools.length} tools.`, "success", 2400);
        render();
      } catch (e) {
        status.textContent = `${e.message} (saved anyway so you can fix the URL later)`;
        await vibeStore.saveMcp([...vibeStore.mcpServers.filter((x) => x.id !== r.id), r]);
      }
    } }, "Save and test"), h("button.of-btn", { type: "button", onclick: render }, "Cancel"), srv ? h("button.of-btn", { type: "button", onclick: async () => { await vibeStore.saveMcp(vibeStore.mcpServers.filter((x) => x.id !== srv.id)); render(); } }, "Remove") : null)));
  }

  vibeStore.on("change", (g) => ["settings", "tools", "mcp"].includes(g) && el.isConnected && !el.querySelector(".of-vform") && render());
  render();
  return { el, show: render };
}
