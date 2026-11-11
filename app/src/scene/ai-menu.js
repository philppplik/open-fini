// Right-click ▸ AI in the Scene Studio (docs/scene-studio.md ▸ Assistant): marks the viewer and the timeline as context
// menu targets and registers one provider that offers the assistant actions of vibe/quick-actions.js ▸ sceneAiItems
// (describe the moment, animate the selection, captions, tighten, vertical version, summary).
import { markContext, registerContextProvider } from "../ui/context-menu/index.js";

let registered = false;

/** Marks `viewer` and `timeline` (elements) and registers the AI provider once. */
export function installSceneAiMenu(viewer, timeline) {
  markContext(viewer, "scene-viewer", {});
  markContext(timeline, "scene-timeline", {});
  if (registered) return;
  registered = true;
  registerContextProvider({
    id: "scene.ai",
    priority: -20,
    matches: (c) => (c.kind === "scene-viewer" || c.kind === "scene-timeline") && !!c.app.prefs.aiEnabled,
    items: (c) => {
      const ai = c.app.aiQuick?.sceneAiItems?.(c.app) || [];
      return ai.length ? [{ label: "AI", icon: "stars", items: ai }] : [];
    },
  });
}
