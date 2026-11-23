// TextMate grammars as stream parsers (vscode/textmate.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileGrammar, tokenizeLine, tmStreamParser, styleOfScope, toJsRegex } from "../../app/src/vscode/textmate.js";

const TOY = {
  scopeName: "source.toy",
  name: "Toy",
  patterns: [{ include: "#comment" }, { include: "#string" }, { include: "#keyword" }, { include: "#heredoc" }, { include: "#block" }, { match: "\\b\\d+(\\.\\d+)?\\b", name: "constant.numeric.toy" }, { match: "\\b(fn)\\s+([A-Za-z_]\\w*)", captures: { 1: { name: "storage.type.function.toy" }, 2: { name: "entity.name.function.toy" } } }],
  repository: {
    comment: { patterns: [{ match: "#.*$", name: "comment.line.number-sign.toy" }, { begin: "/\\*", end: "\\*/", name: "comment.block.toy" }] },
    string: { begin: "\"", end: "\"", name: "string.quoted.double.toy", patterns: [{ match: "\\\\.", name: "constant.character.escape.toy" }] },
    keyword: { match: "\\b(if|else|return)\\b", name: "keyword.control.toy" },
    heredoc: { begin: "<<(\\w+)", end: "^\\1$", name: "string.unquoted.heredoc.toy" },
    block: { begin: "\\{", end: "\\}", name: "meta.block.toy", patterns: [{ include: "$self" }] },
  },
};

const styles = (g, line, stack) => {
  const r = tokenizeLine(g, line, stack);
  return { list: r.tokens.map((t) => [line.slice(t.from, t.to), styleOfScope(t.scope)]), stack: r.stack };
};

describe("TextMate grammars", () => {
  const g = compileGrammar(TOY);

  it("tokenizes match rules, captures, begin/end, repository includes and $self", () => {
    const r = styles(g, 'fn main { return "a\\"b" # done }');
    assert.deepEqual(r.list.filter(([, s]) => s), [
      ["fn", "keyword"],
      ["main", "variableName.function"],
      ["return", "keyword"],
      ['"', "string"],
      ["a", "string"],
      ['\\"', "escape"],
      ["b", "string"],
      ['"', "string"],
      ["# done }", "comment"],
    ]);
    assert.equal(r.stack.length, 1, "the block stays open (its } is inside the comment)");
  });

  it("carries multi-line constructs and back-references across lines", () => {
    let r = styles(g, "x = 1 /* open");
    assert.deepEqual(r.list.filter(([, s]) => s), [["1", "number"], ["/*", "comment"], [" open", "comment"]]);
    r = styles(g, "still */ 42", r.stack);
    assert.deepEqual(r.list.filter(([, s]) => s), [["still ", "comment"], ["*/", "comment"], ["42", "number"]]);
    let h = styles(g, "cat <<EOT");
    h = styles(g, "EOTX if", h.stack);
    assert.equal(h.list[0][1], "string", "a different word does not end the heredoc");
    h = styles(g, "EOT", h.stack);
    assert.equal(h.stack.length, 0);
  });

  it("works as a CodeMirror stream parser", () => {
    const p = tmStreamParser(g);
    const state = p.startState();
    const line = "if 3";
    const stream = { string: line, pos: 0, sol() { return this.pos === 0; }, skipToEnd() { this.pos = line.length; } };
    const out = [];
    while (stream.pos < line.length) {
      const start = stream.pos;
      const s = p.token(stream, state);
      out.push([line.slice(start, stream.pos), s]);
    }
    assert.deepEqual(out, [["if", "keyword"], [" ", null], ["3", "number"]]);
  });

  it("translates Oniguruma syntax and skips what JavaScript cannot express", () => {
    assert.deepEqual(toJsRegex("(?i)\\h+"), { source: "[0-9A-Fa-f]+", flags: "i" });
    assert.equal(toJsRegex("[[:alpha:]]++(?>x)").source, "[a-zA-Z]+(?:x)");
    assert.equal(toJsRegex("a(?(1)b|c)"), null);
    const g2 = compileGrammar({ scopeName: "x", patterns: [{ match: "a(?(1)b|c)", name: "keyword" }, { match: "z", name: "keyword.x" }] });
    assert.deepEqual(tokenizeLine(g2, "az", []).tokens.map((t) => styleOfScope(t.scope)), [null, "keyword"]);
    assert.equal(compileGrammar({}), null);
    assert.equal(compileGrammar({ patterns: [] }), null);
  });

  it("never loops on empty matches and caps long lines", () => {
    const g3 = compileGrammar({ scopeName: "x", patterns: [{ match: "(?=a)", name: "keyword" }, { begin: "(?=b)", end: "(?=b)", name: "string" }] });
    const r = tokenizeLine(g3, "aaabbb".repeat(10), []);
    assert.ok(r.tokens.length > 0);
    const long = tokenizeLine(g, "1 ".repeat(5000), []);
    assert.equal(long.tokens.at(-1).to, 10000);
  });

  it("includes other grammars through lookup", () => {
    const inner = compileGrammar({ scopeName: "source.inner", patterns: [{ match: "inner", name: "keyword.inner" }] });
    const outer = compileGrammar({ scopeName: "source.outer", patterns: [{ include: "source.inner" }] }, { lookup: (s) => (s === "source.inner" ? inner : null) });
    assert.equal(styleOfScope(tokenizeLine(outer, "inner", []).tokens[0].scope), "keyword");
  });
});
