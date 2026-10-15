// Creating and styling text frames/stories.
import { createNode, solid } from "./nodes.js";
import { translate } from "./math.js";
import { clone, uid } from "./util.js";
import { storyFromPlain, emptyStory } from "../engine/layout/text-model.js";

export const TEXT_DEFAULTS = Object.freeze({ fontFamily: "Inter", fontSize: 48, fontWeight: 400, fontStyle: "normal" });
export const PARA_DEFAULTS = Object.freeze({ align: "left", lineHeight: 1.25 });

/** App-wide "current text style" used for new text. */
export function currentTextStyle(app) {
  return app.textStyle || (app.textStyle = { char: { ...TEXT_DEFAULTS }, para: { ...PARA_DEFAULTS } });
}

/**
 * Creates a text node (+ story) inside the active document and returns it.
 * `w`/`h` null = artistic text (grows with content); otherwise a frame of that size.
 */
export function addTextNode(app, { text = "", x = 0, y = 0, w = null, h = null, parent = app.context, select = true, label = "Add Text", defaults, fill } = {}) {
  const doc = app.doc;
  const style = currentTextStyle(app);
  const char = { ...style.char, ...(defaults?.char || {}) };
  const para = { ...style.para, ...(defaults?.para || {}) };
  let node;
  doc.tx(label, () => {
    const story = text ? storyFromPlain(text) : emptyStory();
    const storyId = doc.createStory(story);
    doc.stories[storyId].defaults = { char, para };
    node = createNode("text", {
      name: text ? text.slice(0, 24) : "Text",
      storyId,
      w,
      h,
      mode: w == null ? "artistic" : "frame",
      m: translate(x, y),
      // text is dark by default; in the Pixel studio it takes the foreground color like a paint tool
      fill: fill || solid(app.studio === "pixel" ? app.style.primary : "#111111"),
      flowIndex: 0,
    });
    doc.insert(node, parent, parent.children.length);
  });
  if (select) app.select([node]);
  return node;
}

/** Creates a text node for an imported SVG <text> element. */
export function addImportedText(doc, node, info) {
  const story = storyFromPlain(info.content);
  const storyId = doc.createStory(story, uid("s"));
  doc.stories[storyId].defaults = {
    char: { fontFamily: info.family, fontSize: info.size, fontWeight: info.weight, fontStyle: info.italic ? "italic" : "normal" },
    para: { align: info.anchor === "middle" ? "center" : info.anchor === "end" ? "right" : "left", lineHeight: 1.2 },
  };
  node.storyId = storyId;
  node.w = null;
  node.h = null;
  node.mode = "artistic";
  node.flowIndex = 0;
  delete node._svgText;
}

export { clone };
