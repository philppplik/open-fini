// The inspector that runs INSIDE the preview iframe (sandboxed, no access to the app). It is serialized with
// Function#toString and injected as the first script of the preview document, so it must be fully
// self-contained: no imports, no references to anything outside of `bridgeMain`.
//
// Parent → frame messages: { of:1, type: "mode"|"select"|"hover"|"computed"|"live"|"liveClear"|"css"|"scroll"|
//   "reveal"|"dropProbe"|"dropEnd"|"textEditStart"|"spacing"|"measure"|"measureBox" , ... }
// Frame → parent messages: { of:1, type: "ready"|"console"|"pick"|"hover"|"context"|"computed"|"scroll"|"navigate"|
//   "external"|"textEdit"|"htmlEdit"|"moveDrop"|"dropTarget"|"key"|"dblclick"|"submit"|"measureInfo"|"measureBox"|
//   "measureExit"|"measureCopied"|"measureOpt" , ... }
// The measure tool (section "measure tool" below) draws its overlay in the frame; its geometry and unit code is the
// self-contained `measureKit` of engine/web/measure.js, passed in as `kit` (see `bridgeSource`). The host validates
// every measure message with `sanitizeBox` before using it.
/* eslint-disable no-undef */
import { measureKit } from "../../engine/web/measure.js";

export function bridgeMain(kit) {
  var cfg = window.__OF_CONFIG__ || {};
  var TOP = window.parent;
  var ACCENT = cfg.accent || "#4f8cff";
  var edit = cfg.mode !== "preview";
  var selectedId = null;
  var hoverId = null;
  var spacing = cfg.spacing !== false;
  var textEl = null;
  var textOriginal = "";
  var drag = null;
  var drop = null; // { parentId, index, rect }
  var liveEls = [];

  function post(msg) {
    msg.of = 1;
    try {
      TOP.postMessage(msg, "*");
    } catch (e) {
      /* the parent is gone */
    }
  }
  function byId(id) {
    return id == null ? null : document.querySelector('[data-of="' + id + '"]');
  }
  function idOf(el) {
    var n = el && el.closest ? el.closest("[data-of]") : null;
    return n ? Number(n.getAttribute("data-of")) : null;
  }
  function isOurs(el) {
    return !!(el && el.closest && el.closest("#__of_ov"));
  }

  // ---------------------------------------------------------------- console capture
  function fmt(v, depth) {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    var t = typeof v;
    if (t === "string") return depth ? JSON.stringify(v) : v;
    if (t === "function") return "ƒ " + (v.name || "anonymous") + "()";
    if (t !== "object") return String(v);
    if (v instanceof Error) return v.stack || v.name + ": " + v.message;
    if (v instanceof Element) return "<" + v.tagName.toLowerCase() + (v.id ? "#" + v.id : "") + (v.className && typeof v.className === "string" ? "." + v.className.trim().split(/\s+/).join(".") : "") + ">";
    if (depth > 2) return Array.isArray(v) ? "[…]" : "{…}";
    var seen = fmt.seen || (fmt.seen = []);
    if (seen.indexOf(v) >= 0) return "[Circular]";
    seen.push(v);
    try {
      if (Array.isArray(v)) return "[" + v.slice(0, 30).map(function (x) { return fmt(x, depth + 1); }).join(", ") + (v.length > 30 ? ", …" : "") + "]";
      var keys = Object.keys(v).slice(0, 30);
      return "{ " + keys.map(function (k) { return k + ": " + fmt(v[k], depth + 1); }).join(", ") + (Object.keys(v).length > 30 ? ", …" : "") + " }";
    } catch (e) {
      return String(v);
    } finally {
      seen.pop();
    }
  }
  ["log", "info", "warn", "error", "debug"].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      try {
        post({ type: "console", level: level, text: args.map(function (a) { return fmt(a, 0); }).join(" ").slice(0, 4000) });
      } catch (e) {
        /* never break the page */
      }
      return orig && orig.apply(console, args);
    };
  });
  window.addEventListener("error", function (e) {
    post({ type: "console", level: "error", text: (e.message || "Error") + (e.lineno ? "  (line " + e.lineno + ")" : "") });
  });
  window.addEventListener("unhandledrejection", function (e) {
    post({ type: "console", level: "error", text: "Unhandled promise rejection: " + fmt(e.reason, 0) });
  });

  // ---------------------------------------------------------------- overlay
  var ov = document.createElement("div");
  ov.id = "__of_ov";
  ov.setAttribute("style", "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;margin:0;padding:0;border:0;overflow:hidden");
  var parts = {};
  function box(name, css) {
    var d = document.createElement("div");
    d.setAttribute("style", "position:fixed;box-sizing:border-box;display:none;pointer-events:none;" + css);
    ov.appendChild(d);
    parts[name] = d;
    return d;
  }
  box("margin", "background:rgba(246,178,107,.35)");
  box("padding", "background:rgba(147,196,125,.35)");
  box("hover", "outline:1px solid " + ACCENT + ";outline-offset:-1px;background:rgba(79,140,255,.06)");
  box("select", "outline:2px solid " + ACCENT + ";outline-offset:-2px");
  box("drop", "background:" + ACCENT + ";border-radius:2px");
  box("dropParent", "outline:2px dashed " + ACCENT + ";outline-offset:-2px;background:rgba(79,140,255,.08)");
  var label = box("label", "background:" + ACCENT + ";color:#fff;font:600 11px/16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:0 6px;border-radius:3px;white-space:nowrap;max-width:60%;overflow:hidden;text-overflow:ellipsis");
  var tip = box("tip", "background:#1d1e22;color:#fff;font:500 11px/16px system-ui,sans-serif;padding:2px 8px;border-radius:4px;white-space:nowrap");
  document.documentElement.appendChild(ov);

  function place(name, r) {
    var d = parts[name];
    if (!r || r.width <= 0 && r.height <= 0 && name !== "drop") {
      d.style.display = "none";
      return;
    }
    d.style.display = "block";
    d.style.left = r.left + "px";
    d.style.top = r.top + "px";
    d.style.width = Math.max(0, r.width) + "px";
    d.style.height = Math.max(0, r.height) + "px";
  }
  function describe(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    var c = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (c.length) s += "." + c.join(".");
    return s;
  }
  function drawLabel(el, r) {
    label.style.display = "block";
    label.textContent = describe(el);
    var top = r.top - 20;
    label.style.left = Math.max(2, Math.min(r.left, window.innerWidth - 120)) + "px";
    label.style.top = (top < 2 ? r.top + 2 : top) + "px";
  }
  var raf = 0;
  function redraw() {
    raf = 0;
    var hov = hoverId != null && hoverId !== selectedId && !M.on ? byId(hoverId) : null;
    place("hover", hov && edit ? hov.getBoundingClientRect() : null);
    var sel = edit ? byId(selectedId) : null;
    if (sel) {
      var r = sel.getBoundingClientRect();
      place("select", r);
      drawLabel(sel, r);
      if (spacing) {
        var cs = getComputedStyle(sel);
        var m = [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(parseFloat);
        var p = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat);
        var mm = m.some(function (v) { return v > 0; });
        place("margin", mm ? { left: r.left - Math.max(0, m[3]), top: r.top - Math.max(0, m[0]), width: r.width + Math.max(0, m[1]) + Math.max(0, m[3]), height: r.height + Math.max(0, m[0]) + Math.max(0, m[2]) } : null);
        // the margin box is drawn first and the element box covers its middle; padding sits inside the border box
        if (mm) parts.margin.style.clipPath = "polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0," + Math.max(0, m[3]) + "px " + Math.max(0, m[0]) + "px," + Math.max(0, m[3]) + "px calc(100% - " + Math.max(0, m[2]) + "px),calc(100% - " + Math.max(0, m[1]) + "px) calc(100% - " + Math.max(0, m[2]) + "px),calc(100% - " + Math.max(0, m[1]) + "px) " + Math.max(0, m[0]) + "px," + Math.max(0, m[3]) + "px " + Math.max(0, m[0]) + "px)";
        var pp = p.some(function (v) { return v > 0; });
        place("padding", pp ? r : null);
        if (pp) parts.padding.style.clipPath = "polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0," + p[3] + "px " + p[0] + "px," + p[3] + "px calc(100% - " + p[2] + "px),calc(100% - " + p[1] + "px) calc(100% - " + p[2] + "px),calc(100% - " + p[1] + "px) " + p[0] + "px," + p[3] + "px " + p[0] + "px)";
      } else {
        place("margin", null);
        place("padding", null);
      }
    } else {
      place("select", null);
      place("margin", null);
      place("padding", null);
      label.style.display = "none";
    }
    if (drop) {
      place("drop", drop.rect);
      place("dropParent", drop.parentRect || null);
    } else {
      place("drop", null);
      place("dropParent", null);
    }
    drawMeasure();
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(redraw);
  }
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) if (!isOurs(list[i].target)) return schedule();
  }).observe(document.documentElement, { attributes: true, childList: true, subtree: true, characterData: true });
  document.addEventListener("transitionend", schedule, true);
  document.addEventListener("animationend", schedule, true);
  window.addEventListener("load", schedule);

  // scroll position is reported so the parent can restore it after a reload
  var scrollTimer = 0;
  window.addEventListener("scroll", function () {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      post({ type: "scroll", x: window.scrollX, y: window.scrollY });
    }, 120);
  }, { passive: true });

  // ---------------------------------------------------------------- measure tool
  // Hover shows the box model (margin / border / padding / content bands), the size and distance guides to the
  // viewport edges; holding Alt measures against the pinned (else the selected, else the parent) element; click pins,
  // Shift+click links the new pin to the previous one with distance guides; Esc clears pins, then leaves the tool.
  // The overlay has no animation, so there is nothing to reduce for prefers-reduced-motion. Dimensions are in CSS px
  // and scale with the preview zoom, like the rest of the page.
  var M = { on: false, unit: "px", ppi: 96, dprAware: false, details: false, accent: ACCENT, el: null, alt: false, pins: [], links: [], last: "" };
  var mo = document.createElement("div");
  mo.setAttribute("style", "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;margin:0;padding:0;border:0;overflow:hidden");
  ov.appendChild(mo);
  var MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
  function pxv(v) {
    return parseFloat(v) || 0;
  }
  function boxOf(el) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var par = el.parentElement;
    var pr = par ? par.getBoundingClientRect() : null;
    return {
      el: el,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      margin: [pxv(cs.marginTop), pxv(cs.marginRight), pxv(cs.marginBottom), pxv(cs.marginLeft)],
      border: [pxv(cs.borderTopWidth), pxv(cs.borderRightWidth), pxv(cs.borderBottomWidth), pxv(cs.borderLeftWidth)],
      padding: [pxv(cs.paddingTop), pxv(cs.paddingRight), pxv(cs.paddingBottom), pxv(cs.paddingLeft)],
      fontSize: pxv(cs.fontSize) || 16,
      rootFontSize: pxv(getComputedStyle(document.documentElement).fontSize) || 16,
      parent: pr ? { w: pr.width, h: pr.height } : null,
    };
  }
  function mctx(b, axis) {
    return {
      ppi: M.ppi, dpr: window.devicePixelRatio || 1, dprAware: M.dprAware, rootPx: b.rootFontSize, emPx: b.fontSize,
      basisPx: b.parent ? (axis === "x" ? b.parent.w : b.parent.h) : axis === "x" ? window.innerWidth : window.innerHeight,
    };
  }
  function sizeText(b) {
    return kit.formatSize(b.rect.right - b.rect.left, b.rect.bottom - b.rect.top, M.unit, mctx(b, "x"), mctx(b, "y"));
  }
  function wireBox(b) {
    var el = b.el;
    return {
      id: idOf(el), tag: el.tagName.toLowerCase(),
      rect: { x: b.rect.left + window.scrollX, y: b.rect.top + window.scrollY, w: b.rect.right - b.rect.left, h: b.rect.bottom - b.rect.top },
      margin: b.margin, border: b.border, padding: b.padding, fontSize: b.fontSize, rootFontSize: b.rootFontSize, parent: b.parent,
      vw: window.innerWidth, vh: window.innerHeight,
    };
  }
  function mk(css, text) {
    var d = document.createElement("div");
    d.setAttribute("style", "position:fixed;box-sizing:border-box;pointer-events:none;" + css);
    if (text != null) d.textContent = text;
    mo.appendChild(d);
    return d;
  }
  function rcss(r) {
    return "left:" + r.left + "px;top:" + r.top + "px;width:" + Math.max(0, r.right - r.left) + "px;height:" + Math.max(0, r.bottom - r.top) + "px;";
  }
  function ring(outer, inner, color) {
    var w = outer.right - outer.left;
    var h = outer.bottom - outer.top;
    if (w <= 0 || h <= 0) return;
    var il = Math.max(0, Math.min(w, inner.left - outer.left));
    var it = Math.max(0, Math.min(h, inner.top - outer.top));
    var ir = Math.max(il, Math.min(w, inner.right - outer.left));
    var ib = Math.max(it, Math.min(h, inner.bottom - outer.top));
    mk(rcss(outer) + "background:" + color + ";clip-path:polygon(evenodd,0 0," + w + "px 0," + w + "px " + h + "px,0 " + h + "px,0 0," + il + "px " + it + "px," + il + "px " + ib + "px," + ir + "px " + ib + "px," + ir + "px " + it + "px," + il + "px " + it + "px)");
  }
  function tag(text, x, y, bg) {
    var d = mk("background:" + bg + ";color:#fff;font:600 11px/16px " + MONO + ";padding:0 6px;border-radius:3px;white-space:nowrap;left:0;top:0;visibility:hidden", text);
    var w = d.offsetWidth;
    var h = d.offsetHeight || 16;
    d.style.left = Math.max(2, Math.min(x, window.innerWidth - w - 2)) + "px";
    d.style.top = Math.max(2, Math.min(y, window.innerHeight - h - 2)) + "px";
    d.style.visibility = "visible";
    return d;
  }
  function drawGuide(g, b, color) {
    var horizontal = g.axis === "x";
    var x = Math.min(g.x1, g.x2);
    var y = Math.min(g.y1, g.y2);
    mk("left:" + x + "px;top:" + y + "px;width:" + (horizontal ? g.px : 1) + "px;height:" + (horizontal ? 1 : g.px) + "px;background:" + color);
    // end caps
    if (horizontal) {
      mk("left:" + x + "px;top:" + (y - 3) + "px;width:1px;height:7px;background:" + color);
      mk("left:" + (x + g.px - 1) + "px;top:" + (y - 3) + "px;width:1px;height:7px;background:" + color);
    } else {
      mk("left:" + (x - 3) + "px;top:" + y + "px;width:7px;height:1px;background:" + color);
      mk("left:" + (x - 3) + "px;top:" + (y + g.px - 1) + "px;width:7px;height:1px;background:" + color);
    }
    var text = kit.formatValue(g.px, M.unit, mctx(b, g.axis));
    tag(text, horizontal ? x + g.px / 2 - 14 : x + 6, horizontal ? y + 5 : y + g.px / 2 - 8, color);
  }
  function bandValues(outer, inner, v, b) {
    // numbers on the four sides of a band when the band is thick enough to hold them
    var u = function (n, axis) {
      return kit.formatValue(n, M.unit, mctx(b, axis)).replace(/^(-?[\d.]+).*$/, "$1");
    };
    var cx = (outer.left + outer.right) / 2;
    var cy = (outer.top + outer.bottom) / 2;
    var put = function (text, x, y) {
      mk("left:" + (x - 14) + "px;top:" + (y - 7) + "px;width:28px;text-align:center;font:600 10px/14px " + MONO + ";color:#1d1e22", text);
    };
    if (v[0] >= 12) put(u(v[0], "y"), cx, (outer.top + inner.top) / 2);
    if (v[2] >= 12) put(u(v[2], "y"), cx, (outer.bottom + inner.bottom) / 2);
    if (v[3] >= 20) put(u(v[3], "x"), (outer.left + inner.left) / 2, cy);
    if (v[1] >= 20) put(u(v[1], "x"), (outer.right + inner.right) / 2, cy);
  }
  function drawBox(b, full) {
    var bands = kit.boxBands(b.rect, b.margin, b.border, b.padding);
    if (full) {
      ring(bands.margin, bands.border, "rgba(246,178,107,.55)");
      ring(bands.border, bands.padding, "rgba(255,226,140,.55)");
      ring(bands.padding, bands.content, "rgba(147,196,125,.55)");
      mk(rcss(bands.content) + "background:rgba(111,168,220,.55)");
      if (M.details) {
        bandValues(bands.margin, bands.border, b.margin, b);
        bandValues(bands.padding, bands.content, b.padding, b);
      }
    }
    mk(rcss(b.rect) + "outline:1px " + (full ? "solid" : "dashed") + " " + M.accent + ";outline-offset:-1px");
    var below = b.rect.bottom + 22 < window.innerHeight;
    tag(describe(b.el) + "  " + sizeText(b), b.rect.left, below ? b.rect.bottom + 4 : b.rect.top - 20, M.accent);
  }
  function refBox(hover) {
    var pin = M.pins.length ? M.pins[M.pins.length - 1] : null;
    if (pin && pin !== hover) return boxOf(pin);
    var sel = byId(selectedId);
    if (sel && sel !== hover) return boxOf(sel);
    return hover.parentElement ? boxOf(hover.parentElement) : null;
  }
  function clean() {
    M.pins = M.pins.filter(function (e) { return e.isConnected; });
    M.links = M.links.filter(function (l) { return l[0].isConnected && l[1].isConnected; });
  }
  var GUIDE = "#ff4d4f";
  function drawMeasure() {
    mo.textContent = "";
    if (!M.on) return;
    clean();
    var hover = M.el && M.el.isConnected && !isOurs(M.el) ? M.el : null;
    for (var i = 0; i < M.pins.length; i++) if (M.pins[i] !== hover) drawBox(boxOf(M.pins[i]), false);
    for (var k = 0; k < M.links.length; k++) {
      var ba = boxOf(M.links[k][0]);
      var bb = boxOf(M.links[k][1]);
      kit.gapGuides(ba.rect, bb.rect).forEach(function (g) { drawGuide(g, bb, GUIDE); });
    }
    var info = null;
    if (hover) {
      var hb = boxOf(hover);
      drawBox(hb, true);
      if (M.alt) {
        var rb = refBox(hover);
        if (rb) {
          mk(rcss(rb.rect) + "outline:1px dashed " + GUIDE + ";outline-offset:-1px");
          kit.gapGuides(rb.rect, hb.rect).forEach(function (g) { drawGuide(g, hb, GUIDE); });
        }
      } else {
        kit.edgeGuides(hb.rect, window.innerWidth, window.innerHeight).forEach(function (g) { drawGuide(g, hb, M.accent); });
      }
      info = wireBox(hb);
      info.text = sizeText(hb);
    } else if (M.pins.length) info = wireBox(boxOf(M.pins[M.pins.length - 1]));
    var key = JSON.stringify([info, M.pins.length, M.unit]);
    if (key !== M.last) {
      M.last = key;
      post({ type: "measureInfo", box: info, pins: M.pins.length });
    }
  }
  function mTarget(e) {
    var t = e.target;
    return t && t.nodeType === 1 && !isOurs(t) ? t : null;
  }
  function mStop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }
  document.addEventListener("mousemove", function (e) {
    if (!M.on) return;
    mStop(e);
    M.alt = e.altKey;
    var t = mTarget(e);
    if (t !== M.el) M.el = t;
    schedule();
  }, true);
  document.addEventListener("mouseleave", function () {
    if (M.on) {
      M.el = null;
      schedule();
    }
  }, true);
  ["mousedown", "mouseup", "auxclick", "dblclick", "contextmenu", "dragstart", "selectstart"].forEach(function (name) {
    document.addEventListener(name, function (e) {
      if (M.on && !isOurs(e.target)) mStop(e);
    }, true);
  });
  document.addEventListener("click", function (e) {
    if (!M.on || isOurs(e.target)) return;
    mStop(e);
    var t = mTarget(e);
    if (!t) return;
    var at = M.pins.indexOf(t);
    if (at >= 0 && !e.shiftKey) {
      M.pins.splice(at, 1);
      M.links = M.links.filter(function (l) { return l[0] !== t && l[1] !== t; });
    } else if (at < 0) {
      var prev = M.pins.length ? M.pins[M.pins.length - 1] : null;
      if (M.pins.length >= 6) M.pins.shift();
      M.pins.push(t);
      if (e.shiftKey && prev && prev !== t) M.links.push([prev, t]);
    }
    M.last = "";
    schedule();
  }, true);
  window.addEventListener("keyup", function (e) {
    if (e.key === "Alt" && M.alt) {
      M.alt = false;
      schedule();
    }
  }, true);
  function copyText(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("style", "position:fixed;left:-9999px;top:0;opacity:0");
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Alt" && !M.alt) {
      M.alt = true;
      schedule();
    }
    if (!M.on || textEl) return;
    var mod = e.ctrlKey || e.metaKey;
    var k = (e.key || "").toLowerCase();
    if (e.key === "Escape") {
      mStop(e);
      if (M.pins.length) {
        M.pins = [];
        M.links = [];
        M.last = "";
        schedule();
      } else post({ type: "measureExit" });
    } else if (mod && !e.shiftKey && !e.altKey && k === "c") {
      var b = M.el && M.el.isConnected ? boxOf(M.el) : M.pins.length ? boxOf(M.pins[M.pins.length - 1]) : null;
      if (!b) return;
      mStop(e);
      var text = sizeText(b);
      post({ type: "measureCopied", text: text, ok: copyText(text) });
    } else if (!mod && !e.altKey && !e.shiftKey && k === "d") {
      mStop(e);
      M.details = !M.details;
      schedule();
      post({ type: "measureOpt", details: M.details });
    }
  }, true);

  // ---------------------------------------------------------------- picking
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
  var INLINE = { a: 1, b: 1, i: 1, em: 1, strong: 1, span: 1, br: 1, small: 1, code: 1, mark: 1, sup: 1, sub: 1, u: 1, s: 1, abbr: 1, cite: 1, kbd: 1, q: 1, time: 1, var: 1, del: 1, ins: 1, wbr: 1 };
  var NO_TEXT = { img: 1, input: 1, video: 1, audio: 1, select: 1, textarea: 1, svg: 1, canvas: 1, iframe: 1, hr: 1, br: 1, object: 1, embed: 1, html: 1, head: 1, body: 1, table: 1, tbody: 1, thead: 1, tr: 1, ul: 1, ol: 1, form: 1, picture: 1 };

  function target(e) {
    var t = e.target;
    if (!t || isOurs(t)) return null;
    var id = idOf(t);
    return id;
  }

  function setHover(id) {
    if (id === hoverId) return;
    hoverId = id;
    schedule();
    post({ type: "hover", id: id });
  }

  document.addEventListener("mousemove", function (e) {
    if (!edit) return;
    if (drag) return;
    setHover(target(e));
  }, true);
  document.addEventListener("mouseleave", function () {
    setHover(null);
  }, true);

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  document.addEventListener("mousedown", function (e) {
    if (!edit || textEl) return;
    if (e.button !== 0 && e.button !== 2) return;
    if (isOurs(e.target)) return;
    var id = target(e);
    if (id == null) return;
    swallow(e);
    if (e.button === 0) drag = { id: id, x: e.clientX, y: e.clientY, moving: false, shift: e.shiftKey };
  }, true);

  document.addEventListener("mouseup", function (e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (d.moving) {
      swallow(e);
      var t = drop;
      drop = null;
      document.documentElement.style.cursor = "";
      schedule();
      if (t) post({ type: "moveDrop", id: d.id, parentId: t.parentId, index: t.index });
      return;
    }
    swallow(e);
    selectedId = d.id;
    schedule();
    post({ type: "pick", id: d.id, shift: d.shift || e.shiftKey, alt: e.altKey });
  }, true);

  document.addEventListener("mousemove", function (e) {
    if (!drag) return;
    if (!drag.moving && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) {
      var el = byId(drag.id);
      if (!el || el === document.body || el === document.documentElement) {
        drag = null;
        return;
      }
      drag.moving = true;
      selectedId = drag.id;
      document.documentElement.style.cursor = "grabbing";
      post({ type: "pick", id: drag.id, shift: false, alt: false });
    }
    if (drag && drag.moving) {
      swallow(e);
      probe(e.clientX, e.clientY, drag.id);
      schedule();
    }
  }, true);

  ["click", "auxclick", "dblclickX", "dragstart", "selectstart"].forEach(function (name) {
    document.addEventListener(name, function (e) {
      if (!edit || textEl) return;
      if (name === "selectstart" && e.target && e.target.isContentEditable) return;
      if (isOurs(e.target)) return;
      swallow(e);
    }, true);
  });

  document.addEventListener("dblclick", function (e) {
    if (!edit || isOurs(e.target)) return;
    var id = target(e);
    if (id == null) return;
    swallow(e);
    if (!startTextEdit(id, e)) post({ type: "dblclick", id: id });
  }, true);

  document.addEventListener("contextmenu", function (e) {
    if (isOurs(e.target)) return;
    if (!edit) return;
    var id = target(e);
    swallow(e);
    if (id != null) {
      selectedId = id;
      schedule();
    }
    post({ type: "context", id: id, x: e.clientX, y: e.clientY });
  }, true);

  // links and forms in preview mode
  document.addEventListener("click", function (e) {
    if (edit || isOurs(e.target)) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || e.defaultPrevented) return;
    var href = a.getAttribute("href") || "";
    if (href.charAt(0) === "#" || /^javascript:/i.test(href)) return;
    e.preventDefault();
    if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href) || /^(mailto|tel|sms):/i.test(href)) post({ type: "external", href: href });
    else post({ type: "navigate", href: href });
  }, false);
  document.addEventListener("submit", function (e) {
    e.preventDefault();
    post({ type: "submit" });
  }, true);

  // ---------------------------------------------------------------- keyboard
  document.addEventListener("keydown", function (e) {
    if (textEl) {
      if (e.key === "Escape") {
        e.preventDefault();
        endTextEdit(false);
      } else if (e.key === "Enter" && !e.shiftKey && (/^(h[1-6]|button|a|li|label|th|td|summary|figcaption|option)$/i.test(textEl.tagName) || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        endTextEdit(true);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        document.execCommand("insertLineBreak");
      }
      e.stopPropagation();
      return;
    }
    var mod = e.ctrlKey || e.metaKey;
    var key = e.key;
    var forward = false;
    if (mod && /^[zyxcvdsjpbk\/]$/i.test(key)) forward = true;
    else if (mod && e.shiftKey && /^[ep]$/i.test(key)) forward = true;
    else if (e.altKey && /^[1-5]$/.test(key)) forward = true;
    else if (edit && (key === "Delete" || key === "Backspace" || key === "Escape" || key === "F2" || key === "Enter")) forward = true;
    else if (key === "F1") forward = true;
    else if (!mod && !e.altKey && !e.shiftKey && (key === "m" || key === "M") && !(e.target && (e.target.isContentEditable || /^(input|textarea|select)$/i.test(e.target.tagName || "")))) forward = true; // toggles the measure tool
    if (!forward) return;
    if (e.key === "Escape" && selectedId == null) return;
    e.preventDefault();
    post({ type: "key", key: key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey });
  }, true);

  // ---------------------------------------------------------------- inline text editing
  function onlyInlineChildren(el) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (!INLINE[c.tagName.toLowerCase()]) return false;
      if (!onlyInlineChildren(c)) return false;
    }
    return true;
  }
  function startTextEdit(id, ev) {
    var el = byId(id);
    if (!el) return false;
    var tag = el.tagName.toLowerCase();
    if (NO_TEXT[tag] || VOID[tag]) return false;
    if (!onlyInlineChildren(el)) return false;
    if (!el.textContent.trim() && el.children.length) return false;
    textEl = el;
    textOriginal = el.innerHTML;
    el.setAttribute("contenteditable", el.children.length ? "true" : "plaintext-only");
    if (el.contentEditable !== "true" && el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    el.style.outline = "2px solid " + ACCENT;
    el.style.cursor = "text";
    el.focus();
    try {
      var range = ev && document.caretRangeFromPoint ? document.caretRangeFromPoint(ev.clientX, ev.clientY) : null;
      var sel = getSelection();
      sel.removeAllRanges();
      if (range && el.contains(range.startContainer)) sel.addRange(range);
      else {
        range = document.createRange();
        range.selectNodeContents(el);
        sel.addRange(range);
      }
    } catch (e) {
      /* selection is best effort */
    }
    hoverId = null;
    schedule();
    el.addEventListener("blur", onTextBlur);
    post({ type: "textEditStart", id: id });
    return true;
  }
  function onTextBlur() {
    endTextEdit(true);
  }
  function endTextEdit(commit) {
    var el = textEl;
    if (!el) return;
    textEl = null;
    el.removeEventListener("blur", onTextBlur);
    var id = idOf(el);
    el.removeAttribute("contenteditable");
    el.style.outline = "";
    el.style.cursor = "";
    if (!el.getAttribute("style")) el.removeAttribute("style");
    if (!commit) {
      el.innerHTML = textOriginal;
      schedule();
      return;
    }
    if (el.innerHTML === textOriginal) return;
    var plain = el.children.length === 0 && textOriginal.indexOf("<") < 0;
    if (plain) post({ type: "textEdit", id: id, text: el.textContent });
    else {
      var clone = el.cloneNode(true);
      var all = clone.querySelectorAll("[data-of],[contenteditable]");
      for (var i = 0; i < all.length; i++) {
        all[i].removeAttribute("data-of");
        all[i].removeAttribute("contenteditable");
      }
      post({ type: "htmlEdit", id: id, html: clone.innerHTML });
    }
  }

  // ---------------------------------------------------------------- insertion probe (drag & drop)
  var BLOCK_CONTAINER = { div: 1, section: 1, header: 1, footer: 1, main: 1, nav: 1, article: 1, aside: 1, ul: 1, ol: 1, form: 1, body: 1, li: 1, figure: 1, blockquote: 1, details: 1, fieldset: 1, dl: 1, a: 1, button: 1, label: 1, span: 1, td: 1, th: 1, p: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1 };
  var NEVER_CONTAINER = { html: 1, head: 1, table: 1, tbody: 1, thead: 1, tfoot: 1, tr: 1, select: 1, textarea: 1, script: 1, style: 1, svg: 1, video: 1, audio: 1, iframe: 1 };
  function elementChildren(el) {
    var out = [];
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.hasAttribute("data-of")) out.push(c);
    return out;
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  }
  function probe(x, y, movingId) {
    var moving = movingId != null ? byId(movingId) : null;
    var el = document.elementFromPoint(x, y);
    while (el && (isOurs(el) || (moving && (el === moving || moving.contains(el))))) {
      el = el.parentElement;
    }
    var host = el && el.closest ? el.closest("[data-of]") : null;
    if (!host) host = document.body;
    if (moving && (host === moving || moving.contains(host))) host = moving.parentElement || document.body;
    var tag = host.tagName.toLowerCase();
    var container = host;
    // insertion inside the host (when it can hold children) or next to it
    var inside = BLOCK_CONTAINER[tag] && !NEVER_CONTAINER[tag] && !VOID[tag];
    var r = host.getBoundingClientRect();
    var edge = Math.min(14, r.height / 4, r.width / 4);
    var nearEdge = host !== document.body && (y < r.top + edge || y > r.bottom - edge);
    if (!inside || nearEdge) {
      if (host === document.body || host === document.documentElement) container = document.body;
      else {
        var before = y < r.top + r.height / 2;
        var sibling = host;
        var parent = host.parentElement;
        if (!parent || !parent.hasAttribute("data-of")) parent = document.body;
        var sibs = elementChildren(parent).filter(function (c) { return c !== moving; });
        var i = sibs.indexOf(sibling);
        var idx = i < 0 ? sibs.length : before ? i : i + 1;
        return finishProbe(parent, idx, sibs, before ? { left: r.left, top: r.top - 2, width: r.width, height: 4 } : { left: r.left, top: r.bottom - 2, width: r.width, height: 4 });
      }
    }
    var kids = elementChildren(container).filter(function (c) { return c !== moving; });
    var horizontal = false;
    if (kids.length) {
      var cs = getComputedStyle(container);
      horizontal = (cs.display.indexOf("flex") >= 0 && cs.flexDirection.indexOf("row") === 0) || cs.display.indexOf("grid") >= 0 && false;
    }
    var index = kids.length;
    var line = null;
    for (var k = 0; k < kids.length; k++) {
      var kr = kids[k].getBoundingClientRect();
      var mid = horizontal ? kr.left + kr.width / 2 : kr.top + kr.height / 2;
      var pos = horizontal ? x : y;
      if (pos < mid) {
        index = k;
        line = horizontal ? { left: kr.left - 2, top: kr.top, width: 4, height: kr.height } : { left: kr.left, top: kr.top - 2, width: kr.width, height: 4 };
        break;
      }
    }
    if (!line && kids.length) {
      var lr = kids[kids.length - 1].getBoundingClientRect();
      line = horizontal ? { left: lr.right - 2, top: lr.top, width: 4, height: lr.height } : { left: lr.left, top: lr.bottom - 2, width: lr.width, height: 4 };
    }
    if (!line) {
      var cr = container.getBoundingClientRect();
      line = { left: cr.left + 6, top: cr.top + 6, width: Math.max(24, cr.width - 12), height: 4 };
    }
    return finishProbe(container, index, kids, line);
  }
  function finishProbe(parentEl, index, sibs, line) {
    var pid = parentEl === document.body && !parentEl.hasAttribute("data-of") ? null : idOf(parentEl);
    drop = { parentId: pid, index: index, rect: line, parentRect: parentEl === document.body ? null : rectOf(parentEl) };
    schedule();
    return drop;
  }

  // ---------------------------------------------------------------- files dropped from the desktop onto the page
  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    if (!t) return false;
    for (var i = 0; i < t.length; i++) if (t[i] === "Files") return true;
    return false;
  }
  // the frame must never navigate to a dropped file, in any mode
  document.addEventListener("dragover", function (e) {
    e.preventDefault();
    if (edit && hasFiles(e)) {
      probe(e.clientX, e.clientY, null);
      schedule();
    }
  }, true);
  document.addEventListener("dragleave", function (e) {
    if (e.relatedTarget === null && drop) {
      drop = null;
      schedule();
    }
  }, true);
  document.addEventListener("drop", function (e) {
    e.preventDefault();
    var target = drop;
    drop = null;
    schedule();
    if (!edit || !hasFiles(e)) return;
    var files = Array.prototype.slice.call(e.dataTransfer.files || []);
    if (files.length) post({ type: "dropFiles", files: files, parentId: target ? target.parentId : null, index: target ? target.index : 1e9 });
  }, true);

  // ---------------------------------------------------------------- parent commands
  var PROPS_FALLBACK = ["display", "position"];
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.of !== 1 || e.source !== TOP) return;
    switch (m.type) {
      case "mode":
        edit = !!m.edit;
        if (!edit) {
          endTextEdit(true);
          hoverId = null;
        }
        schedule();
        break;
      case "select":
        selectedId = m.id == null ? null : m.id;
        schedule();
        break;
      case "hover":
        hoverId = m.id == null ? null : m.id;
        schedule();
        break;
      case "spacing":
        spacing = !!m.on;
        schedule();
        break;
      case "reveal": {
        var el = byId(m.id);
        if (el) {
          var r = el.getBoundingClientRect();
          if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "center", behavior: "auto" });
        }
        schedule();
        break;
      }
      case "scroll":
        window.scrollTo(m.x || 0, m.y || 0);
        break;
      case "css": {
        var sel = m.inline != null && m.inline !== false ? 'style[data-of-file="' + m.file + '"][data-of-inline="' + m.index + '"]' : 'style[data-of-file="' + m.file + '"]';
        var st = document.querySelector(sel);
        if (st) st.textContent = m.text;
        schedule();
        break;
      }
      case "live": {
        var t = byId(m.id);
        if (!t) break;
        var rec = liveEls.filter(function (x) { return x.el === t; })[0];
        if (!rec) liveEls.push((rec = { el: t, text: t.getAttribute("style") }));
        Object.keys(m.decls || {}).forEach(function (p) {
          var v = m.decls[p];
          if (v == null || v === "") t.style.removeProperty(p);
          else t.style.setProperty(p, v, "important");
        });
        schedule();
        break;
      }
      case "liveClear":
        liveEls.forEach(function (x) {
          if (x.text == null) x.el.removeAttribute("style");
          else x.el.setAttribute("style", x.text);
        });
        liveEls = [];
        schedule();
        break;
      case "computed": {
        var c = byId(m.id);
        if (!c) {
          post({ type: "computed", reqId: m.reqId, id: m.id, values: null });
          break;
        }
        var cs = getComputedStyle(c);
        var values = {};
        (m.props && m.props.length ? m.props : PROPS_FALLBACK).forEach(function (p) {
          values[p] = cs.getPropertyValue(p);
        });
        var rr = c.getBoundingClientRect();
        var par = c.parentElement ? getComputedStyle(c.parentElement) : null;
        post({
          type: "computed",
          reqId: m.reqId,
          id: m.id,
          values: values,
          tag: c.tagName.toLowerCase(),
          rect: { x: rr.left + window.scrollX, y: rr.top + window.scrollY, w: rr.width, h: rr.height },
          parentDisplay: par ? par.display : "",
          parentDirection: par ? par.flexDirection : "",
          inline: cs.display.indexOf("inline") === 0,
        });
        break;
      }
      case "dropProbe": {
        var hit = probe(m.x, m.y, m.movingId);
        post({ type: "dropTarget", reqId: m.reqId, parentId: hit.parentId, index: hit.index });
        break;
      }
      case "dropEnd":
        drop = null;
        schedule();
        break;
      case "measure": {
        // { on, unit, ppi, dprAware, details, accent }: everything is validated here, the page cannot reach this handler
        // (messages must come from the parent window)
        var wasOn = M.on;
        M.on = !!m.on;
        if (kit.UNITS.indexOf(m.unit) >= 0) M.unit = m.unit;
        if (typeof m.ppi === "number" && m.ppi >= 20 && m.ppi <= 1000) M.ppi = m.ppi;
        M.dprAware = !!m.dprAware;
        M.details = !!m.details;
        if (typeof m.accent === "string" && /^#[0-9a-f]{3,8}$/i.test(m.accent)) M.accent = m.accent;
        if (!M.on) {
          M.el = null;
          M.pins = [];
          M.links = [];
        } else if (!wasOn) hoverId = null;
        M.last = "";
        schedule();
        break;
      }
      case "measureBox": {
        var me = byId(m.id);
        post({ type: "measureBox", reqId: m.reqId, box: me ? wireBox(boxOf(me)) : null });
        break;
      }
      case "textEditStart":
        startTextEdit(m.id, null);
        break;
      case "endTextEdit":
        endTextEdit(true);
        break;
      default:
        break;
    }
  });

  post({ type: "ready", width: window.innerWidth, title: document.title });
  schedule();
}

/** Source text injected into the preview: the function body wrapped in an IIFE. */
export const bridgeSource = `(${bridgeMain.toString()})((${measureKit.toString()})());`;
