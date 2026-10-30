//! Shared plumbing of the built-in FTP/FTPS and SMTP clients: connecting with timeouts, TLS through
//! the operating system (`native-tls`: SChannel on Windows, Secure Transport on macOS, OpenSSL on
//! Linux; the system's trusted certificates), trust on first use for self-signed certificates,
//! line-based server replies, progress events and cancellation.
//!
//! Certificates: a connection first verifies normally. When that fails, a second "probe" connection
//! (which sends no credentials and no data) reads the server's certificate and the command fails with
//! `UNTRUSTED_CERT:<SHA-256>`. The app shows the fingerprint and, if the person trusts it, retries with
//! that fingerprint pinned: the certificate must then match exactly (`CERT_CHANGED:<SHA-256>` otherwise).
//! Passwords are never logged or put into error messages.

use std::collections::HashSet;
use std::io::{self, BufRead, Read, Write};
use std::net::{IpAddr, TcpStream, ToSocketAddrs};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use native_tls::{TlsConnector, TlsStream};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::wire;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const IO_TIMEOUT: Duration = Duration::from_secs(60);
/// Event with `{ job, text, done, total }` while an upload or a mail is sent.
pub const PROGRESS_EVENT: &str = "openfini://net-progress";

/// How the server's certificate is checked.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Trust {
    /// The operating system's trusted certificates and the host name.
    Verify,
    /// Exactly this certificate (SHA-256 fingerprint), accepted by the person earlier.
    Pin(String),
    /// Only read the certificate and stop (sends nothing else).
    Probe,
}

impl Trust {
    pub fn from_pin(pin: Option<&str>) -> Self {
        match pin.map(str::trim) {
            Some(p) if !p.is_empty() => Trust::Pin(p.to_string()),
            _ => Trust::Verify,
        }
    }
}

/// Errors of the network clients. `to_string` is what the app receives.
#[derive(Debug)]
pub enum NetError {
    Untrusted(String),
    Changed(String),
    Handshake(String),
    Cancelled,
    Msg(String),
}

impl std::fmt::Display for NetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NetError::Untrusted(fp) => write!(f, "UNTRUSTED_CERT:{fp}"),
            NetError::Changed(fp) => write!(f, "CERT_CHANGED:{fp}"),
            NetError::Handshake(m) => write!(f, "The secure connection failed: {m}"),
            NetError::Cancelled => write!(f, "CANCELLED"),
            NetError::Msg(m) => write!(f, "{m}"),
        }
    }
}

impl From<io::Error> for NetError {
    fn from(e: io::Error) -> Self {
        NetError::Msg(match e.kind() {
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => {
                "The server did not answer in time.".to_string()
            }
            io::ErrorKind::ConnectionRefused => {
                "The server refused the connection (wrong port, or the service is not running)."
                    .to_string()
            }
            _ => format!("Network error: {e}"),
        })
    }
}

pub type NetResult<T> = Result<T, NetError>;

/// A plain or TLS stream.
pub enum Conn {
    Plain(TcpStream),
    Tls(Box<TlsStream<TcpStream>>),
}

impl Read for Conn {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(s) => s.read(buf),
            Conn::Tls(s) => s.read(buf),
        }
    }
}

impl Write for Conn {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(s) => s.write(buf),
            Conn::Tls(s) => s.write(buf),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        match self {
            Conn::Plain(s) => s.flush(),
            Conn::Tls(s) => s.flush(),
        }
    }
}

impl Conn {
    pub fn tcp(&self) -> &TcpStream {
        match self {
            Conn::Plain(s) => s,
            Conn::Tls(s) => s.get_ref(),
        }
    }
    pub fn is_tls(&self) -> bool {
        matches!(self, Conn::Tls(_))
    }
    /// Ends the stream (TLS close_notify first).
    pub fn finish(self) {
        match self {
            Conn::Plain(s) => {
                let _ = s.shutdown(std::net::Shutdown::Write);
            }
            Conn::Tls(mut s) => {
                let _ = s.shutdown();
            }
        }
    }
}

/// Host names and arguments must not smuggle protocol lines.
pub fn safe_arg(s: &str) -> bool {
    !s.contains(['\r', '\n', '\0'])
}

/// TCP connection with timeouts.
pub fn connect(host: &str, port: u16) -> NetResult<TcpStream> {
    if host.is_empty() || !safe_arg(host) || host.contains(['/', ' ']) {
        return Err(NetError::Msg("Enter a valid server name.".into()));
    }
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|_| NetError::Msg(format!("The server name “{host}” could not be found.")))?;
    let mut last = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
            Ok(s) => return prepare(s),
            Err(e) => last = Some(e),
        }
    }
    Err(last.map_or_else(
        || NetError::Msg(format!("The server name “{host}” could not be found.")),
        NetError::from,
    ))
}

/// TCP connection to an address (FTP data channel).
pub fn connect_ip(ip: IpAddr, port: u16) -> NetResult<TcpStream> {
    prepare(TcpStream::connect_timeout(
        &(ip, port).into(),
        CONNECT_TIMEOUT,
    )?)
}

fn prepare(s: TcpStream) -> NetResult<TcpStream> {
    s.set_read_timeout(Some(IO_TIMEOUT))?;
    s.set_write_timeout(Some(IO_TIMEOUT))?;
    Ok(s)
}

/// Starts TLS on `tcp` according to `trust`.
pub fn tls(tcp: TcpStream, host: &str, trust: &Trust) -> NetResult<Conn> {
    let lenient = !matches!(trust, Trust::Verify);
    let connector = TlsConnector::builder()
        .danger_accept_invalid_certs(lenient)
        .danger_accept_invalid_hostnames(lenient)
        .build()
        .map_err(|e| NetError::Handshake(e.to_string()))?;
    let stream = connector
        .connect(host, tcp)
        .map_err(|e| NetError::Handshake(e.to_string()))?;
    if lenient {
        let der = stream
            .peer_certificate()
            .ok()
            .flatten()
            .and_then(|c| c.to_der().ok())
            .ok_or_else(|| NetError::Handshake("the server sent no certificate".into()))?;
        let fp = wire::fingerprint(&der);
        match trust {
            Trust::Probe => return Err(NetError::Untrusted(fp)),
            Trust::Pin(pin) if !same_fingerprint(pin, &fp) => return Err(NetError::Changed(fp)),
            _ => {}
        }
    }
    Ok(Conn::Tls(Box::new(stream)))
}

/// Compares fingerprints ignoring case and separators.
pub fn same_fingerprint(a: &str, b: &str) -> bool {
    let norm = |s: &str| -> String {
        s.chars()
            .filter(char::is_ascii_hexdigit)
            .map(|c| c.to_ascii_uppercase())
            .collect()
    };
    let (a, b) = (norm(a), norm(b));
    a.len() == 64 && a == b
}

/// Runs a session; when a normal verification fails, probes the certificate so the app can ask
/// whether to trust it.
pub fn with_trust<T>(pin: Option<&str>, run: impl Fn(&Trust) -> NetResult<T>) -> NetResult<T> {
    let trust = Trust::from_pin(pin);
    match run(&trust) {
        Err(NetError::Handshake(msg)) if trust == Trust::Verify => match run(&Trust::Probe) {
            Err(NetError::Untrusted(fp)) => Err(NetError::Untrusted(fp)),
            _ => Err(NetError::Handshake(msg)),
        },
        other => other,
    }
}

/// Reads one server reply in the FTP/SMTP format: `123 text`, or a multi-line reply that starts
/// with `123-` and ends with a line starting with `123 `. Returns the code and the joined text.
pub fn read_reply<R: BufRead>(r: &mut R) -> NetResult<(u16, String)> {
    let mut text = String::new();
    let mut code: Option<u16> = None;
    for _ in 0..1000 {
        let mut line = String::new();
        if r.read_line(&mut line)? == 0 {
            return Err(NetError::Msg("The server closed the connection.".into()));
        }
        let line = line.trim_end_matches(['\r', '\n']);
        let head: Option<u16> = line.get(..3).and_then(|c| c.parse().ok());
        let sep = line.as_bytes().get(3).copied();
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(line.get(4..).unwrap_or(""));
        match (code, head, sep) {
            (None, Some(c), Some(b'-')) => code = Some(c),
            (None, Some(c), _) => return Ok((c, text)),
            (Some(c), Some(h), Some(b' ')) | (Some(c), Some(h), None) if c == h => {
                return Ok((c, text))
            }
            (None, None, _) => {
                return Err(NetError::Msg("The server sent an invalid reply.".into()))
            }
            _ => {}
        }
    }
    Err(NetError::Msg("The server's reply is too long.".into()))
}

/// The server's reply text for an error message (short, single line).
pub fn brief(text: &str) -> String {
    let t: String = text
        .split('\n')
        .next()
        .unwrap_or("")
        .chars()
        .take(160)
        .collect();
    t.trim().to_string()
}

// ------------------------------------------------------------------ progress and cancel

#[derive(Serialize, Clone)]
struct Progress<'a> {
    job: &'a str,
    text: String,
    done: usize,
    total: usize,
}

/// Sends a progress event to the app.
pub fn progress(app: &AppHandle, job: &str, text: String, done: usize, total: usize) {
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            job,
            text,
            done,
            total,
        },
    );
}

static CANCELLED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Marks a running job as cancelled (checked between files).
#[tauri::command]
pub fn net_cancel(job: String) {
    CANCELLED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashSet::new)
        .insert(job);
}

/// Fails with `Cancelled` once the app has cancelled `job`.
pub fn check_cancel(job: &str) -> NetResult<()> {
    let mut g = CANCELLED.lock().unwrap_or_else(PoisonError::into_inner);
    if g.as_mut().is_some_and(|s| s.remove(job)) {
        return Err(NetError::Cancelled);
    }
    Ok(())
}

/// Runs blocking network work off the main thread.
pub async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> NetResult<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn replies() {
        let mut r = Cursor::new("220 ready\r\n");
        assert_eq!(read_reply(&mut r).unwrap(), (220, "ready".into()));
        let mut r =
            Cursor::new("250-mail.example\r\n250-STARTTLS\r\n250 AUTH PLAIN LOGIN\r\n331 next\r\n");
        let (c, t) = read_reply(&mut r).unwrap();
        assert_eq!(c, 250);
        assert_eq!(t, "mail.example\nSTARTTLS\nAUTH PLAIN LOGIN");
        assert_eq!(read_reply(&mut r).unwrap().0, 331);
        // FTP multi-line replies may contain lines without a code
        let mut r = Cursor::new("230-Welcome\r\n  to the server\r\n230 Logged in\r\n");
        assert_eq!(read_reply(&mut r).unwrap().0, 230);
        assert!(read_reply(&mut Cursor::new("")).is_err());
        assert!(read_reply(&mut Cursor::new("hello\r\n")).is_err());
    }

    #[test]
    fn fingerprints_and_args() {
        let fp = wire::fingerprint(b"x");
        assert!(same_fingerprint(&fp, &fp.to_lowercase().replace(':', "")));
        assert!(!same_fingerprint(&fp, &wire::fingerprint(b"y")));
        assert!(!same_fingerprint("", ""));
        assert!(safe_arg("/var/www"));
        assert!(!safe_arg("a\r\nDELE x"));
        assert_eq!(Trust::from_pin(Some(" ")), Trust::Verify);
        assert_eq!(brief("a\nb"), "a");
        assert_eq!(
            NetError::Untrusted("AA".into()).to_string(),
            "UNTRUSTED_CERT:AA"
        );
    }

    #[test]
    fn cancel_flag() {
        assert!(check_cancel("job-1").is_ok());
        net_cancel("job-1".into());
        assert!(matches!(check_cancel("job-1"), Err(NetError::Cancelled)));
        assert!(check_cancel("job-1").is_ok());
    }
}
