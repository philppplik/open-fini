// Presentation app: the slide show. A full-screen overlay with the audience view (current slide, fade / slide-in
// transitions, click or keys to advance) and an optional presenter view (current slide, next-slide preview, speaker
// notes, timer and clock). Hidden slides are skipped. Keys: → ↓ Space Enter PageDown next; ← ↑ Backspace PageUp
// previous; Home / End; number + Enter jumps; B / W black or white screen; P toggles the presenter view; T restarts
// the timer; Esc ends. Transitions respect prefers-reduced-motion.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { slideNode, scaledSlide } from "./slide-dom.js";

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function startShow(view, { start, presenter = false }) {
  const deck = () => view.deck;
  const list = () => deck().slides.filter((s) => !s.hidden);
  let idx = Math.max(0, list().findIndex((s) => s.id === start));
  let blank = null;
  let typed = "";
  let t0 = Date.now();
  const reduce = matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const screen = h("div.of-sl-show__screen");
  const audience = h("div.of-sl-show__audience", screen);
  const nextBox = h("div.of-sl-show__next");
  const notes = h("div.of-sl-show__notes", { "aria-label": t("Speaker notes") });
  const timer = h("span.of-sl-show__timer", { role: "timer" });
  const clock = h("span.of-sl-show__clock");
  const counter = h("span.of-sl-show__counter", { "aria-live": "polite" });
  const btn = (icon, label, fn) => h("button.of-tk-btn", { type: "button", "aria-label": t(label), title: t(label), onclick: fn }, h("sl-icon", { name: icon }));
  const bar = h("div.of-sl-show__bar", btn("chevron-left", "Previous slide", () => go(idx - 1)), counter, btn("chevron-right", "Next slide", () => go(idx + 1)), timer, btn("arrow-counterclockwise", "Restart timer", () => (t0 = Date.now())), clock, btn("display", "Toggle presenter view", () => toggle()), btn("x-lg", "End show", () => end()));
  const side = h("div.of-sl-show__side", h("div.of-sl-show__label", t("Next slide")), nextBox, h("div.of-sl-show__label", t("Speaker notes")), notes);
  const root = h("div.of-sl-show", { tabindex: "0", role: "dialog", "aria-modal": "true", "aria-label": t("Slide show") }, audience, side, bar);
  root.classList.toggle("is-presenter", presenter);

  const fitNode = (node, box) => {
    const { w, h: hh } = deck().size;
    const s = Math.min(box.clientWidth / w, box.clientHeight / hh) || 1;
    node.style.transform = `translate(${(box.clientWidth - w * s) / 2}px, ${(box.clientHeight - hh * s) / 2}px) scale(${s})`;
  };

  const render = (dir = 0) => {
    const slides = list();
    idx = Math.max(0, Math.min(slides.length - 1, idx));
    const s = slides[idx];
    const node = slideNode(deck(), s, view.urls);
    node.classList.add("of-sl-show__slide");
    const old = [...screen.children];
    screen.append(node);
    fitNode(node, screen);
    const tr = s.transition;
    const dur = tr.duration * 1000;
    if (dir && !reduce && tr.type !== "none" && node.animate) {
      const kf = tr.type === "fade" ? [{ opacity: 0 }, { opacity: 1 }] : [{ translate: `${dir * 100}% 0` }, { translate: "0 0" }];
      const a = node.animate(kf, { duration: dur, easing: "ease-out" });
      if (tr.type === "slide") for (const o of old) o.animate([{ translate: "0 0" }, { translate: `${-dir * 100}% 0` }], { duration: dur, easing: "ease-out", fill: "forwards" });
      a.finished.then(() => old.forEach((o) => o.remove()), () => old.forEach((o) => o.remove()));
    } else old.forEach((o) => o.remove());
    counter.textContent = t("Slide {n} of {total}", { n: idx + 1, total: slides.length });
    const nx = slides[idx + 1];
    nextBox.replaceChildren(nx ? scaledSlide(deck(), nx, view.urls, Math.max(120, nextBox.clientWidth || 280)) : h("div.of-sl-show__end", t("End of the show")));
    notes.textContent = s.notes || t("No speaker notes for this slide.");
    view.goTo(s.id);
  };

  const go = (i) => {
    blank = null;
    root.classList.remove("is-black", "is-white");
    const n = list().length;
    if (i >= n) return end();
    if (i < 0 || i === idx) return;
    const dir = i > idx ? 1 : -1;
    idx = i;
    render(dir);
  };
  const toggle = () => {
    root.classList.toggle("is-presenter");
    requestAnimationFrame(() => render(0));
  };

  const onKey = (e) => {
    const k = e.key;
    e.stopPropagation();
    if (/^[0-9]$/.test(k)) return void (typed += k);
    if (k === "Enter" && typed) {
      go(Number(typed) - 1);
      typed = "";
    } else if (["ArrowRight", "ArrowDown", " ", "Enter", "PageDown", "n", "N"].includes(k)) go(idx + 1);
    else if (["ArrowLeft", "ArrowUp", "Backspace", "PageUp", "p"].includes(k)) go(idx - 1);
    else if (k === "Home") go(0);
    else if (k === "End") go(list().length - 1);
    else if (k === "b" || k === "B" || k === "." || k === "w" || k === "W") {
      const c = k === "w" || k === "W" ? "is-white" : "is-black";
      blank = blank === c ? null : c;
      root.classList.remove("is-black", "is-white");
      if (blank) root.classList.add(blank);
    } else if (k === "P") toggle();
    else if (k === "t" || k === "T") t0 = Date.now();
    else if (k === "Escape") end();
    else return;
    typed = "";
    e.preventDefault();
  };
  root.addEventListener("keydown", onKey);
  audience.addEventListener("click", (e) => !e.target.closest("button") && go(idx + 1));
  audience.addEventListener("contextmenu", (e) => (e.preventDefault(), go(idx - 1)));
  const tick = () => {
    timer.textContent = fmt(Date.now() - t0);
    clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  const iv = setInterval(tick, 1000);
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => render(0)) : null;
  let ended = false;
  const onFs = () => !document.fullscreenElement && end();
  function end() {
    if (ended) return;
    ended = true;
    clearInterval(iv);
    ro?.disconnect();
    document.removeEventListener("fullscreenchange", onFs);
    if (document.fullscreenElement === root) document.exitFullscreen?.().catch(() => {});
    root.remove();
    view.stage.focus();
  }

  document.body.append(root);
  tick();
  render(0);
  ro?.observe(root);
  root.focus();
  root.requestFullscreen?.().then(() => document.addEventListener("fullscreenchange", onFs)).catch(() => {});
  return { end, go: (i) => go(i), get index() { return idx; } };
}
