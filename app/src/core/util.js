// Small, dependency-free helpers shared across OpenFini.

let counter = 0;
const rand = () => Math.random().toString(36).slice(2, 8);

/** Creates a short unique id such as `n_k3j9a2_1f`. */
export const uid = (prefix = "n") => `${prefix}_${rand()}${(counter++).toString(36)}`;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (v, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
export const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
export const deg = (rad) => (rad * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/** Deep clone for plain JSON-like data (arrays, objects, numbers, strings). */
export function clone(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = clone(v[i]);
    return out;
  }
  if (ArrayBuffer.isView(v)) return v.slice();
  const out = {};
  for (const k in v) {
    if (k.charCodeAt(0) === 95 /* _ */) continue; // runtime-only fields
    out[k] = clone(v[k]);
  }
  return out;
}

/** Structural equality for plain data. */
export function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => k[0] !== "_");
  const kb = Object.keys(b).filter((k) => k[0] !== "_");
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!equal(a[k], b[k])) return false;
  return true;
}

export class Emitter {
  #h = new Map();
  on(type, fn) {
    let set = this.#h.get(type);
    if (!set) this.#h.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }
  once(type, fn) {
    const off = this.on(type, (...a) => {
      off();
      fn(...a);
    });
    return off;
  }
  emit(type, payload) {
    const set = this.#h.get(type);
    if (set) for (const fn of [...set]) fn(payload);
  }
}

/** Runs `fn` at most once per animation frame. */
export function frameScheduler(fn) {
  let pending = false;
  return (...args) => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn(...args);
    });
  };
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  d.flush = (...a) => {
    clearTimeout(t);
    fn(...a);
  };
  return d;
}

/**
 * Tiny hyperscript helper: h('div.class#id', {onclick, style:{}, dataset:{}}, child, ...)
 * Children may be strings, numbers, nodes, arrays (flattened) or null/false (skipped).
 */
export function h(tag, attrs, ...children) {
  let name = tag;
  let cls = "";
  let id = "";
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(tag);
  if (m) {
    name = m[1] || "div";
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === ".") cls += (cls ? " " : "") + part.slice(1);
      else id = part.slice(1);
    }
  }
  const el = document.createElement(name);
  if (cls) el.className = cls;
  if (id) el.id = id;
  if (attrs && typeof attrs === "object" && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = (el.className ? el.className + " " : "") + v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "html") el.innerHTML = v;
      else if (k in el && k !== "list" && !k.includes("-")) {
        try {
          el[k] = v;
        } catch {
          el.setAttribute(k, v === true ? "" : v);
        }
      } else el.setAttribute(k, v === true ? "" : v);
    }
  } else if (attrs != null) children.unshift(attrs);
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function empty(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function downloadName(name, ext) {
  const base = (name || "Untitled").replace(/[\\/:*?"<>|]+/g, "_").replace(/\.[a-z0-9]+$/i, "");
  return `${base}.${ext}`;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Pretty keyboard shortcut text, e.g. "Ctrl+Shift+Z" / "⌘⇧Z". */
export function prettyShortcut(s) {
  if (!s) return "";
  return s
    .split("+")
    .map((p) => {
      const k = p.trim();
      if (isMac) return { Ctrl: "⌘", Mod: "⌘", Shift: "⇧", Alt: "⌥", Enter: "↵", Backspace: "⌫", Delete: "⌦" }[k] || k;
      return k === "Mod" ? "Ctrl" : k;
    })
    .join(isMac ? "" : "+");
}
