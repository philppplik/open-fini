// Undo/redo history. An entry is a list of reversible ops: {undo(), redo()} plus an
// approximate byte cost so pixel-heavy histories can be capped on low-memory devices.
import { Emitter } from "./util.js";

export class History extends Emitter {
  /** @param {{limitBytes?:number, limitEntries?:number}} [o] */
  constructor({ limitBytes = 96 * 1024 * 1024, limitEntries = 200 } = {}) {
    super();
    this.entries = [];
    this.index = 0; // number of applied entries
    this.limitBytes = limitBytes;
    this.limitEntries = limitEntries;
    this.bytes = 0;
    // Optional ambient tag stamped on every entry pushed while it is set (e.g. { chat, run } of the Vibe chat that
    // holds the document write lock). Entries with different tags never coalesce. See docs/adr/0008-vibe-hub.md.
    this.tag = null;
  }

  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index < this.entries.length;
  }

  /** Adds an already-applied entry. A `key` merges consecutive entries (slider drags etc.). */
  push(entry) {
    // drop the redo tail
    for (let i = this.entries.length - 1; i >= this.index; i--) this.bytes -= this.entries[i].bytes || 0;
    this.entries.length = this.index;
    const last = this.entries[this.entries.length - 1];
    const now = Date.now();
    if (entry.tag === undefined && this.tag) entry.tag = this.tag;
    if (entry.key && last && last.key === entry.key && now - last.time < 1200 && (last.tag || null) === (entry.tag || null)) {
      last.ops.push(...entry.ops);
      if (entry.touched && last.touched) for (const n of entry.touched) last.touched.add(n);
      last.structure = last.structure || entry.structure;
      last.meta = last.meta || entry.meta;
      last.bytes = (last.bytes || 0) + (entry.bytes || 0);
      this.bytes += entry.bytes || 0;
      last.time = now;
    } else {
      entry.time = now;
      this.entries.push(entry);
      this.index = this.entries.length;
      this.bytes += entry.bytes || 0;
    }
    this.#trim();
    this.emit("change", this);
  }

  #trim() {
    while (this.entries.length > 1 && (this.entries.length > this.limitEntries || this.bytes > this.limitBytes)) {
      const e = this.entries.shift();
      this.bytes -= e.bytes || 0;
      this.index = Math.max(0, this.index - 1);
    }
  }

  undo() {
    if (!this.canUndo) return null;
    const e = this.entries[--this.index];
    for (let i = e.ops.length - 1; i >= 0; i--) e.ops[i].undo();
    this.emit("change", this);
    return e;
  }

  redo() {
    if (!this.canRedo) return null;
    const e = this.entries[this.index++];
    for (const op of e.ops) op.redo();
    this.emit("change", this);
    return e;
  }

  clear() {
    this.entries = [];
    this.index = 0;
    this.bytes = 0;
    this.emit("change", this);
  }

  /** Jumps to a state: `index` entries applied. */
  goto(index) {
    while (this.index > index && this.canUndo) this.undo();
    while (this.index < index && this.canRedo) this.redo();
  }
}
