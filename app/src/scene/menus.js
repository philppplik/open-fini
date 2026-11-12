// Scene Studio context menus (docs/scene-studio.md ▸ Context menus): one provider for every scene target, with the
// item layout editors share (Premiere, Resolve and After Effects habits). The timeline and the viewer mark the
// right-clicked target (ui/context-menu ▸ markContext) with { ui, clip?, track?, path?, t }:
//   scene-clip, scene-key, scene-prop, scene-track, scene-space (empty track space), scene-ruler, scene-timeline
//   (below the tracks), scene-viewer.
// Labels are English source text, translated by the menu (ui/menus.js) and extracted by scripts/i18n-extract.mjs.
import { registerContextProvider } from "../ui/context-menu/index.js";
import { N_ } from "../i18n/index.js";
import { EASING_PRESETS } from "./keyframes.js";
import { EFFECTS } from "./effects.js";
import { TRANSITION_TYPES } from "./model.js";
import * as M from "./model.js";
import { EASE_LABEL, TRANS_LABEL } from "./inspector.js";
import { CLIP_ANIMATIONS } from "./motion.js";
import { ANIM_PRESET_LABEL } from "./browser.js";
import { LABEL_COLORS } from "./props.js";
import { parentCycle } from "./rig.js";



let installed = false;

export function installSceneMenus() {
  if (installed) return;
  installed = true;
  registerContextProvider({
    id: "scene.edit",
    priority: 60,
    matches: (c) => typeof c.kind === "string" && c.kind.startsWith("scene-") && !!c.data?.ui,
    items: (c) => {
      const ui = c.data.ui;
      switch (c.kind) {
        case "scene-clip":
          return clipItems(ui, c.data);
        case "scene-key":
          return keyItems(ui, c.data);
        case "scene-prop":
          return propItems(ui, c.data);
        case "scene-track":
          return trackItems(ui, c.data.track);
        case "scene-space":
          return spaceItems(ui, c.data);
        case "scene-ruler":
          return rulerItems(ui, c.data);
        case "scene-viewer":
          return viewerItems(ui);
        case "scene-timeline":
          return spaceItems(ui, c.data);
        default:
          return [];
      }
    },
  });
}

const effectItems = (ui, audio, ids) =>
  groups(Object.entries(EFFECTS).filter(([, d]) => (d.stage === "audio") === audio)).map(([g, list]) => ({ label: g, items: list.map(([type, d]) => ({ label: d.label, run: () => ui.addEffect(type, ids) })) }));

function groups(entries) {
  const out = new Map();
  for (const e of entries) {
    const g = e[1].group || "Other";
    if (!out.has(g)) out.set(g, []);
    out.get(g).push(e);
  }
  return [...out];
}

function clipItems(ui, data) {
  const m = ui.seqModel();
  const ids = ui.selection().length ? ui.selection() : [data.clip];
  const c = m.clips[data.clip];
  if (!c) return [];
  const one = ids.length === 1;
  const audio = ids.every((id) => m.clips[id]?.type === "audio");
  const timed = ids.some((id) => ["video", "comp"].includes(m.clips[id]?.type));
  const speedy = ids.some((id) => m.clips[id]?.speed !== undefined);
  const visual = ids.some((id) => m.clips[id] && m.clips[id].type !== "audio");
  const linked = ids.some((id) => m.clips[id]?.link);
  const inside = ui.state.t > c.start && ui.state.t < M.clipEnd(c);
  const sameKind = Object.values(m.media).filter((x) => c.media && x.id !== c.media && x.kind === m.media[c.media]?.kind);
  const parents = M.clipList(m).filter((p) => p.type !== "audio" && !ids.includes(p.id) && !ids.some((id) => parentCycle(m, id, p.id)));
  return [
    { label: "Cut", shortcut: "Mod+X", icon: "scissors", run: () => ui.cut() },
    { label: "Copy", shortcut: "Mod+C", icon: "copy", run: () => ui.copy() },
    { label: "Paste", shortcut: "Mod+V", icon: "clipboard", disabled: !ui.canPaste, run: () => ui.paste() },
    { label: "Duplicate", shortcut: "Mod+D", icon: "files", run: () => ui.duplicateSelection() },
    "-",
    { label: "Split at Playhead", shortcut: "Mod+K", icon: "layout-split", disabled: !inside, run: () => ui.splitAtPlayhead() },
    { label: "Trim Start to Playhead", shortcut: "Alt+[", disabled: !inside, run: () => ui.trimTo("start") },
    { label: "Trim End to Playhead", shortcut: "Alt+]", disabled: !inside, run: () => ui.trimTo("end") },
    { label: "Delete", shortcut: "Delete", icon: "trash", run: () => ui.deleteSelection() },
    { label: "Ripple Delete", shortcut: "Shift+Delete", run: () => ui.deleteSelection({ ripple: true }) },
    "-",
    {
      label: "Speed and Time",
      icon: "clock-history",
      items: [
        { label: "Speed / Duration…", shortcut: "Mod+R", disabled: !speedy, run: () => ui.speedDialog() },
        { label: "Reverse", disabled: !timed, run: () => ui.reverse() },
        { label: "Freeze Frame", disabled: !timed || !one, run: () => ui.freeze(c.id) },
        { label: "Time Remapping", disabled: !timed || !one, checked: c.remap !== undefined, run: () => ui.toggleRemap(c.id) },
      ],
    },
    {
      label: "Animate",
      icon: "magic",
      hidden: !visual,
      items: [
        { label: "In", items: CLIP_ANIMATIONS.filter((p) => !["ken-burns", "shake", "pulse", "float"].includes(p)).map((p) => ({ label: ANIM_PRESET_LABEL[p], run: () => ui.animate(p, "in") })) },
        { label: "Out", items: CLIP_ANIMATIONS.filter((p) => !["ken-burns", "shake", "pulse", "float"].includes(p)).map((p) => ({ label: ANIM_PRESET_LABEL[p], run: () => ui.animate(p, "out") })) },
        { label: "Continuous", items: ["ken-burns", "shake", "pulse", "float"].map((p) => ({ label: ANIM_PRESET_LABEL[p], run: () => ui.animate(p, "in") })) },
        "-",
        {
          label: "Behaviors",
          items: [
            { label: "Wiggle Position", run: () => ui.addBehavior("wiggle-position") },
            { label: "Wiggle Rotation", run: () => ui.addBehavior("wiggle-rotation") },
            { label: "Wiggle Scale", run: () => ui.addBehavior("wiggle-scale") },
            { label: "Loop Keyframes", run: () => ui.addBehavior("loop") },
            { label: "Ping-pong Keyframes", run: () => ui.addBehavior("pingpong") },
            { label: "Spin", run: () => ui.addBehavior("spin") },
          ],
        },
        { label: "Animate with Sound…", disabled: !one, run: () => ui.audioDialog(c.id) },
        { label: "Sequence Layers…", disabled: ids.length < 2, run: () => ui.staggerDialog() },
        { label: "Motion Blur", checked: ids.every((id) => m.clips[id]?.mblur), run: () => ui.toggleMotionBlur() },
        {
          label: "Parent To",
          disabled: !parents.length,
          items: [{ label: "None", checked: !c.parent, run: () => ui.setParent(null) }, "-", ...parents.map((p) => ({ label: p.name || p.type, checked: c.parent === p.id, run: () => ui.setParent(p.id) }))],
          dynamic: true,
        },
        "-",
        { label: "Show Keyframes", shortcut: "U", run: () => ui.toggleTwirl(ids) },
      ],
    },
    { label: "Add Markers at Beats", hidden: !c.media || c.type === "image", run: () => ui.beatMarkers(c.id) },
    { label: "Add Effect", icon: "stars", items: effectItems(ui, audio, ids) },
    {
      label: "Add Transition",
      icon: "intersect",
      hidden: !visual,
      items: [
        { label: "At Start", items: [...TRANSITION_TYPES.map((x) => ({ label: TRANS_LABEL[x], run: () => ui.addTransition("in", x) })), "-", { label: "None", run: () => ui.addTransition("in", null) }] },
        { label: "At End", items: [...TRANSITION_TYPES.map((x) => ({ label: TRANS_LABEL[x], run: () => ui.addTransition("out", x) })), "-", { label: "None", run: () => ui.addTransition("out", null) }] },
      ],
    },
    "-",
    { label: "Enabled", shortcut: "Shift+E", checked: !ids.every((id) => m.clips[id]?.off), run: () => ui.toggleEnabled() },
    { label: "Mute", checked: ids.every((id) => m.clips[id]?.muted), hidden: !ids.some((id) => m.clips[id]?.volume !== undefined), run: () => ui.toggleMute() },
    { label: linked && ids.length <= 2 ? N_("Unlink") : N_("Link"), shortcut: "Mod+L", disabled: ids.length < 2 && !linked, run: () => (linked && ids.every((id) => m.clips[id]?.link === m.clips[ids[0]].link) ? ui.unlink() : ui.link()) },
    { label: "Detach Audio", hidden: !(c.type === "video" && c.link), run: () => ui.unlink([c.id]) },
    { label: "Pre-compose", icon: "collection", run: () => ui.precompose() },
    { label: "Open Composition", hidden: c.type !== "comp", run: () => ui.openCompClip(c.id) },
    "-",
    { label: "Rename…", disabled: !one, run: () => ui.rename(c.id) },
    { label: "Replace Media", hidden: !c.media || !one, disabled: !sameKind.length, items: sameKind.map((x) => ({ label: x.name, run: () => ui.replaceMedia(c.id, x.id) })), dynamic: true },
    { label: "Label Color", items: [...LABEL_COLORS.map((x) => ({ label: x.label, icon: "circle", checked: c.label === x.color, run: () => ui.setLabel(x.color) })), "-", { label: "Default", run: () => ui.setLabel(null) }] },
    {
      label: "Arrange",
      hidden: !visual || !one,
      items: [
        { label: "Bring to Front", run: () => ui.arrange(2, c.id) },
        { label: "Bring Forward", run: () => ui.arrange(1, c.id) },
        { label: "Send Backward", run: () => ui.arrange(-1, c.id) },
        { label: "Send to Back", run: () => ui.arrange(-2, c.id) },
      ],
    },
    { label: "Set In and Out to Selection", run: () => ui.rangeToSelection() },
    { label: "Properties", icon: "sliders", run: () => ui.properties(c.id) },
  ];
}

const easeItems = (ui) => [
  { label: "Linear", run: () => ui.easeKeys("linear") },
  { label: "Easy Ease", shortcut: "F9", run: () => ui.easeKeys("easyEase") },
  { label: "Easy Ease In", shortcut: "Shift+F9", run: () => ui.easeKeys("easyEaseIn") },
  { label: "Easy Ease Out", shortcut: "Mod+Shift+F9", run: () => ui.easeKeys("easyEaseOut") },
  { label: "Hold", run: () => ui.easeKeys("hold") },
  "-",
  { label: "Easing Presets", items: EASING_PRESETS.filter((n) => !["linear", "easyEase", "easyEaseIn", "easyEaseOut", "hold"].includes(n)).map((n) => ({ label: EASE_LABEL[n], run: () => ui.easeKeys(n) })) },
];

function keyItems(ui, data) {
  const n = ui.state.keys.length;
  return [
    ...easeItems(ui),
    "-",
    { label: "Copy", shortcut: "Mod+C", icon: "copy", run: () => ui.copy() },
    { label: "Paste", shortcut: "Mod+V", icon: "clipboard", disabled: !ui.canPaste, run: () => ui.paste() },
    { label: "Delete", shortcut: "Delete", icon: "trash", run: () => ui.deleteKeys() },
    "-",
    { label: "Set Value…", disabled: n !== 1, run: () => ui.setKeyValue() },
    { label: "Reverse Keyframes", disabled: n < 2, run: () => ui.reverseKeys() },
    { label: "Select All Keyframes of This Property", run: () => ui.selectKeysOf(data.clip, data.path) },
    { label: "Go to Keyframe", run: () => ui.goToKey() },
    { label: "Open in the Graph Editor", icon: "bezier2", run: () => ui.openGraph(data.clip, data.path) },
  ];
}

function propItems(ui, data) {
  if (!data.path) return [];
  return [
    { label: "Add or Remove Keyframe at Playhead", run: () => ui.toggleKeyAt(data.clip, data.path) },
    { label: "Previous Keyframe", shortcut: "Shift+J", run: () => ui.goKeyframe(-1, { id: data.clip, path: data.path }) },
    { label: "Next Keyframe", shortcut: "Shift+K", run: () => ui.goKeyframe(1, { id: data.clip, path: data.path }) },
    { label: "Select All Keyframes", run: () => ui.selectKeysOf(data.clip, data.path) },
    { label: "Paste", shortcut: "Mod+V", disabled: !ui.canPaste, run: () => ui.paste() },
    { label: "Remove Animation", run: () => ui.toggleAnimation(data.clip, data.path) },
    "-",
    { label: "Open in the Graph Editor", icon: "bezier2", run: () => ui.openGraph(data.clip, data.path) },
  ];
}

function trackItems(ui, id) {
  const m = ui.seqModel();
  const tk = M.trackOf(m, id);
  if (!tk) return [];
  const same = m.tracks.filter((k) => k.kind === tk.kind);
  const i = same.indexOf(tk);
  const hgt = ui.state.heights?.[id] || null;
  return [
    { label: "Add Video Track Above", run: () => ui.addTrackAt("video", tk.kind === "video" ? id : null, true) },
    { label: "Add Video Track Below", run: () => ui.addTrackAt("video", tk.kind === "video" ? id : null, false) },
    { label: "Add Audio Track Above", run: () => ui.addTrackAt("audio", tk.kind === "audio" ? id : null, true) },
    { label: "Add Audio Track Below", run: () => ui.addTrackAt("audio", tk.kind === "audio" ? id : null, false) },
    "-",
    { label: "Rename…", run: () => ui.renameTrack(id) },
    { label: "Duplicate Track", run: () => ui.duplicateTrack(id) },
    { label: "Delete Track", icon: "trash", disabled: same.length <= 1, run: () => ui.deleteTrack(id) },
    { label: "Move Up", disabled: i <= 0, run: () => ui.moveTrack(id, -1) },
    { label: "Move Down", disabled: i >= same.length - 1, run: () => ui.moveTrack(id, 1) },
    "-",
    { label: "Lock", checked: !!tk.locked, run: () => ui.toggleTrack(id, "locked") },
    { label: tk.kind === "video" ? N_("Hide") : N_("Mute"), checked: tk.kind === "video" ? !!tk.hidden : !!tk.muted, run: () => ui.toggleTrack(id, tk.kind === "video" ? "hidden" : "muted") },
    { label: "Solo", checked: !!tk.solo, run: () => ui.toggleTrack(id, "solo") },
    {
      label: "Track Height",
      items: [
        { label: "Small", checked: hgt === 32, run: () => ui.setTrackHeight(id, 32) },
        { label: "Medium", checked: !hgt, run: () => ui.setTrackHeight(id, null) },
        { label: "Large", checked: hgt === 96, run: () => ui.setTrackHeight(id, 96) },
        { label: "Extra Large", checked: hgt === 140, run: () => ui.setTrackHeight(id, 140) },
      ],
    },
    "-",
    { label: "Select All Clips on Track", run: () => ui.selectTrack(id) },
  ];
}

function spaceItems(ui, data) {
  const tk = data.track ? M.trackOf(ui.seqModel(), data.track) : null;
  const gap = tk ? ui.gapAt(data.track, data.t) : null;
  const video = !tk || tk.kind === "video";
  return [
    { label: "Paste Here", shortcut: "Mod+V", icon: "clipboard", disabled: !ui.canPaste, run: () => ui.paste(data.t, data.track) },
    { label: "Ripple Delete Gap", disabled: !gap, run: () => ui.rippleDeleteGap(data.track, data.t) },
    { label: "Insert Gap…", run: () => ui.insertGap(data.t) },
    "-",
    { label: "Add Text Here", icon: "fonts", hidden: !video, run: () => ui.addLayerAt("text", data.t, data.track) },
    { label: "Add Shape Here", icon: "square", hidden: !video, run: () => ui.addLayerAt("shape", data.t, data.track) },
    { label: "Add Solid Here", icon: "palette", hidden: !video, run: () => ui.addLayerAt("solid", data.t, data.track) },
    { label: "Add Adjustment Layer Here", icon: "layers-half", hidden: !video, run: () => ui.addLayerAt("adjustment", data.t, data.track) },
    { label: "Add Null Object Here", icon: "plus-square-dotted", hidden: !video, run: () => ui.addLayerAt("null", data.t, data.track) },
    "-",
    { label: "Add Marker Here", icon: "bookmark-plus", run: () => ui.addMarkerAt(data.t) },
    { label: "Select All Clips on Track", hidden: !tk, run: () => ui.selectTrack(data.track) },
    { label: "Select All", shortcut: "Mod+A", run: () => ui.selectAll() },
  ];
}

function rulerItems(ui, data) {
  const m = ui.seqModel();
  const near = m.markers.find((k) => Math.abs(k.t - data.t) < 6 / ui.state.zoom);
  return [
    { label: "Add Marker Here", icon: "bookmark-plus", run: () => ui.addMarkerAt(data.t) },
    { label: "Rename Marker…", hidden: !near, run: () => ui.renameMarker(near.id) },
    { label: "Remove Marker", hidden: !near, run: () => ui.commitSeq("Remove Marker", M.removeMarker(ui.seqModel(), near.id)) },
    "-",
    { label: "Set In Point Here", disabled: ui.seq !== "main", run: () => ui.setInAt(data.t) },
    { label: "Set Out Point Here", disabled: ui.seq !== "main", run: () => ui.setOutAt(data.t) },
    { label: "Set In and Out to Selection", disabled: ui.seq !== "main" || !ui.selection().length, run: () => ui.rangeToSelection() },
    { label: "Clear In and Out", shortcut: "X", disabled: !m.range, run: () => ui.clearRange() },
    "-",
    { label: "Zoom to Fit", shortcut: "\\", run: () => ui.fit() },
  ];
}

function viewerItems(ui) {
  const id = ui.selection()[0];
  const c = id && ui.seqModel().clips[id];
  const g = ui.state.guides || {};
  const visual = c && c.type !== "audio";
  return [
    { label: "Bring to Front", disabled: !visual, run: () => ui.arrange(2, id) },
    { label: "Bring Forward", disabled: !visual, run: () => ui.arrange(1, id) },
    { label: "Send Backward", disabled: !visual, run: () => ui.arrange(-1, id) },
    { label: "Send to Back", disabled: !visual, run: () => ui.arrange(-2, id) },
    "-",
    { label: "Fit to Frame", disabled: !visual, run: () => ui.fitClip(id, "fit") },
    { label: "Fill Frame", disabled: !visual, run: () => ui.fitClip(id, "fill") },
    { label: "Reset Transform", disabled: !visual, run: () => ui.resetTransform(id) },
    { label: "Copy", shortcut: "Mod+C", disabled: !c, run: () => ui.copy() },
    { label: "Paste", shortcut: "Mod+V", disabled: !ui.canPaste, run: () => ui.paste() },
    "-",
    {
      label: "Guides",
      items: [
        { label: "Title and Action Safe", checked: !!g.safe, run: () => ui.toggleGuide("safe") },
        { label: "Rule of Thirds", checked: !!g.thirds, run: () => ui.toggleGuide("thirds") },
        { label: "Center Cross", checked: !!g.center, run: () => ui.toggleGuide("center") },
        { label: "Motion Path", checked: g.path !== false, run: () => ui.toggleGuide("path") },
      ],
    },
  ];
}
