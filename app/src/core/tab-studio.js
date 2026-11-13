// Tab-to-studio memory (docs/studios.md "Switching studios with the tabs"). Pure: no DOM, no app imports, unit tested
// in tests/core/tab-studio.test.js.
//
// Every open document (tab) remembers the studio it was last used in, in `doc.tabStudio`. Activating the tab brings
// that studio back (App.activateDoc); choosing a studio by hand while the tab is active updates the memory, but only
// when that studio can edit the document (canEditIn). A tab without a memory uses its natural studio.

/** Studios that edit the canvas (pages and layers) of an ordinary document. */
const CANVAS = ["vector", "pixel", "layout"];

/** True when `doc` is a Scene Studio document (the generic project container with kind "scene"). */
const isScene = (doc) => doc?.office?.kind === "scene";

/**
 * The studio a document opens in when nothing was remembered: Office and Scene documents in their studio, a website
 * project without design content in Code, otherwise the studio the document was created in (Vector by default).
 */
export function naturalStudio(doc) {
  if (!doc) return null;
  if (isScene(doc)) return "scene";
  if (doc.office) return "office";
  if (doc.web && (doc.studio === "code" || !doc.pages?.[0]?.root?.children?.length)) return "code";
  return CANVAS.includes(doc.studio) ? doc.studio : "vector";
}

/** The studios that can actually edit `doc` (Vibe works across documents and is never remembered for a tab). */
export function editableStudios(doc) {
  if (!doc) return [];
  if (isScene(doc)) return ["scene"];
  if (doc.office) return ["office"];
  return doc.web ? [...CANVAS, "code"] : [...CANVAS];
}

export const canEditIn = (studio, doc) => editableStudios(doc).includes(studio);

/** The studio to show for `doc`: the remembered one while it can still edit the document, else the natural one. */
export function tabStudio(doc) {
  if (!doc) return null;
  const remembered = doc.tabStudio;
  return typeof remembered === "string" && canEditIn(remembered, doc) ? remembered : naturalStudio(doc);
}

/**
 * Remembers `studio` for `doc` when that studio can edit it. Returns true when the memory changed.
 * A studio that cannot edit the document (Vibe, Code for a photo, an extension studio) leaves the memory alone.
 */
export function rememberStudio(doc, studio) {
  if (!doc || !canEditIn(studio, doc) || doc.tabStudio === studio) return false;
  doc.tabStudio = studio;
  return true;
}

/**
 * Which studio activating `doc` should switch to, or null to stay. Vibe Studio is a workspace across documents: the
 * tabs choose what the assistant works on there and Vibe stays open (its tools read tabStudio(doc) instead).
 * @param {{ doc: object|null, current: string, enabled?: boolean, known?: (id: string) => boolean }} o
 */
export function studioToFollow({ doc, current, enabled = true, known = () => true }) {
  if (!enabled || !doc || current === "vibe") return null;
  const target = tabStudio(doc);
  return target && target !== current && known(target) ? target : null;
}

/** Restores a remembered studio read from a session or a pop-out envelope (unknown values are dropped). */
export function restoreTabStudio(doc, value) {
  if (doc && typeof value === "string" && canEditIn(value, doc)) doc.tabStudio = value;
  return doc;
}
