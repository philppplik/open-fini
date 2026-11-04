//! Compiling LaTeX with a TeX engine installed on this computer (pdflatex, xelatex, lualatex, latexmk,
//! tectonic). The engine is looked up on PATH and started directly (never through a shell) with a fixed
//! argument list: non-interactive, stop on the first error, shell escape off (`-no-shell-escape`,
//! tectonic `--untrusted`, `shell_escape=f`), file access restricted to the build folder
//! (`openout_any=p`, `openin_any=p`). The project's files are written to a fresh temporary folder,
//! the run is killed after a timeout, and the folder is removed afterwards. Mirrors `engineArgs` in
//! `app/src/engine/web/latex-tools.js`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::preview_server::{random_token, safe_path, PutFile};
use crate::wire::{b64_decode, b64_encode};

pub const ENGINES: [&str; 5] = ["latexmk", "pdflatex", "xelatex", "lualatex", "tectonic"];
const MAX_TIMEOUT: u64 = 600;

/// True for a relative `.tex` path made of safe characters, without `..`, not starting with `-` or `/`.
pub fn safe_main(main: &str) -> bool {
    main.ends_with(".tex")
        && !main.starts_with('-')
        && !main.starts_with('/')
        && main.split('/').all(|p| p != "..")
        && main
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_./ -".contains(c))
}

/// The allow-listed arguments for an engine, or None for unknown engines and unsafe file names.
pub fn engine_args(engine: &str, main: &str) -> Option<Vec<String>> {
    if !ENGINES.contains(&engine) || !safe_main(main) {
        return None;
    }
    let common = [
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        "-no-shell-escape",
    ];
    let mut v: Vec<String> = match engine {
        "tectonic" => ["-X", "compile", "--keep-logs", "--untrusted"]
            .iter()
            .map(|s| s.to_string())
            .collect(),
        "latexmk" => std::iter::once("-pdf")
            .chain(common)
            .map(String::from)
            .collect(),
        _ => common.iter().map(|s| s.to_string()).collect(),
    };
    v.push(main.to_string());
    Some(v)
}

/// Finds an executable on PATH (with `.exe` on Windows).
pub fn which(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|d| d.join(&exe))
        .find(|p| p.is_file())
}

/// The TeX engines found on PATH.
#[tauri::command(async)]
pub fn latex_engines() -> Vec<String> {
    ENGINES
        .iter()
        .filter(|e| which(e).is_some())
        .map(|e| e.to_string())
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    ok: bool,
    code: Option<i32>,
    timed_out: bool,
    log: String,
    pdf: Option<String>,
}

fn write_files(dir: &Path, files: Vec<PutFile>) -> Result<(), String> {
    for f in files {
        let rel = safe_path(&f.path).ok_or_else(|| format!("Unsafe path {}", f.path))?;
        let target = dir.join(&rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, b64_decode(&f.data)?).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn run(engine: &str, main: &str, dir: &Path, timeout: Duration) -> Result<CompileResult, String> {
    let args = engine_args(engine, main).ok_or("This engine or file name is not allowed.")?;
    let exe = which(engine).ok_or_else(|| format!("{engine} was not found on this computer."))?;
    let out = fs::File::create(dir.join(".openfini-output.txt")).map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    let mut child = Command::new(exe)
        .args(&args)
        .current_dir(dir)
        .env("openout_any", "p")
        .env("openin_any", "p")
        .env("shell_escape", "f")
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err)
        .spawn()
        .map_err(|e| format!("Could not start {engine}: {e}"))?;
    let start = Instant::now();
    let (code, timed_out) = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break (st.code(), false);
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            break (None, true);
        }
        thread::sleep(Duration::from_millis(100));
    };
    let stem = main.strip_suffix(".tex").unwrap_or(main);
    let log = fs::read(dir.join(format!("{stem}.log")))
        .or_else(|_| fs::read(dir.join(".openfini-output.txt")))
        .unwrap_or_default();
    let pdf = fs::read(dir.join(format!("{stem}.pdf")))
        .ok()
        .map(|b| b64_encode(&b));
    Ok(CompileResult {
        ok: code == Some(0) && pdf.is_some(),
        code,
        timed_out,
        log: String::from_utf8_lossy(&log).into_owned(),
        pdf,
    })
}

/// Compiles `main` from `files` (project-relative paths, base64 bytes) with `engine`; returns the log and the PDF.
#[tauri::command(async)]
pub fn latex_compile(
    engine: String,
    main: String,
    files: Vec<PutFile>,
    timeout_secs: Option<u64>,
) -> Result<CompileResult, String> {
    if engine_args(&engine, &main).is_none() {
        return Err("This engine or file name is not allowed.".into());
    }
    let dir = std::env::temp_dir().join(format!("openfini-latex-{}", random_token()));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let result = write_files(&dir, files).and_then(|_| {
        run(
            &engine,
            &main,
            &dir,
            Duration::from_secs(timeout_secs.unwrap_or(90).clamp(5, MAX_TIMEOUT)),
        )
    });
    let _ = fs::remove_dir_all(&dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_are_allow_listed() {
        assert_eq!(
            engine_args("pdflatex", "main.tex").unwrap(),
            [
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-file-line-error",
                "-no-shell-escape",
                "main.tex"
            ]
        );
        assert_eq!(engine_args("latexmk", "a/b.tex").unwrap()[0], "-pdf");
        assert!(engine_args("tectonic", "main.tex")
            .unwrap()
            .contains(&"--untrusted".to_string()));
        assert!(engine_args("sh", "main.tex").is_none());
        for bad in [
            "-shell-escape.tex",
            "../x.tex",
            "/etc/x.tex",
            "a;b.tex",
            "main.txt",
            "x$(y).tex",
            "a/../b.tex",
        ] {
            assert!(engine_args("pdflatex", bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn files_stay_in_the_build_folder() {
        let dir = std::env::temp_dir().join(format!("of-tex-{}", random_token()));
        fs::create_dir_all(&dir).unwrap();
        let ok = write_files(
            &dir,
            vec![PutFile {
                path: "ch/a.tex".into(),
                data: b64_encode(b"x"),
            }],
        );
        assert!(ok.is_ok() && dir.join("ch/a.tex").is_file());
        assert!(write_files(
            &dir,
            vec![PutFile {
                path: "../evil.tex".into(),
                data: b64_encode(b"x")
            }]
        )
        .is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
