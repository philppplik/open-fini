// Vibe Studio chat: transcript (messages, tool cards, approvals, questions) and the composer.
import { h, empty } from "../../core/util.js";
import { iconButton } from "../controls.js";
import { t } from "../../i18n/index.js";
import { ta, tspan } from "../../i18n/dom.js";
import { iconEl } from "../toolbox.js";
import { renderMarkdown } from "./markdown.js";
import { vibeStore } from "../../vibe/store.js";
import { showContextMenu } from "../menus.js";
import { createToolCards, copyButton } from "./tool-cards.js";
import { markEl } from "./logo.js";
import { markContext } from "../context-menu/index.js";
import { registerVibeContext } from "./context.js";

const textOfMessage = (m) => (typeof m.content === "string" ? m.content : (m.content || []).filter((b) => b.type === "text" && !/^\[Attached/.test(b.text)).map((b) => b.text).join("\n"));

export function createChat(vs) {
  const { app, session } = vs;
  const scroller = h("div.of-vchat__scroll", { role: "log", ...ta({ "aria-label": "Conversation" }), tabindex: "0" });
  const thread = h("div.of-vchat__thread");
  const pending = h("div.of-vchat__tail.hidden", h("div.of-vmsg.of-vmsg--assistant", h("div.of-vmsg__avatar", markEl()), h("span.of-vpending.of-shimmer", "Thinking…")));
  scroller.append(thread, pending);
  const jump = h("button.of-vjump.hidden", { type: "button", ...ta({ "aria-label": "Jump to latest message" }) }, iconEl("arrow-down"), tspan("Jump to latest"));
  const main = h("div.of-vchat__main", scroller, jump);

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
  const tools = createToolCards({ settings: () => vibeStore.settings, saveSettings: (p) => vibeStore.saveSettings(p), onGrow: follow });

  // ------------------------------------------------------------ transcript
  let cur = null; // current assistant bubble { body, text, all, tail, group, thinking }

  function assistantBubble() {
    if (cur) return cur;
    const body = h("div.of-vmsg__body");
    const el = h("div.of-vmsg.of-vmsg--assistant", h("div.of-vmsg__avatar", markEl()), body);
    markContext(el, "vibe-message", { role: "assistant", index: msgIndex, el });
    thread.append(el);
    cur = { body, text: "", all: [], textEl: null, tail: null, group: null, thinking: null };
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
      if (b.type === "text") body.append(h("div.of-vmsg__text", b.text.length > 1500 && b.text.startsWith("[Attached") ? h("em", `${b.text.split("\n")[0]}`) : b.text));
      else if (b.type === "image") body.append(h("img.of-vmsg__img", { src: `data:${b.mime};base64,${b.data}`, alt: "Attached image" }));
    }
    const copy = copyButton(() => textOfMessage(msg), "Copy message");
    const uel = markContext(h("div.of-vmsg.of-vmsg--user", h("div.of-vmsg__tools", copy), body), "vibe-message", { role: "user", index: session.chat.messages.indexOf(msg), el: body });
    thread.append(uel);
    follow();
  }
  /** Copy (and, on the newest answer, retry) under a finished assistant bubble. */
  function finishBubble(b, last) {
    if (!b || b.finished) return;
    b.finished = true;
    const text = b.all.filter(Boolean).join("\n\n");
    if (!text && !last) return;
    const row = h("div.of-vmsg__actions", text ? copyButton(() => text, "Copy answer") : null);
    if (last) {
      thread.querySelectorAll(".of-vact--retry").forEach((x) => x.remove());
      const retry = h("button.of-vact.of-vact--retry", { type: "button", ...ta({ "aria-label": "Retry: send the last message again", title: "Send the last message again" }) }, iconEl("arrow-repeat"), tspan("Retry"));
      retry.addEventListener("click", () => retryLast());
      row.append(retry);
    }
    b.body.append(row);
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
    toBottom();
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
  const input = h("textarea.of-composer__in", { rows: 1, ...ta({ placeholder: "Ask Vibe to design, edit or build something…  (/ for skills, @selection for the selected layers)", "aria-label": "Message Vibe" }) });
  const chips = h("div.of-composer__chips");
  let files = [];
  const fileInput = h("input", { type: "file", multiple: true, style: { display: "none" }, accept: "image/*,.pdf,.ai,.psd,.psb,.idml,.sketch,.txt,.md,.csv,.json,.html,.css,.js,.svg,.xml,.yml,.yaml,.ts,.py,.sql" });
  const attach = iconButton({ icon: "paperclip", label: "Attach files or images", onClick: () => fileInput.click() });
  const mic = iconButton({ icon: "mic", label: "Dictate", onClick: () => dictate() });
  const sendBtn = h("button.of-composer__send", { type: "button", ...ta({ "aria-label": "Send" }) }, iconEl("arrow-up"));
  const paintSend = () => {
    const running = session.running;
    const can = running || !!input.value.trim() || files.length > 0;
    // running: the OpenFini mark pulses; hovering or focusing the button shows the stop square
    sendBtn.replaceChildren(...(running ? [markEl("of-composer__mark"), iconEl("stop-fill")] : [iconEl("arrow-up")]));
    sendBtn.classList.toggle("running", running);
    sendBtn.classList.toggle("idle", !can);
    sendBtn.setAttribute("aria-disabled", String(!can));
    sendBtn.setAttribute("aria-label", running ? t("Stop") : t("Send"));
    sendBtn.title = running ? "Stop (Esc)" : "Send (Enter)";
  };
  const modelPill = h("button.of-pill-btn", { type: "button", "aria-haspopup": "dialog" });
  const modePill = h("button.of-pill-btn", { type: "button", ...ta({ tip: "How much Vibe may do without asking" }) });
  const thinkPill = h("button.of-pill-btn", { type: "button", ...ta({ tip: "Reasoning effort (models that support it)" }) });
  const slash = h("div.of-slash.hidden", { role: "listbox" });
  const box = h("div.of-composer", chips, input, h("div.of-composer__bar", attach, mic, modelPill, modePill, thinkPill, h("span.of-composer__spacer"), sendBtn), slash);
  const root = h("div.of-vchat", main, h("div.of-vchat__dock", box, h("p.of-composer__hint", "Vibe can make mistakes. Changes can be undone in the Activity tab or with Ctrl+Z. Keys and chats stay on this device.")));

  // grows with the text up to 40% of the panel height (max 220 px), then scrolls inside
  const autosize = () => {
    input.style.height = "auto";
    const max = Math.max(60, Math.min(220, Math.round((root.clientHeight || 600) * 0.4)));
    input.style.height = `${Math.min(max, input.scrollHeight)}px`;
    input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
    paintSend();
  };
  input.addEventListener("input", () => {
    autosize();
    slashMenu();
  });

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
  box.addEventListener("dragover", (e) => e.preventDefault());
  box.addEventListener("drop", (e) => {
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

  // slash commands: /skill-name, /new, /undo, /clear
  const COMMANDS = () => [
    { name: "new", hint: "Start a new chat", run: () => session.newChat() },
    { name: "undo", hint: "Undo the last AI run", run: () => app.toast(`Undid ${session.undoLastRun()} step(s).`, "success", 1500) },
    ...(vs.skills() || []).map((s) => ({ name: s.name, hint: s.description, run: () => (input.value = `Use the “${s.name}” skill. ${input.value.replace(/^\/\S*\s*/, "")}`) })),
  ];
  let slashItems = [];
  let slashSel = 0;
  function slashMenu() {
    const m = /^\/(\S*)$/.exec(input.value.split("\n")[0]);
    if (!m || input.value.includes("\n")) return slash.classList.add("hidden");
    slashItems = COMMANDS().filter((c) => c.name.startsWith(m[1].toLowerCase()));
    slashSel = 0;
    paintSlash();
  }
  function paintSlash() {
    empty(slash);
    slash.classList.toggle("hidden", !slashItems.length);
    slashItems.slice(0, 8).forEach((c, i) => {
      const row = h("div.of-slash__item", { role: "option", class: i === slashSel ? "active" : "" }, h("strong", `/${c.name}`), h("span", c.hint));
      row.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        pick(c);
      });
      slash.append(row);
    });
  }
  function pick(c) {
    input.value = "";
    slash.classList.add("hidden");
    c.run();
    if (!input.value) input.value = "";
    autosize();
    input.focus();
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (!slash.classList.contains("hidden")) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        slashSel = (slashSel + (e.key === "ArrowDown" ? 1 : -1) + Math.min(8, slashItems.length)) % Math.min(8, slashItems.length);
        paintSlash();
        return e.preventDefault();
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return pick(slashItems[slashSel]);
      }
      if (e.key === "Escape") return slash.classList.add("hidden");
    }
    if (e.key === "Escape" && session.running) return session.abort();
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("click", () => (session.running ? session.abort() : send()));

  async function send(override) {
    let text = typeof override === "string" ? override.trim() : input.value.trim();
    if (!text && !files.length) return;
    if (session.running) return;
    if (text.includes("@selection") && app.selection.length) {
      text = text.replace(/@selection/g, `the selected layer(s) (ids: ${app.selection.map((n) => n.id).join(", ")})`);
    }
    const f = typeof override === "string" ? [] : files;
    const draft = input.value;
    if (typeof override !== "string") {
      files = [];
      renderChips();
      input.value = "";
    }
    autosize();
    toBottom(true);
    input.focus({ preventScroll: true });
    try {
      await session.send(text || "Please look at the attached files.", f);
    } catch (err) {
      // nothing was sent: give the draft back
      if (typeof override !== "string" && !input.value) {
        input.value = draft;
        files = f;
        renderChips();
        autosize();
      }
      note(err.message, "error", { label: "Try again", run: () => send(typeof override === "string" ? override : undefined) });
    }
  }

  // speech input (where the platform supports it)
  let rec = null;
  function dictate() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return app.toast("Speech input is not available in this browser.", "warning", 2400);
    if (rec) {
      rec.stop();
      return;
    }
    rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    const base = input.value;
    mic.classList.add("active");
    rec.onresult = (e) => {
      input.value = `${base} ${[...e.results].map((r) => r[0].transcript).join("")}`.trim();
      autosize();
    };
    rec.onend = () => {
      mic.classList.remove("active");
      rec = null;
    };
    rec.onerror = () => rec?.stop();
    rec.start();
  }

  // ------------------------------------------------------------ pills
  const MODES = { careful: "Ask for every change", balanced: "Ask for risky steps", auto: "Auto-apply" };
  function paintPills() {
    const s = vibeStore.settings;
    const p = s.activeProvider ? vibeStore.provider(s.activeProvider) : null;
    modelPill.replaceChildren(iconEl("cpu"), h("span", s.activeProvider && s.model ? `${p?.label || "Provider"} · ${s.model.split("/").pop()}` : "Demo (offline)"), iconEl("chevron-down"));
    modePill.replaceChildren(iconEl(s.approval === "auto" ? "lightning-charge" : s.approval === "careful" ? "shield-check" : "shield"), h("span", MODES[s.approval]));
    thinkPill.replaceChildren(iconEl("lightbulb"), h("span", s.reasoning === "off" ? "Thinking off" : `Thinking ${s.reasoning}`));
    paintSend();
  }
  modelPill.addEventListener("click", () => vs.openModelPicker(modelPill));
  modePill.addEventListener("click", () => {
    const r = modePill.getBoundingClientRect();
    showContextMenu(app, r.left, r.top - 130, Object.entries(MODES).map(([k, v]) => ({ label: v, checked: vibeStore.settings.approval === k, run: () => vibeStore.saveSettings({ approval: k }) })));
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
  session.on("chat", renderHistory);
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
        if (session.running && !tools.running()) showPending(true);
        break;
      case "retry":
        note(`The provider is busy — retrying (${ev.attempt})…`);
        break;
      default:
        break;
    }
  });
  session.on("approval", (req) => {
    showPending(false);
    if (tools.approve(req)) return;
    const b = assistantBubble();
    endText();
    tools.add(b, req.id, req.name, req.input);
    tools.approve(req);
  });
  session.on("ask", (q) => {
    showPending(false);
    askCard(q);
  });
  session.on("notice", (n) => note(n.text, n.kind === "mcp" ? "error" : "info"));
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
    const u = res.usage;
    if (u?.input || u?.output) thread.append(h("div.of-vusage", `${u.input?.toLocaleString("en-US") || 0} tokens in · ${u.output?.toLocaleString("en-US") || 0} out · ${res.steps || 1} step${res.steps === 1 ? "" : "s"}`));
    follow();
    if (!document.activeElement || document.activeElement === document.body) input.focus({ preventScroll: true });
  });
  session.on("status", (st) => st === "idle" && settleRun());

  renderHistory();
  paintPills();
  return { el: root, focus: () => input.focus({ preventScroll: true }), setInput: (t) => { input.value = t; autosize(); input.focus(); }, send: (t, f) => session.send(t, f), paintPills, note, addFiles };
}
