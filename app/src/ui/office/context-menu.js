// Right-click menu of the Office Studio editor, built on the context menu service (ui/context-menu/): the editor opens
// kind "office-document"; the providers below add clipboard, formatting, table, image and AI sections.
import { registerContextProvider, openContextMenu } from "../context-menu/index.js";

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  const isOffice = (ctx) => ctx.kind === "office-document" && !!ctx.data?.editor;
  registerContextProvider({
    id: "office.edit",
    priority: 50,
    matches: isOffice,
    items: (ctx) => {
      const ed = ctx.data.editor;
      const items = ["office.cut", "office.copy", "office.paste", "office.pastePlain", "-", "office.insertLink"];
      if (ed.linkAt()) items.push("office.openLink", "office.removeLink");
      items.push({ label: "Paragraph", items: ["office.bullets", "office.numbering", "office.indent", "office.outdent", "-", "office.paragraph", "office.clearFormatting"] });
      return items;
    },
  });
  registerContextProvider({
    id: "office.table",
    priority: 45,
    matches: (ctx) => isOffice(ctx) && !!ctx.data.editor.tableContext(),
    items: () => [{ label: "Table", icon: "table", items: ["office.rowAbove", "office.rowBelow", "office.colLeft", "office.colRight", "-", "office.deleteRow", "office.deleteCol", "office.deleteTable", "-", "office.mergeCells", "office.splitCell", "office.headerRow", "office.cellShading", "office.tableBorders"] }],
  });
  registerContextProvider({
    id: "office.image",
    priority: 45,
    matches: (ctx) => isOffice(ctx) && !!ctx.data.editor.el.querySelector(".of-oed__img.is-selected"),
    items: () => ["office.imageProperties"],
  });
  registerContextProvider({
    id: "office.ai",
    priority: -20,
    matches: (ctx) => isOffice(ctx) && !!ctx.app.prefs.aiEnabled,
    items: (ctx) => {
      const ed = ctx.data.editor;
      const ai = ctx.app.aiQuick?.officeAiItems?.(ctx.app, () => ({ text: ed.selectedText(), hasSelection: !ed.collapsed })) || [];
      return ai.length ? [{ label: "AI", icon: "stars", items: ai }] : [];
    },
  });
}

export function showOfficeContextMenu(app, editor, x, y, event) {
  register();
  openContextMenu(app, { kind: "office-document", x, y, event, target: editor.flow, selection: editor.collapsed ? "" : editor.selectedText(), data: { editor } });
}
