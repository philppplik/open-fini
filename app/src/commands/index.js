// Registers every command with the app.
import { registerEditCommands } from "./edit.js";
import { registerFileCommands } from "./file.js";
import { registerPixelCommands } from "./pixel.js";
import { registerLayoutCommands } from "./layout.js";
import { registerCodeCommands } from "./code.js";
import { installAnts } from "../studios/tools/pixel-select.js";

export function registerCommands(app) {
  registerEditCommands(app);
  registerFileCommands(app);
  registerPixelCommands(app);
  registerLayoutCommands(app);
  registerCodeCommands(app);
  installAnts(app);
  app.emit("commands");
}
