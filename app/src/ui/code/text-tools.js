// Text tools of the code editor: the Transform submenu of the right-click menu, the command palette entries and the
// dialogs (encode chooser, Unicode info). All transforms run through `runTransform`, which applies every change as ONE
// CodeMirror transaction, so a single Undo takes it back. The transforms themselves are pure (engine/web/texttools.js).
import * as CM from "../../../vendor/codemirror/codemirror.js";
import { h } from "../../core/util.js";
import { TRANSFORMS, TRANSFORM_BY_ID, wordRangeAt, colorAt } from "../../engine/web/texttools.js";
import { encode, charInfo, FORMATS, MODES, FORMAT_LABELS, MODE_LABELS, transformRanges } from "../../engine/web/charcodec.js";
import { languageOf } from "../../engine/web/index.js";
import { openDialog, promptDialog } from "../dialogs.js";

/** Commands exposed in the palette: `code.<id>` for every transform that works inside an editor. */
export const EDITOR_TRANSFORMS = TRANSFORMS.filter((t) => !t.fileOnly);
const GROUP_LABEL = { encode: "Encode", decode: "Decode", convert: "Convert", case: "Case", lines: "Lines", wrap: "Wrap", json: "JSON", color: "Color" };
export const transformCommandLabel = (t) => `${GROUP_LABEL[t.group]}: ${t.label}`;

/** Ranges the transform operates on: selections as they are; for empty cursors the word, line, file or color. */
export function targetRanges(state, scope) {
  const doc = state.doc;
  const raw = [];
  for (const r of state.selection.ranges) {
    if (!r.empty) {
      raw.push({ from: r.from, to: r.to, cursor: false });
      continue;
    }
    const line = doc.lineAt(r.head);
    if (scope === "file") raw.push({ from: 0, to: doc.length, cursor: true, at: r.head });
    else if (scope === "line") raw.push({ from: line.from, to: line.to, cursor: true, at: r.head });
    else if (scope === "word") {
      const w = wordRangeAt(line.text, r.head - line.from);
      raw.push({ from: line.from + w.from, to: line.from + w.to, cursor: true, at: r.head, word: true });
    } else if (scope === "color") {
      const c = colorAt(line.text, r.head - line.from);
      if (c) raw.push({ from: line.from + c.from, to: line.from + c.to, cursor: true, at: r.head });
    }
  }
  raw.sort((a, b) => a.from - b.from || a.to - b.to);
  const out = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r.from < last.to) last.to = Math.max(last.to, r.to); // overlapping ranges collapse into one
    else if (last && last.from === r.from && last.to === r.to) continue;
    else out.push({ ...r });
  }
  return out;
}

/**
 * Runs a transform on the editor's selection(s). Returns {changed, error?}. Nothing is applied when any range fails.
 * @param {import("./editor.js").CodeEditors} editors
 * @param {string} id transform id (texttools.TRANSFORMS)
 * @param {object} [o] {arg, tabSize} extra options for the transform
 */
export async function runTransform(editors, id, o = {}) {
  const view = editors.view;
  const app = editors.app;
  const tf = o.transform || TRANSFORM_BY_ID.get(id);
  if (!view || !tf) return { changed: false, error: "No editor is open." };
  let arg = o.arg;
  if (tf.needsArg && arg == null) {
    arg = await promptDialog({ title: tf.label.replace("…", ""), label: tf.needsArg, value: "div", ok: "Wrap" });
    if (!arg) return { changed: false };
  }
  const state = view.state;
  const ranges = targetRanges(state, tf.scope);
  if (!ranges.length) {
    const msg = tf.scope === "color" ? "Place the cursor inside a color (hex, rgb() or hsl()) or select one." : "Nothing to transform.";
    app.toast?.(msg, "warning", 2500);
    return { changed: false, error: msg };
  }
  const opts = { arg, tabSize: editors.web?.settings?.tabSize || 2, lang: languageOf(editors.active || "") };
  let res;
  try {
    res = transformRanges(ranges, (s) => tf.apply(s, opts), (a, b) => state.sliceDoc(a, b));
  } catch (err) {
    app.toast?.(err.message || "The transform failed.", "warning", 3500);
    return { changed: false, error: err.message };
  }
  if (!res.changes.length) {
    app.toast?.("Nothing to change.", "primary", 1600);
    return { changed: false };
  }
  const sel = res.selection.map((s, i) => {
    const r = ranges[i];
    if (r.cursor && !r.word && tf.scope !== "color") {
      // keep the caret where it was (shifted by the earlier changes) when the whole line or file was transformed
      const len = s.head - s.anchor;
      const rel = Math.min(len, Math.max(0, r.at - r.from));
      return CM.EditorSelection.cursor(s.anchor + (tf.scope === "line" ? len : rel));
    }
    return CM.EditorSelection.range(s.anchor, s.head);
  });
  view.dispatch({ changes: res.changes, selection: CM.EditorSelection.create(sel), userEvent: "input.transform", scrollIntoView: true });
  view.focus();
  return { changed: true };
}

/** The Transform submenu (menu items for the context menu framework). */
export function transformMenuItems(editors) {
  const view = editors.view;
  const run = (id) => () => runTransform(editors, id);
  const item = (id, label) => ({ id: `tf.${id}`, label: label || TRANSFORM_BY_ID.get(id).label, run: run(id) });
  const group = (g, ids) => ({ label: GROUP_LABEL[g], items: ids.map((id) => (id === "-" ? "-" : item(id))) });
  const hasColor = (() => {
    if (!view) return false;
    const s = view.state;
    return targetRanges(s, "color").some((r) => {
      try {
        return !!TRANSFORM_BY_ID.get("colorToHex").apply(s.sliceDoc(r.from, r.to));
      } catch {
        return false;
      }
    });
  })();
  return [
    {
      label: "Encode special characters", icon: "code-square", items: [
        ...["encodeEntitiesNamed", "encodeEntitiesDecimal", "encodeEntitiesHex", "encodeJsEscapes", "encodeJsBraces", "encodeCssEscapes", "encodePercent", "encodeCodePoints"].map((id) => item(id)),
        "-", item("escapeHtml", "Escape markup only (& < > \" ')"), { label: "Choose format and mode…", icon: "sliders", run: () => encodeChooser(editors) },
      ],
    },
    group("decode", ["decodeEntities", "decodeJsEscapes", "decodeCssEscapes", "decodePercent", "decodeCodePoints", "-", "decodeAuto"]),
    group("convert", ["base64Encode", "base64Decode", "-", "urlEncode", "urlDecode"]),
    group("case", ["upperCase", "lowerCase", "titleCase", "-", "camelCase", "snakeCase", "kebabCase", "constantCase"]),
    group("lines", ["sortLinesAsc", "sortLinesDesc", "sortLinesNumeric", "sortLinesUnique", "reverseLines", "-", "joinLines", "removeBlankLines", "-", "trimLines", "trimTrailing", "normalizeWhitespace", "-", "tabsToSpaces", "spacesToTabs"]),
    group("wrap", ["wrapTag", "wrapDoubleQuotes", "wrapSingleQuotes", "wrapParens", "wrapBrackets", "wrapComment"]),
    group("json", ["jsonPrettify", "jsonMinify"]),
    hasColor ? group("color", ["colorToHex", "colorToRgb", "colorToHsl"]) : null,
    "-",
    { label: "Show Unicode info…", icon: "info-circle", run: () => showUnicodeInfo(editors) },
  ].filter(Boolean);
}

/** Dialog: pick an encoding format and mode with a live preview of the selection (or the line). */
export function encodeChooser(editors) {
  const view = editors.view;
  if (!view) return;
  const [range] = targetRanges(view.state, "line");
  if (!range) return;
  const source = view.state.sliceDoc(range.from, range.to);
  const state = { format: "html-decimal", mode: "non-ascii", upper: true };
  const preview = h("pre.of-enc__preview", { "aria-live": "polite" });
  const sync = () => {
    let out = "";
    try {
      out = encode(source.slice(0, 600), { format: state.format, mode: state.mode });
    } catch (err) {
      out = err.message;
    }
    preview.textContent = out + (source.length > 600 ? "…" : "");
  };
  const radios = (name, values, labels) => {
    const fs = h("fieldset", h("legend", name === "format" ? "Format" : "Characters to encode"));
    for (const v of values) {
      const input = h("input", { type: "radio", name: `of-enc-${name}`, value: v, checked: state[name] === v });
      input.addEventListener("change", () => {
        state[name] = v;
        sync();
      });
      fs.append(h("label", input, h("span", labels[v])));
    }
    return fs;
  };
  const body = h("div.of-enc", radios("format", FORMATS, FORMAT_LABELS), radios("mode", MODES, MODE_LABELS), h("div", h("div.of-hint", range.cursor ? "Preview (the current line):" : "Preview (the selection):"), preview));
  sync();
  openDialog({
    title: "Encode special characters",
    body,
    width: 520,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Encode", variant: "primary", onClick: async (c) => {
          c();
          const { format, mode } = state;
          await runTransform(editors, "encodeChooser", { transform: { id: "encodeChooser", label: "Encode", group: "encode", scope: "line", apply: (t) => encode(t, { format, mode }) } });
        },
      },
    ],
  });
}

/** Dialog with code point, UTF-8 / UTF-16 bytes, HTML entity name and category of the character at the cursor. */
export function showUnicodeInfo(editors) {
  const view = editors.view;
  if (!view) return;
  const s = view.state;
  const pos = s.selection.main.empty ? s.selection.main.head : s.selection.main.from;
  const line = s.doc.lineAt(pos);
  let off = pos - line.from;
  if (off >= line.text.length) off = Math.max(0, line.text.length - 1); // at the end of a line: the character before
  const info = line.text.length ? charInfo(line.text, off) : null;
  if (!info) {
    editors.app.toast?.("There is no character at the cursor (empty line).", "primary", 2200);
    return;
  }
  const rows = [
    ["Code point", `${info.codePoint}  (decimal ${info.decimal})`],
    ["Category", info.category],
    ["UTF-8 bytes", info.utf8.join(" ")],
    ["UTF-16 units", info.utf16.join(" ")],
    ["HTML entity", info.entity || "none (use " + `&#${info.decimal}; or &#x${info.decimal.toString(16).toUpperCase()};` + ")"],
    ["JavaScript", info.decimal > 0xffff ? `\\u{${info.decimal.toString(16)}}` : `\\u${info.decimal.toString(16).padStart(4, "0")}`],
    ["CSS", `\\${info.decimal.toString(16).toUpperCase()} `],
  ];
  const shown = info.codePoint === "U+0020" ? "␠" : info.codePoint === "U+0009" ? "⇥" : info.char;
  const dl = h("dl.of-uinfo", h("dd.of-uinfo__char", { "aria-label": `Character ${info.codePoint}` }, shown), ...rows.flatMap(([k, v]) => [h("dt", k), h("dd", v)]));
  openDialog({ title: "Unicode info", body: dl, width: 460, buttons: [{ label: "Copy code point", onClick: () => navigator.clipboard?.writeText(info.codePoint) }, { label: "Close", variant: "primary", onClick: (c) => c() }] });
}
