// Commands of the Presentation app (Office Suite kind "slides"): menus (studios/office.js OFFICE_MENUS with officeKinds
// ["slides"]), the ribbon, context menus and the editor keys run these. Registered lazily the first time the app loads
// (office/slides/app.js), so nothing here is start-up code. Shortcuts shown in menus are handled by the slide canvas
// itself (office/slides/view.js ▸ onKey), because the word processor owns the same keys in the Office studio.
import { registerContextProvider } from "../ui/context-menu/index.js";
import * as M from "../office/slides/model.js";

const S = ["office"];
let done = false;

export function registerSlidesCommands(app) {
  if (done) return;
  done = true;
  const on = (a) => a.studio === "office" && a.officeUI?.kind === "slides";
  const v = () => app.officeUI;
  const hasSel = (a) => on(a) && a.officeUI.sel.size > 0;
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, studios: S, enabled: on, ...extra });
  const deckOp = (label, fn) => () => {
    const view = v();
    view.commit(label, fn(view.deck, view.slide, view));
  };

  // ---- slides
  def("slides.newSlide", "New Slide", (a, o) => {
    const view = v();
    const r = M.addSlide(view.deck, { layout: o?.layout || (view.slide.layout === "title" ? "title-content" : view.slide.layout), after: view.slide.id });
    view.commit("New Slide", r.deck);
    view.goTo(r.id);
  }, { icon: "plus-lg", shortcut: "Mod+M" });
  def("slides.duplicateSlide", "Duplicate Slide", () => {
    const view = v();
    const r = M.duplicateSlide(view.deck, view.slide.id);
    view.commit("Duplicate Slide", r.deck);
    view.goTo(r.id);
  }, { icon: "files" });
  def("slides.deleteSlide", "Delete Slide", deckOp("Delete Slide", (d, s) => M.deleteSlides(d, [s.id])), { icon: "trash" });
  def("slides.hideSlide", "Hide Slide in Show", deckOp("Hide Slide", (d, s) => M.updateSlide(d, s.id, { hidden: !s.hidden })), { icon: "eye-slash", checked: (a) => on(a) && !!a.officeUI.slide.hidden });
  def("slides.moveUp", "Move Slide Up", deckOp("Move Slide", (d, s) => M.moveSlides(d, [s.id], Math.max(0, M.slideIndex(d, s.id) - 1))), { icon: "arrow-up" });
  def("slides.moveDown", "Move Slide Down", deckOp("Move Slide", (d, s) => M.moveSlides(d, [s.id], M.slideIndex(d, s.id) + 1)), { icon: "arrow-down" });
  def("slides.layout", "Apply Layout", (a, o) => v().commit("Apply Layout", M.applyLayout(v().deck, v().slide.id, o?.layout || "title-content")), { icon: "layout-split" });
  def("slides.background", "Slide Background", (a, o) => v().commit("Slide Background", M.updateSlide(v().deck, v().slide.id, { background: o?.color ? { color: o.color } : null })), { icon: "paint-bucket" });
  def("slides.transition", "Slide Transition", (a, o) => v().commit("Transition", M.updateSlide(v().deck, v().slide.id, { transition: { type: o?.type || "none", duration: v().slide.transition.duration } })), { icon: "collection" });
  for (const [type, label] of [["none", "No Transition"], ["fade", "Fade Transition"], ["slide", "Slide-in Transition"]]) {
    def(`slides.transition.${type}`, label, () => app.run("slides.transition", { type }), { checked: (a) => on(a) && a.officeUI.slide.transition.type === type });
  }
  def("slides.theme", "Apply Theme", (a, o) => v().commit("Apply Theme", M.applyTheme(v().deck, o?.theme || "office")), { icon: "palette" });

  // ---- inserting
  def("slides.insertText", "Text Box", () => v().insertText(), { icon: "fonts" });
  def("slides.insertShape", "Shape", (a, o) => v().insertShape(o?.shape || "rect"), { icon: "square" });
  def("slides.insertImage", "Picture…", async () => {
    const { platform } = await import("../platform/index.js");
    const files = await platform.openFiles({ accept: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }], multiple: true });
    for (const f of files || []) await v().insertImageBytes(f.bytes, f.name);
  }, { icon: "image" });
  def("slides.insertTable", "Table", () => v().insertTable(), { icon: "table" });

  // ---- elements
  def("slides.cut", "Cut", () => v().copy(true), { icon: "scissors", enabled: hasSel });
  def("slides.copy", "Copy", () => v().copy(false), { icon: "files", enabled: hasSel });
  def("slides.paste", "Paste", () => v().paste(), { icon: "clipboard" });
  def("slides.duplicate", "Duplicate", () => {
    const view = v();
    const r = M.duplicateElements(view.deck, view.slide.id, [...view.sel]);
    view.commit("Duplicate", r.deck);
    view.select(r.ids);
  }, { enabled: hasSel, shortcut: "Mod+D" });
  def("slides.delete", "Delete", () => {
    const view = v();
    view.commit("Delete", M.deleteElements(view.deck, view.slide.id, [...view.sel]));
    view.select([]);
  }, { icon: "trash", enabled: hasSel });
  def("slides.selectAll", "Select All", () => v().select(v().slide.elements.map((e) => e.id)), {});
  def("slides.editText", "Edit Text", () => v().editText([...v().sel][0]), { enabled: (a) => hasSel(a) && a.officeUI.sel.size === 1 });

  // ---- formatting
  def("slides.format", "Format", (a, o) => v().format(o || {}), { enabled: on });
  def("slides.bold", "Bold", () => v().toggleStyle("bold", "Bold"), {});
  def("slides.italic", "Italic", () => v().toggleStyle("italic", "Italic"), {});
  def("slides.underline", "Underline", () => v().toggleStyle("underline", "Underline"), {});
  def("slides.bullets", "Bullets", () => v().toggleStyle("bullets", "Bullets"), { icon: "list-ul" });
  def("slides.alignLeft", "Align Text Left", () => v().format({ style: { align: "left" } }, "Align"), { icon: "text-left" });
  def("slides.alignCenter", "Center Text", () => v().format({ style: { align: "center" } }, "Align"), { icon: "text-center" });
  def("slides.alignRight", "Align Text Right", () => v().format({ style: { align: "right" } }, "Align"), { icon: "text-right" });

  // ---- arranging
  for (const [id, label, icon, key] of [["front", "Bring to Front", "front", "Mod+Shift+]"], ["back", "Send to Back", "back", "Mod+Shift+["], ["forward", "Bring Forward", "layer-forward", "Mod+]"], ["backward", "Send Backward", "layer-backward", "Mod+["]]) {
    def(`slides.${id}`, label, () => v().commit(label, M.arrange(v().deck, v().slide.id, [...v().sel], id)), { icon, enabled: hasSel, shortcut: key });
  }
  def("slides.align", "Align Objects", (a, o) => v().commit("Align", M.align(v().deck, v().slide.id, [...v().sel], o?.how || "center")), { icon: "align-center", enabled: hasSel });
  for (const [how, label] of [["left", "Align Left Edges"], ["center", "Align Centers"], ["right", "Align Right Edges"], ["top", "Align Tops"], ["middle", "Align Middles"], ["bottom", "Align Bottoms"]]) {
    def(`slides.align.${how}`, label, () => app.run("slides.align", { how }), { enabled: hasSel });
  }
  def("slides.rotate", "Rotate 90°", () => v().commit("Rotate", M.updateElements(v().deck, v().slide.id, [...v().sel], (e) => ({ rot: ((e.rot || 0) + 90) % 360 }))), { icon: "arrow-clockwise", enabled: hasSel });

  // ---- view and show
  def("slides.sorter", "Slide Sorter", () => v().setSorter(), { icon: "grid-3x3-gap", checked: (a) => on(a) && a.officeUI.mode === "sorter" });
  def("slides.present", "Present from Beginning", () => v().present(), { icon: "play-btn", shortcut: "F5" });
  def("slides.presentCurrent", "Present from Current Slide", () => v().present({ fromCurrent: true }), { icon: "play-circle", shortcut: "Shift+F5" });
  def("slides.presenterView", "Presenter View", () => v().present({ fromCurrent: true, presenter: true }), { icon: "display", shortcut: "Alt+F5" });
  def("slides.export", "Export Presentation…", () => v().exportDialog(), { icon: "box-arrow-up" });

  // ---- context menus (docs/context-menus.md)
  const isSlides = (ctx) => ctx.kind === "office-slides" && !!ctx.data?.view;
  registerContextProvider({
    id: "slides.element",
    priority: 50,
    matches: (ctx) => isSlides(ctx) && ctx.data.target === "element",
    items: () => ["slides.cut", "slides.copy", "slides.paste", "slides.duplicate", "slides.delete", "-", "slides.editText", { label: "Arrange", icon: "layers", items: ["slides.front", "slides.forward", "slides.backward", "slides.back"] }, { label: "Align", icon: "align-center", items: ["slides.align.left", "slides.align.center", "slides.align.right", "-", "slides.align.top", "slides.align.middle", "slides.align.bottom"] }, "slides.rotate"],
  });
  registerContextProvider({
    id: "slides.slide",
    priority: 50,
    matches: (ctx) => isSlides(ctx) && ctx.data.target === "slide",
    items: () => ["slides.paste", "slides.selectAll", "-", "slides.insertText", "slides.insertShape", "slides.insertImage", "slides.insertTable", "-", { label: "Transition", icon: "collection", items: ["slides.transition.none", "slides.transition.fade", "slides.transition.slide"] }, "slides.newSlide"],
  });
  registerContextProvider({
    id: "slides.thumb",
    priority: 50,
    matches: (ctx) => isSlides(ctx) && ctx.data.target === "thumb",
    items: () => ["slides.newSlide", "slides.duplicateSlide", "slides.deleteSlide", "slides.hideSlide", "-", "slides.moveUp", "slides.moveDown", "-", "slides.presentCurrent"],
  });
}
