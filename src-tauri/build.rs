// The app's own commands get permissions (`allow-<command>`), so each window may call only what its
// capability lists (src-tauri/capabilities/default.json). Keep this list in sync with
// `generate_handler!` in src/lib.rs: a command missing here is refused at run time.
const COMMANDS: &[&str] = &[
    "take_launch_files",
    "quit_app",
    "oauth_loopback_start",
    "oauth_loopback_wait",
    "relay_start",
    "relay_stop",
    "relay_status",
    "ftp_test",
    "ftp_upload",
    "smtp_test",
    "smtp_send",
    "net_cancel",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
