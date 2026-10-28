// Chat bubble appearance (Settings ▸ Artificial intelligence ▸ Chat appearance), pure (no DOM).
//
// The preference `chatBubbles` is one small JSON object (portable in .ofprofile files). This module validates it,
// resolves the colors against the current theme and returns CSS custom properties plus modifier classes for the chat
// root (ui/vibe/bubble-style.js applies them, ui/vibe/bubble-settings.js previews them with the same function).
// Rendering stays cheap: no per-message JavaScript, only CSS variables on one element.
//
// Public API
//   BUBBLE_DEFAULTS, BUBBLE_SHAPES, BUBBLE_PRESETS, BUBBLE_KEYS
//   isValidBubbles(v)                   → boolean       (null = defaults)
//   normalizeBubbles(v)                 → complete settings object (unknown/invalid fields fall back to the defaults)
//   resolveBubbleColors(b, env)         → { user, ai, warnings }   env = { accent, panel, text, dark, highContrast }
//        user/ai = { bg, fg, icon, iconHover, iconHoverBg, border, focus }  (all "#rrggbb" or "transparent")
//   bubbleStyle(b, env)                 → { vars, classes, warnings }
// Contrast rules (tests/customize/bubbles.test.js): text on a bubble >= 4.5:1, action icons >= 4.5:1 (they are the only
// way to reach copy / edit), hover state keeps both. A custom text color that fails is replaced by the closest passing
// color and reported in `warnings` so the settings pane can say so.
import { contrast, mix, readableOn, ensureContrast, hex, composite, luminance } from "../ui/themes.js";

export const BUBBLE_SHAPES = ["rounded", "pill", "square", "speech", "thought", "flat"];
export const BUBBLE_PRESETS = ["accent", "soft", "mono", "contrast", "custom"];
export const BUBBLE_TAIL_SIDES = ["sender", "left", "right"];
export const BUBBLE_DENSITIES = ["compact", "comfortable", "spacious"];
export const BUBBLE_WIDTHS = ["narrow", "comfortable", "wide"];
export const BUBBLE_SHADOWS = ["none", "soft", "lifted"];

export const BUBBLE_DEFAULTS = Object.freeze({
  shape: "rounded",
  tail: true, // speech and thought bubbles: show the tail
  tailSide: "sender", // sender = towards the author (right for you, left for the assistant)
  radius: 16, // px, 0..32 (rounded, speech, square keeps 0)
  preset: "accent",
  userBg: "", // custom colors ("" = from the preset)
  userFg: "",
  aiBg: "",
  aiFg: "",
  assistantBubble: false, // false = answers are plain text on the panel (the classic look)
  border: false,
  shadow: "none",
  density: "comfortable",
  width: "comfortable",
  fontSize: 14, // px, 12..20
  avatars: true,
});

export const BUBBLE_KEYS = Object.keys(BUBBLE_DEFAULTS);
const COLOR = /^#[0-9a-fA-F]{6}$/;
const oneOf = (list) => (v) => list.includes(v);
const int = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const CHECKS = {
  shape: oneOf(BUBBLE_SHAPES),
  tail: (v) => typeof v === "boolean",
  tailSide: oneOf(BUBBLE_TAIL_SIDES),
  radius: int(0, 32),
  preset: oneOf(BUBBLE_PRESETS),
  userBg: (v) => v === "" || COLOR.test(v),
  userFg: (v) => v === "" || COLOR.test(v),
  aiBg: (v) => v === "" || COLOR.test(v),
  aiFg: (v) => v === "" || COLOR.test(v),
  assistantBubble: (v) => typeof v === "boolean",
  border: (v) => typeof v === "boolean",
  shadow: oneOf(BUBBLE_SHADOWS),
  density: oneOf(BUBBLE_DENSITIES),
  width: oneOf(BUBBLE_WIDTHS),
  fontSize: int(12, 20),
  avatars: (v) => typeof v === "boolean",
};

/** Whether `v` is null (defaults) or an object whose known fields all have valid values (unknown fields are invalid). */
export function isValidBubbles(v) {
  if (v === null) return true;
  if (typeof v !== "object" || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, x]) => CHECKS[k] && CHECKS[k](x));
}

/** A complete, valid settings object: invalid or missing fields take the default. */
export function normalizeBubbles(v) {
  const out = { ...BUBBLE_DEFAULTS };
  if (v && typeof v === "object" && !Array.isArray(v)) for (const k of BUBBLE_KEYS) if (k in v && CHECKS[k](v[k])) out[k] = v[k];
  return out;
}

const SAFE_PANEL = { dark: "#1b1d26", light: "#ffffff" };
const SAFE_TEXT = { dark: "#e9eaf0", light: "#1a1c24" };

/** Picks a readable text color: the wanted one when it passes 4.5:1, else the closest passing color (`warned` set). */
function textOn(bg, wanted, fallbackText) {
  let want = wanted && COLOR.test(wanted) ? wanted : fallbackText;
  let warned = false;
  if (contrast(want, bg) < 4.5) {
    const dir = luminance(bg) > 0.5 ? -1 : 1;
    let fixed = ensureContrast(want, bg, 4.5, dir);
    if (contrast(fixed, bg) < 4.5) fixed = readableOn(bg);
    warned = !!(wanted && COLOR.test(wanted));
    return { fg: hex(fixed), warned, from: warned ? wanted : undefined };
  }
  return { fg: hex(want), warned };
}

/** Icon / action colors for a bubble: muted but never below 4.5:1, hover state keeps the contrast. */
function actionColors(bg, fg) {
  const dir = luminance(fg) > luminance(bg) ? 1 : -1;
  const icon = ensureContrast(mix(fg, bg, 0.22), bg, 4.5, dir);
  const hoverBg = mix(bg, fg, 0.18);
  const iconHover = contrast(fg, hoverBg) >= 4.5 ? fg : readableOn(hoverBg);
  return { icon: hex(icon), iconHover: hex(iconHover), iconHoverBg: hex(hoverBg), focus: hex(contrast(fg, bg) >= 3 ? fg : readableOn(bg)) };
}

/**
 * Resolves the bubble colors against the theme. `env.panel` is the (opaque, composited) panel color the chat sits on,
 * `env.text` the theme text color, `env.accent` the accent. Glass surfaces pass their composited fill as `panel`, the
 * bubbles themselves are always opaque so the contrast guarantee does not depend on what is behind the glass.
 */
export function resolveBubbleColors(raw, env = {}) {
  const b = normalizeBubbles(raw);
  const dark = !!env.dark;
  const panel = hex(env.panel || (dark ? SAFE_PANEL.dark : SAFE_PANEL.light));
  const text = hex(env.text || (dark ? SAFE_TEXT.dark : SAFE_TEXT.light));
  const accent = hex(env.accent || "#4f46e5");
  const hc = !!env.highContrast;
  const warnings = [];

  let user;
  let ai;
  switch (b.preset) {
    case "soft":
      user = { bg: mix(panel, text, dark ? 0.16 : 0.1) };
      ai = { bg: mix(panel, text, dark ? 0.08 : 0.05) };
      break;
    case "mono":
      user = { bg: text, fg: panel };
      ai = { bg: panel, border: mix(panel, text, 0.35) };
      break;
    case "contrast":
      user = { bg: accent };
      ai = { bg: mix(panel, text, dark ? 0.12 : 0.06), border: text };
      break;
    case "custom":
      user = { bg: COLOR.test(b.userBg) ? b.userBg : mix(panel, accent, dark ? 0.24 : 0.14), fg: b.userFg };
      ai = { bg: COLOR.test(b.aiBg) ? b.aiBg : mix(panel, text, dark ? 0.08 : 0.05), fg: b.aiFg };
      break;
    default: // accent: a soft tint of the accent, like the classic look
      user = { bg: mix(panel, accent, dark ? 0.26 : 0.15) };
      ai = { bg: mix(panel, accent, dark ? 0.08 : 0.05) };
  }
  const plainAi = !b.assistantBubble || b.shape === "flat";
  const out = {};
  for (const [role, spec] of [["user", user], ["ai", ai]]) {
    const flat = b.shape === "flat" || (role === "ai" && plainAi);
    const bg = flat ? panel : hex(composite(spec.bg, panel));
    // a text color passes through when it already works on this background (mono and custom set one)
    const t = textOn(bg, spec.fg, text);
    if (t.warned) warnings.push({ role, kind: "text", from: t.from, to: t.fg, ratio: Math.round(contrast(t.from, bg) * 10) / 10 });
    const fg = hc ? readableOn(bg) : t.fg;
    const a = actionColors(bg, fg);
    const border = hc ? fg : spec.border || (b.border ? mix(bg, fg, 0.35) : "transparent");
    out[role] = { bg: flat ? "transparent" : bg, fg, ...a, border: flat && !hc ? (b.border ? mix(panel, text, 0.3) : "transparent") : border, surface: bg };
  }
  return { user: out.user, ai: out.ai, warnings };
}

const WIDTH = { narrow: "68%", comfortable: "86%", wide: "96%" };
const PAD = { compact: ["6px", "10px", "10px"], comfortable: ["9px", "14px", "14px"], spacious: ["13px", "18px", "20px"] }; // y, x, gap between messages

const SHAPE_RADIUS = (b) => {
  switch (b.shape) {
    case "square":
      return 0;
    case "pill":
      return 22;
    case "thought":
      return Math.max(b.radius, 24);
    case "flat":
      return 0;
    default:
      return b.radius;
  }
};

/** CSS custom properties and modifier classes for the chat root (and the settings preview). */
export function bubbleStyle(raw, env = {}) {
  const b = normalizeBubbles(raw);
  const c = resolveBubbleColors(b, env);
  const [py, px, gap] = PAD[b.density];
  const radius = SHAPE_RADIUS(b);
  const vars = {
    "--of-bub-user-bg": c.user.bg,
    "--of-bub-user-fg": c.user.fg,
    "--of-bub-user-icon": c.user.icon,
    "--of-bub-user-icon-hover": c.user.iconHover,
    "--of-bub-user-icon-bg": c.user.iconHoverBg,
    "--of-bub-user-border": c.user.border,
    "--of-bub-user-focus": c.user.focus,
    "--of-bub-user-surface": c.user.surface,
    "--of-bub-ai-bg": c.ai.bg,
    "--of-bub-ai-fg": c.ai.fg,
    "--of-bub-ai-icon": c.ai.icon,
    "--of-bub-ai-icon-hover": c.ai.iconHover,
    "--of-bub-ai-icon-bg": c.ai.iconHoverBg,
    "--of-bub-ai-border": c.ai.border,
    "--of-bub-ai-focus": c.ai.focus,
    "--of-bub-ai-surface": c.ai.surface,
    "--of-bub-radius": `${radius}px`,
    "--of-bub-pad-y": py,
    "--of-bub-pad-x": px,
    "--of-bub-gap": gap,
    "--of-bub-max": WIDTH[b.width],
    "--of-chat-fs": `${b.fontSize}px`,
    "--of-bub-shadow": b.shadow === "soft" ? "0 1px 3px rgba(0,0,0,0.22)" : b.shadow === "lifted" ? "0 4px 14px rgba(0,0,0,0.3)" : "0 0 0 0 transparent",
  };
  const classes = [`of-bub--${b.shape}`];
  if (b.tail && (b.shape === "speech" || b.shape === "thought")) classes.push("of-bub--tail", `of-bub--tail-${b.tailSide}`);
  if (b.assistantBubble && b.shape !== "flat") classes.push("of-bub--ai");
  if (!b.avatars) classes.push("of-bub--noavatar");
  if (b.density !== "comfortable") classes.push(`of-bub--${b.density}`);
  return { vars, classes, warnings: c.warnings, settings: b };
}
