// Settings > Keyboard shortcuts: record a new shortcut for any command or tool, with conflict handling,
// search and filters, presets, and import / export. Logic lives in customize/keymap.js and customize/chords.js.
import { h, empty } from "../../core/util.js";
import { isMac } from "../../core/util.js";
import { platform } from "../../platform/index.js";
import { confirmDialog } from "../dialogs.js";
import { button } from "../controls.js";
import { iconEl } from "../toolbox.js";
import { chordFromEvent, formatChord } from "../../customize/chords.js";
import { effective, isOverridden, conflictsFor, allConflicts, filterEntries, parseKeymap, KEYMAP_PRESETS } from "../../customize/keymap.js";
import { STUDIOS } from "../../studios/index.js";

const fmt = (c) => formatChord(c, isMac);
const STUDIO_NAMES = { vector: "Vector", pixel: "Pixel", layout: "Layout", code: "Code", vibe: "Vibe" };

export function keyboardEditor(app) {
  const cz = app.customize;
  const state = { query: "", studio: "", changed: false, conflicts: false, recording: null, pending: null };
  let entries = cz.entries();

  const searchBox = h("input.of-set__search.of-kb__search", { type: "search", placeholder: "Search commands or keys", "aria-label": "Search shortcuts", spellcheck: false });
  const studioSel = h("select", { "aria-label": "Show shortcuts of studio" }, h("option", { value: "" }, "All studios"), ...Object.keys(STUDIOS).map((s) => h("option", { value: s }, `${STUDIO_NAMES[s] || s} studio`)));
  const changedCb = h("input", { type: "checkbox", id: "of-kb-changed" });
  const conflictCb = h("input", { type: "checkbox", id: "of-kb-conflicts" });
  const presetSel = h("select", { "aria-label": "Shortcut preset" }, ...KEYMAP_PRESETS.map((p) => h("option", { value: p.id }, p.name)), h("option", { value: "custom" }, "Custom"));
  const presetNote = h("span.of-set__hint");
  const status = h("div.of-kb__status", { role: "status", "aria-live": "polite" });
  const list = h("div.of-kb__list");

  function syncPreset() {
    const cur = app.prefs.shortcutPreset || "default";
    presetSel.value = KEYMAP_PRESETS.some((p) => p.id === cur) ? cur : "custom";
    presetNote.textContent = KEYMAP_PRESETS.find((p) => p.id === presetSel.value)?.description || "Your own bindings.";
  }

  function say(msg) {
    status.textContent = msg;
  }

  function commit(entry, slot, chord, conflict) {
    const cur = effective(entry, cz.shortcutOverrides).slice();
    if (chord === null) cur.splice(slot, 1);
    else if (slot >= cur.length) cur.push(chord);
    else cur[slot] = chord;
    const r = cz.setShortcut(entry.id, cur, { conflict });
    if (r.error) {
      say(r.error);
      return false;
    }
    say(chord === null ? `${entry.label}: shortcut removed.` : `${entry.label}: ${fmt(chord)}${r.affected.length ? ` (changed ${r.affected.length} other command${r.affected.length > 1 ? "s" : ""})` : ""}`);
    return true;
  }

  function attempt(entry, slot, chord) {
    const others = conflictsFor(entries, cz.shortcutOverrides, entry.id, chord);
    if (!others.length) {
      state.pending = null;
      commit(entry, slot, chord, "keep");
      render();
      return;
    }
    state.pending = { entry, slot, chord, others };
    render();
  }

  function conflictBar() {
    const p = state.pending;
    const names = p.others.map((o) => o.label).join(", ");
    const act = (mode) => {
      state.pending = null;
      if (mode) commit(p.entry, p.slot, p.chord, mode);
      render();
    };
    return h(
      "div.of-kb__conflict",
      { role: "alert" },
      h("span", iconEl("exclamation-triangle"), ` ${fmt(p.chord)} is already used by ${names}.`),
      h("span.of-kb__conflict-actions", button("Swap", () => act("swap")), button("Unassign the other", () => act("unassign")), button("Use for both", () => act("keep")), button("Cancel", () => act(null))),
    );
  }

  function chordButton(entry, slot, chord) {
    const rec = state.recording && state.recording.id === entry.id && state.recording.slot === slot;
    const label = rec ? "Press keys… (Esc cancels, Backspace clears)" : chord ? fmt(chord) : slot === 0 ? "Not assigned" : "Add alternate";
    const b = h("button.of-kb__chord", { type: "button", class: `${chord ? "" : "empty"} ${rec ? "recording" : ""}`, "aria-label": `${slot === 0 ? "Shortcut" : "Alternate shortcut"} for ${entry.label}: ${chord ? fmt(chord) : "none"}. Press Enter to change.` }, label);
    b.addEventListener("click", () => {
      state.recording = { id: entry.id, slot };
      state.pending = null;
      render();
      list.querySelector(".of-kb__chord.recording")?.focus();
    });
    if (rec) {
      b.addEventListener("keydown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          state.recording = null;
          render();
          return;
        }
        if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          state.recording = null;
          if (chord) commit(entry, slot, null, "keep");
          render();
          return;
        }
        const c = chordFromEvent(e, isMac);
        if (!c) return; // only modifiers so far
        state.recording = null;
        if (entry.singleKey && /^(Mod|Alt|Shift)\+/.test(c)) {
          say("Tool shortcuts are a single key without modifiers (for example B or F2).");
          render();
          return;
        }
        if (c === chord) return render();
        attempt(entry, slot, c);
      });
      b.addEventListener("blur", () => {
        if (state.recording && state.recording.id === entry.id && state.recording.slot === slot) {
          state.recording = null;
          render();
        }
      });
    }
    return b;
  }

  function render() {
    const top = list.scrollTop;
    empty(list);
    entries = cz.entries();
    const shown = filterEntries(entries, cz.shortcutOverrides, state);
    const clash = new Map();
    for (const c of allConflicts(entries, cz.shortcutOverrides)) for (const e of c.entries) clash.set(e.id, c.entries.filter((x) => x !== e).map((x) => x.label).join(", "));
    if (state.pending) list.append(conflictBar());
    if (!shown.length) list.append(h("div.of-set__empty", "No shortcuts match."));
    let group = null;
    for (const e of shown) {
      if (e.group !== group) {
        group = e.group;
        list.append(h("h3.of-kb__group", group));
      }
      const eff = effective(e, cz.shortcutOverrides);
      const scope = e.studios ? e.studios.map((s) => STUDIO_NAMES[s] || s).join(", ") : "";
      const warn = clash.get(e.id);
      const row = h(
        "div.of-kb__row",
        { class: warn ? "conflict" : "" },
        h("div.of-kb__name", h("span", e.label), scope ? h("small", scope) : null, warn ? h("small.of-kb__warn", `Shares a key with ${warn}`) : null),
        h("div.of-kb__chords", chordButton(e, 0, eff[0]), e.singleKey ? null : chordButton(e, 1, eff[1])),
        isOverridden(e, cz.shortcutOverrides) ? h("button.of-set__reset", { type: "button", title: "Reset to default", "aria-label": `Reset shortcut of ${e.label} to default`, onclick: () => (cz.resetShortcut(e.id), say(`${e.label}: back to the default.`), render()) }, iconEl("arrow-counterclockwise")) : h("span.of-kb__nores"),
      );
      list.append(row);
    }
    list.scrollTop = top;
    syncPreset();
  }

  searchBox.addEventListener("input", () => ((state.query = searchBox.value), render()));
  searchBox.addEventListener("keydown", (e) => e.stopPropagation());
  studioSel.addEventListener("change", () => ((state.studio = studioSel.value), render()));
  changedCb.addEventListener("change", () => ((state.changed = changedCb.checked), render()));
  conflictCb.addEventListener("change", () => ((state.conflicts = conflictCb.checked), render()));
  presetSel.addEventListener("change", () => {
    if (presetSel.value === "custom") return;
    cz.applyShortcutPreset(presetSel.value);
    say(`Preset “${KEYMAP_PRESETS.find((p) => p.id === presetSel.value).name}” applied.`);
    render();
  });

  async function doExport() {
    const bytes = new TextEncoder().encode(cz.exportShortcuts());
    const r = await platform.saveFile({ suggestedName: "openfini-shortcuts.json", bytes, mime: "application/json", filters: [{ name: "Shortcut file", extensions: ["json"] }] });
    if (r) say(`Saved ${r.name}.`);
  }
  async function doImport() {
    const [file] = await platform.openFiles({ accept: [{ description: "Shortcut file", extensions: ["json"] }] });
    if (!file) return;
    const text = new TextDecoder().decode(file.bytes);
    const parsed = parseKeymap(text);
    if (!parsed.ok) {
      say(`Import failed: ${parsed.errors[0] || "the file is not a shortcut file."}`);
      return;
    }
    const n = Object.keys(parsed.overrides).length;
    const choice = await confirmDialog({ title: "Import shortcuts", message: `${file.name} contains ${n} shortcut${n === 1 ? "" : "s"}. Merge them with your current ones, or replace all of your customizations?`, ok: "Merge", extra: "Replace", cancel: "Cancel" });
    if (!choice) return;
    const r = cz.importShortcuts(text, { mode: choice === "extra" ? "replace" : "merge" });
    say(r.ok ? `Imported ${n} shortcut${n === 1 ? "" : "s"}.` : `Import failed: ${r.errors[0]}`);
    render();
  }

  const unsub = app.on("shortcuts", () => (document.body.contains(list) ? undefined : unsub()));
  render();
  return h(
    "div.of-kb",
    h("div.of-kb__bar", searchBox, studioSel, h("label.of-kb__check", changedCb, "Changed only"), h("label.of-kb__check", conflictCb, "Conflicts only")),
    h("div.of-kb__bar", h("span.of-kb__lbl", "Preset"), presetSel, presetNote, h("span.of-kb__spacer"), button("Import…", () => doImport().catch((e) => say(`Import failed: ${e.message}`))), button("Export…", () => doExport().catch((e) => say(`Export failed: ${e.message}`))), button("Reset all", async () => {
      if (await confirmDialog({ title: "Reset all shortcuts", message: "Restore every shortcut to its default?", ok: "Reset all", danger: true })) {
        cz.resetShortcuts();
        say("All shortcuts are back to their defaults.");
        render();
      }
    })),
    h("p.of-set__hint", "Click a shortcut, then press the new keys. Backspace clears it. Tools use one key without modifiers. Your browser or system may reserve some combinations (for example Ctrl+T or Ctrl+W in a browser tab); those cannot be captured."),
    status,
    list,
  );
}
