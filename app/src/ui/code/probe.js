// Preview probe: read-only questions about, and simple interactions with, the page rendered in the preview frame.
// Used by the Vibe tools preview_query, preview_state and preview_interact (vibe/tools/web-view.js).
//
// `probeKit` runs INSIDE the sandboxed preview iframe. Like measureKit (measure.js) it is serialized with
// Function#toString and injected next to the bridge (ui/code/bridge.js), so it must be fully self-contained: no
// imports, no closures over module scope, ES5 syntax. It never evaluates code it is given: selectors go to
// querySelectorAll, text goes into form fields, keys become keyboard events.
//
// Host side: `sanitizeProbe` cuts a reply down to plain, size-limited JSON before the assistant sees it. The page is
// untrusted, so the reply is data, never instructions.
/* eslint-disable no-undef, no-var */

export function probeKit() {
  var MAX_TEXT = 160;
  function clip(s, n) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return s.length > (n || MAX_TEXT) ? s.slice(0, n || MAX_TEXT) + "…" : s;
  }
  function ours(el) {
    return !!(el && el.closest && el.closest("#__of_ov"));
  }
  function all(selector) {
    if (typeof selector !== "string" || !selector || selector.length > 500) throw new Error("Give a CSS selector (at most 500 characters).");
    var list;
    try {
      list = document.querySelectorAll(selector);
    } catch (e) {
      throw new Error("Invalid CSS selector: " + selector);
    }
    var out = [];
    for (var i = 0; i < list.length; i++) if (!ours(list[i])) out.push(list[i]);
    return out;
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) !== 0;
  }
  function describe(el, styles, wantHtml) {
    var r = el.getBoundingClientRect();
    var id = el.getAttribute("data-of");
    var o = { tag: el.tagName.toLowerCase(), visible: visible(el), rect: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) } };
    if (id != null) o.id = Number(id);
    if (el.id) o.htmlId = clip(el.id, 80);
    if (el.className && typeof el.className === "string") o.classes = clip(el.className, 120);
    var text = clip(el.innerText != null ? el.innerText : el.textContent);
    if (text) o.text = text;
    var names = ["href", "src", "alt", "type", "name", "placeholder", "role", "aria-label", "title", "for"];
    for (var i = 0; i < names.length; i++) {
      var v = el.getAttribute(names[i]);
      if (v != null && v !== "") o[names[i]] = clip(v, 200);
    }
    if ("value" in el && typeof el.value === "string" && el.type !== "password") o.value = clip(el.value, 200);
    if (el.type === "password") o.value = el.value ? "(hidden)" : "";
    if ("checked" in el && (el.type === "checkbox" || el.type === "radio")) o.checked = !!el.checked;
    if (el.disabled) o.disabled = true;
    if (el.tagName === "IMG") o.loaded = !!(el.complete && el.naturalWidth > 0);
    if (styles && styles.length) {
      var cs = getComputedStyle(el);
      o.styles = {};
      for (var j = 0; j < styles.length && j < 30; j++) o.styles[styles[j]] = clip(cs.getPropertyValue(String(styles[j])), 200);
    }
    if (wantHtml) {
      var c = el.cloneNode(true);
      var marked = c.querySelectorAll ? c.querySelectorAll("[data-of]") : [];
      for (var k = 0; k < marked.length; k++) marked[k].removeAttribute("data-of");
      if (c.removeAttribute) c.removeAttribute("data-of");
      o.html = String(c.outerHTML || "").slice(0, 2000);
    }
    return o;
  }
  function state() {
    var de = document.documentElement;
    var vw = de.clientWidth || window.innerWidth;
    var imgs = document.images || [];
    var broken = [];
    for (var i = 0; i < imgs.length && broken.length < 10; i++) if (imgs[i].complete && !imgs[i].naturalWidth && imgs[i].getAttribute("src")) broken.push(clip(imgs[i].getAttribute("src"), 200));
    // elements that stick out of the viewport sideways: the usual cause of a horizontal scrollbar on phones
    var wide = [];
    var els = document.body ? document.body.getElementsByTagName("*") : [];
    for (var j = 0; j < els.length && j < 5000 && wide.length < 8; j++) {
      var el = els[j];
      if (ours(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && getComputedStyle(el).position !== "fixed") {
        var d = { tag: el.tagName.toLowerCase(), right: Math.round(r.right), width: Math.round(r.width) };
        if (el.getAttribute("data-of") != null) d.id = Number(el.getAttribute("data-of"));
        if (el.className && typeof el.className === "string") d.classes = clip(el.className, 80);
        wide.push(d);
      }
    }
    var f = document.activeElement;
    var o = {
      title: clip(document.title, 200),
      language: clip(de.getAttribute("lang") || "", 20),
      viewport: { width: vw, height: de.clientHeight || window.innerHeight },
      page: { width: Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0), height: Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0) },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      horizontalOverflow: Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0) > vw + 1,
      counts: { elements: els.length, links: document.links ? document.links.length : 0, images: imgs.length, forms: document.forms ? document.forms.length : 0, headings: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length, h1: document.querySelectorAll("h1").length },
      textLength: document.body ? (document.body.innerText || "").length : 0,
    };
    if (broken.length) o.brokenImages = broken;
    if (wide.length) o.overflowing = wide;
    if (f && f !== document.body && !ours(f)) o.focused = describe(f);
    return o;
  }
  function first(selector) {
    var list = all(selector);
    if (!list.length) throw new Error("Nothing matches " + selector);
    return list[0];
  }
  function fire(el, type, init) {
    var E = type.indexOf("key") === 0 ? KeyboardEvent : type === "click" ? MouseEvent : Event;
    init = init || {};
    init.bubbles = true;
    init.cancelable = true;
    if (E === MouseEvent) init.view = window;
    return el.dispatchEvent(new E(type, init));
  }
  /** One interaction step; returns a short description of what happened. */
  function act(step) {
    var a = step && step.action;
    if (a === "click") {
      var el = first(step.selector);
      if (el.scrollIntoView) el.scrollIntoView({ block: "center", inline: "nearest" });
      if (el.focus && /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) el.focus();
      fire(el, "click");
      return "clicked " + el.tagName.toLowerCase();
    }
    if (a === "type") {
      var t = first(step.selector);
      var text = String(step.text == null ? "" : step.text).slice(0, 5000);
      if (t.focus) t.focus();
      if (t.isContentEditable) t.textContent = step.append ? t.textContent + text : text;
      else if ("value" in t) {
        var proto = t.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : t.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, "value");
        var next = step.append ? t.value + text : text;
        if (desc && desc.set) desc.set.call(t, next);
        else t.value = next;
      } else throw new Error(step.selector + " is not a form field.");
      fire(t, "input");
      fire(t, "change");
      return "typed into " + t.tagName.toLowerCase();
    }
    if (a === "check") {
      var c = first(step.selector);
      if (c.type !== "checkbox" && c.type !== "radio") throw new Error(step.selector + " is not a checkbox or radio button.");
      if (c.checked !== (step.checked !== false)) fire(c, "click");
      return "checked: " + c.checked;
    }
    if (a === "press") {
      var target = step.selector ? first(step.selector) : document.activeElement || document.body;
      var key = String(step.key || "Enter").slice(0, 20);
      fire(target, "keydown", { key: key });
      fire(target, "keyup", { key: key });
      return "pressed " + key;
    }
    if (a === "submit") {
      var f = first(step.selector);
      var form = f.tagName === "FORM" ? f : f.form || (f.closest ? f.closest("form") : null);
      if (!form) throw new Error(step.selector + " is not inside a form.");
      if (form.requestSubmit) form.requestSubmit();
      else fire(form, "submit");
      return "submitted the form";
    }
    if (a === "hover") {
      var h = first(step.selector);
      fire(h, "mouseover");
      fire(h, "mouseenter");
      return "hovered " + h.tagName.toLowerCase();
    }
    if (a === "scroll") {
      if (step.selector) first(step.selector).scrollIntoView({ block: "start" });
      else window.scrollTo(0, Number(step.y) || 0);
      return "scrolled to " + Math.round(window.scrollY);
    }
    throw new Error("Unknown action " + a + ". Use click, type, check, press, submit, hover or scroll.");
  }
  return {
    query: function (m) {
      var list = all(m.selector);
      var limit = Math.max(1, Math.min(50, Number(m.limit) || 20));
      var out = [];
      for (var i = 0; i < list.length && out.length < limit; i++) out.push(describe(list[i], m.styles, m.html && out.length < 5));
      return { total: list.length, elements: out };
    },
    state: state,
    act: act,
    describe: describe,
    all: all,
  };
}

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);

/** Reduces a probe reply from the (untrusted) frame to plain JSON of limited size and depth. */
export function sanitizeProbe(value, depth = 0) {
  if (value == null || typeof value === "boolean") return value ?? null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return str(value, 2100);
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.slice(0, 60).map((v) => sanitizeProbe(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).slice(0, 60)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[String(k).slice(0, 60)] = sanitizeProbe(value[k], depth + 1);
    }
    return out;
  }
  return null;
}

export const PROBE_ACTIONS = ["click", "type", "check", "press", "submit", "hover", "scroll", "wait"];
