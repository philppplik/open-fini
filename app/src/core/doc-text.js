// Reads the text of a document page by page (reading order: top to bottom, then left to right). Pure: no DOM.
import { plainText } from "../engine/layout/text-model.js";
import { walk, worldMatrix } from "./nodes.js";

const LINE_SEP = String.fromCharCode(0x2028); // forced line break inside a paragraph

/** @returns {{index: number, name: string, width: number, height: number, text: string, blocks: number}[]} */
export function documentPagesText(doc, { pages = null, maxChars = 200000 } = {}) {
  const out = [];
  let budget = maxChars;
  doc.pages.forEach((page, index) => {
    if (pages && !pages.includes(index + 1)) return;
    const found = [];
    walk(page.root, (n) => {
      if (n.type !== "text" || !n.storyId || n.visible === false) return;
      const story = doc.stories[n.storyId]?.story;
      if (!story) return;
      const text = plainText(story).split(LINE_SEP).join("\n").trim();
      if (!text) return;
      let m;
      try {
        m = worldMatrix(n);
      } catch {
        m = n.m;
      }
      found.push({ x: m[4], y: m[5], text });
    });
    found.sort((a, b) => (Math.abs(a.y - b.y) < 6 ? a.x - b.x : a.y - b.y));
    let text = found.map((f) => f.text).join("\n\n");
    if (text.length > budget) text = `${text.slice(0, Math.max(0, budget))}\n[truncated]`;
    budget -= text.length;
    out.push({ index: index + 1, name: page.name, width: Math.round(page.w), height: Math.round(page.h), text, blocks: found.length });
  });
  return out;
}
