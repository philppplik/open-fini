// Vibe Studio Activity tab: a live log of every run in the current chat (plan, tool calls with timing and result,
// approvals, errors, token usage), filter chips, per-run undo, click-to-reveal and copy/clear.
// The data comes from the pure Timeline (timeline.js) that run-log.js feeds from the session's events.
import { h, empty } from "../../core/util.js";
import { iconEl } from "../toolbox.js";
import { copyText, toolIcon } from "./tool-cards.js";
import { FILTERS, visibleEntries, undoPlan, formatLog, summarizeTouched } from "./timeline.js";
import { formatDuration, STATUS_LABEL } from "./tool-format.js";

const FILTER_LABEL = { all: "All", changes: "Changes", errors: "Errors" };
const RUN_ICON = { running: "arrow-repeat", done: "check-circle-fill", error: "exclamation-triangle-fill", aborted: "x-circle-fill" };
const STATUS_ICON = { ok: "check2", error: "exclamation-circle", declined: "slash-circle", aborted: "x-circle", awaiting: "shield-lock" };
const time = (t) => new Date(t).toLocaleTimeString("en-US", { hour12: false });

export function createActivityPanel(vs) {
  const { app, session } = vs;
  let timeline = vs.timeline; // the active chat's log; rebound when the user switches chats
  let filter = "all";
  const opened = new Map(); // run id -> user's choice (true/false); default: newest run open
  let raf = 0;
  let ticker = null;

  const chips = h("div.of-vlog__chips", { role: "group", "aria-label": "Filter the log" });
  const copyBtn = h("button.of-btn", { type: "button", title: "Copy the log as plain text" }, iconEl("clipboard"), "Copy log");
  const clearBtn = h("button.of-btn", { type: "button", title: "Clear the log (does not undo anything)" }, iconEl("trash3"), "Clear");
  const summary = h("div.of-vlog__sum", { "aria-live": "off" });
  const planBox = h("div.of-vlog__plan");
  const list = h("div.of-vlog__runs");
  const el = h("div.of-vactivity", h("div.of-vlog__bar", chips, h("span.of-vlog__spacer"), copyBtn, clearBtn), summary, list, h("p.of-hint", "Every change Vibe makes is a normal OpenFini edit: you can also undo it step by step with Ctrl+Z. The log covers this chat since you opened it and is not saved."));
  void planBox;

  function paintChips() {
    empty(chips);
    for (const f of FILTERS) {
      const b = h("button.of-vlog__chip", { type: "button", "aria-pressed": String(filter === f), class: filter === f ? "active" : "" }, FILTER_LABEL[f]);
      b.addEventListener("click", () => {
        filter = f;
        paintChips();
        render();
      });
      chips.append(b);
    }
  }

  async function reveal(t) {
    const doc = app.doc;
    if (!doc) return;
    if (t.type === "node") {
      const n = doc.find?.(t.ref);
      if (!n) return app.toast("That layer no longer exists.", "warning", 1800);
      app.select(n);
      app.toast(`Selected “${n.name || n.type || t.ref}”.`, "primary", 1400);
    } else if (doc.web?.has(t.ref)) {
      await app.setStudio("code");
      app.codeUI?.openFile?.(t.ref, { focus: true });
    }
  }
  const resolvable = (t) => (t.type === "node" ? !!app.doc?.find?.(t.ref) : !!app.doc?.web?.has?.(t.ref));
  const label = (t) => (t.type === "node" ? app.doc?.find?.(t.ref)?.name || t.ref : t.ref.split("/").pop());

  function entryRow(e) {
    const dur = e.ms != null ? formatDuration(e.ms) : e.status === "running" || e.status === "awaiting" ? formatDuration(Date.now() - e.at) : "";
    let icon;
    let title;
    let sub = "";
    let cls = e.kind;
    if (e.kind === "tool") {
      icon = e.status === "running" ? h("sl-spinner") : iconEl(STATUS_ICON[e.status] || toolIcon(e.name));
      title = e.title;
      sub = e.summary;
      cls = `tool ${e.status}`;
    } else if (e.kind === "approval") {
      icon = iconEl("shield-check");
      title = e.decision ? `Approval ${e.decision}` : "Approval asked";
      sub = e.text;
      cls = `approval ${e.decision || "pending"}`;
    } else if (e.kind === "fallback") {
      icon = iconEl("shuffle");
      title = e.text;
      sub = e.detail;
    } else if (e.kind === "retry") {
      icon = iconEl("arrow-repeat");
      title = e.text;
      sub = e.detail;
    } else {
      icon = iconEl("exclamation-triangle");
      title = "Error";
      sub = e.text;
    }
    const touches = (e.touches || []).filter(resolvable).slice(0, 3);
    const main = h("div.of-vlog__main", h("div.of-vlog__title", h("span", title), dur ? h("small", dur) : null), sub ? h("div.of-vlog__sub", sub) : null, e.kind === "tool" && e.status !== "ok" && e.status !== "running" && e.result ? h("div.of-vlog__sub.err", e.result) : null);
    const row = h("li.of-vlog__entry", { class: cls }, h("span.of-vlog__ico", { title: e.kind === "tool" ? STATUS_LABEL[e.status] : "" }, icon), h("time.of-vlog__time", { datetime: new Date(e.at).toISOString() }, time(e.at)), main);
    if (touches.length) {
      const wrap = h("div.of-vlog__touch");
      for (const t of touches) {
        const b = h("button.of-vlog__go", { type: "button", title: t.type === "node" ? "Select this layer" : "Open this file in the Code studio" }, iconEl(t.type === "node" ? "cursor" : "file-earmark-code"), label(t));
        b.addEventListener("click", () => reveal(t));
        wrap.append(b);
      }
      main.append(wrap);
    }
    return row;
  }

  function runCard(run, i, plan) {
    const isNewest = i === 0;
    const open = opened.has(run.id) ? opened.get(run.id) : isNewest;
    const dur = formatDuration((run.endedAt ?? Date.now()) - run.startedAt);
    const entries = visibleEntries(run, filter);
    const tools = run.entries.filter((e) => e.kind === "tool").length;
    const errs = run.entries.filter((e) => e.kind === "error" || (e.kind === "tool" && e.status === "error")).length;
    const touched = summarizeTouched(run);
    const meta = [time(run.startedAt), dur, `${run.steps || 1} step${(run.steps || 1) === 1 ? "" : "s"}`, `${tools} tool call${tools === 1 ? "" : "s"}`];
    if (errs) meta.push(`${errs} error${errs === 1 ? "" : "s"}`);
    if (run.usage.reported) meta.push(`${(run.usage.input + run.usage.output).toLocaleString("en-US")} tokens`);
    const body = h("div.of-vlog__body", { id: `of-run-${run.id}`, hidden: !open });
    const head = h("button.of-vlog__head", { type: "button", "aria-expanded": String(open), "aria-controls": body.id }, iconEl("chevron-right"), h("span.of-vlog__rico", { class: run.status }, run.status === "running" ? h("sl-spinner") : iconEl(RUN_ICON[run.status] || "circle")), h("span.of-vlog__rtitle", { class: run.status === "running" ? "of-shimmer" : "" }, `“${run.title}”`));
    head.addEventListener("click", () => {
      opened.set(run.id, head.getAttribute("aria-expanded") !== "true");
      render();
    });
    const sub = h("div.of-vlog__meta", meta.join(" · "));
    const card = h("section.of-vlog__run", { class: `${run.status} ${open ? "open" : ""}` }, head, sub);

    // undo state
    const u = plan.get(run.id);
    const doc = run.undoRefs[0]?.doc;
    const undoRow = h("div.of-vlog__undo");
    if (u?.undoable) {
      const direct = u.direct;
      const b = h("button.of-btn", { type: "button", disabled: session.running, title: direct ? `Undo the ${run.edits} edit${run.edits === 1 ? "" : "s"} of this run${doc ? ` in ${doc.name}` : ""}` : `Undo ${u.count - run.undoRefs.length} newer run${u.count - run.undoRefs.length === 1 ? "" : "s"} first, then this one` }, iconEl("arrow-counterclockwise"), direct ? "Undo this run" : "Undo back to here");
      b.addEventListener("click", () => {
        let n = 0;
        for (let k = 0; k < u.count; k++) {
          const d = session.undoLastRun();
          if (!d) break; // another chat or the user edited the document afterwards (run-undo.js)
          n += d;
        }
        if (!n && session.lastUndoError) app.toast(session.lastUndoError, "warning", 5000);
        else app.toast(`Undid ${n} change${n === 1 ? "" : "s"} (${u.count} run${u.count === 1 ? "" : "s"}).`, "success", 1800);
      });
      undoRow.append(b, h("small", `${run.edits} edit${run.edits === 1 ? "" : "s"}${doc ? ` in ${doc.name}` : ""}${direct ? "" : " · newer runs are undone first"}`));
    } else if (run.undoRefs.length) undoRow.append(h("small.of-vlog__muted", iconEl("check2"), "Undone"));
    else if (run.status !== "running") undoRow.append(h("small.of-vlog__muted", "No document edits"));
    body.append(undoRow);

    if (touched.paths.length || touched.nodes) body.append(h("div.of-vlog__touched", iconEl("files"), [touched.nodes ? `${touched.nodes} layer${touched.nodes === 1 ? "" : "s"}` : null, ...touched.paths.slice(0, 4), touched.paths.length > 4 ? `+${touched.paths.length - 4} files` : null].filter(Boolean).join(", ")));

    if (run.plan.length) {
      const done = run.plan.filter((s) => s.status === "done").length;
      body.append(h("div.of-vlog__plan", h("h3", `Plan · ${done}/${run.plan.length}`), run.plan.map((s) => h("div.of-vplan__step", { class: s.status }, iconEl(s.status === "done" ? "check-circle-fill" : s.status === "active" ? "arrow-right-circle-fill" : "circle"), h("span", s.text)))));
    }
    body.append(entries.length ? h("ol.of-vlog__list", entries.map(entryRow)) : h("div.of-empty", run.entries.length ? "Nothing matches this filter." : run.status === "running" ? "Waiting for the first step…" : "No tool calls in this run."));
    card.append(body);
    return card;
  }

  function render() {
    raf = 0;
    const runs = timeline.runs;
    const t = timeline.totals();
    summary.textContent = runs.length ? `${t.runs} run${t.runs === 1 ? "" : "s"} · ${t.tools} tool call${t.tools === 1 ? "" : "s"} · ${t.errors} error${t.errors === 1 ? "" : "s"} · ${formatDuration(t.ms)}` : "";
    copyBtn.disabled = clearBtn.disabled = !runs.length;
    empty(list);
    if (!runs.length) list.append(h("div.of-vlog__empty", iconEl("activity"), h("strong", "No activity yet"), h("span", "Ask Vibe to make something. Plan, tool calls, approvals, errors and undo points show up here while it works.")));
    else {
      const plan = undoPlan(runs, session.runs);
      runs.slice().reverse().forEach((r, i) => list.append(runCard(r, i, plan)));
    }
    const live = !!timeline.current;
    if (live && !ticker) ticker = setInterval(() => (el.isConnected ? render() : null), 1000);
    if (!live && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(render);
  };

  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(formatLog(timeline.runs, filter));
    app.toast(ok ? "Log copied." : "Could not copy to the clipboard.", ok ? "success" : "warning", 1400);
  });
  clearBtn.addEventListener("click", () => timeline.clear());
  // a chat can be undone only while its edits are on top of the document history (docs/adr/0008-vibe-hub.md)

  let off = timeline.onChange(schedule);
  session.on("runs", schedule);
  session.on("chat", () => {
    if (vs.timeline === timeline) return;
    off?.();
    timeline = vs.timeline;
    off = timeline.onChange(schedule);
    opened.clear();
    schedule();
  });
  paintChips();
  render();
  return { el, show: render };
}
