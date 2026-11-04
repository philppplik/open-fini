//! Local preview server of the Code studio ("Open in browser", live preview of folders opened from disk).
//!
//! A tiny std-only HTTP/1.1 server for GET/HEAD. It binds 127.0.0.1 unless the user opts in to LAN
//! preview, and serves only below `/<token>/` (a random per-session token), so other local programs
//! and web pages cannot guess URLs. Files come from an in-memory overlay (unsaved editor contents,
//! projects that only exist in memory) and then from the project folder on disk, which must be inside
//! the fs scope the user granted. Requests with `..`, backslashes, control characters or drive letters
//! are refused; symbolic links that leave the folder are not followed. HTML pages get a small
//! live-reload script that polls `/<token>/__of_rev`, which changes when the overlay is updated or
//! a file in the folder changes (the disk watcher). Mirrors `app/src/engine/web/local-serve.js`.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::fs;
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

use crate::wire::b64_decode;

const DEFAULT_PORT: u16 = 5520;
const MAX_HEAD: usize = 16 * 1024;
const MAX_STAMP_FILES: usize = 5000;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

// ------------------------------------------------------------------ pure helpers (tested)

/// Content-Type by extension (keep in sync with MIME_TYPES in local-serve.js).
pub fn mime_for(path: &str) -> &'static str {
    let ext = path
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json; charset=utf-8",
        "txt" | "tex" | "bib" => "text/plain; charset=utf-8",
        "md" | "markdown" => "text/markdown; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "tsv" => "text/tab-separated-values; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "pdf" => "application/pdf",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hi = hex_val(*b.get(i + 1)?)?;
            let lo = hex_val(*b.get(i + 2)?)?;
            out.push(hi * 16 + lo);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// A request path as a project-relative path, or None when unsafe (see `safeRequestPath` in JS).
pub fn safe_path(url_path: &str) -> Option<String> {
    let raw = url_path.split(['?', '#']).next().unwrap_or("");
    let raw = percent_decode(raw)?;
    if raw.chars().any(|c| c == '\\' || c.is_control()) {
        return None;
    }
    let trimmed = raw.trim_start_matches('/');
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return None;
    }
    let parts: Vec<&str> = raw
        .split('/')
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    if parts.contains(&"..") {
        return None;
    }
    let mut path = parts.join("/");
    if path.is_empty() {
        path = "index.html".into();
    } else if raw.ends_with('/') {
        path.push_str("/index.html");
    }
    Some(path)
}

/// Resolution order: the file, `<p>/index.html`, `<p>.html`, then with `spa` the entry for extension-less paths.
pub fn resolve(path: &str, has: impl Fn(&str) -> bool, spa: bool, entry: &str) -> Option<String> {
    if has(path) {
        return Some(path.to_string());
    }
    let bare = path
        .strip_suffix("/index.html")
        .unwrap_or(if path == "index.html" { "" } else { path });
    if !bare.is_empty() {
        for c in [format!("{bare}/index.html"), format!("{bare}.html")] {
            if has(&c) {
                return Some(c);
            }
        }
    }
    let last = bare.rsplit('/').next().unwrap_or("");
    if spa && !last.contains('.') && has(entry) {
        return Some(entry.to_string());
    }
    None
}

/// The live-reload script (same behavior as `liveReloadSnippet` in JS).
pub fn reload_snippet(rev_url: &str) -> String {
    format!("<script>(()=>{{let r=null;const t=async()=>{{try{{const n=await (await fetch(\"{rev_url}\",{{cache:\"no-store\"}})).text();if(r!==null&&n!==r)location.reload();r=n}}catch{{}}setTimeout(t,1000)}};t()}})();</script>")
}

/// Inserts the snippet before `</body>` (case-insensitive) or appends it.
pub fn inject(html: &str, snippet: &str) -> String {
    match html.to_ascii_lowercase().rfind("</body") {
        Some(i) => format!("{}{}{}", &html[..i], snippet, &html[i..]),
        None => format!("{html}{snippet}"),
    }
}

/// True when the Host header names this computer (DNS-rebinding protection for loopback-only servers).
pub fn loopback_host(host: &str) -> bool {
    let name = host
        .rsplit_once(':')
        .map(|(h, _)| h)
        .unwrap_or(host)
        .to_ascii_lowercase();
    matches!(name.as_str(), "127.0.0.1" | "localhost" | "[::1]")
}

/// A random hex token (std only: two independently seeded SipHash states, the clock and the process id).
pub fn random_token() -> String {
    let mut out = String::new();
    for i in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        h.write_u128(UNIX_EPOCH.elapsed().map(|d| d.as_nanos()).unwrap_or(0));
        h.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

/// Joins a safe relative path to `root` and refuses anything that resolves outside it (symbolic links included).
pub fn file_in_root(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut p = root.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(s) => p.push(s),
            _ => return None,
        }
    }
    let canon = p.canonicalize().ok()?;
    let root = root.canonicalize().ok()?;
    (canon.starts_with(&root) && canon.is_file()).then_some(canon)
}

/// Walks a folder (skipping dot entries, node_modules and target) and returns `(relative path, "mtime:size")`.
pub fn stamps(root: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), String::new(), 0usize)];
    while let Some((dir, prefix, depth)) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if depth < 12 {
                    stack.push((e.path(), rel, depth + 1));
                }
            } else if ft.is_file() {
                if let Ok(m) = e.metadata() {
                    let t = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis())
                        .unwrap_or(0);
                    out.push((rel, format!("{t}:{}", m.len())));
                }
                if out.len() >= MAX_STAMP_FILES {
                    return out;
                }
            }
        }
    }
    out
}

fn stamp_hash(list: &[(String, String)]) -> u64 {
    let mut sorted: Vec<_> = list.iter().collect();
    sorted.sort();
    let mut h = std::hash::DefaultHasher::new();
    for (p, s) in sorted {
        h.write(p.as_bytes());
        h.write(s.as_bytes());
    }
    h.finish()
}

// ------------------------------------------------------------------ server

struct Srv {
    token: String,
    port: u16,
    lan: bool,
    root: Mutex<Option<PathBuf>>,
    overlay: Mutex<HashMap<String, Vec<u8>>>,
    spa: AtomicBool,
    entry: Mutex<String>,
    rev: AtomicU64,
    disk: Mutex<(Option<Instant>, u64)>,
    stop: AtomicBool,
}

impl Srv {
    fn has(&self, rel: &str) -> bool {
        lock(&self.overlay).contains_key(rel)
            || lock(&self.root)
                .as_ref()
                .and_then(|r| file_in_root(r, rel))
                .is_some()
    }
    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        if let Some(b) = lock(&self.overlay).get(rel) {
            return Some(b.clone());
        }
        let root = lock(&self.root).clone()?;
        fs::read(file_in_root(&root, rel)?).ok()
    }
    /// The revision the live-reload script compares: overlay updates plus a (rate-limited) disk snapshot.
    fn revision(&self) -> String {
        let root = lock(&self.root).clone();
        let mut d = lock(&self.disk);
        if let Some(root) = root {
            if d.0.is_none_or(|t| t.elapsed() > Duration::from_millis(700)) {
                *d = (Some(Instant::now()), stamp_hash(&stamps(&root)));
            }
        }
        format!("{}-{:x}", self.rev.load(Ordering::Relaxed), d.1)
    }
}

/// Managed state: the running server, if any.
#[derive(Default)]
pub struct PreviewServer(Mutex<Option<Arc<Srv>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    port: u16,
    lan: bool,
    url: String,
    token: String,
}

fn status(s: &Srv) -> ServerStatus {
    ServerStatus {
        port: s.port,
        lan: s.lan,
        url: format!("http://127.0.0.1:{}/{}/", s.port, s.token),
        token: s.token.clone(),
    }
}

fn respond(stream: &mut TcpStream, code: u16, ctype: &str, body: &[u8], head_only: bool) {
    let reason = match code {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Bad Request",
    };
    let head = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
}

fn handle(srv: &Srv, mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
        if buf.len() > MAX_HEAD {
            return respond(&mut stream, 400, "text/plain", b"Bad request", false);
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, target) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    let host = lines
        .find_map(|l| {
            l.split_once(':')
                .filter(|(k, _)| k.eq_ignore_ascii_case("host"))
                .map(|(_, v)| v.trim().to_string())
        })
        .unwrap_or_default();
    let head_only = method == "HEAD";
    if method != "GET" && !head_only {
        return respond(&mut stream, 405, "text/plain", b"Method not allowed", false);
    }
    if !srv.lan && !loopback_host(&host) {
        return respond(&mut stream, 403, "text/plain", b"Forbidden", false);
    }
    let prefix = format!("/{}/", srv.token);
    let Some(rest) = target.strip_prefix(&prefix) else {
        return respond(&mut stream, 404, "text/plain", b"Not found", head_only);
    };
    if rest.split(['?', '#']).next() == Some("__of_rev") {
        return respond(
            &mut stream,
            200,
            "text/plain; charset=utf-8",
            srv.revision().as_bytes(),
            head_only,
        );
    }
    let Some(path) = safe_path(rest) else {
        return respond(&mut stream, 403, "text/plain", b"Forbidden", false);
    };
    let entry = lock(&srv.entry).clone();
    let Some(found) = resolve(
        &path,
        |p| srv.has(p),
        srv.spa.load(Ordering::Relaxed),
        &entry,
    ) else {
        return respond(&mut stream, 404, "text/plain", b"Not found", head_only);
    };
    let Some(mut body) = srv.read(&found) else {
        return respond(&mut stream, 404, "text/plain", b"Not found", head_only);
    };
    let ctype = mime_for(&found);
    if ctype.starts_with("text/html") {
        body = inject(
            &String::from_utf8_lossy(&body),
            &reload_snippet(&format!("{prefix}__of_rev")),
        )
        .into_bytes();
    }
    respond(&mut stream, 200, ctype, &body, head_only);
}

fn accept_loop(srv: Arc<Srv>, listener: TcpListener) {
    for conn in listener.incoming() {
        if srv.stop.load(Ordering::Relaxed) {
            break;
        }
        if let Ok(stream) = conn {
            let s = Arc::clone(&srv);
            let _ = thread::Builder::new()
                .name("preview-conn".into())
                .spawn(move || handle(&s, stream));
        }
    }
}

fn allowed_root(app: &AppHandle, root: Option<String>) -> Result<Option<PathBuf>, String> {
    let Some(root) = root.filter(|r| !r.is_empty()) else {
        return Ok(None);
    };
    let p = PathBuf::from(&root);
    if !p.is_dir() || !app.fs_scope().is_allowed(&p) {
        return Err(
            "The preview server cannot read that folder. Open it with File ▸ Open Folder first."
                .into(),
        );
    }
    Ok(Some(p))
}

/// Starts the server (or reconfigures the running one). `lan` binds every interface (the user opted in).
#[tauri::command]
pub fn preview_server_start(
    app: AppHandle,
    state: tauri::State<'_, PreviewServer>,
    root: Option<String>,
    port: Option<u16>,
    lan: Option<bool>,
    spa: Option<bool>,
    entry: Option<String>,
) -> Result<ServerStatus, String> {
    let root = allowed_root(&app, root)?;
    let lan = lan.unwrap_or(false);
    let want_port = port.filter(|p| *p >= 1024);
    let mut slot = lock(&state.0);
    if let Some(s) = slot.as_ref() {
        if s.lan == lan && want_port.is_none_or(|p| p == s.port) {
            *lock(&s.root) = root;
            s.spa.store(spa.unwrap_or(false), Ordering::Relaxed);
            *lock(&s.entry) = entry.unwrap_or_else(|| "index.html".into());
            return Ok(status(s));
        }
        s.stop.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(("127.0.0.1", s.port));
    }
    let host = if lan { "0.0.0.0" } else { "127.0.0.1" };
    let listener = TcpListener::bind((host, want_port.unwrap_or(DEFAULT_PORT)))
        .or_else(|_| TcpListener::bind((host, 0)))
        .map_err(|e| format!("The preview server could not open a port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let srv = Arc::new(Srv {
        token: random_token(),
        port,
        lan,
        root: Mutex::new(root),
        overlay: Mutex::new(HashMap::new()),
        spa: AtomicBool::new(spa.unwrap_or(false)),
        entry: Mutex::new(entry.unwrap_or_else(|| "index.html".into())),
        rev: AtomicU64::new(1),
        disk: Mutex::new((None, 0)),
        stop: AtomicBool::new(false),
    });
    let s = Arc::clone(&srv);
    thread::Builder::new()
        .name("preview-server".into())
        .spawn(move || accept_loop(s, listener))
        .map_err(|e| e.to_string())?;
    let st = status(&srv);
    *slot = Some(srv);
    Ok(st)
}

/// A file pushed from the editor: project-relative path and base64 bytes.
#[derive(Deserialize)]
pub struct PutFile {
    pub path: String,
    pub data: String,
}

/// Updates the in-memory overlay (unsaved or memory-only files); bumps the live-reload revision.
#[tauri::command]
pub fn preview_server_put(
    state: tauri::State<'_, PreviewServer>,
    files: Vec<PutFile>,
    remove: Option<Vec<String>>,
    clear: Option<bool>,
) -> Result<u64, String> {
    let slot = lock(&state.0);
    let s = slot.as_ref().ok_or("The preview server is not running.")?;
    let mut ov = lock(&s.overlay);
    if clear.unwrap_or(false) {
        ov.clear();
    }
    for f in files {
        let p = safe_path(&f.path).ok_or_else(|| format!("Unsafe path {}", f.path))?;
        ov.insert(p, b64_decode(&f.data)?);
    }
    for r in remove.unwrap_or_default() {
        ov.remove(&r);
    }
    Ok(s.rev.fetch_add(1, Ordering::Relaxed) + 1)
}

/// Stops the server.
#[tauri::command]
pub fn preview_server_stop(state: tauri::State<'_, PreviewServer>) {
    if let Some(s) = lock(&state.0).take() {
        s.stop.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(("127.0.0.1", s.port));
    }
}

/// Disk snapshot of a folder the user opened, for the Code studio's watcher: `[[path, "mtime:size"], …]`.
#[tauri::command(async)]
pub fn preview_dir_stamps(app: AppHandle, root: String) -> Result<Vec<(String, String)>, String> {
    let root = allowed_root(&app, Some(root))?.ok_or("No folder.")?;
    Ok(stamps(&root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_paths() {
        assert_eq!(safe_path("").as_deref(), Some("index.html"));
        assert_eq!(safe_path("docs/").as_deref(), Some("docs/index.html"));
        assert_eq!(safe_path("css/a.css?v=1").as_deref(), Some("css/a.css"));
        assert_eq!(safe_path("a%20b.png").as_deref(), Some("a b.png"));
        for bad in [
            "../x",
            "a/../../x",
            "%2e%2e/x",
            "..%2fx",
            "a\\b",
            "C:/win.ini",
            "x%00",
            "%zz",
            "a%0ab",
        ] {
            assert_eq!(safe_path(bad), None, "{bad}");
        }
    }

    #[test]
    fn resolution_and_spa() {
        let files = ["index.html", "about.html", "docs/index.html"];
        let has = |p: &str| files.contains(&p);
        assert_eq!(
            resolve("about", has, false, "index.html").as_deref(),
            Some("about.html")
        );
        assert_eq!(
            resolve("docs", has, false, "index.html").as_deref(),
            Some("docs/index.html")
        );
        assert_eq!(resolve("users/1", has, false, "index.html"), None);
        assert_eq!(
            resolve("users/1", has, true, "index.html").as_deref(),
            Some("index.html")
        );
        assert_eq!(resolve("x.png", has, true, "index.html"), None);
    }

    #[test]
    fn mime_and_inject() {
        assert_eq!(mime_for("a.WOFF2"), "font/woff2");
        assert_eq!(mime_for("a.mjs"), "text/javascript; charset=utf-8");
        assert_eq!(mime_for("noext"), "application/octet-stream");
        assert_eq!(inject("<body>x</BODY>", "S"), "<body>xS</BODY>");
        assert_eq!(inject("x", "S"), "xS");
        assert!(
            loopback_host("127.0.0.1:5520")
                && loopback_host("localhost")
                && !loopback_host("evil.example:5520")
        );
        assert_eq!(random_token().len(), 32);
    }

    #[test]
    fn root_confinement() {
        let dir = std::env::temp_dir().join(format!("of-prev-{}", random_token()));
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/a.txt"), "x").unwrap();
        assert!(file_in_root(&dir, "sub/a.txt").is_some());
        assert!(file_in_root(&dir, "../a.txt").is_none());
        assert!(file_in_root(&dir, "sub").is_none());
        assert_eq!(stamps(&dir).len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
