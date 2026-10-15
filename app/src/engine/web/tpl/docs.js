import { FOUNDATION, MAIN_JS, MENU_ICON, compose, head } from "./shared.js";

const LOGO = `<svg class="logo" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#2563eb"/><ellipse cx="16" cy="18" rx="9" ry="7" fill="#fff"/><ellipse cx="13" cy="15.5" rx="3.2" ry="2" fill="#bfdbfe"/></svg>`;

const sidebar = (current) => `<aside class="docs-nav" id="docs-nav" aria-label="Documentation" data-nav>
        <p class="docs-group">Basics</p>
        <ul>
          <li><a href="index.html"${current === "index" ? ' aria-current="page"' : ""}>Getting started</a></li>
          <li><a href="configuration.html"${current === "configuration" ? ' aria-current="page"' : ""}>Configuration</a></li>
        </ul>
        <p class="docs-group">Help</p>
        <ul>
          <li><a href="mailto:docs@pebble.example">Contact the team</a></li>
        </ul>
      </aside>`;

const shell = ({ title, description, current, body, toc }) => `<!doctype html>
<html lang="en-US">
<head>
  ${head({ title: `${title} | Pebble docs`, description })}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="header-inner docs-wide">
      <a class="brand" href="index.html">${LOGO} Pebble <span class="brand-tag">docs</span></a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="docs-nav" data-nav-toggle>
        <span class="sr-only">Menu</span>
        ${MENU_ICON}
      </button>
    </div>
  </header>

  <div class="docs-layout docs-wide">
    ${sidebar(current)}

    <main id="main" class="docs-main">
${body}
    </main>

    <nav class="docs-toc" aria-label="On this page">
      <p class="docs-group">On this page</p>
      <ul>
${toc}
      </ul>
    </nav>
  </div>

  <footer class="site-footer">
    <div class="docs-wide">
      <p>&copy; <span data-year>2026</span> Pebble. Documentation for version 2.</p>
    </div>
  </footer>

  <script src="js/main.js"></script>
</body>
</html>
`;

const INDEX = shell({
  title: "Getting started",
  description: "Install Pebble, create your first site and preview it locally in a few minutes.",
  current: "index",
  toc: `        <li><a href="#install">Install</a></li>
        <li><a href="#create">Create a site</a></li>
        <li><a href="#layout">Project layout</a></li>
        <li><a href="#preview">Preview and build</a></li>`,
  body: `      <p class="eyebrow">Basics</p>
      <h1>Getting started</h1>
      <p class="lead">Pebble turns a folder of Markdown files and templates into a fast static website. This page takes you from nothing to a running site in about five minutes.</p>

      <h2 id="install">Install</h2>
      <p>Download the build for your system, unpack it and put the <code>pebble</code> program somewhere on your <code>PATH</code>. Check that it works:</p>
      <pre tabindex="0"><code>pebble --version</code></pre>
      <div class="note" role="note">
        <p class="note-title">Tip</p>
        <p>Pebble is a single file with no runtime to install. You can keep it inside a project folder if you prefer.</p>
      </div>

      <h2 id="create">Create a site</h2>
      <p>Ask Pebble to scaffold a new project, then move into it:</p>
      <pre tabindex="0"><code>pebble new my-site
cd my-site</code></pre>
      <p>The new site already contains a home page, one blog post and a theme you can change.</p>

      <h2 id="layout">Project layout</h2>
      <p>Every Pebble site follows the same structure, which keeps projects easy to read:</p>
      <pre tabindex="0"><code>my-site/
  pebble.json      site settings
  content/         pages and posts in Markdown
  theme/           templates, styles and scripts
  static/          files copied as they are</code></pre>
      <ul>
        <li>Put pages in <code>content/</code>. A file named <code>about.md</code> becomes <code>/about/</code>.</li>
        <li>Anything in <code>static/</code> is published untouched, such as images and downloads.</li>
        <li>Change how everything looks by editing the files in <code>theme/</code>.</li>
      </ul>

      <h2 id="preview">Preview and build</h2>
      <p>Start the preview server. It reloads the page whenever you save a file:</p>
      <pre tabindex="0"><code>pebble serve</code></pre>
      <p>When you are happy, build the finished site into the <code>public/</code> folder and upload it to any static host:</p>
      <pre tabindex="0"><code>pebble build</code></pre>

      <nav class="pager" aria-label="Pagination">
        <a class="pager-next" href="configuration.html"><span>Next</span>Configuration</a>
      </nav>`,
});

const row = (name, type, def, text) => `            <tr>
              <th scope="row"><code>${name}</code></th>
              <td><code>${type}</code></td>
              <td>${def}</td>
              <td>${text}</td>
            </tr>`;

const CONFIG = shell({
  title: "Configuration",
  description: "Every setting in pebble.json explained, with defaults and examples.",
  current: "configuration",
  toc: `        <li><a href="#file">The settings file</a></li>
        <li><a href="#options">Options</a></li>
        <li><a href="#example">Example</a></li>
        <li><a href="#env">Environment variables</a></li>`,
  body: `      <p class="eyebrow">Basics</p>
      <h1>Configuration</h1>
      <p class="lead">Pebble reads its settings from <code>pebble.json</code> in the root of your project. Every setting is optional.</p>

      <h2 id="file">The settings file</h2>
      <p>The file is plain JSON. Add only the settings you want to change; everything else keeps its default.</p>

      <h2 id="options">Options</h2>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Configuration options">
        <table>
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col">Type</th>
              <th scope="col">Default</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
${[
    row("title", "string", "<code>\"Untitled\"</code>", "The name of your site, used in page titles."),
    row("baseUrl", "string", "<code>\"/\"</code>", "The address your site is published at. Set it when the site lives in a sub-folder."),
    row("contentDir", "string", "<code>\"content\"</code>", "Folder that holds your Markdown pages and posts."),
    row("outputDir", "string", "<code>\"public\"</code>", "Folder that <code>pebble build</code> writes the finished site into."),
    row("minify", "boolean", "<code>true</code>", "Remove whitespace and comments from HTML and CSS when building."),
    row("drafts", "boolean", "<code>false</code>", "Include pages marked as drafts in the preview and the build."),
  ].join("\n")}
          </tbody>
        </table>
      </div>

      <div class="note note-warning" role="note">
        <p class="note-title">Careful</p>
        <p>The <code>outputDir</code> folder is emptied on every build. Never point it at a folder that holds files you want to keep.</p>
      </div>

      <h2 id="example">Example</h2>
      <p>A typical settings file for a site published under a sub-folder:</p>
      <pre tabindex="0"><code>{
  "title": "Trail notes",
  "baseUrl": "/notes/",
  "minify": true,
  "drafts": false
}</code></pre>

      <h2 id="env">Environment variables</h2>
      <p>Two variables override the file, which is handy on a build server:</p>
      <ul>
        <li><code>PEBBLE_BASE_URL</code> replaces <code>baseUrl</code>.</li>
        <li><code>PEBBLE_DRAFTS=1</code> turns on drafts for a single run.</li>
      </ul>

      <nav class="pager" aria-label="Pagination">
        <a class="pager-prev" href="index.html"><span>Previous</span>Getting started</a>
      </nav>`,
});

const own = {
  root: `:root {
  --bg: #ffffff;
  --surface: #f6f8fb;
  --text: #172033;
  --muted: #53607a;
  --border: #e1e6ef;
  --accent: #1d4ed8;
  --accent-ink: #ffffff;
  --radius: 8px;
  --shadow: 0 10px 28px rgba(23, 32, 51, 0.14);
  --header-bg: rgba(255, 255, 255, 0.94);
  --container: 1280px;
  --font-body: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-heading: var(--font-body);
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}`,
  base: `.docs-wide {
  width: 100%;
  max-width: var(--container);
  margin: 0 auto;
  padding: 0 24px;
}

.logo {
  flex: none;
}

.brand-tag {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: #e0e9ff;
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.docs-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr) 200px;
  gap: 48px;
  align-items: start;
}

.docs-nav,
.docs-toc {
  position: sticky;
  top: 72px;
  max-height: calc(100vh - 72px);
  padding: 32px 0;
  overflow-y: auto;
  font-size: 0.9375rem;
}

.docs-group {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.docs-nav ul,
.docs-toc ul {
  margin: 0 0 1.5rem;
  padding: 0;
  list-style: none;
}

.docs-nav a,
.docs-toc a {
  display: block;
  padding: 0.35rem 0.75rem;
  border-left: 2px solid var(--border);
  color: var(--muted);
  text-decoration: none;
}

.docs-nav a:hover,
.docs-toc a:hover {
  border-left-color: var(--accent);
  color: var(--text);
}

.docs-nav a[aria-current="page"] {
  border-left-color: var(--accent);
  background: #eef3ff;
  color: var(--accent);
  font-weight: 600;
}

.docs-main {
  min-width: 0;
  max-width: 760px;
  padding: 48px 0 96px;
}

.docs-main h1 {
  font-size: 2.75rem;
}

.docs-main h2 {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  font-size: 1.625rem;
}

.docs-main ul {
  padding-left: 1.25rem;
}

.docs-main li {
  margin-bottom: 0.4rem;
}

code {
  padding: 0.12em 0.4em;
  border-radius: 6px;
  background: #eef1f6;
  font-family: var(--font-mono);
  font-size: 0.875em;
}

pre {
  margin: 0 0 1.5rem;
  padding: 18px 20px;
  overflow-x: auto;
  border-radius: 12px;
  background: #101828;
  color: #e5ecf6;
  font-size: 0.9rem;
  line-height: 1.6;
}

pre code {
  padding: 0;
  background: none;
  color: inherit;
  font-size: inherit;
}

.note {
  margin: 0 0 1.5rem;
  padding: 16px 20px;
  border-left: 4px solid var(--accent);
  border-radius: 0 var(--radius) var(--radius) 0;
  background: #eef3ff;
}

.note p:last-child {
  margin-bottom: 0;
}

.note-title {
  margin-bottom: 0.25rem;
  font-weight: 700;
}

.note-warning {
  border-left-color: #b45309;
  background: #fff4e0;
}

.table-wrap {
  margin-bottom: 1.5rem;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
}

th,
td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

thead th {
  background: var(--surface);
  font-size: 0.8125rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

tbody tr:last-child th,
tbody tr:last-child td {
  border-bottom: 0;
}

.pager {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 3rem;
}

.pager a {
  display: block;
  min-width: 200px;
  padding: 14px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  font-weight: 600;
  text-decoration: none;
}

.pager a:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.pager span {
  display: block;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--muted);
}

.pager-next {
  margin-left: auto;
  text-align: right;
}`,
  m991: `.docs-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .docs-toc {
    display: none;
  }

  .docs-nav {
    position: absolute;
    top: 100%;
    right: 0;
    left: 0;
    display: none;
    max-height: calc(100vh - 72px);
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    box-shadow: var(--shadow);
  }

  .docs-nav.is-open {
    display: block;
  }

  .docs-main {
    max-width: none;
    padding-top: 32px;
  }

  .docs-main h1 {
    font-size: 2.25rem;
  }`,
  m767: `.docs-main h1 {
    font-size: 2rem;
  }

  .docs-main h2 {
    margin-top: 2.25rem;
    font-size: 1.375rem;
  }

  .pager {
    flex-direction: column;
  }

  .pager a {
    min-width: 0;
  }`,
  m478: `.docs-wide {
    padding: 0 16px;
  }

  .docs-nav {
    padding: 16px;
  }

  pre {
    padding: 14px 16px;
    font-size: 0.8125rem;
  }

  th,
  td {
    padding: 10px 12px;
  }`,
};

export const docs = {
  id: "docs",
  name: "Documentation",
  description: "A documentation site with a sidebar, an on-page table of contents, code blocks, notes and two linked pages.",
  category: "Content",
  accent: "#1d4ed8",
  files: {
    "index.html": INDEX,
    "configuration.html": CONFIG,
    "css/style.css": compose(FOUNDATION, own),
    "js/main.js": MAIN_JS,
  },
};
