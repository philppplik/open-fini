// Right-click AI functions: small, focused assistant runs started from context menus of the canvas, the code
// editor and the website designer. They use the same tools, permissions and undo as Vibe Studio.
import { h } from "../core/util.js";
import { vibeStore } from "./store.js";
import { openDialog, promptDialog, confirmDialog } from "../ui/dialogs.js";

let bar = null;

/** Every quick action runs in its own hidden chat of the Vibe hub, so several can run next to Vibe chats. */
async function getSession(app) {
  const { getVibeHub } = await import("./hub.js");
  await vibeStore.load();
  const session = getVibeHub(app).create({ hidden: true });
  session.on("approval", async (req) => req.resolve(await confirmDialog({ title: "Allow this action?", message: req.reason || `Vibe wants to use “${req.name}”.`, ok: "Allow" })));
  session.on("ask", async (q) => q.resolve((await promptDialog({ title: "Vibe asks", label: q.question, ok: "Answer" })) || ""));
  return session;
}

function selectionHint(app) {
  const sel = app.selection || [];
  if (!sel.length) return "No layers are selected.";
  return `Selected layer ids: ${sel.map((n) => `${n.id} (${n.type}${n.name ? `, “${n.name}”` : ""})`).join(", ")}.`;
}

function undoBar(app, s, label) {
  bar?.remove();
  bar = h("div.of-aibar", h("span", `AI: ${label}`), h("button.of-btn", { type: "button", onclick: () => { const n = s.undoLastRun(); app.toast(n ? `Undid ${n} change${n === 1 ? "" : "s"}.` : s.lastUndoError || "Nothing to undo.", n ? "success" : "warning", n ? 1500 : 5000); bar.remove(); } }, "Undo"), h("button.of-btn", { type: "button", "aria-label": "Dismiss", onclick: () => bar.remove() }, "×"));
  document.body.append(bar);
  setTimeout(() => bar?.remove(), 12000);
}

function ready(app) {
  if (!app.prefs.aiEnabled) {
    app.toast("AI features are off. Turn them on in Settings ▸ Artificial intelligence.", "warning", 4000);
    return false;
  }
  if (!vibeStore.settings.activeProvider && vibeStore.settings.model !== "demo") {
    app.toast("Connect a model first: Settings ▸ Artificial intelligence ▸ Models.", "warning", 4000);
    app.setStudio("vibe");
    return false;
  }
  return true;
}

/**
 * Runs an assistant request.
 * @param {object} o { label, prompt, mode: "apply"|"answer", studio? }
 */
export async function runQuickAction(app, { label, prompt, mode = "apply", extra = "" }) {
  if (!ready(app)) return;
  const s = await getSession(app);
  s.label = label;
  let text = "";
  const off = s.on("event", (ev) => {
    if (ev.type === "text") text += ev.delta;
  });
  try {
    await s.send(`${prompt}\n\n${extra}\n\nContext: ${selectionHint(app)} Work directly with the tools; keep changes focused on what was asked; reply with at most two sentences when done.`.trim());
  } catch (err) {
    app.toast(err.message || "The AI request failed.", "danger", 5000);
    return;
  } finally {
    off();
    setTimeout(() => s.hub.remove(s.id), 15000); // keep it for the undo bar, then forget the hidden chat
  }
  if (mode === "answer") {
    const { renderMarkdown } = await import("../ui/vibe/markdown.js");
    openDialog({ title: label, body: h("div.of-aianswer", renderMarkdown(text || "No answer.")), width: 620, buttons: [{ label: "Close", variant: "primary", onClick: (c) => c() }] });
  } else if (s.runs.length) undoBar(app, s, label);
  else app.toast(text.slice(0, 160) || "Vibe made no changes.", "primary", 3500);
}

/** Menu items for the canvas context menu (selection aware). */
export function canvasAiItems(app) {
  if (!app.prefs.aiEnabled) return [];
  const sel = app.selection || [];
  const hasText = sel.some((n) => n.type === "text");
  const run = (label, prompt, mode) => () => runQuickAction(app, { label, prompt, mode });
  const ask = (label, title, field, build) => async () => {
    const v = await promptDialog({ title, label: field, ok: "Go" });
    if (v) runQuickAction(app, { label, prompt: build(v) });
  };
  const items = [];
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

/** Menu items for text selected in the code editor. */
export function codeAiItems(app, getContext) {
  if (!app.prefs.aiEnabled) return [];
  const run = (label, prompt, mode) => () => {
    const c = getContext();
    runQuickAction(app, { label, prompt, mode, extra: `File: ${c.path}\nSelected lines ${c.fromLine}-${c.toLine}:\n\`\`\`\n${c.text.slice(0, 6000)}\n\`\`\`` });
  };
  const ask = (label, title, field, build) => async () => {
    const v = await promptDialog({ title, label: field, ok: "Go" });
    if (!v) return;
    const c = getContext();
    runQuickAction(app, { label, prompt: build(v), extra: `File: ${c.path}\nSelected lines ${c.fromLine}-${c.toLine}:\n\`\`\`\n${c.text.slice(0, 6000)}\n\`\`\`` });
  };
  return [
    { label: "Explain this code", run: run("Explain code", "Explain the selected code in plain language, then note any bugs or risks.", "answer") },
    { label: "Fix problems", run: run("Fix problems", "Find and fix problems in the selected code (use check_problems for context). Edit the file with edit_file.") },
    { label: "Refactor…", run: ask("Refactor", "Refactor the selection", "What should improve?", (v) => `Refactor the selected code: ${v}. Edit the file with edit_file and keep behavior unless asked.`) },
    { label: "Add comments", run: run("Add comments", "Add concise, useful comments to the selected code with edit_file; do not change behavior.") },
    { label: "Generate code here…", run: ask("Generate code", "Generate code", "Describe what to add", (v) => `Write code for: ${v}. Insert it at the end of the selected lines in the file with edit_file.`) },
  ];
}

/** Menu items for the Office Studio editor (selected text, or the whole document without a selection). */
export function officeAiItems(app, getContext) {
  if (!app.prefs.aiEnabled) return [];
  const extra = () => {
    const c = getContext();
    return c.hasSelection && c.text.trim() ? `Selected text in the Office document:\n"""\n${c.text.slice(0, 8000)}\n"""\nChange only this text: use office_replace_text with the exact original sentences as \`find\`.` : "No text is selected: work on the whole document (read it with office_read_document first).";
  };
  const run = (label, prompt, mode) => () => runQuickAction(app, { label, prompt, mode, extra: extra() });
  const ask = (label, title, field, build) => async () => {
    const v = await promptDialog({ title, label: field, ok: "Go" });
    if (v) runQuickAction(app, { label, prompt: build(v), extra: extra() });
  };
  return [
    { label: "Improve writing", run: run("Improve writing", "Improve the writing: clearer, more concise and better flow. Keep the meaning, the language and the formatting.") },
    { label: "Fix spelling and grammar", run: run("Fix grammar", "Fix spelling, grammar and punctuation without changing the voice or the meaning.") },
    { label: "Summarize", run: run("Summarize", "Summarize the text in a few bullet points. Do not change the document.", "answer") },
    { label: "Translate…", run: ask("Translate", "Translate", "Target language", (v) => `Translate the text into ${v}. Keep headings, lists and formatting.`) },
    { label: "Change tone…", run: ask("Change tone", "Change the tone", "New tone (for example formal, friendly, persuasive)", (v) => `Rewrite the text in a ${v} tone. Keep facts, names and numbers.`) },
  ];
}

/** Menu items for an element selected in the website designer. */
export function elementAiItems(app, ws) {
  if (!app.prefs.aiEnabled) return [];
  const el = ws.current?.();
  const id = el?.el?.id;
  if (id == null) return [];
  const ask = (label, title, field, build) => async () => {
    const v = await promptDialog({ title, label: field, ok: "Go" });
    if (v) runQuickAction(app, { label, prompt: build(v), extra: `Website element id ${id} on page ${ws.page}. Call get_page_outline to see current ids.` });
  };
  const run = (label, prompt) => () => runQuickAction(app, { label, prompt, extra: `Website element id ${id} on page ${ws.page}. Call get_page_outline to see current ids.` });
  return [
    { label: "Improve copy", run: run("Improve copy", "Improve the text inside this element: clearer, more engaging, same meaning and length.") },
    { label: "Make responsive", run: run("Make responsive", "Make this element look good on tablet and mobile: add set_element_style rules for the tablet, mobile-landscape and mobile-portrait breakpoints and verify with inspect_element.") },
    { label: "Restyle…", run: ask("Restyle", "Restyle this element", "Describe the new look", (v) => `Restyle this element: ${v}. Use classes and set_element_style.`) },
    { label: "Add hover and focus states", run: run("Hover states", "Add tasteful hover and focus-visible states with transitions to this element and its interactive children.") },
  ];
}
