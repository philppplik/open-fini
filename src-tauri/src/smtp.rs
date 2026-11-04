//! Built-in SMTP client for "Send by email": STARTTLS (port 587) or implicit TLS (465), AUTH PLAIN or
//! LOGIN, plain text body and attachments (MIME multipart, base64). Credentials are only sent over TLS
//! (or to a server on this computer). See netio.rs for certificates.

use std::io::{BufReader, Write};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::AppHandle;

use crate::netio::{self, brief, read_reply, Conn, NetError, NetResult, Trust};
use crate::wire;

/// Most providers refuse larger messages.
const MAX_ATTACHMENTS: usize = 25 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmtpTarget {
    host: String,
    port: Option<u16>,
    /// "starttls" (default), "tls" or "none".
    security: Option<String>,
    user: Option<String>,
    password: Option<String>,
    pinned_cert: Option<String>,
}

#[derive(Deserialize)]
pub struct Attachment {
    name: String,
    mime: Option<String>,
    data: String,
}

#[derive(Deserialize)]
pub struct Mail {
    from: String,
    to: Vec<String>,
    subject: String,
    text: String,
    #[serde(default)]
    attachments: Vec<Attachment>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Security {
    StartTls,
    Tls,
    None,
}

impl SmtpTarget {
    fn security(&self) -> Security {
        match self.security.as_deref() {
            Some("tls") => Security::Tls,
            Some("none") => Security::None,
            _ => Security::StartTls,
        }
    }
    fn port(&self) -> u16 {
        self.port
            .filter(|p| *p > 0)
            .unwrap_or(match self.security() {
                Security::Tls => 465,
                Security::StartTls => 587,
                Security::None => 25,
            })
    }
}

// ------------------------------------------------------------------ pure helpers (tested)

/// A plain `local@domain` address without spaces, angle brackets or control characters.
pub fn valid_address(a: &str) -> bool {
    let Some((local, domain)) = a.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains('@')
        && a.len() <= 254
        && !a
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || "<>(),;:\"[]\\".contains(c))
}

/// RFC 2047 encoded words for non-ASCII header text (chunks stay under 75 characters).
pub fn header_text(s: &str) -> String {
    let s: String = s.chars().filter(|c| !c.is_control()).collect();
    if s.is_ascii() {
        return s;
    }
    let mut words = Vec::new();
    let mut chunk = String::new();
    for c in s.chars() {
        if chunk.len() + c.len_utf8() > 45 {
            words.push(format!(
                "=?UTF-8?B?{}?=",
                wire::b64_encode(chunk.as_bytes())
            ));
            chunk.clear();
        }
        chunk.push(c);
    }
    if !chunk.is_empty() {
        words.push(format!(
            "=?UTF-8?B?{}?=",
            wire::b64_encode(chunk.as_bytes())
        ));
    }
    words.join("\r\n ")
}

/// `Thu, 29 Oct 2026 10:00:00 +0000` for seconds since 1970 (UTC).
pub fn rfc2822_date(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // civil-from-days (H. Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    const WD: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    const MON: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    format!(
        "{}, {:02} {} {} {:02}:{:02}:{:02} +0000",
        WD[days.rem_euclid(7) as usize],
        day,
        MON[(month - 1) as usize],
        year,
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

fn wrapped_b64(data: &[u8]) -> String {
    let enc = wire::b64_encode(data);
    let mut out = String::with_capacity(enc.len() + enc.len() / 76 * 2 + 2);
    for (i, c) in enc.chars().enumerate() {
        if i > 0 && i % 76 == 0 {
            out.push_str("\r\n");
        }
        out.push(c);
    }
    out
}

fn safe_mime(m: Option<&str>) -> &str {
    match m {
        Some(m)
            if m.contains('/')
                && m.len() < 100
                && m.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"/.+-_".contains(&c)) =>
        {
            m
        }
        _ => "application/octet-stream",
    }
}

fn disposition(name: &str) -> String {
    let clean: String = name.chars().filter(|c| !c.is_control()).collect();
    if clean.is_ascii() && !clean.contains(['"', '\\']) {
        return format!("attachment; filename=\"{clean}\"");
    }
    let pct: String = clean
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    format!("attachment; filename*=UTF-8''{pct}")
}

/// The whole message (CRLF line endings, not yet dot-stuffed).
pub fn build_message(
    mail: &Mail,
    files: &[(String, &str, Vec<u8>)],
    date: &str,
    token: &str,
) -> String {
    let domain = mail
        .from
        .split_once('@')
        .map_or("openfini.invalid", |(_, d)| d);
    let boundary = format!("=_openfini_{token}");
    let mut m = String::new();
    m.push_str(&format!("From: {}\r\n", mail.from));
    m.push_str(&format!("To: {}\r\n", mail.to.join(", ")));
    m.push_str(&format!("Subject: {}\r\n", header_text(&mail.subject)));
    m.push_str(&format!("Date: {date}\r\n"));
    m.push_str(&format!("Message-ID: <{token}@{domain}>\r\n"));
    m.push_str("MIME-Version: 1.0\r\n");
    m.push_str("User-Agent: OpenFini\r\n");
    m.push_str(&format!(
        "Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n"
    ));
    m.push_str("This is a multi-part message in MIME format.\r\n");
    m.push_str(&format!("--{boundary}\r\n"));
    m.push_str(
        "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n",
    );
    m.push_str(&wrapped_b64(mail.text.as_bytes()));
    m.push_str("\r\n");
    for (name, mime, bytes) in files {
        m.push_str(&format!("--{boundary}\r\n"));
        m.push_str(&format!(
            "Content-Type: {mime}; name=\"{}\"\r\n",
            header_text(name).replace(['"', '\\'], "_")
        ));
        m.push_str(&format!("Content-Disposition: {}\r\n", disposition(name)));
        m.push_str("Content-Transfer-Encoding: base64\r\n\r\n");
        m.push_str(&wrapped_b64(bytes));
        m.push_str("\r\n");
    }
    m.push_str(&format!("--{boundary}--\r\n"));
    m
}

/// SMTP transparency (RFC 5321 4.5.2): a line starting with "." gets another one; ends with CRLF.CRLF.
pub fn dot_stuff(msg: &str) -> String {
    let mut out = String::with_capacity(msg.len() + 8);
    for line in msg.split("\r\n") {
        if line.starts_with('.') {
            out.push('.');
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    while out.ends_with("\r\n\r\n") {
        out.truncate(out.len() - 2);
    }
    out.push_str(".\r\n");
    out
}

/// The SASL mechanisms an EHLO reply offers (`AUTH PLAIN LOGIN` or the old `AUTH=LOGIN`).
pub fn auth_mechanisms(ehlo: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in ehlo.lines() {
        let up = line.trim().to_ascii_uppercase();
        if let Some(rest) = up
            .strip_prefix("AUTH")
            .filter(|r| r.starts_with([' ', '=']))
        {
            out.extend(rest[1..].split_whitespace().map(str::to_string));
        }
    }
    out
}

fn has_cap(ehlo: &str, cap: &str) -> bool {
    ehlo.lines().any(|l| {
        l.split_whitespace()
            .next()
            .is_some_and(|w| w.eq_ignore_ascii_case(cap))
    })
}

fn loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

fn token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut h = RandomState::new().build_hasher();
    h.write_u128(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos()),
    );
    format!("{:016x}{:08x}", h.finish(), std::process::id())
}

// ------------------------------------------------------------------ session

struct Session {
    io: BufReader<Conn>,
    host: String,
    ehlo: String,
}

impl Session {
    fn send_line(&mut self, line: &str) -> NetResult<(u16, String)> {
        let c = self.io.get_mut();
        c.write_all(line.as_bytes())?;
        c.write_all(b"\r\n")?;
        c.flush()?;
        read_reply(&mut self.io)
    }

    fn expect(&mut self, line: &str, ok: &[u16], what: &str) -> NetResult<String> {
        if !netio::safe_arg(line) {
            return Err(NetError::Msg("Invalid characters in an address.".into()));
        }
        let (code, text) = self.send_line(line)?;
        if ok.contains(&code) {
            Ok(text)
        } else {
            Err(NetError::Msg(format!(
                "{what} failed ({code} {}).",
                brief(&text)
            )))
        }
    }

    fn hello(&mut self) -> NetResult<()> {
        let name = match self.io.get_ref().tcp().local_addr()?.ip() {
            std::net::IpAddr::V4(ip) => format!("[{ip}]"),
            std::net::IpAddr::V6(ip) => format!("[IPv6:{ip}]"),
        };
        self.ehlo = self.expect(&format!("EHLO {name}"), &[250], "Greeting the mail server")?;
        Ok(())
    }

    fn open(t: &SmtpTarget, trust: &Trust) -> NetResult<Session> {
        let host = t.host.trim().to_string();
        let tcp = netio::connect(&host, t.port())?;
        let conn = if t.security() == Security::Tls {
            netio::tls(tcp, &host, trust)?
        } else {
            Conn::Plain(tcp)
        };
        let mut s = Session {
            io: BufReader::new(conn),
            host,
            ehlo: String::new(),
        };
        let (code, text) = read_reply(&mut s.io)?;
        if code != 220 {
            return Err(NetError::Msg(format!(
                "The mail server is not ready ({code} {}).",
                brief(&text)
            )));
        }
        s.hello()?;
        if t.security() == Security::StartTls {
            if !has_cap(&s.ehlo, "STARTTLS") {
                return Err(NetError::Msg(
                    "The mail server does not offer STARTTLS. Try “TLS (port 465)” instead.".into(),
                ));
            }
            s.expect("STARTTLS", &[220], "Starting encryption")?;
            let Conn::Plain(tcp) = s.io.into_inner() else {
                return Err(NetError::Msg("unexpected TLS state".into()));
            };
            s.io = BufReader::new(netio::tls(tcp, &s.host, trust)?);
            s.hello()?;
        }
        Ok(s)
    }

    fn login(&mut self, user: &str, password: &str) -> NetResult<()> {
        if user.is_empty() {
            return Ok(());
        }
        if !self.io.get_ref().is_tls() && !loopback(&self.host) {
            return Err(NetError::Msg(
                "OpenFini sends a mail password only over an encrypted connection. Choose STARTTLS or TLS.".into(),
            ));
        }
        let mechs = auth_mechanisms(&self.ehlo);
        let refused = || NetError::Msg("The mail server refused the user name or password.".into());
        if mechs.iter().any(|m| m == "PLAIN") {
            let mut raw = vec![0u8];
            raw.extend_from_slice(user.as_bytes());
            raw.push(0);
            raw.extend_from_slice(password.as_bytes());
            let (code, _) = self.send_line(&format!("AUTH PLAIN {}", wire::b64_encode(&raw)))?;
            return if code == 235 { Ok(()) } else { Err(refused()) };
        }
        if mechs.iter().any(|m| m == "LOGIN") {
            if self.send_line("AUTH LOGIN")?.0 != 334 {
                return Err(refused());
            }
            if self.send_line(&wire::b64_encode(user.as_bytes()))?.0 != 334 {
                return Err(refused());
            }
            let (code, _) = self.send_line(&wire::b64_encode(password.as_bytes()))?;
            return if code == 235 { Ok(()) } else { Err(refused()) };
        }
        Err(NetError::Msg(
            "The mail server offers no sign-in method OpenFini supports (PLAIN or LOGIN).".into(),
        ))
    }

    fn quit(mut self) {
        let _ = self.send_line("QUIT");
        self.io.into_inner().finish();
    }
}

fn creds(t: &SmtpTarget) -> (String, String) {
    (
        t.user.clone().unwrap_or_default().trim().to_string(),
        t.password.clone().unwrap_or_default(),
    )
}

fn test(t: &SmtpTarget, trust: &Trust) -> NetResult<String> {
    let mut s = Session::open(t, trust)?;
    let (user, pass) = creds(t);
    s.login(&user, &pass)?;
    let tls = s.io.get_ref().is_tls();
    s.quit();
    Ok(match (tls, user.is_empty()) {
        (true, false) => "Connected and signed in (encrypted).".into(),
        (true, true) => "Connected (encrypted, no sign-in).".into(),
        (false, _) => "Connected (not encrypted).".into(),
    })
}

fn send(
    app: &AppHandle,
    job: &str,
    t: &SmtpTarget,
    mail: &Mail,
    trust: &Trust,
) -> NetResult<String> {
    if !valid_address(mail.from.trim()) {
        return Err(NetError::Msg("Enter a valid sender address.".into()));
    }
    if mail.to.is_empty() || mail.to.len() > 50 || !mail.to.iter().all(|a| valid_address(a.trim()))
    {
        return Err(NetError::Msg(
            "Enter valid recipient addresses (up to 50).".into(),
        ));
    }
    let mut files = Vec::new();
    let mut size = 0;
    for a in &mail.attachments {
        let bytes = wire::b64_decode(&a.data).map_err(NetError::Msg)?;
        size += bytes.len();
        files.push((a.name.clone(), safe_mime(a.mime.as_deref()), bytes));
    }
    if size > MAX_ATTACHMENTS {
        return Err(NetError::Msg("The attachments are larger than 25 MB, which most mail servers refuse. Share a link instead.".into()));
    }
    netio::progress(app, job, "Connecting to the mail server…".into(), 0, 3);
    let mut s = Session::open(t, trust)?;
    let (user, pass) = creds(t);
    s.login(&user, &pass)?;
    netio::check_cancel(job)?;
    s.expect(
        &format!("MAIL FROM:<{}>", mail.from.trim()),
        &[250],
        "Setting the sender",
    )?;
    for to in &mail.to {
        s.expect(
            &format!("RCPT TO:<{}>", to.trim()),
            &[250, 251],
            "Adding a recipient",
        )?;
    }
    s.expect("DATA", &[354], "Starting the message")?;
    netio::progress(app, job, "Sending the message…".into(), 1, 3);
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let msg = build_message(mail, &files, &rfc2822_date(secs), &token());
    let c = s.io.get_mut();
    c.write_all(dot_stuff(&msg).as_bytes())?;
    c.flush()?;
    let (code, text) = read_reply(&mut s.io)?;
    if code != 250 {
        return Err(NetError::Msg(format!(
            "The mail server did not accept the message ({code} {}).",
            brief(&text)
        )));
    }
    netio::progress(app, job, "Sent.".into(), 3, 3);
    s.quit();
    Ok(format!("Sent to {}.", mail.to.join(", ")))
}

/// Connects and signs in; sends nothing.
#[tauri::command]
pub async fn smtp_test(target: SmtpTarget) -> Result<String, String> {
    netio::blocking(move || {
        let pin = target.pinned_cert.clone();
        netio::with_trust(pin.as_deref(), |trust| test(&target, trust))
    })
    .await
}

/// Sends one message with attachments.
#[tauri::command]
pub async fn smtp_send(
    app: AppHandle,
    job: String,
    target: SmtpTarget,
    mail: Mail,
) -> Result<String, String> {
    netio::blocking(move || {
        let pin = target.pinned_cert.clone();
        netio::with_trust(pin.as_deref(), |trust| {
            send(&app, &job, &target, &mail, trust)
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses() {
        assert!(valid_address("me@example.org"));
        assert!(!valid_address("me@example"));
        assert!(!valid_address("me@.org"));
        assert!(!valid_address("me example@x.org"));
        assert!(!valid_address("me@x.org>\r\nRCPT TO:<y@z.org"));
        assert!(!valid_address("nobody"));
    }

    #[test]
    fn headers_and_dates() {
        assert_eq!(header_text("Hello"), "Hello");
        assert_eq!(header_text("Grüße"), "=?UTF-8?B?R3LDvMOfZQ==?=");
        assert!(header_text(&"ä".repeat(60)).contains("?=\r\n =?UTF-8?B?"));
        assert_eq!(rfc2822_date(0), "Thu, 01 Jan 1970 00:00:00 +0000");
        assert_eq!(
            rfc2822_date(1_709_210_096),
            "Thu, 29 Feb 2024 12:34:56 +0000"
        );
        assert_eq!(safe_mime(Some("application/pdf")), "application/pdf");
        assert_eq!(
            safe_mime(Some("text/html\r\nX: y")),
            "application/octet-stream"
        );
        assert_eq!(disposition("a.pdf"), "attachment; filename=\"a.pdf\"");
        assert_eq!(
            disposition("ü.pdf"),
            "attachment; filename*=UTF-8''%C3%BC.pdf"
        );
    }

    #[test]
    fn capabilities() {
        let ehlo = "mail.example\nPIPELINING\nSTARTTLS\nAUTH LOGIN PLAIN\nAUTH=LOGIN";
        assert!(has_cap(ehlo, "starttls"));
        assert!(!has_cap(ehlo, "SMTPUTF8"));
        assert_eq!(auth_mechanisms(ehlo), vec!["LOGIN", "PLAIN", "LOGIN"]);
        assert!(auth_mechanisms("mail\nAUTHX").is_empty());
    }

    #[test]
    fn message_and_transparency() {
        let mail = Mail {
            from: "me@example.org".into(),
            to: vec!["you@example.org".into()],
            subject: "Report".into(),
            text: "Hi".into(),
            attachments: Vec::new(),
        };
        let files = vec![("r.pdf".to_string(), "application/pdf", b"%PDF".to_vec())];
        let m = build_message(&mail, &files, "DATE", "tok");
        assert!(m.starts_with("From: me@example.org\r\nTo: you@example.org\r\nSubject: Report\r\n"));
        assert!(m.contains("Message-ID: <tok@example.org>"));
        assert!(m.contains("Content-Disposition: attachment; filename=\"r.pdf\""));
        assert!(m.contains("JVBERg=="));
        assert!(m.ends_with("--=_openfini_tok--\r\n"));
        assert_eq!(dot_stuff("a\r\n.b\r\n"), "a\r\n..b\r\n.\r\n");
        assert_eq!(dot_stuff("x"), "x\r\n.\r\n");
        assert_eq!(wrapped_b64(&[0u8; 60]).split("\r\n").count(), 2);
    }
}
