import test from "node:test";
import assert from "node:assert/strict";
import { planLine, createHistory, stripAnsi, displayPath } from "../../app/src/ui/code/terminal-model.js";

const root = "C:/work/site";
const policy = { enabled: false }; // the assistant's switch is off: the person's own console still works
const plan = (text, cwd = root) => planLine(text, { cwd, root, policy });

test("a line becomes one program with arguments in the current folder", () => {
  assert.deepEqual(plan("npm test"), { kind: "run", argv: ["npm", "test"], cwd: root });
  assert.deepEqual(plan('git commit -m "first page"', `${root}/src`), { kind: "run", argv: ["git", "commit", "-m", "first page"], cwd: `${root}/src` });
  assert.deepEqual(plan("   "), { kind: "none" });
});

test("shell syntax, shells and denied programs are refused", () => {
  assert.equal(plan("npm test | tee log").code, "parse");
  assert.equal(plan("echo $HOME").code, "parse");
  assert.equal(plan('git commit -m "open').code, "parse");
  for (const line of ["bash -c ls", "powershell -Command dir", "cmd /c dir", "rm -rf /", "curl https://example.com", "C:/tools/node.exe x.js"]) {
    const p = plan(line);
    assert.equal(p.kind, "error", line);
    assert.equal(p.code, "policy", line);
  }
  assert.equal(plan("git push --force").code, "policy");
  assert.equal(plan("notonthelist").code, "policy");
  // the user's own lists apply
  assert.equal(planLine("ruby x.rb", { cwd: root, root, policy: { allow: ["ruby"] } }).kind, "run");
  assert.equal(planLine("npm test", { cwd: root, root, policy: { deny: ["npm"] } }).code, "policy");
});

test("cd stays inside the project folder", () => {
  assert.deepEqual(plan("cd src"), { kind: "cd", cwd: `${root}/src` });
  assert.deepEqual(plan("cd ..", `${root}/src`), { kind: "cd", cwd: root });
  assert.deepEqual(plan("cd", `${root}/src`), { kind: "cd", cwd: root });
  assert.deepEqual(plan("cd ~/docs", `${root}/src`), { kind: "cd", cwd: `${root}/docs` });
  assert.equal(plan("cd ..").code, "cd-outside");
  assert.equal(plan("cd C:/Windows").code, "cd-outside");
  assert.equal(plan("cd ../../other", `${root}/src`).code, "cd-outside");
  assert.equal(plan("cd a b").code, "cd-args");
  // a stale current folder outside the project falls back to the project folder
  assert.equal(plan("npm test", "C:/elsewhere").cwd, root);
});

test("built-in commands", () => {
  assert.equal(plan("clear").kind, "clear");
  assert.equal(plan("cls").kind, "clear");
  assert.equal(plan("pwd").kind, "pwd");
  assert.equal(plan("help").kind, "help");
  assert.equal(plan("history").kind, "history");
});

test("history recalls lines like a shell", () => {
  const h = createHistory(3);
  assert.equal(h.prev(), null);
  h.push("a");
  h.push("b");
  h.push("b");
  h.push("  ");
  assert.deepEqual(h.list(), ["a", "b"]);
  assert.equal(h.prev(), "b");
  assert.equal(h.prev(), "a");
  assert.equal(h.prev(), "a");
  assert.equal(h.next(), "b");
  assert.equal(h.next(), "");
  h.push("c");
  h.push("d");
  assert.deepEqual(h.list(), ["b", "c", "d"]);
});

test("stripAnsi removes colors and cursor sequences", () => {
  assert.equal(stripAnsi("\x1b[32m✔ ok\x1b[39m done\x1b[2K\x1b[1G"), "✔ ok done");
  assert.equal(stripAnsi("\x1b]0;title\x07text"), "text");
  assert.equal(stripAnsi("plain"), "plain");
});

test("displayPath is relative to the project folder", () => {
  assert.equal(displayPath(root, root), "~");
  assert.equal(displayPath(`${root}/src/js`, root), "~/src/js");
  assert.equal(displayPath("c:\\work\\site\\src", "C:\\work\\site"), "~/src");
  assert.equal(displayPath("C:/work/sitex", root), "C:/work/sitex");
  assert.equal(displayPath("/home/a/site", "/home/a/site/"), "~");
});
