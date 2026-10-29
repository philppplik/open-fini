// Capability checks for extension calls. Pure: maps every RPC method to the permission it needs and decides
// whether a granted set allows a call. Also classifies Vibe tools for the `document` API.
import { normalizeOrigin } from "./manifest.js";

/** Does an origin pattern from a `network:` permission match this origin? */
export function originMatches(pattern, origin) {
  const p = normalizeOrigin(pattern);
  const o = normalizeOrigin(origin);
  if (!p || !o) return false;
  if (p === o) return true;
  const pm = /^(https?):\/\/\*\.([^:/]+)(:\d+)?$/.exec(p);
  const om = /^(https?):\/\/([^:/]+)(:\d+)?$/.exec(o);
  return !!pm && !!om && pm[1] === om[1] && (pm[3] || "") === (om[3] || "") && om[2].endsWith(`.${pm[2]}`);
}

/** Origin of an absolute http(s) URL string, or null. */
export function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Is the permission granted? `network:<origin>` is checked with {@link originMatches}. */
export function hasPermission(granted, perm) {
  const set = granted instanceof Set ? granted : new Set(granted || []);
  if (!perm.startsWith("network:")) return set.has(perm);
  for (const g of set) if (g.startsWith("network:") && originMatches(g.slice(8), perm.slice(8))) return true;
  return false;
}

/** RPC method → permission needed ("" = none). Methods missing here do not exist. */
export const METHOD_PERMISSIONS = {
  "ext.hello": "",
  log: "",
  "commands.register": "",
  "commands.execute": "",
  "ui.showMessage": "ui",
  "ui.confirm": "ui",
  "ui.prompt": "ui",
  "ui.form": "ui",
  "ui.openPanel": "ui",
  "ui.setStatus": "ui",
  "document.info": "document.read",
  "document.pageInfo": "document.read",
  "document.readSelection": "document.read",
  "document.readLayers": "document.read",
  "document.listTools": "document.read",
  "document.callTool": "", // decided per tool: read-only tools need document.read, all others document.write
  "studio.current": "",
  "studio.list": "",
  "studio.set": "ui",
  "storage.get": "storage",
  "storage.set": "storage",
  "storage.delete": "storage",
  "storage.keys": "storage",
  "storage.clear": "storage",
  "settings.get": "",
  "settings.getAll": "",
  "network.fetch": "", // decided per URL origin
  "files.open": "files",
  "files.save": "files",
  "document.export": "export",
  "events.subscribe": "", // decided per event
  "vibe.registerTool": "vibe",
  "vibe.registerSkill": "vibe",
  "messages.post": "",
  "theme.get": "",
};

export const EVENT_PERMISSIONS = { documentChanged: "document.read", selectionChanged: "document.read", studioChanged: "" };

/**
 * Decides whether a call is allowed.
 * @returns {{ok: true} | {ok: false, code: string, needed?: string, message: string}}
 */
export function checkPermission(granted, method, params = {}, { toolKind } = {}) {
  if (!(method in METHOD_PERMISSIONS)) return { ok: false, code: "UNKNOWN_METHOD", message: `Unknown method “${method}”.` };
  let need = METHOD_PERMISSIONS[method];
  if (method === "document.callTool") need = toolKind === "read" ? "document.read" : "document.write";
  else if (method === "network.fetch") {
    const o = originOf(params?.url);
    if (!o) return { ok: false, code: "BAD_REQUEST", message: "network.fetch needs an absolute http(s) URL." };
    need = `network:${o}`;
  } else if (method === "events.subscribe") {
    if (!(params?.event in EVENT_PERMISSIONS)) return { ok: false, code: "BAD_REQUEST", message: `Unknown event “${params?.event}”.` };
    need = EVENT_PERMISSIONS[params.event];
  }
  if (!need || hasPermission(granted, need)) return { ok: true };
  return { ok: false, code: "PERMISSION_DENIED", needed: need, message: `This extension is not allowed to call ${method}: it needs the “${need}” permission${need.startsWith("network:") ? " (declare it in the manifest and approve it)" : ""}.` };
}

/** Tools an extension may never call through `document.callTool` (assistant internals, network and extension management). */
const DENIED_TOOLS = new Set(["generate_image", "edit_image", "create_tool", "remember", "use_skill", "search_knowledge", "ask_user", "update_plan", "list_extensions", "run_extension_command", "install_extension_from_url", "create_extension", "web_search", "fetch_page", "download_image"]);

/** "read" | "write" | "denied" for a Vibe tool definition. */
export function classifyTool(tool) {
  if (!tool || DENIED_TOOLS.has(tool.name) || /^(ext_|mcp_)/.test(tool.name)) return "denied";
  return tool.readOnly ? "read" : "write";
}

/** Vibe tool name for an extension tool: ext_<publisher>_<name>_<tool>, at most 64 characters. */
export function vibeToolName(extId, tool) {
  const slug = extId.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const name = `ext_${slug}_${tool}`;
  if (name.length <= 64) return name;
  let h = 5381;
  for (const ch of extId) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return `ext_${slug.slice(0, 64 - 4 - 9 - tool.length - 1)}${h.toString(36).slice(0, 6)}_${tool}`.slice(0, 64);
}

/** Does a shortcut collide with an existing command's shortcut in an overlapping studio scope? */
export function findShortcutConflict(commands, key, studios) {
  const norm = (s) => String(s).toLowerCase();
  for (const c of commands) {
    for (const sc of [c.shortcut, c.altShortcut]) {
      if (!sc || norm(sc) !== norm(key)) continue;
      if (!c.studios || !studios || c.studios.some((s) => studios.includes(s))) return c.id;
    }
  }
  return null;
}
