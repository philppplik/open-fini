# LaTeX in the Code studio

LaTeX is a way to write documents as plain text with commands such as `\section{Introduction}` or `$E = mc^2$`.
A program called a *TeX engine* turns the text into a finished PDF. It is popular for scientific papers, theses and
slides (Beamer) because it typesets math and references very well.

## What OpenFini does

| Feature | Where |
| --- | --- |
| Highlighting for `.tex`, `.sty`, `.cls`, `.bib` | editor (`stex` mode) |
| Completion: `\commands` (snippets), `\begin{…}` environments, `\ref{…}` labels, `\cite{…}` BibTeX keys, file names | `engine/web/latex-tools.js`, `ui/code/editor.js` |
| Outline of sections | Navigator side bar (`doctools.js`) |
| **Approximate preview** (sections, lists, tables, math with KaTeX, figures, citations) | right half of the split view; clearly labeled "Preview only" |
| **Compile to PDF** with a real engine, PDF shown with the bundled pdf.js, errors with clickable file:line | desktop app, `ui/code/latex-compile.js`, `src-tauri/src/latex.rs` |
| Export as PDF | View ▸ Export LaTeX as PDF…, or the PDF button in the preview bar |
| Vibe tools (group "LaTeX") and skills `write-paper`, `fix-latex-errors`, `make-beamer`, `bibtex-help` | `vibe/tools/latex.js`, `ai/skills-latex.js` |

## Compiling

The desktop app looks for `latexmk`, `pdflatex`, `xelatex`, `lualatex` or `tectonic` on the PATH (install TeX Live,
MiKTeX, MacTeX or Tectonic). Choose one in Settings ▸ Code studio ▸ LaTeX, or keep *Automatic* (latexmk first, so
BibTeX runs by itself). The project is copied to a fresh temporary folder, the engine runs there directly (no shell)
with a fixed argument list: `-interaction=nonstopmode -halt-on-error -file-line-error -no-shell-escape` (Tectonic:
`-X compile --untrusted`), `openout_any=p`/`openin_any=p`, a time limit (120 s) and the folder is deleted afterwards.
Errors and warnings from the log are listed above the PDF; clicking one opens the file at that line (no SyncTeX).

The web version cannot run programs. It explains this and offers an optional *remote compile service* setting: an
HTTPS URL that receives `POST {engine, main, files:[{path, data(base64)}]}` and answers with `application/pdf` or
JSON `{pdf, log}`. There is no default service; nothing is sent unless you enter one (offline mode blocks it).

## Limits

- The approximate preview is a converter for common documents, not TeX: page breaks, fonts and most packages differ.
- No SyncTeX: jumps go from log errors to lines, not from PDF positions to source.
- At most 60 PDF pages are rendered in the app; the exported PDF is complete.
