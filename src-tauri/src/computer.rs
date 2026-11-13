//! Computer use for the assistant (desktop app on Windows and macOS, off by default; docs/vibe-computer-use.md,
//! docs/adr/0023-computer-use.md). The assistant may see the screen and, when the person allows it, use the mouse
//! and keyboard in other apps. This module is the boundary that holds even if the page is wrong:
//!
//! - nothing works without a **session grant**, which only the native dialog opened HERE can create (the page
//!   passes the wanted scope and duration; the text is fixed and says plainly what is shared and with whom);
//! - a grant has a scope (view only / view and control), ends after its time limit, and is revoked by the Stop
//!   button of the always-on-top indicator, the global hotkey Ctrl+Alt+Shift+Esc, or the app's settings;
//! - every command checks the grant, the scope, the pause state, the rate limits and the action budget again;
//! - input never goes into OpenFini's own windows (so the assistant cannot approve its own actions or grants),
//!   into apps on the deny list (password managers, security settings; plus the person's own entries), or, on
//!   Windows, into elevated windows (UIPI would drop it silently); deny-listed windows are blacked out in
//!   screenshots;
//! - pressing Esc pauses; in sessions that run low-risk actions without asking, a moved mouse pauses as well;
//! - every screenshot and action is appended to an action log (JSON lines, `computer-use-audit.jsonl` in the app's
//!   log folder). Typed text and screenshots are never logged, only their sizes.
//!
//! Only the main window may call the commands (capabilities/default.json, checked again here); the indicator
//! window may only read the status, pause, resume and stop. Linux is not supported yet: the commands answer so.

use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::wire;

/// Event sent to the windows when a session starts, pauses, resumes or ends. Payload: `{ kind, reason }`.
const EVENT: &str = "openfini://computer";
const MAIN_WINDOW: &str = "main";
const INDICATOR_WINDOW: &str = "computer-indicator";
pub const STOP_SHORTCUT: &str = "Ctrl+Alt+Shift+Esc";

const MAX_MINUTES: u32 = 60;
/// Input actions one grant may run in total.
const MAX_ACTIONS: u32 = 600;
/// Shortest time between two input actions, and how many may run per minute.
const MIN_INPUT_GAP: Duration = Duration::from_millis(100);
const MAX_INPUT_PER_MINUTE: usize = 120;
const MIN_SHOT_GAP: Duration = Duration::from_millis(250);
const MAX_TYPE_CHARS: usize = 2000;
const MAX_CHORDS: usize = 8;
const MAX_SCROLL: i32 = 30;
const DECLINE_COOLDOWN: Duration = Duration::from_secs(10);
const MAX_AUDIT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SHOT_PX: u32 = 2000;
const MIN_SHOT_PX: u32 = 320;
/// The cursor counts as moved by the person when it is further than this from where the last action left it.
const CURSOR_TOLERANCE: i32 = 4;

/// Apps and windows the assistant never controls and never sees (case-insensitive match on the app name or the
/// window title). The person can add entries; these cannot be removed.
pub const DEFAULT_DENY: &[&str] = &[
    "1password",
    "bitwarden",
    "keepass",
    "lastpass",
    "dashlane",
    "nordpass",
    "proton pass",
    "enpass",
    "roboform",
    "keeper password",
    "keychain access",
    "passwords",
    "authenticator",
    "credential manager",
    "windows security",
    "user account control",
    "privacy & security",
    "datenschutz & sicherheit",
    "touch id",
    "login password",
];

// ------------------------------------------------------------------ pure parts

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    View,
    Control,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Need {
    View,
    Input,
}

/// One session the person allowed in the native dialog.
#[derive(Debug)]
pub struct Grant {
    pub id: u64,
    pub scope: Scope,
    /// Mouse moves, clicks, scrolling and navigation keys run without a confirmation in the page.
    pub auto_low_risk: bool,
    pub started_ms: u64,
    pub expires: Instant,
    pub actions: u32,
    /// Why the session is paused ("escape", "mouse", "user"), if it is.
    pub paused: Option<&'static str>,
    /// Where the last action left the cursor.
    pub last_cursor: Option<(i32, i32)>,
    /// The window the last click activated (window id, app name): keyboard input goes back there after the
    /// person approved an action in OpenFini.
    pub target: Option<(u32, String)>,
    input_times: VecDeque<Instant>,
    last_shot: Option<Instant>,
    /// Until then an Esc key that is down was pressed by the assistant, not by the person.
    own_escape_until: Option<Instant>,
}

impl Grant {
    pub fn new(id: u64, scope: Scope, auto_low_risk: bool, minutes: u32, now: Instant) -> Self {
        Grant {
            id,
            scope,
            auto_low_risk: auto_low_risk && scope == Scope::Control,
            started_ms: now_ms(),
            expires: now + Duration::from_secs(u64::from(minutes.clamp(1, MAX_MINUTES)) * 60),
            actions: 0,
            paused: None,
            last_cursor: None,
            target: None,
            input_times: VecDeque::new(),
            last_shot: None,
            own_escape_until: None,
        }
    }

    pub fn expired(&self, now: Instant) -> bool {
        now >= self.expires
    }

    /// Checks (and for input, books) one call against the grant: scope, pause, rate limits and the action budget.
    pub fn check(&mut self, need: Need, now: Instant) -> Result<(), String> {
        if self.expired(now) {
            return Err(
                "The computer use session has ended (time limit). Ask the user to start a new one."
                    .into(),
            );
        }
        match need {
            Need::View => {
                if let Some(last) = self.last_shot {
                    if now.duration_since(last) < MIN_SHOT_GAP {
                        return Err("Too many screenshots in a short time. Wait a moment.".into());
                    }
                }
                self.last_shot = Some(now);
                Ok(())
            }
            Need::Input => {
                if self.scope != Scope::Control {
                    return Err("This computer use session is view only: the user did not allow mouse or keyboard control.".into());
                }
                if let Some(reason) = self.paused {
                    return Err(format!(
                        "Computer use is paused ({}). The user has to press Resume in OpenFini. Do not retry until they say so.",
                        pause_text(reason)
                    ));
                }
                if self.actions >= MAX_ACTIONS {
                    return Err(format!("This session reached its limit of {MAX_ACTIONS} actions. Ask the user to start a new one."));
                }
                if let Some(last) = self.input_times.back() {
                    if now.duration_since(*last) < MIN_INPUT_GAP {
                        return Err("Actions are coming too fast. Wait a moment, take a screenshot and continue.".into());
                    }
                }
                while self
                    .input_times
                    .front()
                    .is_some_and(|t| now.duration_since(*t) > Duration::from_secs(60))
                {
                    self.input_times.pop_front();
                }
                if self.input_times.len() >= MAX_INPUT_PER_MINUTE {
                    return Err(format!("More than {MAX_INPUT_PER_MINUTE} actions in a minute are not allowed. Wait a moment."));
                }
                self.input_times.push_back(now);
                self.actions += 1;
                Ok(())
            }
        }
    }
}

fn pause_text(reason: &str) -> &'static str {
    match reason {
        "escape" => "the user pressed Esc",
        "mouse" => "the user moved the mouse",
        _ => "the user paused it",
    }
}

/// True when the cursor is not where the last action left it (the person moved the mouse).
pub fn cursor_moved(last: Option<(i32, i32)>, now: (i32, i32)) -> bool {
    last.is_some_and(|(x, y)| {
        (x - now.0).abs() > CURSOR_TOLERANCE || (y - now.1).abs() > CURSOR_TOLERANCE
    })
}

/// Size of an image scaled down (never up) so its longer side is at most `max`, keeping the aspect ratio.
pub fn fit(w: u32, h: u32, max: u32) -> (u32, u32) {
    let long = w.max(h);
    if long <= max || long == 0 {
        return (w.max(1), h.max(1));
    }
    let k = f64::from(max) / f64::from(long);
    (
        ((f64::from(w) * k).round() as u32).max(1),
        ((f64::from(h) * k).round() as u32).max(1),
    )
}

/// A rectangle in desktop coordinates (the unit the OS uses for the mouse: physical pixels on Windows, points on
/// macOS).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

impl Rect {
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x
            && y >= self.y
            && i64::from(x) < i64::from(self.x) + i64::from(self.w)
            && i64::from(y) < i64::from(self.y) + i64::from(self.h)
    }

    /// The part of `self` inside `other`, if any.
    pub fn clip(&self, other: &Rect) -> Option<Rect> {
        let x0 = self.x.max(other.x);
        let y0 = self.y.max(other.y);
        let x1 =
            (i64::from(self.x) + i64::from(self.w)).min(i64::from(other.x) + i64::from(other.w));
        let y1 =
            (i64::from(self.y) + i64::from(self.h)).min(i64::from(other.y) + i64::from(other.h));
        (x1 > i64::from(x0) && y1 > i64::from(y0)).then(|| Rect {
            x: x0,
            y: y0,
            w: (x1 - i64::from(x0)) as u32,
            h: (y1 - i64::from(y0)) as u32,
        })
    }
}

/// Maps a point of a screenshot (`out_w` × `out_h` image of `region`) back to desktop coordinates: the centre of
/// that image pixel. The page does this mapping (app/src/vibe/computer-policy.js, `toDesktop`); the same formula is
/// kept here so both sides are tested against the same numbers.
#[cfg(test)]
pub fn to_desktop(region: &Rect, out_w: u32, out_h: u32, px: f64, py: f64) -> (i32, i32) {
    let x = f64::from(region.x) + (px + 0.5) * f64::from(region.w) / f64::from(out_w.max(1));
    let y = f64::from(region.y) + (py + 0.5) * f64::from(region.h) / f64::from(out_h.max(1));
    (
        (x.floor() as i32).clamp(region.x, region.x + region.w as i32 - 1),
        (y.floor() as i32).clamp(region.y, region.y + region.h as i32 - 1),
    )
}

/// `rect` (desktop coordinates) as a pixel rectangle of the `out_w` × `out_h` image of `region`: x, y, w, h.
pub fn to_image(
    region: &Rect,
    out_w: u32,
    out_h: u32,
    rect: &Rect,
) -> Option<(u32, u32, u32, u32)> {
    let c = rect.clip(region)?;
    let kx = f64::from(out_w) / f64::from(region.w.max(1));
    let ky = f64::from(out_h) / f64::from(region.h.max(1));
    let x0 = (f64::from(c.x - region.x) * kx).floor() as u32;
    let y0 = (f64::from(c.y - region.y) * ky).floor() as u32;
    let x1 = ((f64::from(c.x - region.x) + f64::from(c.w)) * kx)
        .ceil()
        .min(f64::from(out_w)) as u32;
    let y1 = ((f64::from(c.y - region.y) + f64::from(c.h)) * ky)
        .ceil()
        .min(f64::from(out_h)) as u32;
    (x1 > x0 && y1 > y0).then_some((x0, y0, x1 - x0, y1 - y0))
}

/// The deny-list entry that matches this app or window title, if any.
pub fn denied<'a>(app: &str, title: &str, extra: &'a [String]) -> Option<&'a str> {
    let a = app.to_lowercase();
    let t = title.to_lowercase();
    let hit = |term: &str| !term.is_empty() && (a.contains(term) || t.contains(term));
    if let Some(d) = DEFAULT_DENY.iter().find(|d| hit(d)) {
        return Some(d);
    }
    extra
        .iter()
        .find(|d| hit(d.trim().to_lowercase().as_str()))
        .map(String::as_str)
}

/// Words in a window title that mark a sign-in or payment page. Text is never typed there (a heuristic that errs
/// on refusing: password fields themselves cannot be detected).
const SENSITIVE_TITLE: &[&str] = &[
    "sign in",
    "sign-in",
    "signin",
    "log in",
    "log-in",
    "login",
    "logon",
    "anmelden",
    "anmeldung",
    "einloggen",
    "password",
    "passwort",
    "kennwort",
    "passcode",
    "verification code",
    "two-factor",
    "checkout",
    "payment",
    "zahlung",
    "bezahlen",
    "kreditkarte",
    "credit card",
];

pub fn sensitive_title(title: &str) -> bool {
    let t = title.to_lowercase();
    SENSITIVE_TITLE.iter().any(|w| t.contains(w))
}

/// With a non-empty allow list only these apps accept input.
pub fn allowed(app: &str, allow: &[String]) -> bool {
    let a = app.to_lowercase();
    let terms: Vec<String> = allow
        .iter()
        .map(|x| x.trim().to_lowercase())
        .filter(|x| !x.is_empty())
        .collect();
    terms.is_empty() || terms.iter().any(|x| a.contains(x.as_str()))
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mod {
    Ctrl,
    Alt,
    Shift,
    Meta,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeySpec {
    Enter,
    Tab,
    Escape,
    Backspace,
    Delete,
    Space,
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
    Insert,
    F(u8),
    Char(char),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Chord {
    pub mods: Vec<Mod>,
    pub key: KeySpec,
}

fn parse_mod(name: &str) -> Option<Mod> {
    Some(match name {
        "ctrl" | "control" => Mod::Ctrl,
        "alt" | "option" | "opt" => Mod::Alt,
        "shift" => Mod::Shift,
        "cmd" | "command" | "meta" | "super" | "win" | "windows" => Mod::Meta,
        _ => return None,
    })
}

fn parse_key(token: &str) -> Option<KeySpec> {
    let mut chars = token.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        return (!c.is_control()).then_some(KeySpec::Char(c));
    }
    let name = token.to_lowercase().replace('_', "");
    Some(match name.as_str() {
        "enter" | "return" | "kpenter" => KeySpec::Enter,
        "tab" => KeySpec::Tab,
        "esc" | "escape" => KeySpec::Escape,
        "backspace" => KeySpec::Backspace,
        "delete" | "del" => KeySpec::Delete,
        "space" => KeySpec::Space,
        "up" | "arrowup" | "uparrow" => KeySpec::Up,
        "down" | "arrowdown" | "downarrow" => KeySpec::Down,
        "left" | "arrowleft" | "leftarrow" => KeySpec::Left,
        "right" | "arrowright" | "rightarrow" => KeySpec::Right,
        "home" => KeySpec::Home,
        "end" => KeySpec::End,
        "pageup" | "pgup" | "prior" => KeySpec::PageUp,
        "pagedown" | "pgdn" | "next" => KeySpec::PageDown,
        "insert" | "ins" => KeySpec::Insert,
        "plus" => KeySpec::Char('+'),
        "minus" => KeySpec::Char('-'),
        _ => {
            let n: u8 = name.strip_prefix('f')?.parse().ok()?;
            return (1..=24).contains(&n).then_some(KeySpec::F(n));
        }
    })
}

/// Parses one key or chord such as `Enter`, `ctrl+c`, `cmd+shift+t`, `alt+F4` (modifiers first, one key last).
pub fn parse_chord(text: &str) -> Result<Chord, String> {
    let bad = || {
        format!("“{text}” is not a key. Use a key name (Enter, Tab, Escape, Backspace, Delete, Space, Up, Down, Left, Right, Home, End, PageUp, PageDown, F1-F24), one character, or a chord with ctrl, alt, shift, cmd first, such as ctrl+c.")
    };
    let mut parts: Vec<&str> = text.split('+').collect();
    // "ctrl++" and "+" mean the plus key
    if text == "+" || text.ends_with("++") {
        parts.truncate(parts.len().saturating_sub(2));
        parts.push("+");
    }
    let (key, mods) = parts.split_last().ok_or_else(bad)?;
    let mut out = Vec::new();
    for m in mods {
        let m = parse_mod(m.trim().to_lowercase().as_str()).ok_or_else(bad)?;
        if !out.contains(&m) {
            out.push(m);
        }
    }
    Ok(Chord {
        mods: out,
        key: parse_key(key.trim()).ok_or_else(bad)?,
    })
}

/// Parses a sequence of keys and chords separated by spaces, such as `ctrl+a Delete`.
pub fn parse_keys(text: &str) -> Result<Vec<Chord>, String> {
    let chords: Vec<Chord> = text
        .split_whitespace()
        .map(parse_chord)
        .collect::<Result<_, _>>()?;
    if chords.is_empty() {
        return Err("No key given.".into());
    }
    if chords.len() > MAX_CHORDS {
        return Err(format!("At most {MAX_CHORDS} keys per call."));
    }
    Ok(chords)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Btn {
    Left,
    Right,
    Middle,
}

/// One input action, in desktop coordinates.
#[derive(Clone, PartialEq, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Action {
    Move {
        x: i32,
        y: i32,
    },
    Click {
        x: i32,
        y: i32,
        button: Btn,
        count: u8,
    },
    Drag {
        x: i32,
        y: i32,
        x2: i32,
        y2: i32,
    },
    Scroll {
        x: i32,
        y: i32,
        dx: i32,
        dy: i32,
    },
    Type {
        text: String,
    },
    Key {
        keys: String,
    },
}

impl Action {
    fn name(&self) -> &'static str {
        match self {
            Action::Move { .. } => "move",
            Action::Click { .. } => "click",
            Action::Drag { .. } => "drag",
            Action::Scroll { .. } => "scroll",
            Action::Type { .. } => "type",
            Action::Key { .. } => "key",
        }
    }

    /// What the action log shows. Typed text is never recorded, only its length.
    fn detail(&self) -> String {
        match self {
            Action::Move { x, y } => format!("{x},{y}"),
            Action::Click {
                x,
                y,
                button,
                count,
            } => format!("{x},{y} {button:?} x{count}").to_lowercase(),
            Action::Drag { x, y, x2, y2 } => format!("{x},{y} to {x2},{y2}"),
            Action::Scroll { x, y, dx, dy } => format!("{x},{y} by {dx},{dy}"),
            Action::Type { text } => format!("{} characters", text.chars().count()),
            Action::Key { keys } => keys.chars().take(80).collect(),
        }
    }

    /// The points the pointer touches.
    fn points(&self) -> Vec<(i32, i32)> {
        match *self {
            Action::Move { x, y } | Action::Click { x, y, .. } | Action::Scroll { x, y, .. } => {
                vec![(x, y)]
            }
            Action::Drag { x, y, x2, y2 } => vec![(x, y), (x2, y2)],
            _ => Vec::new(),
        }
    }

    fn keyboard(&self) -> bool {
        matches!(self, Action::Type { .. } | Action::Key { .. })
    }
}

/// A primitive the native layer performs.
#[derive(Clone, PartialEq, Debug)]
pub enum Step {
    MoveTo(i32, i32),
    Press(Btn),
    Release(Btn),
    Wheel { dx: i32, dy: i32 },
    Text(String),
    ModDown(Mod),
    ModUp(Mod),
    Tap(KeySpec),
    Sleep(u64),
}

/// Validates an action and turns it into primitives. Every pressed button and modifier is released again.
pub fn plan(action: &Action) -> Result<Vec<Step>, String> {
    let mut s = Vec::new();
    match action {
        Action::Move { x, y } => s.push(Step::MoveTo(*x, *y)),
        Action::Click {
            x,
            y,
            button,
            count,
        } => {
            if !(1..=3).contains(count) {
                return Err("A click count must be 1, 2 or 3.".into());
            }
            s.extend([Step::MoveTo(*x, *y), Step::Sleep(60)]);
            for i in 0..*count {
                if i > 0 {
                    s.push(Step::Sleep(70));
                }
                s.extend([
                    Step::Press(*button),
                    Step::Sleep(25),
                    Step::Release(*button),
                ]);
            }
        }
        Action::Drag { x, y, x2, y2 } => {
            s.extend([
                Step::MoveTo(*x, *y),
                Step::Sleep(80),
                Step::Press(Btn::Left),
                Step::Sleep(80),
            ]);
            const N: i32 = 12;
            for i in 1..=N {
                s.push(Step::MoveTo(x + (x2 - x) * i / N, y + (y2 - y) * i / N));
                s.push(Step::Sleep(15));
            }
            s.extend([Step::Sleep(80), Step::Release(Btn::Left)]);
        }
        Action::Scroll { x, y, dx, dy } => {
            if (*dx == 0 && *dy == 0) || dx.abs() > MAX_SCROLL || dy.abs() > MAX_SCROLL {
                return Err(format!("Scroll by 1 to {MAX_SCROLL} notches."));
            }
            s.extend([
                Step::MoveTo(*x, *y),
                Step::Sleep(60),
                Step::Wheel { dx: *dx, dy: *dy },
            ]);
        }
        Action::Type { text } => {
            let n = text.chars().count();
            if n == 0 || n > MAX_TYPE_CHARS {
                return Err(format!("Type 1 to {MAX_TYPE_CHARS} characters per call."));
            }
            if text
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\t')
            {
                return Err(
                    "The text contains control characters. Use the key action for special keys."
                        .into(),
                );
            }
            s.push(Step::Text(text.clone()));
        }
        Action::Key { keys } => {
            for (i, chord) in parse_keys(keys)?.into_iter().enumerate() {
                if i > 0 {
                    s.push(Step::Sleep(60));
                }
                s.extend(chord.mods.iter().map(|m| Step::ModDown(*m)));
                s.push(Step::Tap(chord.key));
                s.extend(chord.mods.iter().rev().map(|m| Step::ModUp(*m)));
            }
        }
    }
    Ok(s)
}

/// The steps that release what `steps` may have left pressed when it stopped half way.
fn release_all(steps: &[Step]) -> Vec<Step> {
    let mut out = Vec::new();
    for s in steps {
        match s {
            Step::Press(b) if !out.contains(&Step::Release(*b)) => out.push(Step::Release(*b)),
            Step::ModDown(m) if !out.contains(&Step::ModUp(*m)) => out.push(Step::ModUp(*m)),
            _ => {}
        }
    }
    out
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: u32,
    pub name: String,
    /// Position and size in desktop coordinates.
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Screen pixels per desktop unit (1 on Windows, 2 on a Retina display).
    pub scale: f32,
    pub primary: bool,
}

impl Display {
    fn rect(&self) -> Rect {
        Rect {
            x: self.x,
            y: self.y,
            w: self.width,
            h: self.height,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Win {
    pub id: u32,
    pub pid: u32,
    pub app: String,
    pub title: String,
    pub rect: Rect,
    pub focused: bool,
    pub minimized: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Policy {
    /// Extra deny-list entries (app names or words of window titles).
    #[serde(default)]
    pub deny: Vec<String>,
    /// When not empty, only these apps accept input.
    #[serde(default)]
    pub allow: Vec<String>,
}

fn clean_list(list: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for item in list {
        let item: String = item.trim().chars().take(80).collect();
        if !item.is_empty() && !out.iter().any(|x| x.eq_ignore_ascii_case(&item)) && out.len() < 100
        {
            out.push(item);
        }
    }
    out
}

/// Why input into `win` is refused, if it is.
pub fn guard(win: &Win, own_pid: u32, policy: &Policy, elevated: bool) -> Option<String> {
    if win.pid == own_pid {
        return Some("That is an OpenFini window. You cannot operate OpenFini's own windows, dialogs or approvals with computer use; use the OpenFini tools instead.".into());
    }
    if denied(&win.app, &win.title, &policy.deny).is_some() {
        return Some(format!(
            "“{}” is on the deny list (password managers, security settings and apps the user excluded). You cannot control it.",
            win.app
        ));
    }
    if !allowed(&win.app, &policy.allow) {
        return Some(format!(
            "“{}” is not on the user's list of allowed apps ({}).",
            win.app,
            policy.allow.join(", ")
        ));
    }
    if elevated {
        return Some(format!(
            "“{}” runs with administrator rights. Windows does not let OpenFini send input to elevated windows; the user has to do this step.",
            win.app
        ));
    }
    None
}

/// The top window at a point (the list is in z-order, front first).
fn window_at(windows: &[Win], x: i32, y: i32) -> Option<&Win> {
    windows
        .iter()
        .find(|w| !w.minimized && w.rect.contains(x, y))
}

fn frontmost(windows: &[Win]) -> Option<&Win> {
    windows.iter().find(|w| w.focused && !w.minimized)
}

/// The fixed text of the grant dialog. Asking for control offers three answers (control, view only, no); asking
/// to view offers two.
pub struct DialogText {
    pub title: String,
    pub message: String,
    pub allow: String,
    pub view_only: Option<String>,
    pub deny: String,
}

pub fn dialog_text(scope: Scope, auto_low_risk: bool, minutes: u32, german: bool) -> DialogText {
    let control = scope == Scope::Control;
    if german {
        let mut m = format!(
            "Der Assistent von OpenFini (Vibe) möchte in den nächsten {minutes} Minuten {}.\n\n• Er kann Bildschirmfotos deiner Bildschirme aufnehmen, auch von anderen Apps und allem, was dort sichtbar ist.\n• Die Bildschirmfotos werden an den KI-Anbieter gesendet, den du in OpenFini gewählt hast. OpenFini speichert sie nicht.\n",
            if control { "deinen Bildschirm SEHEN und Maus und Tastatur BEDIENEN" } else { "deinen Bildschirm SEHEN" }
        );
        if control {
            m.push_str("• Er kann in anderen Apps die Maus bewegen, klicken, scrollen, tippen und Tasten drücken, so als würdest du es tun. OpenFini kann diese Aktionen nicht rückgängig machen.\n");
            m.push_str(if auto_low_risk {
                "• Mausbewegungen, Klicks, Scrollen und Navigationstasten laufen OHNE Nachfrage. Text tippen, Tastenkürzel, die Eingabetaste und Ziehen warten weiter auf deine Zustimmung. Bewegst du die Maus oder drückst Esc, pausiert der Assistent.\n"
            } else {
                "• Jeder Klick, jeder Tastendruck und jeder Text wird in OpenFini angezeigt und wartet auf deine Zustimmung.\n"
            });
            m.push_str("• Mit „Nur ansehen“ darf er nur schauen und nichts bedienen.\n");
        } else {
            m.push_str("• Er kann weder die Maus bewegen noch tippen.\n");
        }
        m.push_str(&format!("\nFenster von Passwortmanagern und Sicherheitseinstellungen werden geschwärzt. Schließe alles andere, was du nicht teilen möchtest.\n\nJederzeit beenden: „Stopp“ in der Leiste oben am Bildschirm oder {STOP_SHORTCUT}."));
        return DialogText {
            title: "Computernutzung erlauben?".into(),
            message: m,
            allow: if control {
                "Bedienen erlauben".into()
            } else {
                "Ansehen erlauben".into()
            },
            view_only: control.then(|| "Nur ansehen".into()),
            deny: "Nicht erlauben".into(),
        };
    }
    let mut m = format!(
        "OpenFini's assistant (Vibe) asks to {} for the next {minutes} minutes.\n\n• It can take screenshots of your displays, including other apps and anything visible on them.\n• The screenshots are sent to the AI provider you selected in OpenFini. OpenFini does not store them.\n",
        if control { "SEE your screen and CONTROL the mouse and keyboard" } else { "SEE your screen" }
    );
    if control {
        m.push_str("• It can move the mouse, click, scroll, type and press keys in other apps, as if you did. OpenFini cannot undo these actions.\n");
        m.push_str(if auto_low_risk {
            "• Mouse moves, clicks, scrolling and navigation keys run WITHOUT asking. Typing text, shortcuts, Enter and drags still wait for your approval. Moving your mouse or pressing Esc pauses the assistant.\n"
        } else {
            "• Every click, key press and text is shown in OpenFini and waits for your approval.\n"
        });
        m.push_str("• Choose “View only” to let it look without touching anything.\n");
    } else {
        m.push_str("• It cannot move the mouse or type.\n");
    }
    m.push_str(&format!("\nWindows of password managers and security settings are blacked out. Close anything else you do not want to share.\n\nStop at any time: “Stop” in the bar at the top of the screen, or {STOP_SHORTCUT}."));
    DialogText {
        title: "Allow computer use?".into(),
        message: m,
        allow: if control {
            "Allow control".into()
        } else {
            "Allow viewing".into()
        },
        view_only: control.then(|| "View only".into()),
        deny: "Don't allow".into(),
    }
}

/// What the person answered: the scope they allowed, or None.
pub fn dialog_answer(text: &DialogText, asked: Scope, pressed: &str) -> Option<Scope> {
    if pressed == text.allow {
        Some(asked)
    } else if text.view_only.as_deref() == Some(pressed) {
        Some(Scope::View)
    } else {
        None
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ------------------------------------------------------------------ state

#[derive(Default)]
pub struct Computer(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    grant: Option<Grant>,
    next_id: u64,
    declined: Option<Instant>,
    asking: bool,
    policy: Option<Policy>,
}

impl Computer {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantInfo {
    id: u64,
    scope: Scope,
    auto_low_risk: bool,
    started: u64,
    expires_in_ms: u64,
    paused: Option<&'static str>,
    actions: u32,
    max_actions: u32,
}

fn info(g: &Grant, now: Instant) -> GrantInfo {
    GrantInfo {
        id: g.id,
        scope: g.scope,
        auto_low_risk: g.auto_low_risk,
        started: g.started_ms,
        expires_in_ms: g.expires.saturating_duration_since(now).as_millis() as u64,
        paused: g.paused,
        actions: g.actions,
        max_actions: MAX_ACTIONS,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    supported: bool,
    platform: &'static str,
    /// macOS: the Screen Recording and Accessibility permissions (always true elsewhere).
    screen_permission: bool,
    accessibility_permission: bool,
    grant: Option<GrantInfo>,
    stop_shortcut: &'static str,
    default_deny: &'static [&'static str],
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == MAIN_WINDOW {
        Ok(())
    } else {
        Err("Computer use can only be driven from the main window.".into())
    }
}

fn unsupported() -> String {
    "Computer use is available in the OpenFini desktop app on Windows and macOS only.".into()
}

fn policy_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("computer-use.json"))
}

fn load_policy(app: &AppHandle) -> Policy {
    let state = app.state::<Computer>();
    let mut inner = state.lock();
    if inner.policy.is_none() {
        inner.policy = Some(
            policy_file(app)
                .ok()
                .and_then(|f| fs::read(f).ok())
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default(),
        );
    }
    inner.policy.clone().unwrap_or_default()
}

fn audit_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .join("computer-use-audit.jsonl"))
}

#[derive(Serialize)]
struct AuditRow<'a> {
    time: u64,
    grant: u64,
    op: &'a str,
    detail: &'a str,
    app: &'a str,
    ok: bool,
    error: Option<&'a str>,
}

fn audit(app: &AppHandle, grant: u64, op: &str, detail: &str, target: &str, err: Option<&str>) {
    let Ok(file) = audit_file(app) else { return };
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if fs::metadata(&file)
        .map(|m| m.len() > MAX_AUDIT_BYTES)
        .unwrap_or(false)
    {
        let _ = fs::rename(&file, file.with_extension("jsonl.1"));
    }
    let row = AuditRow {
        time: now_ms(),
        grant,
        op,
        detail,
        app: target,
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

fn notify(app: &AppHandle, kind: &str, reason: &str) {
    let _ = app.emit(EVENT, serde_json::json!({ "kind": kind, "reason": reason }));
}

/// Ends the session (if one is active): the grant is gone, the hotkey and the indicator go away.
fn end(app: &AppHandle, reason: &str) -> bool {
    let Some(grant) = app.state::<Computer>().lock().grant.take() else {
        return false;
    };
    native::unregister_stop(app);
    if let Some(w) = app.get_webview_window(INDICATOR_WINDOW) {
        let _ = w.destroy();
    }
    audit(app, grant.id, "end", reason, "", None);
    notify(app, "ended", reason);
    true
}

fn pause(app: &AppHandle, reason: &'static str) {
    let id = {
        let state = app.state::<Computer>();
        let mut inner = state.lock();
        match inner.grant.as_mut() {
            Some(g) if g.paused.is_none() => {
                g.paused = Some(reason);
                g.id
            }
            _ => return,
        }
    };
    audit(app, id, "pause", reason, "", None);
    notify(app, "paused", reason);
}

/// Watches the active grant: ends it when its time is up and pauses it when the person presses Esc.
fn watch(app: AppHandle, id: u64) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(40));
        let now = Instant::now();
        let (expired, check_escape) = {
            let state = app.state::<Computer>();
            let inner = state.lock();
            match inner.grant.as_ref() {
                Some(g) if g.id == id => (
                    g.expired(now),
                    g.scope == Scope::Control
                        && g.paused.is_none()
                        && g.own_escape_until.is_none_or(|t| now > t),
                ),
                _ => return,
            }
        };
        if expired {
            end(&app, "expired");
            return;
        }
        if check_escape && native::escape_down() {
            pause(&app, "escape");
        }
    });
}

fn open_indicator(app: &AppHandle) {
    if app.get_webview_window(INDICATOR_WINDOW).is_some() {
        return;
    }
    let (w, h) = (460.0, 44.0);
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        INDICATOR_WINDOW,
        tauri::WebviewUrl::App("index.html?popout=computer-indicator".into()),
    )
    .title("OpenFini computer use")
    .inner_size(w, h)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .shadow(true);
    if let Ok(Some(m)) = app.primary_monitor() {
        let scale = m.scale_factor();
        let x = f64::from(m.position().x) / scale + (f64::from(m.size().width) / scale - w) / 2.0;
        builder = builder.position(x.max(0.0), f64::from(m.position().y) / scale + 6.0);
    }
    let _ = builder.build();
}

// ------------------------------------------------------------------ commands

/// What the platform supports, the OS permissions and the active session.
#[tauri::command]
pub fn computer_status(app: AppHandle) -> Status {
    let (screen, accessibility) = native::permissions();
    let now = Instant::now();
    let state = app.state::<Computer>();
    let inner = state.lock();
    Status {
        supported: native::SUPPORTED,
        platform: std::env::consts::OS,
        screen_permission: screen,
        accessibility_permission: accessibility,
        grant: inner
            .grant
            .as_ref()
            .filter(|g| !g.expired(now))
            .map(|g| info(g, now)),
        stop_shortcut: STOP_SHORTCUT,
        default_deny: DEFAULT_DENY,
    }
}

/// Asks the person, in a native dialog with a fixed text, to allow a session. Returns the grant, or `null` when
/// they declined. `scope` is "view" or "control" (the person may answer "view only" to a control request);
/// `minutes` is clamped to 1-60.
#[tauri::command]
pub async fn computer_grant_request(
    app: AppHandle,
    window: WebviewWindow,
    scope: Scope,
    minutes: Option<u32>,
    auto_low_risk: Option<bool>,
    locale: Option<String>,
) -> Result<Option<GrantInfo>, String> {
    use tauri_plugin_dialog::{
        DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
    };
    main_only(&window)?;
    if !native::SUPPORTED {
        return Err(unsupported());
    }
    let (screen, accessibility) = native::permissions();
    if !screen {
        return Err("macOS has not allowed OpenFini to record the screen yet. Open System Settings ▸ Privacy & Security ▸ Screen & System Audio Recording, switch OpenFini on, then restart OpenFini.".into());
    }
    if scope == Scope::Control && !accessibility {
        return Err("macOS has not allowed OpenFini to control the computer yet. Open System Settings ▸ Privacy & Security ▸ Accessibility and switch OpenFini on.".into());
    }
    let minutes = minutes.unwrap_or(15).clamp(1, MAX_MINUTES);
    let auto = auto_low_risk.unwrap_or(false) && scope == Scope::Control;
    {
        let state = app.state::<Computer>();
        let mut inner = state.lock();
        if inner.asking {
            return Err("A computer use request is already waiting for the user's answer.".into());
        }
        if inner
            .declined
            .is_some_and(|t| t.elapsed() < DECLINE_COOLDOWN)
        {
            return Err("The user just declined computer use. Do not ask again; continue without it or ask them what they prefer.".into());
        }
        inner.asking = true;
    }
    let german = locale.as_deref().is_some_and(|l| l.starts_with("de"));
    let text = dialog_text(scope, auto, minutes, german);
    let buttons = match &text.view_only {
        Some(view) => MessageDialogButtons::YesNoCancelCustom(
            text.allow.clone(),
            view.clone(),
            text.deny.clone(),
        ),
        None => MessageDialogButtons::OkCancelCustom(text.allow.clone(), text.deny.clone()),
    };
    let asker = app.clone();
    let (title, message) = (text.title.clone(), text.message.clone());
    let answer = tauri::async_runtime::spawn_blocking(move || {
        asker
            .dialog()
            .message(message)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(buttons)
            .blocking_show_with_result()
    })
    .await;
    // the plugin reports custom buttons by their label on most platforms and by their role on others
    let allowed = match answer {
        Ok(MessageDialogResult::Custom(label)) => dialog_answer(&text, scope, &label),
        Ok(MessageDialogResult::Yes | MessageDialogResult::Ok) => Some(scope),
        Ok(MessageDialogResult::No) if text.view_only.is_some() => Some(Scope::View),
        _ => None,
    };
    let now = Instant::now();
    let granted = {
        let state = app.state::<Computer>();
        let mut inner = state.lock();
        inner.asking = false;
        match allowed {
            Some(scope) => {
                inner.next_id += 1;
                let g = Grant::new(inner.next_id, scope, auto, minutes, now);
                let out = info(&g, now);
                inner.grant = Some(g);
                inner.declined = None;
                Some(out)
            }
            None => {
                inner.declined = Some(now);
                None
            }
        }
    };
    let Some(g) = granted else {
        audit(
            &app,
            0,
            "declined",
            if scope == Scope::Control {
                "control"
            } else {
                "view"
            },
            "",
            None,
        );
        return Ok(None);
    };
    let detail = format!(
        "{} for {minutes} min{}",
        if g.scope == Scope::Control {
            "control"
        } else {
            "view"
        },
        if g.auto_low_risk {
            ", low-risk actions without asking"
        } else {
            ""
        }
    );
    audit(&app, g.id, "grant", &detail, "", None);
    native::register_stop(&app);
    open_indicator(&app);
    watch(app.clone(), g.id);
    notify(&app, "granted", "");
    Ok(Some(g))
}

/// Ends the session. Also called by the indicator's Stop button and the global hotkey.
#[tauri::command]
pub fn computer_stop(app: AppHandle) -> bool {
    end(&app, "stopped")
}

/// Pauses input (screenshots keep working).
#[tauri::command]
pub fn computer_pause(app: AppHandle) {
    pause(&app, "user");
}

/// Resumes after a pause. Only the person does this (buttons in the indicator and the settings).
#[tauri::command]
pub fn computer_resume(app: AppHandle) {
    let id = {
        let state = app.state::<Computer>();
        let mut inner = state.lock();
        match inner.grant.as_mut() {
            Some(g) if g.paused.is_some() => {
                g.paused = None;
                g.last_cursor = None;
                g.id
            }
            _ => return,
        }
    };
    audit(&app, id, "resume", "", "", None);
    notify(&app, "resumed", "");
}

/// macOS: asks the system for the permission once (so OpenFini shows up in the list) and opens the right pane of
/// System Settings. `pane` is "screen" or "accessibility".
#[tauri::command]
pub fn computer_open_settings(window: WebviewWindow, pane: String) -> Result<(), String> {
    main_only(&window)?;
    native::open_settings(&pane)
}

/// The person's deny and allow lists.
#[tauri::command]
pub fn computer_policy(app: AppHandle, window: WebviewWindow) -> Result<Policy, String> {
    main_only(&window)?;
    Ok(load_policy(&app))
}

/// Replaces the person's deny and allow lists. Refused while a session is active.
#[tauri::command]
pub fn computer_policy_set(
    app: AppHandle,
    window: WebviewWindow,
    deny: Vec<String>,
    allow: Vec<String>,
) -> Result<Policy, String> {
    main_only(&window)?;
    let policy = Policy {
        deny: clean_list(deny),
        allow: clean_list(allow),
    };
    {
        let state = app.state::<Computer>();
        let mut inner = state.lock();
        if inner.grant.is_some() {
            return Err("Stop the computer use session before changing the app lists.".into());
        }
        inner.policy = Some(policy.clone());
    }
    let file = policy_file(&app)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(
        &file,
        serde_json::to_vec_pretty(&policy).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    audit(
        &app,
        0,
        "policy",
        &format!(
            "{} denied, {} allowed",
            policy.deny.len(),
            policy.allow.len()
        ),
        "",
        None,
    );
    Ok(policy)
}

/// Checks the grant for one call; returns its id.
fn admit(app: &AppHandle, need: Need) -> Result<u64, String> {
    if !native::SUPPORTED {
        return Err(unsupported());
    }
    let now = Instant::now();
    let state = app.state::<Computer>();
    let mut inner = state.lock();
    let g = inner.grant.as_mut().ok_or(
        "There is no computer use session. The user has to allow one in the native dialog first.",
    )?;
    g.check(need, now)?;
    Ok(g.id)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// The displays: position and size in desktop coordinates, pixel scale, which one is primary.
#[tauri::command]
pub async fn computer_displays(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<Display>, String> {
    main_only(&window)?;
    {
        let state = app.state::<Computer>();
        let inner = state.lock();
        if !inner
            .grant
            .as_ref()
            .is_some_and(|g| !g.expired(Instant::now()))
        {
            return Err("There is no computer use session.".into());
        }
    }
    blocking(native::displays).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinInfo {
    app: String,
    title: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    focused: bool,
    minimized: bool,
    /// On the deny list: its title is hidden, it is blacked out in screenshots and refuses input.
    denied: bool,
    own: bool,
}

/// The open windows, front first: app, title, bounds, which one is in front.
#[tauri::command]
pub async fn computer_windows(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<WinInfo>, String> {
    main_only(&window)?;
    {
        let state = app.state::<Computer>();
        let inner = state.lock();
        if !inner
            .grant
            .as_ref()
            .is_some_and(|g| !g.expired(Instant::now()))
        {
            return Err("There is no computer use session.".into());
        }
    }
    let policy = load_policy(&app);
    blocking(move || {
        let own = std::process::id();
        Ok(native::windows()?
            .into_iter()
            .filter(|w| !w.app.is_empty() || !w.title.is_empty())
            .take(60)
            .map(|w| {
                let hidden = denied(&w.app, &w.title, &policy.deny).is_some();
                WinInfo {
                    title: if hidden {
                        String::new()
                    } else {
                        w.title.chars().take(120).collect()
                    },
                    app: w.app,
                    x: w.rect.x,
                    y: w.rect.y,
                    width: w.rect.w,
                    height: w.rect.h,
                    focused: w.focused,
                    minimized: w.minimized,
                    denied: hidden,
                    own: w.pid == own,
                }
            })
            .collect())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    /// base64 JPEG
    data: String,
    mime: &'static str,
    width: u32,
    height: u32,
    display: u32,
    /// The captured area in desktop coordinates. A point (px, py) of the image is at
    /// x + (px + 0.5) * w / width, y + (py + 0.5) * h / height on the desktop.
    region: Rect,
    /// Screen pixels per desktop unit of that display.
    scale: f32,
    /// Apps whose windows were blacked out.
    redacted: Vec<String>,
}

/// A screenshot of one display (the primary one by default) or of `region` (desktop coordinates, inside one
/// display), scaled down so its longer side is at most `maxPx`. Windows on the deny list are blacked out.
#[tauri::command]
pub async fn computer_screenshot(
    app: AppHandle,
    window: WebviewWindow,
    display: Option<u32>,
    region: Option<Rect>,
    max_px: Option<u32>,
) -> Result<Shot, String> {
    main_only(&window)?;
    let id = admit(&app, Need::View)?;
    let policy = load_policy(&app);
    let logger = app.clone();
    let out = blocking(move || {
        let displays = native::displays()?;
        let d = match (display, region) {
            (Some(id), _) => displays.iter().find(|d| d.id == id),
            (None, Some(r)) => displays.iter().find(|d| d.rect().contains(r.x, r.y)),
            (None, None) => displays.iter().find(|d| d.primary).or(displays.first()),
        }
        .ok_or("There is no such display. List them with the info tool.")?;
        let area = match region {
            Some(r) => r
                .clip(&d.rect())
                .filter(|c| c.w >= 8 && c.h >= 8)
                .ok_or("The region is outside the display or too small.")?,
            None => d.rect(),
        };
        let raw = native::capture(d, &area)?;
        let (w, h) = fit(
            raw.0,
            raw.1,
            max_px.unwrap_or(1280).clamp(MIN_SHOT_PX, MAX_SHOT_PX),
        );
        let mut blackouts = Vec::new();
        let mut redacted: Vec<String> = Vec::new();
        for win in native::windows().unwrap_or_default() {
            if win.minimized || denied(&win.app, &win.title, &policy.deny).is_none() {
                continue;
            }
            if let Some(px) = to_image(&area, w, h, &win.rect) {
                blackouts.push(px);
                if !redacted.contains(&win.app) {
                    redacted.push(win.app);
                }
            }
        }
        let jpeg = native::encode(raw, w, h, &blackouts)?;
        Ok(Shot {
            data: wire::b64_encode(&jpeg),
            mime: "image/jpeg",
            width: w,
            height: h,
            display: d.id,
            region: area,
            scale: d.scale,
            redacted,
        })
    })
    .await;
    match &out {
        Ok(s) => audit(
            &logger,
            id,
            "screenshot",
            &format!(
                "display {} {}x{} at {},{} as {}x{}",
                s.display, s.region.w, s.region.h, s.region.x, s.region.y, s.width, s.height
            ),
            &s.redacted.join(", "),
            None,
        ),
        Err(e) => audit(&logger, id, "screenshot", "", "", Some(e)),
    }
    out
}

/// The cursor position in desktop coordinates.
#[tauri::command]
pub async fn computer_cursor(app: AppHandle, window: WebviewWindow) -> Result<(i32, i32), String> {
    main_only(&window)?;
    {
        let state = app.state::<Computer>();
        let inner = state.lock();
        if !inner
            .grant
            .as_ref()
            .is_some_and(|g| !g.expired(Instant::now()))
        {
            return Err("There is no computer use session.".into());
        }
    }
    blocking(native::cursor).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputResult {
    cursor: (i32, i32),
    /// The app in front after the action.
    app: String,
    title: String,
}

/// Runs one mouse or keyboard action (desktop coordinates). `confirmed` says that the person approved this very
/// action in the page; without it, a mouse the person moved pauses a session that runs low-risk actions unasked.
#[tauri::command]
pub async fn computer_input(
    app: AppHandle,
    window: WebviewWindow,
    action: Action,
    confirmed: Option<bool>,
) -> Result<InputResult, String> {
    main_only(&window)?;
    let id = admit(&app, Need::Input)?;
    let policy = load_policy(&app);
    let (name, detail) = (action.name(), action.detail());
    let runner = app.clone();
    let out =
        blocking(move || run_input(&runner, &action, confirmed.unwrap_or(false), &policy)).await;
    match &out {
        Ok(r) => audit(&app, id, name, &detail, &r.app, None),
        Err(e) => audit(&app, id, name, &detail, "", Some(e)),
    }
    out
}

fn run_input(
    app: &AppHandle,
    action: &Action,
    confirmed: bool,
    policy: &Policy,
) -> Result<InputResult, String> {
    let steps = plan(action)?;
    let own = std::process::id();
    let state = app.state::<Computer>();

    // the person took the mouse: pause instead of fighting over it
    let before = native::cursor()?;
    let target = {
        let mut inner = state.lock();
        let g = inner
            .grant
            .as_mut()
            .ok_or("There is no computer use session.")?;
        if g.auto_low_risk && !confirmed && cursor_moved(g.last_cursor, before) {
            g.paused = Some("mouse");
            drop(inner);
            notify(app, "paused", "mouse");
            return Err("Computer use paused because the user moved the mouse. They have to press Resume in OpenFini. Do not retry until they say so.".into());
        }
        g.target.clone()
    };

    // every point has to be on a display, and never in a window that refuses input
    let displays = native::displays()?;
    let mut windows = native::windows()?;
    for (x, y) in action.points() {
        if !displays.iter().any(|d| d.rect().contains(x, y)) {
            return Err(format!("The point {x},{y} is not on any display."));
        }
        if let Some(w) = window_at(&windows, x, y) {
            if let Some(why) = guard(w, own, policy, native::elevated(w.pid)) {
                return Err(why);
            }
        }
    }
    if action.keyboard() {
        // after an approval in OpenFini, OpenFini is in front: go back to the window the last click chose
        if frontmost(&windows).is_none_or(|w| w.pid == own) {
            let back = target
                .and_then(|(id, _)| windows.iter().find(|w| w.id == id && w.pid != own).cloned())
                .ok_or("OpenFini is in front, so the keys would go to OpenFini. Click the window or field you want to type into first.")?;
            native::activate(&back);
            for _ in 0..12 {
                std::thread::sleep(Duration::from_millis(60));
                windows = native::windows()?;
                if frontmost(&windows).is_some_and(|w| w.pid != own) {
                    break;
                }
            }
        }
        let front = frontmost(&windows)
            .filter(|w| w.pid != own)
            .ok_or("The target window could not be brought to the front. Click the window or field you want to type into first.")?;
        if let Some(why) = guard(front, own, policy, native::elevated(front.pid)) {
            return Err(why);
        }
        if matches!(action, Action::Type { .. }) && sensitive_title(&front.title) {
            return Err("The window in front looks like a sign-in or payment page. Typing there is refused: the user has to enter credentials and payment details themselves. Tell them, and continue when they are done.".into());
        }
    }
    let presses_escape = steps.contains(&Step::Tap(KeySpec::Escape));
    if presses_escape {
        if let Some(g) = state.lock().grant.as_mut() {
            g.own_escape_until = Some(Instant::now() + Duration::from_millis(1500));
        }
    }

    native::inject(app, steps)?;
    std::thread::sleep(Duration::from_millis(120));

    let cursor = native::cursor().unwrap_or(before);
    let after = native::windows().unwrap_or_default();
    let front = frontmost(&after).cloned();
    {
        let mut inner = state.lock();
        if let Some(g) = inner.grant.as_mut() {
            g.last_cursor = Some(cursor);
            if presses_escape {
                g.own_escape_until = Some(Instant::now() + Duration::from_millis(400));
            }
            if let Some(f) = front.as_ref().filter(|f| f.pid != own) {
                g.target = Some((f.id, f.app.clone()));
            }
        }
    }
    let shown = front.filter(|f| denied(&f.app, &f.title, &policy.deny).is_none());
    Ok(InputResult {
        cursor,
        app: shown.as_ref().map(|f| f.app.clone()).unwrap_or_default(),
        title: shown
            .map(|f| f.title.chars().take(120).collect())
            .unwrap_or_default(),
    })
}

/// The newest rows of the action log (JSON lines), newest last.
#[tauri::command]
pub fn computer_audit(
    app: AppHandle,
    window: WebviewWindow,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    main_only(&window)?;
    let text = fs::read_to_string(audit_file(&app)?).unwrap_or_default();
    let rows: Vec<String> = text.lines().map(str::to_string).collect();
    let n = limit.unwrap_or(200).min(2000);
    Ok(rows[rows.len().saturating_sub(n)..].to_vec())
}

/// Deletes the action log.
#[tauri::command]
pub fn computer_audit_clear(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    let file = audit_file(&app)?;
    let _ = fs::remove_file(file.with_extension("jsonl.1"));
    match fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Registers what the module needs at start-up (the global shortcut plugin on Windows and macOS).
pub fn plugin<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    native::plugin(builder)
}

/// Called by the global hotkey.
fn hotkey_stop(app: &AppHandle) {
    end(app, "hotkey");
}

// ------------------------------------------------------------------ native: Windows and macOS

#[cfg(any(windows, target_os = "macos"))]
mod native {
    use super::{Btn, Display, KeySpec, Mod, Rect, Step, Win};
    #[cfg(target_os = "macos")]
    use enigo::Coordinate;
    use enigo::{Axis, Button, Direction, Enigo, Key, Keyboard, Mouse, Settings};
    use tauri::AppHandle;
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    pub const SUPPORTED: bool = true;

    fn stop_shortcut() -> Shortcut {
        Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),
            Code::Escape,
        )
    }

    pub fn plugin<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
        builder.plugin(tauri_plugin_global_shortcut::Builder::new().build())
    }

    pub fn register_stop(app: &AppHandle) {
        let _ = app
            .global_shortcut()
            .on_shortcut(stop_shortcut(), |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    super::hotkey_stop(app);
                }
            });
    }

    pub fn unregister_stop(app: &AppHandle) {
        let _ = app.global_shortcut().unregister(stop_shortcut());
    }

    fn err(e: impl std::fmt::Display) -> String {
        e.to_string()
    }

    pub fn displays() -> Result<Vec<Display>, String> {
        let mut out = Vec::new();
        for m in xcap::Monitor::all().map_err(err)? {
            out.push(Display {
                id: m.id().map_err(err)?,
                name: m.friendly_name().or_else(|_| m.name()).unwrap_or_default(),
                x: m.x().map_err(err)?,
                y: m.y().map_err(err)?,
                width: m.width().map_err(err)?,
                height: m.height().map_err(err)?,
                scale: m.scale_factor().unwrap_or(1.0),
                primary: m.is_primary().unwrap_or(false),
            });
        }
        if out.is_empty() {
            return Err("No display was found.".into());
        }
        Ok(out)
    }

    pub fn windows() -> Result<Vec<Win>, String> {
        let mut out = Vec::new();
        for w in xcap::Window::all().map_err(err)? {
            let (Ok(id), Ok(pid), Ok(x), Ok(y), Ok(width), Ok(height)) =
                (w.id(), w.pid(), w.x(), w.y(), w.width(), w.height())
            else {
                continue;
            };
            out.push(Win {
                id,
                pid,
                app: w.app_name().unwrap_or_default(),
                title: w.title().unwrap_or_default(),
                rect: Rect {
                    x,
                    y,
                    w: width,
                    h: height,
                },
                focused: w.is_focused().unwrap_or(false),
                minimized: w.is_minimized().unwrap_or(false),
            });
        }
        Ok(out)
    }

    /// Captures `area` (desktop coordinates, inside `d`): width, height and RGBA pixels.
    pub fn capture(d: &Display, area: &Rect) -> Result<(u32, u32, Vec<u8>), String> {
        let monitor = xcap::Monitor::all()
            .map_err(err)?
            .into_iter()
            .find(|m| m.id().ok() == Some(d.id))
            .ok_or("The display is gone.")?;
        let img = if *area == (Rect { x: d.x, y: d.y, w: d.width, h: d.height }) {
            monitor.capture_image()
        } else {
            monitor.capture_region((area.x - d.x) as u32, (area.y - d.y) as u32, area.w, area.h)
        }
        .map_err(|e| {
            if cfg!(target_os = "macos") {
                format!("The screen could not be captured ({e}). Check System Settings ▸ Privacy & Security ▸ Screen & System Audio Recording.")
            } else {
                format!("The screen could not be captured ({e}).")
            }
        })?;
        Ok((img.width(), img.height(), img.into_raw()))
    }

    /// Scales the capture to `w` × `h`, blacks out the given pixel rectangles and encodes a JPEG.
    pub fn encode(
        raw: (u32, u32, Vec<u8>),
        w: u32,
        h: u32,
        blackouts: &[(u32, u32, u32, u32)],
    ) -> Result<Vec<u8>, String> {
        use image::{imageops, DynamicImage, Rgba, RgbaImage};
        let img = RgbaImage::from_raw(raw.0, raw.1, raw.2)
            .ok_or("The capture has an unexpected size.")?;
        let mut img = if (raw.0, raw.1) == (w, h) {
            img
        } else {
            imageops::resize(&img, w, h, imageops::FilterType::Triangle)
        };
        for &(bx, by, bw, bh) in blackouts {
            for y in by..(by + bh).min(h) {
                for x in bx..(bx + bw).min(w) {
                    img.put_pixel(x, y, Rgba([0, 0, 0, 255]));
                }
            }
        }
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
            .encode_image(&DynamicImage::ImageRgba8(img).to_rgb8())
            .map_err(err)?;
        Ok(out)
    }

    fn enigo() -> Result<Enigo, String> {
        let settings = Settings {
            open_prompt_to_get_permissions: false,
            ..Settings::default()
        };
        Enigo::new(&settings).map_err(|e| {
            if cfg!(target_os = "macos") {
                format!("The mouse and keyboard cannot be used ({e}). Allow OpenFini under System Settings ▸ Privacy & Security ▸ Accessibility.")
            } else {
                format!("The mouse and keyboard cannot be used ({e}).")
            }
        })
    }

    pub fn cursor() -> Result<(i32, i32), String> {
        enigo()?.location().map_err(err)
    }

    #[cfg(windows)]
    fn move_to(_e: &mut Enigo, x: i32, y: i32) -> Result<(), String> {
        // SetCursorPos takes virtual-desktop pixels, so every display is reachable (enigo's absolute move maps
        // onto the primary display only)
        if unsafe { windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos(x, y) } == 0 {
            return Err("The mouse could not be moved.".into());
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn move_to(e: &mut Enigo, x: i32, y: i32) -> Result<(), String> {
        e.move_mouse(x, y, Coordinate::Abs).map_err(err)
    }

    fn button(b: Btn) -> Button {
        match b {
            Btn::Left => Button::Left,
            Btn::Right => Button::Right,
            Btn::Middle => Button::Middle,
        }
    }

    fn modifier(m: Mod) -> Key {
        match m {
            Mod::Ctrl => Key::Control,
            Mod::Alt => Key::Alt,
            Mod::Shift => Key::Shift,
            Mod::Meta => Key::Meta,
        }
    }

    fn key(k: KeySpec) -> Key {
        match k {
            KeySpec::Enter => Key::Return,
            KeySpec::Tab => Key::Tab,
            KeySpec::Escape => Key::Escape,
            KeySpec::Backspace => Key::Backspace,
            KeySpec::Delete => Key::Delete,
            KeySpec::Space => Key::Space,
            KeySpec::Up => Key::UpArrow,
            KeySpec::Down => Key::DownArrow,
            KeySpec::Left => Key::LeftArrow,
            KeySpec::Right => Key::RightArrow,
            KeySpec::Home => Key::Home,
            KeySpec::End => Key::End,
            KeySpec::PageUp => Key::PageUp,
            KeySpec::PageDown => Key::PageDown,
            #[cfg(windows)]
            KeySpec::Insert => Key::Insert,
            #[cfg(target_os = "macos")]
            KeySpec::Insert => Key::Help,
            KeySpec::F(n) => match n {
                1 => Key::F1,
                2 => Key::F2,
                3 => Key::F3,
                4 => Key::F4,
                5 => Key::F5,
                6 => Key::F6,
                7 => Key::F7,
                8 => Key::F8,
                9 => Key::F9,
                10 => Key::F10,
                11 => Key::F11,
                12 => Key::F12,
                13 => Key::F13,
                14 => Key::F14,
                15 => Key::F15,
                16 => Key::F16,
                17 => Key::F17,
                18 => Key::F18,
                19 => Key::F19,
                _ => Key::F20,
            },
            KeySpec::Char(c) => Key::Unicode(c),
        }
    }

    fn perform(e: &mut Enigo, step: &Step) -> Result<(), String> {
        match step {
            Step::MoveTo(x, y) => move_to(e, *x, *y),
            Step::Press(b) => e.button(button(*b), Direction::Press).map_err(err),
            Step::Release(b) => e.button(button(*b), Direction::Release).map_err(err),
            Step::Wheel { dx, dy } => {
                if *dy != 0 {
                    e.scroll(*dy, Axis::Vertical).map_err(err)?;
                }
                if *dx != 0 {
                    e.scroll(*dx, Axis::Horizontal).map_err(err)?;
                }
                Ok(())
            }
            Step::Text(t) => e.text(t).map_err(err),
            Step::ModDown(m) => e.key(modifier(*m), Direction::Press).map_err(err),
            Step::ModUp(m) => e.key(modifier(*m), Direction::Release).map_err(err),
            Step::Tap(k) => e.key(key(*k), Direction::Click).map_err(err),
            Step::Sleep(ms) => {
                std::thread::sleep(std::time::Duration::from_millis(*ms));
                Ok(())
            }
        }
    }

    fn run(steps: &[Step]) -> Result<(), String> {
        let mut e = enigo()?;
        for (i, step) in steps.iter().enumerate() {
            if let Err(error) = perform(&mut e, step) {
                // never leave a button or modifier held down
                for undo in super::release_all(&steps[..i]) {
                    let _ = perform(&mut e, &undo);
                }
                return Err(format!("The action failed: {error}"));
            }
        }
        Ok(())
    }

    /// Windows: SendInput works from any thread.
    #[cfg(windows)]
    pub fn inject(_app: &AppHandle, steps: Vec<Step>) -> Result<(), String> {
        run(&steps)
    }

    /// macOS: the keyboard layout lookup behind key events must run on the main thread.
    #[cfg(target_os = "macos")]
    pub fn inject(app: &AppHandle, steps: Vec<Step>) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(run(&steps));
        })
        .map_err(err)?;
        rx.recv_timeout(std::time::Duration::from_secs(30))
            .map_err(|_| "The action did not finish in time.".to_string())?
    }

    #[cfg(windows)]
    mod os {
        use super::Win;
        use windows_sys::Win32::Foundation::{
            CloseHandle, GetLastError, ERROR_ACCESS_DENIED, HANDLE,
        };
        use windows_sys::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE};
        use windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow;

        pub fn permissions() -> (bool, bool) {
            (true, true)
        }

        pub fn open_settings(_pane: &str) -> Result<(), String> {
            Ok(())
        }

        pub fn escape_down() -> bool {
            // high bit: down right now; low bit: pressed since the last call
            let s = unsafe { GetAsyncKeyState(i32::from(VK_ESCAPE)) };
            s < 0 || s & 1 != 0
        }

        /// None when the process cannot be inspected at all (which elevated processes cause).
        fn token_elevated(pid: u32) -> Option<bool> {
            unsafe {
                let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                if process.is_null() {
                    return (GetLastError() == ERROR_ACCESS_DENIED).then_some(true);
                }
                let mut token: HANDLE = std::ptr::null_mut();
                let mut out = None;
                if OpenProcessToken(process, TOKEN_QUERY, &mut token) != 0 {
                    let mut info = TOKEN_ELEVATION { TokenIsElevated: 0 };
                    let mut len = 0u32;
                    if GetTokenInformation(
                        token,
                        TokenElevation,
                        (&raw mut info).cast(),
                        std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                        &mut len,
                    ) != 0
                    {
                        out = Some(info.TokenIsElevated != 0);
                    }
                    CloseHandle(token);
                } else if GetLastError() == ERROR_ACCESS_DENIED {
                    out = Some(true);
                }
                CloseHandle(process);
                out
            }
        }

        /// True when the window's process is elevated and OpenFini is not: UIPI drops input sent to it.
        pub fn elevated(pid: u32) -> bool {
            token_elevated(pid) == Some(true) && token_elevated(std::process::id()) != Some(true)
        }

        pub fn activate(w: &Win) {
            unsafe {
                SetForegroundWindow(w.id as usize as _);
            }
        }
    }

    #[cfg(target_os = "macos")]
    mod os {
        use super::Win;

        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGPreflightScreenCaptureAccess() -> bool;
            fn CGRequestScreenCaptureAccess() -> bool;
            fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
        }
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrusted() -> u8;
        }

        /// Screen Recording and Accessibility (TCC).
        pub fn permissions() -> (bool, bool) {
            unsafe { (CGPreflightScreenCaptureAccess(), AXIsProcessTrusted() != 0) }
        }

        pub fn open_settings(pane: &str) -> Result<(), String> {
            let anchor = match pane {
                "screen" => {
                    // registers OpenFini in the list (and shows the system prompt the first time)
                    unsafe { CGRequestScreenCaptureAccess() };
                    "Privacy_ScreenCapture"
                }
                "accessibility" => "Privacy_Accessibility",
                _ => return Err("Unknown settings pane.".into()),
            };
            std::process::Command::new("open")
                .arg(format!(
                    "x-apple.systempreferences:com.apple.preference.security?{anchor}"
                ))
                .spawn()
                .map(|_| ())
                .map_err(|e| e.to_string())
        }

        pub fn escape_down() -> bool {
            // 1 = the hardware state (events OpenFini posts do not count), 53 = Esc
            unsafe { CGEventSourceKeyState(1, 53) }
        }

        pub fn elevated(_pid: u32) -> bool {
            false
        }

        pub fn activate(w: &Win) {
            if !w.app.is_empty() && !w.app.starts_with('-') {
                let _ = std::process::Command::new("open")
                    .arg("-a")
                    .arg(&w.app)
                    .status();
            }
        }
    }

    pub use os::{activate, elevated, escape_down, open_settings, permissions};
}

// ------------------------------------------------------------------ native: everything else (not supported)

#[cfg(not(any(windows, target_os = "macos")))]
mod native {
    use super::{Display, Rect, Step, Win};
    use tauri::AppHandle;

    pub const SUPPORTED: bool = false;

    pub fn plugin<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
        builder
    }
    pub fn register_stop(_app: &AppHandle) {}
    pub fn unregister_stop(app: &AppHandle) {
        // keeps the hotkey handler referenced on platforms without the hotkey
        let _ = super::hotkey_stop as fn(&AppHandle);
        let _ = app;
    }
    pub fn permissions() -> (bool, bool) {
        (false, false)
    }
    pub fn open_settings(_pane: &str) -> Result<(), String> {
        Err(super::unsupported())
    }
    pub fn displays() -> Result<Vec<Display>, String> {
        Err(super::unsupported())
    }
    pub fn windows() -> Result<Vec<Win>, String> {
        Err(super::unsupported())
    }
    pub fn capture(_d: &Display, _area: &Rect) -> Result<(u32, u32, Vec<u8>), String> {
        Err(super::unsupported())
    }
    pub fn encode(
        _raw: (u32, u32, Vec<u8>),
        _w: u32,
        _h: u32,
        _blackouts: &[(u32, u32, u32, u32)],
    ) -> Result<Vec<u8>, String> {
        Err(super::unsupported())
    }
    pub fn cursor() -> Result<(i32, i32), String> {
        Err(super::unsupported())
    }
    pub fn inject(_app: &AppHandle, steps: Vec<Step>) -> Result<(), String> {
        let _ = super::release_all(&steps);
        Err(super::unsupported())
    }
    pub fn escape_down() -> bool {
        false
    }
    pub fn elevated(_pid: u32) -> bool {
        false
    }
    pub fn activate(_w: &Win) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant(scope: Scope, auto: bool) -> (Grant, Instant) {
        let now = Instant::now();
        (Grant::new(1, scope, auto, 15, now), now)
    }

    #[test]
    fn fit_scales_down_only_and_keeps_the_aspect_ratio() {
        assert_eq!(fit(1920, 1080, 1280), (1280, 720));
        assert_eq!(fit(1080, 1920, 1280), (720, 1280));
        assert_eq!(fit(800, 600, 1280), (800, 600));
        assert_eq!(fit(3840, 2160, 1280), (1280, 720));
        assert_eq!(fit(5120, 1440, 1280), (1280, 360));
        assert_eq!(fit(0, 0, 1280), (1, 1));
    }

    #[test]
    fn image_points_map_back_onto_the_desktop() {
        // a 2560x1440 display left of the primary one, shown as 1280x720
        let region = Rect {
            x: -2560,
            y: 0,
            w: 2560,
            h: 1440,
        };
        assert_eq!(to_desktop(&region, 1280, 720, 0.0, 0.0), (-2559, 1));
        assert_eq!(to_desktop(&region, 1280, 720, 640.0, 360.0), (-1279, 721));
        assert_eq!(to_desktop(&region, 1280, 720, 1279.0, 719.0), (-1, 1439));
        // out-of-range input stays inside the region
        assert_eq!(to_desktop(&region, 1280, 720, 5000.0, -5.0), (-1, 0));
        // unscaled: the identity
        let same = Rect {
            x: 100,
            y: 50,
            w: 400,
            h: 300,
        };
        assert_eq!(to_desktop(&same, 400, 300, 10.0, 20.0), (110, 70));
        // every image pixel maps into the desktop area its pixel covers, and back
        let r = Rect {
            x: 0,
            y: 0,
            w: 1512,
            h: 982,
        };
        let (w, h) = fit(3024, 1964, 1280);
        for px in [0u32, 1, 639, w - 1] {
            let (x, _) = to_desktop(&r, w, h, f64::from(px), 0.0);
            let back = (f64::from(x) * f64::from(w) / f64::from(r.w)).floor() as u32;
            assert!(back.abs_diff(px) <= 1, "{px} -> {x} -> {back}");
        }
    }

    #[test]
    fn rectangles_clip_and_map_into_the_image() {
        let region = Rect {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
        };
        let win = Rect {
            x: 960,
            y: 540,
            w: 2000,
            h: 200,
        };
        assert_eq!(
            win.clip(&region),
            Some(Rect {
                x: 960,
                y: 540,
                w: 960,
                h: 200
            })
        );
        assert_eq!(
            to_image(&region, 1280, 720, &win),
            Some((640, 360, 640, 134))
        );
        assert_eq!(
            to_image(
                &region,
                1280,
                720,
                &Rect {
                    x: 3000,
                    y: 0,
                    w: 10,
                    h: 10
                }
            ),
            None
        );
        assert!(
            region.contains(1919, 1079) && !region.contains(1920, 0) && !region.contains(-1, 5)
        );
    }

    #[test]
    fn keys_and_chords_parse() {
        assert_eq!(
            parse_chord("Enter").unwrap(),
            Chord {
                mods: vec![],
                key: KeySpec::Enter
            }
        );
        assert_eq!(parse_chord("Return").unwrap().key, KeySpec::Enter);
        assert_eq!(
            parse_chord("ctrl+c").unwrap(),
            Chord {
                mods: vec![Mod::Ctrl],
                key: KeySpec::Char('c')
            }
        );
        assert_eq!(
            parse_chord("Cmd+Shift+T").unwrap(),
            Chord {
                mods: vec![Mod::Meta, Mod::Shift],
                key: KeySpec::Char('T')
            }
        );
        assert_eq!(
            parse_chord("alt+F4").unwrap(),
            Chord {
                mods: vec![Mod::Alt],
                key: KeySpec::F(4)
            }
        );
        assert_eq!(parse_chord("Page_Down").unwrap().key, KeySpec::PageDown);
        assert_eq!(
            parse_chord("ctrl++").unwrap(),
            Chord {
                mods: vec![Mod::Ctrl],
                key: KeySpec::Char('+')
            }
        );
        assert_eq!(parse_chord("+").unwrap().key, KeySpec::Char('+'));
        assert_eq!(parse_chord("ctrl+ctrl+a").unwrap().mods, vec![Mod::Ctrl]);
        for bad in ["", "ctrl", "ctrl+", "hello", "c+ctrl", "F99", "ctrl+shift"] {
            assert!(parse_chord(bad).is_err(), "{bad}");
        }
        assert_eq!(parse_keys("ctrl+a Delete").unwrap().len(), 2);
        assert!(parse_keys("  ").is_err());
        assert!(parse_keys("a b c d e f g h i").is_err(), "at most 8 keys");
    }

    #[test]
    fn plans_release_everything_they_press() {
        let balanced = |steps: &[Step]| {
            let mut held: Vec<String> = Vec::new();
            for s in steps {
                match s {
                    Step::Press(b) => held.push(format!("{b:?}")),
                    Step::ModDown(m) => held.push(format!("{m:?}")),
                    Step::Release(b) => assert_eq!(held.pop(), Some(format!("{b:?}"))),
                    Step::ModUp(m) => assert_eq!(held.pop(), Some(format!("{m:?}"))),
                    _ => {}
                }
            }
            assert!(held.is_empty());
        };
        let click = plan(&Action::Click {
            x: 5,
            y: 6,
            button: Btn::Left,
            count: 2,
        })
        .unwrap();
        assert_eq!(click[0], Step::MoveTo(5, 6));
        assert_eq!(
            click
                .iter()
                .filter(|s| **s == Step::Press(Btn::Left))
                .count(),
            2
        );
        balanced(&click);
        let drag = plan(&Action::Drag {
            x: 0,
            y: 0,
            x2: 120,
            y2: -60,
        })
        .unwrap();
        assert!(
            drag.contains(&Step::MoveTo(120, -60)),
            "the drag ends exactly at the target"
        );
        balanced(&drag);
        let keys = plan(&Action::Key {
            keys: "ctrl+shift+t Enter".into(),
        })
        .unwrap();
        balanced(&keys);
        assert!(keys.contains(&Step::Tap(KeySpec::Enter)));
        // a failure after the press still releases
        let held = &drag[..4];
        assert_eq!(release_all(held), vec![Step::Release(Btn::Left)]);
        assert_eq!(
            release_all(&keys[..2]),
            vec![Step::ModUp(Mod::Ctrl), Step::ModUp(Mod::Shift)]
        );
    }

    #[test]
    fn plans_refuse_bad_input() {
        assert!(plan(&Action::Click {
            x: 0,
            y: 0,
            button: Btn::Left,
            count: 0
        })
        .is_err());
        assert!(plan(&Action::Click {
            x: 0,
            y: 0,
            button: Btn::Left,
            count: 4
        })
        .is_err());
        assert!(plan(&Action::Scroll {
            x: 0,
            y: 0,
            dx: 0,
            dy: 0
        })
        .is_err());
        assert!(plan(&Action::Scroll {
            x: 0,
            y: 0,
            dx: 0,
            dy: 31
        })
        .is_err());
        assert!(plan(&Action::Scroll {
            x: 0,
            y: 0,
            dx: 0,
            dy: -3
        })
        .is_ok());
        assert!(plan(&Action::Type {
            text: String::new()
        })
        .is_err());
        assert!(plan(&Action::Type {
            text: "x".repeat(MAX_TYPE_CHARS + 1)
        })
        .is_err());
        assert!(
            plan(&Action::Type {
                text: "a\u{1b}b".into()
            })
            .is_err(),
            "control characters"
        );
        assert!(plan(&Action::Type {
            text: "two\nlines\tok".into()
        })
        .is_ok());
        assert!(plan(&Action::Key {
            keys: "nonsense".into()
        })
        .is_err());
    }

    #[test]
    fn actions_deserialize_and_never_log_typed_text() {
        let a: Action =
            serde_json::from_str(r#"{"type":"click","x":10,"y":20,"button":"right","count":1}"#)
                .unwrap();
        assert_eq!(
            a,
            Action::Click {
                x: 10,
                y: 20,
                button: Btn::Right,
                count: 1
            }
        );
        assert_eq!(a.detail(), "10,20 right x1");
        let t: Action = serde_json::from_str(r#"{"type":"type","text":"my secret"}"#).unwrap();
        assert_eq!(t.detail(), "9 characters");
        assert!(t.keyboard() && t.points().is_empty());
        let d: Action =
            serde_json::from_str(r#"{"type":"drag","x":1,"y":2,"x2":3,"y2":4}"#).unwrap();
        assert_eq!(d.points(), vec![(1, 2), (3, 4)]);
        assert!(serde_json::from_str::<Action>(r#"{"type":"shell","cmd":"x"}"#).is_err());
    }

    #[test]
    fn a_view_grant_never_allows_input() {
        let (mut g, now) = grant(Scope::View, true);
        assert!(!g.auto_low_risk, "auto-approve needs the control scope");
        assert!(g.check(Need::View, now).is_ok());
        assert!(g.check(Need::Input, now).unwrap_err().contains("view only"));
        assert_eq!(g.actions, 0);
    }

    #[test]
    fn a_grant_expires() {
        let (mut g, now) = grant(Scope::Control, false);
        assert!(g.check(Need::Input, now).is_ok());
        let late = now + Duration::from_secs(15 * 60);
        assert!(g.expired(late));
        assert!(g.check(Need::Input, late).unwrap_err().contains("ended"));
        assert!(g.check(Need::View, late).is_err());
        // the duration is clamped to an hour
        let long = Grant::new(2, Scope::View, false, 100_000, now);
        assert!(long.expired(now + Duration::from_secs(3600)));
        assert!(!long.expired(now + Duration::from_secs(3599)));
    }

    #[test]
    fn a_paused_grant_refuses_input_but_still_shows_the_screen() {
        let (mut g, now) = grant(Scope::Control, false);
        g.paused = Some("escape");
        assert!(g.check(Need::Input, now).unwrap_err().contains("paused"));
        assert!(g.check(Need::View, now).is_ok());
        g.paused = None;
        assert!(g.check(Need::Input, now).is_ok());
    }

    #[test]
    fn input_is_rate_limited_and_budgeted() {
        let (mut g, now) = grant(Scope::Control, false);
        assert!(g.check(Need::Input, now).is_ok());
        assert!(g
            .check(Need::Input, now + Duration::from_millis(20))
            .unwrap_err()
            .contains("too fast"));
        // 120 per minute
        let mut t = now;
        for _ in 1..MAX_INPUT_PER_MINUTE {
            t += Duration::from_millis(150);
            g.check(Need::Input, t).unwrap();
        }
        assert!(g
            .check(Need::Input, t + Duration::from_millis(150))
            .unwrap_err()
            .contains("in a minute"));
        assert!(
            g.check(Need::Input, t + Duration::from_secs(61)).is_ok(),
            "the window slides"
        );
        // the budget of a grant
        g.actions = MAX_ACTIONS;
        assert!(g
            .check(Need::Input, t + Duration::from_secs(200))
            .unwrap_err()
            .contains("limit"));
        // screenshots have their own, smaller gap
        let (mut v, now) = grant(Scope::View, false);
        assert!(v.check(Need::View, now).is_ok());
        assert!(v
            .check(Need::View, now + Duration::from_millis(50))
            .is_err());
        assert!(v
            .check(Need::View, now + Duration::from_millis(400))
            .is_ok());
    }

    #[test]
    fn a_moved_mouse_is_noticed() {
        assert!(!cursor_moved(None, (5, 5)), "nothing to compare with yet");
        assert!(!cursor_moved(Some((100, 100)), (102, 97)));
        assert!(cursor_moved(Some((100, 100)), (100, 110)));
        assert!(cursor_moved(Some((100, 100)), (-300, 100)));
    }

    fn win(app: &str, title: &str, pid: u32) -> Win {
        Win {
            id: 7,
            pid,
            app: app.into(),
            title: title.into(),
            rect: Rect {
                x: 0,
                y: 0,
                w: 800,
                h: 600,
            },
            focused: true,
            minimized: false,
        }
    }

    #[test]
    fn the_deny_list_matches_apps_and_titles() {
        assert_eq!(denied("1Password", "Vault", &[]), Some("1password"));
        assert_eq!(denied("KeePassXC", "db.kdbx", &[]), Some("keepass"));
        assert_eq!(
            denied("System Settings", "Privacy & Security", &[]),
            Some("privacy & security")
        );
        assert_eq!(
            denied("Firefox", "Bitwarden Web Vault", &[]),
            Some("bitwarden")
        );
        assert_eq!(denied("Notepad", "notes.txt", &[]), None);
        let extra = vec![" Banking ".to_string(), String::new()];
        assert_eq!(
            denied("Firefox", "My Banking Portal", &extra),
            Some(" Banking ")
        );
        assert_eq!(
            denied("Firefox", "News", &extra),
            None,
            "an empty entry matches nothing"
        );
        assert!(sensitive_title("Sign in - Google Accounts") && sensitive_title("Anmelden | Bank"));
        assert!(sensitive_title("Checkout - Shop") && sensitive_title("PayPal: Zahlung senden"));
        assert!(!sensitive_title("notes.txt - Notepad") && !sensitive_title(""));
    }

    #[test]
    fn input_is_refused_for_own_denied_unlisted_and_elevated_windows() {
        let p = Policy::default();
        assert!(guard(&win("OpenFini", "OpenFini", 42), 42, &p, false)
            .unwrap()
            .contains("OpenFini window"));
        assert!(guard(&win("Bitwarden", "", 9), 42, &p, false)
            .unwrap()
            .contains("deny list"));
        assert!(guard(&win("regedit", "Registry Editor", 9), 42, &p, true)
            .unwrap()
            .contains("administrator"));
        assert_eq!(guard(&win("Notepad", "a.txt", 9), 42, &p, false), None);
        let only = Policy {
            deny: vec![],
            allow: vec!["notepad".into()],
        };
        assert_eq!(guard(&win("Notepad", "a.txt", 9), 42, &only, false), None);
        assert!(guard(&win("Excel", "b.xlsx", 9), 42, &only, false)
            .unwrap()
            .contains("allowed apps"));
        assert!(allowed("anything", &[]) && allowed("anything", &["  ".into()]));
    }

    #[test]
    fn windows_are_found_by_point_and_focus() {
        let mut back = win("Notepad", "a", 1);
        back.focused = false;
        let mut front = win("Calc", "b", 2);
        front.rect = Rect {
            x: 100,
            y: 100,
            w: 50,
            h: 50,
        };
        let mut hidden = win("Mail", "c", 3);
        hidden.minimized = true;
        let list = vec![hidden, front, back];
        assert_eq!(window_at(&list, 120, 120).unwrap().app, "Calc");
        assert_eq!(window_at(&list, 10, 10).unwrap().app, "Notepad");
        assert!(window_at(&list, 5000, 5000).is_none());
        assert_eq!(
            frontmost(&list).unwrap().app,
            "Calc",
            "minimized windows are skipped"
        );
    }

    #[test]
    fn the_lists_are_cleaned() {
        let list = clean_list(vec![
            " Slack ".into(),
            "slack".into(),
            String::new(),
            "x".repeat(200),
        ]);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0], "Slack");
        assert_eq!(list[1].len(), 80);
    }

    #[test]
    fn the_grant_dialog_says_what_is_shared_and_how_to_stop() {
        for german in [false, true] {
            let view = dialog_text(Scope::View, false, 15, german);
            assert!(!view.title.is_empty() && view.view_only.is_none());
            assert!(view.message.contains(STOP_SHORTCUT) && view.message.contains("15"));
            assert!(view
                .message
                .contains(if german { "KI-Anbieter" } else { "AI provider" }));
            let ask = dialog_text(Scope::Control, false, 5, german);
            let auto = dialog_text(Scope::Control, true, 5, german);
            assert_ne!(ask.message, auto.message);
            assert!(ask.message.len() > view.message.len());
            assert!(auto.message.contains(if german {
                "OHNE Nachfrage"
            } else {
                "WITHOUT asking"
            }));
            // the three answers of a control request, and nothing else grants anything
            let only = ask.view_only.clone().unwrap();
            assert_eq!(
                dialog_answer(&ask, Scope::Control, &ask.allow),
                Some(Scope::Control)
            );
            assert_eq!(
                dialog_answer(&ask, Scope::Control, &only),
                Some(Scope::View)
            );
            assert_eq!(dialog_answer(&ask, Scope::Control, &ask.deny), None);
            assert_eq!(dialog_answer(&ask, Scope::Control, ""), None);
            assert_eq!(
                dialog_answer(&view, Scope::View, &view.allow),
                Some(Scope::View)
            );
            assert_eq!(dialog_answer(&view, Scope::View, &only), None);
        }
    }
}
