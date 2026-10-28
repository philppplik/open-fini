// Applies the chat bubble preferences (customize/bubbles.js, pure) to an element: CSS variables + modifier classes.
// Used by the Vibe chat root and by the live preview in Settings, so both always look the same.
//
// Public API
//   bubbleEnv(el, prefs) → { accent, panel, text, dark, highContrast }   theme colors the contrast math needs
//   applyBubbleStyle(el, prefs) → { warnings, settings }                 sets vars and `of-bubscope` / `of-bub--*` classes
//   watchBubbleStyle(app, el) → stop()                                   re-applies on preference and theme changes
// The panel color is read from what is really behind the chat (computed background colors up the tree, composited), so
// glass, liquid and sea surfaces and custom themes are covered; the bubbles themselves are opaque.
import { parseColor } from "../../core/color.js";
import { composite, hex, luminance } from "../themes.js";
import { bubbleStyle } from "../../customize/bubbles.js";

function effectiveBackground(el) {
  const layers = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const c = parseColor(getComputedStyle(n).backgroundColor || "");
    if (c.a > 0) layers.push(getComputedStyle(n).backgroundColor);
    if (c.a >= 1) break;
  }
  const root = getComputedStyle(document.documentElement);
  let base = hex(root.getPropertyValue("--of-bg-app").trim() || "#1b1d26");
  for (const l of layers.reverse()) base = composite(l, base);
  return base;
}

export function bubbleEnv(el, prefs = {}) {
  const root = getComputedStyle(document.documentElement);
  const v = (name, d) => root.getPropertyValue(name).trim() || d;
  const panel = effectiveBackground(el);
  return { accent: hex(v("--of-accent", "#4f46e5")), panel, text: hex(v("--of-text", "#e9eaf0")), dark: luminance(panel) < 0.4, highContrast: !!prefs.highContrast };
}

export function applyBubbleStyle(el, prefs) {
  const s = bubbleStyle(prefs.chatBubbles, bubbleEnv(el.parentElement || el, prefs));
  for (const [k, v] of Object.entries(s.vars)) el.style.setProperty(k, v);
  for (const c of [...el.classList]) if (c.startsWith("of-bub--")) el.classList.remove(c);
  el.classList.add("of-bubscope", ...s.classes);
  return { warnings: s.warnings, settings: s.settings };
}

export function watchBubbleStyle(app, el) {
  let raf = 0;
  const run = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => el.isConnected && applyBubbleStyle(el, app.prefs));
  };
  const offs = [app.on("prefs", run), app.on("themes", run), app.on("studio", run)];
  run();
  return () => offs.forEach((off) => off?.());
}
