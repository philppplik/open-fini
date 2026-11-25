// Frame presets of the Proto Studio (Frame tool, Insert ▸ Frame, the start screen): common device sizes in CSS pixels.
import { N_ } from "../../i18n/index.js";

export const FRAME_PRESETS = Object.freeze({
  desktop: { name: N_("Desktop"), w: 1440, h: 1024 },
  laptop: { name: N_("Laptop"), w: 1280, h: 832 },
  tablet: { name: N_("Tablet"), w: 834, h: 1194 },
  phone: { name: N_("Phone"), w: 390, h: 844 },
  android: { name: N_("Android phone"), w: 360, h: 800 },
  watch: { name: N_("Watch"), w: 198, h: 242 },
});
