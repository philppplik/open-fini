// Vibe tools for character encoding and text transforms: the same codec and transforms as the code editor's
// Transform menu (engine/web/charcodec.js, engine/web/texttools.js).
import { tool, S } from "./helpers.js";
import { encode, decode, FORMATS, MODES } from "../../engine/web/charcodec.js";
import { TRANSFORMS, TRANSFORM_BY_ID } from "../../engine/web/texttools.js";
import { isTextPath, normalizePath } from "../../engine/web/index.js";

const MAX = 400_000;
const NAMES = TRANSFORMS.filter((t) => !t.fileOnly).map((t) => t.id);

export function textcodecTools(app) {
  const project = () => {
    const web = app.doc?.web;
    if (!web) throw new Error("The active document has no website or text project. Use create_website first.");
    return web;
  };

  return [
    tool("encode_text", "Encodes special characters in a text. Formats: html-named (&eacute;), html-decimal (&#233;), html-hex (&#xE9;), js (\\u00e9, optionally \\u{1f600}), css (\\E9 ), url (UTF-8 percent-encoding), codepoints (<U+00E9>). Modes: non-ascii (every non-ASCII character), special (markup characters & < > \" ' plus non-ASCII symbols and punctuation, but not letters), everything (every character except line breaks and tabs). Pure function: nothing in the document changes.", {
      text: S.str("The text to encode"),
      format: S.str("Output format", { enum: FORMATS }),
      mode: S.str("Which characters to encode (default non-ascii)", { enum: MODES }),
      braces: S.bool("js format: write astral characters as \\u{...} instead of surrogate pairs"),
      apos: S.bool("html-named format: use &apos; for the apostrophe instead of &#39;"),
    }, ["text", "format"], async (a) => {
      if (a.text.length > MAX) throw new Error("The text is too long (limit 400,000 characters).");
      return { text: encode(a.text, { format: a.format, mode: a.mode || "non-ascii", braces: !!a.braces, apos: !!a.apos }) };
    }, { readOnly: true }),

    tool("decode_text", "Decodes encoded characters in a text in a single pass (nothing is decoded twice). Formats: html (named, decimal and hex entities), js (\\uXXXX, \\u{...}, \\xHH), css (\\E9 ), url (percent-encoding as UTF-8), codepoints (<U+00E9>), auto (html entities and js escapes). Pure function: nothing in the document changes.", {
      text: S.str("The text to decode"),
      format: S.str("Input format (default auto)", { enum: ["auto", "html", "js", "css", "url", "codepoints"] }),
    }, ["text"], async (a) => {
      if (a.text.length > MAX) throw new Error("The text is too long (limit 400,000 characters).");
      return { text: decode(a.text, a.format || "auto") };
    }, { readOnly: true }),

    tool("transform_file_text", `Applies a named text transform to the whole content of one or more project files, as one undoable edit per file (like edit_file). Transforms: ${NAMES.join(", ")}. Rewriting more than one file needs the user's approval.`, {
      path: S.str("File path (for one file)"),
      paths: { type: "array", items: { type: "string" }, description: "Several file paths (needs approval)", minItems: 1 },
      transform: S.str("Transform id", { enum: NAMES }),
      arg: S.str("Argument for transforms that need one (wrapTag: the tag, for example div or a href=\"#\")"),
      tabSize: S.num("Tab width for tabsToSpaces, spacesToTabs and jsonPrettify (default 2)"),
    }, ["transform"], async (a) => {
      const web = project();
      const tf = TRANSFORM_BY_ID.get(a.transform);
      if (!tf || tf.fileOnly) throw new Error(`Unknown transform “${a.transform}”.`);
      if (tf.scope === "color") throw new Error("Color transforms work on a selected color literal in the editor, not on whole files.");
      if (tf.needsArg && !a.arg) throw new Error(`The transform ${tf.id} needs arg: ${tf.needsArg}.`);
      const list = (a.paths?.length ? a.paths : a.path ? [a.path] : []).map(normalizePath);
      if (!list.length) throw new Error("Give path or paths.");
      const results = [];
      const edits = [];
      for (const path of list) {
        const text = web.text(path);
        if (text == null || !isTextPath(path)) throw new Error(`“${path}” is not a text file of this project. Call list_files.`);
        const next = tf.apply(text, { arg: a.arg, tabSize: a.tabSize || web.settings?.tabSize || 2, lang: path.split(".").pop() });
        edits.push({ path, text, next });
      }
      const { trimmedChange } = await import("../../ui/code/util.js");
      for (const { path, text, next } of edits) {
        if (next === text) {
          results.push({ path, changed: false });
          continue;
        }
        const ed = app.codeUI?.built && app.codeUI.doc === app.doc ? app.codeUI.editors : null;
        if (ed) ed.applyChanges(path, [trimmedChange(text, next)], { userEvent: "input.ai" });
        else web.setText(path, next, "ai");
        results.push({ path, changed: true, chars: next.length });
      }
      return { transform: tf.id, files: results };
    }, { needsApproval: (a) => (a.paths?.length > 1 ? `Rewrite ${a.paths.length} files with the transform “${a.transform}”?` : false) }),
  ];
}
