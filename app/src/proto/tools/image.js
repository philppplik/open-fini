// The Image tool of the Proto Studio (Shift+Ctrl/Cmd+K, docs/concepts/proto-studio.md §5.2, task T8): a click on
// the canvas asks for pictures and places them there as image layers at their pixel size (into the frame under the
// pointer, in its flow when it has auto layout); the media go into the design through the `media.put` operation, so
// placing is ONE undo step. Dropping or pasting pictures does the same without the tool (proto/paste.js).
export function createImageTool(ws) {
  return {
    id: "image",
    cursor: "copy",
    down({ e, world }) {
      if (ws.readOnly || e.button !== 0) return false;
      const at = { x: Math.round(world.x), y: Math.round(world.y) };
      ws.tools.set("move");
      import("../paste.js")
        .then((P) => P.chooseImages(ws, ws.app, { at }))
        .catch((err) => ws.app.toast(err.message, "danger", 5000));
      return false;
    },
  };
}
