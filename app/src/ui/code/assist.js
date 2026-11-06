// Editor assistance of the Code studio, loaded once the editor exists (editor.js reconfigures its compartments when this
// module arrives and whenever a preference below changes):
//   * syntax color theme on the editor element (engine/web/syntax-themes.js)
//   * suggestions: the autocompletion switch and timing, words of the file, project names (classes, ids, colors) and
//     your own snippets (engine/web/snippets.js)
//   * hover popovers: a swatch and color picker on color values, a preview with Open for local file paths
//     (engine/web/code-hover.js), inline color swatches, Ctrl/Cmd+click on a path opens the file
// Preferences: codeSyntaxTheme, codeSyntaxCustom, codeSuggest, codeSuggestOnType, codeSuggestDelay, codeSuggestWords,
// codeSuggestProject, codeSnippets, codeHoverColors, codeHoverPaths, codeColorSwatches (core/app.js).
import * as CM from "../../../vendor/codemirror/codemirror.js";
import { h, formatBytes } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { languageOf, resolveRef } from "../../engine/web/index.js";
import { syntaxVars, syntaxTheme } from "../../engine/web/syntax-themes.js";
import { colorsInLine, colorAt, parseColor, formatColorLike, pathAt } from "../../engine/web/code-hover.js";
import { snippetsFor } from "../../engine/web/snippets.js";
import { ensureAssistStyles } from "./editor-settings.js";

/** Preferences that need the editor compartments rebuilt. */
export const ASSIST_PREFS = new Set(["codeSuggest", "codeSuggestOnType", "codeSuggestDelay", "codeSuggestWords", "codeSuggestProject", "codeSnippets", "codeHoverColors", "codeHoverPaths", "codeColorSwatches"]);

// ------------------------------------------------------------------ theme

const applied = new WeakMap();
/** Puts the syntax theme's custom properties on the editor element (and nothing else). */
export function applySyntaxTheme(el, prefs) {
  ensureAssistStyles();
  for (const k of applied.get(el) || []) el.style.removeProperty(k);
  const vars = syntaxVars(prefs.codeSyntaxTheme || "app", prefs.codeSyntaxCustom);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  applied.set(el, Object.keys(vars));
  const theme = syntaxTheme(prefs.codeSyntaxTheme);
  el.style.colorScheme = theme ? (theme.dark ? "dark" : "light") : "";
  // a chosen theme (or a custom background) also wins over translucent surface styles such as Glass
  el.classList.toggle("of-editor--themed", "--of-editor-bg" in vars);
}

// ------------------------------------------------------------------ suggestions

/** The autocompletion extension for the current preferences (none when suggestions are off). */
export function suggestConfig(prefs) {
  if (prefs.codeSuggest === false) return [];
  const delay = Math.max(0, Math.min(2000, Number(prefs.codeSuggestDelay) || 0));
  return CM.autocompletion({ activateOnTyping: prefs.codeSuggestOnType !== false, activateOnTypingDelay: delay, closeOnBlur: true, icons: true, maxRenderedOptions: 120 });
}

const WORD = /[A-Za-z_$][\w$-]*[\w$]/g;
const wordCache = new WeakMap(); // CodeMirror Text (immutable) -> words
function wordsOf(doc) {
  let list = wordCache.get(doc);
  if (list) return list;
  const set = new Set();
  const text = doc.length > 400000 ? doc.sliceString(0, 400000) : doc.toString();
  WORD.lastIndex = 0;
  for (let m; (m = WORD.exec(text)) && set.size < 3000; ) if (m[0].length >= 3 && m[0].length <= 60) set.add(m[0]);
  list = [...set];
  wordCache.set(doc, list);
  return list;
}

/** Words of the current file (VS Code's word-based suggestions), ranked below the language's own completions. */
function wordSource(prefs) {
  return (ctx) => {
    if (prefs.codeSuggestWords === false) return null;
    const w = ctx.matchBefore(/[A-Za-z_$][\w$-]*/);
    if (!w || (w.text.length < 2 && !ctx.explicit)) return null;
    const options = [];
    for (const word of wordsOf(ctx.state.doc)) if (word !== w.text && word.startsWith(w.text.slice(0, 1))) options.push({ label: word, type: "text", boost: -20 });
    return options.length ? { from: w.from, options, validFor: /^[\w$-]*$/ } : null;
  };
}

/** Classes, ids and colors used in the project (cached per project revision). */
function projectIndex(editors) {
  const web = editors.web;
  if (editors._assistIndex?.rev === web.rev) return editors._assistIndex;
  const ids = new Set();
  const classes = new Set(editors.model.classNames());
  const colors = new Map();
  for (const p of web.paths) {
    if (/\.html?$/i.test(p)) {
      const parsed = editors.model.html(p);
      for (const el of parsed?.elements || []) {
        for (const a of el.attrs || []) {
          if (a.name === "id" && a.value) ids.add(a.value);
          else if (a.name === "class" && a.value) for (const c of a.value.split(/\s+/)) if (c && !/[{}$<]/.test(c)) classes.add(c);
        }
      }
    } else if (/\.css$/i.test(p)) {
      const text = web.text(p) || "";
      for (const m of text.matchAll(/:[^;{}]*?(#[0-9a-fA-F]{3,8})\b/g)) colors.set(m[1].toLowerCase(), (colors.get(m[1].toLowerCase()) || 0) + 1);
    }
  }
  editors._assistIndex = { rev: web.rev, ids: [...ids].sort(), classes: [...classes].sort(), colors: [...colors].sort((a, b) => b[1] - a[1]).map(([c]) => c) };
  return editors._assistIndex;
}

const swatchInfo = (color) => () => h("span.of-cinfo", h("i", { style: { background: color } }), color);

/** Names from the whole project where code refers to them: selectors, ids, querySelector strings, colors. */
function projectSource(editors, path, prefs) {
  const lang = languageOf(path);
  return (ctx) => {
    if (prefs.codeSuggestProject === false) return null;
    const before = ctx.state.sliceDoc(Math.max(0, ctx.pos - 200), ctx.pos);
    const idx = () => projectIndex(editors);
    const list = (from, names, type, prefix = "") => ({ from, options: names.map((n) => ({ label: prefix + n, type, boost: 60 })) /* targeted contexts: rank first */, validFor: /^[\w#.-]*$/ });
    let m;
    if (lang === "css") {
      // a selector (after the last "}" and before any "{"): .class or #id from the project's pages
      const inSelector = before.lastIndexOf("}") >= before.lastIndexOf("{");
      if (inSelector && (m = /(?:^|[^\w-])([.#])([\w-]*)$/.exec(before))) return list(ctx.pos - m[2].length - 1, m[1] === "." ? idx().classes : idx().ids, m[1] === "." ? "class" : "constant", m[1]);
      // a color value: the colors this project already uses
      if ((m = /:\s*[^;{}]*?(#[0-9a-fA-F]{0,8})$/.exec(before)) && idx().colors.length) {
        return { from: ctx.pos - m[1].length, options: idx().colors.map((c) => ({ label: c, type: "constant", detail: t("used in this project"), info: swatchInfo(c), boost: 60 })), validFor: /^#[0-9a-fA-F]*$/ };
      }
    } else if (lang === "html") {
      if ((m = /\shref\s*=\s*["']#([\w-]*)$/i.exec(before))) return list(ctx.pos - m[1].length, idx().ids, "constant");
      if ((m = /\s(?:for|aria-labelledby|aria-describedby|aria-controls|list|form)\s*=\s*["']([\w-]*)$/i.exec(before))) return list(ctx.pos - m[1].length, idx().ids, "constant");
    } else if (lang === "javascript") {
      if ((m = /getElementById\(\s*["'`]([\w-]*)$/.exec(before))) return list(ctx.pos - m[1].length, idx().ids, "constant");
      if ((m = /classList\.(?:add|remove|toggle|contains|replace)\(\s*(?:["'`][\w-]*["'`]\s*,\s*)?["'`]([\w-]*)$/.exec(before))) return list(ctx.pos - m[1].length, idx().classes, "class");
      if ((m = /(?:querySelector(?:All)?|closest|matches)\(\s*["'`](?:[^"'`]*\s)?([.#])([\w-]*)$/.exec(before))) {
        return list(ctx.pos - m[2].length - 1, m[1] === "." ? idx().classes : idx().ids, m[1] === "." ? "class" : "constant", m[1]);
      }
    }
    return null;
  };
}

/** Your own snippets for this file's language. */
function snippetSource(path, prefs) {
  const lang = languageOf(path);
  return (ctx) => {
    const own = snippetsFor(prefs.codeSnippets, lang);
    if (!own.length) return null;
    const w = ctx.matchBefore(/[\w:.>@#!+-]+/);
    if (!w || (!w.text && !ctx.explicit)) return null;
    const options = own.map((s) => CM.snippetCompletion(s.body, { label: s.prefix, detail: s.description || t("Your snippet"), type: "keyword", boost: 3 }));
    return { from: w.from, options, validFor: /^[\w:.>@#!+-]*$/ };
  };
}

// ------------------------------------------------------------------ swatches

class SwatchWidget extends CM.WidgetType {
  constructor(color, from) {
    super();
    this.color = color;
    this.from = from;
  }
  eq(o) {
    return o.color === this.color && o.from === this.from;
  }
  toDOM() {
    return h("span.of-cswatch", { "data-from": String(this.from), title: t("Click to pick a color"), "aria-hidden": "true" }, h("i", { style: { background: this.color } }));
  }
  ignoreEvent() {
    return false;
  }
}

function namedOk(view, pos, lang) {
  if (lang === "css") return true;
  if (lang !== "html") return false;
  const line = view.state.doc.lineAt(pos);
  if (/\b(style|fill|stroke|color|bgcolor|stop-color)\s*=/i.test(line.text)) return true;
  const upto = view.state.sliceDoc(Math.max(0, pos - 20000), pos);
  return upto.lastIndexOf("<style") > upto.lastIndexOf("</style");
}

function swatchPlugin(lang) {
  const build = (view) => {
    const b = new CM.RangeSetBuilder();
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos);
        for (const c of colorsInLine(line.text, { named: namedOk(view, line.from, lang) })) {
          b.add(line.from + c.from, line.from + c.from, CM.Decoration.widget({ widget: new SwatchWidget(c.value, line.from + c.from), side: -1 }));
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
  };
  return CM.ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = build(view);
      }
      update(u) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ------------------------------------------------------------------ popovers

let pop = null; // { el, view, hideTimer, cleanup }
function hidePop() {
  if (!pop) return;
  clearTimeout(pop.hideTimer);
  pop.cleanup?.();
  pop.el.remove();
  pop = null;
}
function showPop(view, anchorPos, content, cleanup) {
  hidePop();
  const coords = view.coordsAtPos(anchorPos);
  if (!coords) return null;
  const el = h("div.of-codepop", { role: "dialog", "aria-label": t("Code preview") }, content);
  document.body.append(el);
  const r = el.getBoundingClientRect();
  const below = coords.bottom + 6 + r.height < window.innerHeight;
  el.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, coords.left))}px`;
  el.style.top = `${below ? coords.bottom + 6 : Math.max(8, coords.top - r.height - 6)}px`;
  pop = { el, view, hideTimer: 0, cleanup };
  el.addEventListener("pointerenter", () => clearTimeout(pop?.hideTimer));
  el.addEventListener("pointerleave", () => scheduleHide());
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hidePop();
      view.focus();
    }
  });
  return el;
}
function scheduleHide(ms = 300) {
  if (!pop) return;
  clearTimeout(pop.hideTimer);
  pop.hideTimer = setTimeout(() => {
    // keep the picker open while it is being used
    if (pop && !pop.el.matches(":hover") && !pop.el.contains(document.activeElement)) hidePop();
  }, ms);
}

/** Swatch, value, picker and format buttons for the color at [from, to). Picking rewrites the value in its notation. */
function colorPopover(view, from, value) {
  let range = { from, to: from + value.length };
  let current = value;
  const rgba = parseColor(value);
  if (!rgba) return;
  const swatch = h("i.of-codepop__swatch", { style: { background: value } });
  const label = h("code", value);
  const write = (next) => {
    if (next === current) return;
    // another edit may have moved the value: only write when it is still where we left it
    if (view.state.sliceDoc(range.from, range.to) !== current) return hidePop();
    view.dispatch({ changes: { from: range.from, to: range.to, insert: next }, userEvent: "input.color" });
    range = { from: range.from, to: range.from + next.length };
    current = next;
    swatch.style.background = next;
    label.textContent = next;
  };
  const picker = h("sl-color-picker", { inline: true, opacity: true, size: "small", label: t("Color"), value: formatColorLike("rgba(0, 0, 0, 1)", rgba) });
  picker.addEventListener("sl-input", () => {
    const c = parseColor(picker.getFormattedValue?.("rgba") || picker.value);
    if (c) write(formatColorLike(current, c));
  });
  const as = (sample, text) => h("sl-button", { size: "small", onclick: () => {
    const c = parseColor(current);
    if (c) write(formatColorLike(sample, c));
  } }, text);
  showPop(view, range.from, h("div.of-codepop__color", h("div.of-codepop__head", swatch, label), picker, h("div.of-codepop__row", h("span", t("Write as")), as("#000", "HEX"), as("rgb(0, 0, 0)", "RGB"), as("hsl(0, 0%, 0%)", "HSL"))));
}

/** Preview of a local file the code refers to, with Open (or Create when it does not exist yet). */
function pathPopover(editors, view, from, ref) {
  const fromFile = editors.active;
  const res = fromFile && resolveRef(fromFile, ref);
  if (!res?.path) return;
  const web = editors.web;
  const exists = web.has(res.path);
  if (!exists && !/^(\.{1,2}\/|\/)/.test(ref) && !/\.\w{1,8}$/.test(res.path)) return; // "react", "lodash/x": packages, not files
  let url = null;
  const body = h("div.of-codepop__file");
  const head = h("div.of-codepop__head", h("sl-icon", { name: exists ? "file-earmark" : "file-earmark-x" }), h("code", res.path));
  body.append(head);
  if (exists) {
    const f = web.get(res.path);
    const size = f.bytes ? f.bytes.length : (f.text || "").length;
    head.append(h("small", formatBytes(size)));
    if ((f.mime || "").startsWith("image/")) {
      url = URL.createObjectURL(new Blob([f.bytes || f.text || ""], { type: f.mime })); // SVG is a text file
      const img = h("img", { src: url, alt: "" });
      img.addEventListener("load", () => head.append(h("small", `${img.naturalWidth} × ${img.naturalHeight}`)));
      body.append(h("div.of-codepop__img", img));
    } else if (web.isText(res.path)) {
      const lines = (web.text(res.path) || "").split("\n");
      body.append(h("pre.of-codepop__text", lines.slice(0, 12).join("\n").slice(0, 1200) + (lines.length > 12 ? "\n…" : "")));
    }
    body.append(h("div.of-codepop__row", h("sl-button", { size: "small", variant: "primary", onclick: () => (hidePop(), editors.openFile(res.path, { focus: true })) }, t("Open")), h("small", t("or Ctrl+click the path"))));
  } else {
    body.append(h("p", t("This file does not exist in the project.")), h("div.of-codepop__row", h("sl-button", { size: "small", onclick: () => {
      hidePop();
      web.create(res.path);
      editors.openFile(res.path, { focus: true });
    } }, t("Create file"))));
  }
  showPop(view, from, body, () => url && URL.revokeObjectURL(url));
}

function hoverTarget(editors, path, view, pos, prefs) {
  const lang = languageOf(path);
  const line = view.state.doc.lineAt(pos);
  const col = pos - line.from;
  if (prefs.codeHoverColors !== false) {
    const c = colorAt(line.text, col, { named: namedOk(view, pos, lang) });
    if (c) return { kind: "color", from: line.from + c.from, value: c.value };
  }
  if (prefs.codeHoverPaths !== false) {
    const p = pathAt(line.text, col);
    if (p) return { kind: "path", from: line.from + p.from, ref: p.ref };
  }
  return null;
}

function hoverHandlers(editors, path, prefs) {
  let timer = 0;
  let last = "";
  return CM.EditorView.domEventHandlers({
    mousemove(e, view) {
      if (e.buttons) return false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
        const target = pos == null ? null : hoverTarget(editors, path, view, pos, prefs);
        const key = target ? `${target.kind}:${target.from}` : "";
        if (key && pop && key === last) return;
        last = key;
        if (!target) return scheduleHide();
        if (target.kind === "color") colorPopover(view, target.from, target.value);
        else pathPopover(editors, view, target.from, target.ref);
      }, 350);
      return false;
    },
    mouseleave() {
      clearTimeout(timer);
      last = "";
      scheduleHide();
      return false;
    },
    mousedown(e, view) {
      const sw = e.target.closest?.(".of-cswatch");
      if (sw) {
        const from = Number(sw.dataset.from);
        const line = view.state.doc.lineAt(from);
        const c = colorAt(line.text, from - line.from, { named: true });
        if (c) {
          e.preventDefault();
          last = `color:${from}`;
          colorPopover(view, from, c.value);
          return true;
        }
      }
      if (!(e.ctrlKey || e.metaKey) || prefs.codeHoverPaths === false) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
      if (pos == null) return false;
      const line = view.state.doc.lineAt(pos);
      const p = pathAt(line.text, pos - line.from);
      const res = p && editors.active && resolveRef(editors.active, p.ref);
      if (!res?.path || !editors.web.has(res.path)) return false; // otherwise Ctrl+click adds a cursor as usual
      e.preventDefault();
      hidePop();
      editors.openFile(res.path, { focus: true });
      return true;
    },
    keydown(e) {
      if (e.key === "Escape") hidePop();
      return false;
    },
    scroll() {
      hidePop();
      return false;
    },
  });
}

/** Extensions of one file for the current preferences. */
export function assistExtensions(editors, path) {
  const prefs = new Proxy({}, { get: (_, k) => editors.app.prefs[k] }); // always the live preferences (reset replaces the object)
  // one function per source and file: CodeMirror matches running completions to their source by identity
  const sources = [{ autocomplete: projectSource(editors, path, prefs) }, { autocomplete: snippetSource(path, prefs) }, { autocomplete: wordSource(prefs) }];
  const out = [CM.EditorState.languageData.of(() => sources)];
  const lang = languageOf(path);
  if (prefs.codeColorSwatches !== false && ["css", "html", "javascript", "markdown", "json"].includes(lang)) out.push(swatchPlugin(lang));
  if (prefs.codeHoverColors !== false || prefs.codeHoverPaths !== false) out.push(hoverHandlers(editors, path, prefs));
  return out;
}

export { hidePop as hideCodePopover };
