// Comments dock panel (right dock of Vector, Pixel, Layout and Code): every comment of the active document in one list,
// with filter (open / resolved / all), a jump to the commented place, resolve / reopen and "Resolve with AI".
// Works without any collaboration room: it only needs the small comments host (ui/collab/comments-host.js).
//
// Public API: createCommentsPanel(app) → { el, show() }   (registered lazily in panels/index.js)
// Accessibility: the list is a real list of buttons, rows are keyboard operable, counts are announced via aria-live.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { getComments } from "../collab/comments-host.js";
import { filterThreads, threadTitle, threadCounts } from "../../collab/comments.js";
import { pinNumbers } from "../../collab/anchors.js";

const icon = (name) => h("sl-icon", { name, "aria-hidden": "true" });
const fmt = (ts) => new Date(ts).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

export function createCommentsPanel(app) {
  const host = getComments(app);
  let status = "open";
  const list = h("div.of-cpanel__list");
  const count = h("span.of-cpanel__count", { "aria-live": "polite" });
  const seg = h("div.of-cpanel__seg", { role: "group", "aria-label": t("Show comments") });
  const add = h("button.of-collab-btn.of-collab-btn--primary", { type: "button" }, icon("plus-lg"), h("span", t("Add comment")));
  add.addEventListener("click", () => app.run("collab.addCommentHere"));
  const el = h("div.of-panel.of-cpanel", h("div.of-cpanel__bar", seg, add, count), list);

  const segBtn = (id, label) => {
    const b = h("button.of-collab-btn", { type: "button", "aria-pressed": String(status === id) }, h("span", label));
    b.addEventListener("click", () => {
      status = id;
      render();
    });
    return b;
  };

  async function render() {
    const doc = app.doc;
    const threads = doc ? host.threads(doc) : [];
    const c = threadCounts(threads);
    seg.replaceChildren(segBtn("open", t("Open ({n})", { n: c.open })), segBtn("resolved", t("Resolved ({n})", { n: c.resolved })), segBtn("all", t("All")));
    count.textContent = "";
    add.disabled = !doc;
    if (!doc) return list.replaceChildren(h("p.of-collab-empty", t("Open a document to see and add comments.")));
    const shown = filterThreads(threads, { status });
    if (!shown.length) return list.replaceChildren(h("p.of-collab-empty", status === "open" ? t("No open comments. Select something and choose Add comment, or press Shift+C and click where it belongs.") : t("Nothing here.")));
    const ui = await host.commentUI();
    const nums = pinNumbers(threads);
    list.replaceChildren(...shown.map((th) => row(doc, th, nums.get(th.id), ui)));
  }

  function row(doc, th, n, ui) {
    const go = h("button.of-cpanel__open", { type: "button", "aria-label": t("Show comment {n}: {text}", { n, text: threadTitle(th) }) },
      h("span.of-cpop__num", { style: `background:${th.color || "#888888"}` }, String(n || "")),
      h("span.of-cpanel__text", h("strong", th.nick || t("Unknown author")), h("span.of-cpanel__where", ui.anchorText(doc, th.anchor)), h("span.of-cpanel__title", threadTitle(th)), h("time", fmt(th.ts)), th.messages.length > 1 ? h("span.of-cpanel__replies", t("{n} replies", { n: th.messages.length - 1 })) : null));
    go.addEventListener("click", () => {
      host.reveal(doc, th);
      setTimeout(() => ui.openThread(th.id, { focus: true }), 160);
    });
    const tools = h("div.of-cpanel__tools");
    const res = h("button.of-collab-btn", { type: "button", title: th.resolved ? t("Reopen") : t("Resolve"), "aria-label": th.resolved ? t("Reopen") : t("Resolve") }, icon(th.resolved ? "arrow-counterclockwise" : "check2-circle"));
    res.addEventListener("click", () => host.setResolved(doc, th.id, !th.resolved));
    tools.append(res);
    if (!th.resolved && app.prefs.aiEnabled) {
      const ai = h("button.of-collab-btn", { type: "button", title: t("Resolve with AI"), "aria-label": t("Resolve with AI") }, icon("stars"));
      ai.addEventListener("click", () => ui.resolveWithAI(th));
      tools.append(ai);
    }
    return h("div.of-cpanel__row", { class: th.resolved ? "is-resolved" : "" }, go, tools);
  }

  host.events.addEventListener("change", (e) => (e.detail === "comments" || e.detail === "all") && render());
  for (const ev of ["doc", "docs"]) app.on(ev, render);
  render();
  return { el, show: render };
}
