// Registers every command with the app.
import { registerEditCommands } from "./edit.js";
import { registerStudioCommands } from "./studios.js";
import { registerFileCommands } from "./file.js";
import { registerPdfCommands } from "./pdf.js";
import { registerPixelCommands } from "./pixel.js";
import { registerLayoutCommands } from "./layout.js";
import { registerDataCommands } from "./data.js";
import { registerCodeCommands } from "./code.js";
import { registerVibeCommands } from "./vibe.js";
import { registerOnboardingCommands } from "./onboarding.js";
import { registerHistogramCommands } from "./histogram.js";
import { registerExtensionCommands } from "./extensions.js";
import { registerTextToolCommands } from "./text-tools.js";
import { installAnts } from "../studios/tools/pixel-select.js";

export function registerCommands(app) {
  registerEditCommands(app);
  registerStudioCommands(app);
  registerFileCommands(app);
  registerPdfCommands(app);
  registerPixelCommands(app);
  registerLayoutCommands(app);
  registerDataCommands(app);
  registerCodeCommands(app);
  registerTextToolCommands(app);
  registerVibeCommands(app);
  registerOnboardingCommands(app);
  registerHistogramCommands(app);
  registerExtensionCommands(app);
  installAnts(app);
  app.emit("commands");
}
