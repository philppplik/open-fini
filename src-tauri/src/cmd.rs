//! Terminal access for the assistant (`run_command`, off by default, every call approved in the UI) and the optional
//! tunnel launcher of the Collaboration window. Programs run WITHOUT a shell: argv only, so nothing is interpolated.
//! The policy (allow/deny lists) lives in app/src/vibe/terminal-policy.js; this side enforces again what must hold
//! even if the page is wrong: never a shell, the working directory inside one of the given roots, a time limit, an
//! output cap and a process table so the UI's kill button works. Output streams as `openfini://cmd` events.
//! Tunnels run a fixed argv built here (cloudflared / ngrok / tailscale), never one from the page.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const EVENT: &str = "openfini://cmd";
const SHELLS: &[&str] = &[
    "sh",
    "bash",
    "zsh",
    "fish",
    "dash",
    "ksh",
    "csh",
    "cmd",
    "powershell",
    "pwsh",
];
const MAX_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const MAX_OUTPUT: usize = 4 * 1024 * 1024;

#[derive(Default)]
pub struct Procs {
    next: AtomicU64,
    table: Mutex<HashMap<u64, Arc<Mutex<Child>>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CmdEvent {
    id: u64,
    kind: &'static str,
    data: String,
    code: Option<i32>,
    timed_out: bool,
}

/// Lower-case program name without directories and Windows extensions.
pub fn program_name(p: &str) -> String {
    let base = p.rsplit(['/', '\\']).next().unwrap_or(p).to_lowercase();
    for ext in [".exe", ".cmd", ".bat", ".com", ".ps1"] {
        if let Some(s) = base.strip_suffix(ext) {
            return s.to_string();
        }
    }
    base
}

/// True when `dir` (canonical) lies inside one of `roots` (canonicalized here).
pub fn inside_roots(dir: &Path, roots: &[String]) -> bool {
    roots.iter().any(|r| {
        std::fs::canonicalize(r)
            .map(|root| dir.starts_with(root))
            .unwrap_or(false)
    })
}

/// Finds a program on PATH (with PATHEXT on Windows).
pub fn which(name: &str) -> Option<PathBuf> {
    if name.contains('/') || name.contains('\\') {
        return None;
    }
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
            .split(';')
            .map(|e| e.to_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let p = dir.join(format!("{name}{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn emit(app: &AppHandle, ev: CmdEvent) {
    let _ = app.emit(EVENT, ev);
}

fn pump(
    app: AppHandle,
    id: u64,
    kind: &'static str,
    mut src: impl Read,
    budget: Arc<Mutex<usize>>,
) {
    let mut buf = [0u8; 8192];
    while let Ok(n) = src.read(&mut buf) {
        if n == 0 {
            break;
        }
        let mut left = budget.lock().unwrap_or_else(PoisonError::into_inner);
        if *left == 0 {
            continue; // keep draining so the child never blocks on a full pipe
        }
        let take = n.min(*left);
        *left -= take;
        drop(left);
        let data = String::from_utf8_lossy(&buf[..take]).into_owned();
        emit(
            &app,
            CmdEvent {
                id,
                kind,
                data,
                code: None,
                timed_out: false,
            },
        );
    }
}

fn spawn(
    app: &AppHandle,
    procs: &Procs,
    program: PathBuf,
    args: &[String],
    cwd: &Path,
    timeout_ms: u64,
    max_output: usize,
) -> Result<u64, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start the program: {e}"))?;
    let id = procs.next.fetch_add(1, Ordering::Relaxed) + 1;
    let budget = Arc::new(Mutex::new(max_output.min(MAX_OUTPUT)));
    if let Some(out) = child.stdout.take() {
        let (a, b) = (app.clone(), Arc::clone(&budget));
        thread::spawn(move || pump(a, id, "stdout", out, b));
    }
    if let Some(err) = child.stderr.take() {
        let (a, b) = (app.clone(), Arc::clone(&budget));
        thread::spawn(move || pump(a, id, "stderr", err, b));
    }
    let child = Arc::new(Mutex::new(child));
    procs
        .table
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id, Arc::clone(&child));
    let app = app.clone();
    let start = Instant::now();
    thread::spawn(move || {
        let mut timed_out = false;
        let code = loop {
            let mut c = child.lock().unwrap_or_else(PoisonError::into_inner);
            match c.try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) => {
                    if timeout_ms > 0 && start.elapsed() > Duration::from_millis(timeout_ms) {
                        timed_out = true;
                        let _ = c.kill();
                        let _ = c.wait();
                        break None;
                    }
                }
                Err(_) => break None,
            }
            drop(c);
            thread::sleep(Duration::from_millis(50));
        };
        if let Some(p) = app.try_state::<Procs>() {
            p.table
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
        }
        emit(
            &app,
            CmdEvent {
                id,
                kind: "exit",
                data: String::new(),
                code,
                timed_out,
            },
        );
    });
    Ok(id)
}

use tauri::Manager;

/// Runs `argv` in `cwd` (which must lie inside one of `roots`) without a shell. Returns the process id for events
/// and `cmd_kill`. Output beyond `max_output` bytes is dropped (the process keeps running until it ends or times out).
#[tauri::command]
pub fn cmd_run(
    app: AppHandle,
    state: tauri::State<'_, Procs>,
    argv: Vec<String>,
    cwd: String,
    roots: Vec<String>,
    timeout_ms: Option<u64>,
    max_output: Option<usize>,
) -> Result<u64, String> {
    let first = argv.first().ok_or("Empty command.")?;
    if argv.iter().any(|a| a.contains('\0')) {
        return Err("Arguments cannot contain NUL characters.".into());
    }
    let name = program_name(first);
    if SHELLS.contains(&name.as_str()) {
        return Err("Shells are never run.".into());
    }
    let dir =
        std::fs::canonicalize(&cwd).map_err(|e| format!("The folder {cwd} is not usable: {e}"))?;
    if !inside_roots(&dir, &roots) {
        return Err("The working folder is outside the opened folders.".into());
    }
    let program = which(first).ok_or_else(|| format!("“{first}” was not found on PATH."))?;
    let timeout = timeout_ms.unwrap_or(60_000).clamp(1000, MAX_TIMEOUT_MS);
    spawn(
        &app,
        &state,
        program,
        &argv[1..],
        &dir,
        timeout,
        max_output.unwrap_or(256 * 1024),
    )
}

/// Stops a process started by `cmd_run` or `tunnel_start`.
#[tauri::command]
pub fn cmd_kill(state: tauri::State<'_, Procs>, id: u64) -> bool {
    let child = state
        .table
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&id)
        .cloned();
    match child {
        Some(c) => c
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .kill()
            .is_ok(),
        None => false,
    }
}

/// Which tunnel CLIs are installed: [(name, path)].
#[tauri::command]
pub fn tunnel_detect() -> Vec<(String, String)> {
    ["cloudflared", "ngrok", "tailscale"]
        .iter()
        .filter_map(|n| which(n).map(|p| (n.to_string(), p.to_string_lossy().into_owned())))
        .collect()
}

/// Fixed argv of each supported tunnel for a local port.
pub fn tunnel_args(kind: &str, port: u16) -> Option<Vec<String>> {
    let url = format!("http://127.0.0.1:{port}");
    let v: Vec<String> = match kind {
        "cloudflared" => vec![
            "tunnel".into(),
            "--no-autoupdate".into(),
            "--url".into(),
            url,
        ],
        "ngrok" => vec!["http".into(), url, "--log".into(), "stdout".into()],
        "tailscale" => vec!["funnel".into(), port.to_string()],
        _ => return None,
    };
    Some(v)
}

/// Starts a tunnel to the built-in relay's port (the UI asks first and shows the public URL with a warning).
#[tauri::command]
pub fn tunnel_start(
    app: AppHandle,
    state: tauri::State<'_, Procs>,
    kind: String,
    port: u16,
) -> Result<u64, String> {
    let args = tunnel_args(&kind, port).ok_or("Unknown tunnel.")?;
    let program = which(&kind).ok_or_else(|| format!("{kind} is not installed."))?;
    spawn(
        &app,
        &state,
        program,
        &args,
        &std::env::temp_dir(),
        0,
        64 * 1024,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(program_name("C:\\Tools\\Git.EXE"), "git");
        assert_eq!(program_name("/usr/bin/npm"), "npm");
        assert_eq!(program_name("npm.cmd"), "npm");
    }

    #[test]
    fn roots() {
        let tmp = std::env::temp_dir();
        let dir = std::fs::canonicalize(&tmp).unwrap();
        assert!(inside_roots(&dir, &[tmp.to_string_lossy().into_owned()]));
        assert!(!inside_roots(&dir, &[]));
        assert!(!inside_roots(
            &dir,
            &[dir.join("nope").to_string_lossy().into_owned()]
        ));
    }

    #[test]
    fn tunnels() {
        assert_eq!(
            tunnel_args("ngrok", 8787).unwrap()[1],
            "http://127.0.0.1:8787"
        );
        assert!(tunnel_args("rm", 1).is_none());
        assert!(which("a/b").is_none());
    }
}
