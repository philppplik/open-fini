// Vibe Studio ▸ Skills: the skill library (built-in, yours, from extensions) with search, tag filters, source badges,
// usage stats, a SKILL.md editor with live preview and validation, import/export (.skill.md and .skillpack zip
// bundles), "Create from this chat" and a test run with the offline Demo provider.
// Skill format: docs/vibe-skills.md. Parsing/validation/rendering: ai/skills.js (pure).
import { h, empty } from "../../core/util.js";
import { vibeStore } from "../../vibe/store.js";
import { BUILTIN_SKILL_LIST, parseSkill, serializeSkill, validateSkill, renderSkill } from "../../ai/index.js";
import { TOOL_GROUPS } from "../../vibe/tools/index.js";
import { renderMarkdown } from "./markdown.js";
import { pickFiles } from "../code/import.js";
import { confirmDialog } from "../dialogs.js";
import { iconEl } from "../toolbox.js";
import { platform } from "../../platform/index.js";

const TOOL_NAMES = Object.values(TOOL_GROUPS).flat();
const NEW_SKILL = `---
name: my-skill
description: One sentence - what the skill does and when Vibe should use it.
version: 0.1.0
tags: [vector]
allowed-tools: get_document_info, query_layers, add_shape, add_text, set_style, screenshot
params:
  - "topic: What the design is about"
  - "tone: Mood or voice (default: friendly)"
when-to-use: words people use when they want this
---
# My skill

## Workflow
1. Look first: describe_page (cheap) instead of list_layers.
2. Build {{topic}} in a {{tone}} tone with run_plan so it takes one turn.
3. Name every layer.

## Rules
- Margins at least 64 px. Two typefaces at most.

## Verify
Call screenshot and fix overlaps, clipped text and low contrast before you finish.
`;

const fmtDate = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function createSkillsPanel(vs) {
  const { app } = vs;
  const el = h("div.of-vskills");
  let query = "";
  let tag = "";
  let extSkills = [];
  app.extensions?.vibeSkills().then((list) => {
    extSkills = list.map((s) => ({ ...s, source: "extension" }));
    if (el.isConnected && !el.querySelector(".of-vform")) render();
  }).catch(() => {});

  const userSkills = () => vibeStore.skills.map((s) => ({ ...parseSkill(serializeSkill(s)), files: s.files, enabled: s.enabled !== false, draft: !!s.draft, source: "user" }));
  const allSkills = () => [...userSkills(), ...extSkills, ...BUILTIN_SKILL_LIST.map((s) => ({ ...s, source: "builtin" }))];

  function matches(s) {
    if (tag && !(s.tags || []).includes(tag)) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return [s.name, s.description, (s.tags || []).join(" "), s.whenToUse].join(" ").toLowerCase().includes(q);
  }

  function row(s) {
    const stats = vibeStore.skillStats?.[s.name];
    const badges = [h("span.of-badge", { class: s.draft ? "draft" : s.source }, s.draft ? "draft" : s.source === "builtin" ? "built-in" : s.source === "user" ? "yours" : `extension${s.origin?.name ? `: ${s.origin.name}` : ""}`)];
    if (s.version) badges.push(h("span.of-badge", `v${s.version}`));
    if (s.enforceTools) badges.push(h("span.of-badge", { title: "Only its allowed tools can be used while it is active" }, "restricted"));
    const meta = [stats ? `used ${stats.uses}× · last ${fmtDate(stats.last)}` : "not used yet", s.params?.length ? `args: ${s.params.map((p) => p.name + (p.required ? "" : "?")).join(", ")}` : "", s.requires?.length ? `includes ${s.requires.join(", ")}` : "", s.tags?.length ? s.tags.join(" · ") : ""].filter(Boolean).join(" · ");
    const actions = h("div.of-vskill__actions",
      h("button.of-btn", { type: "button", title: "Start this skill in the chat", onclick: () => use(s) }, "Use"),
      h("button.of-btn", { type: "button", title: "Run this skill in a new chat with the offline Demo provider", onclick: () => testRun(s) }, "Test"),
      s.source === "user" ? h("button.of-btn", { type: "button", onclick: () => edit(s) }, "Edit") : h("button.of-btn", { type: "button", title: "Make an editable copy in “Your skills”", onclick: () => edit({ ...s, source: "user" }, true) }, "Customize"),
      h("button.of-btn", { type: "button", "aria-label": `Export ${s.name} as .skill.md`, title: "Export as .skill.md", onclick: () => exportOne(s) }, iconEl("download")),
    );
    if (s.source === "user") {
      const sw = h("sl-switch", { size: "small", "aria-label": `Enable ${s.name}` });
      sw.checked = s.enabled;
      sw.addEventListener("sl-change", () => vibeStore.saveSkills(vibeStore.skills.map((x) => (x.name === s.name ? { ...x, enabled: sw.checked, draft: false } : x))));
      actions.append(sw);
    }
    return h("div.of-vskill", h("div", h("div.of-vskill__name", h("code", s.name), ...badges), h("small", s.description), h("small.of-vskill__meta", meta)), actions);
  }

  function render() {
    empty(el);
    const search = h("input.of-side__search", { type: "search", placeholder: "Search skills…", "aria-label": "Search skills", value: query });
    search.addEventListener("input", () => {
      query = search.value.trim();
      paintLists();
    });
    search.addEventListener("keydown", (e) => e.stopPropagation());
    el.append(
      h("p.of-vlead", "Skills are instruction packs Vibe loads only when a task needs them. Type / in the chat, or let Vibe suggest one."),
      h("div.of-vskills__bar", search,
        h("button.of-btn", { type: "button", onclick: () => edit(null) }, iconEl("plus-lg"), "New"),
        h("button.of-btn", { type: "button", onclick: importFiles, title: "Import .md, .skill.md or .skillpack files" }, iconEl("upload"), "Import"),
        h("button.of-btn", { type: "button", onclick: exportPack, title: "Export your skills as a .skillpack bundle" }, iconEl("download"), "Export pack"),
        h("button.of-btn", { type: "button", onclick: fromChat, title: "Vibe distills what it did in the open chat into a draft skill" }, iconEl("mortarboard"), "Create from this chat"),
      ),
    );
    const tags = [...new Set(allSkills().flatMap((s) => s.tags || []))].sort();
    const tagRow = h("div.of-vskills__tags", { role: "group", "aria-label": "Filter by tag" });
    for (const t of tags) {
      const b = h("button.of-vskills__tag", { type: "button", "aria-pressed": String(tag === t) }, t);
      b.addEventListener("click", () => {
        tag = tag === t ? "" : t;
        render();
      });
      tagRow.append(b);
    }
    if (tags.length) el.append(tagRow);
    const lists = h("div");
    el.append(lists);
    function paintLists() {
      empty(lists);
      const groups = [["Your skills", userSkills()], ["From extensions", extSkills], ["Built in", BUILTIN_SKILL_LIST.map((s) => ({ ...s, source: "builtin" }))]];
      for (const [title, list] of groups) {
        const shown = list.filter(matches);
        if (!shown.length && title !== "Your skills") continue;
        const card = h("div.of-vcard", h("strong", `${title} (${shown.length})`));
        if (!shown.length) card.append(h("div.of-empty", query || tag ? "No matches." : "No skills of your own yet. Click New, import a .skill.md, or use “Create from this chat”."));
        for (const s of shown) card.append(row(s));
        lists.append(card);
      }
    }
    paintLists();
  }

  // ---- actions
  function use(s) {
    vs.openTab?.("canvas");
    if (vs.chat?.useSkill) vs.chat.useSkill(s, "").then(() => vs.chat.focus());
    else vs.chat.setInput(`/${s.name} `);
  }
  async function testRun(s) {
    const session = vs.hub.newChat();
    session.setOverrides({ model: "demo", activeProvider: null });
    const args = Object.fromEntries((s.params || []).map((p) => [p.name, p.default ?? `sample ${p.name}`]));
    const msg = s.params?.length ? `Use the “${s.name}” skill with args ${JSON.stringify(args)}.` : `Use the “${s.name}” skill.`;
    try {
      await session.send(msg);
    } catch (err) {
      app.toast(err.message, "danger", 4000);
    }
  }
  function fromChat() {
    if (!vs.session.chat.messages.length) return app.toast("Open a chat in which Vibe did the work you want to keep, then try again.", "warning", 3500);
    vs.chat.setInput("Distill the workflow you performed in this chat into a reusable skill: call create_skill with a concrete numbered workflow (exact tools and arguments that worked), rules with numbers, {{param}} placeholders for what changes between uses (declare them in params), token-saving tips and a ## Verify section. Keep it under 120 lines.");
  }
  async function download(name, bytes, mime, ext) {
    try {
      await platform.saveFile({ suggestedName: name, bytes, mime, filters: [{ name: ext, extensions: [ext] }] });
    } catch (err) {
      if (err?.name !== "AbortError") app.toast(err.message || "Could not save the file.", "danger", 3000);
    }
  }
  function exportOne(s) {
    const text = serializeSkill(s);
    download(`${s.name}.skill.md`, new TextEncoder().encode(text), "text/markdown", "md");
  }
  async function exportPack() {
    const mine = vibeStore.skills;
    if (!mine.length) return app.toast("You have no skills of your own to export yet.", "warning", 2500);
    const { zipSync, strToU8 } = await import("../../../vendor/fflate/fflate.js");
    const files = { "skillpack.json": strToU8(JSON.stringify({ format: "openfini-skillpack", version: 1, skills: mine.map((s) => s.name) }, null, 2)) };
    for (const s of mine) {
      files[`${s.name}/SKILL.md`] = strToU8(serializeSkill(s));
      for (const [f, text] of Object.entries(s.files || {})) files[`${s.name}/${f}`] = strToU8(text);
    }
    download("my-skills.skillpack", zipSync(files), "application/zip", "skillpack");
  }
  async function saveImported(list) {
    let n = 0;
    const next = [...vibeStore.skills];
    for (const { text, files, from } of list) {
      const { errors, skill } = validateSkill(text, { toolNames: TOOL_NAMES });
      if (errors.length) {
        app.toast(`${from}: ${errors[0]}`, "warning", 5000);
        continue;
      }
      const i = next.findIndex((x) => x.name === skill.name);
      const rec = { ...skill, ...(files && Object.keys(files).length ? { files } : {}), enabled: true };
      if (i >= 0) next[i] = rec;
      else next.push(rec);
      n++;
    }
    if (n) await vibeStore.saveSkills(next);
    if (n) app.toast(`Imported ${n} skill${n === 1 ? "" : "s"}.`, "success", 2000);
    render();
  }
  async function importFiles() {
    const picked = await pickFiles({ accept: ".md,.markdown,.txt,.skillpack,.zip" });
    const list = [];
    for (const f of picked) {
      if (/\.(skillpack|zip)$/i.test(f.name)) {
        try {
          const { unzipSync, strFromU8 } = await import("../../../vendor/fflate/fflate.js");
          const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
          const dirs = new Map();
          for (const [path, bytes] of Object.entries(entries)) {
            const m = /^([^/]+)\/(.+)$/.exec(path);
            if (!m || bytes.length > 400_000) continue;
            const d = dirs.get(m[1]) || { files: {} };
            if (m[2] === "SKILL.md") d.text = strFromU8(bytes);
            else if (/\.(md|txt|json|csv)$/i.test(m[2])) d.files[m[2]] = strFromU8(bytes);
            dirs.set(m[1], d);
          }
          for (const [dir, d] of dirs) if (d.text) list.push({ text: d.text, files: d.files, from: `${f.name}/${dir}` });
          if (!dirs.size) app.toast(`${f.name} contains no skills (expected <name>/SKILL.md entries).`, "warning", 4000);
        } catch (err) {
          app.toast(`${f.name}: ${err.message}`, "danger", 4000);
        }
      } else list.push({ text: await f.text(), from: f.name });
    }
    if (list.length) saveImported(list);
  }

  function edit(s, copy = false) {
    const src = s ? serializeSkill(copy ? { ...s, meta: { ...(s.meta || {}), version: s.version || "1.0.0" } } : s) : NEW_SKILL;
    const text = h("textarea.of-vfield__in.mono", { rows: 20, spellcheck: false, "aria-label": "SKILL.md source" }, src);
    text.addEventListener("keydown", (e) => e.stopPropagation());
    const preview = h("div.of-skilledit__preview", { "aria-label": "Preview with default arguments" });
    const issues = h("ul.of-skilledit__issues", { "aria-live": "polite" });
    const saveBtn = h("button.of-btn.of-btn--primary", { type: "button" }, "Save");
    let timer = 0;
    const check = () => {
      const all = allSkills();
      const { errors, warnings, skill } = validateSkill(text.value, { toolNames: TOOL_NAMES, skillNames: all.map((x) => x.name) });
      empty(issues);
      for (const e of errors) issues.append(h("li.err", e));
      for (const w of warnings) issues.append(h("li.warn", w));
      if (!errors.length && !warnings.length) issues.append(h("li", "Looks good."));
      saveBtn.disabled = errors.length > 0;
      const args = Object.fromEntries((skill.params || []).map((p) => [p.name, p.default ?? `‹${p.name}›`]));
      preview.replaceChildren(renderMarkdown(renderSkill({ ...skill, files: s?.files }, { args, all }).text));
      return { errors, skill };
    };
    text.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(check, 200);
    });
    saveBtn.addEventListener("click", async () => {
      const { errors, skill } = check();
      if (errors.length) return;
      const oldName = copy ? null : s?.name;
      await vibeStore.saveSkills([...vibeStore.skills.filter((x) => x.name !== skill.name && x.name !== oldName), { ...skill, ...(s?.files ? { files: s.files } : {}), enabled: true }]);
      render();
    });
    const del = s && !copy && s.source === "user" ? h("button.of-btn", { type: "button", onclick: async () => { if (await confirmDialog({ title: "Delete skill", message: `Delete “${s.name}”?`, ok: "Delete", danger: true })) { await vibeStore.saveSkills(vibeStore.skills.filter((x) => x.name !== s.name)); render(); } } }, "Delete") : null;
    el.replaceChildren(h("div.of-vform", h("strong", s ? (copy ? `Customize ${s.name}` : `Edit ${s.name}`) : "New skill"), h("p.of-hint", "Format: docs/vibe-skills.md. Placeholders: {{param}} and $ARGUMENTS. The preview fills in default arguments."), h("div.of-skilledit", text, preview, issues), h("div.of-vrow", saveBtn, h("button.of-btn", { type: "button", onclick: render }, "Cancel"), del)));
    check();
    text.focus();
  }

  vibeStore.on("change", (g) => (g === "skills" || g === "skillStats") && el.isConnected && !el.querySelector(".of-vform") && render());
  vs.hub?.on("skill-draft", () => el.isConnected && !el.querySelector(".of-vform") && render());
  render();
  return { el, show: () => !el.querySelector(".of-vform") && render() };
}
