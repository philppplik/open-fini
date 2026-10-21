// Tool-call cards for the Vibe transcript: compact one-line header (icon, title, argument summary, duration, status),
// expandable details (collapsible JSON arguments/result with copy buttons, clickable image thumbnails), an inline
// approval state and "Used N tools" groups for consecutive calls.
import { markContext } from "../context-menu/index.js";
import { h } from "../../core/util.js";
import { iconEl } from "../toolbox.js";
import { toolTitle, summarizeArgs, formatDuration, formatJson, resultParts, endStatus, groupLabel, STATUS_LABEL } from "./tool-format.js";

const TOOL_ICONS = { spawn_agent: "people", wait_agent: "three-dots", list_agents: "people", cancel_agent: "x-circle", run_plan: "collection", query_layers: "filter", describe_page: "card-text", describe_selection: "card-text", apply_to_many: "layers", evaluate: "123", screenshot_layers: "camera", compare_screenshots: "images", grid_layout: "grid-3x3", distribute_layers: "distribute-horizontal", snap_layers: "magnet", make_component: "box", open_attachment: "file-earmark-plus", list_attachments: "paperclip", create_skill: "mortarboard", add_shape: "bounding-box", add_text: "fonts", add_path: "bezier2", import_svg: "filetype-svg", set_style: "palette", screenshot: "camera", generate_image: "image", edit_image: "magic", write_file: "file-earmark-code", edit_file: "pencil-square", read_file: "file-earmark-text", create_website: "globe2", ask_user: "question-circle", update_plan: "list-check", search_knowledge: "search", remember: "bookmark-star", apply_adjustment: "sliders", new_document: "file-earmark-plus", insert_element: "plus-square", set_element_style: "palette2", use_skill: "mortarboard" };
const STATUS_ICON = { ok: "check2", error: "exclamation-circle", declined: "slash-circle", aborted: "x-circle", awaiting: "shield-lock" };
const MAX_NODES = 60;

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A small copy button that flips to a check mark for a moment. */
export function copyButton(getText, label = "Copy") {
  const b = h("button.of-copy", { type: "button", "aria-label": label, title: label }, iconEl("clipboard"));
  b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await copyText(typeof getText === "function" ? getText() : getText);
    b.replaceChildren(iconEl(ok ? "check2" : "x-circle"));
    b.classList.toggle("done", ok);
    setTimeout(() => {
      b.replaceChildren(iconEl("clipboard"));
      b.classList.remove("done");
    }, 1400);
  });
  return b;
}

// ---------------------------------------------------------------- JSON view (collapsible)
function scalar(v) {
  if (typeof v === "string") {
    const s = v.length > 2000 ? `${v.slice(0, 2000)}… (${(v.length - 2000).toLocaleString("en-US")} more characters)` : v;
    return h("span.of-jv.str", s);
  }
  return h(`span.of-jv.${v === null ? "nul" : typeof v}`, String(v));
}
function jsonNode(v, key, depth) {
  const k = key == null ? null : h("span.of-jk", String(key));
  if (v === null || typeof v !== "object") return h("div.of-jrow", k, scalar(v));
  const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
  if (!entries.length) return h("div.of-jrow", k, h("span.of-jv.nul", Array.isArray(v) ? "[]" : "{}"));
  const body = h("div.of-jbody");
  const node = h("details.of-jnode", { open: depth < 1 }, h("summary", k, h("span.of-jb", Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`)), body);
  const fill = () => {
    if (body.firstChild) return;
    if (depth > 6) return body.append(h("span.of-jv.str", formatJson(v, 400)));
    for (const [ek, ev] of entries.slice(0, MAX_NODES)) body.append(jsonNode(ev, ek, depth + 1));
    if (entries.length > MAX_NODES) body.append(h("div.of-jmore", `… ${entries.length - MAX_NODES} more`));
  };
  if (node.open) fill();
  node.addEventListener("toggle", fill);
  return node;
}
export function jsonView(value) {
  return h("div.of-json", jsonNode(value, null, 0));
}

// ---------------------------------------------------------------- lightbox
function openLightbox(src, alt, opener) {
  const img = h("img", { src, alt });
  const close = h("button.of-lightbox__close", { type: "button", "aria-label": "Close image" }, iconEl("x-lg"));
  const box = h("div.of-lightbox", { role: "dialog", "aria-modal": "true", "aria-label": alt }, img, close);
  const done = () => {
    box.remove();
    document.removeEventListener("keydown", onKey, true);
    opener?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      done();
    } else if (e.key === "Tab") {
      e.preventDefault();
      close.focus();
    }
  };
  box.addEventListener("click", (e) => e.target !== img && done());
  close.addEventListener("click", done);
  document.addEventListener("keydown", onKey, true);
  document.body.append(box);
  close.focus();
}

// ---------------------------------------------------------------- cards
let uidn = 0;

export function createToolCards({ settings, saveSettings, onGrow, cancelAgent }) {
  const recs = new Map(); // tool id -> record
  const agents = new Map(); // sub-agent id -> nested box under its spawn_agent card
  const live = new Set(); // records whose duration ticks
  let timer = null;

  const tick = () => {
    const now = Date.now();
    for (const r of live) r.time.textContent = formatDuration(now - r.t0);
    for (const r of thinkers) r.tick(now);
    if (!live.size && !thinkers.size) {
      clearInterval(timer);
      timer = null;
    }
  };
  const thinkers = new Set();
  const ensureTimer = () => {
    if (!timer) timer = setInterval(tick, 500);
  };

  // ---- groups
  function groupOf(b, firstCard) {
    if (b.group) return b.group;
    const list = h("div.of-tgroup__list", { id: `of-tg${++uidn}` });
    const label = h("span.of-tgroup__label");
    const cur = h("span.of-tgroup__cur");
    const head = h("button.of-tgroup__head", { type: "button", "aria-expanded": "false", "aria-controls": list.id }, iconEl("chevron-right"), label, cur);
    const el = h("div.of-tgroup", head, list);
    const g = { el, head, list, label, cur, members: [], manual: false };
    head.addEventListener("click", () => {
      g.manual = true;
      setGroupOpen(g, head.getAttribute("aria-expanded") !== "true");
    });
    firstCard.el.replaceWith(el);
    list.append(firstCard.el);
    g.members.push(firstCard);
    b.group = g;
    return g;
  }
  function setGroupOpen(g, open) {
    g.head.setAttribute("aria-expanded", String(open));
    g.el.classList.toggle("open", open);
    if (open) onGrow?.();
  }
  function refreshGroup(g) {
    if (!g) return;
    const st = g.members.map((m) => m.status);
    g.label.textContent = groupLabel(st);
    const running = g.members.filter((m) => m.status === "running").pop();
    g.cur.textContent = running ? running.title : "";
    const active = st.includes("running") || st.includes("awaiting");
    g.el.dataset.status = st.includes("awaiting") ? "awaiting" : active ? "running" : st.some((s) => s === "error") ? "error" : "ok";
    g.label.classList.toggle("of-shimmer", active);
    if (!g.manual && (st.includes("awaiting") || st.includes("error")) && g.head.getAttribute("aria-expanded") !== "true") setGroupOpen(g, true);
  }

  // ---- one card
  function setStatus(r, status) {
    r.status = status;
    r.el.dataset.status = status;
    r.title.classList.toggle("of-shimmer", status === "running");
    const icon = status === "running" ? h("sl-spinner") : iconEl(STATUS_ICON[status] || "check2");
    r.stat.replaceChildren(icon);
    r.stat.setAttribute("title", STATUS_LABEL[status]);
    r.sr.textContent = STATUS_LABEL[status];
    refreshGroup(r.group);
  }

  function renderDetail(r) {
    const d = r.detail;
    d.replaceChildren();
    const sec = (label, copy, body) => h("section.of-tcall__sec", h("div.of-tcall__sech", h("span", label), copy ? copyButton(copy, `Copy ${label.toLowerCase()}`) : null), body);
    const hasArgs = r.input && typeof r.input === "object" && Object.keys(r.input).length;
    if (hasArgs) d.append(sec("Arguments", () => formatJson(r.input, 1e6), jsonView(r.input)));
    if (r.result !== undefined) {
      const { texts, images } = resultParts(r.result);
      const body = h("div.of-tcall__res");
      for (const t of texts) {
        if (/^\s*[{[]/.test(t)) {
          try {
            body.append(jsonView(JSON.parse(t)));
            continue;
          } catch {
            /* plain text below */
          }
        }
        body.append(h("pre.of-tcall__txt", t.length > 4000 ? `${t.slice(0, 4000)}\n… (${(t.length - 4000).toLocaleString("en-US")} more characters)` : t));
      }
      if (images.length) {
        const row = h("div.of-tcall__imgs");
        images.forEach((im, i) => {
          const src = `data:${im.mime};base64,${im.data}`;
          const alt = `Result image ${i + 1} of ${images.length}`;
          const btn = h("button.of-tcall__thumb", { type: "button", "aria-label": `${alt}: open larger` }, h("img", { src, alt: "", loading: "lazy" }));
          btn.addEventListener("click", () => openLightbox(src, alt, btn));
          row.append(btn);
        });
        body.append(row);
      }
      if (!body.firstChild) body.append(h("div.of-tcall__none", "No output"));
      d.append(sec("Result", texts.length ? () => texts.join("\n\n") : null, body));
    } else d.append(h("div.of-tcall__none", "Waiting for the result…"));
    r.built = true;
  }

  function setOpen(r, open) {
    r.open = open;
    r.el.classList.toggle("open", open);
    r.head.setAttribute("aria-expanded", String(open));
    r.detail.hidden = !open;
    if (open) {
      if (!r.built) renderDetail(r);
      onGrow?.();
    }
  }

  function add(b, id, name, input) {
    const title = h("span.of-tcall__title", toolTitle(name));
    const sum = h("span.of-tcall__sum", summarizeArgs(input));
    const time = h("span.of-tcall__time");
    const stat = h("span.of-tcall__stat");
    const sr = h("span.of-sr-only", "");
    const detail = h("div.of-tcall__detail", { id: `of-td${++uidn}`, hidden: true });
    const head = h("button.of-tcall__head", { type: "button", "aria-expanded": "false", "aria-controls": detail.id }, iconEl(TOOL_ICONS[name] || "wrench"), title, sum, time, stat, sr, iconEl("chevron-right"));
    head.lastChild.classList.add("of-tcall__chev");
    const el = h("div.of-tcall", { "data-tool": name }, head, detail);
    const r = { id, name, input, el, head, title, sum, time, stat, sr, detail, open: false, built: false, t0: Date.now(), status: "running", group: null, titleText: toolTitle(name) };
    r.title = title;
    markContext(el, "vibe-tool-card", { name, input, card: el, toggle: () => setOpen(r, !r.open), isOpen: () => r.open, detail: () => detail });
    head.addEventListener("click", () => setOpen(r, !r.open));
    // consecutive calls share one collapsible group
    // spawn_agent cards stay ungrouped so their live agent boxes are visible
    if (b.tail?.type === "tool" && name !== "spawn_agent" && b.tail.rec.name !== "spawn_agent") {
      const g = groupOf(b, b.tail.rec);
      g.list.append(el);
      g.members.push(r);
      r.group = g;
      b.tail.rec.group = g;
    } else b.body.append(el);
    b.tail = { type: "tool", rec: r };
    recs.set(id, r);
    live.add(r);
    ensureTimer();
    setStatus(r, "running");
    refreshGroup(r.group);
    onGrow?.();
    return r;
  }

  function end(id, result, isError, ms) {
    const r = recs.get(id);
    if (!r) return;
    r.result = result;
    live.delete(r);
    const status = endStatus(isError, result);
    r.time.textContent = ms != null ? formatDuration(ms) : "";
    setStatus(r, status);
    const { images } = resultParts(result);
    if (images.length && status === "ok") setOpen(r, true);
    else if (r.built) renderDetail(r);
    onGrow?.();
  }

  /** Inline approval inside the card of the call; `false` when there is no such card. */
  function approve(req) {
    const r = recs.get(req.id);
    if (!r) return false;
    const finish = (ok, always) => {
      const had = box.contains(document.activeElement);
      box.remove(); // the decision lives on in the card status and in the Activity log
      r.approval = null;
      r.head.title = ok ? "Allowed by you" : "Declined by you";
      if (had) r.head.focus({ preventScroll: true });
      if (ok && always && !settings().autoAllow.includes(req.name)) saveSettings({ autoAllow: [...settings().autoAllow, req.name] });
      if (r.status === "awaiting") setStatus(r, "running");
      req.resolve(ok);
    };
    const allow = h("button.of-btn.of-btn--primary", { type: "button", onclick: () => finish(true) }, "Allow");
    const row = h("div.of-approval__actions", allow, h("button.of-btn", { type: "button", onclick: () => finish(true, true) }, "Always allow"), h("button.of-btn", { type: "button", onclick: () => finish(false) }, "Decline"));
    const box = h("div.of-approval", { role: "group", "aria-label": `Approval needed for ${r.titleText}` }, h("div.of-approval__title", iconEl("shield-lock"), h("strong", "Approval needed")), h("div.of-approval__reason", req.reason || `Allow “${r.titleText}”?`), jsonView(req.input ?? {}), row);
    r.el.insertBefore(box, r.detail);
    r.approval = box;
    setStatus(r, "awaiting");
    onGrow?.();
    return true;
  }

  /** A collapsible reasoning block with live elapsed seconds. */
  function thinking(b) {
    const label = h("span.of-think__label.of-shimmer", "Thinking…");
    const secs = h("span.of-think__secs");
    const pre = h("div.of-think__text");
    const body = h("div.of-think__body", { id: `of-th${++uidn}`, hidden: true }, pre);
    const head = h("button.of-think__head", { type: "button", "aria-expanded": "false", "aria-controls": body.id }, iconEl("chevron-right"), iconEl("lightbulb"), label, secs);
    const el = h("div.of-think", head, body);
    const t = { el, pre, t0: Date.now(), text: "", done: false };
    const paint = (now) => (secs.textContent = formatDuration(Math.floor((now - t.t0) / 1000) * 1000));
    t.tick = paint;
    t.finish = (ms) => {
      if (t.done) return;
      t.done = true;
      thinkers.delete(t);
      label.classList.remove("of-shimmer");
      label.textContent = "Thought";
      secs.textContent = ms === -1 ? "" : formatDuration(Math.max(1000, Math.round((ms ?? Date.now() - t.t0) / 1000) * 1000));
      el.classList.add("finished");
    };
    t.append = (delta) => {
      t.text += delta;
      pre.textContent = t.text;
      if (!body.hidden) onGrow?.();
    };
    head.addEventListener("click", () => {
      const open = head.getAttribute("aria-expanded") !== "true";
      head.setAttribute("aria-expanded", String(open));
      body.hidden = !open;
      el.classList.toggle("open", open);
      if (open) onGrow?.();
    });
    b.body.append(el);
    thinkers.add(t);
    ensureTimer();
    paint(Date.now());
    return t;
  }

  // ---- sub-agents: a nested box per child run under the spawn_agent card (or under its parent agent's box)
  const AGENT_ICON = { queued: "three-dots", done: "check2", error: "exclamation-circle", cancelled: "x-circle" };
  const AGENT_LABEL = { queued: "Queued", running: "Running", done: "Done", error: "Failed", cancelled: "Cancelled" };
  function agentBox(agent) {
    let a = agents.get(agent.id);
    if (a) return a;
    const dot = agent.id.lastIndexOf(".");
    const host = recs.get(agent.parentToolId)?.el || (dot > 0 ? agents.get(agent.id.slice(0, dot))?.body : null);
    if (!host) return null;
    const list = h("div.of-tagent__list");
    const text = h("div.of-tagent__text");
    const body = h("div.of-tagent__body", { id: `of-ta${++uidn}`, hidden: true }, text, list);
    const title = h("span.of-tagent__title", `Agent: ${agent.role}`);
    const sum = h("span.of-tagent__sum");
    const stat = h("span.of-tagent__stat");
    const sr = h("span.of-sr-only");
    const head = h("button.of-tagent__head", { type: "button", "aria-expanded": "false", "aria-controls": body.id }, iconEl("chevron-right"), iconEl("people"), title, sum, stat, sr);
    const cancel = h("button.of-tagent__cancel", { type: "button", "aria-label": `Cancel agent ${agent.role}`, title: "Cancel this agent" }, iconEl("x-lg"));
    cancel.addEventListener("click", () => cancelAgent?.(agent.id));
    const el = h("div.of-tagent", h("div.of-tagent__row", head, cancel), body);
    a = { el, head, body, list, text, title, sum, stat, sr, cancel, bubble: { body: list, tail: null, group: null }, open: false };
    const setOpen = (open) => {
      a.open = open;
      head.setAttribute("aria-expanded", String(open));
      body.hidden = !open;
      el.classList.toggle("open", open);
      if (open) onGrow?.();
    };
    a.setOpen = setOpen;
    head.addEventListener("click", () => setOpen(!a.open));
    host.append(el);
    agents.set(agent.id, a);
    onGrow?.();
    return a;
  }
  function agentStatus(agent) {
    const a = agentBox(agent);
    if (!a) return;
    const st = agent.status;
    a.el.dataset.status = st;
    a.stat.replaceChildren(st === "running" ? h("sl-spinner") : iconEl(AGENT_ICON[st] || "circle"));
    a.stat.title = AGENT_LABEL[st] || st;
    a.sr.textContent = AGENT_LABEL[st] || st;
    a.title.classList.toggle("of-shimmer", st === "running");
    a.sum.textContent = agent.summary ? agent.summary.split("\n")[0].slice(0, 120) : agent.task;
    a.cancel.hidden = !(st === "running" || st === "queued");
    if (agent.summary && st !== "running") a.text.textContent = agent.summary;
    if (st === "error" && !a.open) a.setOpen(true);
  }
  function agentEvent(e) {
    const a = agents.get(e.agentId);
    const ev = e.ev;
    if (!a || !ev) return;
    if (ev.type === "tool_start") add(a.bubble, ev.id, ev.name, ev.input);
    else if (ev.type === "tool_end") end(ev.id, ev.result, ev.isError, ev.ms);
    else if (ev.type === "text") {
      a.bubble.tail = null;
      a.bubble.group = null;
      a.text.textContent = (a.text.textContent + ev.delta).slice(-600);
    }
  }
  /** An approval of a child's tool call: shown inside the agent's box. */
  function agentApprove(req) {
    const a = agents.get(req.agent?.id);
    if (!a) return false;
    if (!a.open) a.setOpen(true);
    if (!recs.has(req.id)) add(a.bubble, req.id, req.name, req.input);
    return approve(req);
  }

  return {
    add,
    end,
    approve,
    thinking,
    agentStatus,
    agentEvent,
    agentApprove,
    has: (id) => recs.has(id),
    running: () => live.size,
    /** Stops timers and forgets all cards (history re-render). */
    reset() {
      recs.clear();
      live.clear();
      thinkers.clear();
      agents.clear();
    },
    /** A run ended: nothing keeps ticking. */
    settle() {
      for (const r of live) {
        r.time.textContent = formatDuration(Date.now() - r.t0);
        if (r.status === "running" || r.status === "awaiting") setStatus(r, "aborted");
      }
      live.clear();
      for (const t of thinkers) t.finish();
    },
  };
}

export const toolIcon = (name) => TOOL_ICONS[name] || "wrench";
