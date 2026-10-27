// The Vibe composer's mention system: a caret-anchored autocomplete for "@" (files, documents, layers, @selection,
// attachments, room members), "/" (skills with a parameter form, built-in commands, recent prompts) and "!" (tools),
// plus the chip strip that holds the chosen targets. Pure parts live in mentions.js (tested).
//
// Accessibility: the textarea is an ARIA combobox (aria-expanded, aria-controls, aria-activedescendant) and the popover
// a listbox with grouped options; a polite live region announces the number of results. IME: no trigger while a
// composition is active (compositionstart/end). Chips are atomic: Backspace at the start of an empty selection removes
// the last chip; each chip has its own remove button.
//
// Public API: createMentions({ vs, input, onChange, commands }) →
//   { popover, chipsEl, chips, update(), handleKey(e) → handled, close(), add(chip), clear(), compose(text) → string,
//     isOpen(), recentPrompts(), rememberPrompt(text) }
import { h, empty } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { iconEl } from "../toolbox.js";
import { detectTrigger, rankItems, groupResults, highlightParts, composeMessage, chipLabel } from "./mentions.js";
import { localBounds, worldMatrix } from "../../core/nodes.js";
import { rectTransform } from "../../core/math.js";
import { layerIcon } from "./layer-icons.js";

const GROUPS = {
  selection: { label: "Selection", icon: "cursor" },
  layers: { label: "Layers", icon: "layers" },
  files: { label: "Project files", icon: "folder2-open" },
  documents: { label: "Open documents", icon: "files" },
  attachments: { label: "Attachments", icon: "paperclip" },
  members: { label: "Room members", icon: "people" },
  commands: { label: "Commands", icon: "terminal" },
  skills: { label: "Skills", icon: "mortarboard" },
  recent: { label: "Recent prompts", icon: "clock-history" },
  tools: { label: "Tools", icon: "tools" },
};
const ORDER = { "@": ["selection", "layers", "files", "documents", "attachments", "members"], "/": ["commands", "skills", "recent"], "!": ["tools"] };
const RECENT_KEY = "of-vibe-recent-prompts";
const LAYER_DRAG = "application/x-openfini-layer";
let uidn = 0;

const safeGet = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "null");
  } catch {
    return null;
  }
};
const safeSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: recents are a convenience */
  }
};

/** Layer bounds in page space (rounded later by the block builder). */
export function layerBounds(n) {
  try {
    const b = localBounds(n);
    return b ? rectTransform(b, worldMatrix(n)) : null;
  } catch {
    return null;
  }
}
export const layerChip = (n) => ({ kind: "layer", id: n.id, name: n.name || "", type: n.type, page: n._page?.name, node: n });

// ---- caret position inside a textarea (mirror element technique)
const MIRROR_PROPS = ["boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "textTransform", "wordSpacing", "tabSize"];
function caretRect(ta, pos) {
  const cs = getComputedStyle(ta);
  const m = document.createElement("div");
  for (const p of MIRROR_PROPS) m.style[p] = cs[p];
  Object.assign(m.style, { position: "fixed", visibility: "hidden", whiteSpace: "pre-wrap", wordWrap: "break-word", overflow: "hidden", top: "0", left: "-9999px" });
  m.textContent = ta.value.slice(0, pos);
  const mark = document.createElement("span");
  mark.textContent = "​";
  m.append(mark);
  document.body.append(m);
  const r = ta.getBoundingClientRect();
  const x = r.left + mark.offsetLeft - ta.scrollLeft;
  const y = r.top + mark.offsetTop - ta.scrollTop;
  const lh = parseFloat(cs.lineHeight) || 18;
  m.remove();
  return { x: Math.min(Math.max(r.left, x), r.right), y: Math.min(Math.max(r.top, y), r.bottom - lh), h: lh };
}

export function createMentions({ vs, input, onChange, commands }) {
  const { app } = vs;
  const listId = `of-mention-list-${++uidn}`;
  const popover = h("div.of-mention.hidden", { id: listId, role: "listbox", "aria-label": t("Suggestions") });
  const live = h("div.of-sr-only", { role: "status", "aria-live": "polite" });
  const chipsEl = h("div.of-mchips", { role: "list", "aria-label": t("Targets for this message") });
  const chips = [];
  let state = null; // { trigger, query, start, end }
  let results = []; // flat [{ item, ranges }]
  let sel = 0;
  let composing = false;
  let toolCache = null;
  let toolCacheAt = 0;

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listId);
  input.addEventListener("compositionstart", () => {
    composing = true;
    close();
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    update();
  });
  input.addEventListener("blur", () => setTimeout(() => !popover.contains(document.activeElement) && close(), 120));
  input.addEventListener("click", () => update());

  // ---- sources
  function atItems() {
    const out = [];
    const doc = app.doc;
    if (app.selection?.length) out.push({ g: "selection", label: "selection", sub: t("{n} selected layer(s)", { n: String(app.selection.length) }), icon: "cursor", chip: { kind: "selection" } });
    if (doc?.pages) {
      let n = 0;
      const pages = app.page ? [app.page, ...doc.pages.filter((p) => p !== app.page)] : doc.pages;
      outer: for (const p of pages) {
        const stack = [...(p.root.children || [])].reverse();
        while (stack.length) {
          const node = stack.pop();
          if (++n > 600) break outer;
          out.push({ g: "layers", label: node.name || node.type, sub: `${node.type}${p !== app.page ? ` · ${p.name}` : ""}`, icon: layerIcon(node.type), chip: layerChip(node) });
          for (const c of [...(node.children || [])].reverse()) stack.push(c);
        }
      }
    }
    const seen = new Set();
    for (const d of [doc, ...(app.docs || [])]) {
      if (!d?.web || seen.has(d)) continue;
      seen.add(d);
      for (const path of d.web.paths.slice(0, 2000)) out.push({ g: "files", label: path, sub: d === doc ? "" : d.name, icon: "file-earmark-code", chip: { kind: "file", path, docRef: d } });
    }
    for (const d of app.docs || []) out.push({ g: "documents", label: d.name, sub: d.web ? t("website") : d.office ? t("Office document") : t("{n} page(s)", { n: String(d.pages?.length || 0) }), icon: d.web ? "globe" : d.office ? "file-earmark-text" : "file-earmark-richtext", chip: { kind: "document", name: d.name, id: d.id, pages: d.pages?.length, studio: d.web ? "website" : d.office ? "office" : d.studio, docRef: d } });
    (vs.hub.active?.attachments || []).forEach((a, i) => out.push({ g: "attachments", label: a.name, sub: t("attachment {n}", { n: String(i + 1) }), icon: "paperclip", chip: { kind: "attachment", index: i + 1, name: a.name } }));
    for (const m of app.collab?.session?.members || []) if (m.profile?.nick) out.push({ g: "members", label: m.profile.nick, sub: m.presence?.docName || "", icon: "person", chip: { kind: "member", name: m.profile.nick } });
    return out;
  }
  async function slashItems() {
    const out = commands().map((c) => ({ g: c.skill ? "skills" : "commands", label: c.name, sub: c.hint, icon: c.skill ? "mortarboard" : "terminal", command: c }));
    for (const p of (safeGet(RECENT_KEY) || []).slice(0, 8)) out.push({ g: "recent", label: p.length > 70 ? `${p.slice(0, 70)}…` : p, sub: "", icon: "clock-history", prompt: p });
    return out;
  }
  async function toolItems() {
    if (!toolCache || Date.now() - toolCacheAt > 60000) {
      toolCache = (await vs.session.toolList().catch(() => [])).map((x) => ({ name: x.name, description: x.description || "", schema: x.inputSchema }));
      toolCacheAt = Date.now();
    }
    return toolCache.map((x) => {
      const req = x.schema?.required || [];
      const params = Object.keys(x.schema?.properties || {});
      const hint = params.length ? ` (${params.slice(0, 5).map((p) => (req.includes(p) ? p : `${p}?`)).join(", ")}${params.length > 5 ? ", …" : ""})` : "";
      return { g: "tools", label: x.name, sub: `${x.description.split(/(?<=\.)\s/)[0].slice(0, 110)}${hint}`, icon: "wrench", chip: { kind: "tool", name: x.name } };
    });
  }

  // ---- popover
  let seq = 0;
  async function update() {
    const st = detectTrigger(input.value, input.selectionStart ?? input.value.length, { composing });
    if (!st || input.selectionStart !== input.selectionEnd) return close();
    state = st;
    const my = ++seq;
    const items = st.trigger === "@" ? atItems() : st.trigger === "/" ? await slashItems() : await toolItems();
    if (my !== seq) return; // a newer keystroke won
    const ranked = rankItems(st.query, items, { text: (x) => x.label, limit: 60 });
    const groups = groupResults(ranked, (x) => x.g, ORDER[st.trigger], st.query);
    results = groups.flatMap((g) => g.items.slice(0, g.group === "files" || g.group === "layers" || g.group === "tools" ? 12 : 8).map((r) => ({ ...r, group: g.group })));
    sel = 0;
    paint();
  }
  function paint() {
    empty(popover);
    if (!state) return;
    if (!results.length) {
      popover.append(h("div.of-mention__none", state.trigger === "@" ? t("Nothing to mention matches “{q}”.", { q: state.query }) : state.trigger === "!" ? t("No tool matches “{q}”.", { q: state.query }) : t("No command or skill matches “{q}”.", { q: state.query })));
    }
    let last = null;
    results.forEach((r, i) => {
      if (r.group !== last) {
        last = r.group;
        popover.append(h("div.of-mention__group", { role: "presentation" }, iconEl(GROUPS[r.group].icon), t(GROUPS[r.group].label)));
      }
      const label = h("span.of-mention__label", ...highlightParts(r.item.label, r.ranges).map((p) => (p.hit ? h("mark", p.text) : p.text)));
      const opt = h("div.of-mention__opt", { role: "option", id: `${listId}-${i}`, "aria-selected": String(i === sel), class: i === sel ? "active" : "" }, iconEl(r.item.icon), h("span.of-mention__main", label, r.item.sub ? h("small", r.item.sub) : null));
      opt.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        pick(r.item);
      });
      opt.addEventListener("pointermove", () => {
        if (sel !== i) {
          sel = i;
          mark();
        }
      });
      popover.append(opt);
    });
    popover.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
    mark();
    live.textContent = results.length ? t("{n} suggestion(s). Use the arrow keys and Enter.", { n: String(results.length) }) : t("No suggestions.");
    position();
  }
  function mark() {
    popover.querySelectorAll(".of-mention__opt").forEach((o, i) => {
      o.classList.toggle("active", i === sel);
      o.setAttribute("aria-selected", String(i === sel));
    });
    const act = popover.querySelector(".of-mention__opt.active");
    input.setAttribute("aria-activedescendant", act?.id || "");
    act?.scrollIntoView({ block: "nearest" });
  }
  function position() {
    const c = caretRect(input, state.start);
    const w = Math.min(420, innerWidth - 16);
    popover.style.width = `${w}px`;
    popover.style.left = `${Math.max(8, Math.min(c.x - 12, innerWidth - w - 8))}px`;
    const below = innerHeight - (c.y + c.h);
    if (c.y > 260 || c.y > below) {
      popover.style.top = "";
      popover.style.bottom = `${innerHeight - c.y + 4}px`;
    } else {
      popover.style.bottom = "";
      popover.style.top = `${c.y + c.h + 4}px`;
    }
  }
  function close() {
    state = null;
    results = [];
    popover.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  const isOpen = () => !!state && !popover.classList.contains("hidden");

  function removeToken() {
    const { start, end } = state;
    const v = input.value;
    const after = v.slice(end).replace(/^ /, "");
    input.value = v.slice(0, start) + after;
    input.setSelectionRange(start, start);
  }
  async function pick(item) {
    if (!state) return;
    if (item.command) {
      removeToken();
      close();
      await item.command.run(input.value);
    } else if (item.prompt) {
      input.value = item.prompt;
      close();
    } else {
      removeToken();
      close();
      add(item.chip);
    }
    onChange?.();
    input.focus();
  }

  // ---- chips
  function add(chip) {
    if (!chip) return;
    const key = (c) => `${c.kind}:${c.id || c.path || c.name || ""}`;
    if (chips.some((c) => key(c) === key(chip))) return;
    chips.push(chip);
    paintChips();
    live.textContent = t("Added {name}.", { name: chipLabel(chip) });
    onChange?.();
  }
  function removeAt(i) {
    const [c] = chips.splice(i, 1);
    paintChips();
    if (c) live.textContent = t("Removed {name}.", { name: chipLabel(c) });
    onChange?.();
  }
  function paintChips() {
    empty(chipsEl);
    chipsEl.classList.toggle("hidden", !chips.length);
    chips.forEach((c, i) => {
      const icon = c.kind === "tool" ? "wrench" : c.kind === "skill" ? "mortarboard" : c.kind === "file" ? "file-earmark-code" : c.kind === "layer" ? layerIcon(c.type) : c.kind === "selection" ? "cursor" : c.kind === "member" ? "person" : c.kind === "attachment" ? "paperclip" : "files";
      const title = c.kind === "tool" ? t("Vibe must use the tool {name} for this message", { name: c.name }) : c.kind === "skill" ? t("Vibe follows the skill {name}", { name: c.name }) : t("Sent as a precise target with the message");
      chipsEl.append(h("span.of-mchip", { role: "listitem", class: `of-mchip--${c.kind}`, title }, iconEl(icon), h("span", chipLabel(c)), c.args && Object.keys(c.args).length ? h("small", Object.values(c.args).map(String).join(", ").slice(0, 30)) : null, h("button", { type: "button", "aria-label": t("Remove {name}", { name: chipLabel(c) }), onclick: () => { removeAt(i); input.focus(); } }, "×")));
    });
  }
  const clear = () => {
    chips.length = 0;
    paintChips();
  };

  // ---- keys (returns true when the key was handled here)
  function handleKey(e) {
    if (e.isComposing || composing) return false;
    if (isOpen()) {
      const n = results.length;
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) {
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
        mark();
        e.preventDefault();
        return true;
      }
      if ((e.key === "Enter" || e.key === "Tab") && n) {
        e.preventDefault();
        pick(results[sel].item);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return true;
      }
    }
    if (e.key === "Backspace" && chips.length && input.selectionStart === 0 && input.selectionEnd === 0) {
      e.preventDefault();
      removeAt(chips.length - 1);
      return true;
    }
    return false;
  }

  // ---- drag and drop of layers (Canvas outline) onto the composer
  function handleDrop(e) {
    const id = e.dataTransfer?.getData(LAYER_DRAG);
    if (!id) return false;
    const n = app.doc?.find(id);
    if (n) add(layerChip(n));
    return true;
  }

  /** The message text with the context section for the chips (file excerpts, layer bounds, tool lines). */
  function compose(text) {
    const resolved = chips.map((c) => {
      if (c.kind === "file") return { kind: "file", path: c.path, content: c.docRef?.web?.has(c.path) && c.docRef.web.isText(c.path) ? c.docRef.web.text(c.path) : null };
      if (c.kind === "layer") return { ...c, bounds: c.node ? layerBounds(c.node) : null, node: undefined };
      if (c.kind === "selection") return { kind: "selection", layers: (app.selection || []).map((n) => ({ ...layerChip(n), bounds: layerBounds(n), node: undefined })) };
      return c;
    });
    return composeMessage(text, resolved);
  }
  function rememberPrompt(text) {
    const s = String(text || "").trim();
    if (s.length < 4) return;
    const list = (safeGet(RECENT_KEY) || []).filter((x) => x !== s);
    list.unshift(s);
    safeSet(RECENT_KEY, list.slice(0, 30));
  }
  paintChips();
  return { popover, live, chipsEl, chips, update, handleKey, handleDrop, close, add, clear, compose, isOpen, rememberPrompt, recentPrompts: () => safeGet(RECENT_KEY) || [], LAYER_DRAG };
}
