// The Code panel of the Proto Studio (docs/concepts/proto-studio.md §5.3 and §10.1, task T7; dock id "proto-code"):
// live code of the selection (or of the page when nothing is selected) in every export format, with copy and a ZIP
// download of all files. It also builds the Export section of the Design panel (exportSection). The exporter
// (engine/proto/codegen/) and the highlighter load on first use, so the studio's start-up is unchanged.
//
//   createCodePanel(ws) → { el, render(force?) }
//   exportSection(ws, { sec, ids }) → element      the Design panel's Export section
//   downloadCode(ws, { format, ids }) → Promise     exports and saves a ZIP
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";

const codegen = () => import("../../engine/proto/codegen/index.js");
const hl = () => import("../../engine/web/highlight.js");
const FORMAT_KEY = "openfini.proto.codeFormat";

const LABELS = { html: "HTML + CSS", react: "React (CSS Modules)", "react-tailwind": "React (Tailwind)", tailwind: "HTML + Tailwind", swiftui: "SwiftUI" };
const FORMATS = Object.keys(LABELS);

function savedFormat() {
  try {
    const f = localStorage.getItem(FORMAT_KEY);
    return FORMATS.includes(f) ? f : "html";
  } catch {
    return "html";
  }
}
function saveFormat(f) {
  try {
    localStorage.setItem(FORMAT_KEY, f);
  } catch {
    /* private mode: keep the choice for this session only */
  }
}

const langOf = (path) => (/\.(tsx|ts|jsx|js)$/.test(path) ? "tsx" : /\.css$/.test(path) ? "css" : /\.html$/.test(path) ? "html" : /\.swift$/.test(path) ? "swift" : "text");

/** What the panel and the export use: the selection, else the page. */
function scopeOf(ws, ids) {
  const m = ws.model();
  const sel = (ids || ws.selection).filter((id) => m.nodes[id]);
  return sel.length ? { ids: sel } : { page: ws.page };
}

/** Exports and saves a ZIP of every file (assets included). */
export async function downloadCode(ws, { format, ids = null } = {}) {
  const [{ exportCode, zipEntries }, { zipSync }, { platform }, { downloadName }] = await Promise.all([codegen(), import("../../../vendor/fflate/fflate.js"), import("../../platform/index.js"), import("../../core/util.js")]);
  const m = ws.model();
  const res = await exportCode(m, { format, ...scopeOf(ws, ids) });
  const bytes = zipSync(zipEntries(res), { level: 6 });
  const sel = scopeOf(ws, ids);
  const name = sel.ids?.length === 1 ? m.nodes[sel.ids[0]]?.name : m.pages[ws.page]?.name || m.meta?.title;
  return platform.saveFile({ suggestedName: downloadName(`${name || "design"} ${format}`, "zip"), bytes, mime: "application/zip", filters: [{ name: "ZIP", extensions: ["zip"] }] });
}

async function copyText(ws, text) {
  try {
    await navigator.clipboard.writeText(text);
    ws.app?.toast?.(t("Copied to the clipboard."), "success", 2000);
  } catch {
    ws.app?.toast?.(t("The clipboard is not available here."), "warning", 4000);
  }
}

function formatSelect(value, onChange) {
  const s = h("select.of-proto-design__select", { "aria-label": t("Code format") });
  for (const f of FORMATS) s.append(h("option", { value: f, selected: f === value }, LABELS[f]));
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

/** The Export section of the Design panel (`sec` is the panel's section builder). */
export function exportSection(ws, { sec, ids }) {
  let format = savedFormat();
  const pick = formatSelect(format, (f) => {
    format = f;
    saveFormat(f);
  });
  const run = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      ws.app?.toast?.(e?.message || String(e), "warning", 5000);
    }
  };
  const dl = h("button.of-proto-code__btn", { type: "button" }, h("sl-icon", { name: "download" }), t("Export code…"));
  dl.addEventListener("click", run(() => downloadCode(ws, { format, ids })));
  const show = h("button.of-proto-code__btn", { type: "button" }, h("sl-icon", { name: "code-slash" }), t("Show code"));
  show.addEventListener("click", () => ws.app?.emit?.("revealpanel", "proto-code"));
  return sec(t("Export"), [h("label.of-proto-design__field.is-wide", h("span", t("Format")), pick), h("div.of-proto-code__actions", dl, show), h("p.of-proto-design__note", t("Exports the selected layers, or the page, as code with their components, variables and images."))]);
}

export function createCodePanel(ws) {
  let format = savedFormat();
  let file = null;
  let result = null;
  let key = null;
  let timer = 0;
  let seq = 0;
  const pick = formatSelect(format, (f) => {
    format = f;
    saveFormat(f);
    file = null;
    render(true);
  });
  const files = h("select.of-proto-design__select", { "aria-label": t("File") });
  files.addEventListener("change", () => {
    file = files.value;
    show();
  });
  const copy = h("button.of-proto-design__ibtn", { type: "button", "aria-label": t("Copy"), "data-tip": t("Copy") }, h("sl-icon", { name: "clipboard" }));
  copy.addEventListener("click", () => {
    const f = result?.files.find((x) => x.path === file);
    if (typeof f?.text === "string") copyText(ws, f.text);
  });
  const zip = h("button.of-proto-design__ibtn", { type: "button", "aria-label": t("Download as ZIP"), "data-tip": t("Download as ZIP") }, h("sl-icon", { name: "file-earmark-zip" }));
  zip.addEventListener("click", async () => {
    try {
      await downloadCode(ws, { format });
    } catch (e) {
      ws.app?.toast?.(e?.message || String(e), "warning", 5000);
    }
  });
  const scope = h("div.of-proto-code__scope");
  const code = h("code");
  const pre = h("pre.of-proto-code__pre", { tabindex: "0", "aria-label": t("Generated code") }, code);
  const notes = h("details.of-proto-code__notes", { hidden: true });
  const el = h(
    "div.of-proto-code",
    { role: "region", "aria-label": t("Code") },
    h("div.of-proto-code__bar", pick, copy, zip),
    h("div.of-proto-code__bar", files),
    scope,
    pre,
    notes,
  );

  async function show() {
    const f = result?.files.find((x) => x.path === file);
    if (!f) {
      code.textContent = "";
      return;
    }
    const text = typeof f.text === "string" ? f.text : t("Binary file ({n} bytes)", { n: f.bytes?.length || 0 });
    const lang = langOf(f.path);
    if (typeof f.text !== "string" || lang === "text" || text.length > 200000) {
      code.textContent = text;
      return;
    }
    const { highlight } = await hl();
    if (result?.files.find((x) => x.path === file) === f) code.innerHTML = highlight(text, lang); // escaped by highlight()
  }

  async function update() {
    const my = ++seq;
    const m = ws.model();
    const sc = scopeOf(ws);
    const { exportCode } = await codegen();
    let res;
    try {
      res = await exportCode(m, { format, ...sc });
    } catch (e) {
      if (my !== seq) return;
      result = null;
      code.textContent = e?.message || String(e);
      return;
    }
    if (my !== seq) return;
    result = res;
    const list = res.files.filter((f) => typeof f.text === "string");
    if (!list.some((f) => f.path === file)) file = res.entry && list.some((f) => f.path === res.entry) ? res.entry : list[0]?.path || null;
    files.replaceChildren(...list.map((f) => h("option", { value: f.path, selected: f.path === file }, f.path)));
    const n = sc.ids?.length || 0;
    scope.textContent = n ? (n === 1 ? t("Code of “{name}”", { name: m.nodes[sc.ids[0]]?.name || sc.ids[0] }) : t("Code of {n} layers", { n })) : t("Code of the page “{name}”", { name: m.pages[ws.page]?.name || "" });
    notes.hidden = !res.warnings.length;
    notes.replaceChildren(h("summary", t("{n} notes", { n: res.warnings.length })), h("ul", ...res.warnings.slice(0, 50).map((w) => h("li", w.message))));
    show();
  }

  function render(force = false) {
    const m = ws.model();
    const k = [m, ws.page, ws.selection.join(","), format];
    if (!force && key && k.every((v, i) => v === key[i])) return;
    if (!el.isConnected && !force) return; // a closed panel updates when it is shown
    key = k;
    clearTimeout(timer);
    timer = setTimeout(update, force ? 0 : 250);
  }
  ws.on?.("change", () => render());
  ws.on?.("selection", () => render());
  return { el, render };
}
