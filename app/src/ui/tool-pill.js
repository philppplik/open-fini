// Tool pill: a small floating pill at the bottom center of the canvas area that names the active state in words and offers
// its context actions: "Selection active · 1,240 × 860 px  [Deselect] [Invert] [Feather…] [To layer mask] [Fill]", Apply /
// Cancel for crop and liquify, Finish / Close path for the pen, Done editing for text.
//
// Public API: mountToolPill(app, host) -> { destroy }. Loaded lazily by ui/shell.js (it is not needed at start-up).
// What it shows is decided by the pure model in ui/tool-pill-model.js; tools opt in with two optional methods:
//   pillState() -> null | { key|text, params?, actions: [{ id, label, key?, primary? }] }   (an in-progress modal-like state)
//   pillAction(id)                                                                          (runs one of those actions)
// Model actions with a `command` run through app.run (select.none, select.invert, ...), so the pill never re-implements
// behavior. Preference: Settings ▸ Canvas and editing ▸ "Show the tool pill" (`toolPill`, default on).
// Invariants: re-renders only when the signature changes; never steals focus from the canvas (buttons use pointerdown
// preventDefault); respects reduced motion through CSS (.of-reduce-motion and prefers-reduced-motion).
import { h, prettyShortcut } from "../core/util.js";
import { t } from "../i18n/index.js";
import { buildPillModel, pillSignature } from "./tool-pill-model.js";

const STUDIOS = new Set(["pixel", "vector", "layout"]);

export function mountToolPill(app, host) {
  const text = h("span.of-toolpill__text", { "aria-live": "polite" });
  const actions = h("span.of-toolpill__actions");
  const el = h("div.of-toolpill", { role: "group", hidden: true }, text, actions);
  host.append(el);

  let sig = "";
  let boundsCache = null; // { mask, rev, bounds }
  let raf = 0;

  const maskInfo = () => {
    const st = app.state;
    const m = st?.pixelMask;
    if (!m) return null;
    if (!boundsCache || boundsCache.mask !== m || boundsCache.rev !== st.maskRev) boundsCache = { mask: m, rev: st.maskRev, bounds: m.bounds(1) };
    return { width: m.width, height: m.height, bounds: boundsCache.bounds };
  };

  const snapshot = () => {
    const studio = app.studio;
    const on = STUDIOS.has(studio) && !!app.doc;
    const tool = app.tool;
    let pill = null;
    try {
      pill = on ? tool?.pillState?.() || null : null;
    } catch {
      pill = null;
    }
    return {
      enabled: app.prefs.toolPill !== false,
      hasDoc: on,
      studio,
      tool: tool ? { id: tool.id, label: tool.constructor.label, pill } : null,
      mask: on ? maskInfo() : null,
      selectionCount: on ? (app.selection || []).length : 0,
      activeName: app.selection?.length === 1 ? app.selection[0].name : "",
    };
  };

  const run = (a) => {
    if (a.command) app.run(a.command);
    else app.tool?.pillAction?.(a.id);
    schedule();
  };

  const render = () => {
    raf = 0;
    const model = buildPillModel(snapshot());
    const next = pillSignature(model);
    // enabled-state of command buttons can change without the signature changing
    if (model) for (const b of actions.children) if (b._cmd) b.disabled = !app.isEnabled(b._cmd);
    if (next === sig) return;
    sig = next;
    if (!model) {
      el.hidden = true;
      el.classList.remove("is-in");
      return;
    }
    el.dataset.kind = model.kind;
    el.setAttribute("aria-label", t("Context actions"));
    text.textContent = t(model.key, model.params);
    actions.replaceChildren(
      ...model.actions.map((a) => {
        const b = h("button.of-toolpill__btn", { type: "button", title: a.key ? `${t(a.label)} (${prettyShortcut(a.key)})` : t(a.label) }, t(a.label));
        b.classList.toggle("is-primary", !!a.primary);
        b._cmd = a.command || null;
        if (a.command) b.disabled = !app.isEnabled(a.command);
        b.addEventListener("pointerdown", (e) => e.preventDefault()); // keep canvas focus (Enter / Esc keep working)
        b.addEventListener("click", () => run(a));
        return b;
      }),
    );
    const wasHidden = el.hidden;
    el.hidden = false;
    if (wasHidden) requestAnimationFrame(() => el.classList.add("is-in"));
    else el.classList.add("is-in");
  };

  function schedule() {
    if (!raf) raf = requestAnimationFrame(render);
  }

  const offs = ["selection", "pixelmask", "tool", "studio", "prefs", "locale", "overlay", "contextbar", "textcaret"].map((ev) => app.on(ev, schedule));
  schedule();
  return {
    el,
    destroy() {
      offs.forEach((o) => typeof o === "function" && o());
      cancelAnimationFrame(raf);
      el.remove();
    },
  };
}
