// Settings ▸ Artificial intelligence ▸ Logging and actions: where right-click AI actions run (new chat / reuse / inline),
// the AI log switches (metadata on by default, verbose content opt-in), a viewer of the stored runs and
// "Export AI log for the developer" (also offered in the Troubleshooting dialog). Format: docs/ai-logging.md.
//
// Public API: createLogPanel(vs) → { el, show };  exportAiLogDialog(app)
import { h, empty, downloadName, formatBytes } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { vibeStore } from "../../vibe/store.js";
import { openDialog, confirmDialog } from "../dialogs.js";

const MAX_SHOWN = 100;

/** Asks whether to include document content, then saves a redacted JSON and Markdown export. */
export async function exportAiLogDialog(app) {
  const L = await import("../../vibe/ai-log.js");
  const box = h("input", { type: "checkbox" });
  const fmt = h("select.of-input", { "aria-label": t("Format") }, h("option", { value: "json" }, "JSON"), h("option", { value: "md" }, "Markdown"));
  const body = h(
    "div.of-ailog__export",
    h("p", t("The export contains models, routing, tool names, durations, sizes, errors, token counts and approvals. API keys, tokens and passwords are always removed.")),
    h("label.of-ci__opt", box, h("span", t("Include content (prompts, tool arguments, results and replies; may contain document text)"))),
    h("label.of-ci__opt", h("span", t("Format")), fmt),
  );
  openDialog({
    title: "Export AI log for the developer",
    body,
    width: 520,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Export",
        variant: "primary",
        onClick: async (c) => {
          c();
          const { platform } = await import("../../platform/index.js");
          let build = "";
          try {
            build = (await (await import("../../core/env.js")).buildInfo())?.version || "";
          } catch {
            /* development */
          }
          const exp = L.exportAiLog(await L.loadAiLog(), { includeContent: box.checked, build });
          const md = fmt.value === "md";
          const text = md ? L.aiLogMarkdown(exp) : JSON.stringify(exp, null, 2);
          const res = await platform.saveFile({ suggestedName: downloadName("openfini-ai-log", md ? "md" : "json"), bytes: new TextEncoder().encode(text), mime: md ? "text/markdown" : "application/json", filters: [{ name: md ? "Markdown" : "JSON", extensions: [md ? "md" : "json"] }] });
          if (res) app.toast(t("Saved {name}", { name: res.name }), "success", 2000);
        },
      },
    ],
  });
}

export function createLogPanel(vs) {
  const { app } = vs;
  const s = () => vibeStore.settings;
  const where = h("select.of-input", { "aria-label": t("Right-click AI opens") }, ...[["new", "A new Vibe chat (recommended)"], ["reuse", "The last right-click chat"], ["inline", "No chat (answer in a dialog)"]].map(([v, l]) => h("option", { value: v }, t(l))));
  where.addEventListener("change", () => vibeStore.saveSettings({ quickActionChat: where.value }));
  const meta = h("input", { type: "checkbox" });
  const verbose = h("input", { type: "checkbox" });
  meta.addEventListener("change", () => (vibeStore.saveSettings({ aiLog: meta.checked }), paint()));
  verbose.addEventListener("change", () => vibeStore.saveSettings({ aiLogVerbose: verbose.checked }));
  const stats = h("p.of-hint", { role: "status" });
  const list = h("div.of-ailog__list", { role: "list", "aria-label": t("AI runs") });
  const detail = h("pre.of-ailog__detail.hidden", { tabindex: "0" });
  const exportBtn = h("button.of-btn", { type: "button", onclick: () => exportAiLogDialog(app) }, t("Export AI log for the developer"));
  const refresh = h("button.of-btn", { type: "button", onclick: () => load() }, t("Refresh"));
  const clear = h("button.of-btn", {
    type: "button",
    onclick: async () => {
      if (!(await confirmDialog({ title: "Clear the AI log?", message: "Every stored AI run record on this device is deleted.", ok: "Clear", danger: true }))) return;
      await (await import("../../vibe/ai-log.js")).clearAiLog();
      load();
    },
  }, t("Clear"));
  const el = h(
    "div.of-ailog",
    h("h3", t("Right-click AI")),
    h("label.of-ci__opt", h("span", t("Right-click AI actions open")), where),
    h("p.of-hint", t("Every action from right-click ▸ AI carries the selection, the document and the instruction into the chat, so you can follow up there.")),
    h("h3", t("Logging")),
    h("label.of-ci__opt", meta, h("span", t("Record AI runs (model, routing, tools, durations, errors, tokens, approvals)"))),
    h("label.of-ci__opt", verbose, h("span", t("Verbose: also record prompts, tool arguments, results and replies (redacted; may contain document text)"))),
    stats,
    h("div.of-ailog__bar", refresh, exportBtn, clear),
    list,
    detail,
  );

  function paint() {
    where.value = s().quickActionChat || "new";
    meta.checked = s().aiLog !== false;
    verbose.checked = !!s().aiLogVerbose;
    verbose.disabled = !meta.checked;
  }

  async function load() {
    const L = await import("../../vibe/ai-log.js");
    const [runs, st] = await Promise.all([L.loadAiLog(), L.aiLogStats()]);
    stats.textContent = t("{n} run(s) stored · {size}", { n: String(runs.length), size: formatBytes(st.bytes || 0) });
    empty(list);
    if (!runs.length) list.append(h("p.of-empty", t("No AI runs recorded yet.")));
    for (const r of runs.slice(-MAX_SHOWN).reverse()) {
      const errs = (r.tools || []).filter((c) => c.status === "error").length;
      const row = h(
        "button.of-ailog__row",
        { type: "button", role: "listitem", "data-status": r.stopReason || "" },
        h("time", new Date(r.t).toLocaleString()),
        h("span", r.model || "?"),
        h("span", t("{n} tool call(s)", { n: String((r.tools || []).length) }) + (errs ? ` · ${t("{n} failed", { n: String(errs) })}` : "")),
        h("span", `${r.ms ?? "?"} ms`),
        h("span", r.stopReason || ""),
      );
      row.addEventListener("click", () => {
        detail.textContent = JSON.stringify(r, null, 2);
        detail.classList.remove("hidden");
      });
      list.append(row);
    }
  }

  vibeStore.on("change", (k) => k === "settings" && paint());
  return {
    el,
    show() {
      paint();
      load();
    },
  };
}
