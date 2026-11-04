//! Native window materials: the desktop wallpaper and other windows show through the app.
//!
//! Uses Tauri's own window effects (`WebviewWindow::set_effects`, backed by the `window-vibrancy`
//! crate that Tauri already depends on), so no extra dependency is needed. The main window is created
//! with `transparent: true` (tauri.conf.json); the webview keeps its opaque background color until a
//! material is chosen, so the default look is unchanged.
//!
//! - **Windows**: Mica and Mica Alt ("tabbed", Windows 11 build 22000+), Acrylic (Windows 10 1809+ and 11).
//! - **macOS**: NSVisualEffectView materials (needs `macOSPrivateApi` for the transparent webview).
//! - **Linux**: no blur API; a plain transparent window that shows the desktop where a compositor runs.
//!
//! The frontend asks [`window_materials`] which materials exist and calls [`set_window_material`]
//! (see `app/src/platform/native-glass.js`).

use serde::Serialize;
use tauri::window::{Color, Effect, EffectState, EffectsBuilder};
use tauri::WebviewWindow;

/// Opaque fallback color of the window (matches `backgroundColor` in tauri.conf.json).
const OPAQUE: Color = Color(0x1c, 0x1d, 0x21, 0xff);

/// What this desktop shell can do, for Settings > Appearance.
#[derive(Serialize)]
pub struct MaterialInfo {
    /// "windows", "macos" or "linux".
    os: &'static str,
    /// Material ids the user may pick, in display order ("none" is implied).
    materials: Vec<&'static str>,
}

/// Material ids offered on this OS.
fn supported() -> Vec<&'static str> {
    #[cfg(target_os = "windows")]
    {
        let mut out = Vec::new();
        if windows_build().is_some_and(|b| b >= 22000) {
            out.push("mica");
            out.push("tabbed");
        }
        out.push("acrylic");
        out
    }
    #[cfg(target_os = "macos")]
    {
        vec!["sidebar", "under-window", "hud", "window"]
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        vec!["transparent"]
    }
}

fn os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// The Windows build number (22000+ is Windows 11), read from `cmd /c ver` without a console window.
#[cfg(target_os = "windows")]
fn windows_build() -> Option<u32> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("cmd")
        .args(["/c", "ver"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    parse_windows_build(&String::from_utf8_lossy(&out.stdout))
}

/// "Microsoft Windows [Version 10.0.22631.4460]" -> 22631.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_windows_build(text: &str) -> Option<u32> {
    let start = text.find("10.0.")? + 5;
    let digits: String = text[start..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

/// The Tauri effect for a material id, or `None` for "none" and the Linux plain transparency.
fn effect_for(id: &str) -> Option<Effect> {
    Some(match id {
        "mica" => Effect::Mica,
        "tabbed" => Effect::Tabbed,
        "acrylic" => Effect::Acrylic,
        "sidebar" => Effect::Sidebar,
        "under-window" => Effect::UnderWindowBackground,
        "hud" => Effect::HudWindow,
        "window" => Effect::WindowBackground,
        _ => return None,
    })
}

/// Lists the native materials of this OS.
#[tauri::command]
pub fn window_materials() -> MaterialInfo {
    MaterialInfo {
        os: os(),
        materials: supported(),
    }
}

/// Applies a material ("none" restores the opaque window). Unknown ids are refused.
#[tauri::command]
pub fn set_window_material(window: WebviewWindow, material: String) -> Result<(), String> {
    let on = material != "none";
    if on && !supported().contains(&material.as_str()) {
        return Err(format!(
            "The window material \"{material}\" is not available here."
        ));
    }
    let effects = effect_for(&material).map(|e| {
        EffectsBuilder::new()
            .effect(e)
            .state(EffectState::FollowsWindowActiveState)
            .build()
    });
    window.set_effects(effects).map_err(|e| e.to_string())?;
    let bg = if on { Color(0, 0, 0, 0) } else { OPAQUE };
    window
        .set_background_color(Some(bg))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_windows_build_number() {
        assert_eq!(
            parse_windows_build("\r\nMicrosoft Windows [Version 10.0.22631.4460]\r\n"),
            Some(22631)
        );
        assert_eq!(
            parse_windows_build("Microsoft Windows [Version 10.0.19045.5011]"),
            Some(19045)
        );
        assert_eq!(parse_windows_build("garbage"), None);
    }

    #[test]
    fn maps_material_ids() {
        assert!(effect_for("mica").is_some());
        assert!(effect_for("under-window").is_some());
        assert!(effect_for("none").is_none());
        assert!(effect_for("transparent").is_none());
        assert!(supported()
            .iter()
            .all(|m| *m == "transparent" || effect_for(m).is_some()));
    }
}
