// Settings: one dialog for every studio. A sidebar of sections on the left, the open section on the right.
// The schema below drives the controls; every entry maps to a real preference (core/app.js defaultPrefs).
import { h, empty, formatBytes } from "../core/util.js";
import { openDialog, confirmDialog, shortcutsContent } from "./dialogs.js";
import { segmented, numField, button } from "./controls.js";
import { iconEl } from "./toolbox.js";
import { ACCENTS } from "./appearance.js";
import { themeGallery } from "./theme-gallery.js";
import { platform } from "../platform/index.js";
import { FILE_TYPES, defaultAppsInstructions } from "../platform/file-types.js";
import { kvGet, kvDelete, getRecents, clearSession } from "../core/storage.js";
import { securitySection, troubleshootingSection } from "./security-center.js";
import { openLink } from "./links.js";

const sw = (key, label, hint, extra = {}) => ({ type: "switch", key, label, hint, ...extra });
const seg = (key, label, options, hint, extra = {}) => ({ type: "segmented", key, label, options, hint, ...extra });
const num = (key, label, min, max, step, unit, hint) => ({ type: "number", key, label, min, max, step, unit, hint });

/** Sections of the settings dialog. `keywords` feed the search box. */
export function settingsSections(app) {
  return [
    {
      id: "general",
      label: "General",
      icon: "sliders",
      lead: "How OpenFini starts, saves and closes.",
      keywords: "startup restore session autosave save close confirm language",
      groups: [
        {
          title: "Start-up",
          items: [
            sw("restoreSession", "Restore my last session", "Reopen the documents you had open when you quit, from the copy autosaved on this device."),
            { type: "info", label: "Language", text: "English (United States) — the interface is available in US English only for now." },
          ],
        },
        {
          title: "Saving",
          items: [
            sw("autosave", "Autosave to this device", "Keeps a recovery copy of every open document in this browser or app profile. It never replaces your file."),
            { ...num("autosaveSeconds", "Autosave delay", 2, 120, 1, "s", "How long after your last change the recovery copy is written."), when: () => app.prefs.autosave },
            sw("confirmClose", "Ask before closing unsaved documents", "Turn this off only if you rely on autosave and Save All."),
          ],
        },
        {
          title: "Files",
          items: [
            { type: "action", label: "Save all documents", hint: "Writes every open document with unsaved changes.", button: "Save All", run: () => app.run("file.saveAll") },
            { type: "action", label: "Open a folder", hint: "Opens a whole project folder: a website becomes a Code studio project, design files open as documents.", button: "Open Folder…", run: () => app.run("file.openFolder") },
          ],
        },
        {
          title: "Open with OpenFini",
          items: [
            { type: "info", label: "File types", text: `OpenFini can open ${FILE_TYPES.flatMap((t) => t.ext.map((e) => "." + e)).join(" ")} from your system's Open with menu${platform.isDesktop ? " (offered by the installer; .ofini and .ofext open on double click, other types are never taken over)" : " once it is installed as an app in a Chromium based browser"}.` },
            { type: "info", label: "Make OpenFini the default", text: defaultAppsInstructions(platform.os) },
          ],
        },
      ],
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: "palette",
      lead: "Theme, color and density of the interface in every studio.",
      keywords: "theme dark light color accent density compact scale zoom size",
      groups: [
        {
          title: "Theme",
          items: [
            seg("theme", "Mode", [{ value: "dark", label: "Dark", text: "Dark" }, { value: "light", label: "Light", text: "Light" }, { value: "auto", label: "Match system", text: "System" }], "Every color theme has a dark and a light variant."),
            { type: "accent", label: "Accent color", hint: "Overrides the accent of the theme. The first swatch uses the theme's own accent." },
          ],
        },
        { title: "Color theme", items: [{ type: "themes" }] },
        {
          title: "Layout",
          items: [
            seg("density", "Density", [{ value: "compact", label: "Compact", text: "Compact" }, { value: "default", label: "Default", text: "Default" }, { value: "spacious", label: "Spacious", text: "Spacious" }], "Height of the header, tabs, context bar and status bar."),
            num("uiScale", "Interface scale", 80, 160, 5, "%", "Makes the whole interface larger or smaller. The canvas zoom is separate."),
          ],
        },
      ],
    },
    {
      id: "accessibility",
      label: "Accessibility",
      icon: "universal-access",
      lead: "Make OpenFini easier to see, read and use.",
      keywords: "contrast motion animation focus tooltips hints large text keyboard screen reader",
      groups: [
        {
          title: "Vision",
          items: [
            sw("highContrast", "High contrast", "Stronger borders and text colors in every studio."),
            num("uiScale", "Interface scale", 80, 160, 5, "%", "Larger controls and text. 125% is a good start for high-resolution displays."),
          ],
        },
        {
          title: "Motion and focus",
          items: [
            seg("reduceMotion", "Reduce motion", [{ value: "auto", label: "Follow the system", text: "System" }, { value: "on", label: "Always reduce", text: "On" }, { value: "off", label: "Never reduce", text: "Off" }], "Turns off transitions and animations."),
            sw("focusRings", "Always show focus outlines", "Draws a clear outline around the control you reach with the keyboard."),
            sw("showHints", "Show tooltips", "Names and shortcuts when you hover over a tool or button."),
          ],
        },
        {
          title: "Assistive technology",
          items: [{ type: "info", label: "Screen readers", text: "Menus, dialogs, panels and the code editor are keyboard operable and labeled. The drawing canvas itself is pointer-driven: use the Layers panel, the Navigator in the Code studio and the Settings panel for keyboard-only work. See docs/roadmap.md for the known gaps." }],
        },
      ],
    },
    {
      id: "onboarding",
      label: "Onboarding and help",
      icon: "mortarboard",
      lead: "Tours, hints and the command palette.",
      keywords: "tour welcome hints tips tutorial help whats new command palette reset",
      groups: [
        {
          title: "Tours and hints",
          items: [
            sw("tours", "Offer tours", "Shows a small invitation the first time you start OpenFini and the first time you open each studio."),
            sw("contextHints", "Show hints in empty panels", "Short explanations where a panel has nothing to show yet."),
            { type: "action", label: "Welcome tour", hint: "A one-minute walk through the interface.", button: "Take the tour", run: () => app.run("help.tour") },
            { type: "action", label: "Studio tour", hint: "A short tour of the studio you are in.", button: "Tour this studio", run: () => app.run("help.studioTour") },
            { type: "action", label: "Reset tours", hint: "Makes every tour and the What's new notice appear again.", button: "Reset", run: () => app.run("help.resetTours") },
          ],
        },
        {
          title: "Finding things",
          items: [
            { type: "info", label: "Command palette", text: "Press Ctrl+K (Cmd+K on macOS) or F1 to search every command. Shift+F1 turns on What's this?: click anything to see what it does." },
            { type: "action", label: "What's new", hint: "Highlights of this version.", button: "Show", run: () => app.run("help.whatsNew") },
          ],
        },
      ],
    },
    {
      id: "canvas",
      label: "Canvas and editing",
      icon: "bounding-box",
      lead: "Behavior of the Vector, Pixel and Layout canvases.",
      keywords: "rulers clip content history undo memory low power performance",
      groups: [
        {
          title: "Canvas",
          items: [
            sw("rulers", "Show rulers", "Rulers along the canvas edges; drag from them to make guides."),
            { type: "segmented", key: "clipContent", label: "Clip content to the page", hint: "Whether artwork outside the page is hidden. Automatic follows the studio: shown in Vector, clipped in Pixel and Layout.", options: [{ value: "auto", label: "Automatic", text: "Auto" }, { value: "on", label: "Always clip", text: "On" }, { value: "off", label: "Never clip", text: "Off" }], get: () => (app.prefs.clipContent == null ? "auto" : app.prefs.clipContent ? "on" : "off"), set: (v) => app.setPref("clipContent", v === "auto" ? null : v === "on") },
          ],
        },
        {
          title: "Performance",
          items: [
            seg("lowPower", "Low-power mode", [{ value: "auto", label: "Detect automatically", text: "Auto" }, { value: "on", label: "Always on", text: "On" }, { value: "off", label: "Always off", text: "Off" }], "Renders at standard resolution, skips shadows and live effect previews while dragging, and keeps less undo history. Ideal for older devices."),
            num("historyMB", "Undo history memory", 8, 1024, 8, "MB", "Older steps are dropped when the history grows beyond this."),
          ],
        },
      ],
    },
    {
      id: "code",
      label: "Code studio",
      icon: "code-slash",
      lead: "The code editor and the website preview.",
      keywords: "editor tab size word wrap font format save preview scripts website",
      groups: [
        {
          title: "Editor",
          items: [
            seg("codeTabSize", "Tab size", [{ value: 2, label: "2 spaces", text: "2" }, { value: 4, label: "4 spaces", text: "4" }, { value: 8, label: "8 spaces", text: "8" }], "Applies to editor tabs you open from now on."),
            sw("codeWordWrap", "Wrap long lines"),
            num("codeFontSize", "Font size", 10, 24, 1, "px"),
            sw("codeFormatOnSave", "Format the open file when saving", "CSS and JSON are rewritten; other languages are re-indented."),
          ],
        },
        {
          title: "Source control and publishing",
          items: [
            { type: "text", key: "gitName", label: "Commit author name", placeholder: "Your name", hint: "Used for commits made in Source Control. Stored on this device, not in the document." },
            { type: "text", key: "gitEmail", label: "Commit author email", placeholder: "you@example.com", inputType: "email", hint: "Part of every commit; use a no-reply address if you will publish the history." },
            { type: "info", label: "Tokens and passwords", text: "Remote and publish tokens are stored privately on this device (sealed with your key vault passphrase when the vault is on) and sent only to the service you configured — never saved in documents." },
          ],
        },
        {
          title: "Website preview",
          items: [
            sw("previewScripts", "Run JavaScript in the preview", "Off shows the page without its scripts (safer for projects you did not write). Navigation and editing keep working."),
            { type: "info", label: "Isolation", text: "The preview runs in a sandboxed frame that cannot read OpenFini, its storage or your other documents." },
          ],
        },
      ],
    },
    {
      id: "ai",
      label: "Artificial intelligence",
      icon: "stars",
      lead: "Control over AI features.",
      keywords: "ai artificial intelligence assistant model privacy data",
      groups: [
        {
          title: "AI features",
          items: [
            { type: "note", text: "Vibe Studio and the right-click AI functions work with the AI providers you connect yourself (OpenRouter, OpenAI, Anthropic, DeepSeek, xAI, Gemini, local models and more). Nothing leaves this device until you turn the switch on and add a connection." },
            sw("aiEnabled", "Enable AI features", "When on, your messages — and what the assistant reads through tools, such as layer names, screenshots of the page or project files — are sent to the provider you selected. Off by default."),
            { type: "action", label: "Vibe Studio", hint: "Chat, models and connections, tools and MCP servers, skills and knowledge.", button: "Open Vibe Studio", run: () => app.setStudio("vibe") },
            { type: "info", label: "Where your keys live", text: "API keys are stored in this browser's or app's private storage and sent only to the provider's address. You can protect them with a passphrase in Vibe Studio ▸ Models." },
            { type: "action", label: "AI data", hint: "Deletes chats, connections and keys, skills, custom tools, MCP servers, memory and the knowledge index.", button: "Delete…", danger: true, run: async () => { if (await confirmDialog({ title: "Delete AI data", message: "Delete all Vibe chats, API keys, skills, tools, MCP servers, memory and knowledge from this device?", ok: "Delete", danger: true })) { const { vibeStore } = await import("../vibe/store.js"); await vibeStore.load(); await vibeStore.clearAll(); app.toast("AI data deleted.", "success", 1800); } } },
          ],
        },
      ],
    },
    securitySection(app),
    troubleshootingSection(app),
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      icon: "keyboard",
      lead: "Every shortcut at a glance. Use the command palette (Ctrl+Shift+P) in the Code studio to run any command by name.",
      keywords: "keys shortcut hotkey keyboard",
      custom: () => shortcutsContent(app),
      groups: [],
    },
    {
      id: "extensions",
      label: "Extensions",
      icon: "puzzle",
      lead: "Add-ons that extend OpenFini in every studio. They run in sandboxes with only the permissions you approve.",
      keywords: "extension plugin add-on sdk developer sandbox permissions",
      groups: [],
      custom: () => {
        const host = h("div");
        import("./extensions/manager.js").then((m) => host.replaceChildren(m.extensionsSettingsPane(app)));
        return host;
      },
    },
    {
      id: "about",
      label: "About",
      icon: "info-circle",
      lead: "OpenFini — a lightweight, open-source creative suite.",
      keywords: "version license about update",
      groups: [],
      custom: () => aboutPane(app),
    },
  ];
}

function aboutPane() {
  const version = h("span", "…");
  fetch("./build-info.json").then((r) => (r.ok ? r.json() : null)).then((j) => (version.textContent = j ? `${j.version} (build ${String(j.buildId).split("-").pop()})` : "development build")).catch(() => (version.textContent = "development build"));
  return h(
    "div.of-set__group",
    h("div.of-set__row", h("div.of-set__label", "Version"), h("div.of-set__ctl", version)),
    h("div.of-set__row", h("div.of-set__label", "License"), h("div.of-set__ctl", "MIT")),
    h("div.of-set__row", h("div.of-set__label", "Source code"), h("div.of-set__ctl", button("github.com/philppplik/open-fini", () => openLink("https://github.com/philppplik/open-fini")))),
    h("div.of-set__row", h("div.of-set__label", "Documentation"), h("div.of-set__ctl", button("Open", () => openLink("https://github.com/philppplik/open-fini#readme")))),
    h("p.of-set__hint", "OpenFini is an independent project. It is not affiliated with, endorsed by or derived from any commercial product. Product names are trademarks of their owners."),
  );
}

// ------------------------------------------------------------------ rendering

function control(app, item, rerender) {
  const get = item.get || (() => app.prefs[item.key]);
  const set = item.set || ((v) => app.setPref(item.key, v));
  switch (item.type) {
    case "switch": {
      const s = h("sl-switch", { size: "small", "aria-label": item.label });
      s.checked = !!get();
      s.addEventListener("sl-change", () => {
        set(s.checked);
        rerender();
      });
      return s;
    }
    case "segmented":
      return segmented(item.options, get(), (v) => { set(v); rerender(); }).el;
    case "text": {
      const t = h("sl-input", { size: "small", value: String(get() ?? ""), placeholder: item.placeholder || "", type: item.inputType || "text", "aria-label": item.label });
      t.addEventListener("sl-change", () => set(t.value.trim()));
      return t;
    }
    case "number": {
      const f = numField({ value: Number(get()), min: item.min, max: item.max, step: item.step, precision: 0, unit: item.unit, wide: true, onChange: (v) => set(Math.round(v)) });
      return f.el;
    }
    case "accent": {
      const wrap = h("div.of-set__swatches");
      const cur = app.prefs.accent || "violet";
      for (const a of ACCENTS) {
        const b = h("button.of-set__swatch", { type: "button", title: a.label, "aria-label": a.label, "aria-pressed": String(cur === a.id), style: { background: a.color || "linear-gradient(135deg, var(--of-accent), var(--of-accent-strong))" } });
        b.addEventListener("click", () => {
          app.setPref("accent", a.id);
          for (const x of wrap.children) x.setAttribute("aria-pressed", String(x === b));
        });
        wrap.append(b);
      }
      return wrap;
    }
    case "action": {
      const b = button(item.button, () => item.run(), { variant: item.danger ? "danger" : "default" });
      if (item.danger) b.classList.add("of-btn--danger");
      return b;
    }
    default:
      return null;
  }
}

function row(app, item, rerender) {
  if (item.type === "note") return h("div.of-set__note", item.text);
  if (item.type === "custom") return item.render(app, rerender); // self-contained block (security center)
  if (item.type === "themes") return themeGallery(app);
  if (item.type === "info") return h("div.of-set__row", h("div", h("div.of-set__label", item.label), h("div.of-set__hint", item.text)));
  if (item.type === "storage") {
    const v = h("span", "…");
    navigator.storage?.estimate?.().then((e) => (v.textContent = e?.usage != null ? `${formatBytes(e.usage)} used by OpenFini on this device` : "unknown")).catch(() => (v.textContent = "unknown"));
    return h("div.of-set__row", h("div", h("div.of-set__label", "Storage"), h("div.of-set__hint", "Autosave, recent files and added fonts live in this browser or app profile.")), h("div.of-set__ctl", v));
  }
  const ctl = control(app, item, rerender);
  return h("div.of-set__row", h("div", h("div.of-set__label", item.label), item.hint ? h("div.of-set__hint", item.hint) : null), h("div.of-set__ctl", ctl));
}

export function settingsDialog(app, sectionId = "general") {
  const sections = settingsSections(app);
  let current = sections.some((s) => s.id === sectionId) ? sectionId : "general";
  const nav = h("nav.of-set__nav", { "aria-label": "Settings sections" });
  const body = h("div.of-set__body", { role: "region", "aria-live": "polite" });
  const search = h("input.of-set__search", { type: "search", placeholder: "Search settings", "aria-label": "Search settings", spellcheck: false });
  let query = "";

  const matches = (s) => !query || `${s.label} ${s.keywords || ""} ${s.groups.flatMap((g) => g.items.map((i) => `${i.label || ""} ${i.hint || ""}`)).join(" ")}`.toLowerCase().includes(query);

  function renderNav() {
    empty(nav);
    nav.append(search);
    for (const s of sections.filter(matches)) {
      const b = h("button.of-set__tab", { type: "button", class: s.id === current ? "active" : "", "aria-current": s.id === current ? "page" : undefined }, iconEl(s.icon), h("span", s.label));
      b.addEventListener("click", () => {
        current = s.id;
        renderNav();
        renderBody();
      });
      nav.append(b);
    }
  }
  function renderBody() {
    empty(body);
    let s = sections.find((x) => x.id === current);
    if (!s || !matches(s)) s = sections.find(matches);
    if (!s) return body.append(h("div.of-set__empty", `No settings match “${query}”.`));
    current = s.id;
    body.append(h("h2", s.label), h("p.of-set__lead", s.lead || ""));
    if (s.custom) body.append(s.custom());
    for (const g of s.groups) {
      const items = g.items.filter((i) => !i.when || i.when());
      if (!items.length) continue;
      body.append(h("section.of-set__group", h("h3", g.title), items.map((i) => row(app, i, renderBody))));
    }
    body.scrollTop = 0;
  }
  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    renderNav();
    renderBody();
  });
  search.addEventListener("keydown", (e) => e.stopPropagation());
  renderNav();
  renderBody();
  // keep the controls in step when a preference changes elsewhere (for example the View menu)
  const off = app.on("prefs", (key) => {
    if (!document.body.contains(body)) return off();
    if (key === "*") renderBody(); // reset to defaults
  });
  openDialog({ title: "Settings", body: h("div.of-set", nav, body), width: 980, cls: "of-settings", buttons: [{ label: "Done", variant: "primary", onClick: (c) => c() }] });
}
