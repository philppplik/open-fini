// Lazy skill pack: informational skills about OpenFini itself (`openfini-*`). Loaded by packs/index.js only when one
// is used (Help > Ask about OpenFini primes a chat with them). Formats and shortcuts come from generated.js, which
// scripts/knowledge-packs.mjs builds from the registries. Docs links point to docs/ in the repository; keep facts in
// sync with docs (tests/docs/knowledge-packs.test.js checks that every linked doc exists).
import { FORMATS_MD, SHORTCUTS_MD } from "./generated.js";

const REPO = "https://github.com/philppplik/open-fini";
const fm = (name, description, tools, when) => `---
name: openfini-${name}
description: ${description}
version: 1.0.0
tags: [openfini, help]
allowed-tools: ${tools}
when-to-use: ${when}
---`;
const RULES = `## Rules
- Answer from this text and the tools named here; say when you do not know and point to ${REPO} (docs folder and wiki).
- Answer in the user's language, briefly; menu paths as Menu > Item.`;

export const KNOWLEDGE_SKILLS = [
  `${fm("overview", "What OpenFini is: idea, philosophy and the big picture, for questions like what is OpenFini or why does it exist.", "list_commands", "what is openfini, about openfini, philosophy, idea, why openfini, was ist openfini")}
# OpenFini overview

- OpenFini is a free, open-source (MIT) creative suite that runs as a desktop app (Tauri) and as an installable web app (PWA) from one code base, with an English and a German interface.
- Studios: Vector, Pixel, Layout, Code, Office (documents, spreadsheets, presentations, whiteboards) and Vibe, the AI assistant that can drive every other studio through tools. One document can mix studios.
- Philosophy: local-first (files you choose, no account, no network requests unless you switch a feature on), lightweight (no UI framework, small start-up bundle, lazy-loaded studios), honest about limits (format verdicts say what is not possible), clean-room (written from public specifications; no code or assets from other products), everything undoable, keyboard friendly and accessible.
- AI is off by default; when switched on you bring your own provider (or the offline Demo provider), and every write the assistant makes is visible and undoable.
- More: openfini-studios, openfini-formats, openfini-how-to; the developer: about-the-developer.

${RULES}`,

  `${fm("studios", "What each OpenFini studio includes and when to use which.", "list_commands, office_formats", "which studio, what can vector do, pixel studio features, layout studio, code studio, office studio, vibe studio")}
# The studios

- Vector: shapes, pen and paths, boolean operations, gradients, text, symbols/components, SVG import and export. For logos, icons, illustrations, UI mockups.
- Pixel: raster layers, masks, selections (including Select Subject), adjustment and filter layers (non-destructive), native photo edits (background removal, color replace, sharpen), crop/straighten, histogram. For photos and textures.
- Layout: multi-page documents, master pages, margins, columns, bleed, text frames with styles, real tables and charts, PDF/X export and color management (CMYK, ICC soft proof, preflight). For print and reports.
- Code: website projects (HTML, CSS, JS, Markdown, LaTeX preview) with a live preview and designer, breakpoints, formatter, problem checks, Git, publishing (FTP/FTPS and others), frameworks and VS Code extensions.
- Office: text documents (DOCX, ODT, RTF), spreadsheets (formula engine, XLSX/ODS/CSV), presentations (PPTX/ODP, presenter view) and whiteboards (Excalidraw and tldraw files). Call office_formats for the live list.
- Vibe: chat with the assistant; panels for Activity, Models, Tools, Skills and Knowledge; sub-agents and plan_work for multi-studio jobs; per-run undo.
- Docs: docs/studios.md, docs/office-suite.md, docs/vibe-studio.md.

${RULES}`,

  `${fm("formats", "Which file types OpenFini opens, imports and exports (generated from the format registries).", "list_supported_formats, office_formats", "file formats, can openfini open, import export, psd, pdf, docx, xlsx, supported files, dateiformate")}
# Supported file types

Generated from the format registries; for one extension call list_supported_formats with extension.

${FORMATS_MD}

${RULES}`,

  `${fm("ofini-format", "The technical .ofini document format: ZIP layout, document.json, versions and how to inspect or repair a file.", "", "ofini format, file format internals, document.json, repair ofini, what is inside an ofini file")}
# The .ofini format

- A ZIP archive (MIME application/vnd.openfini+zip): mimetype (stored, first entry), document.json (structure, styles, text), assets/<id>.<ext> (original image bytes), pixels/<nodeId>.png (one lossless PNG per pixel layer or mask), office/media/ (Office images, only when an office document is present) and thumbnail.png (up to 256 px).
- document.json: format "openfini", version, id, name, dpi, unit, studio, pages (each with id, size, background, margins, columns, bleed, guides and a root group of nodes), masters, assets, text stories, paragraph and character styles, swatches, export slices and settings. Tables, charts, comments and an "office" section (documents, sheets, slides, boards) are stored as JSON too.
- Versions 1 and 2; older files are migrated on open; unknown keys are kept. Everything is plain JSON plus original bytes, so files can be inspected or repaired with any ZIP tool.
- Full reference: docs/file-format.md.

${RULES}`,

  `${fm("how-to", "Practical how-tos for common OpenFini tasks (open, save, export, undo, recover, share, use the assistant).", "list_commands, start_tour", "how do i, how to, export png, save as, recover, undo, open file, wie mache ich")}
# How-tos

- Open: File > Open (or drop a file). Foreign formats are converted on open; see openfini-formats.
- Save: Mod+S saves .ofini; with "save opened files in their original format" (Settings > General) a .docx or .txt is saved back as that format.
- Export: the Export popup (PNG, JPEG, WebP, SVG, PDF and print PDF/X); Office documents use their app's Export. Slices export named areas.
- Undo: Mod+Z / Mod+Shift+Z; the History panel jumps to any step; Vibe runs can be undone as a whole from the chat.
- Recover: autosave and session restore (Settings > General); recovery copies stay on this device.
- Find a command: the command palette (list_commands shows them with shortcuts); start_tour starts the guided tours.
- Use AI: Settings > Artificial intelligence (switch on), then Vibe Studio > Models to add a provider or use the Demo provider.
- Share: Collaboration window (end-to-end encrypted rooms), or send the .ofini file.

${RULES}`,

  `${fm("shortcuts", "Default keyboard shortcuts of OpenFini (generated from the command registry).", "list_shortcuts, list_commands", "keyboard shortcut, hotkey, key binding, tastenkürzel, shortcut for")}
# Keyboard shortcuts

Defaults; the user's current bindings: call list_shortcuts.

${SHORTCUTS_MD}

${RULES}`,

  `${fm("settings", "Map of the Settings dialog: which section controls what, and how to change settings with the assistant.", "get_settings, set_setting", "settings, preferences, where is the option, einstellungen, how do i turn off")}
# Settings map

Open with the OpenFini logo menu > Settings or Mod+,. A search box filters sections and single settings; changes apply at once and are stored on this device.

- General: session restore, autosave, ask before closing, save in the original format.
- Appearance: mode, themes, surface style (solid, glass), accent, density. Accessibility: high contrast, reduced motion, focus outlines, scale.
- Onboarding and help: tours and hints. Canvas and editing: rulers, clipping, low-power mode, undo memory. Code studio: tab size, wrap, format on save.
- Artificial intelligence: master switch (off by default), Delete AI data; models, keys and permissions live in Vibe Studio.
- Security and privacy: security check, offline mode, app lock, protected mode, privacy tools, integrity check, reset.
- Troubleshooting, Keyboard shortcuts, Toolbox and menus, Layout and workspaces, Defaults for new things, Profiles and backup (.ofprofile), About (version, update check).
- get_settings / set_setting read and change settings (changing asks for approval). Docs: docs/settings.md.

${RULES}`,

  `${fm("extensions", "Extensions and the SDK: installing .ofext packages, permissions, VS Code extensions and writing your own.", "list_extensions, search_vscode_extensions", "extension, plugin, add-on, sdk, ofext, vsix, write an extension, erweiterung")}
# Extensions and SDK

- Install: Studio > Extensions (or Settings > Extensions): from a .ofext file, a folder or an https URL. A dialog lists every permission with a risk level before anything is installed; nothing runs without consent. Offline mode blocks network permissions.
- Extensions run sandboxed (worker with a watchdog) and can add commands, tools, panels, file formats and Vibe tools and skills.
- VS Code extensions (.vsix): themes, snippets, grammars and language data for the Code studio, from Open VSX.
- Write one: npm run ext:create scaffolds a package, npm run ext:pack builds the .ofext; examples in sdk/examples; reference in docs/extensions.md.

${RULES}`,

  `${fm("collaboration", "Collaboration: encrypted rooms, chat, comments, live editing (beta), versions and what is not live.", "get_collab_status, list_versions", "collaborate, share, real time, room, comments, live editing, team, zusammenarbeiten")}
# Collaboration

- Rooms are end-to-end encrypted; join by link or QR code; a relay (built in on desktop, or a Node relay) forwards encrypted messages only.
- Live in a room: chat with mentions and threads, presence and follow, comments on layers, pages, text and code lines, files up to 25 MB, activity feed, and Edit together (beta) for Vector, Layout, the layer structure of Pixel, Code projects and text documents.
- Not live: pixel bitmaps, undo across people (undo reverts only your own steps); documents shared as a copy are snapshots.
- Without a room: comments are saved in the document; versions are snapshots on this device (list_versions, save_version).
- Docs: docs/collaboration.md.

${RULES}`,

  `${fm("security-privacy", "The security and privacy model: local-first data, network use, keys, offline mode, app lock, protected mode and logs.", "get_security_status", "privacy, security, is my data sent, offline, encryption, api key storage, datenschutz, sicherheit")}
# Security and privacy

- Local-first: documents are files you choose; settings, recovery copies and (optional) AI keys stay on this device. No account, no telemetry.
- Network only for what you switch on: AI providers and MCP servers you add, web access for the assistant, publishing, extensions with network permission, update checks, OAuth sign-ins and collaboration rooms (end-to-end encrypted).
- Protections: offline mode (kill switch), app lock (passphrase; forgotten passphrases cannot be recovered), protected mode for website projects from files, ask before opening links, privacy tools (inventory, clear, delete all), integrity self-check, safe mode. AI keys can be stored encrypted (vault).
- Logs and bug reports redact secrets; the AI log stores metadata only unless verbose logging is on.
- Not defended against: malware or an administrator on your computer, a compromised OS or web view, someone watching the screen.
- get_security_status reports the live state. Docs: docs/security.md, SECURITY.md.

${RULES}`,

  `${fm("troubleshooting", "Troubleshooting OpenFini: common problems, safe mode, reset, logs and how to report an issue.", "get_diagnostics, get_app_logs, get_security_status, run_doctor", "not working, error, crash, slow, bug, problem, white screen, damaged file, repair, doctor, fehler, funktioniert nicht")}
# Troubleshooting

- Storage full or autosave fails: save as files; clear recent files or the autosaved session (Privacy tools); private windows have tiny limits.
- Nothing remembered: site data blocked or a private window.
- Slow on big images: low-power mode, less undo memory, close documents.
- AI request fails: 401/403 key rejected, 429 rate limit, provider unreachable (local server off, CORS in a browser, offline mode on). Vibe Studio > Activity shows details.
- White screen after an update: reload, then Restart in safe mode, then Reset app data (offline cache).
- Report: Settings > Troubleshooting > Copy report or Save bundle (secrets redacted), then Report an issue (${REPO}/issues).
- Damaged or unopenable .ofini file: Help > Doctor (or the Repair with Doctor offer) opens a repaired copy in a new tab; in a terminal: ofini doctor --fix file.ofini. run_doctor lists the findings.
- get_diagnostics and get_app_logs show the live state. Docs: docs/troubleshooting.md, docs/doctor.md, docs/cli.md.

${RULES}`,

  `${fm("licensing", "Licensing and credits: the MIT license, third-party components, clean-room policy and how to contribute.", "", "license, licence, mit, open source, credits, third party, can i use commercially, lizenz")}
# Licensing and credits

- OpenFini is MIT licensed: free to use, modify and distribute, also commercially, keeping the copyright and license notice.
- Third-party components and their licenses: THIRD_PARTY_NOTICES.md (also under Settings > About).
- Clean-room: written from public specifications and general knowledge; no code or assets from other products (docs/clean-room.md).
- Contribute: CONTRIBUTING.md and the issue tracker at ${REPO}. Who made it: use the about-the-developer skill.

${RULES}`,
];
