//! One-shot loopback listener for OAuth sign-in (OpenAI account, MCP servers).
//!
//! The frontend calls `oauth_loopback_start` (binds 127.0.0.1 and returns the port), opens the
//! provider's authorization page in the system browser, then calls `oauth_loopback_wait` which
//! returns the callback's query string. Only the first request that has the right path, a
//! loopback `Host` header and the exact `state` is accepted; everything else gets a 4xx answer
//! and the wait continues until the deadline. The listener serves exactly one successful
//! callback and is then dropped. Nothing is logged. See docs/openai-account-auth.md.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

/// How long a sign-in may take before the listener gives up.
const TIMEOUT: Duration = Duration::from_secs(120);

/// The bound listener between `start` and `wait`.
#[derive(Default)]
pub struct Loopback(Mutex<Option<TcpListener>>);

impl Loopback {
    fn slot(&self) -> MutexGuard<'_, Option<TcpListener>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Binds 127.0.0.1 (the preferred port when free, otherwise any free port) and returns the port.
#[tauri::command]
pub fn oauth_loopback_start(
    state: tauri::State<'_, Loopback>,
    preferred_port: Option<u16>,
) -> Result<u16, String> {
    let listener = preferred_port
        .and_then(|p| TcpListener::bind(("127.0.0.1", p)).ok())
        .map_or_else(|| TcpListener::bind(("127.0.0.1", 0)), Ok)
        .map_err(|e| format!("Could not open a local port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    *state.slot() = Some(listener);
    Ok(port)
}

/// Waits (up to two minutes) for the callback and returns its raw query string (without `?`).
#[tauri::command]
pub async fn oauth_loopback_wait(
    state: tauri::State<'_, Loopback>,
    path: String,
    expected_state: String,
) -> Result<String, String> {
    let listener = state.slot().take().ok_or("No sign-in is waiting.")?;
    let job = move || accept_callback(&listener, &path, &expected_state);
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| e.to_string())?
}

fn accept_callback(
    listener: &TcpListener,
    path: &str,
    expected_state: &str,
) -> Result<String, String> {
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                if let Some(query) = handle(&mut stream, path, expected_state, port) {
                    return Ok(query);
                }
            }
            Err(_) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
    Err("The sign-in timed out. Please try again.".into())
}

/// Reads one request. Returns the query string when it is a valid callback.
fn handle(stream: &mut TcpStream, path: &str, expected_state: &str, port: u16) -> Option<String> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).unwrap_or(0);
    let request = String::from_utf8_lossy(&buf[..n]).into_owned();
    match parse_callback(&request, path, expected_state, port) {
        Some(query) => {
            respond(stream, "200 OK", "Signed in. You can close this tab and return to OpenFini.");
            Some(query)
        }
        None => {
            respond(stream, "400 Bad Request", "This is not the expected sign-in callback.");
            None
        }
    }
}

/// Pure validation of the raw HTTP request (unit tested).
fn parse_callback(request: &str, path: &str, expected_state: &str, port: u16) -> Option<String> {
    let mut lines = request.split("\r\n");
    let mut first = lines.next()?.split(' ');
    if first.next()? != "GET" {
        return None;
    }
    let target = first.next()?;
    let (req_path, query) = target.split_once('?').unwrap_or((target, ""));
    if req_path != path || expected_state.is_empty() {
        return None;
    }
    // DNS-rebinding guard: only a loopback host name with our port.
    let host_ok = lines.any(|l| {
        let l = l.to_ascii_lowercase();
        l == format!("host: 127.0.0.1:{port}") || l == format!("host: localhost:{port}")
    });
    if !host_ok {
        return None;
    }
    let state_ok = query
        .split('&')
        .any(|kv| kv.split_once('=').is_some_and(|(k, v)| k == "state" && v == expected_state));
    state_ok.then(|| query.to_string())
}

fn respond(stream: &mut TcpStream, status: &str, message: &str) {
    let body = format!("<!doctype html><title>OpenFini</title><p style=\"margin:3rem\">{message}");
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n");
    let _ = write!(stream, "{head}Content-Length: {}\r\n\r\n{body}", body.len());
}

#[cfg(test)]
mod tests {
    use super::parse_callback;

    const OK: &str =
        "GET /auth/callback?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1:1455\r\n\r\n";

    #[test]
    fn accepts_the_expected_callback() {
        assert_eq!(
            parse_callback(OK, "/auth/callback", "xyz", 1455).as_deref(),
            Some("code=abc&state=xyz")
        );
    }

    #[test]
    fn rejects_wrong_state_path_host_and_method() {
        assert!(parse_callback(OK, "/auth/callback", "other", 1455).is_none());
        assert!(parse_callback(OK, "/callback", "xyz", 1455).is_none());
        assert!(parse_callback(OK, "/auth/callback", "xyz", 9999).is_none());
        let evil = OK.replace("127.0.0.1:1455", "evil.example:1455");
        assert!(parse_callback(&evil, "/auth/callback", "xyz", 1455).is_none());
        let post = OK.replace("GET", "POST");
        assert!(parse_callback(&post, "/auth/callback", "xyz", 1455).is_none());
        assert!(parse_callback(OK, "/auth/callback", "", 1455).is_none());
    }
}
