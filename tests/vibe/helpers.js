// Test helpers for the Vibe engine: a minimal App stand-in with real Doc objects (no DOM, no canvas).
import { Doc } from "../../app/src/core/doc.js";

export function fakeApp({ doc = true } = {}) {
  const listeners = new Map();
  const app = {
    studio: "vibe",
    prefs: { aiEnabled: true },
    docs: [],
    doc: null,
    selection: [],
    get page() {
      return this.doc?.pages[0] || null;
    },
    get context() {
      return this.page?.root || null;
    },
    setStudio(s) {
      this.studio = s;
    },
    openDoc(d) {
      if (!this.docs.includes(d)) this.docs.push(d);
      this.doc = d;
      return d;
    },
    activateDoc(d) {
      this.doc = d;
    },
    select(nodes) {
      this.selection = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
    },
    setActivePage() {},
    toast() {},
    status() {},
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    emit(name, ...a) {
      for (const fn of listeners.get(name) || []) fn(...a);
    },
  };
  if (doc) {
    const d = new Doc({ name: "Test", width: 800, height: 600 });
    d.history.clear();
    app.openDoc(d);
  }
  return app;
}

/** Resolves when `session` emits "status" idle. */
export function idle(session) {
  return new Promise((r) => {
    if (!session.running) return r();
    const off = session.on("status", (s) => {
      if (s === "idle") {
        off();
        r();
      }
    });
  });
}

export const layers = (app) => {
  const out = [];
  app.doc.walkAll((n) => n.type !== "group" || n.name !== "Root" ? out.push(n) : null);
  return out.filter((n) => n._parent);
};
