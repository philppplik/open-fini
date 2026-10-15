// Search pane: find (and replace) text across every text file of the project.
import { h, empty, debounce } from "../../core/util.js";
import { iconButton } from "../controls.js";
import { confirmDialog } from "../dialogs.js";
import { fileIcon, escapeRegExp, trimmedChange, offsetOf } from "./util.js";

const MAX_RESULTS = 2000;

export function createSearchPanel(ws) {
  const { web } = ws;
  const state = { query: "", replace: "", caseSensitive: false, regex: false, word: false, showReplace: false };
  const find = h("input.of-side__search", { type: "text", placeholder: "Search", spellcheck: false, "aria-label": "Search in files" });
  const repl = h("input.of-side__search.hidden", { type: "text", placeholder: "Replace", spellcheck: false, "aria-label": "Replace with" });
  const opt = (key, label, text) => {
    const b = h("button.of-searchopt", { type: "button", "data-tip": label, "aria-label": label, "aria-pressed": "false" }, text);
    b.addEventListener("click", () => {
      state[key] = !state[key];
      b.setAttribute("aria-pressed", String(state[key]));
      run();
    });
    return b;
  };
  const toggleRepl = iconButton({ icon: "chevron-right", label: "Toggle replace", onClick: (e, b) => {
    state.showReplace = !state.showReplace;
    repl.classList.toggle("hidden", !state.showReplace);
    replBtns.classList.toggle("hidden", !state.showReplace);
    b.querySelector("sl-icon")?.setAttribute("name", state.showReplace ? "chevron-down" : "chevron-right");
  } });
  const replBtns = h("div.of-row.hidden", h("button.of-btn", { type: "button", onclick: () => replaceAll() }, "Replace all"));
  const summary = h("div.of-side__foot");
  const results = h("div.of-results");
  const head = h("div.of-side__head", h("span.of-side__title", "Search"));
  const el = h(
    "div.of-side__pane.of-searchpane",
    head,
    h("div.of-searchform", h("div.of-searchrow", toggleRepl, find, opt("caseSensitive", "Match case", "Aa"), opt("word", "Whole word", "ab"), opt("regex", "Regular expression", ".*")), h("div.of-searchrow.of-searchrow--repl", h("span.of-searchspacer"), repl), replBtns),
    summary,
    results,
  );

  const rx = () => {
    if (!state.query) return null;
    let src = state.regex ? state.query : escapeRegExp(state.query);
    if (state.word) src = `\\b(?:${src})\\b`;
    try {
      return new RegExp(src, state.caseSensitive ? "g" : "gi");
    } catch {
      return null;
    }
  };

  let hits = []; // { path, line, col, from, to, text }
  function search() {
    const re = rx();
    hits = [];
    if (!re) return;
    outer: for (const path of web.paths) {
      const text = web.text(path);
      if (text == null) continue;
      re.lastIndex = 0;
      let m;
      let lineStarts = null;
      while ((m = re.exec(text))) {
        if (!m[0].length) {
          re.lastIndex++;
          continue;
        }
        lineStarts ||= computeLineStarts(text);
        const line = lineOf(lineStarts, m.index);
        const ls = lineStarts[line];
        const le = text.indexOf("\n", ls);
        hits.push({ path, line: line + 1, col: m.index - ls + 1, from: m.index, to: m.index + m[0].length, text: text.slice(ls, le < 0 ? text.length : le), start: m.index - ls });
        if (hits.length >= MAX_RESULTS) break outer;
      }
    }
  }

  function render() {
    empty(results);
    if (!state.query) {
      summary.textContent = "Type to search all files.";
      return;
    }
    if (!hits.length) {
      summary.textContent = rx() ? "No results." : "Invalid regular expression.";
      return;
    }
    const byFile = new Map();
    for (const hit of hits) (byFile.get(hit.path) || byFile.set(hit.path, []).get(hit.path)).push(hit);
    summary.textContent = `${hits.length}${hits.length >= MAX_RESULTS ? "+" : ""} result${hits.length === 1 ? "" : "s"} in ${byFile.size} file${byFile.size === 1 ? "" : "s"}`;
    for (const [path, list] of byFile) {
      const group = h("div.of-resultgroup");
      group.append(h("div.of-resultfile", fileIcon(path), h("span", path), h("span.of-badge", String(list.length))));
      for (const hit of list.slice(0, 200)) {
        const t = hit.text;
        const a = Math.max(0, hit.start - 24);
        const pre = (a > 0 ? "…" : "") + t.slice(a, hit.start).trimStart();
        const mid = t.slice(hit.start, hit.start + (hit.to - hit.from));
        const post = t.slice(hit.start + mid.length, hit.start + mid.length + 60);
        const row = h("button.of-resulthit", { type: "button", title: `${path}:${hit.line}` }, h("span.of-resulthit__ln", String(hit.line)), h("span.of-resulthit__text", pre, h("mark", mid), post));
        row.addEventListener("click", () => ws.openFile(path, { focus: true, from: hit.from, to: hit.to, keepPage: true }));
        group.append(row);
      }
      results.append(group);
    }
  }

  const run = debounce(() => {
    state.query = find.value;
    search();
    render();
  }, 200);
  find.addEventListener("input", run);
  find.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") run.flush();
  });
  repl.addEventListener("input", () => (state.replace = repl.value));
  repl.addEventListener("keydown", (e) => e.stopPropagation());
  web.on("text", () => state.query && run());
  web.on("tree", () => state.query && run());

  async function replaceAll() {
    const re = rx();
    if (!re || !hits.length) return;
    const files = new Set(hits.map((x) => x.path));
    const ok = await confirmDialog({ title: "Replace in files", message: `Replace ${hits.length} match${hits.length === 1 ? "" : "es"} in ${files.size} file${files.size === 1 ? "" : "s"} with “${state.replace}”?`, ok: "Replace all" });
    if (!ok) return;
    const replacement = state.regex ? state.replace : state.replace.replace(/\$/g, "$$$$");
    for (const path of files) {
      const old = web.text(path);
      re.lastIndex = 0;
      const next = old.replace(re, replacement);
      if (next !== old) ws.editors.applyChanges(path, [trimmedChange(old, next)], { userEvent: "input.replace" });
    }
    ws.app.toast("Replaced.", "success", 1500);
    run.flush();
  }

  render();
  return {
    el,
    focus() {
      const sel = ws.editors.selectedText();
      if (sel && !sel.includes("\n")) find.value = sel;
      requestAnimationFrame(() => {
        find.focus();
        find.select();
        run.flush();
      });
    },
    show() {},
  };
}

function computeLineStarts(text) {
  const out = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) out.push(i + 1);
  return out;
}
function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
export { offsetOf };
