// Aggregates additional tool classes (text, gradient/fill, pixel, layout, export).
// Each entry is an array of Tool subclasses; they are registered with the app at startup.
import { TextTool, FrameTextTool } from "./tools/text.js";
import { GradientTool, FillTool } from "./tools/paint.js";
import { PIXEL_SELECT_TOOLS } from "./tools/pixel-select.js";
import { PIXEL_PAINT_TOOLS } from "./tools/pixel-paint.js";
import { PIXEL_RETOUCH_TOOLS } from "./tools/pixel-retouch.js";
import { PIXEL_MISC_TOOLS } from "./tools/pixel-misc.js";
import { LAYOUT_TOOLS } from "./tools/layout.js";

export const TOOL_SETS = [[TextTool, FrameTextTool, GradientTool, FillTool], PIXEL_SELECT_TOOLS, PIXEL_PAINT_TOOLS, PIXEL_RETOUCH_TOOLS, PIXEL_MISC_TOOLS, LAYOUT_TOOLS];
