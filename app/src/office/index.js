// Office Suite entry: registers the built-in Office app manifests (office/apps.js) exactly once. Everything that needs
// the list of apps (launcher, file routing, Vibe tools, collaboration) imports this module first, lazily.
//
// Adding an app = one import line below plus one entry in BUILTIN (docs/office-suite.md ▸ How to add an app). The
// lines are kept apart on purpose so parallel branches that each add one app merge without conflicts.
import { registerOfficeApp, officeApp } from "./apps.js";
import { DOCUMENT_APP } from "./document/manifest.js";

import { SHEET_APP } from "./sheet/manifest.js";

import { SLIDES_APP } from "./slides/manifest.js";

// Whiteboard app: import { BOARD_APP } from "./board/manifest.js";

const BUILTIN = [
  DOCUMENT_APP,

  SHEET_APP,

  SLIDES_APP,

  // BOARD_APP,
];

for (const m of BUILTIN) if (!officeApp(m.kind)) registerOfficeApp(m);

export * from "./apps.js";
