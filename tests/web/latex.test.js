import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { convertLatex, parseBib, formatCitation, formatReference } from "../../app/src/engine/web/latex.js";
import { rng } from "./_helpers.js";

const doc = (body, pre = "") => `\\documentclass{article}\n${pre}\\begin{document}\n${body}\n\\end{document}`;
const conv = (body, pre, o) => convertLatex(doc(body, pre), { today: "January 1, 2026", ...o });
const html = (body, pre, o) => conv(body, pre, o).html;
const codes = (r) => r.diagnostics.map((d) => d.code);

test("paragraphs, escapes, dashes, quotes, accents", () => {
  assert.equal(html("One.\n\nTwo."), "<p>One.</p>\n<p>Two.</p>");
  assert.ok(html("50\\% \\& \\$5 \\# \\_ \\{x\\}").includes("50% &amp; $5 # _ {x}"));
  assert.ok(html("a--b---c").includes("a\u2013b\u2014c"));
  assert.ok(html("``quoted'' it's").includes("\u201cquoted\u201d it\u2019s"));
  assert.ok(html("\\'e \\\"o \\`a \\^o \\~n \\c{c} \\ss{} \\o{}").includes("\u00e9 \u00f6 \u00e0 \u00f4 \u00f1 \u00e7 \u00df \u00f8"));
  assert.ok(html("\\'{\\i}").includes("\u00ed"));
  assert.ok(html("\\LaTeX\\ and \\ldots").includes("LaTeX and \u2026"));
  assert.ok(html("a~b").includes("a\u00a0b"));
  assert.ok(html("a % comment\nb").includes("a b"));
  assert.ok(html("5\\% % not a comment\nx").includes("5%"));
  assert.ok(html("A\\\\B").includes("A<br>B"));
});

test("text styles and declarations", () => {
  const h = html("\\emph{a} \\textbf{b} \\textit{c} \\texttt{d} \\textsc{e} \\underline{f} {\\bf g} {\\it h} x\\textsuperscript{2}");
  for (const s of ["<em>a</em>", "<strong>b</strong>", "<em>c</em>", "<code>d</code>", '<span class="tex-sc">e</span>', "<u>f</u>", "<strong>g</strong>", "<em>h</em>", "<sup>2</sup>"]) assert.ok(h.includes(s), s);
  assert.ok(html("{\\large big} normal").includes('<span class="tex-large">big</span> normal'));
  assert.ok(html("\\verb|a<b|").includes("<code"));
  assert.ok(html("\\verb|a<b|").includes("a&lt;b"));
});

test("sections, numbering, starred, outline and appendix", () => {
  const r = conv("\\section{Intro}\\subsection{A}\\subsubsection{B}\\section*{Plain}\\section[Short]{Long Title}\\appendix\\section{Extra}");
  assert.deepEqual(r.outline.map((o) => [o.level, o.number, o.title]), [[2, "1", "Intro"], [3, "1.1", "A"], [4, "1.1.1", "B"], [2, "", "Plain"], [2, "2", "Long Title"], [2, "A", "Extra"]]);
  assert.ok(r.html.includes('<h2 id="sec-1"><span class="tex-secno">1</span> Intro</h2>'));
  assert.ok(r.html.includes("<h2 id=\"sec-plain\">Plain</h2>"));
  assert.ok(r.outline[0].line >= 3);
  const book = convertLatex("\\chapter{One}\\section{S}\\chapter{Two}\\section{T}");
  assert.deepEqual(book.outline.map((o) => o.number), ["1", "1.1", "2", "2.1"]);
  assert.ok(book.html.includes("tex-chapter"));
});

test("title block, abstract and table of contents", () => {
  const r = conv("\\maketitle\n\\begin{abstract}Short.\\end{abstract}\\tableofcontents\\section{One}", "\\title{My \\emph{Paper}}\\author{A \\and B}\\date{May 2026}\n");
  assert.equal(r.title, "My Paper");
  assert.equal(r.author, "A , B".replace(" ,", ","));
  assert.equal(r.date, "May 2026");
  assert.ok(r.html.includes('<h1 class="tex-title">My <em>Paper</em></h1>'));
  assert.ok(r.html.includes('class="tex-abstract"'));
  assert.ok(r.html.includes('class="tex-toc"') && r.html.includes('href="#sec-1"'));
  assert.ok(conv("\\maketitle", "\\title{T}\n").html.includes("January 1, 2026"));
});

test("lists: itemize, enumerate, description, nesting", () => {
  const h = html("\\begin{itemize}\\item One \\item Two\\begin{enumerate}\\item x\\item y\\end{enumerate}\\end{itemize}\\begin{description}\\item[Term] Def\\end{description}");
  assert.ok(h.includes('<ul class="tex-itemize"><li>One</li><li>Two'));
  assert.ok(h.includes('<ol class="tex-enumerate"'));
  assert.ok(h.includes("<dt>Term</dt><dd>Def</dd>"));
  assert.equal((h.match(/<li/g) || []).length, 4);
});

test("tabular with hline, multicolumn and alignment", () => {
  const h = html("\\begin{tabular}{|l|c|r|}\\hline A & B & C \\\\ \\hline \\multicolumn{2}{c}{wide} & 3 \\\\ \\hline\\end{tabular}");
  assert.ok(h.includes('<table class="tex-tabular">'));
  assert.ok(h.includes('class="tex-rule-top"'));
  assert.ok(h.includes('<td style="text-align:center">B</td>'));
  assert.ok(h.includes('<td style="text-align:right">C</td>'));
  assert.ok(h.includes('colspan="2"'));
  assert.equal((h.match(/<tr/g) || []).length, 2);
});

test("figures, captions, labels and references", () => {
  const r = conv("\\section{S}\\begin{figure}\\includegraphics[width=0.5\\textwidth]{pic}\\caption{A pic}\\label{fig:a}\\end{figure}\\begin{table}\\caption{T}\\label{tab:t}\\end{table}See Figure~\\ref{fig:a}, Table \\ref{tab:t}, Section \\ref{sec:s} and \\autoref{fig:a}.\\label{sec:s}", "", { resolveImage: (p) => (p === "pic.png" ? "blob:pic" : null) });
  assert.ok(r.html.includes('<img src="blob:pic"'));
  assert.ok(r.html.includes("width:50%"));
  assert.ok(r.html.includes("Figure 1:"));
  assert.ok(r.html.includes("Table 1:"));
  assert.equal(r.labels["fig:a"].number, "1");
  assert.equal(r.labels["fig:a"].kind, "figure");
  assert.equal(r.labels["tab:t"].kind, "table");
  assert.ok(r.html.includes('class="tex-ref" href="#figure-1">1</a>'));
  assert.ok(r.html.includes("Figure\u00a01"));
  assert.ok(!codes(r).includes("latex/undefined-reference"));
});

test("missing image and undefined references are diagnosed", () => {
  const r = conv("\\includegraphics{nope.png} \\ref{zzz}");
  assert.ok(r.html.includes("tex-missing-image"));
  assert.ok(r.html.includes("??"));
  assert.ok(codes(r).includes("latex/missing-image"));
  assert.ok(codes(r).includes("latex/undefined-reference"));
  assert.ok(r.diagnostics.every((d) => d.line >= 1));
});

test("equations: numbering, labels, eqref and math placeholders", () => {
  const r = conv("Inline $a<b$ and \\(c\\).\n\\begin{equation}E=mc^2\\label{eq:e}\\end{equation}\n\\[x\\]\\begin{align*}a&=b\\end{align*}\\begin{align}c&=d\\end{align}Eq.~\\eqref{eq:e}.");
  assert.equal(r.stats.math, 6);
  assert.ok(r.html.includes('data-tex="a&lt;b"'));
  assert.ok(r.html.includes('<span class="tex-eqno">(1)</span>'));
  assert.ok(r.html.includes('<span class="tex-eqno">(2)</span>'));
  assert.ok(r.html.includes("\\begin{aligned}a&amp;=b\\end{aligned}"));
  assert.ok(r.html.includes(">(1)</a>"));
  assert.equal(r.labels["eq:e"].kind, "equation");
  assert.ok(!r.html.includes("\\label"));
  assert.ok(r.html.includes('data-tex="E=mc^2"'));
});

test("macros: arguments, defaults, in math, recursion limit", () => {
  assert.ok(html("\\hello{World}", "\\newcommand{\\hello}[1]{Hi, \\textbf{#1}!}\n").includes("Hi, <strong>World</strong>!"));
  assert.ok(html("\\greet and \\greet[Bob]", "\\newcommand{\\greet}[1][Ann]{<#1>}\n").includes("&lt;Ann&gt;"));
  assert.ok(html("\\greet[Bob]", "\\newcommand{\\greet}[1][Ann]{<#1>}\n").includes("&lt;Bob&gt;"));
  assert.ok(html("$\\R^n$", "\\newcommand{\\R}{\\mathbb{R}}\n").includes('data-tex="{\\mathbb{R}}^n"'));
  assert.ok(html("\\foo", "\\def\\foo{bar}\n").includes("bar"));
  const t = Date.now();
  const r = conv("\\a", "\\newcommand{\\a}{\\a\\a}\n");
  assert.ok(Date.now() - t < 2000);
  assert.ok(r.diagnostics.length > 0);
});

test("theorems and proofs", () => {
  const h = html("\\begin{theorem}[Euler]Statement.\\end{theorem}\\begin{lemma}L.\\end{lemma}\\begin{definition}D.\\end{definition}\\begin{proof}Done.\\end{proof}", "\\newtheorem{theorem}{Theorem}[section]\\newtheorem{lemma}[theorem]{Lemma}\\newtheorem{definition}{Definition}\n");
  assert.ok(h.includes("Theorem 0.1 (Euler)."));
  assert.ok(h.includes("Lemma 0.2."));
  assert.ok(h.includes("tex-thm-plain"));
  assert.ok(h.includes("tex-thm-def"));
  assert.ok(h.includes("Definition 1."));
  assert.ok(h.includes('class="tex-proof"') && h.includes("tex-qed"));
  const s = html("\\section{A}\\begin{theorem}x\\end{theorem}\\section{B}\\begin{theorem}y\\end{theorem}", "\\newtheorem{theorem}{Theorem}[section]\n");
  assert.ok(s.includes("Theorem 1.1.") && s.includes("Theorem 2.1."));
});

test("verbatim keeps percent signs and escapes HTML", () => {
  const h = html("\\begin{verbatim}\n50% <b> \\textbf{x}\n\\end{verbatim}");
  assert.ok(h.includes("50% &lt;b&gt; \\textbf{x}"));
  assert.ok(html("\\begin{lstlisting}[language=python]\ndef f(): pass\n\\end{lstlisting}").includes("tok-keyword"));
});

test("footnotes", () => {
  const h = html("Text\\footnote{Note one.} more\\footnote{Two \\emph{x}.}");
  assert.ok(h.includes('<sup class="tex-fnref"><a id="fnref-1" href="#fn-1">1</a></sup>'));
  assert.ok(h.includes('<li id="fn-2">Two <em>x</em>.'));
  assert.ok(h.includes('class="tex-footnotes"'));
});

test("BibTeX parsing", () => {
  const es = parseBib(`% comment line\n@article{knuth84, author = {Donald E. Knuth}, title = {Literate {P}rogramming}, year = 1984,\n journal = "The Computer Journal"}\n@string{x = "y"}\n@Book(smith, author={M{\\"u}ller, Hans and Ann Lee and Bob Ray}, title={T}, year={2001})\n@misc{broken\n@comment{ignored}\n@inproceedings{k3, title = "A " # "B", year = {2020}}`);
  assert.deepEqual(es.map((e) => e.key), ["knuth84", "smith", "broken", "k3"]);
  const k = es.find((e) => e.key === "knuth84");
  assert.equal(k.fields.title, "Literate Programming");
  assert.equal(k.fields.year, "1984");
  assert.equal(k.fields.journal, "The Computer Journal");
  assert.equal(k.type, "article");
  const s = es.find((e) => e.key === "smith");
  assert.equal(s.fields.author.startsWith("M\u00fcller, Hans"), true);
  assert.equal(formatCitation(k), "Knuth (1984)");
  assert.equal(formatCitation(s), "M\u00fcller et al. (2001)");
  assert.ok(formatReference(k).startsWith("Donald E. Knuth. (1984). Literate Programming."));
  assert.deepEqual(parseBib("@@@ {{{ ))) @article{").length, 0);
  assert.equal(es.find((e) => e.key === "k3").fields.title, "A B");
});

test("citations and bibliography", () => {
  const bib = "@article{a, author={Ann Lee}, title={One}, year={2000}}\n@book{b, author={Bob Ray}, title={Two}, year={2001}}\n@misc{c, title={Three}, year={2002}}";
  const r = conv("As \\cite{b} and \\citep{a,b}; \\citet{a}. \\nocite{c}\n\\bibliographystyle{plain}\\bibliography{refs}", "", { readFile: (p) => (p === "refs.bib" ? bib : null) });
  assert.deepEqual(r.citations, ["b", "a"]);
  assert.ok(r.html.includes('class="tex-cite" href="#bib-b">1</a>'));
  assert.ok(r.html.includes("[<a class=\"tex-cite\" href=\"#bib-a\">2</a>, <a class=\"tex-cite\" href=\"#bib-b\">1</a>]"));
  assert.ok(r.html.includes("Lee (2000)"));
  assert.equal(r.bibliography.length, 3);
  assert.equal(r.bibliography[0].key, "b");
  assert.ok(r.html.includes('<li id="bib-b">'));
  const bad = conv("\\cite{missing}", "", { bib: bib });
  assert.ok(codes(bad).includes("latex/undefined-citation"));
  assert.ok(conv("\\cite{x}\\begin{thebibliography}{9}\\bibitem{x} Someone. \\emph{Book}.\\end{thebibliography}").html.includes('<li id="bib-x">Someone. <em>Book</em>.</li>'));
  assert.ok(codes(conv("\\bibliography{nofile}", "", { readFile: () => null })).includes("latex/missing-file"));
});

test("input and include with cycles and missing files", () => {
  const files = { "a.tex": "From A \\input{b}", "b.tex": "From B \\input{a}", "c.tex": "C text" };
  const r = conv("\\input{a}\\include{c}\\input{nope}", "", { readFile: (p) => files[p] ?? files[`${p}`] ?? null, maxInclude: 5 });
  assert.ok(r.html.includes("From A") && r.html.includes("From B") && r.html.includes("C text"));
  assert.ok(codes(r).includes("latex/include-depth"));
  assert.ok(codes(r).includes("latex/missing-file"));
});

test("unsupported commands and environments are marked, silent packages are not", () => {
  const r = conv("Before \\frobnicate{arg} after.\n\\begin{tikzpicture}draw\\end{tikzpicture}", "\\usepackage{geometry}\\usepackage{hyperref}\\geometry{margin=1in}\\setlength{\\parindent}{0pt}\n");
  assert.ok(r.html.includes('class="tex-unsupported"') && r.html.includes("\\frobnicate"));
  assert.ok(r.html.includes("arg"));
  assert.ok(r.html.includes('class="tex-unsupported-env" data-env="tikzpicture"'));
  assert.deepEqual(r.unsupported.sort(), ["frobnicate", "tikzpicture"]);
  assert.ok(r.diagnostics.some((d) => d.code === "latex/unsupported-command" && d.command === "frobnicate" && d.line >= 1));
  assert.ok(!r.html.includes("geometry") && !r.html.includes("parindent"));
  assert.equal(r.unsupported.includes("usepackage"), false);
});

test("structure problems produce diagnostics, not exceptions", () => {
  assert.ok(codes(convertLatex("\\begin{document}\\begin{itemize}\\item x")).includes("latex/unclosed-environment"));
  assert.ok(codes(convertLatex("\\begin{document}x")).includes("latex/missing-end-document"));
  assert.ok(codes(convertLatex("a { b")).includes("latex/unbalanced-braces"));
  assert.ok(codes(convertLatex("a } b")).includes("latex/unbalanced-braces"));
  assert.ok(codes(convertLatex("\\end{foo}")).includes("latex/unmatched-end"));
  assert.ok(codes(convertLatex("$x")).includes("latex/unclosed-math"));
  assert.doesNotThrow(() => convertLatex(null));
  assert.equal(convertLatex("").html, "");
});

test("links are restricted to safe schemes", () => {
  const h = html("\\url{https://example.com/a_b} \\href{mailto:a@b.c}{mail} \\href{javascript:alert(1)}{x} \\href{ftp://x}{f}");
  assert.ok(h.includes('<a href="https://example.com/a_b" rel="noopener noreferrer">'));
  assert.ok(h.includes('href="mailto:a@b.c"'));
  assert.ok(!h.includes("javascript:"));
  assert.ok(!h.includes('href="ftp'));
});

test("output is escaped: XSS attempts", () => {
  const r = conv("<script>alert(1)</script> \\textbf{<img src=x onerror=alert(1)>} $<script>$ \\section{\"><b>} \\includegraphics{x\" onerror=\"alert(1)} \\label{a\"b} \\ref{a\"b}", "", { resolveImage: () => "javascript:alert(1)" });
  assert.ok(!/<script/i.test(r.html));
  assert.ok(!/<img[^>]+onerror/i.test(r.html));
  assert.ok(!/<[^>]*\sonerror/.test(r.html));
  assert.ok(!/src="javascript:/i.test(r.html));
  const r2 = conv("\\includegraphics{a}", "", { resolveImage: () => 'data:image/png;base64,AAA"onerror="x' });
  assert.ok(!/onerror="x/.test(r2.html.replace(/&quot;/g, "")) || r2.html.includes("&quot;"));
  assert.ok(conv("$a\"b$").html.includes('data-tex="a&quot;b"'));
});

test("hostile input stays bounded and never throws", () => {
  const t = Date.now();
  convertLatex("{".repeat(300000));
  convertLatex("\\begin{a}".repeat(5000));
  convertLatex("\\textbf{".repeat(5000) + "x" + "}".repeat(5000));
  convertLatex("\\def\\a{\\a\\a}\\a");
  convertLatex("$".repeat(100001));
  assert.ok(Date.now() - t < 6000, `took ${Date.now() - t} ms`);
  const rand = rng(11);
  const pieces = ["\\", "{", "}", "$", "%", "&", "\\\\", "\\begin{itemize}", "\\end{itemize}", "\\item ", "\\section{", "\\ref{", "\\cite{", "\\newcommand{\\x}[1]{#1#1}", "\\x{a}", "\n\n", "\\begin{tabular}{ll}", "\\end{tabular}", "\\footnote{", "<", "\"", "\\href{", "\\verb|"];
  for (let k = 0; k < 300; k++) {
    let s = "";
    const n = 1 + Math.floor(rand() * 40);
    for (let i = 0; i < n; i++) s += pieces[Math.floor(rand() * pieces.length)] + (rand() < 0.3 ? "w" : "");
    const r = convertLatex(s);
    assert.ok(!/<script/i.test(r.html), s);
    assert.equal(typeof r.html, "string");
  }
});

test("the module is pure", () => {
  const src = readFileSync(new URL("../../app/src/engine/web/latex.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  for (const id of ["document.", "window.", "fetch(", "Blob(", "require(", "process.", "localStorage"]) assert.ok(!src.includes(id), id);
});

test("a realistic article converts end to end", () => {
  const src = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath}
\usepackage{graphicx}
\newcommand{\R}{\mathbb{R}}
\title{On Things}
\author{Ann Lee}
\begin{document}
\maketitle
\begin{abstract}We study things.\end{abstract}
\section{Introduction}\label{sec:intro}
Let $f:\R\to\R$ be smooth~\cite{lee00}. See Section~\ref{sec:intro}.
\begin{equation}\label{eq:main}\int_0^1 f(x)\,dx = 1\end{equation}
\begin{itemize}\item one\item two\end{itemize}
\bibliography{refs}
\end{document}`;
  const r = convertLatex(src, { bib: "@article{lee00, author={Ann Lee}, title={Things}, year={2000}}", today: "x" });
  assert.equal(r.title, "On Things");
  assert.equal(r.outline.length, 1);
  assert.equal(r.stats.math, 2);
  assert.ok(r.html.includes("[<a class=\"tex-cite\" href=\"#bib-lee00\">1</a>]"));
  assert.ok(r.html.includes('href="#sec-1">1</a>'));
  assert.equal(r.unsupported.length, 0);
  assert.equal(r.diagnostics.filter((d) => d.severity !== "info").length, 0, JSON.stringify(r.diagnostics));
});
