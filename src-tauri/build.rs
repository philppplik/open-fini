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
    "cmd_run",
    "cmd_kill",
    "tunnel_detect",
    "tunnel_start",
    "ftp_test",
    "ftp_upload",
    "smtp_test",
    "smtp_send",
    "net_cancel",
    "window_materials",
    "set_window_material",
    "preview_server_start",
    "preview_server_put",
    "preview_server_stop",
    "preview_dir_stamps",
    "latex_engines",
    "latex_compile",
    "web_get",
    "files_grants",
    "files_grant_pick",
    "files_grant_set_write",
    "files_grant_revoke",
    "files_list",
    "files_read",
    "files_write",
    "files_audit",
    "files_audit_clear",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
