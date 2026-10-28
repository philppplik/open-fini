// Inline comment UI (lazy; part of the collaboration runtime): "Add comment here…" composer popover, numbered comment
// pins with a thread popover, comment mode, the status bar toggle and keyboard navigation between comments.
//
// Public API: installCommentUI(app, c) → api (once per window; c = collab controller, see runtime.js)
//   api.composeFor(opts)            opts = a context-menu target { kind, x, y, data, selection } or {} (current selection)
//   api.compose({ anchor, at })     opens the composer popover at screen point `at` for a ready-made anchor
//   api.openThread(id, { at, hover, focus })   thread popover next to a pin (or `at`)
//   api.closePopover()             api.step(dir)   focus the next/previous comment pin (also "]" and "[")
//   api.makePin(thread, number, { draggable })  the pin button (used by overlay.js for canvas, code and Office pins)
//   api.pinsVisible() / api.setPinsVisible(on) / api.commentMode(on)
//   api.selected                   id of the thread whose popover is open
// Anchor building per studio: collab/anchors.js (pure, unit tested). Works without a room (comments live in the document).
// Accessibility: popovers are non-modal role="dialog"s; Escape closes and returns focus to the pin; the composer
// textarea gets focus; pins are real buttons with aria-labels; mention suggestions use a listbox with aria-activedescendant.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { pageBounds } from "../../core/transform.js";
import { pick } from "../../engine/hit.js";
import { LIMITS, canDo } from "../../collab/protocol.js";
import { canvasAnchor, codeAnchor, elementAnchor, moveAnchor, pinNumbers, popoverPosition, stepThread } from "../../collab/anchors.js";
import { filterThreads, threadTitle } from "../../collab/comments.js";
import { elementPath, describe as describeEl } from "../../engine/web/html.js";

const CANVAS_STUDIOS = ["vector", "pixel", "layout"];
const CANVAS_KINDS = new Set(["canvas-empty", "canvas-layers", "canvas-text", "table", "table-cell", "chart"]);
const fmt = (ts) => new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
// plain initials avatar (the full avatarEl with re-encoded images lives in runtime.js; comments only need initials)
const avatarEl = (p, size = 22) => h("span.of-collab-avatar", { style: `--of-collab-color:${/^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color : "#888888"};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`, "aria-hidden": "true" }, p.initials || "?");
const icon = (name) => h("sl-icon", { name, "aria-hidden": "true" });
const button = (label, onClick, { ic, title, primary = false, cls = "" } = {}) => {
  const b = h("button.of-collab-btn", { type: "button", class: `${cls}${primary ? " of-collab-btn--primary" : ""}`, title: title || undefined }, ic ? icon(ic) : null, label ? h("span", label) : null);
  if (!label && title) b.setAttribute("aria-label", title);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(e, b);
  });
  return b;
};

let api = null;

export function installCommentUI(app, c) {
  if (api) return api;
  let pop = null; // { el, kind, id, hover, opener, draft }
  let lastPointer = null;
  let mode = false;
  let hoverTimer = 0;
  let leaveTimer = 0;

  document.addEventListener("pointermove", (e) => (lastPointer = { x: e.clientX, y: e.clientY }), { passive: true });

  const doc = () => app.doc;
  const canComment = () => {
    const s = c.session;
    return !(s && s.state === "open" && !canDo(s.myRole, "comment"));
  };
  const pinsVisible = () => app.prefs.collabPins !== false;

  // ------------------------------------------------------------------ anchors
  /** Anchor and screen point for a context-menu target (or the current selection when `opts` is empty). */
  function anchorFor(opts = {}) {
    const d = opts.data || {};
    const at = Number.isFinite(opts.x) ? { x: opts.x, y: opts.y } : null;
    // canvas studios: the clicked page point and the layer under it
    if (CANVAS_KINDS.has(opts.kind) && d.canvasEvent) {
      const ev = d.canvasEvent;
      const page = ev.page || app.page;
      const zoom = app.view?.zoom || 1;
      const hit = app.context ? pick(app.context, ev.x, ev.y, 6 / zoom) : null;
      const node = hit?._parent ? hit : null;
      return { anchor: canvasAnchor({ pageId: page.id, node, bounds: node ? pageBounds(node) : null, point: { x: ev.x, y: ev.y } }), at };
    }
    if (opts.kind === "layers-row" && d.node?._parent) {
      const b = pageBounds(d.node);
      const page = d.node._page || app.page;
      if (b) return { anchor: canvasAnchor({ pageId: page.id, node: d.node, bounds: b, point: { x: b.x + b.w, y: b.y } }), at };
    }
    // code editor: caret or selected range
    const view = d.view || (app.studio === "code" ? app.codeUI?.editors?.view : null);
    if ((opts.kind === "code-editor" || (!opts.kind && app.studio === "code")) && view) {
      const sel = view.state.selection.main;
      const pos = (p) => {
        const l = view.state.doc.lineAt(p);
        return { line: l.number, col: p - l.from };
      };
      const path = d.editors?.active || app.codeUI?.editors?.active || "";
      const quote = sel.empty ? view.state.doc.lineAt(sel.head).text.trim() : view.state.sliceDoc(sel.from, Math.min(sel.to, sel.from + 200));
      let pt = at;
      if (!pt) {
        const r = view.coordsAtPos(sel.head);
        if (r) pt = { x: r.left, y: r.bottom };
      }
      return { anchor: codeAnchor({ path, from: pos(sel.from), to: sel.empty ? null : pos(sel.to), quote }), at: pt };
    }
    // website element (the website designer's hit test already ran: the menu selected the element)
    if (opts.kind === "web-element" && d.element) {
      const el = d.element;
      const ws = d.ws || app.codeUI;
      let sel;
      try {
        sel = elementPath(el).join("/");
      } catch {
        /* the element has no parent chain (should not happen) */
      }
      return { anchor: elementAnchor({ elem: String(el.id), sel, path: ws?.page, quote: describeEl(el), page: undefined }), at };
    }
    // Office and everything else: the selection (runtime.currentAnchor knows Office paragraphs and layers)
    let pt = at;
    if (!pt && app.studio === "office") {
      const sel = window.getSelection?.();
      const r = sel && sel.rangeCount ? sel.getRangeAt(0).getClientRects()[0] : null;
      if (r) pt = { x: r.left, y: r.bottom };
    }
    if (!pt && CANVAS_STUDIOS.includes(app.studio) && app.activeNode?._parent) {
      const b = pageBounds(app.activeNode);
      if (b) {
        const [sx, sy] = app.pageToScreen(b.x + b.w, b.y, app.activeNode._page);
        const r = app.cv?.stage?.getBoundingClientRect();
        if (r) pt = { x: r.left + sx, y: r.top + sy };
      }
    }
    return { anchor: c.currentAnchor(), at: pt };
  }

  const anchorText = (d, a) => {
    switch (a.kind) {
      case "node": {
        const n = d.find(a.node);
        return n ? t("Layer “{name}”", { name: n.name || n.type }) : t("Deleted layer “{name}”", { name: a.quote || "?" });
      }
      case "region":
        return t("A point on the page");
      case "page":
        return t("Page “{name}”", { name: d.pages.find((p) => p.id === a.page)?.name || "" });
      case "line":
        return a.endLine ? t("{file}, lines {from}–{to}", { file: (a.path || "").split("/").pop(), from: a.line, to: a.endLine }) : t("{file}, line {line}", { file: (a.path || "").split("/").pop(), line: a.line });
      case "text":
        return a.quote ? t("Text “{quote}”", { quote: a.quote.slice(0, 40) }) : t("Text");
      case "element":
        return t("Website element {name}", { name: a.quote || a.elem });
      default:
        return t("Document");
    }
  };

  // ------------------------------------------------------------------ popover plumbing
  function closePopover(restore = true) {
    clearTimeout(hoverTimer);
    clearTimeout(leaveTimer);
    if (!pop) return;
    const { el, opener, id } = pop;
    pop = null;
    el.remove();
    api.selected = null;
    app.requestOverlay();
    if (restore) {
      const pin = id && document.querySelector(`.of-cpin[data-thread="${CSS.escape(id)}"]`);
      const target = pin || (opener?.isConnected ? opener : null);
      (target || app.cv?.stage)?.focus?.({ preventScroll: true });
    }
  }

  function place(el, at, anchorRect) {
    document.body.append(el);
    const r = el.getBoundingClientRect();
    const x = anchorRect ? anchorRect.right : at?.x ?? innerWidth / 2;
    const y = anchorRect ? anchorRect.top : at?.y ?? innerHeight / 3;
    const p = popoverPosition({ x, y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight });
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
  }

  function popoverShell(label, ...kids) {
    const el = h("section.of-cpop", { role: "dialog", "aria-modal": "false", "aria-label": label, tabIndex: -1 }, ...kids);
    el.addEventListener("keydown", (e) => {
      e.stopPropagation(); // typing here must not trigger canvas shortcuts
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        closePopover();
      }
    });
    return el;
  }

  document.addEventListener("pointerdown", (e) => {
    if (pop && !pop.el.contains(e.target) && !e.target.closest?.(".of-cpin, .of-ctxmenu")) closePopover(false);
  }, true);

  // ------------------------------------------------------------------ @mention suggestions
  function attachMentions(ta) {
    const list = h("ul.of-cpop__mentions", { role: "listbox", hidden: true, "aria-label": t("Room members") });
    let items = [];
    let sel = 0;
    const members = () => (c.session ? [...c.session.room.members.values()].filter((m) => m.profile && m.id !== c.myId) : []);
    const close = () => {
      list.hidden = true;
      ta.removeAttribute("aria-activedescendant");
      items = [];
    };
    const draw = () => {
      list.replaceChildren(...items.map((m, i) => {
        const li = h("li", { role: "option", id: `of-mention-${i}`, "aria-selected": String(i === sel) }, h("span.of-cpop__dot", { style: `background:${m.profile.color}` }), m.profile.nick);
        li.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          pickItem(i);
        });
        return li;
      }));
      ta.setAttribute("aria-activedescendant", `of-mention-${sel}`);
    };
    const pickItem = (i) => {
      const m = items[i];
      if (!m) return;
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos).replace(/@[^\s@]{0,24}$/, `@${m.profile.nick} `);
      ta.value = before + ta.value.slice(pos);
      ta.setSelectionRange(before.length, before.length);
      close();
      ta.focus();
    };
    const update = () => {
      const m = /(^|\s)@([^\s@]{0,24})$/.exec(ta.value.slice(0, ta.selectionStart));
      if (!m) return close();
      const q = m[2].toLowerCase();
      items = members().filter((x) => x.profile.nick.toLowerCase().includes(q)).slice(0, 6);
      if (!items.length) return close();
      sel = Math.min(sel, items.length - 1);
      list.hidden = false;
      draw();
    };
    ta.addEventListener("input", update);
    ta.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        sel = (sel + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        draw();
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopImmediatePropagation();
        pickItem(sel);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    }, true);
    ta.addEventListener("blur", () => setTimeout(close, 120));
    return h("div.of-cpop__field", ta, list);
  }

  // ------------------------------------------------------------------ composer
  function compose({ anchor, at = null, text = "" }) {
    const d = doc();
    if (!d) return;
    if (!canComment()) return app.toast(t("Your role in this room does not allow comments."), "warning", 3000);
    closePopover(false);
    const ta = h("textarea.of-collab-input", { rows: 3, maxLength: LIMITS.commentText, placeholder: c.session ? t("Add a comment… (@ to mention)") : t("Add a comment…"), "aria-label": t("Comment") });
    ta.value = text;
    const submit = () => {
      try {
        const th = c.addThread(d, anchor, ta.value);
        closePopover(false);
        app.toast(t("Comment added."), "success", 1500);
        requestAnimationFrame(() => {
          app.requestOverlay();
          const pin = document.querySelector(`.of-cpin[data-thread="${CSS.escape(th.id)}"]`);
          if (pin) pin.focus({ preventScroll: true });
        });
      } catch (e) {
        app.toast(e.message, "warning", 3000);
      }
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
    const opener = document.activeElement;
    const el = popoverShell(t("New comment"), h("div.of-cpop__anchor", icon("chat-quote"), h("span", anchorText(d, anchor))), attachMentions(ta), h("div.of-collab-actions", button(t("Cancel"), () => closePopover()), button(t("Comment"), submit, { primary: true })), h("p.of-collab-hint", t("Ctrl+Enter to post.")));
    pop = { el, kind: "compose", opener };
    place(el, at || lastPointer);
    ta.focus();
  }

  function composeFor(opts = {}) {
    if (!doc()) return;
    const { anchor, at } = anchorFor(opts);
    compose({ anchor, at, text: opts.text || "" });
  }

  // ------------------------------------------------------------------ thread popover
  function openThread(id, { at = null, hover = false, focus = true } = {}) {
    const d = doc();
    const th = d && c.threads(d).find((x) => x.id === id);
    if (!th) return;
    if (pop?.kind === "thread" && pop.id === id) {
      if (!hover) pop.hover = false;
      return;
    }
    closePopover(false);
    const opener = document.activeElement;
    const el = popoverShell(t("Comment thread"));
    pop = { el, kind: "thread", id, hover, opener, draft: "" };
    api.selected = id;
    if (hover) {
      el.addEventListener("pointerenter", () => clearTimeout(leaveTimer));
      el.addEventListener("pointerleave", () => api.hoverEnd());
    }
    renderThread(th);
    const pin = document.querySelector(`.of-cpin[data-thread="${CSS.escape(id)}"]`);
    place(el, at || lastPointer, pin?.getBoundingClientRect());
    app.requestOverlay();
    if (focus && !hover) el.querySelector("textarea")?.focus();
  }

  function renderThread(th) {
    if (!pop || pop.kind !== "thread") return;
    const d = doc();
    const n = pinNumbers(c.threads(d)).get(th.id);
    const hadFocus = pop.el.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA" && document.activeElement.dataset.role === "reply";
    const mine = c.isMine(th.author);
    const head = h("div.of-cpop__head", h("span.of-cpop__num", { style: `background:${th.color || "#888888"}` }, String(n || "")), h("span.of-cpop__where", anchorText(d, th.anchor)));
    if (canComment()) head.append(button(th.resolved ? t("Reopen") : t("Resolve"), () => c.setResolved(d, th.id, !th.resolved), { ic: th.resolved ? "arrow-counterclockwise" : "check2-circle" }));
    if (mine || c.session?.isHost) head.append(button("", () => (c.commentOp(d, { op: "drop", threadId: th.id }), closePopover()), { ic: "trash3", title: t("Delete thread") }));
    head.append(button("", () => closePopover(), { ic: "x-lg", title: t("Close") }));
    const msgs = th.messages.map((m) => {
      const row = h("div.of-thread__msg", avatarEl({ color: m.color, initials: (m.nick || "?").slice(0, 2).toUpperCase() }, 22), h("div", h("div.of-msg__head", h("span.of-msg__who", m.nick || t("Unknown author")), h("time.of-msg__time", fmt(m.ts)), m.edited && !m.deleted ? h("span.of-msg__edited", t("edited")) : null), m.deleted ? h("p.of-msg__text.of-msg__text--deleted", t("Comment deleted")) : h("p.of-msg__text", m.text)));
      if (c.isMine(m.author) && !m.deleted) {
        row.append(h("div.of-msg__tools",
          button("", () => {
            const ta = h("textarea.of-collab-input", { rows: 2, value: m.text, "aria-label": t("Edit comment") });
            row.querySelector(".of-msg__text").replaceWith(h("div", ta, h("div.of-collab-actions", button(t("Cancel"), () => renderThread(th)), button(t("Save"), () => (c.commentOp(d, { op: "edit", threadId: th.id, msgId: m.id, text: ta.value.trim() || m.text }), renderThread(th)), { primary: true }))));
            ta.focus();
          }, { ic: "pencil", title: t("Edit") }),
          button("", () => c.commentOp(d, { op: "delete", threadId: th.id, msgId: m.id }), { ic: "trash3", title: t("Delete") }),
        ));
      }
      return row;
    });
    const kids = [head, h("div.of-cpop__msgs", ...msgs)];
    if (th.resolved) kids.push(h("p.of-collab-hint", t("Resolved by {name} · {date}", { name: th.resolvedBy || "?", date: th.resolvedAt ? fmt(th.resolvedAt) : "" })));
    if (canComment()) {
      const ta = h("textarea.of-collab-input", { rows: 2, maxLength: LIMITS.commentText, placeholder: t("Reply…"), "aria-label": t("Reply to this comment") });
      ta.dataset.role = "reply";
      ta.value = pop.draft || "";
      ta.addEventListener("input", () => pop && (pop.draft = ta.value));
      const send = () => {
        try {
          if (c.reply(d, th.id, ta.value)) pop.draft = ta.value = "";
        } catch (e) {
          app.toast(e.message, "warning", 2500);
        }
      };
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.defaultPrevented) {
          e.preventDefault();
          send();
        }
      });
      kids.push(h("div.of-thread__reply", attachMentions(ta), button("", send, { ic: "send", title: t("Reply") })));
    }
    if (!th.resolved && app.prefs.aiEnabled) kids.push(h("div.of-collab-actions", button(t("Resolve with AI"), () => (closePopover(false), resolveWithAI(th)), { ic: "stars", title: t("Let the assistant read this comment, make the edit and resolve it") })));
    kids.push(h("div.of-collab-actions", button(t("Open in Comments"), () => (closePopover(false), import("./runtime.js").then((m) => m.openCollab(app, "comments")).then(() => c.events.dispatchEvent(new CustomEvent("focus-thread", { detail: th.id })))), { ic: "chat-quote" })));
    pop.el.setAttribute("aria-label", t("Comment thread {n} by {name}", { n: n || "", name: th.nick || t("Unknown author") }));
    pop.el.replaceChildren(...kids);
    if (hadFocus) pop.el.querySelector("textarea[data-role=reply]")?.focus();
  }

  /** Starts a Vibe run that addresses one comment: the comment is the targeted context (vibe/quick-actions.js). */
  async function resolveWithAI(th) {
    if (!app.prefs.aiEnabled) return app.toast(t("AI features are off. Turn them on in Settings ▸ Artificial intelligence."), "warning", 4000);
    const { runQuickAction } = await import("../../vibe/quick-actions.js");
    await runQuickAction(app, {
      label: "Resolve comment",
      prompt: `Address the comment thread ${th.id} of the open document: call get_comment_context with thread_id "${th.id}" to read the exact place, make the precise edit with the right tools, then reply_comment with what you changed and resolve_comment. If the comment is a question or needs a decision, reply with an answer or question instead and leave it open.`,
      extra: `Comment (${th.nick || "Unknown author"}): ${threadTitle(th)}`,
    });
  }

  c.events.addEventListener("change", (e) => {
    if (pop?.kind !== "thread" || (e.detail !== "comments" && e.detail !== "all")) return;
    const th = doc() && c.threads(doc()).find((x) => x.id === pop.id);
    if (!th) return closePopover(false);
    renderThread(th);
  });
  app.on("doc", () => pop && closePopover(false));

  // ------------------------------------------------------------------ pins
  const visibleThreads = () => (doc() ? filterThreads(c.threads(doc()), { status: "open" }) : []);

  function makePin(th, n, { draggable = false } = {}) {
    const b = h("button.of-cpin", { type: "button" });
    b.dataset.thread = th.id;
    refreshPin(b, th, n);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (b.dataset.dragged) return void delete b.dataset.dragged;
      pop?.kind === "thread" && pop.id === b.dataset.thread && !pop.hover ? closePopover() : openThread(b.dataset.thread, { focus: true });
    });
    b.addEventListener("pointerenter", () => {
      if (pop || mode) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => !pop && openThread(b.dataset.thread, { hover: true, focus: false }), 450);
    });
    b.addEventListener("pointerleave", () => api.hoverEnd());
    b.addEventListener("keydown", (e) => {
      if (e.key === "]" || e.key === "[") {
        e.preventDefault();
        step(e.key === "]" ? 1 : -1);
      }
    });
    if (draggable) b.addEventListener("pointerdown", (e) => startDrag(e, b));
    else b.addEventListener("pointerdown", (e) => e.stopPropagation());
    return b;
  }

  function refreshPin(b, th, n) {
    b.dataset.thread = th.id;
    b.style.setProperty("--of-collab-color", th.color || "#888888");
    b.textContent = String(n);
    b.classList.toggle("is-selected", api.selected === th.id);
    const label = t("Comment {n} by {name}: {text}", { n, name: th.nick || "?", text: threadTitle(th) });
    b.setAttribute("aria-label", label);
    b.title = label;
  }

  /** Drag a canvas pin to re-anchor its thread (author or host). A click without movement still opens the thread. */
  function startDrag(e, b) {
    e.stopPropagation();
    if (e.button !== 0) return;
    const d = doc();
    const th = d && c.threads(d).find((x) => x.id === b.dataset.thread); // looked up now: pins are reused between threads
    if (!th || !(c.isMine(th.author) || c.session?.isHost) || !canComment() || !app.cv?.stage) return;
    const stage = app.cv.stage.getBoundingClientRect();
    const sx0 = e.clientX;
    const sy0 = e.clientY;
    const base = b.style.transform;
    let moved = false;
    b.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx0, ev.clientY - sy0) < 5) return;
      moved = true;
      closePopover(false);
      b.classList.add("is-dragging");
      b.style.transform = `${base} translate(${ev.clientX - sx0}px, ${ev.clientY - sy0}px)`;
    };
    const up = (ev) => {
      b.removeEventListener("pointermove", move);
      b.removeEventListener("pointerup", up);
      b.removeEventListener("pointercancel", up);
      b.classList.remove("is-dragging");
      if (!moved) return;
      b.dataset.dragged = "1";
      setTimeout(() => delete b.dataset.dragged, 50);
      const page = d.pages.find((p) => p.id === th.anchor.page) || app.page;
      const [px, py] = app.pageToScreen(0, 0, page);
      const zoom = app.view?.zoom || 1;
      const point = { x: (ev.clientX - stage.left - px) / zoom, y: (ev.clientY - stage.top - py) / zoom };
      const hit = app.context ? pick(app.context, point.x, point.y, 6 / zoom) : null;
      const node = hit?._parent && hit._page === page ? hit : null;
      if (ev.type !== "pointercancel") c.reanchor(d, th.id, moveAnchor(th.anchor, { node, bounds: node ? pageBounds(node) : null, point }));
      app.requestOverlay();
    };
    b.addEventListener("pointermove", move);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
  }

  function step(dir) {
    const ids = [...document.querySelectorAll(".of-cpin")].map((p) => p.dataset.thread);
    const order = visibleThreads().sort((a, b) => a.ts - b.ts).map((x) => x.id).filter((id) => ids.includes(id));
    const next = stepThread(order, pop?.id || document.activeElement?.dataset?.thread || null, dir);
    if (!next) return app.toast(t("No comments on this page."), "primary", 1500);
    const pin = document.querySelector(`.of-cpin[data-thread="${CSS.escape(next)}"]`);
    closePopover(false);
    pin?.focus({ preventScroll: false });
    c.events.dispatchEvent(new CustomEvent("focus-thread", { detail: next, cancelable: true }));
  }

  // ------------------------------------------------------------------ comment mode, keys, toggles
  function commentMode(on = !mode) {
    mode = !!on;
    document.documentElement.classList.toggle("of-comment-mode", mode);
    syncButton();
    if (mode) app.emit("status", t("Comment mode: click where the comment belongs. Esc or C leaves."));
    else app.emit("status", "");
  }

  document.addEventListener("pointerdown", (e) => {
    if (!mode || e.button !== 0 || e.target.closest?.(".of-cpop, .of-cpin, .of-collab-win, .of-ctxmenu, .of-status")) return;
    const stage = app.cv?.stage;
    if (stage && CANVAS_STUDIOS.includes(app.studio) && stage.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      const ev = app.cv.makeEvent(e);
      commentMode(false);
      composeFor({ kind: "canvas-empty", x: e.clientX, y: e.clientY, data: { canvasEvent: ev } });
    }
  }, true);
  document.addEventListener("pointerup", (e) => {
    if (!mode || e.button !== 0 || e.target.closest?.(".of-cpop, .of-cpin, .of-collab-win, .of-ctxmenu, .of-status")) return;
    const inCode = app.studio === "code" && e.target.closest?.(".cm-editor");
    const inOffice = app.studio === "office" && e.target.closest?.(".of-oed");
    if (!inCode && !inOffice) return;
    const x = e.clientX;
    const y = e.clientY;
    setTimeout(() => (commentMode(false), composeFor({ x, y })), 0); // after the editor moved its caret
  }, true);

  const editable = (el) => !!el?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true'], .cm-editor, sl-input, sl-textarea");
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (mode && (e.key === "Escape" || e.key.toLowerCase() === "c") && !editable(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      return commentMode(false);
    }
    if ((e.key === "]" || e.key === "[") && !editable(e.target) && (pop || e.target.closest?.(".of-cpin"))) {
      e.preventDefault();
      step(e.key === "]" ? 1 : -1);
    }
  }, true);

  function setPinsVisible(on) {
    app.setPref("collabPins", !!on);
    syncButton();
    app.requestOverlay();
    if (!on) closePopover(false);
  }

  // status bar: show or hide all comments, with a count
  const toggle = h("button.of-status__zoom.of-status__comments", { type: "button", hidden: true });
  toggle.addEventListener("click", () => setPinsVisible(!pinsVisible()));
  function syncButton() {
    const bar = document.querySelector(".of-status__right");
    if (bar && toggle.parentNode !== bar) bar.prepend(toggle);
    const total = doc() ? c.threads(doc()).length : 0;
    const open = visibleThreads().length;
    toggle.hidden = !doc() || (!total && !mode);
    const on = pinsVisible();
    toggle.setAttribute("aria-pressed", String(on));
    toggle.replaceChildren(icon(on ? "chat-quote" : "eye-slash"), h("span", String(open)));
    const label = on ? t("Hide all comments ({n} open)", { n: open }) : t("Show all comments ({n} open)", { n: open });
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.classList.toggle("is-mode", mode);
  }
  c.events.addEventListener("change", syncButton);
  app.on("doc", syncButton);
  app.on("docs", syncButton);
  syncButton();

  api = {
    selected: null,
    composeFor,
    compose,
    openThread,
    closePopover,
    step,
    makePin,
    refreshPin,
    anchorText,
    resolveWithAI,
    pinsVisible,
    setPinsVisible,
    commentMode,
    inMode: () => mode,
    hoverEnd() {
      clearTimeout(hoverTimer);
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => pop?.hover && !pop.el.matches(":hover, :focus-within") && closePopover(false), 350);
    },
  };
  return api;
}
