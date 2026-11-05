// Lazy skill packs: the catalog rows ship with the AI runtime, the bodies load on first use (dynamic import).
// tests/ai/skill-packs.test.js keeps these rows equal to the frontmatter of the pack modules.
//
//   PACK_SKILLS            catalog rows { name, pack, description, studios? }
//   loadPack(pack)         -> Promise<string[]> SKILL.md strings of that pack
//   GUIDE_FOR_STUDIO       studio id -> guide skill name

const G = "guides";
const K = "knowledge";
export const PACK_SKILLS = [
  ["studio-guide-vector", G, "How to work in the Vector studio: start, tool order, coordinates, ids, undo and verification."],
  ["studio-guide-pixel", G, "How to work in the Pixel studio: non-destructive adjustments, selections, native photo edits and how to check them."],
  ["studio-guide-layout", G, "How to work in the Layout studio: pages, text frames, tables, charts, print units and verification."],
  ["studio-guide-code", G, "How to work in the Code studio: files, the live preview, element ids, breakpoints and checks."],
  ["studio-guide-document", G, "How to work with Office text documents: blocks, styles, find/replace, page setup and export."],
  ["studio-guide-sheet", G, "How to work with spreadsheets: ranges, formulas, formats, charts and checking computed values."],
  ["studio-guide-slides", G, "How to work with presentations: layouts, placeholders, themes, notes and checking each slide."],
  ["studio-guide-board", G, "How to work on the whiteboard: elements, connectors, frames, arrange and checking the layout."],
  ["studio-guide-vibe", G, "How Vibe itself works: skills, sub-agents, plan_work orchestration, blackboard, approvals and verification."],
  ["openfini-overview", K, "What OpenFini is: idea, philosophy and the big picture, for questions like what is OpenFini or why does it exist."],
  ["openfini-studios", K, "What each OpenFini studio includes and when to use which."],
  ["openfini-formats", K, "Which file types OpenFini opens, imports and exports (generated from the format registries)."],
  ["openfini-ofini-format", K, "The technical .ofini document format: ZIP layout, document.json, versions and how to inspect or repair a file."],
  ["openfini-how-to", K, "Practical how-tos for common OpenFini tasks (open, save, export, undo, recover, share, use the assistant)."],
  ["openfini-shortcuts", K, "Default keyboard shortcuts of OpenFini (generated from the command registry)."],
  ["openfini-settings", K, "Map of the Settings dialog: which section controls what, and how to change settings with the assistant."],
  ["openfini-extensions", K, "Extensions and the SDK: installing .ofext packages, permissions, VS Code extensions and writing your own."],
  ["openfini-collaboration", K, "Collaboration: encrypted rooms, chat, comments, live editing (beta), versions and what is not live."],
  ["openfini-security-privacy", K, "The security and privacy model: local-first data, network use, keys, offline mode, app lock, protected mode and logs."],
  ["openfini-troubleshooting", K, "Troubleshooting OpenFini: common problems, safe mode, reset, logs and how to report an issue."],
  ["openfini-licensing", K, "Licensing and credits: the MIT license, third-party components, clean-room policy and how to contribute."],
].map(([name, pack, description]) => ({ name, pack, description }));

export const GUIDE_FOR_STUDIO = { vector: "studio-guide-vector", pixel: "studio-guide-pixel", layout: "studio-guide-layout", code: "studio-guide-code", document: "studio-guide-document", office: "studio-guide-document", sheet: "studio-guide-sheet", slides: "studio-guide-slides", board: "studio-guide-board", vibe: "studio-guide-vibe" };

/** @param {"guides"|"knowledge"} pack */
export async function loadPack(pack) {
  if (pack === G) return (await import("./studio-guides.js")).STUDIO_GUIDES;
  if (pack === K) return (await import("./openfini-knowledge.js")).KNOWLEDGE_SKILLS;
  throw new Error(`Unknown skill pack "${pack}".`);
}
