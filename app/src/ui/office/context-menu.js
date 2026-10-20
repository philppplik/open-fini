// Right-click menu of the Office Studio editor (clipboard, formatting, tables, images, AI quick actions).
import { showContextMenu } from "../menus.js";

export function showOfficeContextMenu(app, editor, x, y) {
  const items = ["office.cut", "office.copy", "office.paste", "office.pastePlain", "-", "office.insertLink"];
  if (editor.linkAt()) items.push("office.openLink", "office.removeLink");
  items.push({ label: "Paragraph", items: ["office.bullets", "office.numbering", "office.indent", "office.outdent", "-", "office.paragraph", "office.clearFormatting"] });
  if (editor.tableContext()) items.push("-", { label: "Table", items: ["office.rowAbove", "office.rowBelow", "office.colLeft", "office.colRight", "-", "office.deleteRow", "office.deleteCol", "office.deleteTable", "-", "office.mergeCells", "office.splitCell", "office.headerRow", "office.cellShading", "office.tableBorders"] });
  if (editor.el.querySelector(".of-oed__img.is-selected")) items.push("-", "office.imageProperties");
  const ai = app.aiQuick?.officeAiItems?.(app, () => ({ text: editor.selectedText(), hasSelection: !editor.collapsed })) || [];
  if (ai.length) items.push("-", { label: "AI", icon: "stars", items: ai });
  showContextMenu(app, x, y, items);
}
