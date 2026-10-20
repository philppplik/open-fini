// The OpenFini document: pages (artboards / print pages), a scene graph per page, shared
// assets, text stories, styles and swatches — with transactional, undoable edits.
import { Emitter, uid, clone, equal } from "./util.js";
import { History } from "./history.js";
import { createNode, walk } from "./nodes.js";
import { DEFAULT_SWATCHES } from "./color.js";

const UNDEF = Symbol("undef");

export function createCanvas(w, h) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

export const ctx2d = (canvas) => canvas.getContext("2d", { willReadFrequently: true });

export function makePage(o = {}) {
  return {
    id: uid("p"),
    name: o.name || "Page 1",
    x: o.x ?? 0,
    y: o.y ?? 0,
    w: o.w ?? 1920,
    h: o.h ?? 1080,
    bg: o.bg === undefined ? "#ffffff" : o.bg, // null = transparent
    root: createNode("group", { name: "Root" }),
    masterId: o.masterId ?? null,
    margins: o.margins || { top: 0, right: 0, bottom: 0, left: 0 },
    columns: o.columns || 1,
    gutter: o.gutter ?? 12,
    bleed: o.bleed ?? 0,
    guides: o.guides || { h: [], v: [] },
  };
}

export class Doc extends Emitter {
  /**
   * @param {{name?:string,width?:number,height?:number,dpi?:number,unit?:string,bg?:string|null,studio?:string,pages?:number}} [o]
   */
  constructor(o = {}) {
    super();
    this.id = uid("d");
    this.name = o.name || "Untitled";
    this.dpi = o.dpi || 96;
    this.unit = o.unit || "px";
    this.studio = o.studio || "vector"; // studio the document was created in
    this.createdAt = Date.now();
    this.modifiedAt = this.createdAt;
    this.pages = [];
    this.masters = [];
    this.assets = {}; // id → {id, name, mime, w, h, bytes?: Uint8Array, _bitmap}
    this.pixels = new Map(); // node id → canvas (runtime; saved as PNG)
    this.stories = {}; // id → {id, story, defaults?}
    this.styles = { paragraph: {}, character: {} };
    this.swatches = DEFAULT_SWATCHES.map((c, i) => ({ id: `sw${i}`, name: c, color: c }));
    this.slices = []; // export slices {id,name,page,x,y,w,h}
    this.tableStyles = {}; // saved table styles {id: {name, style}} (engine/layout/table-styles.js)
    this.web = null; // website project of the Code studio (core/web.js), stored next to the design data
    this.settings = { snap: true, snapObjects: true, snapGrid: false, grid: { size: 32, subdivisions: 4, visible: false }, guidesVisible: true };
    this.history = new History();
    this.rev = 0;
    this.saved = true;
    this._tx = null;
    this._index = new Map();
    const count = o.pages || 1;
    for (let i = 0; i < count; i++) {
      const page = makePage({ name: `Page ${i + 1}`, w: o.width ?? 1920, h: o.height ?? 1080, bg: o.bg, x: i * ((o.width ?? 1920) + 80) });
      this.pages.push(page);
    }
    this.relink();
  }

  // ------------------------------------------------------------ indexing

  /** Rebuilds parent pointers and the id index. Call after loading or bulk surgery. */
  relink() {
    this._index.clear();
    const visit = (node, parent, page) => {
      node._parent = parent;
      node._page = page;
      this._index.set(node.id, node);
      if (node.children) for (const c of node.children) visit(c, node, page);
      if (node.mask) visit(node.mask, node, page);
    };
    for (const p of [...this.pages, ...this.masters]) {
      p.root._page = p;
      visit(p.root, null, p);
    }
  }

  find(id) {
    return this._index.get(id) || null;
  }

  pageOf(node) {
    return node?._page || null;
  }

  page(id) {
    return this.pages.find((p) => p.id === id) || this.masters.find((p) => p.id === id) || null;
  }

  /** Iterates every node of every page (and masters when asked). */
  walkAll(fn, { masters = false } = {}) {
    for (const p of masters ? [...this.pages, ...this.masters] : this.pages) walk(p.root, fn);
  }

  #indexSubtree(node, page, parent, add) {
    walk(node, (n, p) => {
      if (add) {
        this._index.set(n.id, n);
        n._page = page;
        if (n === node) n._parent = parent;
        else if (p) n._parent = p;
      } else this._index.delete(n.id);
    });
  }

  // ------------------------------------------------------------ transactions

  /**
   * Runs `fn` as one undoable step. Nested calls join the outer transaction.
   * `opts.coalesce` merges consecutive transactions with the same key (e.g. slider drags).
   */
  tx(label, fn, opts = {}) {
    if (this._tx) return fn();
    const t = { label, ops: [], bytes: 0, touched: new Set(), structure: false, meta: false, key: opts.coalesce || null };
    this._tx = t;
    let result;
    try {
      result = fn();
    } catch (err) {
      this._tx = null;
      for (let i = t.ops.length - 1; i >= 0; i--) t.ops[i].undo();
      this.#emitChange(t);
      throw err;
    }
    this._tx = null;
    if (t.ops.length) {
      this.history.push({ label, ops: t.ops, bytes: t.bytes, key: t.key, touched: t.touched, structure: t.structure, meta: t.meta });
      this.#dirty();
    }
    this.#emitChange(t);
    return result;
  }

  #dirty() {
    this.rev++;
    this.modifiedAt = Date.now();
    this.saved = false;
  }

  #emitChange(t) {
    this.emit("change", { nodes: t.touched, structure: t.structure, meta: t.meta, label: t.label });
  }

  /** Executes (unless `execute:false`) and records a reversible op inside the active transaction. */
  _do(op, { execute = true, label = "Edit" } = {}) {
    const run = () => {
      const t = this._tx;
      if (execute) op.redo();
      t.ops.push(op);
      t.bytes += op.bytes || 0;
      for (const n of op.touched || []) t.touched.add(n);
      if (op.structure) t.structure = true;
      if (op.meta) t.meta = true;
    };
    if (this._tx) run();
    else this.tx(label, run);
  }

  /** Marks a node (and its ancestors) as changed so render caches are invalidated. */
  touch(node, _chained = false) {
    for (let n = node; n; n = n._parent) n._rev = (n._rev | 0) + 1;
    // text frames of one linked story re-flow together
    if (!_chained && node.type === "text" && node.linked && node.storyId) {
      for (const f of this.framesOfStory(node.storyId)) if (f !== node) this.touch(f, true);
    }
  }

  /** Replaces the document's paragraph/character styles (undoable); all text re-lays out. */
  setStyles(styles, label = "Edit Styles") {
    const prev = clone(this.styles);
    const next = clone(styles);
    const texts = [];
    this.walkAll((n) => n.type === "text" && texts.push(n), { masters: true });
    this.tx(label, () =>
      this._do(
        {
          redo: () => {
            this.styles = clone(next);
            for (const t of texts) this.touch(t);
          },
          undo: () => {
            this.styles = clone(prev);
            for (const t of texts) this.touch(t);
          },
          touched: texts,
          meta: true,
        },
        { label },
      ),
    );
  }

  /** Positions pages on the pasteboard: single column of spreads when `facing`, otherwise side by side. */
  relayoutPages(facing = this.settings.facing) {
    const gap = 80;
    const pages = this.pages;
    this.tx("Arrange Pages", () => {
      let x = 0;
      if (!facing) {
        for (const p of pages) {
          this.set(p, { x, y: 0 });
          x += p.w + gap;
        }
        return;
      }
      // facing pages: page 1 is a lone right-hand page, then left/right pairs share a spread
      let i = 0;
      if (pages.length) {
        this.set(pages[0], { x: pages[0].w, y: 0 });
        x = pages[0].w * 2 + gap;
        i = 1;
      }
      for (; i < pages.length; i += 2) {
        const left = pages[i];
        const right = pages[i + 1];
        this.set(left, { x, y: 0 });
        if (right) this.set(right, { x: x + left.w, y: 0 });
        x += left.w + (right ? right.w : left.w) + gap;
      }
    });
  }

  undo() {
    const e = this.history.undo();
    if (e) this.#afterHistory(e);
    return !!e;
  }
  redo() {
    const e = this.history.redo();
    if (e) this.#afterHistory(e);
    return !!e;
  }
  #afterHistory(e) {
    this.rev++;
    this.modifiedAt = Date.now();
    this.saved = false;
    this.emit("change", { nodes: e.touched || new Set(), structure: !!e.structure, meta: !!e.meta, label: e.label, history: true });
  }

  // ------------------------------------------------------------ primitive edits

  /** Shallow-patches any plain object (node, page, style, doc). Values are deep-cloned. */
  set(target, patch, label = "Edit") {
    const prev = {};
    const next = {};
    let changed = false;
    for (const k in patch) {
      if (!equal(target[k], patch[k])) {
        prev[k] = target[k] === undefined ? UNDEF : clone(target[k]);
        next[k] = patch[k] === undefined ? UNDEF : clone(patch[k]);
        changed = true;
      }
    }
    if (!changed) return false;
    this._do(this.#setOp(target, prev, next), { label });
    return true;
  }

  #setOp(target, prev, next) {
    const isNode = typeof target.type === "string" && target.id && target.m !== undefined;
    const assign = (src) => {
      for (const k in src) {
        if (src[k] === UNDEF) delete target[k];
        else target[k] = clone(src[k]);
      }
      if (isNode) this.touch(target);
    };
    let bytes = 0;
    if (prev.path || next.path) bytes = 256;
    return {
      redo: () => assign(next),
      undo: () => assign(prev),
      touched: isNode ? [target] : [],
      meta: !isNode,
      bytes,
    };
  }

  /**
   * Snapshot helper for interactive edits that mutate nodes live (drags, handles). Call
   * `const before = doc.snapshot(node, ['m'])`, mutate freely, then `doc.recordSet(node, before)`.
   */
  snapshot(target, keys) {
    const s = {};
    for (const k of keys) s[k] = target[k] === undefined ? UNDEF : clone(target[k]);
    return s;
  }

  /** Records an already-applied edit (current values vs `before`) as an undoable step. */
  recordSet(target, before, label = "Edit", opts) {
    const prev = {};
    const next = {};
    let changed = false;
    for (const k in before) {
      const cur = target[k];
      const old = before[k] === UNDEF ? undefined : before[k];
      if (!equal(cur, old)) {
        prev[k] = before[k];
        next[k] = cur === undefined ? UNDEF : clone(cur);
        changed = true;
      }
    }
    if (!changed) return false;
    this.tx(label, () => this._do(this.#setOp(target, prev, next), { execute: false }), opts);
    return true;
  }

  insert(node, parent, index = parent.children.length) {
    const page = parent._page;
    const op = {
      redo: () => {
        parent.children.splice(index, 0, node);
        this.#indexSubtree(node, page, parent, true);
        this.touch(parent);
      },
      undo: () => {
        const i = parent.children.indexOf(node);
        if (i >= 0) parent.children.splice(i, 1);
        this.#indexSubtree(node, page, parent, false);
        this.touch(parent);
      },
      touched: [parent, node],
      structure: true,
    };
    this._do(op, { label: "Add Layer" });
    return node;
  }

  remove(node) {
    const parent = node._parent;
    if (!parent) return;
    const index = parent.children.indexOf(node);
    const page = node._page;
    const op = {
      redo: () => {
        const i = parent.children.indexOf(node);
        if (i >= 0) parent.children.splice(i, 1);
        this.#indexSubtree(node, page, parent, false);
        this.touch(parent);
      },
      undo: () => {
        parent.children.splice(index, 0, node);
        this.#indexSubtree(node, page, parent, true);
        this.touch(parent);
      },
      touched: [parent],
      structure: true,
    };
    this._do(op, { label: "Delete" });
  }

  /** Moves a node under `parent` at `index`. Keeps the node's own transform (callers adjust `m` when changing spaces). */
  move(node, parent, index) {
    const from = node._parent;
    const fromIndex = from.children.indexOf(node);
    const toPage = parent._page;
    const fromPage = node._page;
    const op = {
      redo: () => {
        const i = from.children.indexOf(node);
        if (i >= 0) from.children.splice(i, 1);
        let at = index;
        if (from === parent && i >= 0 && i < index) at = index - 1;
        parent.children.splice(Math.max(0, Math.min(parent.children.length, at)), 0, node);
        node._parent = parent;
        walk(node, (n) => {
          n._page = toPage;
        });
        this.touch(from);
        this.touch(parent);
      },
      undo: () => {
        const i = parent.children.indexOf(node);
        if (i >= 0) parent.children.splice(i, 1);
        from.children.splice(fromIndex, 0, node);
        node._parent = from;
        walk(node, (n) => {
          n._page = fromPage;
        });
        this.touch(from);
        this.touch(parent);
      },
      touched: [from, parent, node],
      structure: true,
    };
    this._do(op, { label: "Arrange" });
  }

  /** Sets (or clears) the mask node of a layer. */
  setMask(node, mask) {
    const prev = node.mask || null;
    const page = node._page;
    const op = {
      redo: () => {
        if (prev) this.#indexSubtree(prev, page, node, false);
        if (mask) {
          this.#indexSubtree(mask, page, node, true);
          node.mask = mask;
        } else delete node.mask;
        this.touch(node);
      },
      undo: () => {
        if (mask) this.#indexSubtree(mask, page, node, false);
        if (prev) {
          this.#indexSubtree(prev, page, node, true);
          node.mask = prev;
        } else delete node.mask;
        this.touch(node);
      },
      touched: [node],
      structure: true,
    };
    this._do(op, { label: mask ? "Add Mask" : "Remove Mask" });
  }

  /** Generic array helpers for swatches/slices/guides/etc. */
  arrayInsert(arr, item, index = arr.length, label = "Edit") {
    this._do(
      {
        redo: () => arr.splice(index, 0, item),
        undo: () => {
          const i = arr.indexOf(item);
          if (i >= 0) arr.splice(i, 1);
        },
        meta: true,
      },
      { label },
    );
    return item;
  }

  arrayRemove(arr, item, label = "Edit") {
    const index = arr.indexOf(item);
    if (index < 0) return;
    this._do(
      {
        redo: () => {
          const i = arr.indexOf(item);
          if (i >= 0) arr.splice(i, 1);
        },
        undo: () => arr.splice(index, 0, item),
        meta: true,
      },
      { label },
    );
  }

  // ------------------------------------------------------------ pages

  addPage(opts = {}, index = this.pages.length) {
    const ref = this.pages[Math.min(index, this.pages.length) - 1] || this.pages[0];
    const page = makePage({
      name: opts.name || `Page ${this.pages.length + 1}`,
      w: opts.w ?? ref?.w ?? 1920,
      h: opts.h ?? ref?.h ?? 1080,
      bg: opts.bg === undefined ? ref?.bg ?? "#ffffff" : opts.bg,
      x: opts.x ?? (ref ? ref.x + ref.w + 80 : 0),
      y: opts.y ?? ref?.y ?? 0,
      margins: opts.margins || (ref ? { ...ref.margins } : undefined),
      columns: opts.columns ?? ref?.columns,
      gutter: opts.gutter ?? ref?.gutter,
      bleed: opts.bleed ?? ref?.bleed,
      masterId: opts.masterId ?? ref?.masterId ?? null,
    });
    this._do(
      {
        redo: () => {
          this.pages.splice(index, 0, page);
          page.root._page = page;
          this.#indexSubtree(page.root, page, null, true);
        },
        undo: () => {
          const i = this.pages.indexOf(page);
          if (i >= 0) this.pages.splice(i, 1);
          this.#indexSubtree(page.root, page, null, false);
        },
        touched: [page.root],
        structure: true,
        meta: true,
      },
      { label: "Add Page" },
    );
    return page;
  }

  removePage(page) {
    if (this.pages.length < 2) return false;
    const index = this.pages.indexOf(page);
    if (index < 0) return false;
    this._do(
      {
        redo: () => {
          const i = this.pages.indexOf(page);
          if (i >= 0) this.pages.splice(i, 1);
          this.#indexSubtree(page.root, page, null, false);
        },
        undo: () => {
          this.pages.splice(index, 0, page);
          this.#indexSubtree(page.root, page, null, true);
        },
        touched: [page.root],
        structure: true,
        meta: true,
      },
      { label: "Delete Page" },
    );
    return true;
  }

  movePage(page, toIndex) {
    const from = this.pages.indexOf(page);
    if (from < 0 || from === toIndex) return;
    this._do(
      {
        redo: () => {
          this.pages.splice(from, 1);
          this.pages.splice(toIndex, 0, page);
        },
        undo: () => {
          this.pages.splice(toIndex, 1);
          this.pages.splice(from, 0, page);
        },
        structure: true,
        meta: true,
      },
      { label: "Move Page" },
    );
  }

  addMaster(name = "Master A") {
    const m = makePage({ name, w: this.pages[0]?.w, h: this.pages[0]?.h, bg: null });
    this._do(
      {
        redo: () => {
          this.masters.push(m);
          m.root._page = m;
          this.#indexSubtree(m.root, m, null, true);
        },
        undo: () => {
          const i = this.masters.indexOf(m);
          if (i >= 0) this.masters.splice(i, 1);
          this.#indexSubtree(m.root, m, null, false);
        },
        structure: true,
        meta: true,
      },
      { label: "Add Master" },
    );
    return m;
  }

  // ------------------------------------------------------------ stories & assets

  /** Creates a story (rich text content shared by one or more linked text frames). */
  createStory(story, id = uid("s")) {
    const entry = { id, story };
    this._do({ redo: () => (this.stories[id] = entry), undo: () => delete this.stories[id], meta: true }, { label: "New Story" });
    return id;
  }

  setStory(id, story, label = "Edit Text", opts) {
    const entry = this.stories[id];
    if (!entry) return;
    const prev = entry.story;
    const frames = this.framesOfStory(id);
    this.tx(
      label,
      () =>
        this._do(
          {
            redo: () => {
              entry.story = story;
              for (const f of frames) this.touch(f);
            },
            undo: () => {
              entry.story = prev;
              for (const f of frames) this.touch(f);
            },
            touched: frames,
            bytes: 128,
          },
          { label },
        ),
      opts,
    );
  }

  /** Replaces the default character/paragraph attributes of a story (used for empty text and style fallbacks). */
  setStoryDefaults(id, defaults, label = "Text Style") {
    const entry = this.stories[id];
    if (!entry) return;
    const prev = entry.defaults ? clone(entry.defaults) : undefined;
    const next = clone(defaults);
    const frames = this.framesOfStory(id);
    this.tx(label, () =>
      this._do(
        {
          redo: () => {
            entry.defaults = clone(next);
            for (const f of frames) this.touch(f);
          },
          undo: () => {
            if (prev) entry.defaults = clone(prev);
            else delete entry.defaults;
            for (const f of frames) this.touch(f);
          },
          touched: frames,
        },
        { label },
      ),
    );
  }

  /** Text frames displaying a story, in flow order. */
  framesOfStory(id) {
    const frames = [];
    this.walkAll((n) => {
      if (n.type === "text" && n.storyId === id) frames.push(n);
    });
    frames.sort((a, b) => (a.flowIndex ?? 0) - (b.flowIndex ?? 0));
    return frames;
  }

  addAsset(asset) {
    const id = asset.id || uid("a");
    this._do({ redo: () => (this.assets[id] = { ...asset, id }), undo: () => delete this.assets[id], meta: true }, { label: "Add Asset" });
    return id;
  }

  // ------------------------------------------------------------ pixel layers

  /** The backing canvas of a pixel node, created transparent on demand. */
  getPixels(node) {
    let c = this.pixels.get(node.id);
    if (!c) {
      c = createCanvas(node.w, node.h);
      this.pixels.set(node.id, c);
    }
    return c;
  }

  setPixelCanvas(node, canvas) {
    this.pixels.set(node.id, canvas);
    this.touch(node);
  }

  /** Records a rectangular pixel edit (ImageData before/after) as undoable. Edit is already applied. */
  recordPixelEdit(node, x, y, before, after, label = "Paint") {
    const op = {
      redo: () => {
        ctx2d(this.getPixels(node)).putImageData(after, x, y);
        this.touch(node);
      },
      undo: () => {
        ctx2d(this.getPixels(node)).putImageData(before, x, y);
        this.touch(node);
      },
      touched: [node],
      bytes: before.data.length + after.data.length,
    };
    this.tx(label, () => this._do(op, { execute: false }), { coalesce: null });
  }

  /** Replaces a pixel layer's whole bitmap (filters, resize, crop). Optionally updates width/height/matrix. */
  replacePixels(node, canvas, props = {}, label = "Edit Pixels") {
    const old = this.pixels.get(node.id) || null;
    const oldProps = {};
    for (const k in props) oldProps[k] = clone(node[k]);
    const op = {
      redo: () => {
        this.pixels.set(node.id, canvas);
        for (const k in props) node[k] = clone(props[k]);
        this.touch(node);
      },
      undo: () => {
        if (old) this.pixels.set(node.id, old);
        else this.pixels.delete(node.id);
        for (const k in oldProps) node[k] = clone(oldProps[k]);
        this.touch(node);
      },
      touched: [node],
      bytes: old ? old.width * old.height * 4 : 0,
    };
    this.tx(label, () => this._do(op, { label }));
  }

  // ------------------------------------------------------------ tree helpers

  /** Deep-clones a node (new ids), copying pixel data and optionally nested masks. */
  cloneNode(node) {
    const copy = clone(node);
    const remap = (src, dst) => {
      dst.id = uid("n");
      if (src.type === "pixel") {
        const sc = this.pixels.get(src.id);
        if (sc) {
          const nc = createCanvas(sc.width, sc.height);
          nc.getContext("2d").drawImage(sc, 0, 0);
          this.pixels.set(dst.id, nc);
        }
      }
      if (src.children) src.children.forEach((c, i) => remap(c, dst.children[i]));
      if (src.mask && dst.mask) remap(src.mask, dst.mask);
    };
    remap(node, copy);
    return copy;
  }

  /** Top-level selectable ancestor chain helper: the child of `root` containing `node`. */
  topLevelOf(node, root) {
    let n = node;
    while (n && n._parent !== root) n = n._parent;
    return n || null;
  }

  // ------------------------------------------------------------ serialization

  toJSON() {
    const gc = new Set();
    this.walkAll((n) => {
      if (n.type === "text" && n.storyId) gc.add(n.storyId);
    }, { masters: true });
    const stories = {};
    for (const id of gc) if (this.stories[id]) stories[id] = this.stories[id];
    return JSON.parse(
      JSON.stringify(
        {
          format: "openfini",
          version: 1,
          id: this.id,
          name: this.name,
          dpi: this.dpi,
          unit: this.unit,
          studio: this.studio,
          createdAt: this.createdAt,
          modifiedAt: this.modifiedAt,
          pages: this.pages,
          masters: this.masters,
          assets: Object.values(this.assets).map(({ id, name, mime, w, h }) => ({ id, name, mime, w, h })),
          stories,
          styles: this.styles,
          swatches: this.swatches,
          slices: this.slices,
          tableStyles: this.tableStyles,
          settings: this.settings,
          web: this.web ? this.web.manifest() : undefined,
        },
        (k, v) => (k.charCodeAt(0) === 95 ? undefined : v),
      ),
    );
  }

  static fromJSON(json) {
    if (!json || json.format !== "openfini") throw new Error("Not an OpenFini document.");
    const d = new Doc({ name: json.name, dpi: json.dpi, unit: json.unit, studio: json.studio, pages: 1 });
    d.id = json.id || d.id;
    d.createdAt = json.createdAt || d.createdAt;
    d.modifiedAt = json.modifiedAt || d.modifiedAt;
    d.pages = json.pages || [];
    d.masters = json.masters || [];
    d.stories = json.stories || {};
    d.styles = json.styles || { paragraph: {}, character: {} };
    d.swatches = json.swatches || d.swatches;
    d.slices = json.slices || [];
    d.tableStyles = json.tableStyles && typeof json.tableStyles === "object" ? json.tableStyles : {};
    d.settings = { ...d.settings, ...(json.settings || {}) };
    d.assets = {};
    for (const a of json.assets || []) d.assets[a.id] = { ...a };
    if (!d.pages.length) d.pages.push(makePage());
    d.relink();
    d.saved = true;
    return d;
  }
}
