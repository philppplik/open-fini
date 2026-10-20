// Coach-mark tour engine: a popover anchored to real UI, a highlight ring, progress dots, keyboard control
// (Left/Right, Esc, Tab stays inside), focus management and ARIA. Steps come from tour-steps.js.
import { h } from "../core/util.js";
import { TOURS } from "./tour-steps.js";

let active = null;

export const isTourActive = () => !!active;

const visible = (el) => !!el && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== "hidden";

/** Steps of a tour that apply right now (document state) and whose target is on screen. */
export function applicableSteps(app, key) {
  const tour = TOURS[key];
  if (!tour) return [];
  return tour.steps.filter((s) => (s.when === "doc" ? !!app.doc : s.when === "nodoc" ? !app.doc : true) && visible(document.querySelector(s.target)));
}

/**
 * Starts a tour. Resolves with "done", "skipped" or "never" (the user chose "Don't show again").
 * Only one tour runs at a time; starting another ends the first.
 */
export function startTour(app, key) {
  active?.end("skipped");
  const tour = TOURS[key];
  const steps = applicableSteps(app, key);
  if (!tour || !steps.length) return Promise.resolve("skipped");
  return new Promise((resolve) => {
    let i = 0;
    const previous = document.activeElement;
    const uid = `of-coach-${Math.random().toString(36).slice(2, 7)}`;
    const ring = h("div.of-coach__ring", { "aria-hidden": "true" });
    const title = h("h3.of-coach__title", { id: `${uid}-t` });
    const body = h("p.of-coach__body", { id: `${uid}-b` });
    const count = h("span.of-coach__count");
    const dots = h("div.of-coach__dots", { "aria-hidden": "true" }, steps.map(() => h("i")));
    const back = h("button.of-btn", { type: "button" }, "Back");
    const next = h("button.of-btn.of-btn--primary", { type: "button" }, "Next");
    const skip = h("button.of-coach__link", { type: "button" }, "Skip tour");
    const never = h("button.of-coach__link", { type: "button" }, "Don't show again");
    const live = h("div.of-sr-only", { "aria-live": "polite", role: "status" });
    const pop = h("div.of-coach", { role: "dialog", "aria-modal": "false", "aria-labelledby": `${uid}-t`, "aria-describedby": `${uid}-b`, tabindex: "-1" },
      h("div.of-coach__head", count, dots),
      title, body,
      h("div.of-coach__foot", h("div.of-coach__links", skip, never), h("div.of-coach__nav", back, next)),
    );
    document.body.append(ring, pop, live);
    let timer = 0;
    let done = false;

    const target = () => document.querySelector(steps[i].target);

    function place() {
      const step = steps[i];
      const el = target();
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      const pad = step.placement === "center" ? 0 : 4;
      const vw = innerWidth;
      const vh = innerHeight;
      const big = r.width > vw * 0.5 && r.height > vh * 0.5; // huge areas (canvas, welcome): no ring, popover inside
      ring.style.cssText = big ? "display:none" : `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      let x;
      let y;
      let p = step.placement;
      if (big || p === "center") {
        x = r.left + r.width / 2 - pw / 2;
        y = r.top + r.height / 2 - ph / 2;
      } else {
        const fits = { bottom: r.bottom + 12 + ph < vh, top: r.top - 12 - ph > 0, right: r.right + 12 + pw < vw, left: r.left - 12 - pw > 0 };
        if (!fits[p]) p = ["bottom", "top", "right", "left"].find((k) => fits[k]) || "bottom";
        if (p === "bottom") [x, y] = [r.left + r.width / 2 - pw / 2, r.bottom + 12];
        else if (p === "top") [x, y] = [r.left + r.width / 2 - pw / 2, r.top - ph - 12];
        else if (p === "right") [x, y] = [r.right + 12, r.top + Math.min(r.height / 2, 80) - ph / 2];
        else [x, y] = [r.left - pw - 12, r.top + Math.min(r.height / 2, 80) - ph / 2];
      }
      pop.style.left = `${Math.max(8, Math.min(x, vw - pw - 8))}px`;
      pop.style.top = `${Math.max(8, Math.min(y, vh - ph - 8))}px`;
      pop.dataset.placement = p;
    }

    function show(n, dir = 1) {
      // skip steps whose target disappeared meanwhile
      while (n >= 0 && n < steps.length && !visible(document.querySelector(steps[n].target))) n += dir;
      if (n < 0) n = 0;
      if (n >= steps.length) return finish("done");
      i = n;
      const s = steps[i];
      title.textContent = s.title;
      body.textContent = s.body;
      count.textContent = `${tour.title} · ${i + 1} of ${steps.length}`;
      [...dots.children].forEach((d, k) => d.classList.toggle("on", k === i));
      back.disabled = i === 0;
      back.hidden = steps.length === 1;
      next.textContent = i === steps.length - 1 ? "Done" : "Next";
      live.textContent = `${s.title}. Step ${i + 1} of ${steps.length}.`;
      place();
      next.focus({ preventScroll: true });
    }

    function finish(result) {
      if (done) return;
      done = true;
      clearInterval(timer);
      document.removeEventListener("keydown", onKey, true);
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
      ring.remove();
      pop.remove();
      live.remove();
      active = null;
      if (previous?.isConnected && previous.focus) previous.focus({ preventScroll: true });
      resolve(result);
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish("skipped");
      } else if (e.key === "ArrowRight" && !e.altKey) {
        e.preventDefault();
        show(i + 1);
      } else if (e.key === "ArrowLeft" && !e.altKey) {
        e.preventDefault();
        show(i - 1, -1);
      } else if (e.key === "Tab") {
        const f = [...pop.querySelectorAll("button:not([disabled]):not([hidden])")];
        if (!f.length) return;
        const at = f.indexOf(document.activeElement);
        const to = e.shiftKey ? f[(at <= 0 ? f.length : at) - 1] : f[(at + 1) % f.length];
        e.preventDefault();
        to.focus();
      }
    }

    next.addEventListener("click", () => show(i + 1));
    back.addEventListener("click", () => show(i - 1, -1));
    skip.addEventListener("click", () => finish("skipped"));
    never.addEventListener("click", () => finish("never"));
    document.addEventListener("keydown", onKey, true);
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    timer = setInterval(place, 400); // layout can change under the tour (panels loading, studios mounting)
    active = { end: finish };
    show(0);
  });
}

/** Ends the running tour, if any. */
export const endTour = () => active?.end("skipped");
