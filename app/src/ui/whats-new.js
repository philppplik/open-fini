// "What's new" highlights, written by hand per release (static content: nothing is parsed from the changelog at runtime).
// Newest first. Keep each list to a handful of user-facing highlights.

export const WHATS_NEW = [
  {
    version: "0.9.0",
    title: "Vibe 2, open folders, fallback models, glass 2",
    items: [
      { icon: "stars", title: "Vibe Studio 2", text: "Canvas and Activity on the right, everything else under Settings, Artificial intelligence. Type @ for files and layers, / for skills and ! for tools, and review every AI change as a diff." },
      { icon: "arrow-repeat", title: "Fallback models", text: "If a model does not answer, Vibe switches to the next one in your fallback chain. OpenCode Zen is available as a provider." },
      { icon: "folder2-open", title: "Open folders from your file manager", text: "Right-click a folder in Explorer and choose Open with OpenFini (Windows installer option; Linux and macOS via Open With)." },
      { icon: "droplet", title: "Glass 2", text: "Liquid glass now refracts what is behind it, and Sea glass follows your accent color." },
      { icon: "rulers", title: "Code studio accuracy", text: "The viewport and the measure tool now agree to the pixel, selecting in the preview highlights the code and the other way round, and Format works for HTML, CSS, JS and JSON." },
      { icon: "chat-quote", title: "Comment anywhere", text: "Right-click a point and choose Add comment here. The collaboration window now has a side rail and can pop out." },
    ],
  },
  {
    version: "0.8.0",
    title: "Edit together, VS Code extensions, fixes",
    items: [
      { icon: "share", title: "Edit together (beta)", text: "Share an open document with a room by right-click and edit it live with others. Run npm run relay -- --lan to reach other devices on your network." },
      { icon: "puzzle", title: "VS Code extensions", text: "Install themes, snippets and web extensions from Open VSX or a .vsix file. A compatibility badge shows what OpenFini can run." },
      { icon: "file-earmark", title: "Fixed: opening .ofini files", text: "Documents saved by 0.7.0 could not be opened. They open again." },
      { icon: "layout-split", title: "Selection pill and cleaner menus", text: "A pill at the bottom shows the active selection with quick actions. Submenus work in the glass styles, and the system right-click menu no longer appears inside the app." },
      { icon: "people", title: "Security updates", text: "All open code-scanning alerts were fixed and dependencies were updated." },
    ],
  },
  {
    version: "0.7.0",
    title: "Work together, measure pixels, glass surfaces",
    items: [
      { icon: "chat-quote", title: "Collaboration", text: "Create a room, share an invite code, and chat, comment, save versions and see each other's cursors, end-to-end encrypted. Studio, Collaborate. Simultaneous editing of one document is not live yet." },
      { icon: "rulers", title: "Pixel-exact viewport", text: "Set the Code studio preview to any size, drag the edges, jump to breakpoints and test with the width slider." },
      { icon: "bounding-box", title: "Measure tool", text: "Press M in the Code studio and hover elements to measure them in px, mm, rem and more." },
      { icon: "layout-split", title: "Split layouts", text: "Put the code left, right, above or below the preview." },
      { icon: "droplet", title: "Glass surfaces", text: "Glass, Liquid glass and Sea glass styles for the interface, with blur, transparency and background controls under Settings, Appearance." },
    ],
  },
  {
    version: "0.6.0",
    title: "Your files stay yours",
    items: [
      { icon: "file-earmark", title: "Save in the original format", text: "Open a .txt, .md or .docx, press Ctrl+S, and it is saved as the same kind of file. Only when a document outgrows its format are you asked to save it as .ofini." },
      { icon: "arrow-repeat", title: "Old documents keep opening", text: "OpenFini upgrades older .ofini files when you open them, and warns before it overwrites a file made by a newer version." },
      { icon: "box-arrow-up-right", title: "Quit with confidence", text: "One dialog lists every unsaved document: Save All, Discard or Cancel." },
      { icon: "cpu", title: "Custom AI providers", text: "Connect any OpenAI- or Anthropic-compatible server with your own headers, and type a model id when there is no model list." },
      { icon: "palette", title: "More accent colors", text: "Twenty presets and a free color picker under Settings, Appearance. The settings search also keeps its focus while you type." },
    ],
  },
  {
    version: "0.5.0",
    title: "Office, several Vibe chats at once, windows, German",
    items: [
      { icon: "file-earmark-text", title: "Office Studio", text: "Open and edit Word documents (.docx), plus ODT, RTF, HTML and Markdown, and export to PDF. It lives in the More menu next to the studios; choose which five studios the header shows under Settings, Studios." },
      { icon: "stars", title: "Vibe: chats, agents and skills", text: "Run several chats at once, let the assistant start sub-agents, and use 16 new skills with parameters. A status pill shows what the AI is doing." },
      { icon: "box-arrow-up-right", title: "Pop-out windows", text: "Move a studio or document into its own window and work in several at once. File, New Window." },
      { icon: "globe2", title: "German and automatic language", text: "OpenFini follows your system language. Deutsch is complete for menus, dialogs and settings; change it under Settings, General." },
      { icon: "keyboard", title: "Customize everything", text: "Rebind shortcuts, hide tools, save workspaces and share settings as profiles. Settings, Shortcuts and Layout." },
      { icon: "box", title: "Five bundled extensions", text: "Palette Pro, Batch Export, Data Filler, Code Tools and an Accessibility Checker. Install them from Extensions, Available extensions." },
      { icon: "file-earmark", title: "More formats and tools", text: "TIFF, animated GIF, OpenRaster, ICO and color palettes open natively. Right-click menus know where you are, and the Code editor can encode special characters." },
      { icon: "arrow-repeat", title: "Update check", text: "Settings, About can check for a new version. Automatic checks are optional and off by default." },
    ],
  },
  {
    version: "0.4.0",
    title: "Extensions, Git, tables, charts, PDF and more",
    items: [
      { icon: "box", title: "Extensions", text: "Add commands, panels, themes and Vibe tools with sandboxed extensions (.ofext). Settings, Extensions. Authors: see the SDK in the sdk folder." },
      { icon: "signpost-split", title: "Git and Publish", text: "Real Git history inside the Code studio, and one-click publishing to Netlify, Vercel, GitHub Pages or WebDAV." },
      { icon: "table", title: "Tables and charts", text: "Editable tables with formulas and charts linked to table data in the Layout studio, with SVG and PDF export." },
      { icon: "file-earmark-text", title: "Open PDFs", text: "PDF and Illustrator (.ai) files open as editable Layout pages, with an import report. Markdown and LaTeX open in the Code studio." },
      { icon: "bar-chart", title: "Histogram that works", text: "A live Histogram panel with channels, statistics and clipping overlay, plus interactive Levels and Curves." },
      { icon: "shield-check", title: "Security and troubleshooting", text: "App lock, offline mode, safe mode and a Troubleshooting dialog (Ctrl+Shift+F1) with redacted logs." },
      { icon: "palette", title: "Color themes", text: "Eleven themes besides the default, each with a light and a dark variant. Pick one in Settings, Appearance. Themes tint surfaces, borders, selection and the code editor, not just the accent." },
      { icon: "search", title: "Command palette", text: "Press Ctrl+K (Cmd+K on macOS) or F1 to search and run any command, with recent commands and shortcuts shown." },
      { icon: "signpost-split", title: "Tours and hints", text: "A short welcome tour and a mini tour the first time you open each studio. Help, Take the tour repeats them. Shift+F1 explains whatever you click." },
      { icon: "arrows-vertical", title: "Scrollbars", text: "Thin, rounded scrollbars that follow the theme everywhere, with a thicker variant in high-contrast mode." },
      { icon: "stars", title: "Vibe can help you use OpenFini", text: "The assistant can list themes and commands, switch themes for you and start a tour." },
    ],
  },
];

/** The entry for a version, or null. */
export const whatsNewFor = (version) => WHATS_NEW.find((e) => e.version === version) || null;

export const latestVersion = () => WHATS_NEW[0].version;
