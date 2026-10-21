// Markdown-driven sites: content/*.md + layouts/*.tmpl are turned into HTML pages by the generator in ../ssg.js.
// The generated pages are part of the template so the preview works immediately; the studio regenerates them when
// a Markdown file or a layout changes.
import { buildMarkdownSite } from "../ssg.js";

const SITE_CSS = `:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --surface: #f5f6f8;
  --text: #1b1e24;
  --muted: #5a6270;
  --border: #dfe3e9;
  --accent: #b45309;
  --code-bg: #f1f3f6;
  --font: Georgia, "Iowan Old Style", "Times New Roman", serif;
  --font-ui: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15171b;
    --surface: #1e2126;
    --text: #e8eaee;
    --muted: #a3abb8;
    --border: #2f343c;
    --accent: #f0a04b;
    --code-bg: #20242a;
  }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 18px/1.7 var(--font); }
a { color: var(--accent); }
.skip-link { position: absolute; left: 8px; top: -48px; padding: 8px 14px; background: var(--accent); color: var(--bg); border-radius: 8px; }
.skip-link:focus { top: 8px; }
.wrap { width: min(100% - 2rem, 44rem); margin-inline: auto; }
.site-header { border-bottom: 1px solid var(--border); font-family: var(--font-ui); }
.site-header .wrap { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1.5rem; min-height: 64px; }
.brand { font-weight: 700; color: var(--text); text-decoration: none; }
.site-nav { display: flex; gap: 1.25rem; font-size: 0.95rem; }
.site-nav a { color: var(--muted); text-decoration: none; }
.site-nav a[aria-current="page"] { color: var(--text); font-weight: 600; }
main { padding: 2.5rem 0 4rem; }
h1 { font-size: clamp(2rem, 5vw, 2.8rem); line-height: 1.15; margin: 0 0 0.5rem; }
h2 { margin-top: 2.2em; line-height: 1.25; }
.meta { color: var(--muted); font-family: var(--font-ui); font-size: 0.9rem; margin: 0 0 2rem; }
.post-list { list-style: none; padding: 0; display: grid; gap: 1.75rem; }
.post-list h2 { margin: 0; font-size: 1.4rem; }
.post-list p { margin: 0.25rem 0 0; color: var(--muted); }
img { max-width: 100%; height: auto; border-radius: 8px; }
code { font: 0.88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 5px; }
pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; overflow: auto; line-height: 1.5; }
pre code { background: none; padding: 0; }
blockquote { margin-left: 0; padding-left: 1.2rem; border-left: 3px solid var(--accent); color: var(--muted); }
table { border-collapse: collapse; width: 100%; font-size: 0.95em; }
th, td { border: 1px solid var(--border); padding: 0.4em 0.7em; text-align: left; }
.site-footer { border-top: 1px solid var(--border); padding: 1.5rem 0; color: var(--muted); font-family: var(--font-ui); font-size: 0.9rem; }
.tok-comment { color: #6e7781; font-style: italic; }
.tok-keyword, .tok-tag { color: #b3261e; }
.tok-string, .tok-attributeName { color: #0b5394; }
.tok-number, .tok-atom { color: #7a4cc2; }
.tok-function, .tok-propertyName { color: #8250df; }

.layout-docs { display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: 3rem; width: min(100% - 2rem, 62rem); margin-inline: auto; }
.docs-nav { font-family: var(--font-ui); font-size: 0.95rem; padding-top: 2.5rem; }
.docs-nav ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; position: sticky; top: 1rem; }
.docs-nav a { color: var(--muted); text-decoration: none; }
.docs-nav a[aria-current="page"] { color: var(--text); font-weight: 600; }
.toc { font-family: var(--font-ui); font-size: 0.9rem; background: var(--surface); border-radius: 10px; padding: 0.75rem 1rem; }
.toc ul { margin: 0.25rem 0 0; padding-left: 1.1rem; }

@media (max-width: 767px) {
  .layout-docs { grid-template-columns: 1fr; gap: 0; }
  .docs-nav { padding-top: 1rem; }
  .docs-nav ul { position: static; grid-auto-flow: column; overflow-x: auto; }
}

@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto !important; }
}
`;

const HEAD = `  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{fullTitle}}</title>
  <meta name="description" content="{{description}}">
  <link rel="stylesheet" href="{{root}}css/style.css">`;

const NAV = `<nav class="site-nav" aria-label="Primary">{{#each nav}}<a href="{{url}}"{{{aria}}}>{{title}}</a>{{/each}}</nav>`;

const blogLayout = (body) => `<!doctype html>
<html lang="en-US">
<head>
${HEAD}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><div class="wrap"><a class="brand" href="{{root}}index.html">{{site.title}}</a>${NAV}</div></header>
  <main id="main" class="wrap">
${body}
  </main>
  <footer class="site-footer"><div class="wrap">{{site.description}}</div></footer>
</body>
</html>
`;

const blogFiles = {
  "site.json": `{
  "title": "Field Notes",
  "description": "Short essays about making things, written in Markdown.",
  "build": "markdown"
}
`,
  "css/style.css": SITE_CSS,
  "layouts/page.tmpl": blogLayout(`    <article>
      <h1>{{title}}</h1>
      {{{content}}}
    </article>`),
  "layouts/post.tmpl": blogLayout(`    <article>
      <h1>{{title}}</h1>
      <p class="meta"><time datetime="{{date}}">{{date}}</time></p>
      {{{content}}}
      <p><a href="{{root}}index.html">&larr; All posts</a></p>
    </article>`),
  "layouts/index.tmpl": blogLayout(`    <h1>{{title}}</h1>
    {{{content}}}
    <ul class="post-list">
      {{#each posts}}<li><h2><a href="{{url}}">{{title}}</a></h2><p class="meta">{{date}}</p><p>{{description}}</p></li>
      {{/each}}
    </ul>`),
  "content/index.md": `---
title: Field Notes
nav: Home
order: 1
---

Welcome. These pages are written in Markdown (see the **content** folder) and turned into HTML by the studio every time you save. Edit a post, add a new file under \`content/posts/\`, and the list below updates.
`,
  "content/about.md": `---
title: About
order: 2
---

# About

This is a small site made with OpenFini's Markdown generator. Each file in \`content/\` becomes a page with the layout that fits it:

* \`content/index.md\` uses \`layouts/index.tmpl\` and lists all posts
* files in \`content/posts/\` use \`layouts/post.tmpl\`
* everything else uses \`layouts/page.tmpl\`

Change the look in \`css/style.css\`. Go back to [the posts](index.md).
`,
  "content/posts/finding-your-pace.md": `---
title: Finding your pace
date: 2026-03-14
description: Why slow, steady work beats bursts of effort.
---

Most projects are not lost in the first week. They fade in the fourth, when the excitement is gone and the work is still unfinished.

## Start smaller than you think

A daily habit of twenty minutes survives bad days. A plan that needs three free hours does not.

> Consistency is a form of kindness to your future self.

## Make progress visible

1. Keep a list of what you finished, not only what is left.
2. Review it every Friday.
3. Celebrate in a way that costs nothing.

Read the [next post](second-draft.md) for what to do when the first version is rough.
`,
  "content/posts/second-draft.md": `---
title: The second draft
date: 2026-02-02
description: A first version is a question; the second is an answer.
---

The first draft exists to be thrown away. Its only job is to show you what you actually think.

## A simple checklist

- [x] Write the whole thing without editing
- [x] Sleep on it
- [ ] Cut a third of it

Code works the same way:

~~~js
// First draft: it works, nobody wants to read it
function f(a) { return a.filter(x => x).map(x => x * 2); }
~~~

Rename, split, delete. Then ship.
`,
  "content/posts/small-tools.md": `---
title: In praise of small tools
date: 2025-11-20
description: Why a tool that does one thing well keeps its place on the desk.
---

| Tool | Does | Does not |
| --- | --- | --- |
| A pencil | Writes, erases | Auto-save |
| A text editor | Edits text | Ask questions |

Small tools are easy to learn, easy to replace, and easy to **trust**. When something breaks you can see why.
`,
};

const docsLayout = (body) => `<!doctype html>
<html lang="en-US">
<head>
${HEAD}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><div class="wrap"><a class="brand" href="{{root}}index.html">{{site.title}}</a><span class="meta">{{site.description}}</span></div></header>
  <div class="layout-docs">
    <nav class="docs-nav" aria-label="Documentation"><ul>{{#each nav}}<li><a href="{{url}}"{{{aria}}}>{{title}}</a></li>{{/each}}</ul></nav>
    <main id="main">
${body}
    </main>
  </div>
  <footer class="site-footer"><div class="wrap">Made with Markdown.</div></footer>
</body>
</html>
`;

const docsFiles = {
  "site.json": `{
  "title": "Atlas Docs",
  "description": "Documentation written in Markdown",
  "build": "markdown"
}
`,
  "css/style.css": SITE_CSS,
  "layouts/page.tmpl": docsLayout(`      <article>
        <h1>{{title}}</h1>
        {{#if hasToc}}<nav class="toc" aria-label="On this page"><strong>On this page</strong><ul>{{#each toc}}<li><a href="#{{id}}">{{text}}</a></li>{{/each}}</ul></nav>{{/if}}
        {{{content}}}
      </article>`),
  "layouts/index.tmpl": docsLayout(`      <article>
        <h1>{{title}}</h1>
        {{{content}}}
      </article>`),
  "content/index.md": `---
title: Atlas documentation
order: 1
---

Atlas is a fictional library that we use to show how a documentation site is built from Markdown.

* Start with [Getting started](getting-started.md)
* Learn the options in [Configuration](configuration.md)
* Look things up in the [Reference](reference.md)
`,
  "content/getting-started.md": `---
title: Getting started
order: 2
---

## Install

~~~sh
npm install atlas
~~~

## First run

Create a file and call \`atlas.start()\`:

~~~js
import { start } from "atlas";

start({ port: 3000 });
~~~

## Next steps

Read [Configuration](configuration.md) to change the defaults.
`,
  "content/configuration.md": `---
title: Configuration
order: 3
---

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| \`port\` | number | \`3000\` | Port to listen on |
| \`verbose\` | boolean | \`false\` | Print every request |

## Environment

Every option can be set with an environment variable, for example \`ATLAS_PORT\`.[^1]

[^1]: Environment variables win over values in code.
`,
  "content/reference.md": `---
title: Reference
order: 4
---

## start(options)

Starts the server and returns a promise that resolves when it is listening.

## stop()

Stops the server. Pending requests are allowed to finish.

> Tip: the **On this page** box is built from the headings of each Markdown file.
`,
};

function make(files) {
  const reader = { list: () => Object.keys(files), readText: (p) => (p in files ? files[p] : null) };
  const built = buildMarkdownSite(reader);
  return { ...files, ...built.files };
}

export const mdBlog = {
  id: "md-blog",
  name: "Markdown blog",
  description: "A blog written in Markdown files. Posts become pages with layouts; the index lists them by date.",
  category: "Content",
  accent: "#b45309",
  framework: true,
  libs: [],
  files: make(blogFiles),
};

export const mdDocs = {
  id: "md-docs",
  name: "Markdown docs site",
  description: "Documentation from Markdown with a sidebar and a table of contents for every page.",
  category: "Content",
  accent: "#0f766e",
  framework: true,
  libs: [],
  files: make(docsFiles),
};
