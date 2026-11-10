// Vibe Studio chat: transcript (messages, tool cards, approvals, questions, change badges and run summaries) and the
// composer (mention chips for @ / ! / slash via composer-mentions.js, icon toolbar, message toolbars via message-actions.js).
import { h, empty } from "../../core/util.js";
import { iconButton } from "../controls.js";
import { t } from "../../i18n/index.js";
import { ta, tspan } from "../../i18n/dom.js";
import { iconEl } from "../toolbox.js";
import { renderMarkdown } from "./markdown.js";
import { vibeStore } from "../../vibe/store.js";
import { showContextMenu } from "../menus.js";
import { createToolCards } from "./tool-cards.js";
import { markEl } from "./logo.js";
import { markContext } from "../context-menu/index.js";
import { registerVibeContext } from "./context.js";
import { createMentions, layerChip } from "./composer-mentions.js";
import { parseContextBlocks } from "./mentions.js";
import { messageToolbar } from "./message-actions.js";
import { messageMarkdown, retryPlan } from "../../vibe/chat-ops.js";
import { badgeText } from "./changes.js";
import { watchBubbleStyle } from "./bubble-style.js";

const CHIP_ICON = { file: "file-earmark-code", document: "files", layer: "layers", attachment: "paperclip", member: "people", tool: "wrench", skill: "mortarboard" };

const textOfMessage = (m) => (typeof m.content === "string" ? m.content : (m.content || []).filter((b) => b.type === "text" && !/^\[Attached/.test(b.text)).map((b) => b.text).join("\n"));

export function createChat(vs) {
  const { app, session } = vs;
  const scroller = h("div.of-vchat__scroll", { role: "log", ...ta({ "aria-label": "Conversation" }), tabindex: "0" });
  const thread = h("div.of-vchat__thread");
  const pending = h("div.of-vchat__tail.hidden", h("div.of-vmsg.of-vmsg--assistant", h("div.of-vmsg__avatar", markEl()), h("span.of-vpending.of-shimmer", "Thinking…")));
  scroller.append(thread, pending);
  const jump = h("button.of-vjump.hidden", { type: "button", ...ta({ "aria-label": "Jump to latest message" }) }, iconEl("arrow-down"), tspan("Jump to latest"));
  // where a right-click AI chat came from (chat.target, vibe/quick-actions.js): "Go to selection" jumps back
  const targetBar = h("div.of-vtarget.hidden", { role: "note" });
  const paintTarget = () => {
    const tg = session.chat?.target;
    targetBar.classList.toggle("hidden", !tg);
    if (!tg) return targetBar.replaceChildren();
    const go = h("button.of-btn.of-btn--sm", { type: "button" }, iconEl("crosshair"), tspan("Go to selection"));
    go.addEventListener("click", () => import("../../vibe/quick-actions.js").then((m) => m.jumpToTarget(app, tg)));
    targetBar.replaceChildren(iconEl("cursor"), h("span.of-vtarget__text", t("Context: {what} in “{doc}”", { what: tg.label || tg.kind, doc: tg.docName || t("no document") })), go);
  };
  paintTarget();
  // sub-threads (chat.parent, ui/vibe/context.js): a bar with the way back and "Use in main thread"
  const threadBar = h("div.of-vthreadbar.hidden", { role: "note" });
  const paintThread = () => {
    const p = session.chat?.parent;
    threadBar.classList.toggle("hidden", !p);
    if (!p) return threadBar.replaceChildren();
    const back = h("button.of-btn.of-btn--sm", { type: "button" }, iconEl("arrow-return-right"), t("Back to main thread"));
    back.addEventListener("click", () => session.openChat(p.id).then((s) => !s && app.toast(t("The main thread was deleted."), "warning", 2400)));
    const use = h("button.of-btn.of-btn--sm", { type: "button", title: t("Opens the main thread with the last answer of this sub-thread in the composer; you decide whether to send it.") }, t("Use in main thread"));
    use.addEventListener("click", async () => {
      const last = [...session.chat.messages].reverse().find((m) => m.role === "assistant" && messageMarkdown(m).trim());
      const title = session.chat.title;
      const s = await session.openChat(p.id);
      if (!s) return app.toast(t("The main thread was deleted."), "warning", 2400);
      if (last) vs.chat?.setInput(t("Result from the sub-thread “{title}”:", { title }) + `\n\n${messageMarkdown(last)}`);
    });
    threadBar.replaceChildren(iconEl("diagram-2"), h("span", t("Sub-thread of “{title}”", { title: p.title || t("a chat") })), back, use);
  };
  paintThread();
  const main = h("div.of-vchat__main", threadBar, targetBar, scroller, jump);

  // ---- follow the bottom while the assistant streams; stop when the user scrolls up
  let stick = true;
  let lastTop = 0;
  let raf = 0;
  const gap = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  const reduced = () => document.documentElement.classList.contains("of-reduce-motion");
  const showJump = (on) => {
    jump.classList.toggle("hidden", !on);
    if (!on) jump.classList.remove("fresh");
  };
  const follow = () => {
    if (!stick) {
      if (!jump.classList.contains("hidden")) jump.classList.add("fresh");
      return;
    }
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      scroller.scrollTop = scroller.scrollHeight;
    });
  };
  const toBottom = (smooth = false) => {
    stick = true;
    showJump(false);
    if (smooth && !reduced()) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    else follow();
  };
  scroller.addEventListener("scroll", () => {
    const top = scroller.scrollTop;
    if (gap() < 24) {
      stick = true;
      showJump(false);
    } else if (top < lastTop - 2) {
      stick = false;
      showJump(true);
    }
    lastTop = top;
  });
  jump.addEventListener("click", () => {
    toBottom(true);
    input.focus({ preventScroll: true });
  });
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(follow); // growing tool cards, images, a taller composer
    ro.observe(thread);
    ro.observe(scroller);
  }

  let msgIndex = -1; // index in session.chat.messages of the message being rendered (-1: live, not stored yet)
  registerVibeContext(vs);
  const tools = createToolCards({ settings: () => vibeStore.settings, saveSettings: (p) => vibeStore.saveSettings(p), onGrow: follow, cancelAgent: (id) => vs.hub.active?.agentMgr?.cancel(id, "Cancelled by you.") });

  // ------------------------------------------------------------ transcript
  let cur = null; // current assistant bubble { body, text, all, tail, group, thinking }

  function assistantBubble() {
    if (cur) return cur;
    const body = h("div.of-vmsg__body");
    const el = h("div.of-vmsg.of-vmsg--assistant", h("div.of-vmsg__avatar", markEl()), body);
    if (msgIndex >= 0) el.dataset.index = String(msgIndex);
    markContext(el, "vibe-message", { role: "assistant", index: msgIndex, el });
    thread.append(el);
    cur = { el, body, text: "", all: [], textEl: null, tail: null, group: null, thinking: null, index: msgIndex };
    return cur;
  }
  const breakTools = (b) => {
    b.tail = null;
    b.group = null;
  };
  function endThinking(b, ms) {
    if (b.thinking && !b.thinking.done) b.thinking.finish(ms);
  }
  function appendText(delta) {
    const b = assistantBubble();
    endThinking(b);
    breakTools(b);
    b.text += delta;
    if (!b.textEl) {
      b.textEl = h("div.of-vmsg__text");
      b.body.append(b.textEl);
      b.all.push("");
    }
    b.all[b.all.length - 1] = b.text;
    b.textEl.replaceChildren(renderMarkdown(b.text));
    follow();
  }
  function endText() {
    if (cur) {
      cur.text = "";
      cur.textEl = null;
    }
  }
  function userBubble(msg) {
    const blocks = typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : msg.content;
    const body = h("div.of-vmsg__body");
    for (const b of blocks) {
      if (b.type === "text") {
        if (b.text.length > 1500 && b.text.startsWith("[Attached")) {
          body.append(h("div.of-vmsg__text", h("em", `${b.text.split("\n")[0]}`)));
          continue;
        }
        // mention chips travel as a "[Vibe context]" section: show them as chips, not as raw blocks
        const p = parseContextBlocks(b.text);
        body.append(h("div.of-vmsg__text", p.text));
        if (p.chips.length) body.append(h("div.of-mchips.of-mchips--sent", { role: "list", "aria-label": t("Targets sent with this message") }, p.chips.map((c) => h("span.of-mchip", { role: "listitem", class: `of-mchip--${c.kind}` }, iconEl(CHIP_ICON[c.kind] || "at"), h("span", c.kind === "tool" ? `!${c.label}` : c.kind === "skill" ? `/${c.label}` : `@${c.label}`)))));
      } else if (b.type === "image") body.append(h("img.of-vmsg__img", { src: `data:${b.mime};base64,${b.data}`, alt: "Attached image" }));
    }
    const index = session.chat.messages.indexOf(msg);
    const uel = markContext(h("div.of-vmsg.of-vmsg--user", body), "vibe-message", { role: "user", index, el: body });
    if (session.chat.pins?.includes(index)) uel.classList.add("of-vmsg--pinned");
    uel.dataset.index = String(index);
    body.append(messageToolbar(vs, { role: "user", index: () => session.chat.messages.indexOf(msg), el: uel, getText: () => parseContextBlocks(textOfMessage(msg)).text, getMarkdown: () => messageMarkdown(msg), onEdit: () => editMessage(msg) }));
    thread.append(uel);
    follow();
  }
  /** Puts a sent message back into the composer; sending it continues the conversation from that turn. */
  function editMessage(msg) {
    if (session.running) return;
    const text = parseContextBlocks(textOfMessage(msg)).text;
    const i = session.chat.messages.indexOf(msg);
    editing = i >= 0 && retryPlan(session.chat.messages, i) ? i : -1;
    input.value = text;
    autosize();
    input.focus();
    app.toast(editing >= 0 ? t("Edit the message and send: the conversation continues from there.") : t("Edit and send it as a new message."), "primary", 2200);
  }
  /** Copy (and, on the newest answer, retry) under a finished assistant bubble. */
  function finishBubble(b, last) {
    if (!b || b.finished) return;
    b.finished = true;
    const text = b.all.filter(Boolean).join("\n\n");
    if (!text && !last) return;
    if (last) thread.querySelectorAll(".of-vact--retry").forEach((x) => x.remove());
    const index = b.index;
    const row = messageToolbar(vs, { role: "assistant", index: () => index, el: b.el, last, getText: () => text, getMarkdown: () => text, onRetry: () => retryLast(), onRetryAt: (i) => retryAt(i) });
    if (text.length > 2400) b.el.classList.add("of-vmsg--long");
    b.body.append(row);
  }
  function retryAt(i) {
    const plan = retryPlan(session.chat.messages, i);
    if (!plan || session.running) return;
    session.chat.messages = plan.keep;
    session.emit("chat");
    send(plan.text);
  }
  function retryLast() {
    if (session.running) return;
    const msgs = session.chat.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "user" && !(Array.isArray(m.content) && m.content.every((x) => x.type === "tool_result"))) {
        const t = textOfMessage(m);
        if (t) send(t);
        return;
      }
    }
  }
  function note(text, kind = "info", action = null) {
    const el = h("div.of-vnote", { class: kind, role: kind === "error" ? "alert" : "status" }, iconEl(kind === "error" ? "exclamation-triangle" : "info-circle"), h("span.of-vnote__text", text));
    if (action) el.append(h("button.of-btn", { type: "button", onclick: () => { el.remove(); action.run(); } }, action.label));
    thread.append(el);
    follow();
  }

  function renderHistory() {
    empty(thread);
    tools.reset();
    pending.classList.add("hidden");
    cur = null;
    const msgs = session.chat.messages;
    if (!msgs.length) {
      thread.append(emptyState());
      return toBottom();
    }
    const results = new Map();
    for (const m of msgs) if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") results.set(b.toolUseId, b);
    for (const m of msgs) {
      msgIndex = msgs.indexOf(m);
      if (m.role === "user") {
        if (Array.isArray(m.content) && m.content.every((b) => b.type === "tool_result")) continue;
        finishBubble(cur, false);
        cur = null;
        userBubble(m);
      } else {
        // one bubble per run: the steps of a run (assistant, tool results, assistant, ...) share it
        const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
        for (const b of blocks) {
          if (b.type === "text" && b.text) appendText(b.text), endText();
          else if (b.type === "thinking" && b.text) {
            const bb = assistantBubble();
            breakTools(bb);
            const t = tools.thinking(bb);
            t.append(b.text);
            t.finish(-1);
          } else if (b.type === "tool_use") {
            const bb = assistantBubble();
            endText();
            tools.add(bb, b.id, b.name, b.input);
            const r = results.get(b.id);
            if (r) tools.end(b.id, r.content, r.isError, null);
            else tools.end(b.id, "Aborted by the user.", true, null);
          }
        }
      }
    }
    finishBubble(cur, true);
    cur = null;
    msgIndex = -1;
    paintPins();
    toBottom();
  }

  // pinned turns: a strip at the top of the transcript; clicking one scrolls to it
  function paintPins() {
    thread.querySelector(".of-vpins")?.remove();
    const pins = (session.chat.pins || []).filter((i) => i < session.chat.messages.length);
    for (const el of thread.querySelectorAll(".of-vmsg--pinned")) el.classList.remove("of-vmsg--pinned");
    if (!pins.length) return;
    const bar = h("nav.of-vpins", { "aria-label": t("Pinned messages") }, iconEl("pin-angle"));
    for (const i of pins) {
      const target = thread.querySelector(`.of-vmsg[data-index="${i}"]`);
      target?.classList.add("of-vmsg--pinned");
      const label = parseContextBlocks(textOfMessage(session.chat.messages[i])).text.replace(/\s+/g, " ").slice(0, 40) || t("Message");
      bar.append(h("button.of-vpins__item", { type: "button", onclick: () => target?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" }) }, label));
    }
    thread.prepend(bar);
  }

  // ---- change sets (change-recorder.js): a badge + "View changes" on mutating tool cards, a summary card per run
  const openChanges = (o) => import("./diff-view.js").then((m) => m.openChangesDialog(vs, o));
  function decorateCard(id) {
    const rec = vs.changes?.call(id);
    if (!rec || rec.stat.empty) return;
    const btn = h("button.of-vchg", { type: "button", "aria-label": t("View changes: {stat}", { stat: badgeText(rec.stat) }) }, iconEl("file-earmark-diff"), h("span", t("View changes")), h("span.of-vchg__stat", badgeText(rec.stat)));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openChanges({ title: t("Changes by {tool}", { tool: rec.name }), set: rec.set, doc: rec.doc, runId: null });
    });
    tools.decorate(id, btn);
  }
  async function runSummary(runId) {
    const r = runId && vs.changes?.run(runId);
    if (!r || r.stat.empty) return;
    const { changeSummaryList } = await import("./diff-view.js");
    const card = h("section.of-vsum", { "aria-label": t("Changes of this run") },
      h("div.of-vsum__head", iconEl("file-earmark-diff"), h("strong", t("Changed in this run")), h("span.of-vchg__stat", badgeText(r.stat))),
      changeSummaryList(r.set),
      h("div.of-vsum__acts",
        h("button.of-btn.of-btn--sm.of-btn--primary", { type: "button", onclick: () => openChanges({ title: t("Review changes"), set: r.set, doc: r.doc, runId }) }, iconEl("eye"), t("Review changes")),
        r.set.layers.length ? h("button.of-btn.of-btn--sm", { type: "button", onclick: () => vs.openTab("canvas") || vs.canvas?.compare(runId) }, iconEl("layout-split"), t("Before / after")) : null,
      ),
    );
    const anchor = thread.lastElementChild;
    if (anchor?.classList.contains("of-vusage")) anchor.before(card);
    else thread.append(card);
    follow();
  }

  function askCard(q) {
    const b = assistantBubble();
    endText();
    breakTools(b);
    const input = h("input.of-ask__in", { type: "text", ...ta({ placeholder: "Your answer…" }), "aria-label": q.question });
    const answer = (v) => {
      if (!v) return;
      card.classList.add("resolved");
      card.querySelector(".of-ask__row").replaceChildren(h("em", v));
      q.resolve(v);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") answer(input.value.trim());
    });
    const card = h("div.of-ask", { role: "group", ...ta({ "aria-label": "Question from Vibe" }) }, h("div.of-ask__q", iconEl("question-circle"), h("span", q.question)), h("div.of-ask__row", ...(q.options || []).map((o) => h("button.of-btn", { type: "button", onclick: () => answer(o) }, o)), input, h("button.of-btn.of-btn--primary", { type: "button", onclick: () => answer(input.value.trim()) }, "Send")));
    b.body.append(card);
    follow();
    setTimeout(() => input.focus({ preventScroll: true }), 50);
  }

  function emptyState() {
    const ideas = [
      ["Design a logo", "Design a clean, memorable logo for a coffee roaster called “Ember & Oak” and show me three color variations.", "vector"],
      ["Build a landing page", "Create a landing page for a note-taking app called Fieldnote: hero, three features, pricing and a footer. Calm colors, modern type.", "code"],
      ["Make a poster", "Make a 1080×1350 poster for a jazz night on Friday at 8 pm with a bold headline, a geometric background and event details.", "layout"],
      ["Retouch a photo", "Open my photo, brighten the shadows, add warmth and a subtle vignette using adjustment layers.", "pixel"],
    ];
    return h(
      "div.of-vempty",
      h("div.of-vempty__logo", markEl()),
      h("h1", "What do you want to make?"),
      h("p", "Vibe works inside OpenFini. Describe it — it draws, edits photos, lays out pages and builds websites with your studios, and you can undo everything in one click."),
      h("div.of-vempty__ideas", ideas.map(([t, p, s]) => h("button.of-videa", { type: "button", onclick: () => { input.value = p; autosize(); input.focus(); } }, h("strong", t), h("span", p.slice(0, 80) + "…"), h("small", `${s} studio`)))),
    );
  }

  // ------------------------------------------------------------ composer
  const input = h("textarea.of-composer__in", { rows: 1, ...ta({ placeholder: "Ask Vibe to design, edit or build something…  (@ files and layers, / skills, ! tools)", "aria-label": "Message Vibe" }) });
  const chips = h("div.of-composer__chips");
  let files = [];
  let editing = -1; // index of a sent message being edited (sending forks the chat there)
  const fileInput = h("input", { type: "file", multiple: true, style: { display: "none" }, accept: "image/*,.pdf,.ai,.psd,.psb,.idml,.sketch,.txt,.md,.csv,.json,.html,.css,.js,.svg,.xml,.yml,.yaml,.ts,.py,.sql" });
  const tip = (icon, label, onClick, extra = {}) => {
    const b = iconButton({ icon, label: t(label), onClick });
    b.setAttribute("data-tip", t(label));
    for (const [k, v] of Object.entries(extra)) b.setAttribute(k, v);
    return b;
  };
  // one attach button: a click opens a small menu (file or a screenshot of the current page); the prompt library lives in the "/" menu
  const attach = tip("paperclip", "Attach files or images", () => openAttachMenu(attach), { "aria-haspopup": "menu" });
  const mic = tip("mic", "Dictate (speech input)", () => dictate());
  const toolsBtn = tip("tools", "Tools for this chat", () => openToolsPopover(toolsBtn), { "aria-haspopup": "dialog" });
  // what the next request sends (context-panel.js, lazy): tokens per item, drop items, memory for this chat
  const ctxBtn = tip("stack", "Context window", () => import("./context-panel.js").then((m) => m.openContextPanel(vs, ctxBtn, { draft: input.value })), { "aria-haspopup": "dialog" });
  const sendBtn = h("button.of-composer__send", { type: "button", ...ta({ "aria-label": "Send" }) }, iconEl("arrow-up"));
  const paintSend = () => {
    const running = session.running;
    const can = running || !!input.value.trim() || files.length > 0 || mentions.chips.length > 0;
    // running: the OpenFini mark pulses; hovering or focusing the button shows the stop square
    sendBtn.replaceChildren(...(running ? [markEl("of-composer__mark"), iconEl("stop-fill")] : [iconEl("arrow-up")]));
    sendBtn.classList.toggle("running", running);
    sendBtn.classList.toggle("idle", !can);
    sendBtn.setAttribute("aria-disabled", String(!can));
    sendBtn.setAttribute("aria-label", running ? t("Stop") : t("Send"));
    sendBtn.title = running ? t("Stop (Esc)") : t("Send (Enter)");
  };
  const modelPill = h("button.of-pill-btn", { type: "button", "aria-haspopup": "dialog", "data-tip": t("Model for this chat") });
  const modePill = h("button.of-pill-btn", { type: "button", ...ta({ tip: "How much Vibe may do without asking" }) });
  const thinkPill = h("button.of-pill-btn", { type: "button", ...ta({ tip: "Reasoning effort (models that support it)" }) });
  const suggestEl = h("div.of-skillsug.hidden", { role: "status", "aria-live": "polite" });

  // slash commands: /skill-name, /new, /undo, /clear, /create-skill (the "/" menu of composer-mentions.js)
  let skillCache = [];
  const loadSkills = () => vs.allSkills?.().then((l) => (skillCache = l)).catch(() => {});
  loadSkills();
  vibeStore.on("change", (g) => (g === "skills" || g === "all") && loadSkills());
  const useSkill = async (s, rest = "") => {
    let args = null;
    if (s.params?.length) {
      const { skillArgsDialog } = await import("./skill-form.js");
      args = await skillArgsDialog(s);
      if (!args) return;
    }
    mentions.add({ kind: "skill", name: s.name, args: args || undefined });
    if (rest && !input.value.trim()) input.value = rest;
    autosize();
    input.focus();
  };
  vs.useSkill = useSkill;
  const COMMANDS = () => [
    { name: "new", hint: t("Start a new chat (other chats keep running)"), run: () => session.newChat() },
    { name: "undo", hint: t("Undo the last AI run of this chat"), run: () => { const n = session.undoLastRun(); app.toast(n ? `Undid ${n} step(s).` : session.lastUndoError || "Nothing to undo.", n ? "success" : "warning", 2500); } },
    { name: "screenshot", hint: t("Attach a screenshot of the current page"), run: () => attachScreenshot() },
    { name: "prompt-library", hint: t("Prompt library: recent and saved prompts, templates"), run: () => openLibrary(input) },
    { name: "clear", hint: t("Clear the draft and its chips"), run: () => { input.value = ""; mentions.clear(); files = []; renderChips(); } },
    { name: "stop-all", hint: t("Stop every running chat and sub-agent"), run: () => app.toast(`Stopped ${vs.hub.stopAll()} chat(s).`, "primary", 1500) },
    { name: "create-skill", hint: t("Turn what Vibe did in this chat into a reusable skill (draft)"), run: () => (input.value = "Distill the workflow you performed in this chat into a reusable skill: call create_skill with a concrete numbered workflow (exact tools and arguments that worked), rules with numbers, {{param}} placeholders for what changes between uses (declare them in params), token-saving tips and a ## Verify section. Keep it under 120 lines.") },
    { name: "skills", hint: t("Manage skills (Settings ▸ Artificial intelligence ▸ Skills)"), run: () => vs.openTab("skills") },
    { name: "tools", hint: t("Manage tools and MCP servers (Settings ▸ Artificial intelligence ▸ Tools)"), run: () => vs.openTab("tools") },
    ...(skillCache.length ? skillCache : vs.skills() || []).map((s) => ({ skill: true, name: s.name, hint: `${s.argumentHint ? `[${s.argumentHint}] ` : s.params?.length ? `[${s.params.map((p) => p.name).join(", ")}] ` : ""}${s.description}`, run: (rest) => useSkill(s, rest) })),
  ];
  const mentions = createMentions({ vs, input, commands: COMMANDS, onChange: () => paintSend() });
  const box = h("div.of-composer", suggestEl, mentions.chipsEl, chips, input, h("div.of-composer__bar", { role: "toolbar", "aria-label": t("Composer") }, attach, mic, toolsBtn, ctxBtn, h("span.of-composer__sep"), modelPill, modePill, thinkPill, h("span.of-composer__spacer"), sendBtn), mentions.popover, mentions.live);
  const root = h("div.of-vchat", main, h("div.of-vchat__dock", box, h("p.of-composer__hint", t("Vibe can make mistakes. Changes can be undone in the Activity tab or with Ctrl+Z. Keys and chats stay on this device."))));

  // grows with the text up to 40% of the panel height (max 220 px), then scrolls inside
  const autosize = () => {
    input.style.height = "auto";
    const max = Math.max(60, Math.min(220, Math.round((root.clientHeight || 600) * 0.4)));
    input.style.height = `${Math.min(max, input.scrollHeight)}px`;
    input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
    paintSend();
  };
  input.addEventListener("input", () => {
    if (!rec) speech?.stopSpeaking(); // typing interrupts a reading (dictation fills the field itself)
    autosize();
    mentions.update();
    suggest();
  });
  input.addEventListener("keyup", (e) => (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") && mentions.update());

  // "Use skill X?" chip: cheap BM25 match of the draft against skill names, descriptions, tags and when-to-use
  let sugTimer = 0;
  const dismissed = new Set();
  function suggest() {
    clearTimeout(sugTimer);
    sugTimer = setTimeout(async () => {
      const text = input.value.trim();
      const hide = () => suggestEl.classList.add("hidden");
      if (vibeStore.settings.suggestSkills === false || text.length < 12 || text.startsWith("/") || mentions.chips.some((c) => c.kind === "skill") || !skillCache.length) return hide();
      const { suggestSkills } = await vs.hub.ai();
      const best = suggestSkills(text, skillCache, { limit: 1, min: 2 })[0];
      if (!best || dismissed.has(best.skill.name)) return hide();
      const s = best.skill;
      suggestEl.replaceChildren(
        iconEl("mortarboard"),
        h("span", "Use skill ", h("strong", s.name), "?"),
        h("button.of-btn.of-btn--sm", { type: "button", onclick: () => { suggestEl.classList.add("hidden"); useSkill(s).then(() => autosize()); } }, "Use"),
        h("button.of-skillsug__x", { type: "button", "aria-label": `Do not suggest ${s.name} again in this chat`, onclick: () => { dismissed.add(s.name); hide(); } }, "×"),
      );
      suggestEl.classList.remove("hidden");
    }, 300);
  }

  let chipUrls = [];
  function renderChips() {
    empty(chips);
    chipUrls.forEach((u) => URL.revokeObjectURL(u));
    chipUrls = [];
    paintSend();
    files.forEach((f, i) => chips.append(h("span.of-chip2", { title: f.name }, /^image\//.test(f.type) ? h("img", { src: (chipUrls[i] = URL.createObjectURL(f)), alt: "" }) : iconEl("file-earmark"), h("span.of-chip2__name", f.name),/\.(pdf|ai|psd|psb|idml|sketch)$/i.test(f.name) ? h("button", { type: "button", class: "of-chip2__open", title: "Import this file into OpenFini so the assistant can work with it", onclick: async () => { try { await app.openFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type }); } catch (err) { app.toast(err.message, "danger", 5000); } } }, "Open as document") : null, h("button", { type: "button", "aria-label": `Remove ${f.name}`, onclick: () => { files.splice(i, 1); renderChips(); } }, "×"))));
  }
  function addFiles(list) {
    for (const f of list) if (files.length < 8) files.push(f);
    renderChips();
  }
  fileInput.addEventListener("change", () => {
    addFiles([...fileInput.files]);
    fileInput.value = "";
  });
  box.addEventListener("dragover", (e) => {
    e.preventDefault();
    box.classList.add("drop");
  });
  box.addEventListener("dragleave", () => box.classList.remove("drop"));
  box.addEventListener("drop", (e) => {
    box.classList.remove("drop");
    if (mentions.handleDrop(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      e.stopPropagation();
      addFiles([...e.dataTransfer.files]);
    }
  });
  input.addEventListener("paste", (e) => {
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  });

  function openAttachMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    showContextMenu(app, r.left, Math.max(8, r.top - 12 - 70), [
      { label: t("Attach file…"), icon: "paperclip", run: () => fileInput.click() },
      { label: t("Attach screenshot of current page"), icon: "camera", disabled: !app.doc, run: () => attachScreenshot() },
    ]);
  }

  async function attachScreenshot() {
    const page = app.page;
    if (!app.doc || !page) return app.toast(t("Open a document first."), "warning", 2000);
    try {
      const { exportRaster } = await import("../../core/io.js");
      const k = Math.min(1, 1600 / Math.max(page.w, page.h));
      const r = await exportRaster(app, { page, format: "png", scale: k });
      addFiles([new File([r.bytes], `${(page.name || app.doc.name || "page").replace(/[^\w.-]+/g, "_")}.png`, { type: "image/png" })]);
    } catch (err) {
      app.toast(err?.message || t("Could not capture the page."), "warning", 3000);
    }
  }

  // prompt library: recent prompts (local), saved prompts with names, and per-studio templates
  const SAVED_KEY = "of-vibe-saved-prompts";
  const readSaved = () => {
    try {
      return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    } catch {
      return [];
    }
  };
  const TEMPLATES = [
    ["Vector", "Design a clean logo for {name}: three variations with different color schemes."],
    ["Pixel", "Brighten the shadows, add warmth and a subtle vignette with adjustment layers."],
    ["Layout", "Lay out a one-page flyer for {event}: headline, date, place and a call to action."],
    ["Code", "Add a responsive navigation bar with a mobile menu to the website."],
    ["Office", "Proofread the document, fix grammar and keep my tone."],
  ];
  function openLibrary(anchor) {
    const r = anchor.getBoundingClientRect();
    const saved = readSaved();
    const recent = mentions.recentPrompts().slice(0, 8);
    const put = (text) => {
      input.value = text;
      autosize();
      input.focus();
    };
    const items = [];
    if (recent.length) items.push({ label: t("Recent prompts"), disabled: true }, ...recent.map((p) => ({ label: p.length > 60 ? `${p.slice(0, 60)}…` : p, icon: "clock-history", run: () => put(p) })), "-");
    if (saved.length) items.push({ label: t("Saved prompts"), disabled: true }, ...saved.map((p) => ({ label: p.name, icon: "bookmark-star", run: () => put(p.text) })), "-");
    items.push({ label: t("Templates"), disabled: true }, ...TEMPLATES.map(([s, p]) => ({ label: `${s}: ${p.slice(0, 50)}…`, icon: "lightbulb", run: () => put(p) })), "-");
    items.push({ label: t("Save the current prompt…"), icon: "bookmark-plus", disabled: !input.value.trim(), run: async () => {
      const { promptDialog } = await import("../dialogs.js");
      const name = await promptDialog?.({ title: t("Save prompt"), label: t("Name"), value: input.value.trim().slice(0, 40) });
      if (!name) return;
      const list = readSaved().filter((x) => x.name !== name);
      list.unshift({ name, text: input.value.trim() });
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 50)));
        app.toast(t("Prompt saved."), "success", 1400);
      } catch {
        app.toast(t("Could not save the prompt in this browser."), "warning", 2400);
      }
    } });
    if (saved.length) items.push({ label: t("Delete saved prompts…"), icon: "trash3", run: () => { try { localStorage.removeItem(SAVED_KEY); } catch { /* ignore */ } } });
    showContextMenu(app, r.left, Math.max(8, r.top - 12 - Math.min(480, items.length * 30)), items);
  }

  // per-chat tool groups: switched-off groups go to the chat's overrides (session.settings merges them)
  async function openToolsPopover(anchor) {
    const { TOOL_GROUPS } = await import("../../vibe/tools/index.js");
    const off = new Set(session.overrides?.disabledTools || []);
    const r = anchor.getBoundingClientRect();
    const items = Object.entries(TOOL_GROUPS).map(([g, names]) => ({
      label: `${g} (${names.length})`,
      checked: !names.every((n) => off.has(n)),
      run: () => {
        const all = names.every((n) => off.has(n));
        for (const n of names) all ? off.delete(n) : off.add(n);
        session.setOverrides({ disabledTools: off.size ? [...off] : null });
        paintPills();
      },
    }));
    items.push("-", { label: t("Turn every group on"), disabled: !off.size, run: () => { session.setOverrides({ disabledTools: null }); paintPills(); } }, { label: t("Manage tools and MCP servers…"), icon: "gear", run: () => vs.openTab("tools") });
    showContextMenu(app, r.left, Math.max(8, r.top - 12 - Math.min(520, items.length * 30)), items);
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (mentions.handleKey(e)) return;
    if (e.key === "Escape" && session.running) return session.abort();
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("click", () => (session.running ? session.abort() : send()));

  async function send(override) {
    const own = typeof override !== "string";
    let text = own ? input.value.trim() : override.trim();
    if (!text && !files.length && !(own && mentions.chips.length)) return;
    if (session.running) return;
    speech?.stopSpeaking();
    // typed "@selection" without a chip still works (older habit): it becomes a selection chip
    if (own && /(^|\s)@selection\b/.test(text) && app.selection.length && !mentions.chips.some((c) => c.kind === "selection")) {
      text = text.replace(/(^|\s)@selection\b/g, "$1the selected layers").trim();
      mentions.add({ kind: "selection" });
    }
    const f = own ? files : [];
    const draft = input.value;
    const chipList = own ? mentions.chips.slice() : [];
    const message = own ? mentions.compose(text || (f.length ? "Please look at the attached files." : "")) : text;
    if (own && editing >= 0) {
      // edit and resend: continue from the edited turn
      const plan = retryPlan(session.chat.messages, editing);
      if (plan) {
        session.chat.messages = plan.keep;
        session.emit("chat");
      }
      editing = -1;
    }
    if (own) {
      mentions.rememberPrompt(text);
      files = [];
      renderChips();
      mentions.clear();
      input.value = "";
    }
    autosize();
    suggestEl.classList.add("hidden");
    toBottom(true);
    input.focus({ preventScroll: true });
    try {
      await session.send(message || "Please look at the attached files.", f);
    } catch (err) {
      // nothing was sent: give the draft back
      if (own && !input.value) {
        input.value = draft;
        files = f;
        for (const c of chipList) mentions.add(c);
        renderChips();
        autosize();
      }
      note(err.message, "error", { label: "Try again", run: () => send(own ? undefined : override) });
    }
  }

  // speech input, spoken replies and voice chat (vibe/speech-runtime.js, loaded on first use; docs/vibe-voice.md)
  const voiceCfg = () => vibeStore.settings.voice || {};
  const sttEngine = () => voiceCfg().stt || "system";
  const speechLang = () => {
    const l = app.i18n?.locale?.() || "en";
    return l.includes("-") ? l : { de: "de-DE", en: "en-US" }[l] || l;
  };
  let speech = null; // the runtime module once loaded
  let rec = null;
  let voiceOn = false;
  const loadSpeech = async () => (speech ||= await import("../../vibe/speech-runtime.js"));
  function stopVoice() {
    voiceOn = false;
    voiceBtn.classList.remove("active");
    voiceBtn.setAttribute("aria-pressed", "false");
    rec?.stop();
    speech?.stopSpeaking();
  }
  async function dictate({ auto = false } = {}) {
    if (rec) return rec.stop();
    const R = await loadSpeech();
    R.stopSpeaking();
    if (sttEngine() === "local") {
      await R.transcribeLocal().catch((e) => app.toast(e.message, "warning", 6000));
      return stopVoice();
    }
    if (sttEngine() === "off" || !R.systemSttAvailable()) {
      app.toast(t("Speech input is off or not available here (Settings ▸ Artificial intelligence ▸ Voice)."), "warning", 3000);
      return stopVoice();
    }
    const base = input.value;
    let heard = "";
    mic.classList.add("active");
    try {
      rec = R.listen({
        lang: speechLang(),
        continuous: !auto, // voice chat: one utterance, then send
        onText: (text) => {
          heard = text;
          input.value = `${base} ${text}`.trim();
          autosize();
        },
        onEnd: () => {
          mic.classList.remove("active");
          rec = null;
          if (auto && voiceOn) heard.trim() ? send() : stopVoice();
        },
        onError: (e) => app.toast(e.message, "warning", 3000),
      });
    } catch (e) {
      mic.classList.remove("active");
      rec = null;
      app.toast(e.message, "warning", 3000);
    }
  }
  /** Reads the newest answer aloud (spoken replies or voice chat), then listens again in voice chat. */
  async function speakReply() {
    if (!voiceOn && !voiceCfg().tts) return;
    const last = [...session.chat.messages].reverse().find((m) => m.role === "assistant" && messageMarkdown(m).trim());
    if (!last) return;
    const R = await loadSpeech();
    try {
      await R.speak(messageMarkdown(last), voiceCfg(), app.i18n?.locale?.() || "en");
    } catch (e) {
      app.toast(e.message, "warning", 4000);
      return stopVoice();
    }
    if (voiceOn && !session.running && !R.isSpeaking()) dictate({ auto: true });
  }
  const voiceBtn = tip("volume-up", "Voice chat", () => {
    if (voiceOn) return stopVoice();
    voiceOn = true;
    voiceBtn.classList.add("active");
    voiceBtn.setAttribute("aria-pressed", "true");
    dictate({ auto: true });
  }, { "aria-pressed": "false" });
  const paintVoice = () => {
    voiceBtn.hidden = !voiceCfg().voiceMode;
    mic.hidden = sttEngine() === "off" || (sttEngine() === "system" && !(window.SpeechRecognition || window.webkitSpeechRecognition));
    if (voiceBtn.hidden && voiceOn) stopVoice();
  };
  mic.after(voiceBtn);
  paintVoice();
  // ------------------------------------------------------------ pills
  const MODES = { careful: "Ask for every change", balanced: "Ask for risky steps", auto: "Auto-apply" };
  function paintPills() {
    const s = session.settings ? session.settings() : vibeStore.settings;
    const ov = session.overrides || {};
    const p = s.activeProvider ? vibeStore.provider(s.activeProvider) : null;
    modelPill.replaceChildren(iconEl("cpu"), h("span", `${s.activeProvider && s.model ? `${p?.label || "Provider"} · ${s.model.split("/").pop()}` : "Demo (offline)"}${ov.model ? " (this chat)" : ""}${(s.routes || []).some((r) => r.id === s.activeRoute && r.targets.some((x) => x.enabled !== false)) && ov.fallback !== false ? " ↪" : ""}`), iconEl("chevron-down"));
    modePill.replaceChildren(iconEl(s.approval === "auto" ? "lightning-charge" : s.approval === "careful" ? "shield-check" : "shield"), h("span", `${MODES[s.approval]}${ov.approval ? " (this chat)" : ""}`));
    paintVoice();
    thinkPill.replaceChildren(iconEl("lightbulb"), h("span", s.reasoning === "off" ? "Thinking off" : `Thinking ${s.reasoning}`));
    paintSend();
  }
  modelPill.addEventListener("click", () => vs.openModelPicker(modelPill));
  modePill.addEventListener("click", () => {
    const r = modePill.getBoundingClientRect();
    const own = session.overrides?.approval;
    showContextMenu(app, r.left, r.top - 160, [
      ...Object.entries(MODES).map(([k, v]) => ({ label: v, checked: (own || vibeStore.settings.approval) === k, run: () => (own ? session.setOverrides({ approval: k }) : vibeStore.saveSettings({ approval: k })) })),
      { label: own ? "Use the default mode in this chat" : "Pin this mode to this chat (then changes apply only here)", run: () => session.setOverrides({ approval: own ? null : vibeStore.settings.approval }) },
    ]);
  });
  thinkPill.addEventListener("click", () => {
    const r = thinkPill.getBoundingClientRect();
    showContextMenu(app, r.left, r.top - 150, ["off", "low", "medium", "high"].map((k) => ({ label: k === "off" ? "Off" : k[0].toUpperCase() + k.slice(1), checked: vibeStore.settings.reasoning === k, run: () => vibeStore.saveSettings({ reasoning: k }) })));
  });
  vibeStore.on("change", paintPills);
  session.on("status", paintPills);

  // ------------------------------------------------------------ session events
  const showPending = (on) => {
    pending.classList.toggle("hidden", !on);
    if (on) follow();
  };
  session.on("chat", () => {
    paintTarget();
    paintThread();
    renderHistory();
    // switching to a chat that is still working: its live events are replayed next (hub SessionView)
    if (session.running) showPending(true);
    paintPills();
    suggest();
  });
  session.on("message", (m) => {
    if (thread.querySelector(".of-vempty")) empty(thread);
    thread.querySelectorAll(".of-vact--retry").forEach((x) => x.remove());
    finishBubble(cur, false);
    cur = null;
    userBubble(m);
    showPending(true);
    toBottom(true);
    paintSend();
  });
  session.on("event", (ev) => {
    switch (ev.type) {
      case "text":
        showPending(false);
        appendText(ev.delta);
        break;
      case "thinking": {
        showPending(false);
        const b = assistantBubble();
        if (!b.thinking || b.thinking.done) {
          endText();
          breakTools(b);
          b.thinking = tools.thinking(b);
        }
        b.thinking.append(ev.delta);
        break;
      }
      case "tool_start": {
        showPending(false);
        const b = assistantBubble();
        endThinking(b);
        endText();
        tools.add(b, ev.id, ev.name, ev.input);
        break;
      }
      case "tool_end":
        tools.end(ev.id, ev.result, ev.isError, ev.ms);
        decorateCard(ev.id);
        if (session.running && !tools.running()) showPending(true);
        break;
      case "retry":
        note(`The provider is busy — retrying (${ev.attempt})…`);
        break;
      case "route_retry":
        note(t("{target} did not answer — trying again in {s} s…", { target: ev.target, s: Math.max(1, Math.round((ev.delayMs || 0) / 1000)) }));
        break;
      case "agent_status":
        tools.agentStatus(ev.agent);
        break;
      case "agent_event":
        tools.agentEvent(ev);
        break;
      default:
        break;
    }
  });
  session.on("approval", (req) => {
    showPending(false);
    if (tools.approve(req)) return;
    if (req.agent && tools.agentApprove(req)) return;
    const b = assistantBubble();
    endText();
    tools.add(b, req.id, req.name, req.input);
    tools.approve(req);
  });
  session.on("ask", (q) => {
    showPending(false);
    askCard(q);
  });
  session.on("notice", (n) => {
    // auto-saved memories come with Undo (restores the previous text of an updated memory, else deletes it)
    if (n.kind === "memory" && n.memory) return note(n.text, "info", { label: t("Undo"), run: () => (n.memory.previous ? vibeStore.updateMemory(n.memory.id, n.memory.previous) : vibeStore.deleteMemory(n.memory.id)).catch(() => {}) });
    note(n.text, n.kind === "mcp" ? "error" : "info");
  });
  const settleRun = () => {
    showPending(false);
    tools.settle();
    if (cur) endThinking(cur);
  };
  session.on("error", (err) => {
    settleRun();
    note(err.message || String(err), "error", { label: "Retry", run: retryLast });
    finishBubble(cur, true);
    cur = null;
  });
  session.on("done", (res) => {
    settleRun();
    finishBubble(cur, true);
    cur = null;
    if (res.stopReason === "max_steps") note("Stopped after the maximum number of steps. Say “continue” to go on.");
    else if (res.stopReason === "aborted") note("Stopped.");
    // provider failures end the run with stopReason "error" (no exception): show them instead of an empty reply
    else if (res.stopReason === "error") note(res.error || "The request failed.", "error", { label: "Retry", run: retryLast });
    const u = res.usage;
    if (u?.input || u?.output) thread.append(h("div.of-vusage", `${u.input?.toLocaleString("en-US") || 0} tokens in · ${u.output?.toLocaleString("en-US") || 0} out · ${res.steps || 1} step${res.steps === 1 ? "" : "s"}`));
    runSummary(vs.hub.active?.runId);
    if (res.stopReason !== "aborted") speakReply();
    follow();
    if (!document.activeElement || document.activeElement === document.body) input.focus({ preventScroll: true });
  });
  session.on("status", (st) => st === "idle" && settleRun());

  watchBubbleStyle(app, root); // chat bubble look from Settings (customize/bubbles.js)
  renderHistory();
  paintPills();
  return { el: root, focus: () => input.focus({ preventScroll: true }), setInput: (t) => { input.value = t; autosize(); input.focus(); }, send: (t, f) => send(t), sendRaw: (t, f) => session.send(t, f), paintPills, note, addFiles, useSkill, addChip: (c) => mentions.add(c), addLayer: (n) => mentions.add(layerChip(n)) };
}
