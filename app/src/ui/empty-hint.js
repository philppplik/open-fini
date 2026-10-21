// Empty-state hint for panels: an icon, a one-line title and a sentence of guidance. Hidden when the user turned off
// "Show hints in empty panels" (Settings ▸ Onboarding and help); a plain short line remains.
import { h } from "../core/util.js";

export function emptyHint(app, { icon = "info-circle", title, text, plain = title }) {
  if (app?.prefs?.contextHints === false) return h("div.of-empty", plain);
  return h("div.of-empty.of-emptyhint", h("sl-icon", { name: icon }), h("strong", title), text ? h("span", text) : null);
}
