//! OpenFini desktop shell.
//!
//! The whole application is the web frontend in `app/`. This crate hosts it in
//! the system WebView and adds what a browser cannot do on its own: native file
//! dialogs, file associations, opening files from the OS, a single running
//! instance and the native clipboard.
//!
//! The frontend talks to this crate through the plugins registered in [`run`]
//! and two small commands (`take_launch_files`, `quit_app`); see
//! `app/src/platform/tauri.js`.

mod cli;

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

use cli::{paths_from_args, Action};

/// Event sent to the frontend when the OS asks OpenFini to open files.
/// The payload is a `string[]` of absolute paths.
const OPEN_FILES_EVENT: &str = "openfini://open-files";

/// Label of the main window (see `app.windows` in `tauri.conf.json`).
const MAIN_WINDOW: &str = "main";

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

/// Brings the main window to the front.
fn focus_main_window(app: &AppHandle) {
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
        // The user opened this file through the OS, so it may be read and
        // saved even when it lives outside the static scopes of the capability.
        if scope.allow_file(&path).is_ok() {
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![take_launch_files, quit_app])
        .setup(|app| {
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
