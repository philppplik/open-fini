// The "Security check": turns a plain status object (collected by ui/security-center.js) into a list of checks with a
// level and a plain-language explanation. Pure and testable. Also used by the get_security_status Vibe tool.
//
// status = {
//   ai:        { enabled, providers: [{ id, label, local, hasKey }], mcpServers: [{ name, local, enabled }], keysEncrypted, keysLocked, activeProvider },
//   extensions:[{ id, name, version, enabled, permissions: string[] }],
//   network:   { offline, desktop, updateChecks },
//   csp:       { desktop, header },            // header: string|null (null = none detected, undefined = could not check)
//   storage:   { appLock, persisted },
//   protectedMode, safeMode, confirmExternal, previewScripts,
// }

/** Permissions that let an extension read or change documents, use the network or reach other data. */
const SENSITIVE_PERMISSION = /^(net|network|fetch|origin|https?:|document\.write|files|vibe)/i;

/**
 * @param {object} status see above
 * @returns {{id:string, area:string, label:string, level:"ok"|"info"|"warn", detail:string, action?:string}[]}
 */
export function evaluateSecurity(status = {}) {
  const out = [];
  const add = (id, area, label, level, detail, action) => out.push({ id, area, label, level, detail, ...(action ? { action } : {}) });
  const ai = status.ai || {};
  const exts = status.extensions || [];
  const net = status.network || {};
  const providers = (ai.providers || []).filter((p) => p);
  const remote = providers.filter((p) => !p.local);
  const keyed = providers.filter((p) => p.hasKey);

  // AI
  if (!ai.enabled) add("ai", "AI", "AI features are off", "ok", "Nothing is sent to an AI provider. Vibe Studio only offers the offline demo assistant.");
  else if (!providers.length) add("ai", "AI", "AI features are on, no provider connected", "info", "Nothing is sent until you connect a provider in Settings ▸ Artificial intelligence ▸ Models.");
  else add("ai", "AI", "AI features are on", remote.length ? "warn" : "info", remote.length ? `Your messages and what the assistant reads through tools (layer names, screenshots, project files) are sent to: ${remote.map((p) => p.label).join(", ")}.` : `Connected providers run on this device: ${providers.map((p) => p.label).join(", ")}.`);
  if (ai.keysLocked) add("keys", "AI", "API keys are locked", "ok", "Stored keys are encrypted with a passphrase and not unlocked in this session.");
  else if (keyed.length && ai.keysEncrypted) add("keys", "AI", "API keys are encrypted", "ok", `${keyed.length} stored key${keyed.length === 1 ? " is" : "s are"} sealed with a passphrase (AES-GCM).`);
  else if (keyed.length && status.storage?.appLock) add("keys", "AI", "API keys are encrypted by the app lock", "ok", `${keyed.length} stored key${keyed.length === 1 ? " is" : "s are"} encrypted at rest with your app-lock passphrase.`);
  else if (keyed.length) add("keys", "AI", "API keys are stored unencrypted", "warn", `${keyed.length} key${keyed.length === 1 ? " is" : "s are"} saved in this browser or app profile without a passphrase. Anyone with access to this profile on this device could read them.`, "set-passphrase");
  else add("keys", "AI", "No API keys stored", "ok", "There is nothing to protect here.");
  const mcp = (ai.mcpServers || []).filter((s) => s.enabled !== false);
  if (mcp.length) add("mcp", "AI", `${mcp.length} MCP server${mcp.length === 1 ? "" : "s"} connected`, mcp.some((s) => !s.local) ? "warn" : "info", `Tool calls and their results go to: ${mcp.map((s) => s.name).join(", ")}. Their answers are treated as untrusted data.`);

  // extensions
  if (!exts.length) add("extensions", "Extensions", "No extensions installed", "ok", "Nothing third-party runs inside OpenFini.");
  else {
    const on = exts.filter((e) => e.enabled !== false);
    const risky = on.filter((e) => (e.permissions || []).some((p) => SENSITIVE_PERMISSION.test(String(p))));
    add("extensions", "Extensions", `${on.length} of ${exts.length} extension${exts.length === 1 ? "" : "s"} enabled`, risky.length ? "warn" : "info", risky.length ? `With sensitive permissions (network, files, document changes): ${risky.map((e) => e.name || e.id).join(", ")}. Review them in Settings ▸ Extensions.` : "None of the enabled extensions asked for network, file or document-changing permissions.");
  }

  // network
  if (net.offline) add("offline", "Network", "Offline mode is on", "ok", "AI, publishing, extension network access, remote content in website previews, update checks and sign-in are blocked. Local models on this device still work.");
  else {
    const features = [];
    if (ai.enabled && remote.length) features.push("AI providers");
    if (mcp.some((s) => !s.local)) features.push("MCP servers");
    if (exts.some((e) => e.enabled !== false && (e.permissions || []).some((p) => /^(net|network|fetch|origin|https?:)/i.test(String(p))))) features.push("extensions");
    if (net.updateChecks) features.push("update checks (the offline copy of the app checks for a new version)");
    features.push("publishing and website previews when you use them");
    add("network", "Network", "Network-capable features in use", "info", `${features.join(", ")}. Turn on offline mode to block all of them at once.`, "offline");
  }

  // CSP and sandbox
  const csp = status.csp || {};
  if (csp.desktop) add("csp", "Isolation", "Content-Security-Policy active", "ok", "The desktop app enforces a restrictive policy: no remote application code, no plugins, no form submissions.");
  else if (csp.header) add("csp", "Isolation", "Content-Security-Policy active", "ok", "The server that delivered this page sends a Content-Security-Policy header.");
  else add("csp", "Isolation", csp.header === undefined ? "Content-Security-Policy could not be checked" : "No Content-Security-Policy header detected", "info", "In the browser the hosting server decides the policy. OpenFini itself loads no remote code; the desktop app enforces a policy of its own.");
  add("sandbox", "Isolation", "Website previews and custom tools are sandboxed", "ok", "Previews run in a frame without access to OpenFini, its storage or your documents. Custom tools run in a frame without network access.");
  if (status.previewScripts === false) add("scripts", "Isolation", "Scripts in website previews are off", "ok", "Pages are shown without running their JavaScript.");

  // storage
  if (status.storage?.appLock) add("lock", "Storage", "App lock is on", "ok", "The autosaved session, recent files and AI keys are encrypted at rest. This protects stored data on this device, not a compromised operating system.");
  else add("lock", "Storage", "Stored data is not encrypted", "info", "The autosaved session and recent files are saved in plain form in this browser or app profile. Turn on the app lock to encrypt them with a passphrase.", "enable-lock");
  if (status.protectedMode === false) add("protected", "Files", "Protected mode is off", "info", "Website projects you open run their scripts in the sandboxed preview immediately.");
  else if (status.protectedMode) add("protected", "Files", "Protected mode is on", "ok", "Website projects from files and folders open with scripts disabled until you enable them.");
  if (status.confirmExternal === false) add("links", "Files", "Links open without asking", "info", "Links clicked in previews, chats and help open in your browser immediately.");
  if (status.safeMode) add("safe", "App", "Safe mode", "info", "Session restore, extensions and AI are off and saved settings are not applied in this session.");
  return out;
}

/** Counts of checks per level, e.g. `{ ok: 6, info: 2, warn: 1 }`. */
export function securityCounts(checks) {
  const c = { ok: 0, info: 0, warn: 0 };
  for (const x of checks) c[x.level] = (c[x.level] || 0) + 1;
  return c;
}

// ------------------------------------------------------------------ protected mode

/**
 * Scripts of a website preview are off when the user turned them off, or when protected mode is on and the project came
 * from outside (a file or folder opened by the user) and the user has not clicked "Enable scripts" for it yet.
 * @param {{previewScripts?: boolean, protectedMode?: boolean}} prefs
 * @param {{untrusted?: boolean, scriptsOk?: boolean}|null} [doc]
 */
export function scriptsBlocked(prefs, doc) {
  if (prefs.previewScripts === false) return true;
  return !!(prefs.protectedMode && doc && doc.untrusted && !doc.scriptsOk);
}

/** True when scripts are blocked only because of protected mode (the preview then offers "Enable scripts"). */
export function blockedByProtection(prefs, doc) {
  return prefs.previewScripts !== false && scriptsBlocked(prefs, doc);
}

/** Flags a website project that came from a file or folder; other documents are left alone. */
export function markUntrusted(prefs, doc) {
  if (prefs.protectedMode && doc?.web) doc.untrusted = true;
  return doc;
}
