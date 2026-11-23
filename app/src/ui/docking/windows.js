// Torn-off panel windows (ADR 0033 ▸ Tear-off, docs/workspaces.md). A torn-off panel group lives in a window of its
// own: a native window on the desktop (src-tauri/src/lib.rs opens `about:blank#openfini-panel` as a WebviewWindow that
// keeps the opener relationship), a popup window in the browser. The window is an empty same-origin page; the main
// window keeps running the panel and only moves the panel's element into that page. So the panel stays the very same
// object (state, listeners, live updates from the document), there is no second copy to keep in sync.
//
// What this module adds on top of moving DOM nodes between documents:
//   * the page gets the main window's style sheets and root attributes (theme, surface, font size), kept in sync;
//   * Shadow DOM styles: Shoelace (Lit) components style their shadow roots with constructed style sheets, which a
//     browser drops when the element moves to another document and refuses to share across documents. The sheet bridge
//     remembers the sheets each shadow root asked for and gives it a copy built in the document it lives in now;
//   * closing the window is reported once (onClose), position and size changes are reported (onRect), shortcuts with
//     Ctrl/Cmd reach the main window, and the page's own context menu (Reload, Back) is suppressed.
// The pure layout side (which groups are torn off, where they go back) is model.js (`win: true` floating entries).

const MARK = "openfini-panel";
const WIN_URL = `about:blank#${MARK}`;

// ------------------------------------------------------------------ sheet bridge (constructed style sheets)

const wanted = new WeakMap(); // ShadowRoot -> the sheets it was given (as constructed in the main document)
const copies = new WeakMap(); // CSSStyleSheet -> Map(Document -> copy built in that document)
let desc = null;

/** Installs the bridge once: setting `adoptedStyleSheets` on a shadow root in another document uses copies. */
export function installSheetBridge() {
  if (desc !== null || typeof ShadowRoot === "undefined") return;
  desc = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, "adoptedStyleSheets") || false;
  if (!desc?.set || !desc.get) return;
  const { get, set } = desc;
  Object.defineProperty(ShadowRoot.prototype, "adoptedStyleSheets", {
    configurable: true,
    enumerable: desc.enumerable,
    get() {
      return get.call(this);
    },
    set(sheets) {
      const list = [...sheets];
      wanted.set(this, list);
      set.call(this, sheetsFor(list, this.ownerDocument));
    },
  });
}

function sheetsFor(list, doc) {
  if (!doc || doc === document) return list;
  return list.map((s) => copyOf(s, doc) || s);
}

function copyOf(sheet, doc) {
  const W = doc.defaultView;
  if (!W?.CSSStyleSheet) return null;
  let m = copies.get(sheet);
  if (!m) copies.set(sheet, (m = new Map()));
  let c = m.get(doc);
  if (!c) {
    c = new W.CSSStyleSheet();
    try {
      c.replaceSync([...sheet.cssRules].map((r) => r.cssText).join("\n"));
    } catch {
      /* a rule the copy refuses (e.g. @import) is left out */
    }
    m.set(doc, c);
  }
  return c;
}

/** Every open shadow root under `root` (including nested ones). */
function eachShadow(root, fn) {
  const doc = root.ownerDocument || root;
  const tw = doc.createTreeWalker(root, 1 /* NodeFilter.SHOW_ELEMENT */);
  for (let n = tw.currentNode; n; n = tw.nextNode()) {
    if (n.shadowRoot) {
      fn(n.shadowRoot);
      eachShadow(n.shadowRoot, fn);
    }
  }
}

/** Remembers the sheets of shadow roots that got them before the bridge was installed. Call before a move. */
export function captureSheets(root) {
  if (!desc?.get || !root) return;
  eachShadow(root, (sr) => {
    if (wanted.has(sr)) return;
    const cur = desc.get.call(sr);
    if (cur.length) wanted.set(sr, [...cur]);
  });
}

/** Gives shadow roots under `root` their sheets again after a move to another document. Call after a move. */
export function restyle(root) {
  if (!desc?.set || !root) return;
  eachShadow(root, (sr) => {
    const want = wanted.get(sr);
    if (!want?.length || desc.get.call(sr).length) return;
    try {
      desc.set.call(sr, sheetsFor(want, sr.ownerDocument));
    } catch {
      /* the document is gone */
    }
  });
}

// ------------------------------------------------------------------ windows

const typing = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|SL-INPUT|SL-TEXTAREA|SL-SELECT)$/.test(t.tagName));
let unloading = false;
const open = new Set();
if (typeof window !== "undefined") {
  // closing or reloading the main window takes its panel windows along; they are not "closed by the user" then, so
  // the layout keeps them torn off and they open again next time
  window.addEventListener("pagehide", () => {
    unloading = true;
    for (const h of [...open]) h.close();
  });
}

/**
 * Opens a panel window at `rect` (screen px). Returns a handle or null when the window could not be opened (a browser
 * blocks popups without a click). Run it inside the user gesture in the browser.
 * @param {{ name: string, rect: {x:number,y:number,w:number,h:number}, title: string, onClose: () => void,
 *   onRect: (r: {x:number,y:number,w:number,h:number}) => void, onKey?: (e: KeyboardEvent) => void }} o
 */
export function openPanelWindow(o) {
  installSheetBridge();
  const { x, y, w, h } = o.rect;
  let win = null;
  try {
    win = window.open(WIN_URL, o.name, `popup=yes,width=${w},height=${h},left=${x},top=${y}`);
  } catch {
    win = null;
  }
  let doc = null;
  try {
    doc = win?.document; // null or throwing: not a same-origin window (should not happen)
  } catch {
    doc = null;
  }
  if (!win || !doc?.body) {
    try {
      win?.close();
    } catch {
      /* ignore */
    }
    return null;
  }

  const off = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    off.push(() => target.removeEventListener(type, fn, opts));
  };

  // ---- page: base URL, style sheets and root attributes of the main window
  doc.head.replaceChildren();
  doc.body.replaceChildren();
  const base = doc.createElement("base");
  base.href = document.baseURI;
  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  doc.head.append(meta, base);
  const mirrored = new Map(); // main <link>/<style> -> copy
  const copySheet = (node) => {
    if (mirrored.has(node) || !(node.matches?.("link[rel~='stylesheet'], style"))) return;
    const c = doc.importNode(node, true);
    if (node.tagName === "LINK") c.setAttribute("href", node.href);
    mirrored.set(node, c);
    doc.head.append(c);
  };
  for (const n of document.head.children) copySheet(n);
  const headObs = new MutationObserver((list) => {
    for (const m of list) {
      m.addedNodes.forEach(copySheet);
      m.removedNodes.forEach((n) => {
        mirrored.get(n)?.remove();
        mirrored.delete(n);
      });
    }
  });
  headObs.observe(document.head, { childList: true });
  if (document.adoptedStyleSheets?.length) doc.adoptedStyleSheets = sheetsFor([...document.adoptedStyleSheets], doc);

  const SKIP_ATTR = new Set(["data-native-glass"]); // the window has no native material behind a transparent page
  const syncRoot = () => {
    const src = document.documentElement;
    const dst = doc.documentElement;
    for (const a of [...dst.attributes]) if (!src.hasAttribute(a.name) || SKIP_ATTR.has(a.name)) dst.removeAttribute(a.name);
    for (const a of src.attributes) if (!SKIP_ATTR.has(a.name)) dst.setAttribute(a.name, a.value);
    dst.classList.remove("is-popout", "of-dk-dragging");
  };
  syncRoot();
  const rootObs = new MutationObserver(syncRoot);
  rootObs.observe(document.documentElement, { attributes: true });
  doc.body.className = "of-dkwin";
  doc.title = o.title;

  // ---- content: shadow roots of nodes the main window puts here get their styles
  const bodyObs = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) restyle(n);
  });
  bodyObs.observe(doc.body, { childList: true, subtree: true });

  // ---- events
  on(doc, "keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !typing(e.target)) o.onKey?.(e);
  });
  on(doc, "contextmenu", (e) => {
    if (!typing(e.target)) e.preventDefault();
  });
  let last = null;
  let timer = 0;
  const rectNow = () => ({ x: win.screenX, y: win.screenY, w: win.innerWidth, h: win.innerHeight });
  const watchRect = () => {
    if (win.closed) return;
    const r = rectNow();
    const key = `${r.x},${r.y},${r.w},${r.h}`;
    if (last === null) last = key;
    if (key === last) return;
    last = key;
    clearTimeout(timer);
    timer = setTimeout(() => !win.closed && o.onRect(rectNow()), 400);
  };
  on(win, "resize", watchRect);

  let done = false;
  const handle = {
    win,
    doc,
    body: doc.body,
    get closed() {
      return done || win.closed;
    },
    setTitle(text) {
      if (!done && doc.title !== text) doc.title = text;
    },
    focus() {
      try {
        win.focus();
      } catch {
        /* ignore */
      }
    },
    /** Closes the window without reporting it (the layout already moved the group elsewhere). */
    close() {
      if (done) return;
      finish();
      try {
        doc.body.replaceChildren();
        win.close();
      } catch {
        /* already gone */
      }
    },
  };
  const finish = () => {
    done = true;
    open.delete(handle);
    clearInterval(poll);
    clearTimeout(timer);
    headObs.disconnect();
    rootObs.disconnect();
    bodyObs.disconnect();
    for (const f of off.splice(0)) {
      try {
        f();
      } catch {
        /* the window is gone */
      }
    }
  };
  // the user closed the window (its own close button, Alt+F4): report once; a reload of the page counts as closing
  const gone = () => {
    if (done) return;
    finish();
    if (!unloading) o.onClose();
  };
  on(win, "pagehide", gone);
  const poll = setInterval(() => (win.closed ? gone() : watchRect()), 1000);
  open.add(handle);
  return handle;
}

/** A sensible screen rectangle for a window showing what is now at `r` (client px of the main window). */
export function screenRectFor(r, minW = 280, minH = 320) {
  const chromeX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const chromeY = Math.max(0, window.outerHeight - window.innerHeight - chromeX);
  return { x: Math.round(window.screenX + chromeX + r.left + 32), y: Math.round(window.screenY + chromeY + r.top + 32), w: Math.round(Math.max(minW, r.width)), h: Math.round(Math.max(minH, r.height)) };
}
