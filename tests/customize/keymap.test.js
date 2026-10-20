import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChord, parseChord, chordFromEvent, formatChord, isSingleKeyChord, eventKey } from "../../app/src/customize/chords.js";
import { buildEntries, effective, conflictsFor, allConflicts, setChords, resetChords, validateOverrides, filterEntries, KEYMAP_PRESETS, presetOverrides, parseKeymap, exportKeymap } from "../../app/src/customize/keymap.js";

const entries = () => buildEntries({
  commands: [
    { id: "edit.undo", label: "Undo", shortcut: "Mod+Z" },
    { id: "edit.redo", label: "Redo", shortcut: "Mod+Shift+Z", altShortcut: "Mod+Y" },
    { id: "edit.duplicate", label: "Duplicate", shortcut: "Mod+J" },
    { id: "code.duplicateElement", label: "Duplicate element", shortcut: "Mod+J", studios: ["code"] },
    { id: "file.save", label: "Save", shortcut: "Mod+S" },
  ],
  tools: [{ id: "tool.select.brush", label: "Brush", shortcut: "B", studios: ["pixel"] }, { id: "tool.select.rect", label: "Rectangle", shortcut: "B", studios: ["pixel"] }],
});

test("chords normalize and validate", () => {
  assert.equal(normalizeChord("ctrl+shift+z"), "Mod+Shift+Z");
  assert.equal(normalizeChord("Shift+Alt+F"), "Alt+Shift+F");
  assert.equal(normalizeChord("Mod++"), "Mod++");
  assert.equal(normalizeChord("esc"), "Escape");
  assert.equal(normalizeChord("f5"), "F5");
  for (const bad of ["", "Mod", "Mod+", "Ctrl+Shift", "Foo+A", "Mod+Nope", 5, null, "a".repeat(50)]) assert.equal(normalizeChord(bad), null, String(bad));
  assert.deepEqual(parseChord("Mod+Alt+1"), { mod: true, alt: true, shift: false, key: "1" });
  assert.ok(isSingleKeyChord("B") && isSingleKeyChord("F2") && !isSingleKeyChord("Mod+B"));
});

test("chords from events", () => {
  assert.equal(chordFromEvent({ key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true }), "Mod+Shift+Z");
  assert.equal(chordFromEvent({ key: "z", code: "KeyZ", metaKey: true }, true), "Mod+Z");
  assert.equal(chordFromEvent({ key: "Control", ctrlKey: true }), null);
  assert.equal(chordFromEvent({ key: "!", code: "Digit1", shiftKey: true, ctrlKey: true }), "Mod+Shift+1");
  assert.equal(chordFromEvent({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true }), "Mod+Shift+]");
  assert.equal(chordFromEvent({ key: "z", code: "KeyZ", ctrlKey: true }, true), null);
  assert.equal(eventKey({ key: " ", code: "Space" }), "Space");
  assert.equal(formatChord("Mod+Shift+Z"), "Ctrl+Shift+Z");
  assert.equal(formatChord("Mod+Shift+Z", true), "⌘⇧Z");
});

test("effective, conflicts and scopes", () => {
  const e = entries();
  assert.deepEqual(effective(e.find((x) => x.id === "edit.redo"), {}), ["Mod+Shift+Z", "Mod+Y"]);
  // the same chord in different studios (design vs code) is not a conflict
  assert.deepEqual(conflictsFor(e, {}, "edit.duplicate", "Mod+J"), []);
  assert.deepEqual(conflictsFor(e, {}, "edit.undo", "Mod+S").map((x) => x.id), ["file.save"]);
  // tools sharing a key cycle: no conflict
  assert.deepEqual(conflictsFor(e, {}, "tool.select.brush", "B"), []);
  assert.equal(allConflicts(e, {}).length, 0);
});

test("setChords: unassign, swap, keep, validation", () => {
  const e = entries();
  let r = setChords(e, {}, "edit.undo", ["Mod+S"], { conflict: "unassign" });
  assert.deepEqual(r.overrides, { "edit.undo": ["Mod+S"], "file.save": [] });
  assert.deepEqual(r.affected, ["file.save"]);
  r = setChords(e, {}, "edit.undo", ["Mod+S"], { conflict: "swap" });
  assert.deepEqual(r.overrides, { "edit.undo": ["Mod+S"], "file.save": ["Mod+Z"] });
  r = setChords(e, {}, "edit.undo", ["Mod+S"], { conflict: "keep" });
  assert.equal(allConflicts(e, r.overrides).length, 1);
  // setting the default removes the override
  assert.deepEqual(setChords(e, { "edit.undo": ["Mod+Q"] }, "edit.undo", ["Mod+Z"]).overrides, {});
  assert.ok(setChords(e, {}, "edit.undo", ["nope"]).error);
  assert.ok(setChords(e, {}, "edit.undo", ["Mod+1", "Mod+2", "Mod+3"]).error);
  assert.ok(setChords(e, {}, "tool.select.brush", ["Mod+B"]).error);
  assert.ok(setChords(e, {}, "missing", ["Mod+B"]).error);
  assert.deepEqual(resetChords(e, { a: ["F1"], b: [] }, "a"), { b: [] });
});

test("validateOverrides is strict", () => {
  assert.equal(validateOverrides({ "edit.undo": ["ctrl+q"] }).overrides["edit.undo"][0], "Mod+Q");
  for (const bad of [[], "x", { "bad id!": ["F1"] }, { a: "F1" }, { a: ["Mod"] }, { a: ["F1", "F2", "F3"] }]) assert.equal(validateOverrides(bad).ok, false);
  assert.equal(validateOverrides(JSON.parse('{"__proto__": ["F1"]}')).ok, false);
});

test("filter, presets and keymap files", () => {
  const e = entries();
  assert.deepEqual(filterEntries(e, {}, { query: "redo" }).map((x) => x.id), ["edit.redo"]);
  assert.deepEqual(filterEntries(e, {}, { query: "ctrl y" }).map((x) => x.id), ["edit.redo"]);
  assert.ok(filterEntries(e, {}, { studio: "code" }).every((x) => !x.studios || x.studios.includes("code")));
  assert.equal(filterEntries(e, { "edit.undo": ["F9"] }, { changed: true }).length, 1);
  for (const p of KEYMAP_PRESETS) {
    assert.ok(validateOverrides(p.shortcuts).ok, p.id);
    assert.ok(!/photoshop|illustrator|vs ?code|adobe|microsoft/i.test(`${p.name} ${p.description}`), p.id);
  }
  assert.deepEqual(KEYMAP_PRESETS.map((p) => p.name), ["Default", "Classic", "Compact", "Editor-style"]);
  assert.deepEqual(presetOverrides("default"), {});
  assert.deepEqual(presetOverrides("classic", e), { "edit.redo": ["Mod+Y", "Mod+Shift+Z"], "edit.duplicate": ["Mod+D"] });
  const round = parseKeymap(exportKeymap({ "edit.undo": ["F9"] }));
  assert.deepEqual(round.overrides, { "edit.undo": ["F9"] });
  assert.equal(parseKeymap("{nope").ok, false);
  assert.equal(parseKeymap('{"format":"other"}').ok, false);
});
