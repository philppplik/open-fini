// Vibe Studio chat: transcript (messages, tool cards, approvals, questions) and the composer.
import { h, empty } from "../../core/util.js";
import { iconButton } from "../controls.js";
import { iconEl } from "../toolbox.js";
import { renderMarkdown } from "./markdown.js";
import { vibeStore } from "../../vibe/store.js";
import { showContextMenu } from "../menus.js";
import { markContext } from "../context-menu/index.js";
import { registerVibeContext } from "./context.js";

const pretty = (name) => name.replace(/^mcp_/, "").replace(/__/g, " › ").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const TOOL_ICONS = { add_shape: "bounding-box", add_text: "fonts", add_path: "bezier2", import_svg: "filetype-svg", set_style: "palette", screenshot: "camera", generate_image: "stars", edit_image: "magic", write_file: "file-earmark-code", edit_file: "pencil-square", read_file: "file-earmark-text", create_website: "globe2", ask_user: "question-circle", update_plan: "list-check", search_knowledge: "search", remember: "bookmark-star", apply_adjustment: "sliders", new_document: "file-earmark-plus", insert_element: "plus-square", set_element_style: "palette2", use_skill: "mortarboard" };

function summarize(input) {
  if (!input || typeof input !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(input)) {
    if (v == null || typeof v === "object") continue;
    parts.push(`${k}: ${String(v).replace(/\s+/g, " ").slice(0, 38)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(" · ");
}

function resultNodes(result) {
  const nodes = [];
  const add = (b) => {
    if (b.type === "image") nodes.push(h("img.of-tool__img", { src: `data:${b.mime};base64,${b.data}`, alt: "Tool result image" }));
    else if (b.type === "text") nodes.push(h("pre", b.text.length > 3000 ? `${b.text.slice(0, 3000)}\n…` : b.text));
  };
  if (typeof result === "string") add({ type: "text", text: result });
  else if (Array.isArray(result)) result.forEach(add);
  else if (result != null) add({ type: "text", text: JSON.stringify(result, null, 2) });
  return nodes;
}

export function createChat(vs) {
  const { app, session } = vs;
  const scroller = h("div.of-vchat__scroll", { role: "log", "aria-live": "polite", "aria-label": "Conversation" });
  const thread = h("div.of-vchat__thread");
  scroller.append(thread);
  let stick = true;
  scroller.addEventListener("scroll", () => (stick = scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 60));
  const toBottom = () => stick && requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));

  // ------------------------------------------------------------ transcript
  let cur = null; // current assistant bubble { el, body, text }
  const tools = new Map();
  let msgIndex = -1; // index in session.chat.messages of the message being rendered (-1: live, not stored yet)
  registerVibeContext(vs);

  function assistantBubble() {
    if (cur) return cur;
    const body = h("div.of-vmsg__body");
    const el = h("div.of-vmsg.of-vmsg--assistant", h("div.of-vmsg__avatar", iconEl("of:vibe")), body);
    markContext(el, "vibe-message", { role: "assistant", index: msgIndex, el });
    thread.append(el);
    cur = { el, body, text: "", textEl: null, thinking: null };
    return cur;
  }
  function appendText(delta) {
    const b = assistantBubble();
    b.text += delta;
    if (!b.textEl) {
      b.textEl = h("div.of-vmsg__text");
      b.body.append(b.textEl);
    }
    b.textEl.replaceChildren(renderMarkdown(b.text));
    toBottom();
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
    const uel = markContext(h("div.of-vmsg.of-vmsg--user", body), "vibe-message", { role: "user", index: session.chat.messages.indexOf(msg), el: body });
    thread.append(uel);
    toBottom();
  }
  function toolCard(id, name, input) {
    const status = h("span.of-tool__status", h("sl-spinner"));
    const sum = h("span.of-tool__sum", summarize(input));
    const detail = h("div.of-tool__detail", h("pre", JSON.stringify(input ?? {}, null, 2)));
    const head = h("button.of-tool__head", { type: "button", "aria-expanded": "false" }, iconEl(TOOL_ICONS[name] || "wrench"), h("strong", pretty(name)), sum, status);
    const card = h("div.of-tool", { "data-tool": name }, head, detail);
    markContext(card, "vibe-tool-card", { name, input, card });
    head.addEventListener("click", () => card.classList.toggle("open"));
    const b = assistantBubble();
    endText();
    b.body.append(card);
    tools.set(id, { card, status, detail });
    toBottom();
  }
  function toolEnd(id, result, isError, ms) {
    const t = tools.get(id);
    if (!t) return;
    t.status.replaceChildren(isError ? iconEl("exclamation-circle") : iconEl("check2"), h("small", `${ms ?? 0} ms`));
    t.card.classList.toggle("error", !!isError);
    t.detail.append(h("div.of-tool__result", ...resultNodes(result)));
    const img = t.detail.querySelector("img");
    if (img) {
      t.card.classList.add("open");
      t.card.classList.add("has-image");
    }
    toBottom();
  }
  function approvalCard(req) {
    const b = assistantBubble();
    endText();
    const done = (ok, always) => {
      card.classList.add("resolved");
      card.querySelector(".of-approval__actions").replaceChildren(h("small", ok ? "Allowed" : "Declined"));
      if (ok && always && !vibeStore.settings.autoAllow.includes(req.name)) vibeStore.saveSettings({ autoAllow: [...vibeStore.settings.autoAllow, req.name] });
      req.resolve(ok);
    };
    const card = h(
      "div.of-approval",
      h("div.of-approval__title", iconEl("shield-check"), h("strong", "Approval needed")),
      h("div", req.reason || `Allow “${pretty(req.name)}”?`),
      h("pre", JSON.stringify(req.input ?? {}, null, 2).slice(0, 700)),
      h("div.of-approval__actions", h("button.of-btn.of-btn--primary", { type: "button", onclick: () => done(true) }, "Allow"), h("button.of-btn", { type: "button", onclick: () => done(true, true) }, "Always allow this tool"), h("button.of-btn", { type: "button", onclick: () => done(false) }, "Decline")),
    );
    b.body.append(card);
    toBottom();
  }
  function askCard(q) {
    const b = assistantBubble();
    endText();
    const input = h("input.of-ask__in", { type: "text", placeholder: "Your answer…", "aria-label": q.question });
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
    const card = h("div.of-ask", h("div.of-ask__q", iconEl("question-circle"), q.question), h("div.of-ask__row", ...(q.options || []).map((o) => h("button.of-btn", { type: "button", onclick: () => answer(o) }, o)), input, h("button.of-btn.of-btn--primary", { type: "button", onclick: () => answer(input.value.trim()) }, "Send")));
    b.body.append(card);
    toBottom();
    setTimeout(() => input.focus(), 50);
  }
  function note(text, kind = "info") {
    thread.append(h("div.of-vnote", { class: kind }, iconEl(kind === "error" ? "exclamation-triangle" : "info-circle"), text));
    toBottom();
  }

  function renderHistory() {
    empty(thread);
    cur = null;
    tools.clear();
    const msgs = session.chat.messages;
    if (!msgs.length) return thread.append(emptyState());
    const results = new Map();
    for (const m of msgs) if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") results.set(b.toolUseId, b);
    for (const m of msgs) {
      msgIndex = msgs.indexOf(m);
      if (m.role === "user") {
        if (Array.isArray(m.content) && m.content.every((b) => b.type === "tool_result")) continue;
        cur = null;
        userBubble(m);
      } else {
        cur = null;
        const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
        for (const b of blocks) {
          if (b.type === "text" && b.text) appendText(b.text), endText();
          else if (b.type === "tool_use") {
            toolCard(b.id, b.name, b.input);
            const r = results.get(b.id);
            if (r) toolEnd(b.id, r.content, r.isError, null);
          }
        }
      }
    }
    cur = null;
    msgIndex = -1;
    stick = true;
    toBottom();
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
      h("div.of-vempty__logo", iconEl("of:vibe")),
      h("h1", "What do you want to make?"),
      h("p", "Vibe works inside OpenFini. Describe it — it draws, edits photos, lays out pages and builds websites with your studios, and you can undo everything in one click."),
      h("div.of-vempty__ideas", ideas.map(([t, p, s]) => h("button.of-videa", { type: "button", onclick: () => { input.value = p; autosize(); input.focus(); } }, h("strong", t), h("span", p.slice(0, 80) + "…"), h("small", `${s} studio`)))),
    );
  }

  // ------------------------------------------------------------ composer
  const input = h("textarea.of-composer__in", { rows: 1, placeholder: "Ask Vibe to design, edit or build something…  (/ for skills, @selection for the selected layers)", "aria-label": "Message Vibe" });
  const chips = h("div.of-composer__chips");
  let files = [];
  const fileInput = h("input", { type: "file", multiple: true, style: { display: "none" }, accept: "image/*,.pdf,.ai,.psd,.psb,.idml,.sketch,.txt,.md,.csv,.json,.html,.css,.js,.svg,.xml,.yml,.yaml,.ts,.py,.sql" });
  const attach = iconButton({ icon: "paperclip", label: "Attach files or images", onClick: () => fileInput.click() });
  const mic = iconButton({ icon: "mic", label: "Dictate", onClick: () => dictate() });
  const sendBtn = h("button.of-composer__send", { type: "button", "aria-label": "Send" }, iconEl("arrow-up"));
  const modelPill = h("button.of-pill-btn", { type: "button", "aria-haspopup": "dialog" });
  const modePill = h("button.of-pill-btn", { type: "button", "data-tip": "How much Vibe may do without asking" });
  const thinkPill = h("button.of-pill-btn", { type: "button", "data-tip": "Reasoning effort (models that support it)" });
  const slash = h("div.of-slash.hidden", { role: "listbox" });
  const box = h("div.of-composer", chips, input, h("div.of-composer__bar", attach, mic, modelPill, modePill, thinkPill, h("span.of-composer__spacer"), sendBtn), slash);
  const root = h("div.of-vchat", scroller, h("div.of-vchat__dock", box, h("p.of-composer__hint", "Vibe can make mistakes. Changes are undoable with “Undo AI changes”. Keys and chats stay on this device.")));

  const autosize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(220, input.scrollHeight)}px`;
  };
  input.addEventListener("input", () => {
    autosize();
    slashMenu();
  });

  function renderChips() {
    empty(chips);
    files.forEach((f, i) => chips.append(h("span.of-chip2", /^image\//.test(f.type) ? h("img", { src: URL.createObjectURL(f), alt: "" }) : iconEl("file-earmark"), f.name, /\.(pdf|ai|psd|psb|idml|sketch)$/i.test(f.name) ? h("button", { type: "button", class: "of-chip2__open", title: "Import this file into OpenFini so the assistant can work with it", onclick: async () => { try { await app.openFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type }); } catch (err) { app.toast(err.message, "danger", 5000); } } }, "Open as document") : null, h("button", { type: "button", "aria-label": `Remove ${f.name}`, onclick: () => { files.splice(i, 1); renderChips(); } }, "×"))));
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

  async function send() {
    let text = input.value.trim();
    if (!text && !files.length) return;
    if (session.running) return;
    if (text.includes("@selection") && app.selection.length) {
      text = text.replace(/@selection/g, `the selected layer(s) (ids: ${app.selection.map((n) => n.id).join(", ")})`);
    }
    const f = files;
    files = [];
    renderChips();
    input.value = "";
    autosize();
    stick = true;
    try {
      await session.send(text || "Please look at the attached files.", f);
    } catch (err) {
      note(err.message, "error");
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
    sendBtn.replaceChildren(iconEl(session.running ? "stop-fill" : "arrow-up"));
    sendBtn.classList.toggle("running", session.running);
    sendBtn.setAttribute("aria-label", session.running ? "Stop" : "Send");
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
  session.on("chat", renderHistory);
  session.on("message", (m) => {
    if (thread.querySelector(".of-vempty")) empty(thread);
    cur = null;
    userBubble(m);
  });
  session.on("event", (ev) => {
    switch (ev.type) {
      case "text":
        appendText(ev.delta);
        break;
      case "thinking": {
        const b = assistantBubble();
        if (!b.thinking) {
          const pre = h("pre");
          b.thinking = { pre, el: h("details.of-think", h("summary", "Thinking"), pre) };
          b.body.append(b.thinking.el);
        }
        b.thinking.pre.textContent += ev.delta;
        break;
      }
      case "tool_start":
        toolCard(ev.id, ev.name, ev.input);
        break;
      case "tool_end":
        toolEnd(ev.id, ev.result, ev.isError, ev.ms);
        break;
      case "step":
        if (ev.n > 1) cur = null;
        break;
      case "retry":
        note(`The provider is busy — retrying (${ev.attempt})…`);
        break;
      default:
        break;
    }
  });
  session.on("approval", approvalCard);
  session.on("ask", askCard);
  session.on("notice", (n) => note(n.text, n.kind === "mcp" ? "error" : "info"));
  session.on("error", (err) => note(err.message || String(err), "error"));
  session.on("done", (res) => {
    cur = null;
    if (res.stopReason === "max_steps") note("Stopped after the maximum number of steps. Say “continue” to go on.");
    else if (res.stopReason === "aborted") note("Stopped.");
    const u = res.usage;
    if (u?.input || u?.output) thread.append(h("div.of-vusage", `${u.input?.toLocaleString("en-US") || 0} tokens in · ${u.output?.toLocaleString("en-US") || 0} out · ${res.steps || 1} step${res.steps === 1 ? "" : "s"}`));
    toBottom();
  });

  renderHistory();
  paintPills();
  return { el: root, focus: () => input.focus(), setInput: (t) => { input.value = t; autosize(); input.focus(); }, send: (t, f) => session.send(t, f), paintPills, note, addFiles };
}
