// Settings blocks of the Code studio editor (Settings > Code studio, loaded on demand): the syntax color theme with a
// live sample and per-color overrides, and the editor for your own snippets. Also the "Syntax Color Theme" dialog.
import { h, empty, optVal, optDecode } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { openDialog } from "../dialogs.js";
import { SYNTAX_THEMES, SYNTAX_SLOTS, syntaxTheme, sanitizeSyntaxCustom } from "../../engine/web/syntax-themes.js";
import { sanitizeSnippets, SNIPPET_LANGS, MAX_SNIPPETS } from "../../engine/web/snippets.js";

/** The stylesheet of the popovers, swatches and settings blocks, added once on first use. */
export function ensureAssistStyles() {
  if (typeof document === "undefined" || document.querySelector("link[data-of-code-assist]")) return;
  document.head.append(h("link", { rel: "stylesheet", href: new URL("styles/code-assist.css", document.baseURI).href, "data-of-code-assist": "" }));
}

/** Labels of the color slots (translated when shown). */
const slotLabel = (s) =>
  ({
    bg: t("Background"),
    fg: t("Text"),
    gutter: t("Line numbers"),
    line: t("Current line"),
    select: t("Selection"),
    cursor: t("Cursor"),
    keyword: t("Keywords"),
    string: t("Strings"),
    number: t("Numbers"),
    comment: t("Comments"),
    function: t("Functions"),
    tag: t("Tags"),
    attr: t("Attributes"),
    prop: t("Properties"),
    type: t("Types and classes"),
    op: t("Operators"),
    punct: t("Punctuation"),
    heading: t("Headings"),
    link: t("Links"),
  })[s] || s;

// [slot, text] runs of a short sample (null = new line)
const SAMPLE = [
  ["punct", "<"], ["tag", "nav"], ["fg", " "], ["attr", "class"], ["punct", "="], ["string", '"menu"'], ["punct", ">"], ["comment", "  <!-- links -->"], null,
  ["prop", ".card"], ["punct", " { "], ["prop", "color"], ["punct", ": "], ["number", "#3a7"], ["punct", "; "], ["prop", "padding"], ["punct", ": "], ["number", "12px"], ["punct", "; }"], null,
  ["keyword", "function"], ["fg", " "], ["function", "greet"], ["punct", "("], ["fg", "name"], ["punct", ") {"], ["comment", " // say hi"], null,
  ["fg", "  "], ["keyword", "return"], ["fg", " "], ["string", "`Hello ${name}`"], ["op", " + "], ["number", "42"], ["punct", ";"], null,
  ["punct", "}"],
];

/** Effective colors of the current choice: the theme (or the interface's computed colors) plus custom colors. */
function effectiveColors(app) {
  const theme = syntaxTheme(app.prefs.codeSyntaxTheme);
  const base = {};
  if (theme) Object.assign(base, theme.colors);
  else {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    Object.assign(base, { bg: v("--of-editor-bg", "#1f2025"), fg: v("--of-text", "#e6e6e6"), gutter: v("--of-editor-gutter", "#6b6f7d"), line: v("--of-editor-line", "#ffffff0b"), select: v("--of-editor-select", "#8b7cf650"), cursor: v("--of-accent", "#8b7cf6") });
    for (const s of SYNTAX_SLOTS) if (!base[s]) base[s] = v(`--of-syn-${s}`, "#888888");
  }
  return { ...base, ...sanitizeSyntaxCustom(app.prefs.codeSyntaxCustom) };
}

function sample(colors) {
  const pre = h("pre.of-synsample", { style: { background: colors.bg, color: colors.fg, borderColor: colors.gutter }, "aria-hidden": "true" });
  let line = h("div");
  const lines = [line];
  for (const run of SAMPLE) {
    if (!run) lines.push((line = h("div")));
    else line.append(h("span", { style: { color: colors[run[0]] || colors.fg, fontStyle: run[0] === "comment" ? "italic" : "" } }, run[1]));
  }
  lines[2].style.background = colors.line;
  pre.append(...lines);
  return pre;
}

const opaque = (c) => (typeof c === "string" && /^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7) : "#888888");

/** Theme select, live sample and per-slot color overrides. */
export function syntaxThemeSettings(app) {
  ensureAssistStyles();
  const root = h("div.of-synset");
  const render = () => {
    empty(root);
    const sel = h("sl-select", { size: "small", hoist: true, value: optVal(syntaxTheme(app.prefs.codeSyntaxTheme) ? app.prefs.codeSyntaxTheme : "app"), "aria-label": t("Syntax color theme") });
    sel.append(h("sl-option", { value: "app" }, t("Follow the interface theme")));
    sel.append(h("small", { class: "of-synset__group" }, t("Dark")));
    for (const th of SYNTAX_THEMES.filter((x) => x.dark)) sel.append(h("sl-option", { value: optVal(th.id) }, th.name));
    sel.append(h("small", { class: "of-synset__group" }, t("Light")));
    for (const th of SYNTAX_THEMES.filter((x) => !x.dark)) sel.append(h("sl-option", { value: optVal(th.id) }, th.name));
    sel.addEventListener("sl-change", () => {
      app.setPref("codeSyntaxTheme", optDecode(sel.value) || "app");
      render();
    });
    const colors = effectiveColors(app);
    const custom = sanitizeSyntaxCustom(app.prefs.codeSyntaxCustom);
    const grid = h("div.of-synset__grid");
    for (const slot of SYNTAX_SLOTS) {
      const input = h("input", { type: "color", value: opaque(colors[slot]), "aria-label": slotLabel(slot) });
      input.addEventListener("change", () => {
        // the current-line color must stay translucent or it would hide the selection behind the text
        const v = slot === "line" ? `${input.value}33` : input.value;
        app.setPref("codeSyntaxCustom", { ...sanitizeSyntaxCustom(app.prefs.codeSyntaxCustom), [slot]: v });
        render();
      });
      const reset = custom[slot]
        ? h("button.of-synset__reset", { type: "button", title: t("Use the theme color"), "aria-label": t("Use the theme color"), onclick: () => {
          const next = sanitizeSyntaxCustom(app.prefs.codeSyntaxCustom);
          delete next[slot];
          app.setPref("codeSyntaxCustom", next);
          render();
        } }, h("sl-icon", { name: "arrow-counterclockwise" }))
        : null;
      grid.append(h("label.of-synset__slot", { class: custom[slot] ? "custom" : "" }, input, h("span", slotLabel(slot)), reset));
    }
    const resetAll = Object.keys(custom).length ? h("sl-button", { size: "small", onclick: () => (app.setPref("codeSyntaxCustom", {}), render()) }, t("Reset custom colors")) : null;
    root.append(h("div.of-synset__head", sel, resetAll), sample(colors), h("div.of-set__hint", t("Custom colors apply on top of the chosen theme. The theme only colors the code editor, not the rest of OpenFini.")), grid);
  };
  render();
  return root;
}

/** Code > Syntax Color Theme…: the same controls in a dialog. */
export function openSyntaxThemeDialog(app) {
  openDialog({ title: t("Syntax color theme"), body: syntaxThemeSettings(app), width: 560, buttons: [{ label: t("Done"), variant: "primary", onClick: (c) => c() }] });
}

const LANG_LABEL = () => ({ "*": t("Every language"), html: "HTML", css: "CSS", javascript: "JavaScript", markdown: "Markdown", json: "JSON", latex: "LaTeX" });

/** Editor for your own snippets: language, prefix, description and body (with ${1:placeholders}). */
export function snippetSettings(app) {
  ensureAssistStyles();
  const root = h("div.of-snipset");
  let list = sanitizeSnippets(app.prefs.codeSnippets);
  const save = () => app.setPref("codeSnippets", sanitizeSnippets(list));
  const render = () => {
    empty(root);
    root.append(h("div.of-set__label", t("Your snippets")));
    const labels = LANG_LABEL();
    for (const [i, s] of list.entries()) {
      const lang = h("select", { "aria-label": t("Language") }, ...SNIPPET_LANGS.map((l) => h("option", { value: l, selected: l === s.lang }, labels[l] || l)));
      lang.addEventListener("change", () => ((s.lang = lang.value), save()));
      const prefix = h("input", { type: "text", value: s.prefix, placeholder: t("Prefix"), "aria-label": t("Prefix"), maxlength: 40, spellcheck: false });
      prefix.addEventListener("change", () => ((s.prefix = prefix.value.trim()), save()));
      const desc = h("input", { type: "text", value: s.description, placeholder: t("Description"), "aria-label": t("Description"), maxlength: 80 });
      desc.addEventListener("change", () => ((s.description = desc.value), save()));
      const body = h("textarea", { rows: 3, placeholder: t("Body, for example <section class=\"$\\{1:name\\}\">$\\{2\\}</section>"), "aria-label": t("Body"), spellcheck: false }, s.body);
      body.addEventListener("change", () => ((s.body = body.value), save()));
      const del = h("button.of-snipset__del", { type: "button", title: t("Remove snippet"), "aria-label": t("Remove snippet"), onclick: () => (list.splice(i, 1), save(), render()) }, h("sl-icon", { name: "trash3" }));
      root.append(h("div.of-snipset__row", h("div.of-snipset__line", lang, prefix, desc, del), body));
    }
    if (!list.length) root.append(h("p.of-set__hint", t("No snippets yet. A snippet is offered while you type its prefix; Tab jumps between its $\\{1:placeholders\\}.")));
    const add = h("sl-button", { size: "small", disabled: list.length >= MAX_SNIPPETS, onclick: () => {
      list.push({ lang: "html", prefix: "", description: "", body: "" });
      render();
    } }, h("sl-icon", { slot: "prefix", name: "plus-lg" }), t("Add snippet"));
    root.append(add);
  };
  render();
  return root;
}
