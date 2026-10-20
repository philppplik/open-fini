// "What's new" highlights, written by hand per release (static content: nothing is parsed from the changelog at runtime).
// Newest first. Keep each list to a handful of user-facing highlights.

export const WHATS_NEW = [
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
