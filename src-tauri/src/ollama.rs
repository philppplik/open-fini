//! Native, streaming HTTP for the Ollama provider (desktop app). The web view's `fetch` is subject to CORS, and
//! Ollama only answers browser origins listed in `OLLAMA_ORIGINS`; the origin of this app's web view is
//! `tauri://localhost` (macOS, Linux) or `http://tauri.localhost` (Windows), which a default Ollama can refuse
//! (HTTP 403). Going through here removes that whole class of failures. The page (app/src/ai/ollama.js) owns the
//! settings; this side enforces again what must hold even if the page is wrong:
//!
//! - only `/api/...` and `/v1/...` paths, only GET, POST and DELETE, only the headers `Authorization`,
//!   `Content-Type` and `Accept`, a UTF-8 text body of at most 64 MiB (images travel as base64 inside JSON);
//! - the host must be this device or the local network (loopback, private, link-local and unique-local addresses,
//!   `localhost`, `*.local`, single-label names) over `http` or `https`, OR `ollama.com` / `*.ollama.com` over
//!   `https` with only public addresses. Every other host is refused, so this command is not a general
//!   local-network proxy;
//! - redirects are not followed (a 3xx comes back as it is), no cookies, `Accept-Encoding: identity`;
//! - the response is streamed to the page in chunks over a Tauri channel and can be cancelled with `net_cancel`.

use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::json;
use tauri::ipc::Channel;

use crate::netio::{self, Conn, NetError, NetResult, Trust};
use crate::webfetch::{is_local_name, is_public_ip, parse_head, parse_url, Target};
use crate::wire;

const MAX_BODY: usize = 64 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const USER_AGENT: &str = concat!("OpenFini/", env!("CARGO_PKG_VERSION"));

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaRequest {
    url: String,
    method: Option<String>,
    headers: Option<Vec<(String, String)>>,
    body: Option<String>,
    /// Idle timeout between two chunks of the answer in milliseconds (a model may need minutes to load).
    timeout_ms: Option<u64>,
    /// Cancellation key for `net_cancel`.
    job: Option<String>,
}

/// Whether the target is the person's own Ollama (local) or the hosted Ollama cloud (public).
#[derive(Debug, PartialEq, Eq)]
pub enum Kind {
    Local,
    Cloud,
}

/// Checks everything that can be checked without resolving the name. Pure, so it is unit tested.
pub fn check_request(
    url: &str,
    method: &str,
    headers: &[(String, String)],
) -> Result<(Target, Kind), String> {
    if !matches!(method, "GET" | "POST" | "DELETE") {
        return Err("Only GET, POST and DELETE are allowed.".into());
    }
    let t = parse_url(url)?;
    let path = t.path.split('?').next().unwrap_or("");
    let ok_path = (path.starts_with("/api/") || path.starts_with("/v1/"))
        && !path.contains("..")
        && !path.contains('\\')
        && !path.to_ascii_lowercase().contains("%2e");
    if !ok_path {
        return Err("Only the Ollama API (/api/ and /v1/) can be called.".into());
    }
    for (k, v) in headers {
        let k = k.to_ascii_lowercase();
        if !matches!(k.as_str(), "authorization" | "content-type" | "accept") {
            return Err(format!("The header “{k}” is not allowed."));
        }
        if !netio::safe_arg(v) || v.len() > 2048 {
            return Err("A header value contains characters that are not allowed.".into());
        }
    }
    let host = t.host.to_ascii_lowercase();
    if host == "ollama.com" || host.ends_with(".ollama.com") {
        if !t.tls {
            return Err("Ollama cloud needs https.".into());
        }
        return Ok((t, Kind::Cloud));
    }
    let local = match host.parse::<IpAddr>() {
        Ok(ip) => !is_public_ip(&ip),
        Err(_) => is_local_name(&host),
    };
    if local {
        return Ok((t, Kind::Local));
    }
    Err(format!(
        "“{host}” is not a local address or ollama.com; only your own Ollama and Ollama cloud can be reached from here."
    ))
}

/// Resolves the host; every address must suit `kind`, otherwise the name is refused.
fn resolve(t: &Target, kind: &Kind) -> Result<Vec<SocketAddr>, String> {
    let addrs: Vec<SocketAddr> = (t.host.as_str(), t.port)
        .to_socket_addrs()
        .map_err(|_| format!("The server name “{}” could not be found.", t.host))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("The server name “{}” could not be found.", t.host));
    }
    let want_public = *kind == Kind::Cloud;
    if let Some(bad) = addrs.iter().find(|a| is_public_ip(&a.ip()) != want_public) {
        return Err(format!(
            "“{}” resolves to {}, which is not allowed for this connection.",
            t.host,
            bad.ip()
        ));
    }
    Ok(addrs)
}

/// Incremental `Transfer-Encoding: chunked` decoder (bytes may arrive split anywhere).
#[derive(Default)]
pub struct Dechunker {
    buf: Vec<u8>,
    remaining: usize,
    in_data: bool,
    pub done: bool,
}

impl Dechunker {
    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<u8>, ()> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            if self.done {
                self.buf.clear();
                break;
            }
            if self.in_data {
                if self.remaining > 0 {
                    let n = self.remaining.min(self.buf.len());
                    if n == 0 {
                        break;
                    }
                    out.extend(self.buf.drain(..n));
                    self.remaining -= n;
                    if self.remaining > 0 {
                        break;
                    }
                }
                // the CRLF after the data
                if self.buf.len() < 2 {
                    break;
                }
                self.buf.drain(..2);
                self.in_data = false;
            } else {
                let Some(nl) = self.buf.windows(2).position(|w| w == b"\r\n") else {
                    if self.buf.len() > 1024 {
                        return Err(());
                    }
                    break;
                };
                let line = String::from_utf8_lossy(&self.buf[..nl]).to_string();
                let size = usize::from_str_radix(line.split(';').next().unwrap_or("").trim(), 16)
                    .map_err(|_| ())?;
                self.buf.drain(..nl + 2);
                if size == 0 {
                    self.done = true;
                } else {
                    self.remaining = size;
                    self.in_data = true;
                }
            }
        }
        Ok(out)
    }
}

fn invalid() -> NetError {
    NetError::Msg("The server sent an invalid response.".into())
}

fn run(req: OllamaRequest, on_event: &Channel<serde_json::Value>) -> NetResult<()> {
    let method = req.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    let headers = req.headers.clone().unwrap_or_default();
    let (t, kind) = check_request(&req.url, &method, &headers).map_err(NetError::Msg)?;
    let body = req.body.clone().unwrap_or_default();
    if body.len() > MAX_BODY {
        return Err(NetError::Msg("The request is too large.".into()));
    }
    let addrs = resolve(&t, &kind).map_err(NetError::Msg)?;
    let idle = Duration::from_millis(req.timeout_ms.unwrap_or(300_000).clamp(1_000, 900_000));
    let mut last = None;
    let mut tcp = None;
    for a in &addrs {
        match TcpStream::connect_timeout(a, CONNECT_TIMEOUT) {
            Ok(s) => {
                tcp = Some(s);
                break;
            }
            Err(e) => last = Some(e),
        }
    }
    let Some(tcp) = tcp else {
        return Err(last
            .map(NetError::from)
            .unwrap_or_else(|| NetError::Msg("Could not connect.".into())));
    };
    // short read slices so a cancel is noticed quickly; the idle limit is enforced by hand
    tcp.set_read_timeout(Some(Duration::from_millis(400)))?;
    tcp.set_write_timeout(Some(idle))?;
    let _ = tcp.set_nodelay(true);
    let mut conn = if t.tls {
        netio::tls(tcp, &t.host, &Trust::Verify)?
    } else {
        Conn::Plain(tcp)
    };
    let host_header = {
        let h = if t.host.contains(':') {
            format!("[{}]", t.host)
        } else {
            t.host.clone()
        };
        match (t.tls, t.port) {
            (true, 443) | (false, 80) => h,
            _ => format!("{h}:{}", t.port),
        }
    };
    let mut head = format!(
        "{method} {} HTTP/1.1\r\nHost: {host_header}\r\nUser-Agent: {USER_AGENT}\r\nAccept-Encoding: identity\r\nConnection: close\r\n",
        t.path
    );
    for (k, v) in &headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    if method != "GET" || !body.is_empty() {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");
    conn.write_all(head.as_bytes())?;
    conn.write_all(body.as_bytes())?;
    conn.flush()?;

    let job = req.job.clone().unwrap_or_default();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let mut got_head = false;
    let mut dechunk: Option<Dechunker> = None;
    let mut last_data = Instant::now();
    let mut total = 0usize;
    let send = |v: serde_json::Value| {
        let _ = on_event.send(v);
    };
    loop {
        if !job.is_empty() {
            netio::check_cancel(&job)?;
        }
        let n = match conn.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if last_data.elapsed() > idle {
                    return Err(NetError::Msg("The server did not answer in time.".into()));
                }
                continue;
            }
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.into()),
        };
        last_data = Instant::now();
        let data: Vec<u8> = if got_head {
            chunk[..n].to_vec()
        } else {
            buf.extend_from_slice(&chunk[..n]);
            let Some((status, headers, start)) = parse_head(&buf) else {
                if buf.len() > 64 * 1024 {
                    return Err(invalid());
                }
                continue;
            };
            let header = |name: &str| {
                headers
                    .iter()
                    .find(|(k, _)| k == name)
                    .map(|(_, v)| v.clone())
            };
            if header("transfer-encoding")
                .is_some_and(|v| v.to_ascii_lowercase().contains("chunked"))
            {
                dechunk = Some(Dechunker::default());
            }
            send(json!({
                "type": "head",
                "status": status,
                "contentType": header("content-type").unwrap_or_default(),
                "location": header("location"),
            }));
            got_head = true;
            let rest = buf[start..].to_vec();
            buf.clear();
            rest
        };
        let payload = match dechunk.as_mut() {
            Some(d) => d.feed(&data).map_err(|()| invalid())?,
            None => data,
        };
        if !payload.is_empty() {
            total += payload.len();
            if total > MAX_BODY {
                return Err(NetError::Msg("The response is too large.".into()));
            }
            send(json!({ "type": "chunk", "data": wire::b64_encode(&payload) }));
        }
        if dechunk.as_ref().is_some_and(|d| d.done) {
            break;
        }
    }
    if !got_head {
        return Err(invalid());
    }
    conn.finish();
    send(json!({ "type": "end" }));
    Ok(())
}

/// One request to Ollama, answered as a stream of `head`, `chunk` (base64) and `end` events.
#[tauri::command]
pub async fn ollama_fetch(
    request: OllamaRequest,
    on_event: Channel<serde_json::Value>,
) -> Result<(), String> {
    netio::blocking(move || run(request, &on_event)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(url: &str) -> Result<Kind, String> {
        check_request(url, "GET", &[]).map(|(_, k)| k)
    }

    #[test]
    fn local_and_cloud_hosts_are_allowed() {
        assert_eq!(ok("http://127.0.0.1:11434/api/tags"), Ok(Kind::Local));
        assert_eq!(ok("http://localhost:11434/api/version"), Ok(Kind::Local));
        assert_eq!(ok("http://[::1]:11434/api/tags"), Ok(Kind::Local));
        assert_eq!(ok("http://192.168.1.20:11434/v1/models"), Ok(Kind::Local));
        assert_eq!(ok("http://my-nas:11434/api/tags"), Ok(Kind::Local));
        assert_eq!(ok("https://ollama.com/api/tags"), Ok(Kind::Cloud));
        assert_eq!(ok("https://api.ollama.com/api/tags"), Ok(Kind::Cloud));
    }

    #[test]
    fn everything_else_is_refused() {
        assert!(ok("http://example.com/api/tags").is_err());
        assert!(ok("https://8.8.8.8/api/tags").is_err());
        assert!(ok("http://ollama.com/api/tags").is_err());
        assert!(ok("https://ollama.com.evil.example/api/tags").is_err());
        assert!(ok("https://notollama.com/api/tags").is_err());
        assert!(ok("http://localhost:11434/").is_err());
        assert!(ok("http://localhost:11434/admin").is_err());
        assert!(ok("http://localhost:11434/api/../etc").is_err());
        assert!(ok("http://localhost:11434/api/%2e%2e/x").is_err());
        assert!(ok("file:///etc/passwd").is_err());
        assert!(ok("http://user:pw@localhost:11434/api/tags").is_err());
        assert!(check_request("http://localhost/api/tags", "PUT", &[]).is_err());
        let bad = vec![("Cookie".to_string(), "a=b".to_string())];
        assert!(check_request("http://localhost/api/tags", "GET", &bad).is_err());
        let good = vec![("Authorization".to_string(), "Bearer abc".to_string())];
        assert!(check_request("https://ollama.com/api/tags", "GET", &good).is_ok());
    }

    #[test]
    fn dechunker_handles_split_input() {
        let wire = b"5\r\nhello\r\n6;x=1\r\n world\r\n0\r\n\r\n";
        for split in 1..wire.len() {
            let mut d = Dechunker::default();
            let mut out = d.feed(&wire[..split]).unwrap();
            out.extend(d.feed(&wire[split..]).unwrap());
            assert_eq!(out, b"hello world", "split at {split}");
            assert!(d.done);
        }
        assert!(Dechunker::default().feed(b"zz\r\n").is_err());
    }
}
