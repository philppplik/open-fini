//! OpenFini desktop shell.
//!
//! The whole application is the web frontend in `app/`. This crate hosts it in
//! the system WebView and adds what a browser cannot do on its own: native file
//! dialogs, file associations, opening files from the OS, a single running
//! instance and the native clipboard.
//!
//! The frontend talks to this crate through the plugins registered in [`run`]
//! and a few commands: `take_launch_files`, `quit_app` (see `app/src/platform/tauri.js`), the OAuth
//! loopback (`oauth.rs`), the built-in collaboration relay (`relay.rs`) and the FTP/FTPS and SMTP
//! clients (`ftp.rs`, `smtp.rs`; shared plumbing in `netio.rs` and `wire.rs`), native window materials
//! (`effects.rs`), the Code studio's local preview server (`preview_server.rs`) and LaTeX compiling with an
//! installed TeX engine (`latex.rs`), the assistant's native web GET (`webfetch.rs`) and its per-folder local file
//! access with an audit log (`fileaccess.rs`).

mod cli;
mod cmd;
mod effects;
mod fileaccess;
mod ftp;
mod latex;
mod netio;
mod oauth;
mod preview_server;
mod relay;
mod smtp;
mod webfetch;
mod wire;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

use cli::{paths_from_args, Action};

/// Event sent to the frontend when the OS asks OpenFini to open files.
/// The payload is a `string[]` of absolute paths; a folder ends with a path separator.
const OPEN_FILES_EVENT: &str = "openfini://open-files";

/// Label of the main window (see `app.windows` in `tauri.conf.json`).
const MAIN_WINDOW: &str = "main";
/// Label of the Collaboration window (created by the web side: `WINDOW_LABEL` in `app/src/collab/remote-ui.js`).
const COLLAB_WINDOW: &str = "collab";

/// Files handed to the app by the OS (launch arguments, a second launch, the
/// macOS "Open With" events) that the frontend has not picked up yet.
#[derive(Default)]
struct OpenQueue(Mutex<QueueState>);

#[derive(Default)]
struct QueueState {
    /// Becomes true once the frontend has called `take_launch_files`. From then
    /// on files are emitted as events instead of being queued.
    ready: bool,
    pending: Vec<String>,
}

impl OpenQueue {
    fn lock(&self) -> MutexGuard<'_, QueueState> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Label of the launch splash window (`app/splash.html`, see `app.windows` in `tauri.conf.json`).
const SPLASH_WINDOW: &str = "splash";
/// The main window starts hidden behind the splash window. It is shown when the frontend says it is ready
/// (`launch_ready`) or, at the latest, after this many seconds, so a failing start never leaves it invisible.
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(10);

/// Whether the main window was revealed yet (docs/launch-screen.md, ADR 0031).
#[derive(Default)]
struct Launch {
    revealed: AtomicBool,
}

/// Shows the main window and closes the splash window, once. Every failure here is ignored: the splash window is
/// decoration and must never keep the app from starting.
fn reveal_main_window(app: &AppHandle) {
    if app.state::<Launch>().revealed.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(splash) = app.get_webview_window(SPLASH_WINDOW) {
        let _ = splash.destroy();
    }
}

/// Called by the main window when the app is ready (or right away when the launch screen is turned off, or when a
/// prompt such as the app lock must be visible). Idempotent.
#[tauri::command]
fn launch_ready(app: AppHandle) {
    reveal_main_window(&app);
}

/// Brings the main window to the front. While the app is still starting (main window hidden behind the splash
/// window) it stays hidden: `reveal_main_window` shows and focuses it when the app is ready.
fn focus_main_window(app: &AppHandle) {
    if !app.state::<Launch>().revealed.load(Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Grants the frontend access to files the OS asked us to open and delivers
/// them: right away when the frontend is listening, otherwise on its first
/// `take_launch_files` call.
fn deliver_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    let scope = app.fs_scope();
    let mut accepted = Vec::new();
    for path in paths {
        // The user opened this file or folder through the OS, so it may be read
        // and saved even when it lives outside the static scopes of the
        // capability. A folder is granted recursively for this session only and
        // is sent with a trailing path separator (see `cli::mark_if_dir`).
        if path.is_dir() {
            if scope.allow_directory(&path, true).is_ok() {
                accepted.push(cli::mark_if_dir(&path));
            }
        } else if scope.allow_file(&path).is_ok() {
            accepted.push(path.to_string_lossy().into_owned());
        }
    }
    if accepted.is_empty() {
        return;
    }

    let queue = app.state::<OpenQueue>();
    let emit_now = {
        let mut state = queue.lock();
        if !state.ready {
            state.pending.extend(accepted.iter().cloned());
        }
        state.ready
    };
    if emit_now {
        let _ = app.emit(OPEN_FILES_EVENT, accepted);
    }
    focus_main_window(app);
}

/// Called by the frontend once it listens for [`OPEN_FILES_EVENT`]. Returns the
/// files that arrived before that (for example the file that launched the app).
#[tauri::command]
fn take_launch_files(queue: State<'_, OpenQueue>) -> Vec<String> {
    let mut state = queue.lock();
    state.ready = true;
    std::mem::take(&mut state.pending)
}

/// Exits the application (the frontend asks the user about unsaved work first).
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Linux: WebKitGTK's DMA-BUF renderer shows a blank or flickering window on the proprietary NVIDIA
/// driver. Turn it off there unless the user already chose (docs/platform-notes.md).
fn linux_webkit_workarounds() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::path::Path::new("/proc/driver/nvidia/version").exists()
    {
        // Called at the very start of `run`, before any other thread exists.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

/// Builds and runs the application.
pub fn run() {
    // `--version` and `--help` are answered before anything else starts (also before the single-instance
    // check, so they never reach a running instance).
    if let Action::Print(text) =
        cli::action_for(std::env::args().skip(1), env!("CARGO_PKG_VERSION"))
    {
        cli::print(&text);
        return;
    }

    linux_webkit_workarounds();

    let mut builder = tauri::Builder::default();

    // A second launch (for example opening another file through the OS) hands
    // its arguments to the running instance. This plugin must be registered first.
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let cwd = PathBuf::from(cwd);
            let paths = paths_from_args(args.into_iter().skip(1), Some(cwd.as_path()));
            if paths.is_empty() {
                focus_main_window(app);
            } else {
                deliver_paths(app, paths);
            }
        }));
    }

    let app = builder
        .manage(OpenQueue::default())
        .manage(Launch::default())
        .manage(oauth::Loopback::default())
        .manage(relay::Relay::default())
        .manage(preview_server::PreviewServer::default())
        .manage(cmd::Procs::default())
        .manage(fileaccess::FileGrants::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            take_launch_files,
            quit_app,
            launch_ready,
            oauth::oauth_loopback_start,
            oauth::oauth_loopback_wait,
            relay::relay_start,
            relay::relay_stop,
            relay::relay_status,
            cmd::cmd_run,
            cmd::cmd_kill,
            cmd::tunnel_detect,
            cmd::tunnel_start,
            ftp::ftp_test,
            ftp::ftp_upload,
            smtp::smtp_test,
            smtp::smtp_send,
            netio::net_cancel,
            effects::window_materials,
            effects::set_window_material,
            preview_server::preview_server_start,
            preview_server::preview_server_put,
            preview_server::preview_server_stop,
            preview_server::preview_dir_stamps,
            latex::latex_engines,
            latex::latex_compile,
            webfetch::web_get,
            fileaccess::files_grants,
            fileaccess::files_grant_pick,
            fileaccess::files_grant_set_write,
            fileaccess::files_grant_revoke,
            fileaccess::files_list,
            fileaccess::files_read,
            fileaccess::files_write,
            fileaccess::files_audit,
            fileaccess::files_audit_clear,
        ])
        // The Collaboration window is a remote view of the main window's room: it never outlives it.
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(collab) = window.app_handle().get_webview_window(COLLAB_WINDOW) {
                    let _ = collab.destroy();
                }
                if let Some(splash) = window.app_handle().get_webview_window(SPLASH_WINDOW) {
                    let _ = splash.destroy();
                }
            }
        })
        .setup(|app| {
            // Fallback for the launch screen: whatever happens in the frontend, the main window shows.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(LAUNCH_TIMEOUT);
                reveal_main_window(&handle);
            });
            let args = std::env::args_os()
                .skip(1)
                .map(|arg| arg.to_string_lossy().into_owned());
            deliver_paths(app.handle(), paths_from_args(args, None));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the OpenFini application");

    app.run(|app_handle, event| {
        // On macOS, Finder and the Dock deliver "open with" requests as events.
        #[cfg(target_os = "macos")]
        {
            if let tauri::RunEvent::Opened { urls } = event {
                let mut paths = Vec::new();
                for url in &urls {
                    if let Ok(path) = url.to_file_path() {
                        paths.push(path);
                    }
                }
                deliver_paths(app_handle, paths);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}
