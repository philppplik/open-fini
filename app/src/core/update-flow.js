// In-app update flow (pure state machine, no DOM). The desktop app uses the Tauri updater plugin through `native`
// (an object with check(), relaunch(), installKind()); everything is injected, so the tests use a fake.
//
// Phases: idle, checking, current, available, downloading, ready, installing, error, blocked, manual, web.
//   error.kind: "signature" | "offline" | "failed"     manual.reason: "package" | "portable" | "unconfigured"
// Nothing is installed without the user: `download()` and `install()` are separate steps (the auto-download policy
// only runs `download()`); `install()` saves the work first and is the only step that may close the app.

/** Policy from the two prefs: off (never contacts GitHub), notify (check, tell the user), auto (also download). */
export function updatePolicy({ auto = false, autoDownload = false } = {}) {
  return !auto ? "off" : autoDownload ? "auto" : "notify";
}

/** Sorts a plugin failure into what the UI says: a bad signature, no network, or anything else. */
export function classifyError(err) {
  const m = String(err?.message ?? err ?? "");
  if (/signature|minisign|pubkey|public key/i.test(m)) return "signature";
  if (/offline|network|error sending request|dns|connect|timed? ?out|unreachable|failed to fetch/i.test(m)) return "offline";
  return "failed";
}

/** True when the plugin is missing or not set up (no public key in this build): the UI falls back to the release page. */
export function isUnconfigured(err) {
  return /not allowed|not found|unknown (plugin|command)|not (registered|configured)|endpoints|missing field|is not a function|undefined/i.test(String(err?.message ?? err ?? ""));
}

export function createUpdateFlow({ native = null, current = "", policy = "off", saveWork = async () => {}, canCheck = () => true, now = Date.now } = {}) {
  let state = { phase: "idle", current, policy };
  let update = null;
  const subs = new Set();
  const set = (patch) => {
    state = { current, policy, ...patch };
    for (const f of subs) f(state);
    return state;
  };
  const info = () => ({ version: state.version, date: state.date, notes: state.notes });
  const fail = (err, extra = {}) => set({ phase: "error", ...info(), ...extra, error: { kind: classifyError(err), message: String(err?.message ?? err) } });

  async function check() {
    if (["downloading", "installing", "checking"].includes(state.phase)) return state;
    if (!native) return set({ phase: "web" });
    try {
      canCheck();
    } catch (err) {
      return set({ phase: "blocked", reason: err.message });
    }
    set({ phase: "checking" });
    let kind = "";
    try {
      kind = (await native.installKind?.()) || "";
    } catch {
      kind = "";
    }
    if (kind === "package" || kind === "portable") return set({ phase: "manual", reason: kind });
    try {
      update = await native.check();
    } catch (err) {
      if (isUnconfigured(err)) return set({ phase: "manual", reason: "unconfigured" });
      return set({ phase: "error", error: { kind: classifyError(err), message: String(err?.message ?? err) }, checkedAt: now() });
    }
    if (!update) return set({ phase: "current", checkedAt: now() });
    return set({ phase: "available", version: update.version, date: update.date || "", notes: update.body || "", checkedAt: now() });
  }

  /** Downloads and verifies the update (the plugin refuses a bad signature). Progress is in state.downloaded / total. */
  async function download() {
    if (state.phase !== "available" || !update) return state;
    const meta = info();
    let downloaded = 0;
    let total = 0;
    set({ phase: "downloading", ...meta, downloaded, total });
    try {
      await update.download((ev) => {
        if (ev.event === "Started") total = ev.data?.contentLength || 0;
        else if (ev.event === "Progress") downloaded += ev.data?.chunkLength || 0;
        else if (ev.event === "Finished") downloaded = total || downloaded;
        set({ phase: "downloading", ...meta, downloaded, total });
      });
    } catch (err) {
      update = null;
      return fail(err, meta);
    }
    return set({ phase: "ready", ...meta, downloaded, total });
  }

  /** Saves the work first (autosave / recovery store), then installs and restarts. On Windows the installer ends the app. */
  async function install() {
    if (state.phase !== "ready" || !update) return state;
    set({ phase: "installing", ...info() });
    try {
      await saveWork();
      await update.install();
      await native.relaunch();
    } catch (err) {
      return fail(err);
    }
    return state;
  }

  return {
    get state() {
      return state;
    },
    check,
    download,
    install,
    setPolicy(p) {
      policy = p;
      state = { ...state, policy };
    },
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => subs.delete(fn);
    },
  };
}
