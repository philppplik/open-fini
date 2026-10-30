//! Built-in collaboration relay: the same protocol as `scripts/relay.mjs` (docs/collaboration.md ▸ Relay
//! protocol), started from the Collaboration window with one click so nobody needs Node.js or a terminal.
//!
//! It forwards end-to-end encrypted text frames between the members of a room and never sees content:
//! rooms by id (created on first join, deleted when empty, nothing persisted), the first joiner pins the
//! room's access token, fan-out to the other peers, frame size limit, per-connection rate limits, per-IP
//! and total connection limits, ping keep-alive, join timeout and an Origin allow-list (the desktop app,
//! localhost and non-browser clients). `GET /info` answers like the Node relay so the existing People tab
//! lists the LAN address. Plain `ws://` only: browsers on other devices need the Node relay's `--lan` mode
//! (https page + wss); the desktop app on other computers connects fine. Nothing is logged.
//!
//! Threads: one accept loop (non-blocking, polls the stop flag), per connection one reader and one writer
//! with a bounded queue, so a slow receiver is disconnected instead of making the relay buffer without bound.

use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Shutdown, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::wire;

/// Port tried first (the Node relay's default), then any free port.
pub const DEFAULT_PORT: u16 = 8787;
const MAX_FRAME: usize = 256 * 1024 + 1024;
const MAX_ROOMS: usize = 200;
const MAX_PEERS: usize = 16;
const MAX_CONNECTIONS: usize = 512;
const MAX_PER_IP: usize = 32;
const RATE: f64 = 150.0;
const BURST: f64 = 300.0;
const BYTES_PER_SECOND: f64 = 4.0 * 1024.0 * 1024.0;
const PING_EVERY: Duration = Duration::from_secs(20);
const JOIN_TIMEOUT: Duration = Duration::from_secs(10);
/// Frames queued for one receiver before it counts as too slow (about 16 MiB at the frame limit).
const QUEUE: usize = 64;
const ORIGINS: [&str; 6] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost",
    "http://127.0.0.1",
    "https://localhost",
];

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

// ------------------------------------------------------------------ pure helpers (tested)

/// Same rule as the Node relay: no Origin (non-browser clients), an exact match, or a loopback
/// origin on any port when the list contains it without a port.
pub fn origin_allowed(origin: Option<&str>) -> bool {
    let Some(origin) = origin else { return true };
    if ORIGINS.contains(&origin) {
        return true;
    }
    let Some((scheme, rest)) = origin.split_once("://") else {
        return false;
    };
    let host = if let Some(r) = rest.strip_prefix('[') {
        match r.split_once(']') {
            Some((h, _)) => format!("[{h}]"),
            None => return false,
        }
    } else {
        rest.split(':').next().unwrap_or("").to_string()
    };
    ["localhost", "127.0.0.1", "[::1]", "tauri.localhost"].contains(&host.as_str())
        && ORIGINS.contains(&format!("{scheme}://{host}").as_str())
}

/// Room ids and access tokens: 22 characters of base64url (16 random bytes).
pub fn valid_id(s: &str) -> bool {
    s.len() == 22
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

/// A parsed HTTP request head.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(String::as_str)
    }
}

/// Parses `GET /path HTTP/1.1` and the header lines (names lower-cased). None when malformed.
pub fn parse_request(head: &str) -> Option<Request> {
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_string();
    let path = first.next()?.split('?').next()?.to_string();
    if !first.next()?.starts_with("HTTP/1.") {
        return None;
    }
    let mut headers = HashMap::new();
    for line in lines.take_while(|l| !l.is_empty()) {
        let (k, v) = line.split_once(':')?;
        headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
    }
    Some(Request {
        method,
        path,
        headers,
    })
}

/// Token bucket (messages or bytes per second).
struct Bucket {
    rate: f64,
    burst: f64,
    tokens: f64,
    at: Instant,
}

impl Bucket {
    fn new(rate: f64, burst: f64) -> Self {
        Bucket {
            rate,
            burst,
            tokens: burst,
            at: Instant::now(),
        }
    }
    fn take(&mut self, n: f64) -> bool {
        let now = Instant::now();
        self.tokens =
            (self.tokens + now.duration_since(self.at).as_secs_f64() * self.rate).min(self.burst);
        self.at = now;
        if self.tokens < n {
            return false;
        }
        self.tokens -= n;
        true
    }
}

// ------------------------------------------------------------------ rooms

/// What a writer thread sends.
enum Out {
    Frame(Vec<u8>),
    Close(u16, &'static str),
}

/// The rooms and their members. Pure bookkeeping (no sockets), so it is unit-tested.
#[derive(Default)]
struct Hub {
    rooms: HashMap<String, Room>,
}

struct Room {
    token: String,
    peers: Vec<(u64, SyncSender<Out>)>,
}

fn text(v: &Value) -> Vec<u8> {
    wire::encode_frame(1, v.to_string().as_bytes())
}

impl Hub {
    /// Adds a peer. Ok(other peers) or Err(error code for the client).
    fn join(
        &mut self,
        id: u64,
        tx: SyncSender<Out>,
        room: &str,
        token: &str,
    ) -> Result<usize, &'static str> {
        if !self.rooms.contains_key(room) && self.rooms.len() >= MAX_ROOMS {
            return Err("too_many_rooms");
        }
        let r = self.rooms.entry(room.to_string()).or_insert_with(|| Room {
            token: token.to_string(),
            peers: Vec::new(),
        });
        if r.token != token {
            if r.peers.is_empty() {
                self.rooms.remove(room);
            }
            return Err("forbidden");
        }
        if r.peers.len() >= MAX_PEERS {
            return Err("room_full");
        }
        r.peers.push((id, tx));
        let n = r.peers.len() - 1;
        let note = text(&json!({ "t": "peers", "n": n }));
        for (pid, ptx) in &r.peers {
            if *pid != id {
                let _ = ptx.try_send(Out::Frame(note.clone()));
            }
        }
        Ok(n)
    }

    /// Removes a peer; an empty room is deleted, the others hear the new member count.
    fn leave(&mut self, id: u64, room: &str) {
        let Some(r) = self.rooms.get_mut(room) else {
            return;
        };
        r.peers.retain(|(pid, _)| *pid != id);
        if r.peers.is_empty() {
            self.rooms.remove(room);
            return;
        }
        let note = text(&json!({ "t": "peers", "n": r.peers.len() - 1 }));
        for (_, ptx) in &r.peers {
            let _ = ptx.try_send(Out::Frame(note.clone()));
        }
    }

    /// Sends a frame to everyone in the room but the sender. Returns the ids of receivers that are too slow.
    fn forward(&self, id: u64, room: &str, frame: &[u8]) -> Vec<u64> {
        let mut slow = Vec::new();
        if let Some(r) = self.rooms.get(room) {
            for (pid, ptx) in &r.peers {
                if *pid == id {
                    continue;
                }
                if let Err(TrySendError::Full(_)) = ptx.try_send(Out::Frame(frame.to_vec())) {
                    slow.push(*pid);
                }
            }
        }
        slow
    }
}

// ------------------------------------------------------------------ server

struct Conn {
    ip: IpAddr,
    stream: TcpStream,
}

struct Shared {
    hub: Mutex<Hub>,
    conns: Mutex<HashMap<u64, Conn>>,
    stop: AtomicBool,
    next: AtomicU64,
    port: u16,
    lan: bool,
}

impl Shared {
    fn kick(&self, id: u64) {
        if let Some(c) = lock(&self.conns).get(&id) {
            let _ = c.stream.shutdown(Shutdown::Both);
        }
    }
}

/// The address other machines use to reach this one: the interface of the default route
/// (a UDP "connect" sends no packet). None without a network.
pub fn lan_ip() -> Option<IpAddr> {
    let sock = UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    sock.connect(("192.0.2.1", 9)).ok()?; // TEST-NET-1: never contacted
    let ip = sock.local_addr().ok()?.ip();
    match ip {
        IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() && !v4.is_link_local() => {
            Some(ip)
        }
        _ => None,
    }
}

fn info(shared: &Shared, origin: Option<&str>) -> Value {
    let lan: Vec<String> = if shared.lan {
        lan_ip().map(|ip| ip.to_string()).into_iter().collect()
    } else {
        Vec::new()
    };
    let hosts = if shared.lan {
        lan.clone()
    } else {
        vec!["127.0.0.1".to_string()]
    };
    json!({
        "app": "openfini-relay",
        "version": env!("CARGO_PKG_VERSION"),
        "embedded": true,
        "port": shared.port,
        "host": if shared.lan { "0.0.0.0" } else { "127.0.0.1" },
        "lan": lan,
        "ws": hosts.iter().map(|h| format!("ws://{h}:{}/", shared.port)).collect::<Vec<_>>(),
        "wss": [],
        "servesApp": false,
        "appUrls": [],
        "originAllowed": origin_allowed(origin),
    })
}

fn respond(stream: &mut TcpStream, status: &str, extra: &[(&str, String)], body: &[u8]) {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n",
        body.len()
    );
    for (k, v) in extra {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}

/// Reads the request head (at most 8 KiB, 5 seconds).
fn read_head(stream: &mut TcpStream) -> Option<(Request, Vec<u8>)> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = std::str::from_utf8(&buf[..end + 4]).ok()?;
            let req = parse_request(head)?;
            return Some((req, buf[end + 4..].to_vec()));
        }
        if buf.len() > 8192 {
            return None;
        }
    }
}

fn handle(shared: Arc<Shared>, mut stream: TcpStream, ip: IpAddr) {
    let Some((req, rest)) = read_head(&mut stream) else {
        return;
    };
    let origin = req.header("origin").map(str::to_string);
    let cors: Vec<(&str, String)> = match &origin {
        Some(o) if origin_allowed(Some(o)) => {
            vec![
                ("Access-Control-Allow-Origin", o.clone()),
                ("Vary", "Origin".into()),
            ]
        }
        _ => Vec::new(),
    };
    if req.method == "OPTIONS" {
        let mut h = cors.clone();
        if req
            .header("access-control-request-private-network")
            .is_some()
            && !cors.is_empty()
        {
            h.push(("Access-Control-Allow-Private-Network", "true".into()));
        }
        h.push(("Access-Control-Allow-Methods", "GET".into()));
        return respond(&mut stream, "204 No Content", &h, b"");
    }
    if req.method != "GET" {
        return respond(
            &mut stream,
            "405 Method Not Allowed",
            &[("Allow", "GET".into())],
            b"",
        );
    }
    let upgrade = req
        .header("upgrade")
        .is_some_and(|u| u.eq_ignore_ascii_case("websocket"));
    if !upgrade {
        if req.path == "/info" {
            let mut h = cors;
            h.push(("Content-Type", "application/json".into()));
            let body = info(&shared, origin.as_deref()).to_string();
            return respond(&mut stream, "200 OK", &h, body.as_bytes());
        }
        let body =
            "OpenFini relay (built into the desktop app). It only forwards encrypted frames.\n";
        return respond(
            &mut stream,
            "200 OK",
            &[("Content-Type", "text/plain; charset=utf-8".into())],
            body.as_bytes(),
        );
    }
    if req.header("sec-websocket-version") != Some("13") {
        return respond(&mut stream, "426 Upgrade Required", &[], b"");
    }
    let key = match req.header("sec-websocket-key") {
        Some(k) if wire::ws_key_valid(k) => k.to_string(),
        _ => return respond(&mut stream, "400 Bad Request", &[], b""),
    };
    if !origin_allowed(origin.as_deref()) {
        return respond(&mut stream, "403 Forbidden", &[], b"");
    }
    let id = shared.next.fetch_add(1, Ordering::Relaxed);
    {
        let mut conns = lock(&shared.conns);
        let from_ip = conns.values().filter(|c| c.ip == ip).count();
        if conns.len() >= MAX_CONNECTIONS || from_ip >= MAX_PER_IP {
            drop(conns);
            return respond(&mut stream, "503 Service Unavailable", &[], b"");
        }
        let Ok(clone) = stream.try_clone() else {
            return;
        };
        conns.insert(id, Conn { ip, stream: clone });
    }
    let accept = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
        wire::ws_accept(&key)
    );
    if stream.write_all(accept.as_bytes()).is_ok() {
        let _ = stream.set_nodelay(true);
        session(&shared, id, stream, rest);
    }
    lock(&shared.conns).remove(&id);
}

fn writer(mut stream: TcpStream, rx: Receiver<Out>) {
    let _ = stream.set_write_timeout(Some(Duration::from_secs(15)));
    while let Ok(out) = rx.recv() {
        match out {
            Out::Frame(f) => {
                if stream.write_all(&f).is_err() {
                    break;
                }
            }
            Out::Close(code, reason) => {
                let _ = stream.write_all(&wire::close_frame(code, reason));
                break;
            }
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
}

/// One WebSocket connection: reads frames, handles join/msg, forwards.
fn session(shared: &Arc<Shared>, id: u64, mut stream: TcpStream, mut buf: Vec<u8>) {
    let (tx, rx) = sync_channel::<Out>(QUEUE);
    let Ok(wstream) = stream.try_clone() else {
        return;
    };
    let wthread = thread::spawn(move || writer(wstream, rx));
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let started = Instant::now();
    let mut last_ping = Instant::now();
    let mut alive = true;
    let mut room: Option<String> = None;
    let mut frag: Option<Vec<u8>> = None;
    let mut msgs = Bucket::new(RATE, BURST);
    let mut bytes = Bucket::new(BYTES_PER_SECOND, BYTES_PER_SECOND * 2.0);
    let mut strikes = 0.0;
    let mut chunk = vec![0u8; 16 * 1024];
    let send = |tx: &SyncSender<Out>, v: Value| {
        let _ = tx.try_send(Out::Frame(text(&v)));
    };
    let close = |tx: &SyncSender<Out>, code: u16, reason: &'static str| {
        let _ = tx.try_send(Out::Close(code, reason));
    };
    'conn: loop {
        if shared.stop.load(Ordering::Relaxed) {
            close(&tx, 1001, "relay shutting down");
            break;
        }
        // parse every complete frame in the buffer
        loop {
            let (frame, used) = match wire::parse_frame(&buf, MAX_FRAME) {
                Ok(Some(f)) => f,
                Ok(None) => break,
                Err(wire::Violation(code, why)) => {
                    close(&tx, code, why);
                    break 'conn;
                }
            };
            buf.drain(..used);
            alive = true;
            let payload = match frame.opcode {
                8 => {
                    close(&tx, 1000, "");
                    break 'conn;
                }
                9 => {
                    let _ = tx.try_send(Out::Frame(wire::encode_frame(10, &frame.payload)));
                    continue;
                }
                10 => continue,
                o if o >= 8 => {
                    close(&tx, 1002, "unknown opcode");
                    break 'conn;
                }
                2 => {
                    close(&tx, 1003, "text frames only");
                    break 'conn;
                }
                1 if frag.is_some() => {
                    close(&tx, 1002, "unfinished message");
                    break 'conn;
                }
                1 if !frame.fin => {
                    frag = Some(frame.payload);
                    continue;
                }
                1 => frame.payload,
                0 => {
                    let Some(mut acc) = frag.take() else {
                        close(&tx, 1002, "unexpected continuation");
                        break 'conn;
                    };
                    acc.extend_from_slice(&frame.payload);
                    if acc.len() > MAX_FRAME {
                        close(&tx, 1009, "too large");
                        break 'conn;
                    }
                    if !frame.fin {
                        frag = Some(acc);
                        continue;
                    }
                    acc
                }
                _ => {
                    close(&tx, 1002, "unknown opcode");
                    break 'conn;
                }
            };
            if !msgs.take(1.0) || !bytes.take(payload.len() as f64) {
                send(&tx, json!({ "t": "error", "code": "rate" }));
                strikes += 1.0;
                if strikes > BURST {
                    close(&tx, 1008, "rate limit");
                    break 'conn;
                }
                continue;
            }
            let Ok(m) = serde_json::from_slice::<Value>(&payload) else {
                close(&tx, 1007, "invalid JSON");
                break 'conn;
            };
            match m.get("t").and_then(Value::as_str) {
                Some("join") => {
                    if room.is_some() {
                        send(&tx, json!({ "t": "error", "code": "joined" }));
                        continue;
                    }
                    let r = m.get("room").and_then(Value::as_str).unwrap_or("");
                    let tok = m.get("token").and_then(Value::as_str).unwrap_or("");
                    if !valid_id(r) || !valid_id(tok) {
                        close(&tx, 1008, "bad join");
                        break 'conn;
                    }
                    let joined = lock(&shared.hub).join(id, tx.clone(), r, tok);
                    match joined {
                        Ok(n) => {
                            room = Some(r.to_string());
                            send(&tx, json!({ "t": "joined", "peers": n }));
                        }
                        Err(code) => {
                            send(&tx, json!({ "t": "error", "code": code }));
                            close(&tx, 1008, code);
                            break 'conn;
                        }
                    }
                }
                Some("msg") => {
                    let Some(r) = &room else {
                        close(&tx, 1008, "join first");
                        break 'conn;
                    };
                    let Some(d) = m.get("d").filter(|d| d.is_string()) else {
                        close(&tx, 1007, "invalid message");
                        break 'conn;
                    };
                    let out = text(&json!({ "t": "msg", "d": d }));
                    let slow = lock(&shared.hub).forward(id, r, &out);
                    for s in slow {
                        shared.kick(s);
                    }
                }
                _ => send(&tx, json!({ "t": "error", "code": "unknown" })),
            }
        }
        if buf.len() > MAX_FRAME * 2 + 14 {
            close(&tx, 1009, "too large");
            break;
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                if room.is_none() && started.elapsed() > JOIN_TIMEOUT {
                    close(&tx, 1008, "join timeout");
                    break;
                }
                if last_ping.elapsed() >= PING_EVERY {
                    if !alive {
                        close(&tx, 1001, "ping timeout");
                        break;
                    }
                    alive = false;
                    last_ping = Instant::now();
                    let _ = tx.try_send(Out::Frame(wire::encode_frame(9, b"")));
                }
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => {}
            Err(_) => break,
        }
    }
    if let Some(r) = room {
        lock(&shared.hub).leave(id, &r);
    }
    drop(tx);
    let _ = wthread.join();
    let _ = stream.shutdown(Shutdown::Both);
}

fn accept_loop(shared: Arc<Shared>, listener: TcpListener) {
    while !shared.stop.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, addr)) => {
                let _ = stream.set_nonblocking(false);
                let s = Arc::clone(&shared);
                let ip = addr.ip();
                let _ = thread::Builder::new()
                    .name("relay-conn".into())
                    .spawn(move || handle(s, stream, ip));
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(_) => thread::sleep(Duration::from_millis(250)),
        }
    }
    for c in lock(&shared.conns).values() {
        let _ = c.stream.shutdown(Shutdown::Both);
    }
}

// ------------------------------------------------------------------ commands

/// The running relay, if any.
#[derive(Default)]
pub struct Relay(Mutex<Option<Arc<Shared>>>);

/// What the Collaboration window shows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    port: u16,
    lan: bool,
    /// The address for this computer (used to create the room).
    local: String,
    /// Addresses other computers use (empty without a network or in "this computer only" mode).
    addresses: Vec<String>,
    rooms: usize,
    connections: usize,
}

fn status(s: &Shared) -> RelayStatus {
    let addresses = if s.lan {
        lan_ip()
            .map(|ip| format!("ws://{ip}:{}/", s.port))
            .into_iter()
            .collect()
    } else {
        Vec::new()
    };
    RelayStatus {
        port: s.port,
        lan: s.lan,
        local: format!("ws://127.0.0.1:{}/", s.port),
        addresses,
        rooms: lock(&s.hub).rooms.len(),
        connections: lock(&s.conns).len(),
    }
}

/// Starts the relay (or returns the running one). `lan` binds every interface so other computers
/// in the network can join; otherwise only this computer. Port 8787 when free, else any free port.
#[tauri::command]
pub fn relay_start(
    state: tauri::State<'_, Relay>,
    lan: Option<bool>,
    port: Option<u16>,
) -> Result<RelayStatus, String> {
    let mut slot = lock(&state.0);
    if let Some(s) = slot.as_ref() {
        return Ok(status(s));
    }
    let lan = lan.unwrap_or(true);
    let host = if lan { "0.0.0.0" } else { "127.0.0.1" };
    let listener = TcpListener::bind((host, port.unwrap_or(DEFAULT_PORT)))
        .or_else(|_| TcpListener::bind((host, 0)))
        .map_err(|e| format!("The relay could not open a network port: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let shared = Arc::new(Shared {
        hub: Mutex::new(Hub::default()),
        conns: Mutex::new(HashMap::new()),
        stop: AtomicBool::new(false),
        next: AtomicU64::new(1),
        port,
        lan,
    });
    let s = Arc::clone(&shared);
    thread::Builder::new()
        .name("relay".into())
        .spawn(move || accept_loop(s, listener))
        .map_err(|e| e.to_string())?;
    let st = status(&shared);
    *slot = Some(shared);
    Ok(st)
}

/// Stops the relay and disconnects everyone (their apps show "disconnected").
#[tauri::command]
pub fn relay_stop(state: tauri::State<'_, Relay>) {
    if let Some(s) = lock(&state.0).take() {
        s.stop.store(true, Ordering::Relaxed);
    }
}

/// The running relay's status, or null.
#[tauri::command]
pub fn relay_status(state: tauri::State<'_, Relay>) -> Option<RelayStatus> {
    lock(&state.0).as_ref().map(|s| status(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins() {
        assert!(origin_allowed(None));
        assert!(origin_allowed(Some("tauri://localhost")));
        assert!(origin_allowed(Some("http://tauri.localhost")));
        assert!(origin_allowed(Some("http://localhost:5173")));
        assert!(origin_allowed(Some("http://127.0.0.1:8080")));
        assert!(!origin_allowed(Some("https://127.0.0.1:8080")));
        assert!(!origin_allowed(Some("https://evil.example")));
        assert!(!origin_allowed(Some("http://localhost.evil.example")));
        assert!(!origin_allowed(Some("garbage")));
    }

    #[test]
    fn ids() {
        assert!(valid_id("abcdefghijklmnopqrstu_"));
        assert!(!valid_id("abc"));
        assert!(!valid_id("abcdefghijklmnopqrstu/"));
    }

    #[test]
    fn request_head() {
        let r = parse_request("GET /info?x=1 HTTP/1.1\r\nHost: a\r\nUpgrade: WebSocket\r\n\r\n")
            .unwrap();
        assert_eq!(r.method, "GET");
        assert_eq!(r.path, "/info");
        assert_eq!(r.header("upgrade"), Some("WebSocket"));
        assert!(parse_request("nonsense").is_none());
        assert!(parse_request("GET / FTP/1\r\n\r\n").is_none());
    }

    #[test]
    fn hub_rooms() {
        let mut hub = Hub::default();
        let (a, ra) = sync_channel(4);
        let (b, rb) = sync_channel(1);
        let room = "abcdefghijklmnopqrstu_";
        let tok = "TOKENTOKENTOKENTOKEN12";
        assert_eq!(hub.join(1, a, room, tok), Ok(0));
        let (bad, _) = sync_channel(1);
        assert_eq!(
            hub.join(9, bad, room, "WRONGWRONGWRONGWRONG12"),
            Err("forbidden")
        );
        assert_eq!(hub.join(2, b, room, tok), Ok(1));
        assert!(matches!(ra.try_recv(), Ok(Out::Frame(_)))); // "peers" note for the first member
        assert!(hub.forward(1, room, b"x").is_empty());
        assert!(matches!(rb.try_recv(), Ok(Out::Frame(f)) if f == b"x"));
        assert!(hub.forward(1, room, b"y").is_empty());
        assert_eq!(hub.forward(1, room, b"z"), vec![2]); // queue of 1 is full: too slow
        hub.leave(2, room);
        hub.leave(1, room);
        assert!(hub.rooms.is_empty());
    }
}
