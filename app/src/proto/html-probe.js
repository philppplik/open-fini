// The browser path of the HTML importer (docs/concepts/proto-studio.md §10.4, task T8): renders sanitized HTML in a
// hidden sandboxed frame at a chosen width and reads back computed styles and boxes, which
// engine/proto/import/html.js ▸ mapProbe turns into layers.
//
//   probeHtml(html, { width, height, timeout }) → Promise<probe tree | null>   (null: the frame did not answer)
//
// Safety: the HTML is sanitized first (engine/proto/import/sanitize.js: no scripts, handlers, embeds or remote
// resources); the frame is `sandbox="allow-scripts"` without allow-same-origin (an opaque origin: no access to
// OpenFini, its storage or cookies) with a Content-Security-Policy that allows only the probe's own data: script, data:
// images and fonts and inline styles, and no network at all. The page's own scripts never reach the frame. The reply
// is plain JSON, size-limited, and treated as data.
import { sanitizeHtml } from "../engine/proto/import/sanitize.js";

const CSP = "default-src 'none'; script-src data:; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/* eslint-disable no-var */
/**
 * Runs INSIDE the sandboxed frame (serialized with Function#toString): self-contained, ES5, no imports. Walks the
 * page and posts the tree to the parent with the nonce.
 */
export function probeKit(nonce, maxNodes) {
  var PROPS = ["display", "position", "left", "top", "right", "bottom", "width", "height", "min-width", "max-width", "min-height", "max-height", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "align-items", "align-self", "justify-content", "align-content", "justify-items", "justify-self", "column-gap", "row-gap", "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-right-style", "border-bottom-style", "border-left-style", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius", "outline-width", "outline-style", "outline-color", "outline-offset", "background-color", "background-image", "background-size", "background-repeat", "opacity", "mix-blend-mode", "box-shadow", "text-shadow", "filter", "backdrop-filter", "overflow-x", "overflow-y", "transform", "visibility", "color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "text-decoration-line", "white-space", "-webkit-line-clamp", "object-fit", "list-style-type"];
  var DECL = ["width", "height", "flex-basis", "grid-template-columns", "grid-template-rows", "min-width", "max-width", "min-height", "max-height"];
  var count = 0;
  var rules = [];
  function collect(list) {
    for (var i = 0; list && i < list.length; i++) {
      var r = list[i];
      if (r.type === 1) rules.push(r);
      else if (r.type === 4 && r.media && window.matchMedia(r.media.mediaText).matches) collect(r.cssRules);
      else if (r.cssRules && r.type !== 7) collect(r.cssRules);
    }
  }
  for (var s = 0; s < document.styleSheets.length; s++) {
    try {
      collect(document.styleSheets[s].cssRules);
    } catch (e) {
      /* unreadable sheet */
    }
  }
  var vars = {};
  var rootStyle = getComputedStyle(document.documentElement);
  for (var v = 0; v < rules.length; v++) {
    if (!/^(:root|html|body)$/.test(String(rules[v].selectorText).trim())) continue;
    for (var k = 0; k < rules[v].style.length; k++) {
      var name = rules[v].style[k];
      if (name.indexOf("--") === 0) vars[name] = rootStyle.getPropertyValue(name).trim();
    }
  }
  function declared(el) {
    var out = {};
    for (var i = 0; i < rules.length; i++) {
      var ok = false;
      try {
        ok = el.matches(rules[i].selectorText);
      } catch (e) {
        ok = false;
      }
      if (!ok) continue;
      for (var j = 0; j < DECL.length; j++) {
        var val = rules[i].style.getPropertyValue(DECL[j]);
        if (val) out[DECL[j]] = val;
      }
    }
    for (var d = 0; d < DECL.length; d++) {
      var iv = el.style.getPropertyValue(DECL[d]);
      if (iv) out[DECL[d]] = iv;
    }
    return out;
  }
  function box(r) {
    return { x: Math.round((r.left + window.scrollX) * 100) / 100, y: Math.round((r.top + window.scrollY) * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 };
  }
  var ATTRS = ["id", "class", "alt", "src", "role", "aria-label", "data-proto-id", "title", "value", "placeholder", "type", "data-href", "width", "height"];
  function walk(el, depth) {
    if (++count > maxNodes || depth > 80) return null;
    var cs = getComputedStyle(el);
    var node = { tag: el.tagName.toLowerCase(), attrs: {}, style: {}, decl: declared(el), box: box(el.getBoundingClientRect()), kids: [] };
    for (var a = 0; a < ATTRS.length; a++) {
      var av = el.getAttribute(ATTRS[a]);
      if (av != null) node.attrs[ATTRS[a]] = ATTRS[a] === "src" && av.length > 16000000 ? "" : String(av);
    }
    if ("value" in el && typeof el.value === "string" && el.type !== "password") node.attrs.value = el.value;
    for (var p = 0; p < PROPS.length; p++) node.style[PROPS[p]] = cs.getPropertyValue(PROPS[p]);
    if (node.tag === "svg") {
      node.svg = el.outerHTML.slice(0, 4000000);
      return node;
    }
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        if (!c.data) continue;
        var range = document.createRange();
        range.selectNodeContents(c);
        node.kids.push({ text: c.data, box: box(range.getBoundingClientRect()) });
      } else if (c.nodeType === 1) {
        var tag = c.tagName.toLowerCase();
        if (tag === "br") node.kids.push({ text: "\n", br: true });
        else if (tag !== "style" && tag !== "script" && tag !== "template") {
          var k2 = walk(c, depth + 1);
          if (k2) node.kids.push(k2);
        }
      }
    }
    return node;
  }
  function send() {
    var body = walk(document.body, 0) || { tag: "body", attrs: {}, style: {}, decl: {}, kids: [] };
    body.htmlStyle = { "background-color": rootStyle.getPropertyValue("background-color") };
    body.vars = vars;
    body.title = document.title || "";
    body.viewport = { w: window.innerWidth, h: window.innerHeight };
    body.box = { x: 0, y: 0, w: document.documentElement.scrollWidth, h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) };
    body.truncated = count > maxNodes;
    parent.postMessage({ ofProtoProbe: nonce, tree: body }, "*");
  }
  function fontsThenSend() {
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(send, send);
    else send();
  }
  // a sandboxed frame runs in its own process: its viewport size arrives a little after load
  var tries = 0;
  function ready() {
    if (window.innerWidth > 0 || tries++ > 60) fontsThenSend();
    else setTimeout(ready, 50);
  }
  if (document.readyState === "complete") ready();
  else window.addEventListener("load", ready);
}
/* eslint-enable no-var */

/**
 * Renders `html` in a hidden sandboxed frame and returns the probe tree (null when it does not answer in time).
 * @param {string} html
 * @param {{ width?: number, height?: number, timeout?: number, maxNodes?: number }} [o]
 */
export function probeHtml(html, { width = 1280, height = 800, timeout = 8000, maxNodes = 20000 } = {}) {
  if (typeof document === "undefined") return Promise.resolve(null);
  const clean = sanitizeHtml(html).html;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  const script = `data:text/javascript;charset=utf-8,${encodeURIComponent(`(${probeKit.toString()})(${JSON.stringify(nonce)}, ${Number(maxNodes)});`)}`;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  const head = /<head(\s[^>]*)?>/i.exec(clean);
  let doc = head ? clean.slice(0, head.index + head[0].length) + meta + clean.slice(head.index + head[0].length) : `<!doctype html><html><head>${meta}</head><body>${clean}</body></html>`;
  doc = doc.replace(/<\/body>/i, `<script src="${script}"></script></body>`);
  if (!/<script src="data:/.test(doc)) doc += `<script src="${script}"></script>`;
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${Math.round(width)}px;height:${Math.round(height)}px;border:0;opacity:0;pointer-events:none`;
    let done = false;
    const finish = (tree) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve(tree);
    };
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || !e.data || e.data.ofProtoProbe !== nonce) return;
      finish(plain(e.data.tree, 0) || null);
    };
    const timer = setTimeout(() => finish(null), timeout);
    window.addEventListener("message", onMessage);
    frame.srcdoc = doc;
    document.body.append(frame);
  });
}

/** The reply reduced to plain data of the expected shape (the frame's content is untrusted). */
function plain(n, depth) {
  if (!n || typeof n !== "object" || depth > 90) return null;
  if (typeof n.text === "string") return { text: n.text.slice(0, 100000), ...(n.br ? { br: true } : {}), ...(n.box ? { box: rect(n.box) } : {}) };
  const strMap = (o, max) => {
    const out = {};
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o).slice(0, 200)) if (typeof v === "string") out[k] = v.slice(0, max);
    return out;
  };
  const out = { tag: String(n.tag || "div").slice(0, 32), attrs: strMap(n.attrs, 20000000), style: strMap(n.style, 4000), decl: strMap(n.decl, 2000), kids: [] };
  if (n.box) out.box = rect(n.box);
  if (typeof n.svg === "string") out.svg = n.svg;
  if (Array.isArray(n.kids)) for (const k of n.kids.slice(0, 5000)) {
    const c = plain(k, depth + 1);
    if (c) out.kids.push(c);
  }
  if (depth === 0) {
    out.vars = strMap(n.vars, 1000);
    out.title = typeof n.title === "string" ? n.title.slice(0, 200) : "";
    out.htmlStyle = strMap(n.htmlStyle, 200);
    if (n.viewport) out.viewport = rect({ x: 0, y: 0, ...n.viewport });
    out.truncated = !!n.truncated;
  }
  return out;
}
const rect = (r) => ({ x: +r.x || 0, y: +r.y || 0, w: Math.max(0, +r.w || 0), h: Math.max(0, +r.h || 0) });
