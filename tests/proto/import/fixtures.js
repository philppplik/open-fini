// Synthetic import fixtures, built from the public format descriptions only (no files from the products):
// Sketch's file format reference (ZIP with document.json, meta.json and pages/<id>.json) and Penpot's export format
// version 3 (ZIP with manifest.json, files/<id>/pages/<id>/<shape>.json, components, media and objects).
import { zipSync, strToU8 } from "../../../app/vendor/fflate/fflate.js";

const json = (v) => strToU8(JSON.stringify(v));
const color = (hex, alpha = 1) => ({ _class: "color", red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255, alpha });
const frame = (x, y, width, height) => ({ _class: "rect", x, y, width, height });
const fill = (hex) => ({ _class: "fill", isEnabled: true, fillType: 0, color: color(hex) });

/** A 1 × 1 PNG. */
export const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const text = (id, string, { size = 14, hex = "#18181b", font = "Inter-Regular", x = 0, y = 0, w = 80, h = 20 } = {}) => ({
  _class: "text", do_objectID: id, name: string, frame: frame(x, y, w, h), textBehaviour: 0, isVisible: true,
  attributedString: { _class: "attributedString", string, attributes: [{ _class: "stringAttribute", location: 0, length: string.length, attributes: { MSAttributedStringFontAttribute: { _class: "fontDescriptor", attributes: { name: font, size } }, MSAttributedStringColorAttribute: color(hex) } }] },
  style: { _class: "style", fills: [], borders: [] },
});

/** A Sketch document: a Symbols page with two button symbols (one nesting an icon symbol) and a screen with instances. */
export function sketchFixture() {
  const icon = { _class: "symbolMaster", do_objectID: "M-ICON", symbolID: "S-ICON", name: "Icon/Star", frame: frame(0, 300, 16, 16), hasBackgroundColor: false, layers: [{ _class: "oval", do_objectID: "L-STAR", name: "Star", frame: frame(0, 0, 16, 16), style: { fills: [fill("#f59e0b")], borders: [] } }] };
  const icon2 = { _class: "symbolMaster", do_objectID: "M-ICON2", symbolID: "S-ICON2", name: "Icon/Heart", frame: frame(40, 300, 16, 16), hasBackgroundColor: false, layers: [{ _class: "rectangle", do_objectID: "L-HEART", name: "Heart", frame: frame(0, 0, 16, 16), fixedRadius: 4, style: { fills: [fill("#ef4444")], borders: [] } }] };
  const button = {
    _class: "symbolMaster", do_objectID: "M-BTN", symbolID: "S-BTN", name: "Button", frame: frame(0, 0, 120, 40), hasBackgroundColor: true, backgroundColor: color("#4f46e5"),
    groupLayout: { _class: "MSImmutableFlexGroupLayout", flexDirection: 0, justifyContent: 1, alignItems: 1, allGuttersGap: 8 },
    topPadding: 8, rightPadding: 16, bottomPadding: 8, leftPadding: 16,
    layers: [
      { _class: "symbolInstance", do_objectID: "L-BTN-ICON", symbolID: "S-ICON", name: "Icon", frame: frame(16, 12, 16, 16), overrideValues: [], style: { fills: [], borders: [] } },
      { ...text("L-BTN-LABEL", "Button", { hex: "#ffffff", x: 40, y: 10 }), horizontalSizing: 1 },
    ],
  };
  const screen = {
    _class: "artboard", do_objectID: "A-SCREEN", name: "Home", frame: frame(0, 0, 390, 844), hasBackgroundColor: true, backgroundColor: color("#ffffff"),
    layers: [
      text("L-TITLE", "Welcome", { size: 28, font: "Inter-Bold", x: 24, y: 40, w: 200, h: 34 }),
      { _class: "symbolInstance", do_objectID: "I-1", symbolID: "S-BTN", name: "Primary", frame: frame(24, 100, 120, 40), overrideValues: [{ _class: "overrideValue", overrideName: "L-BTN-LABEL_stringValue", value: "Sign in" }, { _class: "overrideValue", overrideName: "L-BTN-ICON_symbolID", value: "S-ICON2" }] },
      { _class: "symbolInstance", do_objectID: "I-2", symbolID: "S-BTN", name: "Secondary", frame: frame(24, 160, 120, 40), overrideValues: [{ _class: "overrideValue", overrideName: "L-BTN-ICON_symbolID", value: "" }, { _class: "overrideValue", overrideName: "L-BTN-LABEL_textStyle", value: "X" }] },
      { _class: "rectangle", do_objectID: "L-CARD", name: "Card", frame: frame(24, 220, 342, 120), fixedRadius: 12, style: { fills: [fill("#f4f4f5")], borders: [{ _class: "border", isEnabled: true, color: color("#e4e4e7"), thickness: 1, position: 1 }], shadows: [{ _class: "shadow", isEnabled: true, color: color("#000000", 0.2), offsetX: 0, offsetY: 4, blurRadius: 12, spread: 0 }] } },
      { _class: "bitmap", do_objectID: "L-IMG", name: "Photo", frame: frame(24, 360, 100, 100), image: { _class: "MSJSONFileReference", _ref: "images/photo.png" }, style: { fills: [], borders: [] } },
      { _class: "symbolInstance", do_objectID: "I-3", symbolID: "S-MISSING", name: "Library thing", frame: frame(24, 480, 40, 40), overrideValues: [] },
    ],
  };
  return zipSync({
    "document.json": json({ _class: "document", pages: [{ _class: "MSJSONFileReference", _ref: "pages/P1" }, { _class: "MSJSONFileReference", _ref: "pages/P2" }] }),
    "meta.json": json({ version: 146 }),
    "pages/P1.json": json({ _class: "page", name: "Screens", layers: [screen] }),
    "pages/P2.json": json({ _class: "page", name: "Symbols", layers: [button, icon, icon2] }),
    "images/photo.png": PNG,
  });
}

/** A Penpot v3 export: one file, one page with a board (flex column), a component main and a copy with overrides. */
export function penpotFixture() {
  const F = "f-1";
  const P = "p-1";
  const ROOT = "00000000-0000-0000-0000-000000000000";
  const shapes = {
    [ROOT]: { id: ROOT, type: "frame", name: "Root Frame", x: 0, y: 0, width: 0.01, height: 0.01, shapes: ["b-1", "c-main"], parentId: ROOT, frameId: ROOT },
    "b-1": {
      id: "b-1", type: "frame", name: "Login", x: 100, y: 50, width: 390, height: 600, parentId: ROOT, frameId: ROOT, shapes: ["t-1", "r-1", "c-copy", "img-1"],
      fills: [{ fillColor: "#FFFFFF", fillOpacity: 1 }], r1: 16, r2: 16, r3: 16, r4: 16,
      layout: "flex", layoutFlexDir: "column", layoutGap: { rowGap: 12, columnGap: 0 }, layoutPadding: { p1: 24, p2: 24, p3: 24, p4: 24 }, layoutAlignItems: "stretch", layoutJustifyContent: "start",
      shadow: [{ id: "s1", style: "drop-shadow", offsetX: 0, offsetY: 8, blur: 24, spread: 0, hidden: false, color: { color: "#000000", opacity: 0.15 } }],
    },
    "t-1": {
      id: "t-1", type: "text", name: "Title", x: 124, y: 74, width: 342, height: 34, parentId: "b-1", frameId: "b-1", growType: "auto-height", layoutItemHSizing: "fill",
      content: { type: "root", children: [{ type: "paragraph-set", children: [{ type: "paragraph", textAlign: "left", lineHeight: "1.2", children: [{ text: "Hello ", fontFamily: "Inter", fontSize: "28", fontWeight: "400", fills: [{ fillColor: "#18181b", fillOpacity: 1 }] }, { text: "Penpot", fontFamily: "Inter", fontSize: "28", fontWeight: "700", fills: [{ fillColor: "#6d28d9", fillOpacity: 1 }] }] }] }] },
    },
    "r-1": { id: "r-1", type: "rect", name: "Divider", x: 124, y: 120, width: 342, height: 1, parentId: "b-1", frameId: "b-1", fills: [{ fillColor: "#e4e4e7", fillOpacity: 1 }], layoutItemHSizing: "fill" },
    "c-copy": { id: "c-copy", type: "frame", name: "Button", x: 124, y: 140, width: 120, height: 40, parentId: "b-1", frameId: "b-1", componentId: "comp-1", componentFile: F, componentRoot: true, shapeRef: "c-main", shapes: ["c-copy-label"] },
    "c-copy-label": { id: "c-copy-label", type: "text", name: "Label", x: 140, y: 150, width: 80, height: 20, parentId: "c-copy", frameId: "c-copy", shapeRef: "c-main-label", growType: "auto-width", content: { type: "root", children: [{ type: "paragraph-set", children: [{ type: "paragraph", children: [{ text: "Continue", fontFamily: "Inter", fontSize: "14", fontWeight: "600", fills: [{ fillColor: "#ffffff", fillOpacity: 1 }] }] }] }] } },
    "img-1": { id: "img-1", type: "image", name: "Logo", x: 124, y: 200, width: 64, height: 64, parentId: "b-1", frameId: "b-1", metadata: { id: "med-1", width: 1, height: 1, mtype: "image/png" } },
    "c-main": {
      id: "c-main", type: "frame", name: "Button", x: 600, y: 50, width: 120, height: 40, parentId: ROOT, frameId: ROOT, componentId: "comp-1", componentFile: F, componentRoot: true, mainInstance: true, shapes: ["c-main-label"],
      fills: [{ fillColor: "#4f46e5", fillOpacity: 1 }], r1: 8, r2: 8, r3: 8, r4: 8, layout: "flex", layoutFlexDir: "row", layoutAlignItems: "center", layoutJustifyContent: "center", layoutPadding: { p1: 8, p2: 16, p3: 8, p4: 16 }, layoutGap: { rowGap: 0, columnGap: 8 },
    },
    "c-main-label": { id: "c-main-label", type: "text", name: "Label", x: 616, y: 60, width: 80, height: 20, parentId: "c-main", frameId: "c-main", growType: "auto-width", content: { type: "root", children: [{ type: "paragraph-set", children: [{ type: "paragraph", children: [{ text: "Button", fontFamily: "Inter", fontSize: "14", fontWeight: "600", fills: [{ fillColor: "#ffffff", fillOpacity: 1 }] }] }] }] } },
  };
  const files = {
    "manifest.json": json({ type: "penpot/export-files", version: 1, generatedBy: "penpot/2.4.0", files: [{ id: F, name: "Login kit", features: ["components/v2", "layout/grid"] }] }),
    [`files/${F}.json`]: json({ id: F, name: "Login kit", features: ["components/v2"] }),
    [`files/${F}/pages/${P}.json`]: json({ id: P, name: "Screens", index: 0 }),
    [`files/${F}/components/comp-1.json`]: json({ id: "comp-1", name: "Button", path: "", mainInstanceId: "c-main", mainInstancePage: P }),
    [`files/${F}/media/med-1.json`]: json({ id: "med-1", name: "logo.png", width: 1, height: 1, mtype: "image/png", mediaId: "obj-1" }),
    "objects/obj-1.json": json({ id: "obj-1", size: PNG.length, contentType: "image/png", bucket: "file-media-object" }),
    "objects/obj-1.png": PNG,
    [`files/${F}/tokens.json`]: json({ sets: {}, themes: {}, activeThemes: [] }),
  };
  for (const [id, sh] of Object.entries(shapes)) files[`files/${F}/pages/${P}/${id}.json`] = json(sh);
  return zipSync(files);
}
