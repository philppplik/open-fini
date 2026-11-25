// Which documents can be shared live ("Edit together", docs/collaboration.md ▸ What can be shared live). Tiny and
// pure: the share commands (start-up code) ask it without loading the live-editing module.
//
//   liveKindOf(doc) → "tree" | "text" | "office" | null   null = shared as a copy (snapshot) only
//   canShareLive(doc) → boolean
// Vector, Pixel (layers and bitmaps) and Layout documents are "tree", Code projects and one-file text documents
// "text", the Office Suite apps, Scene Studio documents and Proto designs "office" (keyed records through their collabAdapter).
// Office kinds an extension registers without a collabAdapter stay copy-only (ui/collab/live.js checks the adapter).

/** Office kinds whose app ships a collaboration adapter. */
export const LIVE_OFFICE_KINDS = Object.freeze(["document", "sheet", "slides", "board", "scene", "proto"]);

export function liveKindOf(doc) {
  if (!doc) return null;
  if (doc.web) return "text";
  if (doc.office) return LIVE_OFFICE_KINDS.includes(doc.office.kind || "document") ? "office" : null;
  return "tree";
}

export const canShareLive = (doc) => liveKindOf(doc) !== null;
