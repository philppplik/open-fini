// Settings sidebar model: sections are shown under group headings. Pure (no DOM), unit tested.

import { N_ } from "../i18n/index.js";

/** Group headings in display order; `ids` are the section ids each one holds. */
export const NAV_GROUPS = [
  { id: "app", title: N_("App"), ids: ["general", "appearance", "accessibility", "shortcuts", "onboarding", "defaults", "profiles"] },
  { id: "studios", title: N_("Studios and tools"), ids: ["studios", "canvas", "code", "toolbox", "layout"] },
  { id: "ai", title: N_("AI"), ids: ["ai"] },
  { id: "privacy", title: N_("Collaboration and privacy"), ids: ["collab", "security"] },
  { id: "advanced", title: N_("Advanced"), ids: ["extensions", "troubleshooting", "about"] },
];

/**
 * Splits `sections` into [{ id, title, sections }] following NAV_GROUPS. A section that no group knows (added by an
 * extension) lands in "Advanced". Empty groups are dropped, so a search shows only the headings that still have rows.
 */
export function groupSections(sections) {
  const known = new Set(NAV_GROUPS.flatMap((g) => g.ids));
  return NAV_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    sections: [...g.ids.map((id) => sections.find((s) => s.id === id)).filter(Boolean), ...(g.id === "advanced" ? sections.filter((s) => !known.has(s.id)) : [])],
  })).filter((g) => g.sections.length);
}
