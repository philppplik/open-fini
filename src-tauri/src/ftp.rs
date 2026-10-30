//! Built-in FTP client for Publish: plain FTP, FTPS with explicit TLS (`AUTH TLS`, RFC 4217) and
//! implicit TLS (port 990). Passive mode only (EPSV, then PASV); the data connection always goes to
//! the control connection's server address (the address in a PASV reply is ignored, which also rules
//! out FTP bounce tricks). Binary transfers, folders created with MKD. See netio.rs for certificates.

use std::io::{BufReader, Write};
use std::net::IpAddr;

use serde::Deserialize;
use tauri::AppHandle;

use crate::netio::{self, brief, read_reply, Conn, NetError, NetResult, Trust};
use crate::wire;

/// A server from a Publish target. The password comes from the app's vault for this call only.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpTarget {
    host: String,
    port: Option<u16>,
    /// "explicit" (default), "implicit" or "none".
    security: Option<String>,
    user: String,
    password: String,
    remote_path: Option<String>,
    pinned_cert: Option<String>,
}

/// One file of the site (base64, path relative to the remote folder).
#[derive(Deserialize)]
pub struct UploadFile {
    path: String,
    data: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Security {
    Explicit,
    Implicit,
    None,
}

impl FtpTarget {
    fn security(&self) -> Security {
        match self.security.as_deref() {
            Some("none") => Security::None,
            Some("implicit") => Security::Implicit,
            _ => Security::Explicit,
        }
    }
    fn port(&self) -> u16 {
        self.port
            .filter(|p| *p > 0)
            .unwrap_or(match self.security() {
                Security::Implicit => 990,
                _ => 21,
            })
    }
}

// ------------------------------------------------------------------ pure helpers (tested)

/// Port from `229 Entering Extended Passive Mode (|||6446|)`.
pub fn parse_epsv(text: &str) -> Option<u16> {
    let inner = &text[text.find('(')? + 1..text.rfind(')')?];
    let d = inner.chars().next()?;
    let parts: Vec<&str> = inner.split(d).collect();
    if parts.len() != 5 {
        return None;
    }
    parts[3].parse().ok().filter(|p| *p > 0)
}

/// Port from `227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)` (the address is ignored).
pub fn parse_pasv(text: &str) -> Option<u16> {
    let start = text.find(|c: char| c.is_ascii_digit())?;
    let nums: Vec<u16> = text[start..]
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .take(6)
        .map(|s| s.parse().ok())
        .collect::<Option<_>>()?;
    if nums.len() != 6 || nums[4] > 255 || nums[5] > 255 {
        return None;
    }
    Some(nums[4] * 256 + nums[5]).filter(|p| *p > 0)
}

/// Joins the remote folder and a site path; rejects `..`, empty segments, backslashes and control characters.
pub fn remote_join(base: &str, rel: &str) -> NetResult<String> {
    let bad = || NetError::Msg(format!("“{rel}” is not a valid file name for the server."));
    if !netio::safe_arg(rel) || rel.contains('\\') {
        return Err(bad());
    }
    let b = base.trim();
    let mut out = if b.is_empty() {
        String::new()
    } else {
        format!("{}/", b.trim_end_matches('/'))
    };
    for (i, seg) in rel.split('/').enumerate() {
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err(bad());
        }
        if i > 0 {
            out.push('/');
        }
        out.push_str(seg);
    }
    Ok(out)
}

/// Every folder the files need, parents first.
pub fn folders(paths: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in paths {
        let parts: Vec<&str> = p.split('/').collect();
        for i in 1..parts.len() {
            let d = parts[..i].join("/");
            if !out.contains(&d) {
                out.push(d);
            }
        }
    }
    out.sort_by_key(|d| d.matches('/').count());
    out
}

// ------------------------------------------------------------------ session

struct Session {
    ctl: BufReader<Conn>,
    host: String,
    ip: IpAddr,
    trust: Trust,
    secure_data: bool,
}

impl Session {
    fn cmd(&mut self, line: &str) -> NetResult<(u16, String)> {
        if !netio::safe_arg(line) {
            return Err(NetError::Msg("Invalid characters in a name.".into()));
        }
        let c = self.ctl.get_mut();
        c.write_all(line.as_bytes())?;
        c.write_all(b"\r\n")?;
        c.flush()?;
        read_reply(&mut self.ctl)
    }

    fn expect(&mut self, line: &str, ok: &[u16], what: &str) -> NetResult<String> {
        let (code, text) = self.cmd(line)?;
        if ok.contains(&code) {
            Ok(text)
        } else {
            Err(NetError::Msg(format!(
                "{what} failed ({code} {}).",
                brief(&text)
            )))
        }
    }

    fn open(t: &FtpTarget, trust: &Trust) -> NetResult<Session> {
        let sec = t.security();
        let tcp = netio::connect(t.host.trim(), t.port())?;
        let ip = tcp.peer_addr()?.ip();
        let host = t.host.trim().to_string();
        let conn = if sec == Security::Implicit {
            netio::tls(tcp, &host, trust)?
        } else {
            Conn::Plain(tcp)
        };
        let mut s = Session {
            ctl: BufReader::new(conn),
            host,
            ip,
            trust: trust.clone(),
            secure_data: sec != Security::None,
        };
        let (code, text) = read_reply(&mut s.ctl)?;
        if code != 220 {
            return Err(NetError::Msg(format!(
                "The server is not ready ({code} {}).",
                brief(&text)
            )));
        }
        if sec == Security::Explicit {
            let (code, text) = s.cmd("AUTH TLS")?;
            if code != 234 {
                return Err(NetError::Msg(format!(
                    "The server does not offer FTPS (explicit TLS): {code} {}. Choose plain FTP only if you accept that the password travels unencrypted.",
                    brief(&text)
                )));
            }
            let Conn::Plain(tcp) = s.ctl.into_inner() else {
                return Err(NetError::Msg("unexpected TLS state".into()));
            };
            s.ctl = BufReader::new(netio::tls(tcp, &s.host, trust)?);
        }
        if s.secure_data {
            s.expect("PBSZ 0", &[200], "Setting up TLS")?;
            s.expect("PROT P", &[200], "Protecting the data connection")?;
        }
        Ok(s)
    }

    fn login(&mut self, user: &str, password: &str) -> NetResult<()> {
        let user = if user.trim().is_empty() {
            "anonymous"
        } else {
            user.trim()
        };
        let (code, text) = self.cmd(&format!("USER {user}"))?;
        let code = match code {
            230 => 230,
            331 | 332 => {
                // the password is written directly and never echoed into errors
                if !netio::safe_arg(password) {
                    return Err(NetError::Msg(
                        "The password contains invalid characters.".into(),
                    ));
                }
                let c = self.ctl.get_mut();
                c.write_all(format!("PASS {password}\r\n").as_bytes())?;
                c.flush()?;
                read_reply(&mut self.ctl)?.0
            }
            _ => {
                return Err(NetError::Msg(format!(
                    "The server refused the user name ({code} {}).",
                    brief(&text)
                )))
            }
        };
        if code != 230 && code != 202 {
            return Err(NetError::Msg(
                "Sign-in failed: check the user name and password.".into(),
            ));
        }
        self.expect("TYPE I", &[200], "Switching to binary mode")?;
        Ok(())
    }

    fn data_port(&mut self) -> NetResult<u16> {
        let (code, text) = self.cmd("EPSV")?;
        if code == 229 {
            if let Some(p) = parse_epsv(&text) {
                return Ok(p);
            }
        }
        let text = self.expect("PASV", &[227], "Opening a data connection (passive mode)")?;
        parse_pasv(&text).ok_or_else(|| {
            NetError::Msg("The server's passive-mode reply could not be read.".into())
        })
    }

    fn store(&mut self, path: &str, bytes: &[u8]) -> NetResult<()> {
        let port = self.data_port()?;
        let tcp = netio::connect_ip(self.ip, port)?;
        let (code, text) = self.cmd(&format!("STOR {path}"))?;
        if code != 150 && code != 125 {
            return Err(NetError::Msg(format!(
                "Uploading {path} failed ({code} {}).",
                brief(&text)
            )));
        }
        // the server starts TLS on the data connection after its 150 reply
        let mut data = if self.secure_data {
            let trust = match &self.trust {
                Trust::Probe => Trust::Verify,
                t => t.clone(),
            };
            netio::tls(tcp, &self.host, &trust)?
        } else {
            Conn::Plain(tcp)
        };
        data.write_all(bytes)?;
        data.flush()?;
        data.finish();
        let (code, text) = read_reply(&mut self.ctl)?;
        if code != 226 && code != 250 {
            return Err(NetError::Msg(format!(
                "Uploading {path} failed ({code} {}).",
                brief(&text)
            )));
        }
        Ok(())
    }

    fn quit(mut self) {
        let _ = self.cmd("QUIT");
        self.ctl.into_inner().finish();
    }
}

fn test(t: &FtpTarget, trust: &Trust) -> NetResult<String> {
    let mut s = Session::open(t, trust)?;
    s.login(&t.user, &t.password)?;
    let tls = s.ctl.get_ref().is_tls();
    let dir = t.remote_path.as_deref().unwrap_or("").trim().to_string();
    if !dir.is_empty() {
        s.expect(
            &format!("CWD {dir}"),
            &[250, 200],
            "Opening the remote folder",
        )?;
    }
    s.quit();
    Ok(if tls {
        "Connected and signed in (encrypted).".into()
    } else {
        "Connected and signed in (not encrypted).".into()
    })
}

fn upload(
    app: &AppHandle,
    job: &str,
    t: &FtpTarget,
    files: &[(String, Vec<u8>)],
    trust: &Trust,
) -> NetResult<String> {
    let base = t.remote_path.as_deref().unwrap_or("").trim().to_string();
    let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
    for p in &paths {
        remote_join(&base, p)?;
    }
    let mut s = Session::open(t, trust)?;
    s.login(&t.user, &t.password)?;
    let total = files.len();
    for d in folders(&paths) {
        netio::check_cancel(job)?;
        let full = remote_join(&base, &d)?;
        netio::progress(app, job, format!("Creating folder {d}…"), 0, total);
        // 550/521: the folder exists already (servers differ in the code)
        let _ = s.cmd(&format!("MKD {full}"))?;
    }
    for (i, (p, bytes)) in files.iter().enumerate() {
        netio::check_cancel(job)?;
        netio::progress(app, job, format!("Uploading {p}…"), i, total);
        s.store(&remote_join(&base, p)?, bytes)?;
    }
    netio::progress(app, job, "Finishing…".into(), total, total);
    s.quit();
    Ok(format!("Uploaded {total} files."))
}

/// Connects, signs in and opens the remote folder; uploads nothing.
#[tauri::command]
pub async fn ftp_test(target: FtpTarget) -> Result<String, String> {
    netio::blocking(move || {
        let pin = target.pinned_cert.clone();
        netio::with_trust(pin.as_deref(), |trust| test(&target, trust))
    })
    .await
}

/// Uploads the files into the remote folder (creating folders as needed). Progress events carry `job`.
#[tauri::command]
pub async fn ftp_upload(
    app: AppHandle,
    job: String,
    target: FtpTarget,
    files: Vec<UploadFile>,
) -> Result<String, String> {
    netio::blocking(move || {
        let decoded = files
            .into_iter()
            .map(|f| Ok((f.path, wire::b64_decode(&f.data).map_err(NetError::Msg)?)))
            .collect::<NetResult<Vec<_>>>()?;
        let pin = target.pinned_cert.clone();
        netio::with_trust(pin.as_deref(), |trust| {
            upload(&app, &job, &target, &decoded, trust)
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passive_replies() {
        assert_eq!(
            parse_epsv("Entering Extended Passive Mode (|||6446|)"),
            Some(6446)
        );
        assert_eq!(
            parse_epsv("Entering Extended Passive Mode (!!!6446!)"),
            Some(6446)
        );
        assert_eq!(parse_epsv("Entering Extended Passive Mode"), None);
        assert_eq!(
            parse_pasv("Entering Passive Mode (192,168,1,2,19,137)"),
            Some(19 * 256 + 137)
        );
        assert_eq!(parse_pasv("Entering Passive Mode 10,0,0,1,4,1"), Some(1025));
        assert_eq!(parse_pasv("Entering Passive Mode (1,2,3)"), None);
        assert_eq!(parse_pasv("(1,2,3,4,300,1)"), None);
    }

    #[test]
    fn paths() {
        assert_eq!(
            remote_join("/var/www/", "a/b.html").unwrap(),
            "/var/www/a/b.html"
        );
        assert_eq!(remote_join("", "index.html").unwrap(), "index.html");
        assert_eq!(remote_join("/", "a.html").unwrap(), "/a.html");
        assert!(remote_join("/x", "../etc/passwd").is_err());
        assert!(remote_join("/x", "a//b").is_err());
        assert!(remote_join("/x", "a\r\nDELE b").is_err());
        assert_eq!(
            folders(&["index.html", "a/b/c.css", "a/d.js", "e/f.png"]),
            vec!["a", "e", "a/b"]
        );
    }
}
