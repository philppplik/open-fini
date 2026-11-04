// Platform info and the native window material (desktop app). Small: loaded at start-up by ui/glass-dom.js.
//
// Public API
//   osInfo()                         { os: "windows"|"macos"|"linux", desktop: boolean } (sync, from the user agent)
//   markOs(root)                     sets <html data-os="…" data-desktop> for platform-specific CSS
//   loadMaterials()                  Promise<string[]|null>: the materials the desktop shell supports (null in the browser)
//   materialsNow()                   the same once loaded, else null
//   applyMaterial(id)                asks the shell to switch the window material ("none" = opaque); no-op in the browser
//   MATERIALS                        every material id with its display name (pure data)
//   materialChoices(materials)       the picker options for the materials reported by the shell (pure)
//
// The Rust side is src-tauri/src/effects.rs (commands window_materials, set_window_material).
import { detectDesktopOs } from "./common.js";

export const MATERIALS = Object.freeze([
  { id: "mica", name: "Mica" },
  { id: "tabbed", name: "Mica Alt" },
  { id: "acrylic", name: "Acrylic" },
  { id: "sidebar", name: "Sidebar" },
  { id: "under-window", name: "Under window" },
  { id: "hud", name: "HUD" },
  { id: "window", name: "Window background" },
  { id: "transparent", name: "Transparent" },
]);

const invoke = () => globalThis.window?.__TAURI__?.core?.invoke;
export const inDesktop = () => !!globalThis.window?.__TAURI_INTERNALS__;

export const osInfo = () => ({ os: detectDesktopOs(), desktop: inDesktop() });

export function markOs(root) {
  const i = osInfo();
  root.dataset.os = i.os;
  if (i.desktop) root.dataset.desktop = "";
}

/** Picker options ("none" first) for the ids the shell reported; unknown ids are dropped. */
export function materialChoices(materials) {
  if (!Array.isArray(materials) || !materials.length) return [];
  return [{ id: "none", name: "None" }, ...MATERIALS.filter((m) => materials.includes(m.id))];
}

let info = null;
let pending = null;
let applied = "none";

export function loadMaterials() {
  const call = invoke();
  if (!inDesktop() || !call) return Promise.resolve(null);
  pending ||= call("window_materials")
    .then((r) => (info = Array.isArray(r?.materials) ? r.materials : []))
    .catch(() => (info = []));
  return pending;
}

export const materialsNow = () => info;

export function applyMaterial(id) {
  const call = invoke();
  if (!inDesktop() || !call || id === applied) return;
  applied = id;
  call("set_window_material", { material: id }).catch(() => {
    applied = "none";
  });
}
