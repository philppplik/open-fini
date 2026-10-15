// Command palette and quick open (Ctrl+Shift+P / Ctrl+P). Prefix the query with ">" for commands, "#" for page
// elements and ":" for a line number; no prefix searches files.
import { h, empty, prettyShortcut } from "../../core/util.js";
import { classList, getAttr } from "../../engine/web/index.js";
import { fileIcon, fuzzyScore, offsetOf } from "./util.js";

let open = null;

export function openCommandPalette(ws, initial = "") {
  open?.close();
  const app = ws.app;
  const input = h("input.of-palette__input", { type: "text", value: initial, spellcheck: false, autocomplete: "off", "aria-label": "Command palette", placeholder: "Search files by name (type > for commands, # for elements, : for a line)" });
  const list = h("div.of-palette__list", { role: "listbox" });
  const box = h("div.of-palette__box", { role: "dialog", "aria-label": "Command palette" }, input, list);
  const back = h("div.of-palette", box);
  let items = [];
  let sel = 0;

  function commandItems(q) {
    const out = [];
    for (const c of app.commands.values()) {
      if (!c.label || (c.studios && !c.studios.includes(app.studio))) continue;
      if (c.enabled && !c.enabled(app)) continue;
      const label = c.label;
      const score = fuzzyScore(q, label);
      if (score < 0) continue;
      out.push({ label, hint: c.shortcut ? prettyShortcut(c.shortcut) : "", icon: c.icon, score, run: () => app.run(c.id) });
    }
    return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 60);
  }
  function fileItems(q) {
    const open = new Set(ws.editors.open);
    const res = q ? ws.editors.searchFiles(q) : ws.web.paths.map((path) => ({ path, score: open.has(path) ? 1 : 0 })).sort((a, b) => b.score - a.score);
    return res.slice(0, 60).map((r) => ({ label: r.path.split("/").pop(), hint: r.path, file: r.path, run: () => ws.openFile(r.path, { focus: true }) }));
  }
  function elementItems(q) {
    const parsed = ws.model.html(ws.page);
    if (!parsed) return [];
    const out = [];
    for (const e of parsed.elements) {
      const cls = classList(e);
      const id = getAttr(e, "id");
      const text = (e.children.find((c) => c.type === "text" && c.text.trim())?.text || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const label = `${e.tag}${id ? `#${id}` : ""}${cls.length ? `.${cls.join(".")}` : ""}`;
      const score = fuzzyScore(q, `${label} ${text}`);
      if (score < 0) continue;
      out.push({ label, hint: text, icon: "code", score, run: () => ws.selectElement(e.id, { scroll: true }) });
      if (out.length > 200) break;
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 60);
  }

  function refresh() {
    const v = input.value;
    const mode = v[0] === ">" ? "cmd" : v[0] === "#" ? "el" : v[0] === ":" ? "line" : "file";
    const q = mode === "file" ? v.trim() : v.slice(1).trim();
    if (mode === "cmd") items = commandItems(q);
    else if (mode === "el") items = elementItems(q);
    else if (mode === "line") {
      const n = parseInt(q, 10);
      const path = ws.editors.active;
      items = path && n > 0 ? [{ label: `Go to line ${n} in ${path}`, icon: "arrow-return-right", run: () => ws.editors.select(offsetOf(ws.web.text(path) || "", n)) }] : [{ label: "Type a line number", icon: "123", run() {} }];
    } else items = fileItems(q);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    paint();
  }
  function paint() {
    empty(list);
    if (!items.length) list.append(h("div.of-empty", "No matches"));
    items.forEach((it, i) => {
      const row = h("div.of-palette__item", { role: "option", class: i === sel ? "active" : "", "aria-selected": String(i === sel) }, it.file ? fileIcon(it.file) : it.icon ? h("sl-icon", { name: it.icon.includes(":") ? it.icon.split(":")[1] : it.icon, library: it.icon.startsWith("of:") ? "of" : undefined }) : h("span.of-palette__sp"), h("span.of-palette__label", it.label), it.hint ? h("span.of-palette__hint", it.hint) : null);
      row.addEventListener("pointermove", () => {
        if (sel !== i) {
          sel = i;
          list.querySelector(".active")?.classList.remove("active");
          row.classList.add("active");
        }
      });
      row.addEventListener("click", () => choose(i));
      list.append(row);
    });
    list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }
  function choose(i) {
    const it = items[i];
    if (!it) return;
    close();
    setTimeout(() => it.run(), 0);
  }
  function close() {
    back.remove();
    document.removeEventListener("keydown", onKey, true);
    if (open?.close === close) open = null;
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
  input.addEventListener("input", () => {
    sel = 0;
    refresh();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      sel = Math.min(items.length - 1, sel + 1);
      paint();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      sel = Math.max(0, sel - 1);
      paint();
      e.preventDefault();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(sel);
    } else if (e.key === "Tab") e.preventDefault();
  });
  back.addEventListener("pointerdown", (e) => e.target === back && close());
  document.addEventListener("keydown", onKey, true);
  document.body.append(back);
  open = { close };
  refresh();
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}
