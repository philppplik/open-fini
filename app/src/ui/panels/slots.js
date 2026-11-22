// Panel slots: dockable panels whose content belongs to the studio's current document or app instance (Code
// workspace, Scene editor, Office apps, Vibe). The panel (a registry entry, see slotPanel in ./index.js) is created once
// and moved by the docking engine; the studio instance publishes its content with setPanelSlot(app, id, { el, show? })
// and takes it back with setPanelSlot(app, id, null). Content is moved, never rebuilt, so it keeps its state.
/** Empties every slot whose id starts with `prefix` ("code-"). */
export function clearPanelSlots(app, prefix) {
  for (const id of [...(app.panelSlots?.keys() || [])]) if (id.startsWith(prefix)) setPanelSlot(app, id, null);
}

export function setPanelSlot(app, id, content) {
  const slots = (app.panelSlots ||= new Map());
  if (content) slots.set(id, content);
  else slots.delete(id);
  app.emit("panelslot", id);
}
