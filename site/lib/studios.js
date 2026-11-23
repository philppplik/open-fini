// The studios in header order (app/src/studios), plus Proto, which is planned (docs/concepts/proto-studio.md).
// Copy lives in site/content/studios/<id>.<lang>.md; screenshots come from scripts/site-shots.mjs.

/** @type {{ id: string, icon: string, docs: string|null, planned?: string }[]} */
export const STUDIOS = [
  { id: "vector", icon: "s-vector", docs: "Vector-Studio" },
  { id: "pixel", icon: "s-pixel", docs: "Pixel-Studio" },
  { id: "layout", icon: "s-layout", docs: "Layout-Studio" },
  { id: "code", icon: "s-code", docs: "Code-Studio" },
  { id: "vibe", icon: "s-vibe", docs: "Vibe-Studio" },
  { id: "office", icon: "s-office", docs: "Office-Studio" },
  { id: "scene", icon: "s-scene", docs: "Scene-Studio" },
  { id: "proto", icon: "bounding-box", docs: null, planned: "1.3.x" },
];

export const SHIPPED = STUDIOS.filter((s) => !s.planned);
