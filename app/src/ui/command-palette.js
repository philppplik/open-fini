// Global command palette (Ctrl/Cmd+K or F1): every registered command, fuzzy search, shortcuts, recent commands and
// studio-aware ranking. Lists the commands that can run right now. Ranking lives in command-search.js.
import { h, empty, prettyShortcut, uid as makeUid } from "../core/util.js";
import { rankCommands, pushRecent } from "./command-search.js";

/** Commands that need arguments from their caller and make no sense in a list. */
const NOT_LISTED = new Set(["file.openRecent", "file.placeFiles", "help.palette"]);

let open = null;

/** The commands the palette (and the Vibe `list_commands` tool) can offer right now. */
export function paletteEntries(app, { onlyEnabled = true } = {}) {
  const out = [];
  for (const c of app.commands.values()) {
    if (!c.label || NOT_LISTED.has(c.id) || c.palette === false) continue;
    if (c.studios && !c.studios.includes(app.studio)) continue;
    if (onlyEnabled && c.enabled && !c.enabled(app)) continue;
    out.push({ id: c.id, label: c.label, shortcut: c.shortcut, studios: c.studios, icon: c.icon });
  }
  return out;
}

export function openCommandPalette(app, initial = "") {
  if (open) {
    open.close();
    return;
  }
  const previous = document.activeElement;
  const uid = makeUid("of-cp");
  const input = h("input.of-palette__input", { type: "text", value: initial, spellcheck: false, autocomplete: "off", role: "combobox", "aria-expanded": "true", "aria-controls": `${uid}-list`, "aria-autocomplete": "list", "aria-label": "Search commands", placeholder: "Type a command…" });
  const list = h("div.of-palette__list", { role: "listbox", id: `${uid}-list`, "aria-label": "Commands" });
  const foot = h("div.of-palette__foot", h("span", h("kbd", "↑↓"), " navigate"), h("span", h("kbd", "Enter"), " run"), h("span", h("kbd", "Esc"), " close"));
  const box = h("div.of-palette__box", { role: "dialog", "aria-modal": "true", "aria-label": "Command palette" }, input, list, foot);
  const back = h("div.of-palette", box);
  const entries = paletteEntries(app);
  let items = [];
  let sel = 0;

  function paint() {
    empty(list);
    if (!items.length) list.append(h("div.of-empty", input.value ? "No matching command" : "Nothing to run right now"));
    let lastSection = null;
    items.forEach((it, i) => {
      const heading = input.value.trim() ? null : it.recent ? "Recent" : it.section;
      if (heading && heading !== lastSection) list.append(h("div.of-palette__section", { role: "presentation" }, heading));
      lastSection = heading;
      const ent = entries.find((e) => e.id === it.id);
      const icon = ent?.icon;
      const row = h("div.of-palette__item", { role: "option", id: `${uid}-${i}`, class: i === sel ? "active" : "", "aria-selected": String(i === sel) },
        icon ? h("sl-icon", { name: icon.includes(":") ? icon.split(":")[1] : icon, library: icon.startsWith("of:") ? "of" : undefined }) : h("span.of-palette__sp"),
        h("span.of-palette__label", it.label),
        input.value.trim() ? h("span.of-palette__tag", it.section) : null,
        it.shortcut ? h("span.of-palette__hint", prettyShortcut(it.shortcut)) : null);
      row.addEventListener("pointermove", () => sel !== i && setSel(i, false));
      row.addEventListener("click", () => choose(i));
      list.append(row);
    });
    input.setAttribute("aria-activedescendant", items.length ? `${uid}-${sel}` : "");
  }
  function setSel(i, scroll = true) {
    sel = (i + items.length) % Math.max(1, items.length);
    for (const [k, el] of [...list.querySelectorAll(".of-palette__item")].entries()) {
      el.classList.toggle("active", k === sel);
      el.setAttribute("aria-selected", String(k === sel));
      if (k === sel && scroll) el.scrollIntoView({ block: "nearest" });
    }
    input.setAttribute("aria-activedescendant", `${uid}-${sel}`);
  }
  function refresh() {
    items = rankCommands(entries, input.value, { studio: app.studio, recent: app.prefs.recentCommands || [] });
    sel = 0;
    paint();
  }
  function close() {
    open = null;
    back.remove();
    document.removeEventListener("keydown", onKey, true);
    if (previous?.isConnected && previous.focus) previous.focus();
  }
  function choose(i) {
    const it = items[i];
    if (!it) return;
    close();
    app.setPref("recentCommands", pushRecent(app.prefs.recentCommands || [], it.id));
    // let the palette disappear and focus return before the command (which may open a dialog) runs
    setTimeout(() => app.run(it.id), 0);
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel(sel + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel(sel - 1);
    } else if (e.key === "Home" && e.target !== input) setSel(0);
    else if (e.key === "End" && e.target !== input) setSel(items.length - 1);
    else if (e.key === "PageDown") setSel(Math.min(items.length - 1, sel + 8));
    else if (e.key === "PageUp") setSel(Math.max(0, sel - 8));
    else if (e.key === "Enter") {
      e.preventDefault();
      choose(sel);
    } else if (e.key === "Tab") {
      e.preventDefault(); // keep focus in the field: the list is driven from it
    }
  }
  input.addEventListener("input", refresh);
  document.addEventListener("keydown", onKey, true);
  back.addEventListener("pointerdown", (e) => e.target === back && close());
  document.body.append(back);
  open = { close };
  refresh();
  input.focus();
  input.select();
}
