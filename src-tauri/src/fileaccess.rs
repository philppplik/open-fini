//! Local file access for the assistant (desktop app, off by default; docs/vibe-files.md). The person grants single
//! folders through the native folder picker (opened HERE, so the page cannot grant itself a path), each with a read
//! or read-and-write scope. Every operation:
//!
//! - canonicalizes the path (resolving `..`, `.` and symbolic links) and requires the result to lie inside a granted
//!   folder, component by component, so `..` and symbolic links cannot escape;
//! - for writes, needs a write grant, resolves the deepest existing ancestor the same way, refuses `..` in the part
//!   that does not exist yet, refuses to replace a symbolic link or (Unix) a file with more than one hard link, and
//!   never writes the granted folder itself;
//! - is appended to an audit log (JSON lines, `file-access-audit.jsonl` in the app's log folder): time, operation,
//!   path, grant, bytes, result. File contents are never logged.
//!
//! Grants live in `file-grants.json` in the app's config folder and survive restarts; revoking one is immediate.
//! The page asks for the person's approval before calling read and write (app/src/vibe/tools/local-files.js); this
//! module is the boundary that holds even if the page is wrong.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::wire;

const MAX_READ: usize = 20 * 1024 * 1024;
const MAX_WRITE: usize = 20 * 1024 * 1024;
const MAX_ENTRIES: usize = 2000;
const MAX_AUDIT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub id: String,
    /// Canonical absolute path of the folder.
    pub path: String,
    pub write: bool,
    pub created: u64,
}

#[derive(Default)]
pub struct FileGrants(Mutex<Option<Vec<Grant>>>);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Path for display: Windows' verbatim prefix (`\\?\C:\…`) removed.
pub fn display(p: &Path) -> String {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_string(),
        Some(rest) if rest.starts_with("UNC\\") => format!(r"\\{}", &rest[4..]),
        _ => s.into_owned(),
    }
}

/// The grant whose folder contains `canonical` (the longest match), if any.
pub fn grant_for<'a>(grants: &'a [Grant], canonical: &Path) -> Option<&'a Grant> {
    grants
        .iter()
        .filter(|g| {
            fs::canonicalize(&g.path)
                .map(|root| canonical.starts_with(&root))
                .unwrap_or(false)
        })
        .max_by_key(|g| g.path.len())
}

/// Resolves an existing file or folder inside a grant.
pub fn resolve_existing<'a>(
    grants: &'a [Grant],
    path: &str,
) -> Result<(PathBuf, &'a Grant), String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err(
            "Use an absolute path inside a granted folder (local_list_folders lists them).".into(),
        );
    }
    let canonical = fs::canonicalize(p).map_err(|_| format!("“{path}” does not exist."))?;
    let grant = grant_for(grants, &canonical).ok_or_else(|| {
        format!("“{path}” is outside the folders you granted (Settings ▸ Artificial intelligence ▸ Local files).")
    })?;
    Ok((canonical, grant))
}

/// Resolves a file to write: the deepest existing ancestor must be inside a write grant, the rest must be plain
/// names. Returns the final path (not canonical when it does not exist yet) and the grant.
pub fn resolve_for_write<'a>(
    grants: &'a [Grant],
    path: &str,
) -> Result<(PathBuf, &'a Grant), String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("Use an absolute path inside a granted folder.".into());
    }
    let mut existing = p.to_path_buf();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    while fs::symlink_metadata(&existing).is_err() {
        let name = existing
            .file_name()
            .ok_or_else(|| format!("“{path}” is not inside a granted folder."))?
            .to_os_string();
        rest.push(name);
        if !existing.pop() {
            return Err(format!("“{path}” is not inside a granted folder."));
        }
    }
    // the part that does not exist yet: plain names only (no "..", ".", roots or prefixes)
    if Path::new(path)
        .components()
        .rev()
        .take(rest.len())
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Paths must not contain “..” or “.”.".into());
    }
    let base = fs::canonicalize(&existing).map_err(|e| e.to_string())?;
    let grant = grant_for(grants, &base).ok_or_else(|| {
        format!("“{path}” is outside the folders you granted (Settings ▸ Artificial intelligence ▸ Local files).")
    })?;
    if !grant.write {
        return Err(format!(
            "The folder “{}” is granted for reading only. Allow writing in Settings ▸ Artificial intelligence ▸ Local files.",
            grant.path
        ));
    }
    let mut target = base;
    for name in rest.iter().rev() {
        target.push(name);
    }
    if fs::canonicalize(&grant.path)
        .map(|root| root == target)
        .unwrap_or(false)
    {
        return Err("The granted folder itself cannot be written.".into());
    }
    if let Ok(meta) = fs::symlink_metadata(&target) {
        if meta.file_type().is_symlink() {
            return Err("Writing through a symbolic link is not allowed.".into());
        }
        if meta.is_dir() {
            return Err(format!("“{path}” is a folder."));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if meta.nlink() > 1 {
                return Err("This file has several hard links; writing it is not allowed.".into());
            }
        }
    }
    Ok((target, grant))
}

// ------------------------------------------------------------------ storage

fn grants_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("file-grants.json"))
}

fn audit_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .join("file-access-audit.jsonl"))
}

fn with_grants<T>(
    app: &AppHandle,
    state: &FileGrants,
    f: impl FnOnce(&mut Vec<Grant>) -> Result<T, String>,
) -> Result<T, String> {
    let mut slot = state.0.lock().unwrap_or_else(PoisonError::into_inner);
    if slot.is_none() {
        let loaded = fs::read(grants_file(app)?)
            .ok()
            .and_then(|b| serde_json::from_slice::<Vec<Grant>>(&b).ok())
            .unwrap_or_default();
        *slot = Some(loaded);
    }
    let list = slot.as_mut().expect("loaded above");
    let before = list.clone();
    let out = f(list)?;
    if *list != before {
        let file = grants_file(app)?;
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        fs::write(
            &file,
            serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(out)
}

#[derive(Serialize)]
struct AuditRow<'a> {
    time: u64,
    op: &'a str,
    path: &'a str,
    grant: Option<&'a str>,
    bytes: Option<usize>,
    ok: bool,
    error: Option<&'a str>,
}

fn audit(
    app: &AppHandle,
    op: &str,
    path: &str,
    grant: Option<&str>,
    bytes: Option<usize>,
    err: Option<&str>,
) {
    let Ok(file) = audit_file(app) else { return };
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    // keep the log bounded: start over (with the previous file kept as .1) when it grows too large
    if fs::metadata(&file)
        .map(|m| m.len() > MAX_AUDIT_BYTES)
        .unwrap_or(false)
    {
        let _ = fs::rename(&file, file.with_extension("jsonl.1"));
    }
    let row = AuditRow {
        time: now_ms(),
        op,
        path,
        grant,
        bytes,
        ok: err.is_none(),
        error: err,
    };
    if let (Ok(mut f), Ok(line)) = (
        OpenOptions::new().create(true).append(true).open(&file),
        serde_json::to_string(&row),
    ) {
        let _ = writeln!(f, "{line}");
    }
}

/// Runs `op`, then writes one audit row with its outcome.
fn audited<T>(
    app: &AppHandle,
    op: &str,
    path: &str,
    run: impl FnOnce() -> Result<(T, Option<String>, Option<usize>), String>,
) -> Result<T, String> {
    match run() {
        Ok((v, grant, bytes)) => {
            audit(app, op, path, grant.as_deref(), bytes, None);
            Ok(v)
        }
        Err(e) => {
            audit(app, op, path, None, None, Some(&e));
            Err(e)
        }
    }
}

// ------------------------------------------------------------------ commands

/// The granted folders.
#[tauri::command]
pub fn files_grants(app: AppHandle, state: State<'_, FileGrants>) -> Result<Vec<Grant>, String> {
    with_grants(&app, &state, |l| Ok(l.clone()))
}

/// Opens the native folder picker and grants the chosen folder (read, or read and write).
#[tauri::command]
pub async fn files_grant_pick(app: AppHandle, write: bool) -> Result<Option<Grant>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picker = app.clone();
    let picked =
        tauri::async_runtime::spawn_blocking(move || picker.dialog().file().blocking_pick_folder())
            .await
            .map_err(|e| e.to_string())?;
    let Some(folder) = picked else {
        return Ok(None);
    };
    let path = folder.into_path().map_err(|e| e.to_string())?;
    let canonical = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if canonical.parent().is_none() {
        return Err(
            "A whole drive or the file system root cannot be granted; choose a folder.".into(),
        );
    }
    let state = app.state::<FileGrants>();
    let shown = display(&canonical);
    let grant = with_grants(&app, &state, |l| {
        if let Some(g) = l.iter_mut().find(|g| g.path == canonical.to_string_lossy()) {
            g.write = write;
            return Ok(g.clone());
        }
        let g = Grant {
            id: format!("g{:x}", now_ms()),
            path: canonical.to_string_lossy().into_owned(),
            write,
            created: now_ms(),
        };
        l.push(g.clone());
        Ok(g)
    })?;
    audit(
        &app,
        if write { "grant-write" } else { "grant-read" },
        &shown,
        Some(&grant.id),
        None,
        None,
    );
    Ok(Some(grant))
}

/// Changes a grant's scope (read only / read and write).
#[tauri::command]
pub fn files_grant_set_write(
    app: AppHandle,
    state: State<'_, FileGrants>,
    id: String,
    write: bool,
) -> Result<(), String> {
    let path = with_grants(&app, &state, |l| {
        let g = l
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or("This folder is no longer granted.")?;
        g.write = write;
        Ok(g.path.clone())
    })?;
    audit(
        &app,
        if write { "scope-write" } else { "scope-read" },
        &path,
        Some(&id),
        None,
        None,
    );
    Ok(())
}

/// Removes a grant.
#[tauri::command]
pub fn files_grant_revoke(
    app: AppHandle,
    state: State<'_, FileGrants>,
    id: String,
) -> Result<(), String> {
    let path = with_grants(&app, &state, |l| {
        let i = l
            .iter()
            .position(|g| g.id == id)
            .ok_or("This folder is no longer granted.")?;
        Ok(l.remove(i).path)
    })?;
    audit(&app, "revoke", &path, Some(&id), None, None);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    path: String,
    name: String,
    dir: bool,
    size: u64,
    modified: u64,
}

/// Lists a folder inside a grant (`depth` 1-4 levels, at most 2000 entries; symbolic links are listed, not followed).
#[tauri::command]
pub fn files_list(
    app: AppHandle,
    state: State<'_, FileGrants>,
    path: String,
    depth: Option<u32>,
) -> Result<Vec<Entry>, String> {
    let grants = with_grants(&app, &state, |l| Ok(l.clone()))?;
    audited(&app, "list", &path, || {
        let (dir, grant) = resolve_existing(&grants, &path)?;
        if !dir.is_dir() {
            return Err(format!("“{path}” is not a folder."));
        }
        let mut out = Vec::new();
        let mut stack = vec![(dir, 1u32)];
        let max_depth = depth.unwrap_or(1).clamp(1, 4);
        while let Some((d, level)) = stack.pop() {
            let mut rows: Vec<_> = fs::read_dir(&d)
                .map_err(|e| e.to_string())?
                .flatten()
                .collect();
            rows.sort_by_key(|e| e.file_name());
            for e in rows {
                if out.len() >= MAX_ENTRIES {
                    break;
                }
                let Ok(meta) = e.path().symlink_metadata() else {
                    continue;
                };
                let is_dir = meta.is_dir();
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                out.push(Entry {
                    path: display(&e.path()),
                    name: e.file_name().to_string_lossy().into_owned(),
                    dir: is_dir,
                    size: if is_dir { 0 } else { meta.len() },
                    modified,
                });
                if is_dir && level < max_depth {
                    stack.push((e.path(), level + 1));
                }
            }
        }
        let n = out.len();
        Ok((out, Some(grant.id.clone()), Some(n)))
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    path: String,
    size: u64,
    /// base64 of the first `maxBytes` bytes
    body: String,
    truncated: bool,
}

/// Reads a file inside a grant (at most `maxBytes`, capped at 20 MiB).
#[tauri::command]
pub fn files_read(
    app: AppHandle,
    state: State<'_, FileGrants>,
    path: String,
    max_bytes: Option<usize>,
) -> Result<ReadResult, String> {
    let grants = with_grants(&app, &state, |l| Ok(l.clone()))?;
    audited(&app, "read", &path, || {
        let (file, grant) = resolve_existing(&grants, &path)?;
        if !file.is_file() {
            return Err(format!("“{path}” is not a file."));
        }
        let size = fs::metadata(&file).map_err(|e| e.to_string())?.len();
        let limit = max_bytes.unwrap_or(1024 * 1024).min(MAX_READ);
        let mut buf = Vec::with_capacity(limit.min(size as usize));
        fs::File::open(&file)
            .map_err(|e| e.to_string())?
            .take(limit as u64)
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        let n = buf.len();
        Ok((
            ReadResult {
                path: display(&file),
                size,
                body: wire::b64_encode(&buf),
                truncated: (n as u64) < size,
            },
            Some(grant.id.clone()),
            Some(n),
        ))
    })
}

/// Writes (creates or replaces) a file inside a write grant; `body` is base64. Missing folders are created when
/// `createDirs` is true. The file is written to a temporary name first and then renamed, so a failure never leaves a
/// half-written file.
#[tauri::command]
pub fn files_write(
    app: AppHandle,
    state: State<'_, FileGrants>,
    path: String,
    body: String,
    create_dirs: Option<bool>,
) -> Result<String, String> {
    let grants = with_grants(&app, &state, |l| Ok(l.clone()))?;
    audited(&app, "write", &path, || {
        let bytes = wire::b64_decode(&body)?;
        if bytes.len() > MAX_WRITE {
            return Err("The content is larger than 20 MiB.".into());
        }
        let (target, grant) = resolve_for_write(&grants, &path)?;
        let parent = target.parent().ok_or("Invalid path.")?;
        if !parent.exists() {
            if create_dirs == Some(true) {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            } else {
                return Err("The folder does not exist. Pass createDirs to create it.".into());
            }
        }
        let tmp = parent.join(format!(
            ".{}.openfini-tmp",
            target.file_name().unwrap_or_default().to_string_lossy()
        ));
        fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &target).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            e.to_string()
        })?;
        Ok((display(&target), Some(grant.id.clone()), Some(bytes.len())))
    })
}

/// The newest audit rows (JSON lines), newest last.
#[tauri::command]
pub fn files_audit(app: AppHandle, limit: Option<usize>) -> Result<Vec<String>, String> {
    let text = fs::read_to_string(audit_file(&app)?).unwrap_or_default();
    let rows: Vec<String> = text.lines().map(str::to_string).collect();
    let n = limit.unwrap_or(200).min(2000);
    Ok(rows[rows.len().saturating_sub(n)..].to_vec())
}

/// Deletes the audit log.
#[tauri::command]
pub fn files_audit_clear(app: AppHandle) -> Result<(), String> {
    let file = audit_file(&app)?;
    let _ = fs::remove_file(file.with_extension("jsonl.1"));
    match fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("openfini-fa-{name}-{}", now_ms()));
        fs::create_dir_all(d.join("granted/sub")).unwrap();
        fs::create_dir_all(d.join("outside")).unwrap();
        fs::write(d.join("granted/a.txt"), b"hello").unwrap();
        fs::write(d.join("outside/secret.txt"), b"secret").unwrap();
        d
    }

    fn grant(root: &Path, write: bool) -> Vec<Grant> {
        vec![Grant {
            id: "g1".into(),
            path: fs::canonicalize(root)
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            write,
            created: 0,
        }]
    }

    fn s(p: PathBuf) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn reads_stay_inside_the_grant() {
        let d = sandbox("read");
        let g = grant(&d.join("granted"), false);
        assert!(resolve_existing(&g, &s(d.join("granted/a.txt"))).is_ok());
        assert!(resolve_existing(&g, &s(d.join("granted/sub"))).is_ok());
        let escape = d.join("granted/sub/../../outside/secret.txt");
        assert!(resolve_existing(&g, &s(escape))
            .unwrap_err()
            .contains("outside"));
        assert!(resolve_existing(&g, &s(d.join("outside/secret.txt"))).is_err());
        assert!(resolve_existing(&g, "relative/a.txt").is_err());
        // a sibling folder whose name starts like the grant is not inside it
        fs::create_dir_all(d.join("granted-evil")).unwrap();
        fs::write(d.join("granted-evil/x.txt"), b"x").unwrap();
        assert!(resolve_existing(&g, &s(d.join("granted-evil/x.txt"))).is_err());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn writes_need_scope_and_plain_names() {
        let d = sandbox("write");
        let ro = grant(&d.join("granted"), false);
        assert!(resolve_for_write(&ro, &s(d.join("granted/new.txt")))
            .unwrap_err()
            .contains("reading only"));
        let rw = grant(&d.join("granted"), true);
        let (t, _) = resolve_for_write(&rw, &s(d.join("granted/new/deeper/file.txt"))).unwrap();
        assert!(t.ends_with("file.txt"));
        assert!(resolve_for_write(&rw, &s(d.join("granted/a.txt"))).is_ok());
        assert!(resolve_for_write(&rw, &s(d.join("granted/sub")))
            .unwrap_err()
            .contains("folder"));
        assert!(
            resolve_for_write(&rw, &s(d.join("granted"))).is_err(),
            "the grant itself"
        );
        assert!(resolve_for_write(&rw, &s(d.join("outside/new.txt"))).is_err());
        let sneaky = format!(
            "{}{}missing{}..{}..{}outside{}x.txt",
            s(d.join("granted")),
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR
        );
        assert!(
            resolve_for_write(&rw, &sneaky).is_err(),
            "“..” in the part that does not exist"
        );
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape() {
        let d = sandbox("link");
        std::os::unix::fs::symlink(d.join("outside"), d.join("granted/link")).unwrap();
        std::os::unix::fs::symlink(d.join("outside/secret.txt"), d.join("granted/file-link"))
            .unwrap();
        let rw = grant(&d.join("granted"), true);
        assert!(resolve_existing(&rw, &s(d.join("granted/link/secret.txt"))).is_err());
        assert!(resolve_existing(&rw, &s(d.join("granted/file-link"))).is_err());
        assert!(resolve_for_write(&rw, &s(d.join("granted/link/new.txt"))).is_err());
        assert!(resolve_for_write(&rw, &s(d.join("granted/file-link"))).is_err());
        fs::hard_link(d.join("granted/a.txt"), d.join("granted/b.txt")).unwrap();
        assert!(resolve_for_write(&rw, &s(d.join("granted/a.txt")))
            .unwrap_err()
            .contains("hard links"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn display_strips_the_verbatim_prefix() {
        assert_eq!(display(Path::new(r"\\?\C:\Users\x")), r"C:\Users\x");
        assert_eq!(
            display(Path::new(r"\\?\UNC\server\share")),
            r"\\server\share"
        );
        assert_eq!(display(Path::new("/home/x")), "/home/x");
    }
}
