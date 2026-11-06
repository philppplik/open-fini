// Code > Formatting Options…: presets and per-language options of the built-in formatter and minifier, with a live
// before/after sample. Loaded on demand. Values are stored in the `codeFormat` preference as { preset, ...own values };
// own values win over the preset, the preset wins over the editor preferences (tab size, line width, attribute quotes).
import { h, empty } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { openDialog } from "../dialogs.js";
import { segmented, numField } from "../controls.js";
import { DEFAULT_FORMAT_OPTIONS, FORMAT_PRESETS, formatText, minifyText } from "../../engine/web/index.js";

const SAMPLES = {
  html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Demo</title><link rel="stylesheet" href="style.css"></head>\n<body><nav class="menu" id="top" aria-label="Main"><a href="#">Home</a> <a href="#about">About us</a></nav><img src="logo.png" alt="Logo"><br><p>Some <b>bold</b> text.</p></body></html>`,
  css: `.card,.card--big{color:#3A7BD5;padding:12px 16px}\n.card:hover{background:#FFF}\n@media (max-width:767px){.card{padding:8px}}`,
  javascript: `function greet(name){if(!name){return 'nobody'}const parts=[1,2,3].map(x=>x*2);return \`Hi \${name}\`+parts.join(",")}\nconst options={retries:3,url:"/api"};document.querySelectorAll(".card").forEach(el=>{el.addEventListener("click",()=>el.classList.toggle("open"))})`,
};

/** Effective options for the dialog (editor.formatOptions does the same with the project's tab size). */
export function effectiveFormatOptions(prefs) {
  const custom = prefs.codeFormat && typeof prefs.codeFormat === "object" ? prefs.codeFormat : {};
  const { preset, ...own } = custom;
  return { ...DEFAULT_FORMAT_OPTIONS, indentSize: prefs.codeTabSize || 2, useTabs: !!prefs.codeUseTabs, lineWidth: prefs.codeLineWidth || 100, quote: prefs.codeQuoteStyle || "keep", ...(FORMAT_PRESETS[preset] || {}), ...own };
}

export function openFormatOptions(app) {
  let tab = "general";
  const body = h("div.of-fmtopts");
  const render = () => {
    empty(body);
    const custom = app.prefs.codeFormat && typeof app.prefs.codeFormat === "object" ? app.prefs.codeFormat : {};
    const o = effectiveFormatOptions(app.prefs);
    const set = (key, value) => {
      app.setPref("codeFormat", { ...custom, [key]: value });
      render();
    };
    const presetNames = { default: t("Default"), prettier: t("Prettier-like"), standard: t("Standard-like"), compact: t("Compact"), spacious: t("Spacious") };
    const preset = h("select.of-fmtopts__preset", { "aria-label": t("Preset") }, ...Object.keys(FORMAT_PRESETS).map((id) => h("option", { value: id, selected: (custom.preset || "default") === id }, presetNames[id])));
    preset.addEventListener("change", () => {
      app.setPref("codeFormat", { preset: preset.value }); // a preset starts over: your own values are cleared
      render();
    });
    const own = Object.keys(custom).filter((k) => k !== "preset").length;
    const head = h("div.of-fmtopts__head", h("label", t("Preset"), preset), own ? h("span.of-fmtopts__own", t("{n, plural, one {# own value} other {# own values}}", { n: own })) : null, own ? h("sl-button", { size: "small", onclick: () => (app.setPref("codeFormat", { preset: custom.preset || "default" }), render()) }, t("Reset to preset")) : null);

    const row = (label, ctl, hint) => h("div.of-fmtopts__row", h("div", h("div.of-fmtopts__label", label), hint ? h("div.of-fmtopts__hint", hint) : null), ctl);
    const seg = (key, options) => segmented(options.map(([value, label]) => ({ value, label, text: label })), o[key], (v) => set(key, v)).el;
    const sw = (key) => {
      const el = h("sl-switch", { size: "small", checked: !!o[key], "aria-label": key });
      el.addEventListener("sl-change", () => set(key, el.checked));
      return el;
    };
    const num = (key, min, max, label) => numField({ cls: "of-fmtopts__num", label: "", title: label, value: o[key], min, max, step: 1, precision: 0, scrub: false, onChange: (v) => set(key, Math.round(v)) }).el;
    const langIndent = (key) => num(key, 0, 8, t("Indentation"));

    const tabs = [["general", t("General")], ["html", "HTML"], ["css", "CSS"], ["javascript", "JavaScript"], ["minify", t("Minify")]];
    const bar = h("div.of-fmtopts__tabs", { role: "tablist" }, ...tabs.map(([id, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(id === tab), class: id === tab ? "active" : "", onclick: () => ((tab = id), render()) }, label)));
    const rows = [];
    if (tab === "general") {
      rows.push(row(t("Indentation"), num("indentSize", 1, 8, t("Indentation")), t("Spaces per level (also the width of a tab).")));
      rows.push(row(t("Indent with tabs"), sw("useTabs")));
      rows.push(row(t("Line width"), num("lineWidth", 40, 240, t("Line width")), t("Long start tags, objects and rules wrap beyond this width.")));
      rows.push(row(t("Blank lines to keep"), num("maxBlankLines", 0, 3, t("Blank lines to keep")), t("Runs of empty lines are shortened to this many.")));
    } else if (tab === "html") {
      rows.push(row(t("Indentation"), langIndent("htmlIndentSize"), t("0 uses the general indentation.")));
      rows.push(row(t("Wrap attributes"), seg("htmlWrapAttributes", [["auto", t("When too long")], ["force", t("Always")], ["never", t("Never")]]), t("One attribute per line for start tags with two or more attributes.")));
      rows.push(row(t("Empty elements"), seg("htmlVoidStyle", [["keep", t("Keep")], ["html", "<br>"], ["xhtml", "<br />"]])));
      rows.push(row(t("Attribute quotes"), seg("quote", [["keep", t("Keep")], ["double", '"'], ["single", "'"]])));
      rows.push(row(t("Indent inside <html>"), sw("htmlIndentRoot"), t("Off keeps <head> and <body> at the level of <html>.")));
    } else if (tab === "css") {
      rows.push(row(t("Indentation"), langIndent("cssIndentSize"), t("0 uses the general indentation.")));
      rows.push(row(t("One selector per line"), sw("cssSelectorsPerLine"), t("For selector lists such as h1, h2, h3.")));
      rows.push(row(t("Blank line between rules"), sw("cssBlankLines")));
      rows.push(row(t("Hex colors"), seg("cssHexCase", [["keep", t("Keep")], ["lower", "#abc"], ["upper", "#ABC"]])));
    } else if (tab === "javascript") {
      rows.push(row(t("Indentation"), langIndent("jsIndentSize"), t("0 uses the general indentation.")));
      rows.push(row(t("Style"), seg("jsStyle", [["beautify", t("Beautify")], ["reindent", t("Re-indent only")]]), t("Beautify fixes spacing and puts statements and blocks on their own lines. Re-indent only changes the indentation. TypeScript and JSX are always re-indented only.")));
      rows.push(row(t("Braces"), seg("jsBraceStyle", [["collapse", t("Same line")], ["allman", t("Next line")]])));
      rows.push(row(t("String quotes"), seg("jsQuote", [["keep", t("Keep")], ["double", '"'], ["single", "'"]])));
      rows.push(row(t("Space before function parentheses"), sw("jsSpaceBeforeFunctionParen"), "function name (a) { … }"));
      rows.push(row(t("Short objects on one line"), sw("jsObjectInline"), t("Objects that fit the line width and were on one line stay there.")));
    } else {
      rows.push(row(t("Keep license comments"), sw("keepLicense"), t("Comments starting with /*! or containing @license or @preserve.")));
      rows.push(row(t("Minify inline scripts in HTML"), sw("minifyInlineScripts")));
    }
    const lang = tab === "general" || tab === "minify" ? "javascript" : tab;
    const before = SAMPLES[lang];
    const after = tab === "minify" ? minifyText("html", SAMPLES.html, o) : formatText(lang, before, o);
    const preview = h("div.of-fmtopts__preview", h("div.of-fmtopts__label", tab === "minify" ? t("Minified sample") : t("Formatted sample")), h("pre", after.ok ? after.text : after.error));
    body.append(head, bar, h("div.of-fmtopts__body", h("div.of-fmtopts__rows", ...rows), preview));
  };
  render();
  ensureStyles();
  openDialog({ title: t("Formatting options"), body, width: 820, buttons: [{ label: t("Done"), variant: "primary", onClick: (c) => c() }] });
}

function ensureStyles() {
  if (document.querySelector("style[data-of-fmtopts]")) return;
  document.head.append(
    h(
      "style",
      { "data-of-fmtopts": "" },
      `.of-fmtopts{display:grid;gap:10px}.of-fmtopts__head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.of-fmtopts__head label{display:flex;align-items:center;gap:8px;font-weight:600}
.of-fmtopts select{background:var(--of-bg-input);color:var(--of-text);border:1px solid var(--of-border);border-radius:4px;padding:3px 6px;font:inherit}
.of-fmtopts__own{color:var(--of-text-dim);font-size:12px}.of-fmtopts__tabs{display:flex;gap:2px;border-bottom:1px solid var(--of-border-soft)}
.of-fmtopts__tabs button{background:none;border:0;border-bottom:2px solid transparent;color:var(--of-text-dim);padding:6px 12px;cursor:pointer;font:inherit}
.of-fmtopts__tabs button.active{color:var(--of-text);border-bottom-color:var(--of-accent)}
.of-fmtopts__body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}@media (max-width:720px){.of-fmtopts__body{grid-template-columns:1fr}}
.of-fmtopts__rows{display:grid;gap:10px;align-content:start}.of-fmtopts__row{display:flex;justify-content:space-between;gap:12px;align-items:center}
.of-fmtopts__label{font-weight:600;font-size:12px}.of-fmtopts__num{width:84px;flex:none}.of-fmtopts__row .of-seg{flex:none}.of-fmtopts__hint{color:var(--of-text-dim);font-size:11px;margin-top:2px}
.of-fmtopts__preview pre{margin:6px 0 0;max-height:340px;overflow:auto;background:var(--of-editor-bg,var(--of-bg-input));padding:8px 10px;border-radius:var(--of-radius);font:11px/1.5 var(--of-mono);white-space:pre}`,
    ),
  );
}
