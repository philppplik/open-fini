// Right-click AI functions: assistant runs started from context menus of the canvas, the code editor, the website
// designer and the Office apps. They use the same tools, permissions and undo as Vibe Studio.
//
// Every action opens a Vibe chat that carries its context (docs/vibe-studio.md ▸ Right-click AI):
//   Settings ▸ Artificial intelligence ▸ Logging and actions ▸ "Right-click AI opens": "new" (default, a new chat per
//   action) · "reuse" (the last right-click chat while it is idle) · "inline" (a hidden chat, answer in a dialog).
// The chat gets a title from the action and the target ("Rewrite · Headline"), `chat.target` (where it came from,
// used by "Go to selection" in the chat) and the instruction plus a bounded context block (CONTEXT_LIMIT chars).
//
// Public API
//   runQuickAction(app, { label, prompt, mode, extra, target, attach })   mode "apply" | "answer"
//   canvasAiItems(app) / codeAiItems(app, getCtx) / officeAiItems(app, getCtx) / elementAiItems(app, ws)
//   officeAppAiItems(app, kind, data)     sheet / slides / board surfaces
//   canvasTarget(app) / jumpToTarget(app, target) / chatTitle(label, target)
import { h } from "../core/util.js";
import { vibeStore } from "./store.js";
import { openDialog, promptDialog, confirmDialog } from "../ui/dialogs.js";

export const CONTEXT_LIMIT = 12000;
let bar = null;
let lastChatId = null;

const clip = (s, n = CONTEXT_LIMIT) => (String(s).length > n ? `${String(s).slice(0, n)}\n… (truncated, ${String(s).length - n} more characters)` : String(s));

/** "Rewrite · Headline" (at most 60 characters). */
export function chatTitle(label, target) {
  const what = target?.label ? ` · ${target.label}` : "";
  return `${label}${what}`.replace(/\s+/g, " ").slice(0, 60);
}

function docType(doc) {
  if (!doc) return "";
  if (doc.office) return `office-${doc.office.kind || "document"}`;
  if (doc.web && !doc.pages?.[0]?.root?.children?.length) return "website";
  return doc.studio || "vector";
}

const base = (app, extra) => ({ studio: app.studio, docId: app.doc?.id || null, docName: app.doc?.name || "", docType: docType(app.doc), ...extra });

/** The canvas selection (or the page) as a chat target. */
export function canvasTarget(app) {
  const sel = app.selection || [];
  if (!sel.length) return base(app, { kind: "page", pageId: app.page?.id || null, label: app.page?.name || "Page" });
  const label = sel.length === 1 ? String(sel[0].name || sel[0].type) : `${sel.length} layers`;
  return base(app, { kind: sel.every((n) => n.type === "text") ? "text" : "layers", pageId: app.page?.id || null, ids: sel.slice(0, 50).map((n) => n.id), label: label.slice(0, 40) });
}

function contextBlock(app, target, extra) {
  const lines = [`Document: “${target?.docName || app.doc?.name || "none"}” (${target?.docType || docType(app.doc) || "no document"}), studio ${target?.studio || app.studio}.`];
  if (target?.ids?.length) {
    const sel = app.selection || [];
    const more = target.ids.length > 20 ? ` and ${target.ids.length - 20} more` : "";
    lines.push(`Selected layers (${target.ids.length}): ${sel.slice(0, 20).map((n) => `${n.id} (${n.type}${n.name ? `, “${n.name}”` : ""})`).join(", ")}${more}.`);
  } else if (target?.kind === "page") lines.push("No layers are selected: the target is the current page.");
  if (extra) lines.push(clip(extra));
  return lines.join("\n");
}

function undoBar(app, s, label, onOpen) {
  bar?.remove();
  const close = () => bar?.remove();
  bar = h(
    "div.of-aibar",
    h("span", `AI: ${label}`),
    s.runs.length ? h("button.of-btn", { type: "button", onclick: () => { const n = s.undoLastRun(); app.toast(n ? `Undid ${n} change${n === 1 ? "" : "s"}.` : s.lastUndoError || "Nothing to undo.", n ? "success" : "warning", n ? 1500 : 5000); close(); } }, "Undo") : null,
    onOpen ? h("button.of-btn", { type: "button", onclick: () => (onOpen(), close()) }, "Open chat") : null,
    h("button.of-btn", { type: "button", "aria-label": "Dismiss", onclick: close }, "×"),
  );
  document.body.append(bar);
  setTimeout(close, 12000);
}

function ready(app) {
  if (!app.prefs.aiEnabled) {
    app.toast("AI features are off. Turn them on in Settings ▸ Artificial intelligence.", "warning", 4000);
    return false;
  }
  if (!vibeStore.settings.activeProvider && vibeStore.settings.model !== "demo" && !vibeStore.settings.activeRoute) {
    app.toast("Connect a model first: Settings ▸ Artificial intelligence ▸ Models.", "warning", 4000);
    app.setStudio("vibe");
    return false;
  }
  if (app.network?.offline && vibeStore.settings.model !== "demo" && vibeStore.settings.activeProvider) {
    app.toast("You are offline (Settings ▸ Privacy ▸ Offline mode): AI requests cannot be sent.", "warning", 4000);
    return false;
  }
  return true;
}

/** A small PNG of the selection (or null) as an attachment, when screenshots may be sent. */
async function selectionShot(app, target) {
  if (!target?.ids?.length || vibeStore.settings.sendScreenshots === false || !app.page) return null;
  try {
    const { pageBounds } = await import("../core/transform.js");
    const nodes = target.ids.map((id) => app.doc?.find(id)).filter(Boolean);
    const bs = nodes.map((n) => pageBounds(n)).filter((b) => b && b.w > 0 && b.h > 0);
    if (!bs.length) return null;
    const x0 = Math.max(0, Math.min(...bs.map((b) => b.x)) - 16);
    const y0 = Math.max(0, Math.min(...bs.map((b) => b.y)) - 16);
    const x1 = Math.min(app.page.w, Math.max(...bs.map((b) => b.x + b.w)) + 16);
    const y1 = Math.min(app.page.h, Math.max(...bs.map((b) => b.y + b.h)) + 16);
    if (!(x1 - x0 > 1 && y1 - y0 > 1)) return null;
    const { exportRaster } = await import("../core/io.js");
    const r = await exportRaster(app, { page: app.page, format: "png", scale: Math.min(1, 512 / Math.max(x1 - x0, y1 - y0)), area: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
    return new File([r.bytes], "selection.png", { type: "image/png" });
  } catch {
    return null;
  }
}

/** Shows where a right-click chat came from: activates the document and selects the target again (best effort). */
export async function jumpToTarget(app, tg) {
  if (!tg) return false;
  const doc = (app.docs || []).find((d) => d.id === tg.docId);
  if (!doc) {
    app.toast?.(`“${tg.docName || "The document"}” is not open anymore.`, "warning", 3000);
    return false;
  }
  if (app.doc !== doc) app.activateDoc(doc);
  if (tg.studio && tg.studio !== "vibe" && app.studio !== tg.studio) app.setStudio(tg.studio);
  await new Promise((r) => setTimeout(r, 150));
  try {
    if (tg.ids?.length && !tg.kind?.startsWith("office")) {
      const page = doc.pages.find((p) => p.id === tg.pageId);
      if (page) app.setActivePage(page);
      app.select(tg.ids.map((id) => doc.find(id)).filter(Boolean));
    } else if (tg.kind === "page" && tg.pageId) {
      const page = doc.pages.find((p) => p.id === tg.pageId);
      if (page) app.setActivePage(page);
    } else if (tg.kind === "code") {
      const ed = app.codeUI?.editors;
      if (tg.path && ed && ed.active !== tg.path) await ed.open?.(tg.path);
      const view = ed?.view;
      if (view) {
        const d = view.state.doc;
        const a = d.line(Math.min(tg.fromLine || 1, d.lines));
        const b = d.line(Math.min(tg.toLine || tg.fromLine || 1, d.lines));
        view.dispatch({ selection: { anchor: a.from, head: b.to }, scrollIntoView: true });
        view.focus();
      }
    } else if (tg.kind === "office-cells") {
      const v = app.officeUI;
      if (tg.sheet && v?.showSheet) v.showSheet(tg.sheet);
      if (tg.range && v?.select) {
        v.select(tg.range.r0, tg.range.c0, false);
        v.select(tg.range.r1, tg.range.c1, true);
      }
    } else if (tg.kind === "office-slides") {
      const v = app.officeUI;
      if (tg.slide && v?.goTo) v.goTo(tg.slide);
      if (tg.ids?.length && v?.select) v.select(tg.ids);
    } else if (tg.kind === "office-board") {
      app.officeUI?.select?.(tg.ids || []);
    }
  } catch {
    /* best effort: the target may have changed */
  }
  app.requestOverlay?.();
  return true;
}

async function inline(app, { label, text, mode, files }) {
  const { getVibeHub } = await import("./hub.js");
  const s = getVibeHub(app).create({ hidden: true });
  s.label = label;
  s.on("approval", async (req) => req.resolve(await confirmDialog({ title: "Allow this action?", message: req.reason || `Vibe wants to use “${req.name}”.`, ok: "Allow" })));
  s.on("ask", async (q) => q.resolve((await promptDialog({ title: "Vibe asks", label: q.question, ok: "Answer" })) || ""));
  let out = "";
  const off = s.on("event", (ev) => ev.type === "text" && (out += ev.delta));
  try {
    await s.send(text, files);
  } catch (err) {
    app.toast(err.message || "The AI request failed.", "danger", 5000);
    return;
  } finally {
    off();
    setTimeout(() => s.hub.remove(s.id), 15000); // keep it for the undo bar, then forget the hidden chat
  }
  if (mode === "answer") {
    const { renderMarkdown } = await import("../ui/vibe/markdown.js");
    openDialog({ title: label, body: h("div.of-aianswer", renderMarkdown(out || "No answer.")), width: 620, buttons: [{ label: "Close", variant: "primary", onClick: (c) => c() }] });
  } else if (s.runs.length) undoBar(app, s, label);
  else app.toast(out.slice(0, 160) || "Vibe made no changes.", "primary", 3500);
}

/**
 * Runs an assistant request in a Vibe chat (or inline, see the setting).
 * @param {object} o { label, prompt, mode: "apply"|"answer", extra, target, attach: { screenshot?, document? } }
 */
export async function runQuickAction(app, { label, prompt, mode = "apply", extra = "", target = null, attach = {} }) {
  await vibeStore.load();
  if (!ready(app)) return null;
  target ||= canvasTarget(app);
  const files = [];
  if (attach.screenshot ?? (target.ids?.length && mode !== "answer")) {
    const shot = await selectionShot(app, target);
    if (shot) files.push(shot);
  }
  let more = extra;
  if (attach.document && app.doc) more += `\n\nThe whole document is in scope: read it with the tools (get_document_info, list_layers, office_read_document, sheet_describe, slides_describe, board_describe or read_file).`;
  const reply = mode === "answer" ? "Answer in the chat; do not change the document." : "Work directly with the tools; keep changes focused on what was asked; reply with at most two sentences when done.";
  const text = `${prompt}\n\n[Vibe context]\n${contextBlock(app, target, more.trim())}\n\n${reply}`;
  const where = vibeStore.settings.quickActionChat || "new";
  if (where === "inline") return inline(app, { label, text, mode, files });

  const { getVibeHub } = await import("./hub.js");
  const hub = getVibeHub(app);
  let s = where === "reuse" && lastChatId ? hub.get(lastChatId) : null;
  if (s && (s.running || s.starting)) s = null;
  if (!s) s = hub.create();
  lastChatId = s.id;
  s.chat.title = chatTitle(label, target);
  s.chat.target = target;
  s.chat.source = "right-click";
  if (hub.active === s) hub.view.emit("chat");
  else hub.activate(s.id);
  const open = () => import("../ui/vibe/settings-ai.js").then((m) => m.whenChat(app)).then(() => hub.activate(s.id));
  // approvals and questions of a background chat: ask right away while the user is not looking at Vibe Studio
  const offA = s.on("approval", async (req) => {
    if (app.studio === "vibe") return;
    req.resolve(await confirmDialog({ title: "Allow this action?", message: req.reason || `Vibe wants to use “${req.name}”.`, ok: "Allow" }));
  });
  const offQ = s.on("ask", async (q) => {
    if (app.studio === "vibe") return;
    q.resolve((await promptDialog({ title: "Vibe asks", label: q.question, ok: "Answer" })) || "");
  });
  if (app.studio !== "vibe") app.toast(`AI: ${chatTitle(label, target)} — running in a Vibe chat.`, "primary", 2500);
  let out = "";
  const offT = s.on("event", (ev) => ev.type === "text" && (out += ev.delta));
  try {
    await s.send(text, files);
  } catch (err) {
    app.toast(err.message || "The AI request failed.", "danger", 5000);
    return s;
  } finally {
    offA();
    offQ();
    offT();
  }
  if (app.studio === "vibe") return s;
  if (mode === "answer") {
    const { renderMarkdown } = await import("../ui/vibe/markdown.js");
    openDialog({ title: label, body: h("div.of-aianswer", renderMarkdown(out || "No answer.")), width: 620, buttons: [{ label: "Continue in chat", onClick: (c) => (c(), open()) }, { label: "Close", variant: "primary", onClick: (c) => c() }] });
  } else undoBar(app, s, s.runs.length ? label : `${label}: ${out.slice(0, 80) || "no changes"}`, open);
  return s;
}

/** "Custom instruction…": the dialog (ui/vibe/custom-instruction.js) and then a chat like every other action. */
const custom = (app, getTarget, getExtra = () => "") => ({
  label: "Custom instruction…",
  icon: "pencil-square",
  run: async () => {
    const target = getTarget();
    const { customInstructionDialog } = await import("../ui/vibe/custom-instruction.js");
    const r = await customInstructionDialog(app, target);
    if (!r) return;
    runQuickAction(app, { label: r.prompt.slice(0, 30), prompt: r.prompt, mode: r.answer ? "answer" : "apply", target, extra: r.selection === false ? "" : getExtra(), attach: { screenshot: r.screenshot, document: r.document } });
  },
});

/** Menu items for the canvas context menu (selection aware). */
export function canvasAiItems(app) {
  if (!app.prefs.aiEnabled) return [];
  const sel = app.selection || [];
  const hasText = sel.some((n) => n.type === "text");
  const run = (label, prompt, mode) => () => runQuickAction(app, { label, prompt, mode });
  const ask = (label, title, field, build) => async () => {
    const target = canvasTarget(app);
    const v = await promptDialog({ title, label: field, ok: "Go" });
    if (v) runQuickAction(app, { label, prompt: build(v), target });
  };
  const items = [custom(app, () => canvasTarget(app)), "-"];
  if (sel.length) {
    items.push({ label: "Describe", run: run("Describe", "Describe the selected layers: what they show, the style, and one suggestion to improve them.", "answer") });
    items.push({ label: "Restyle…", run: ask("Restyle", "Restyle the selection", "Describe the new style (colors, mood, type)", (v) => `Restyle the selected layers: ${v}. Keep the layout and content.`) });
    items.push({ label: "Create variations", run: run("Variations", "Duplicate the selection three times to the right with distinct color and style variations, spaced evenly.") });
    items.push({ label: "Tidy up layout", run: run("Tidy up", "Align and evenly distribute the selected layers, fix inconsistent spacing and sizes, and name the layers meaningfully.") });
    items.push({ label: "Name layers", run: run("Name layers", "Rename the selected layers (and their children) with short, meaningful names based on what they show.") });
  }
  if (hasText) {
    items.push({ label: "Rewrite text…", run: ask("Rewrite", "Rewrite the text", "How should it change? (e.g. friendlier, shorter, more premium)", (v) => `Rewrite the selected text layers: ${v}. Keep the meaning and fit the existing frame.`) });
    items.push({ label: "Fix spelling and grammar", run: run("Fix text", "Fix spelling and grammar in the selected text layers without changing the voice.") });
    items.push({ label: "Translate…", run: ask("Translate", "Translate the text", "Target language", (v) => `Translate the selected text layers into ${v}; keep formatting and make sure the text still fits.`) });
  }
  items.push({ label: "Generate image here…", run: ask("Generate image", "Generate an image", "What should the image show?", (v) => `Generate an image: ${v}. Place it sensibly on the page.`) });
  if (sel.length && app.studio === "pixel") {
    items.push({ label: "Edit with AI…", run: ask("Edit image", "Edit the selected layer with AI", "What should change?", (v) => `Use edit_image on the selected layer: ${v}${app.state?.pixelMask ? " (use the current selection as the mask)" : ""}.`) });
    items.push({ label: "Auto-enhance photo", run: run("Enhance", "Enhance the selected photo layer with non-destructive adjustment layers: balanced exposure, contrast, gentle color correction and a touch of sharpening.") });
  }
  items.push({ label: "Check contrast and accessibility", run: run("Accessibility check", "Check text contrast, text sizes and alignment on this page. Report problems and fix clear violations.", "answer") });
  return items;
}

const codeTarget = (app, c) => base(app, { kind: "code", path: c.path, fromLine: c.fromLine, toLine: c.toLine, label: `${String(c.path).split("/").pop()}:${c.fromLine}${c.toLine !== c.fromLine ? `-${c.toLine}` : ""}` });
const codeExtra = (c) => `File: ${c.path}\nSelected lines ${c.fromLine}-${c.toLine}:\n\`\`\`\n${clip(c.text, 8000)}\n\`\`\``;

/** Menu items for text selected in the code editor. */
export function codeAiItems(app, getContext) {
  if (!app.prefs.aiEnabled) return [];
  const run = (label, prompt, mode) => () => {
    const c = getContext();
    runQuickAction(app, { label, prompt, mode, target: codeTarget(app, c), extra: codeExtra(c) });
  };
  const ask = (label, title, field, build) => async () => {
    const c = getContext();
    const v = await promptDialog({ title, label: field, ok: "Go" });
    if (v) runQuickAction(app, { label, prompt: build(v), target: codeTarget(app, c), extra: codeExtra(c) });
  };
  return [
    custom(app, () => codeTarget(app, getContext()), () => codeExtra(getContext())),
    "-",
    { label: "Explain this code", run: run("Explain code", "Explain the selected code in plain language, then note any bugs or risks.", "answer") },
    { label: "Fix problems", run: run("Fix problems", "Find and fix problems in the selected code (use check_problems for context). Edit the file with edit_file.") },
    { label: "Refactor…", run: ask("Refactor", "Refactor the selection", "What should improve?", (v) => `Refactor the selected code: ${v}. Edit the file with edit_file and keep behavior unless asked.`) },
    { label: "Add comments", run: run("Add comments", "Add concise, useful comments to the selected code with edit_file; do not change behavior.") },
    { label: "Generate code here…", run: ask("Generate code", "Generate code", "Describe what to add", (v) => `Write code for: ${v}. Insert it at the end of the selected lines in the file with edit_file.`) },
  ];
}

/** Menu items for the Office word processor (selected text, or the whole document without a selection). */
export function officeAiItems(app, getContext) {
  if (!app.prefs.aiEnabled) return [];
  const target = () => {
    const c = getContext();
    const sel = c.hasSelection && c.text.trim();
    return base(app, { kind: sel ? "office-text" : "office-document", label: sel ? `“${c.text.trim().slice(0, 24)}${c.text.trim().length > 24 ? "…" : ""}”` : app.doc?.name || "Document" });
  };
  const extra = () => {
    const c = getContext();
    return c.hasSelection && c.text.trim() ? `Selected text in the Office document:\n"""\n${clip(c.text, 8000)}\n"""\nChange only this text: use office_replace_text with the exact original sentences as \`find\`.` : "No text is selected: work on the whole document (read it with office_read_document first).";
  };
  const run = (label, prompt, mode) => () => runQuickAction(app, { label, prompt, mode, target: target(), extra: extra() });
  const ask = (label, title, field, build) => async () => {
    const tg = target();
    const ex = extra();
    const v = await promptDialog({ title, label: field, ok: "Go" });
    if (v) runQuickAction(app, { label, prompt: build(v), target: tg, extra: ex });
  };
  return [
    custom(app, target, extra),
    "-",
    { label: "Improve writing", run: run("Improve writing", "Improve the writing: clearer, more concise and better flow. Keep the meaning, the language and the formatting.") },
    { label: "Fix spelling and grammar", run: run("Fix grammar", "Fix spelling, grammar and punctuation without changing the voice or the meaning.") },
    { label: "Summarize", run: run("Summarize", "Summarize the text in a few bullet points. Do not change the document.", "answer") },
    { label: "Translate…", run: ask("Translate", "Translate", "Target language", (v) => `Translate the text into ${v}. Keep headings, lists and formatting.`) },
    { label: "Change tone…", run: ask("Change tone", "Change the tone", "New tone (for example formal, friendly, persuasive)", (v) => `Rewrite the text in a ${v} tone. Keep facts, names and numbers.`) },
  ];
}

const colName = (c) => {
  let s = "";
  for (c += 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
};

/** The selection of a Spreadsheet / Presentation / Whiteboard surface as a chat target plus a context line. */
export function officeAppTarget(app, kind, data = {}) {
  const v = data.view || app.officeUI;
  if (kind === "office-sheet" && v?.range) {
    const g = v.range;
    const ref = `${colName(g.c0)}${g.r0 + 1}${g.r0 === g.r1 && g.c0 === g.c1 ? "" : `:${colName(g.c1)}${g.r1 + 1}`}`;
    const name = v.sheet?.name || "";
    return { target: base(app, { kind: "office-cells", sheet: v.sid, range: { ...g }, label: `${name ? `${name}!` : ""}${ref}` }), extra: `Selected cell range: ${name ? `sheet “${name}”, ` : ""}${ref}. Read it with sheet_read_range before changing it.` };
  }
  if (kind === "office-slides" && v?.deck) {
    const ids = [...(v.sel || [])].slice(0, 50);
    const n = (v.deck.slides.findIndex((s) => s.id === v.cur) ?? 0) + 1;
    return { target: base(app, { kind: "office-slides", slide: v.cur, ids, label: ids.length ? `slide ${n}, ${ids.length} object${ids.length === 1 ? "" : "s"}` : `slide ${n}` }), extra: `Current slide: ${n}${ids.length ? `; selected object ids: ${ids.join(", ")}` : ""}. Call slides_describe first.` };
  }
  if (kind === "office-board") {
    const b = data.board || app.officeUI;
    const ids = (b?.selection || []).slice(0, 50);
    if (!ids.length && data.element) ids.push(data.element);
    return { target: base(app, { kind: "office-board", ids, label: ids.length ? `${ids.length} element${ids.length === 1 ? "" : "s"}` : "board" }), extra: ids.length ? `Selected whiteboard element ids: ${ids.join(", ")}. Call board_describe first.` : "Nothing is selected: the target is the current board page. Call board_describe first." };
  }
  return { target: base(app, { kind: "office-document", label: app.doc?.name || "Document" }), extra: "" };
}

/** Menu items for the Spreadsheet, Presentation and Whiteboard surfaces (kind = "office-sheet" | …). */
export function officeAppAiItems(app, kind, data) {
  if (!app.prefs.aiEnabled) return [];
  const ctx = () => officeAppTarget(app, kind, data);
  const run = (label, prompt, mode) => () => {
    const c = ctx();
    runQuickAction(app, { label, prompt, mode, target: c.target, extra: c.extra });
  };
  const items = [custom(app, () => ctx().target, () => ctx().extra), "-", { label: "Explain", run: run("Explain", "Explain the selection: what it contains and what stands out.", "answer") }];
  if (kind === "office-sheet") items.push({ label: "Clean up data", run: run("Clean up", "Clean up the selected cells: trim spaces, unify formats and fix obvious typos; keep formulas.") }, { label: "Add a chart", run: run("Chart", "Add a fitting chart for the selected data with sheet_add_chart.") });
  if (kind === "office-slides") items.push({ label: "Improve this slide", run: run("Improve slide", "Improve the current slide: clearer wording, better hierarchy and balanced layout.") });
  if (kind === "office-board") items.push({ label: "Tidy up", run: run("Tidy up", "Arrange the selection (or the page) neatly with board_arrange and align related elements.") });
  return items;
}

/** Menu items for an element selected in the website designer. */
export function elementAiItems(app, ws) {
  if (!app.prefs.aiEnabled) return [];
  const el = ws.current?.();
  const id = el?.el?.id;
  if (id == null) return [];
  const target = () => base(app, { kind: "element", elementId: id, page: ws.page, label: `<${el.el.tag || "element"}>` });
  const extra = `Website element id ${id} on page ${ws.page}. Call get_page_outline to see current ids.`;
  const ask = (label, title, field, build) => async () => {
    const tg = target();
    const v = await promptDialog({ title, label: field, ok: "Go" });
    if (v) runQuickAction(app, { label, prompt: build(v), target: tg, extra });
  };
  const run = (label, prompt) => () => runQuickAction(app, { label, prompt, target: target(), extra });
  return [
    custom(app, target, () => extra),
    "-",
    { label: "Improve copy", run: run("Improve copy", "Improve the text inside this element: clearer, more engaging, same meaning and length.") },
    { label: "Make responsive", run: run("Make responsive", "Make this element look good on tablet and mobile: add set_element_style rules for the tablet, mobile-landscape and mobile-portrait breakpoints and verify with inspect_element.") },
    { label: "Restyle…", run: ask("Restyle", "Restyle this element", "Describe the new look", (v) => `Restyle this element: ${v}. Use classes and set_element_style.`) },
    { label: "Add hover and focus states", run: run("Hover states", "Add tasteful hover and focus-visible states with transitions to this element and its interactive children.") },
  ];
}

/** Primer of "Help > Ask about OpenFini" chats: answers come from the lazy openfini-* knowledge pack. */
export const OPENFINI_PRIMER = "This chat is about OpenFini itself. Before answering, load the matching OpenFini knowledge skill with use_skill (openfini-overview, openfini-studios, openfini-formats, openfini-ofini-format, openfini-how-to, openfini-shortcuts, openfini-settings, openfini-extensions, openfini-collaboration, openfini-security-privacy, openfini-troubleshooting, openfini-licensing; about-the-developer for who made it) and answer from it. Do not change documents unless the user asks.";

/** Help > Ask about OpenFini: a new Vibe chat primed with the OpenFini knowledge pack. */
export async function askAboutOpenFini(app) {
  await vibeStore.load();
  if (!ready(app)) return null;
  const { getVibeHub } = await import("./hub.js");
  const hub = getVibeHub(app);
  const s = hub.create();
  s.chat.title = "Ask about OpenFini";
  s.chat.source = "help";
  s.chat.primer = OPENFINI_PRIMER;
  app.setStudio("vibe");
  hub.activate(s.id);
  return s;
}
