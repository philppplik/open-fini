# Markdown and LaTeX

The Code studio opens Markdown and LaTeX files as one-file projects (or inside a folder) with an editor, a formatting toolbar and a live document preview, and exports the result as an HTML page or a printable PDF. The LaTeX preview is a subset converter, not a TeX engine. This page lists what is understood and what is not.

## Opening files

Open `.md`, `.markdown`, `.mdx`, `.tex`, `.latex`, `.bib`, `.sty` or `.cls` files with *File ▸ Open*, drag and drop, or *Open Folder*. A single file opens with the sidebar closed (editor and preview only); a folder keeps its structure and opens the README, `index.md` or `main.tex` first. *Save this file…* in the preview bar writes the text back out. Other text formats (`.txt`, `.json`, `.yaml`, `.xml`, `.csv`, `.toml`, `.ini`, `.ts`, `.tsx`, `.jsx` and more) open as one-file projects with syntax highlighting; files containing NUL bytes are refused as binary.

## Markdown

| Area | Support |
| --- | --- |
| Syntax | CommonMark with GitHub-style tables, task lists, strikethrough, autolinks, footnotes, front matter (shown as a table), `{#custom-id}` heading ids |
| Code | Fenced blocks with simple highlighting (JavaScript, TypeScript, JSON, CSS, HTML, shell, Python, YAML, TOML, SQL, diff, Go, Rust, C family, TeX) |
| Math | `$...$` and `$$...$$` through KaTeX, loaded only when a document has formulas |
| MDX | Lightweight: imports and exports are ignored, components shown as placeholders, JSX never executed |
| Toolbar | Bold, italic, strikethrough, code, headings, quote, lists, tasks, link, image, table, code block, rule, footnote, math |

Safety: preview HTML is sanitized with an allowlist (no scripts, styles, frames, forms, event handlers, ids or classes; only `http(s)`, `mailto`, `tel`, relative and `data:image` URLs). Remote images are skipped in offline mode.

Export: *Export as HTML page* adds a standalone page to the project (math pre-rendered; the KaTeX stylesheet loads from jsDelivr), *Download* saves it, and *Print or save as PDF* uses the system print dialog with print styles.

Known limits: no Mermaid or diagrams, no emoji shortcodes, no definition lists, about 70 HTML entity names.

## Markdown-driven sites

Projects with `content/**/*.md` and `layouts/*.tmpl` are turned into HTML automatically when a Markdown file, layout or `site.json` changes (or with *Build Pages from Markdown*). Front matter keys: `title`, `description`, `date`, `layout`, `order`, `nav`, `slug`, `draft`, `hidden`.

```html
<!-- layouts/post.tmpl -->
<article>
  <h1>{{title}}</h1>
  {{{content}}}
</article>
{{#each posts}}<p>{{title}}</p>{{/each}}
```

Layouts can also use `{{#if date}}...{{/if}}`, `{{nav}}`, `{{toc}}`, `{{root}}` and `{{site.title}}`.

Links to `.md` files become `.html` links. Generated files carry a marker comment and hand-written files with the same name are never overwritten. The exported site leaves out `content/`, `layouts/` and `site.json`.

## LaTeX

Highlighting uses CodeMirror's `stex` mode. **The preview is not a TeX engine.** It converts a practical subset to HTML and does not reproduce page layout, fonts, hyphenation, page numbers, float placement or most packages.

- **Understood:** title block, abstract, sectioning (numbered like LaTeX, starred variants, `\appendix`), text styles and sizes, accents, `itemize`, `enumerate`, `description`, `quote`, `verse`, `center`, `tabular` (`\hline`, `\multicolumn`), `figure` and `table` with `\caption`, `\includegraphics` of project images, labels and references, `\cite` with `.bib` files or `thebibliography`, footnotes, `\newcommand`, `\def`, `\newenvironment`, `\newtheorem`, `proof`, `verbatim`, `lstlisting`, `\input`, `\include`, `\tableofcontents`, `\url`, `\href`.
- **Math:** typeset with KaTeX (vendored). It supports most of the amsmath core but not everything; a rejected formula is shown as source with the reason.
- **Honest degradation:** unknown commands appear as highlighted markers, are listed under "notes about this preview" with line numbers, and undefined references show `??`.
- **Export:** the same HTML export, download and print buttons; the output is a browser rendering, not a PDF typeset by LaTeX.

## Vibe

`render_markdown`, `convert_latex_preview` and `create_markdown_document` ([[Vibe Tools Reference]]).

## See also

- [[Code Studio]]
- [[Frameworks and Libraries]]
- [[File Formats]]
- [[Export and Publish]]
