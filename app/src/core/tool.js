// Base class for canvas tools. Tools receive pointer events in PAGE coordinates (e.x, e.y).

export class Tool {
  /** @param {import('./app.js').App} app */
  constructor(app) {
    this.app = app;
  }

  /** Unique id, e.g. 'move'. */
  static id = "tool";
  static label = "Tool";
  /** Shoelace icon name in the 'of' library. */
  static icon = "cursor";
  static shortcut = "";
  /** Studios in which this tool is available. */
  static studios = ["vector", "pixel", "layout"];
  /** Tools sharing a flyout group id appear stacked in the toolbox. */
  static group = null;
  /** Options shown in the context toolbar: array of Control schema entries (see engine contracts). */
  static options = [];

  get id() {
    return this.constructor.id;
  }
  get doc() {
    return this.app.doc;
  }
  get opts() {
    return this.app.toolOptions(this.id);
  }

  cursor = "default";

  activate() {}
  deactivate() {}
  pointerDown(_e) {}
  pointerMove(_e) {}
  pointerUp(_e) {}
  /** Hover without buttons. */
  hover(_e) {}
  doubleClick(_e) {}
  keyDown(_e) {
    return false;
  }
  keyUp(_e) {
    return false;
  }
  /** Draws tool UI (handles, previews) on the overlay canvas in screen space. */
  overlay(_ctx, _view) {}
  /** Called when the selection or document changes while this tool is active. */
  refresh() {}
  /** Escape / tool switch: abandon an in-progress operation. */
  cancel() {}
  /** Optional extra context-bar content: return a DOM node or null. */
  contextBar() {
    return null;
  }
}
