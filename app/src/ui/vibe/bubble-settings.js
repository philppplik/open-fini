// Settings ▸ Artificial intelligence ▸ Chat appearance ▸ Chat bubbles: shape, tail, corner radius, colors (presets or
// own colors with automatic contrast fixing), border and shadow, density, width, text size and avatars, with a live
// preview made of real chat message markup. The values live in the single preference `chatBubbles`
// (customize/bubbles.js validates and resolves it; ui/vibe/bubble-style.js applies it to the chat and to this preview).
//
// Public API: bubbleSettingsPane(app) → element
// Accessibility: every control is a labeled sl-select / sl-switch / native input; the preview is aria-hidden sample
// content (not interactive), warnings are announced through a polite live region.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { iconEl } from "../toolbox.js";
import { BUBBLE_DEFAULTS, normalizeBubbles, BUBBLE_PRESETS } from "../../customize/bubbles.js";
import { applyBubbleStyle } from "./bubble-style.js";
import { markEl } from "./logo.js";

const SHAPES = [
  ["rounded", "Rounded"],
  ["pill", "Pill"],
  ["square", "Square"],
  ["speech", "Speech bubble"],
  ["thought", "Thought bubble"],
  ["flat", "Flat (no bubble)"],
];
const PRESET_LABELS = { accent: "Accent", soft: "Soft", mono: "Mono", contrast: "Contrast", custom: "Custom colors" };

export function bubbleSettingsPane(app) {
  let state = normalizeBubbles(app.prefs.chatBubbles);
  const warn = h("p.of-bubprev__warn", { role: "status", "aria-live": "polite" });
  const act = (icon, label) => h("span.of-vact", { "aria-hidden": "true", title: label }, iconEl(icon));
  const sample = (role) => {
    const text = role === "user" ? t("Make the headline bigger and move it up.") : t("Done. I made the headline 64 px and moved it up by 24 px.");
    const row = h("div.of-vmsg__actions", act("clipboard", t("Copy")), act("pencil", t("Edit")), act("three-dots", t("More")));
    return role === "user"
      ? h("div.of-vmsg.of-vmsg--user", h("div.of-vmsg__body", h("div.of-vmsg__text", text), row))
      : h("div.of-vmsg.of-vmsg--assistant", h("div.of-vmsg__avatar", markEl()), h("div.of-vmsg__body", h("div.of-vmsg__text", text), row));
  };
  const preview = h("div.of-bubprev", { "aria-hidden": "true" }, sample("user"), sample("assistant"));
  const previewWrap = h("div", h("div.of-set__label", t("Preview")), preview, warn);

  const paint = () => {
    const r = applyBubbleStyle(preview, { ...app.prefs, chatBubbles: state });
    const msgs = r.warnings.map((w) => t("The {role} text color {color} had too little contrast ({ratio}:1) and was adjusted to {fixed} so the text stays readable.", { role: w.role === "user" ? t("sent") : t("answer"), color: w.from, ratio: String(w.ratio), fixed: w.to }));
    warn.textContent = msgs.join(" ");
    warn.hidden = !msgs.length;
  };
  const save = (patch) => {
    state = normalizeBubbles({ ...state, ...patch });
    // store only what differs from the defaults (small profiles); all-default = null
    const diff = Object.fromEntries(Object.entries(state).filter(([k, v]) => v !== BUBBLE_DEFAULTS[k]));
    app.setPref("chatBubbles", Object.keys(diff).length ? diff : null);
    sync();
  };

  // ---- controls
  const row = (label, ...ctl) => h("div.of-bubset__row", h("span.of-bubset__label", label), h("div.of-bubset__ctl", ...ctl));
  const select = (key, options, label) => {
    const s = h("sl-select", { size: "small", value: String(state[key]), "aria-label": label, hoist: true });
    for (const [v, l] of options) s.append(h("sl-option", { value: String(v) }, t(l)));
    s.addEventListener("sl-change", () => save({ [key]: typeof BUBBLE_DEFAULTS[key] === "number" ? Number(s.value) : s.value }));
    return s;
  };
  const sw = (key, label) => {
    const s = h("sl-switch", { size: "small", "aria-label": label });
    s.checked = !!state[key];
    s.addEventListener("sl-change", () => save({ [key]: s.checked }));
    return s;
  };
  const range = (key, min, max, label, unit = "px") => {
    const out = h("span.of-set__hint", `${state[key]} ${unit}`);
    const r = h("input", { type: "range", min, max, step: 1, value: state[key], "aria-label": label });
    r.addEventListener("input", () => {
      out.textContent = `${r.value} ${unit}`;
      state = normalizeBubbles({ ...state, [key]: Number(r.value) });
      paint();
    });
    r.addEventListener("change", () => save({ [key]: Number(r.value) }));
    return [r, out];
  };
  const color = (key, label, fallback) => {
    const c = h("input", { type: "color", value: state[key] || fallback, "aria-label": label, title: label });
    c.addEventListener("input", () => {
      state = normalizeBubbles({ ...state, preset: "custom", [key]: c.value });
      paint();
    });
    c.addEventListener("change", () => save({ preset: "custom", [key]: c.value }));
    return c;
  };
  const reset = h("sl-button", { size: "small", variant: "default" }, t("Reset chat appearance"));
  reset.addEventListener("click", () => {
    app.setPref("chatBubbles", null);
    state = normalizeBubbles(null);
    sync();
  });

  const controls = h("div.of-bubset");
  function sync() {
    const tailOn = state.shape === "speech" || state.shape === "thought";
    const custom = state.preset === "custom";
    const fallback = (k) => (preview.style.getPropertyValue(`--of-bub-${k}-surface`) || "#4f46e5").trim();
    controls.replaceChildren(
      row(t("Shape"), select("shape", SHAPES, t("Bubble shape"))),
      tailOn ? row(t("Tail"), sw("tail", t("Show the tail")), select("tailSide", [["sender", "Towards the author"], ["left", "Always left"], ["right", "Always right"]], t("Tail side"))) : null,
      state.shape === "rounded" || state.shape === "speech" ? row(t("Corner radius"), ...range("radius", 0, 32, t("Corner radius"))) : null,
      row(t("Colors"), select("preset", BUBBLE_PRESETS.map((p) => [p, PRESET_LABELS[p]]), t("Color preset"))),
      custom ? row(t("Your bubble"), color("userBg", t("Your bubble color"), fallback("user")), h("span.of-set__hint", t("Text")), color("userFg", t("Your bubble text color"), "#ffffff")) : null,
      custom ? row(t("Answer bubble"), color("aiBg", t("Answer bubble color"), fallback("ai")), h("span.of-set__hint", t("Text")), color("aiFg", t("Answer bubble text color"), "#ffffff")) : null,
      row(t("Bubble around answers"), sw("assistantBubble", t("Show a bubble around the assistant's answers"))),
      row(t("Border"), sw("border", t("Border around bubbles")), select("shadow", [["none", "No shadow"], ["soft", "Soft shadow"], ["lifted", "Lifted shadow"]], t("Shadow"))),
      row(t("Density"), select("density", [["compact", "Compact"], ["comfortable", "Comfortable"], ["spacious", "Spacious"]], t("Density"))),
      row(t("Width"), select("width", [["narrow", "Narrow"], ["comfortable", "Comfortable"], ["wide", "Wide"]], t("Bubble width"))),
      row(t("Chat text size"), ...range("fontSize", 12, 20, t("Chat text size"))),
      row(t("Avatars"), sw("avatars", t("Show the assistant's avatar"))),
      h("div.of-bubset__row", h("span"), reset),
    );
    paint();
  }
  const root = h("div.of-bubset__root", previewWrap, controls);
  // theme, accent, glass or contrast changes re-resolve the colors (listeners end silently once the pane is gone)
  const offs = [];
  const again = () => (root.isConnected ? paint() : offs.forEach((f) => f?.()));
  offs.push(app.on("prefs", again), app.on("themes", again));
  sync();
  return root;
}
