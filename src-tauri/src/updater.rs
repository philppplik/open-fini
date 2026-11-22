//! In-app updates (docs/updates.md): which kind of install this is, and whether the updater plugin is switched on.
//!
//! The Tauri updater plugin only starts when the build carries a minisign public key (`plugins.updater.pubkey`,
//! injected by the Release workflow from the `TAURI_UPDATER_PUBKEY` variable). Without it the plugin is not registered
//! at all, the frontend sees no `updater` API and falls back to the release page. The plugin itself enforces the
//! signature, the https endpoint and (by default) refuses a downgrade.

use std::path::Path;

/// True when the config holds a non-empty updater public key.
pub fn configured(config: &tauri::Config) -> bool {
    config
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

/// "app": this install can replace itself. "package": installed by a package manager or Flatpak, update it there.
/// "portable": a copy that was not installed (a development build, a portable or translocated copy).
pub fn classify(
    os: &str,
    exe: &Path,
    appimage: bool,
    flatpak: bool,
    has_uninstaller: bool,
) -> &'static str {
    match os {
        "linux" if flatpak => "package",
        "linux" if appimage => "app",
        "linux" => "package",
        "windows" if has_uninstaller => "app",
        "macos" => {
            let p = exe.to_string_lossy();
            if p.contains(".app/Contents/MacOS") && !p.contains("/AppTranslocation/") {
                "app"
            } else {
                "portable"
            }
        }
        _ => "portable",
    }
}

/// How this copy was installed, so the frontend knows whether it may offer "Download and install".
#[tauri::command]
pub fn update_install_kind() -> &'static str {
    let exe = std::env::current_exe().unwrap_or_default();
    let has_uninstaller = exe
        .parent()
        .is_some_and(|d| d.join("uninstall.exe").is_file());
    let flatpak = std::env::var_os("FLATPAK_ID").is_some() || Path::new("/.flatpak-info").exists();
    classify(
        std::env::consts::OS,
        &exe,
        std::env::var_os("APPIMAGE").is_some(),
        flatpak,
        has_uninstaller,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_kinds() {
        let p = Path::new("/x/openfini");
        assert_eq!(classify("linux", p, true, false, false), "app");
        assert_eq!(classify("linux", p, false, false, false), "package");
        assert_eq!(classify("linux", p, true, true, false), "package");
        assert_eq!(classify("windows", p, false, false, true), "app");
        assert_eq!(classify("windows", p, false, false, false), "portable");
        let app = Path::new("/Applications/OpenFini.app/Contents/MacOS/openfini");
        assert_eq!(classify("macos", app, false, false, false), "app");
        let moved =
            Path::new("/private/var/AppTranslocation/X/d/OpenFini.app/Contents/MacOS/openfini");
        assert_eq!(classify("macos", moved, false, false, false), "portable");
        assert_eq!(classify("macos", p, false, false, false), "portable");
    }

    #[test]
    fn plugin_needs_a_public_key() {
        let mut config = tauri::Config::default();
        assert!(!configured(&config));
        config
            .plugins
            .0
            .insert("updater".into(), serde_json::json!({ "pubkey": " " }));
        assert!(!configured(&config));
        config
            .plugins
            .0
            .insert("updater".into(), serde_json::json!({ "pubkey": "abc" }));
        assert!(configured(&config));
    }
}
