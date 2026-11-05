import test from "node:test";
import assert from "node:assert/strict";
import { latexLabels, bibKeys, latexCompletionContext, parseLatexLog, engineArgs, safeMainFile, tableSnippet, figureSnippet, bibliographySnippet, findMainTex } from "../../app/src/engine/web/latex-tools.js";

test("labels and bibliography keys", () => {
  assert.deepEqual(latexLabels("\\label{sec:a} x \\label{ fig:b }", "\\label{sec:a}"), ["sec:a", "fig:b"]);
  const keys = bibKeys(["@article{knuth84, title={Literate Programming}, author={Knuth}}"], ["\\bibitem{lamport94} L."]);
  assert.deepEqual(keys.map((k) => k.key), ["knuth84", "lamport94"]);
  assert.equal(keys[0].title, "Literate Programming");
});

test("completion context", () => {
  assert.deepEqual(latexCompletionContext("see \\ref{sec:"), { kind: "ref", prefix: "sec:" });
  assert.deepEqual(latexCompletionContext("\\eqref{"), { kind: "ref", prefix: "" });
  assert.deepEqual(latexCompletionContext("\\cite{a, kn"), { kind: "cite", prefix: "kn" });
  assert.deepEqual(latexCompletionContext("\\citep[p.~3]{kn"), { kind: "cite", prefix: "kn" });
  assert.deepEqual(latexCompletionContext("\\begin{ite"), { kind: "env", prefix: "ite" });
  assert.deepEqual(latexCompletionContext("\\includegraphics[width=3cm]{im"), { kind: "file", prefix: "im" });
  assert.deepEqual(latexCompletionContext("text \\sec"), { kind: "command", prefix: "sec" });
  assert.equal(latexCompletionContext("plain text"), null);
});

test("compile log parsing", () => {
  const log = [
    "This is pdfTeX, Version 3.141592653",
    "(./main.tex",
    "LaTeX2e <2023-11-01>",
    "(./chapters/intro.tex",
    "./chapters/intro.tex:7: Undefined control sequence.",
    "l.7 \\foo",
    ")",
    "LaTeX Warning: Reference `sec:x' on page 1 undefined on input line 12.",
    "Package natbib Warning: Citation `knuth' on page 1 undefined on input line 14.",
    "Overfull \\hbox (3.0pt too wide) in paragraph at lines 20--22",
    "! Missing $ inserted.",
    "<inserted text>",
    "l.30 a_b",
  ].join("\n");
  const p = parseLatexLog(log);
  assert.deepEqual(p[0], { severity: "error", file: "chapters/intro.tex", line: 7, message: "Undefined control sequence." });
  assert.equal(p[1].severity, "warning");
  assert.equal(p[1].line, 12);
  assert.ok(p[2].message.includes("knuth"));
  assert.equal(p[3].line, 20);
  assert.deepEqual(p[4], { severity: "error", file: "chapters/intro.tex", line: 30, message: "Missing $ inserted." });
});

test("engine arguments are allow-listed and never enable shell escape", () => {
  assert.deepEqual(engineArgs("pdflatex", "main.tex"), ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "main.tex"]);
  assert.equal(engineArgs("latexmk", "a/b.tex")[0], "-pdf");
  assert.ok(engineArgs("tectonic", "main.tex").includes("--untrusted"));
  assert.throws(() => engineArgs("bash", "main.tex"));
  for (const bad of ["-shell-escape.tex", "../x.tex", "/etc/x.tex", "a;rm -rf.tex", "main.txt", "a/../../b.tex", "x$(y).tex"]) {
    assert.equal(safeMainFile(bad), false, bad);
    assert.throws(() => engineArgs("pdflatex", bad));
  }
});

test("snippets and main file", () => {
  const t = tableSnippet({ rows: 3, cols: 2, header: ["A", "B"] });
  assert.ok(t.includes("\\begin{tabular}{ll}") && t.includes("A & B \\\\"));
  assert.ok(figureSnippet({ file: "x.png" }).includes("\\includegraphics[width=0.8\\linewidth]{x.png}"));
  assert.equal(bibliographySnippet({ file: "refs.bib" }), "\\bibliographystyle{plain}\n\\bibliography{refs}\n");
  const texts = { "a.tex": "\\section{x}", "paper/main.tex": "\\documentclass{article}", "z.tex": "\\documentclass{article}" };
  assert.equal(findMainTex(Object.keys(texts), (p) => texts[p]), "paper/main.tex");
});
