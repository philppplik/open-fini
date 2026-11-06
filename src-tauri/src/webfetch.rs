//! Native GET for the assistant's web tools (desktop app). The web view's `fetch` cannot read pages without CORS
//! headers, so `fetch_page`, `scrape_page`, `crawl_site`, `download_image` and the keyless web search go through here.
//! The page (app/src/vibe/web-access.js) still owns the policy: the switch, per-domain approval, block lists, limits
//! and the untrusted-content wrapping. This side enforces again what must hold even if the page is wrong:
//!
//! - only `http` and `https`, no user info, no control characters, default ports or 1-65535;
//! - the host name is resolved here and EVERY resolved address must be public (no loopback, private, link-local,
//!   CGNAT, multicast, documentation or unspecified ranges, also IPv4-mapped IPv6); the connection goes to the checked
//!   address, so DNS rebinding between check and connect is not possible;
//! - redirects are NOT followed: a 3xx comes back with its `Location`, and the page checks and approves every hop;
//! - no cookies, no credentials, no `Referer`, `Accept-Encoding: identity`, an honest `User-Agent`;
//! - a size cap (at most 25 MiB) and a time limit (at most 60 s) for the whole request.

use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::netio::{self, Conn, NetError, NetResult, Trust};
use crate::wire;

const MAX_BYTES: usize = 25 * 1024 * 1024;
const MAX_TIMEOUT_MS: u64 = 60_000;
const MAX_HEAD: usize = 64 * 1024;
const USER_AGENT: &str = concat!(
    "OpenFini/",
    env!("CARGO_PKG_VERSION"),
    " (assistant web tools; +https://github.com/philppplik/open-fini)"
);

/// A parsed request target.
#[derive(Debug, PartialEq, Eq)]
pub struct Target {
    pub tls: bool,
    pub host: String,
    pub port: u16,
    /// Path and query, always starting with `/`.
    pub path: String,
}

/// Parses an absolute http(s) URL. Fragments are dropped; IPv6 literals keep their brackets out of `host`.
pub fn parse_url(url: &str) -> Result<Target, String> {
    if url.len() > 8192 || url.chars().any(|c| c.is_control() || c == ' ') {
        return Err("The address contains characters that are not allowed.".into());
    }
    let (tls, rest) = if let Some(r) = strip_prefix_ci(url, "https://") {
        (true, r)
    } else if let Some(r) = strip_prefix_ci(url, "http://") {
        (false, r)
    } else {
        return Err("Only http and https addresses are allowed.".into());
    };
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    let mut path = rest[end..].split('#').next().unwrap_or("").to_string();
    if path.is_empty() || path.starts_with('?') {
        path.insert(0, '/');
    }
    if authority.contains('@') {
        return Err("Addresses with a user name or password are not allowed.".into());
    }
    let (host, port) = if let Some(v6) = authority.strip_prefix('[') {
        let close = v6
            .find(']')
            .ok_or("The address has an invalid IPv6 host.")?;
        let after = &v6[close + 1..];
        let port = match after.strip_prefix(':') {
            Some(p) => Some(p),
            None if after.is_empty() => None,
            None => return Err("The address has an invalid IPv6 host.".into()),
        };
        (v6[..close].to_string(), port)
    } else {
        match authority.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), Some(p)),
            None => (authority.to_string(), None),
        }
    };
    let port = match port {
        Some(p) => p
            .parse::<u16>()
            .ok()
            .filter(|&n| n > 0)
            .ok_or("The address has an invalid port.")?,
        None if tls => 443,
        None => 80,
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        return Err("The address has no host.".into());
    }
    if !host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | ':' | '_'))
    {
        return Err("Host names must be ASCII (punycode for international names).".into());
    }
    Ok(Target {
        tls,
        host,
        port,
        path,
    })
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    (s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix))
        .then(|| &s[prefix.len()..])
}

/// Names that always mean "this device or the local network".
pub fn is_local_name(host: &str) -> bool {
    host == "localhost"
        || [".localhost", ".local", ".internal", ".lan", ".home.arpa"]
            .iter()
            .any(|s| host.ends_with(s))
        || (!host.contains('.') && !host.contains(':'))
}

/// True for addresses on the public internet.
pub fn is_public_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, c, _] = v4.octets();
            !(a == 0
                || a == 10
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 192 && b == 0 && (c == 0 || c == 2))
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || a >= 224)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_ip(&IpAddr::V4(v4));
            }
            let s = v6.segments();
            !(v6.is_unspecified()
                || v6.is_loopback()
                || (s[0] & 0xfe00) == 0xfc00 // unique local
                || (s[0] & 0xffc0) == 0xfe80 // link local
                || (s[0] & 0xff00) == 0xff00 // multicast
                || (s[0] == 0x2001 && s[1] == 0x0db8) // documentation
                || (s[0] == 0 && s[1] == 0 && s[2] == 0 && s[3] == 0 && s[4] == 0 && s[5] == 0))
            // IPv4-compatible
        }
    }
}

/// Resolves `host` and returns the first address, only when every address is public.
fn resolve_public(host: &str, port: u16) -> Result<SocketAddr, String> {
    if is_local_name(host) {
        return Err(format!(
            "“{host}” is a local address; the assistant cannot reach your own device or network."
        ));
    }
    let addrs: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|_| format!("The server name “{host}” could not be found."))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("The server name “{host}” could not be found."));
    }
    if let Some(bad) = addrs.iter().find(|a| !is_public_ip(&a.ip())) {
        return Err(format!(
            "“{host}” resolves to {}, a private, loopback or link-local address; it is blocked.",
            bad.ip()
        ));
    }
    Ok(addrs[0])
}

/// A parsed response head: (status, headers with lower-case names, body offset).
pub type Head = (u16, Vec<(String, String)>, usize);

/// Parses the status line and headers of a response; None until the head is complete or when it is not HTTP/1.x.
pub fn parse_head(buf: &[u8]) -> Option<Head> {
    let end = buf.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&buf[..end]).ok()?;
    let mut lines = head.split("\r\n");
    let status_line = lines.next()?;
    let mut parts = status_line.splitn(3, ' ');
    let proto = parts.next()?;
    if !proto.starts_with("HTTP/1.") {
        return None;
    }
    let status = parts.next()?.parse::<u16>().ok()?;
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    Some((status, headers, end + 4))
}

/// Decodes a `Transfer-Encoding: chunked` body (trailers are ignored). `complete` is false when it was cut short.
pub fn dechunk(body: &[u8]) -> (Vec<u8>, bool) {
    let mut out = Vec::with_capacity(body.len());
    let mut i = 0;
    loop {
        let Some(nl) = body[i..].windows(2).position(|w| w == b"\r\n") else {
            return (out, false);
        };
        let line = String::from_utf8_lossy(&body[i..i + nl]);
        let size_hex = line.split(';').next().unwrap_or("").trim();
        let Ok(size) = usize::from_str_radix(size_hex, 16) else {
            return (out, false);
        };
        i += nl + 2;
        if size == 0 {
            return (out, true);
        }
        if i + size > body.len() {
            out.extend_from_slice(&body[i..]);
            return (out, false);
        }
        out.extend_from_slice(&body[i..i + size]);
        i += size + 2;
        if i > body.len() {
            return (out, false);
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebGet {
    url: String,
    accept: Option<String>,
    max_bytes: Option<usize>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebResponse {
    status: u16,
    url: String,
    content_type: String,
    location: Option<String>,
    /// Body as base64 (the page decodes it; text and images alike).
    body: String,
    truncated: bool,
}

fn get(req: &WebGet) -> NetResult<WebResponse> {
    let t = parse_url(&req.url).map_err(NetError::Msg)?;
    let addr = resolve_public(&t.host, t.port).map_err(NetError::Msg)?;
    let limit = req.max_bytes.unwrap_or(2 * 1024 * 1024).min(MAX_BYTES);
    let timeout = Duration::from_millis(
        req.timeout_ms
            .unwrap_or(15_000)
            .clamp(1_000, MAX_TIMEOUT_MS),
    );
    let started = Instant::now();
    let tcp = TcpStream::connect_timeout(&addr, timeout)?;
    tcp.set_read_timeout(Some(timeout))?;
    tcp.set_write_timeout(Some(timeout))?;
    let mut conn = if t.tls {
        netio::tls(tcp, &t.host, &Trust::Verify)?
    } else {
        Conn::Plain(tcp)
    };
    let host_header = match (t.tls, t.port) {
        (true, 443) | (false, 80) => t.host.clone(),
        _ => format!("{}:{}", t.host, t.port),
    };
    let host_header = if t.host.contains(':') {
        format!("[{}]", host_header)
    } else {
        host_header
    };
    let accept = req
        .accept
        .as_deref()
        .filter(|a| netio::safe_arg(a) && a.len() < 300)
        .unwrap_or("text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5");
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {host_header}\r\nUser-Agent: {USER_AGENT}\r\nAccept: {accept}\r\nAccept-Language: en;q=0.8,*;q=0.5\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n",
        t.path
    );
    conn.write_all(request.as_bytes())?;
    conn.flush()?;

    let mut buf = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let mut head = None;
    let mut truncated = false;
    loop {
        if started.elapsed() > timeout {
            return Err(NetError::Msg(format!(
                "The request timed out after {} seconds.",
                timeout.as_secs()
            )));
        }
        let n = match conn.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            // servers that close without TLS close_notify
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.into()),
        };
        buf.extend_from_slice(&chunk[..n]);
        if head.is_none() {
            head = parse_head(&buf);
            if head.is_none() && buf.len() > MAX_HEAD {
                return Err(NetError::Msg("The server sent an invalid response.".into()));
            }
        }
        if let Some((_, _, start)) = head.as_ref() {
            // chunked framing adds a little overhead; allow some slack before cutting
            if buf.len() - start > limit + limit / 16 + 1024 {
                truncated = true;
                break;
            }
        }
    }
    let (status, headers, start) =
        head.ok_or_else(|| NetError::Msg("The server sent an invalid response.".into()))?;
    let header = |name: &str| {
        headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    };
    let raw = &buf[start..];
    let mut body = if header("transfer-encoding")
        .is_some_and(|v| v.to_ascii_lowercase().contains("chunked"))
    {
        let (b, complete) = dechunk(raw);
        truncated |= !complete;
        b
    } else {
        raw.to_vec()
    };
    if body.len() > limit {
        body.truncate(limit);
        truncated = true;
    }
    conn.finish();
    Ok(WebResponse {
        status,
        url: req.url.clone(),
        content_type: header("content-type").unwrap_or_default(),
        location: header("location"),
        body: wire::b64_encode(&body),
        truncated,
    })
}

/// One GET without following redirects (see the module docs for what is enforced here).
#[tauri::command]
pub async fn web_get(request: WebGet) -> Result<WebResponse, String> {
    netio::blocking(move || get(&request)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn urls_parse_and_refuse() {
        let t = parse_url("https://Example.org/a/b?q=1#frag").unwrap();
        assert_eq!(
            t,
            Target {
                tls: true,
                host: "example.org".into(),
                port: 443,
                path: "/a/b?q=1".into()
            }
        );
        assert_eq!(parse_url("http://example.org").unwrap().path, "/");
        assert_eq!(parse_url("http://example.org?x=1").unwrap().path, "/?x=1");
        assert_eq!(parse_url("http://example.org:8080/").unwrap().port, 8080);
        assert_eq!(
            parse_url("http://[2606:4700::1]:81/x").unwrap().host,
            "2606:4700::1"
        );
        for bad in [
            "ftp://example.org/",
            "file:///etc/passwd",
            "https://user:pw@example.org/",
            "https://example.org:0/",
            "https://example.org:99999/",
            "https://exa mple.org/",
            "https://example.org/\r\nHost: evil",
            "https://bücher.de/",
            "https:///nohost",
        ] {
            assert!(parse_url(bad).is_err(), "{bad} must be refused");
        }
    }

    #[test]
    fn private_addresses_are_not_public() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "192.0.2.1",
        ] {
            assert!(!is_public_ip(&ip.parse::<IpAddr>().unwrap()), "{ip}");
        }
        for ip in [
            "::1",
            "::",
            "fc00::1",
            "fd12::1",
            "fe80::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "2001:db8::1",
            "::127.0.0.1",
        ] {
            assert!(!is_public_ip(&ip.parse::<IpAddr>().unwrap()), "{ip}");
        }
        assert!(is_public_ip(&IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))));
        assert!(is_public_ip(&IpAddr::V6(
            "2606:4700::1111".parse::<Ipv6Addr>().unwrap()
        )));
        assert!(
            is_local_name("localhost")
                && is_local_name("printer.local")
                && is_local_name("intranet")
        );
        assert!(!is_local_name("example.org"));
        assert!(resolve_public("localhost", 80).is_err());
        assert!(resolve_public("127.0.0.1", 80).is_err());
    }

    #[test]
    fn heads_and_chunks() {
        let raw = b"HTTP/1.1 301 Moved\r\nLocation: https://example.org/x\r\nContent-Type: text/html; charset=utf-8\r\n\r\nbody";
        let (status, headers, start) = parse_head(raw).unwrap();
        assert_eq!(status, 301);
        assert!(headers.contains(&("location".into(), "https://example.org/x".into())));
        assert_eq!(&raw[start..], b"body");
        assert!(parse_head(b"SSH-2.0-OpenSSH\r\n\r\n").is_none());
        assert!(parse_head(b"HTTP/1.1 200 OK\r\n").is_none());
        let (b, complete) = dechunk(b"4\r\nWiki\r\n5;ext=1\r\npedia\r\n0\r\n\r\n");
        assert_eq!(b, b"Wikipedia");
        assert!(complete);
        let (b, complete) = dechunk(b"4\r\nWiki\r\n5\r\nped");
        assert_eq!(b, b"Wikiped");
        assert!(!complete);
    }
}
