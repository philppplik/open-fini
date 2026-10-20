// Settings ▸ Security and privacy: the security check, offline mode, app lock, protected mode, privacy tools
// (clear data, "what is stored" inventory) and the integrity check. Returns a section for settings-dialog.js.
import { h, formatBytes } from "../core/util.js";
import { button } from "./controls.js";
import { openDialog, confirmDialog } from "./dialogs.js";
import { securityOverview, collectInventory } from "../core/env.js";
import { securityCounts } from "../core/security.js";
import { inventoryText } from "../core/diagnostics.js";
import { parseManifest, verifyFiles, integritySummary } from "../core/integrity.js";
import { kvDelete, kvEntries, kvClear, getRecents, clearSession } from "../core/storage.js";
import { log } from "../core/log.js";
import { platform } from "../platform/index.js";

const sw = (key, label, hint, extra = {}) => ({ type: "switch", key, label, hint, ...extra });
const custom = (label, hint, render) => ({ type: "custom", label, hint, render });
const action = (label, hint, btn, run, danger = false) => ({ type: "action", label, hint, button: btn, run, danger });

// ------------------------------------------------------------------ clearing data

const PRIVACY = {
  async recents(app) {
    for (const r of await getRecents()) await kvDelete(`recent:${r.id}`);
    for (const { key } of await kvEntries()) if (key.startsWith("recent:")) await kvDelete(key);
    await kvDelete("recents");
    app.emit("recents", []);
    return "Recent files cleared.";
  },
  async autosave() {
    await clearSession();
    return "Autosaved session deleted.";
  },
  async logs() {
    log.clear();
    const { clearStoredErrors } = await import("../core/log-capture.js");
    await clearStoredErrors();
    return "Logs cleared.";
  },
  async ai() {
    const { vibeStore } = await import("../vibe/store.js");
    await vibeStore.load();
    await vibeStore.clearAll();
    return "AI data deleted.";
  },
  async extensions(app) {
    // only the data extensions saved (ext:data:*): installed extensions and their granted permissions stay
    let n = 0;
    for (const { key } of await kvEntries()) if (key.startsWith("ext:data:")) (await kvDelete(key), n++);
    try {
      for (const ext of app.extensions?.list?.() || []) ext.data = null; // forget the host's in-memory copy
    } catch {
      /* no extension host */
    }
    return n ? "Extension data cleared." : "No extension data was found.";
  },
  async fonts(app) {
    await kvDelete("fonts");
    app.fonts.clear();
    return "Added fonts removed. Reload to unload them from this session.";
  },
};

/** Runs one of the privacy tools by name ("recents", "autosave", "logs", "ai", "extensions", "fonts") and returns a message. */
export async function clearPrivacy(app, what) {
  if (!PRIVACY[what]) throw new Error(`Unknown data kind “${what}”.`);
  const msg = await PRIVACY[what](app);
  log.info("security", `Privacy tool: ${what}`);
  return msg;
}

/** Deletes local data and reloads. `settings`, `store` (session, recents, fonts, lock), `ai`, `cache` (offline copy of the app). */
export async function resetLocalData(app, { settings = false, store = false, ai = false, cache = false } = {}) {
  log.warn("security", `Reset requested: ${Object.entries({ settings, store, ai, cache }).filter(([, v]) => v).map(([k]) => k).join(", ") || "nothing"}`);
  try {
    if (store) {
      for (const { key } of await kvEntries()) if (/^(session|recents|fonts|applock|diag.errors)$/.test(key) || key.startsWith("recent:")) await kvDelete(key);
      localStorage.removeItem("openfini.lock");
    }
    if (ai) for (const { key } of await kvEntries()) if (key.startsWith("vibe.")) await kvDelete(key);
    if (settings) {
      for (const k of Object.keys(localStorage)) if (k.startsWith("openfini")) localStorage.removeItem(k);
    } else if (store) {
      // the lock record is gone, so the saved settings must not claim it is on
      const saved = JSON.parse(localStorage.getItem("openfini.prefs.v1") || "{}");
      localStorage.setItem("openfini.prefs.v1", JSON.stringify({ ...saved, appLock: false }));
    }
    if (cache) {
      for (const n of await caches.keys()) await caches.delete(n);
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    }
  } catch (err) {
    log.error("security", "Reset failed", err);
    app.toast(`Part of the reset failed: ${err.message}`, "danger", 6000);
  }
  location.assign(`${location.pathname}?fresh=1`);
}

/** Everything OpenFini keeps on this device, after typing DELETE. */
export function deleteAllDialog(app) {
  const input = h("sl-input", { label: "Type DELETE to confirm", size: "small", autocomplete: "off" });
  openDialog({
    title: "Delete all local data",
    width: 520,
    cls: "of-dlg-520",
    body: h("div.of-diag__form", h("p", "This deletes everything OpenFini stores on this device: settings, the autosaved session, recent files, added fonts, the app lock, AI connections, keys and chats, extension data, logs and the offline copy of the app. Documents you saved as files are not touched. This cannot be undone."), input),
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Delete everything and reload",
        variant: "danger",
        onClick: async (close) => {
          if (input.value.trim() !== "DELETE") {
            input.helpText = "Type DELETE (in capital letters) to enable this.";
            return input.focus();
          }
          close();
          await PRIVACY.extensions(app).catch(() => {});
          await kvClear();
          await resetLocalData(app, { settings: true, store: true, ai: true, cache: true });
        },
      },
    ],
  });
}

/** Saves the "what OpenFini stores on this device" inventory (keys, descriptions, sizes; no values). */
export async function exportInventory(app) {
  const inv = await collectInventory();
  const res = await platform.saveFile({ suggestedName: "openfini-stored-data.json", bytes: new TextEncoder().encode(JSON.stringify(inv, null, 2)), mime: "application/json", filters: [{ name: "JSON", extensions: ["json"] }] });
  if (res) app.toast(`Saved ${res.name}`, "success", 2000);
  return inv;
}

async function showInventory(app) {
  const inv = await collectInventory();
  openDialog({
    title: "What OpenFini stores on this device",
    width: 760,
    cls: "of-dlg-760",
    body: h("div.of-diag__form", h("p.of-hint", "Keys, descriptions and approximate sizes only. Values, document contents and file names are never listed."), h("pre.of-diag__preview", { tabindex: 0 }, inventoryText(inv))),
    buttons: [{ label: "Save as JSON…", onClick: () => exportInventory(app) }, { label: "Close", variant: "primary", onClick: (c) => c() }],
  });
}

// ------------------------------------------------------------------ security check panel

const LEVEL = { ok: ["OK", "check-circle-fill"], info: ["Note", "info-circle-fill"], warn: ["Attention", "exclamation-triangle-fill"] };

export async function setKeyPassphrase(app) {
  const { vibeStore } = await import("../vibe/store.js");
  await vibeStore.load();
  if (vibeStore.locked) return app.toast("Unlock your API keys first (Vibe Studio ▸ Models).", "warning", 4000);
  const { passphraseDialog } = await import("./app-lock.js");
  const pass = await passphraseDialog({ title: "Protect API keys", lead: "Stored API keys are encrypted with this passphrase and you will be asked for it once per session. If you forget it, the keys must be entered again.", ok: "Protect", confirm: true });
  if (!pass) return;
  await vibeStore.setVault(pass);
  app.toast("API keys are now encrypted with your passphrase.", "success", 3000);
}

function checkPanel(app, rerenderSection) {
  const host = h("div.of-sec");
  const draw = async () => {
    host.replaceChildren(h("p.of-hint", "Checking…"));
    let o;
    try {
      o = await securityOverview(app);
    } catch (err) {
      return host.replaceChildren(h("p.of-hint", `The check could not run: ${err.message}`));
    }
    const c = securityCounts(o.checks);
    const fix = {
      "set-passphrase": ["Set a passphrase…", () => setKeyPassphrase(app).then(draw)],
      "enable-lock": ["Turn on app lock…", () => import("./app-lock.js").then((m) => m.enableLock(app)).then(() => rerenderSection())],
      offline: ["Turn on offline mode", () => (app.setPref("offlineMode", true), rerenderSection())],
    };
    const rows = o.checks.map((x) => {
      const [label, icon] = LEVEL[x.level];
      const f = x.action && fix[x.action];
      return h(`div.of-sec__row.lv-${x.level}`, h("sl-icon", { name: icon, "aria-hidden": "true" }), h("div", h("div", h("span.of-sec__lv", label), " ", h("strong", x.label)), h("div.of-hint", x.detail), f ? button(f[0], f[1]) : null));
    });
    const exts = o.status.extensions;
    host.replaceChildren(
      h("p.of-sec__sum", { role: "status" }, c.warn ? `${c.warn} item${c.warn === 1 ? "" : "s"} need attention, ${c.ok} fine.` : `Nothing needs attention (${c.ok} checks fine).`),
      ...rows,
      exts.length ? h("details.of-sec__ext", h("summary", "Extension permissions"), h("ul", exts.map((e) => h("li", h("strong", e.name), ` ${e.version} — ${e.enabled ? "enabled" : "disabled"}: ${e.permissions.length ? e.permissions.join(", ") : "no special permissions"}`)))) : null,
      h("div.of-sec__acts", button("Run the check again", draw)),
    );
  };
  draw();
  return host;
}

// ------------------------------------------------------------------ app lock controls and integrity

function lockControls(app, rerender) {
  const host = h("div.of-sec");
  (async () => {
    const lock = await import("./app-lock.js");
    const on = await lock.hasLock();
    const minutes = h("select", { "aria-label": "Lock after idle time" }, [[0, "Never"], [1, "1 minute"], [5, "5 minutes"], [10, "10 minutes"], [30, "30 minutes"], [60, "1 hour"]].map(([v, t]) => h("option", { value: v, selected: Number(app.prefs.appLockIdleMinutes) === v }, t)));
    minutes.addEventListener("change", () => app.setPref("appLockIdleMinutes", Number(minutes.value)));
    const hide = h("sl-switch", { size: "small", "aria-label": "Lock when the window is hidden" });
    hide.checked = !!app.prefs.appLockOnHide;
    hide.addEventListener("sl-change", () => app.setPref("appLockOnHide", hide.checked));
    const wrap = (label, hint, ctl) => h("div.of-set__row", h("div", h("div.of-set__label", label), h("div.of-set__hint", hint)), h("div.of-set__ctl", ctl));
    host.replaceChildren(
      wrap("App lock", on ? "On. The autosaved session, recent files, stored AI keys and chats are encrypted with your passphrase (AES-GCM, PBKDF2-SHA256). A forgotten passphrase cannot be recovered." : "Off. Ask for a passphrase on start and encrypt the autosaved session, recent files and stored AI keys and chats on this device.", on ? [button("Lock now", () => lock.lockNow(app)), button("Change passphrase…", async () => ((await lock.changePassphrase(app)), rerender())), button("Turn off…", async () => ((await lock.disableLock(app)), rerender()), { cls: "of-btn--danger" })] : button("Turn on…", async () => ((await lock.enableLock(app)), rerender()), { variant: "primary" })),
      on ? wrap("Lock after inactivity", "Locks when you have not used the mouse or keyboard for this long.", minutes) : null,
      on ? wrap("Lock when the window is hidden", "Locks when you switch to another tab or minimize the window.", hide) : null,
      h("p.of-hint", "Honest limits: the lock protects data stored on this device, for example from another person using this computer or a copied profile. It does not protect against malware, a compromised operating system or someone watching you type, and your open documents stay in memory while the app is locked. Documents saved as files are not encrypted."),
    );
  })();
  return host;
}

function integrityControls() {
  const out = h("p.of-hint", { role: "status" });
  const bar = h("progress.of-sec__bar.hidden", { max: 1, value: 0, "aria-label": "Integrity check progress" });
  const full = h("sl-checkbox", { size: "small" }, "Include bundled libraries (slower)");
  let ctl = null;
  const run = button("Check app files", async () => {
    if (ctl) {
      ctl.aborted = true;
      return;
    }
    out.textContent = "Reading the build manifest…";
    try {
      const res = await fetch("./sw.js", { cache: "no-store" });
      const manifest = res.ok ? parseManifest(await res.text()) : null;
      if (!manifest) {
        out.textContent = "Not available: this is a development build, or the build manifest is missing. Release builds embed a list of file hashes that this check compares against.";
        return;
      }
      ctl = { aborted: false };
      run.textContent = "Cancel";
      bar.classList.remove("hidden");
      const r = await verifyFiles({
        manifest,
        filter: (p) => full.checked || !p.startsWith("vendor/"),
        fetchBytes: async (p) => {
          const r2 = await fetch(new URL(p, location.href), { cache: "no-store" });
          if (!r2.ok) throw new Error(String(r2.status));
          return new Uint8Array(await r2.arrayBuffer());
        },
        signal: ctl,
        onProgress: (d, t) => ((bar.max = t), (bar.value = d), (out.textContent = `Checking… ${d} of ${t}`)),
      });
      out.textContent = `${integritySummary(r)}${r.mismatched.length ? ` Differing: ${r.mismatched.slice(0, 5).join(", ")}${r.mismatched.length > 5 ? "…" : ""}` : ""}`;
      log[r.mismatched.length ? "warn" : "info"]("security", `Integrity check: ${integritySummary(r)}`);
    } catch (err) {
      out.textContent = `The check could not run: ${err.message}`;
    } finally {
      ctl = null;
      run.textContent = "Check app files";
      bar.classList.add("hidden");
    }
  });
  return h("div.of-sec", h("div.of-sec__acts", run, full), bar, out, h("p.of-hint", "Compares the files this page is served with against the hashes recorded when the app was built. It finds damaged downloads, stale caches and half-applied updates. It cannot detect a server that was changed to serve different hashes as well: for that, compare the installer with SHA256SUMS.txt from the release page."));
}

// ------------------------------------------------------------------ the section

/** The "Security and privacy" settings section. */
export function securitySection(app) {
  return {
    id: "security",
    label: "Security and privacy",
    icon: "shield-lock",
    lead: "What leaves the app, and what stays on this device.",
    keywords: "privacy security external links clear data storage recent fonts reset telemetry lock passphrase offline network protected mode integrity encrypt keys extensions inventory delete",
    groups: [
      { title: "Security check", items: [custom("Security check", "status of AI features API keys extensions network CSP sandbox storage encryption", (a, rerender) => checkPanel(a, rerender))] },
      {
        title: "Network",
        items: [
          sw("offlineMode", "Offline mode", "Blocks every outbound feature at once: AI providers and MCP servers, publishing, extension network access, remote content in website previews, update checks and sign-in. Local models on this device keep working."),
          { type: "info", label: "Telemetry", text: "OpenFini collects no analytics or crash reports and has no accounts. Logs stay on this device." },
        ],
      },
      { title: "App lock", items: [custom("App lock passphrase encrypt idle", "passphrase lock screen idle minutes hidden encrypt session recent files", (a, rerender) => lockControls(a, rerender))] },
      {
        title: "Opening files and links",
        items: [
          sw("protectedMode", "Protected mode for files from outside", "Website projects you open from a file or folder start with scripts in the preview turned off until you click “Enable scripts” in the preview. Projects you create in OpenFini are trusted."),
          sw("confirmExternal", "Ask before opening links in your browser", "Applies to links in the website preview, Vibe chats, help and About."),
        ],
      },
      {
        title: "Privacy tools",
        items: [
          action("Recent files", "Forgets the recent-files list and the stored copies behind it.", "Clear", async () => app.toast(await clearPrivacy(app, "recents"), "success", 1800)),
          action("Autosaved session", "Deletes the recovery copy of your open documents.", "Delete", async () => app.toast(await clearPrivacy(app, "autosave"), "success", 1800)),
          action("Logs", "Clears the troubleshooting log and the errors kept from earlier sessions.", "Clear", async () => app.toast(await clearPrivacy(app, "logs"), "success", 1800)),
          action("Added fonts", "Removes font files you added through the Type panel.", "Remove", async () => app.toast(await clearPrivacy(app, "fonts"), "success", 2600)),
          action("AI data", "Deletes chats, connections and keys, skills, custom tools, MCP servers, memory and the knowledge index.", "Delete…", async () => { if (await confirmDialog({ title: "Delete AI data", message: "Delete all Vibe chats, API keys, skills, tools, MCP servers, memory and knowledge from this device?", ok: "Delete", danger: true })) app.toast(await clearPrivacy(app, "ai"), "success", 1800); }, true),
          action("Extension data", "Deletes the data extensions stored on this device. The extensions themselves stay installed.", "Delete…", async () => { if (await confirmDialog({ title: "Delete extension data", message: "Delete the data stored by extensions on this device?", ok: "Delete", danger: true })) app.toast(await clearPrivacy(app, "extensions"), "success", 2200); }, true),
          { type: "storage" },
          action("What OpenFini stores", "Lists every kind of data kept on this device with its size. Values and file names are never shown.", "Show…", () => showInventory(app)),
          action("Delete all local data", "Removes everything OpenFini stores here, including settings, the lock and the offline copy. Your saved files are not touched.", "Delete…", () => deleteAllDialog(app), true),
        ],
      },
      { title: "Integrity", items: [custom("Integrity self-check", "verify app files hashes manifest", () => integrityControls())] },
      {
        title: "Reset",
        items: [action("Reset all settings", "Restores every setting in this dialog to its default. Your documents are not touched.", "Reset…", async () => { if (await confirmDialog({ title: "Reset settings", message: "Restore all settings to their defaults?", ok: "Reset", danger: true })) { app.resetPrefs(); app.toast("Settings reset.", "success", 1800); } }, true)],
      },
    ],
  };
}

export { formatBytes };

/** The "Troubleshooting" settings section (log, problems, report, safe mode). */
export function troubleshootingSection(app) {
  return {
    id: "troubleshooting",
    label: "Troubleshooting",
    icon: "bug",
    lead: "Find out what went wrong, and report it without leaking your work.",
    keywords: "troubleshooting log errors problems diagnostics report issue bug safe mode reset crash support debug",
    groups: [
      {
        title: "Diagnose",
        items: [
          action("Troubleshooting", "Live log, grouped problems with explanations, and your environment (version, browser, storage, service worker).", "Open…", () => app.run("help.troubleshoot"), false),
          sw("verboseLogging", "Verbose logging", "Also record debug-level messages in the log. Useful when you are asked to reproduce a problem."),
          { type: "info", label: "Privacy of logs", text: "Logs stay on this device. API keys, tokens, credentials in URLs, e-mail addresses and your user name in file paths are removed when an entry is recorded, and logs never contain document contents." },
        ],
      },
      {
        title: "Report",
        items: [
          action("Copy diagnostic report", "Environment, problems and recent log as text, with secrets removed.", "Copy", () => app.run("help.copyReport")),
          action("Save diagnostic bundle", "A ZIP with the report, environment, redacted logs and a list of stored data. Never documents, keys or chats.", "Save…", () => app.run("help.saveBundle")),
          action("Report an issue", "Opens a prefilled GitHub bug report after showing you exactly what it contains.", "Report…", () => app.run("help.issues")),
        ],
      },
      {
        title: "Recover",
        items: [
          action("Restart in safe mode", "Starts without restoring your session, with extensions and AI off, and without applying saved settings. Nothing is deleted.", "Restart…", () => app.run("help.safeMode")),
          action("Reset app data", "Clears settings, the autosaved session, recent files or the offline cache when nothing else helps.", "Reset…", () => app.run("help.resetData"), true),
        ],
      },
    ],
  };
}
