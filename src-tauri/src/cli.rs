//! Command-line handling: everything that must work before a window exists.
//!
//! - `openfini --version` and `openfini --help` print and exit without starting the app.
//! - `openfini <files...>` (and "Open with", file associations, `xdg-open`) turn arguments into
//!   absolute file paths. Plain paths and `file://` URLs are accepted; relative paths are resolved
//!   against the working directory of the process that was started, which for a second launch is sent
//!   along by the single-instance plugin.
//!
//! The functions here are plain Rust without Tauri types (except the `Url` parser), so they are covered by
//! unit tests (`cargo test`).

use std::path::{Path, PathBuf};

/// Text printed by `--help`.
pub const USAGE: &str = "\
OpenFini - a lightweight, open-source creative suite

Usage:
  openfini [OPTIONS] [FILE...]

Arguments:
  FILE...      Documents, images, other supported files or whole project folders to open.
               Paths and file:// URLs work. If OpenFini is already running, they open in that window.

Options:
  -h, --help       Print this help and exit
  -V, --version    Print the version and exit
";

/// What the process should do after looking at its arguments.
#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    /// Start the application (possibly with files to open).
    Run,
    /// Print this text and exit successfully.
    Print(String),
}

/// Decides between running the app and printing help or the version.
/// `args` are the arguments without the executable name. Everything after a bare `--` is a file.
pub fn action_for<I>(args: I, version: &str) -> Action
where
    I: IntoIterator<Item = String>,
{
    for arg in args {
        match arg.as_str() {
            "--" => break,
            "--help" | "-h" => return Action::Print(USAGE.to_string()),
            "--version" | "-V" => return Action::Print(format!("OpenFini {version}\n")),
            _ => {}
        }
    }
    Action::Run
}

/// Prints text for the command line. A release build on Windows is a GUI program without a console, so it
/// attaches to the console of the parent process (the shell that started it) first.
pub fn print(text: &str) {
    #[cfg(windows)]
    {
        use std::fs::OpenOptions;
        use std::io::Write;

        #[link(name = "kernel32")]
        extern "system" {
            fn AttachConsole(process_id: u32) -> i32;
        }
        const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
        // SAFETY: a plain Win32 call that takes no pointers; it fails harmlessly without a parent console.
        unsafe {
            AttachConsole(ATTACH_PARENT_PROCESS);
        }
        if let Ok(mut out) = OpenOptions::new().write(true).open("CONOUT$") {
            let _ = out.write_all(text.as_bytes());
            return;
        }
    }
    print!("{text}");
}

/// Turns command-line arguments (without the executable name) into file and folder paths.
///
/// Options (arguments starting with `-`, until a bare `--`) are skipped, and so is anything that is
/// neither an existing regular file nor an existing folder (the Explorer "Open folder with OpenFini" verb,
/// `open -a OpenFini <folder>` and "Open With" on a folder pass folders). Duplicates are dropped; the order is kept.
pub fn paths_from_args<I>(args: I, cwd: Option<&Path>) -> Vec<PathBuf>
where
    I: IntoIterator<Item = String>,
{
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut options_ended = false;
    for arg in args {
        if !options_ended {
            if arg == "--" {
                options_ended = true;
                continue;
            }
            if arg.starts_with('-') {
                continue;
            }
        }
        if let Some(path) = resolve_arg(&arg, cwd) {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    paths
}

/// One argument to an absolute path of an existing regular file or folder.
pub fn resolve_arg(arg: &str, cwd: Option<&Path>) -> Option<PathBuf> {
    if arg.is_empty() {
        return None;
    }
    let path = if arg.starts_with("file://") {
        // Handles percent-encoding (spaces, unicode) and Windows/UNC forms.
        tauri::Url::parse(arg).ok()?.to_file_path().ok()?
    } else if is_mangled_drive_root(arg) {
        // `"%V"` on a drive root arrives as `C:"` because Windows reads the `\"` of `"C:\"` as an escaped quote.
        PathBuf::from(format!("{}\\", &arg[..2]))
    } else {
        PathBuf::from(arg)
    };
    let path = match cwd {
        Some(cwd) if path.is_relative() => cwd.join(path),
        _ => path,
    };
    let path = std::path::absolute(path).ok()?;
    (path.is_file() || path.is_dir()).then_some(path)
}

/// `C:"`: a drive root whose trailing backslash swallowed the closing quote of the command line.
fn is_mangled_drive_root(arg: &str) -> bool {
    let bytes = arg.as_bytes();
    bytes.len() == 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'"'
}

/// The path as the frontend receives it: a folder gets a trailing path separator, a file stays as is. Files never
/// end with a separator, so the marker is unambiguous (the JS side strips it, see app/src/platform/open-paths.js).
pub fn mark_if_dir(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    if path.is_dir() && !text.ends_with(std::path::MAIN_SEPARATOR) && !text.ends_with('/') {
        format!("{text}{}", std::path::MAIN_SEPARATOR)
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    /// A fresh temporary folder that is removed again when dropped.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("openfini-cli-{}-{}", std::process::id(), name));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn version_and_help_are_handled_before_the_window() {
        assert_eq!(
            action_for(args(&["--version"]), "1.2.3"),
            Action::Print("OpenFini 1.2.3\n".into())
        );
        assert_eq!(
            action_for(args(&["-V"]), "1.2.3"),
            Action::Print("OpenFini 1.2.3\n".into())
        );
        assert_eq!(
            action_for(args(&["a.png", "--help"]), "1"),
            Action::Print(USAGE.into())
        );
        assert_eq!(action_for(args(&["-h"]), "1"), Action::Print(USAGE.into()));
        assert_eq!(action_for(args(&["a.png"]), "1"), Action::Run);
        assert_eq!(action_for(Vec::<String>::new(), "1"), Action::Run);
    }

    #[test]
    fn a_double_dash_ends_the_options() {
        assert_eq!(action_for(args(&["--", "--version"]), "1"), Action::Run);
    }

    #[test]
    fn resolves_paths_urls_and_relative_names() {
        let dir = TempDir::new("resolve");
        let file = dir.0.join("my file \u{e4}.ofini");
        fs::write(&file, b"x").unwrap();

        // plain absolute path
        assert_eq!(
            resolve_arg(file.to_str().unwrap(), None),
            Some(file.clone())
        );
        // relative to the working directory that was passed along
        assert_eq!(
            resolve_arg("my file \u{e4}.ofini", Some(&dir.0)),
            Some(file.clone())
        );
        // file:// URL with percent-encoded space and umlaut
        let url = tauri::Url::from_file_path(&file).unwrap();
        assert_eq!(resolve_arg(url.as_str(), None), Some(file.clone()));
    }

    #[test]
    fn ignores_missing_paths() {
        let dir = TempDir::new("ignore");
        assert_eq!(resolve_arg("does-not-exist.png", Some(&dir.0)), None);
        assert_eq!(resolve_arg("no-such-folder", Some(&dir.0)), None);
        assert_eq!(resolve_arg("", None), None);
        assert_eq!(resolve_arg("file://", None), None);
    }

    #[test]
    fn keeps_folders_as_launch_arguments() {
        let dir = TempDir::new("folders");
        let sub = dir.0.join("my project");
        fs::create_dir_all(&sub).unwrap();
        assert_eq!(resolve_arg(sub.to_str().unwrap(), None), Some(sub.clone()));
        assert_eq!(resolve_arg("my project", Some(&dir.0)), Some(sub.clone()));
        let url = tauri::Url::from_directory_path(&sub).unwrap();
        assert_eq!(
            resolve_arg(url.as_str(), None).map(|p| p.canonicalize().unwrap()),
            Some(sub.canonicalize().unwrap())
        );
    }

    #[test]
    fn marks_folders_with_a_trailing_separator() {
        let dir = TempDir::new("mark");
        let file = dir.0.join("a.png");
        fs::write(&file, b"x").unwrap();
        let marked = mark_if_dir(&dir.0);
        assert!(marked.ends_with(std::path::MAIN_SEPARATOR));
        assert_eq!(mark_if_dir(Path::new(&marked)), marked);
        assert_eq!(mark_if_dir(&file), file.to_string_lossy());
    }

    #[test]
    fn repairs_a_drive_root_with_a_swallowed_quote() {
        assert!(is_mangled_drive_root("C:\""));
        assert!(!is_mangled_drive_root("C:\\"));
        assert!(!is_mangled_drive_root("ab\""));
    }

    #[test]
    fn skips_options_removes_duplicates_and_keeps_order() {
        let dir = TempDir::new("list");
        let a = dir.0.join("a.png");
        let b = dir.0.join("b.svg");
        let dash = dir.0.join("-odd.png");
        let folder = dir.0.join("site");
        for f in [&a, &b, &dash] {
            fs::write(f, b"x").unwrap();
        }
        fs::create_dir_all(&folder).unwrap();
        let list = args(&[
            "--new-window",
            "-psn_0_12345",
            "b.svg",
            "site",
            "a.png",
            "b.svg",
            "missing.png",
            "site",
            "--",
            "-odd.png",
        ]);
        assert_eq!(
            paths_from_args(list, Some(&dir.0)),
            vec![b, folder, a, dash]
        );
    }
}
