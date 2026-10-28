// Which top-level menus the menubar shows. Pure (no DOM) so it can be unit-tested.
//
// Public API: MINIMAL_MENUS, isMinimalMenubar(state), menuVisible(entry, state)
// Invariant: the start page (no document open, not the Vibe studio) shows only the menus in MINIMAL_MENUS; as soon as a
// document opens the normal per-studio menus come back. Studio filters (`entry.studios`) still apply, so the "View" of
// the current studio is the one that shows. Office Suite menus may carry `officeKinds`: they show only while an app of
// one of those kinds is mounted (state.officeKind, null on the Office launcher).

/** English source labels of the menus that stay on the start page (the menubar keeps its own order). */
export const MINIMAL_MENUS = Object.freeze(["File", "View", "Studio", "Help"]);

/** True when the start page is showing: no active document and the studio is not Vibe (which has no documents). */
export function isMinimalMenubar({ doc, studio }) {
  return !doc && studio !== "vibe";
}

/**
 * @param {{label:string, studios?:string[], officeKinds?:string[]}} entry a MENUS entry
 * @param {{doc:any, studio:string, officeKind?:string|null}} state
 */
export function menuVisible(entry, state) {
  if (entry.studios && !entry.studios.includes(state.studio)) return false;
  if (entry.officeKinds && !entry.officeKinds.includes(state.officeKind)) return false;
  if (isMinimalMenubar(state) && !MINIMAL_MENUS.includes(entry.label)) return false;
  return true;
}
