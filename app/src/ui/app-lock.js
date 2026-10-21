// App lock: an optional passphrase lock screen on start, after idle minutes, when the window is hidden, or on demand.
// With the lock on, the autosaved session, the recent-files list and stored AI keys/chats are encrypted at rest
// (AES-GCM, key derived with PBKDF2 from the passphrase: ai/vault.js through core/atrest.js). The key lives only in
// memory while unlocked. This protects data stored on this device (another user of the computer, a copied profile);
// it does not protect against malware or a compromised operating system, and a forgotten passphrase cannot be recovered.
import { h } from "../core/util.js";
import { AtRest, createLock, verifyLock } from "../core/atrest.js";
import { kvGetRaw, kvSetRaw, kvDelete, kvEntries, setStorageCodec, isProtectedKey, isSealed, getRecents } from "../core/storage.js";
import { log } from "../core/log.js";
import { openDialog } from "./dialogs.js";

const RECORD = "applock";
const FLAG = "openfini.lock";
const MIN_LENGTH = 8;

const atrest = new AtRest();
let overlay = null;
let locked = false;
let watching = false;
let lastActive = Date.now();

const setFlag = (on) => {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch {
    /* storage blocked */
  }
};

function installCodec() {
  setStorageCodec({ ready: () => atrest.unlocked, encode: (v) => atrest.seal(v), decode: (e) => atrest.open(e) });
}

export const hasLock = async () => !!(await kvGetRaw(RECORD));
export const isLocked = () => locked;

/** Keys of the store that are protected, with their raw stored value. */
async function protectedEntries() {
  const out = [];
  for (const { key } of await kvEntries()) if (isProtectedKey(key)) out.push([key, await kvGetRaw(key)]);
  return out;
}

// ------------------------------------------------------------------ passphrase dialog

/** Asks for a passphrase (twice when `confirm`). Resolves with the passphrase or null. */
export function passphraseDialog({ title, lead, ok = "OK", confirm = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v, close) => {
      if (done) return;
      done = true;
      resolve(v);
      close?.();
    };
    const a = h("sl-input", { type: "password", label: confirm ? "New passphrase" : "Passphrase", "password-toggle": true, size: "small", autocomplete: "off" });
    const b = confirm ? h("sl-input", { type: "password", label: "Repeat the passphrase", "password-toggle": true, size: "small", autocomplete: "off" }) : null;
    const err = h("p.of-lock__err", { role: "alert" });
    const submit = (close) => {
      err.textContent = "";
      if (!a.value) return (err.textContent = "Enter a passphrase.");
      if (confirm && a.value.length < MIN_LENGTH) return (err.textContent = `Use at least ${MIN_LENGTH} characters. A few random words make a strong passphrase.`);
      if (confirm && a.value !== b.value) return (err.textContent = "The two passphrases do not match.");
      finish(a.value, close);
    };
    const { dlg, close } = openDialog({
      title,
      width: 460,
      cls: "of-dlg-460",
      body: h("div.of-diag__form", lead ? h("p", lead) : null, a, b, err),
      buttons: [
        { label: "Cancel", onClick: (c) => finish(null, c) },
        { label: ok, variant: "primary", onClick: (c) => submit(c) },
      ],
      onClose: () => finish(null),
    });
    for (const el of [a, b].filter(Boolean)) el.addEventListener("keydown", (e) => e.key === "Enter" && submit(close));
    dlg.addEventListener("sl-after-show", () => a.focus());
  });
}

// ------------------------------------------------------------------ lock screen

function coverApp() {
  const inerted = [];
  for (const el of document.body.children) {
    if (el === overlay || el.inert) continue;
    el.inert = true;
    inerted.push(el);
  }
  return () => inerted.forEach((el) => (el.inert = false));
}

/** Shows the lock screen and resolves once the correct passphrase was entered (or the data was reset). */
function showLockScreen(app, record) {
  return new Promise((resolve) => {
    locked = true;
    document.documentElement.classList.add("of-locked");
    const input = h("input.of-lock__in", { type: "password", autocomplete: "off", spellcheck: false, "aria-label": "Passphrase", "aria-describedby": "of-lock-msg" });
    const msg = h("p.of-lock__err", { id: "of-lock-msg", role: "alert" });
    const unlock = h("button.of-btn.of-btn--primary", { type: "button" }, "Unlock");
    const forgot = h("button.of-lock__link", { type: "button" }, "Forgot your passphrase?");
    const main = h("div", h("img", { src: "./icons/mark.svg", alt: "", width: 44, height: 44 }), h("h2#of-lock-title", "OpenFini is locked"), h("p", "Enter your passphrase to continue. Your documents stay open and unchanged."), h("div.of-lock__row", input, unlock), msg, forgot);
    const card = h("div.of-lock__card", main);
    overlay = h("div.of-lock", { role: "dialog", "aria-modal": "true", "aria-labelledby": "of-lock-title" }, card);
    document.body.append(overlay);
    const uncover = coverApp();
    let failures = 0;
    let busy = false;
    const finish = () => {
      locked = false;
      uncover();
      overlay.remove();
      overlay = null;
      document.documentElement.classList.remove("of-locked");
      lastActive = Date.now();
      resolve();
    };
    const attempt = async () => {
      if (busy || !input.value) return;
      busy = true;
      unlock.disabled = true;
      msg.textContent = "Checking…";
      try {
        if (failures >= 3) await new Promise((r) => setTimeout(r, Math.min(5000, 1000 * (failures - 2))));
        atrest.key = await verifyLock(record, input.value);
        input.value = "";
        finish();
        getRecents().then((r) => app.emit("recents", r));
        log.info("security", "App unlocked");
      } catch (err) {
        failures++;
        msg.textContent = err.code === "bad_passphrase" ? "That passphrase is not correct." : `The lock could not be checked: ${err.message}`;
        input.select();
        log.warn("security", "Unlock failed", err.code || err.message);
      } finally {
        busy = false;
        unlock.disabled = false;
      }
    };
    unlock.addEventListener("click", attempt);
    input.addEventListener("keydown", (e) => e.key === "Enter" && attempt());
    forgot.addEventListener("click", () => {
      const del = h("button.of-btn.of-btn--danger", { type: "button" }, "Delete protected data and remove the lock");
      const back = h("button.of-btn", { type: "button" }, "Back");
      del.addEventListener("click", async () => {
        await removeLockAndProtectedData(app);
        finish();
        app.toast("The lock was removed and the protected data deleted. Documents saved as files are untouched.", "warning", 6000);
      });
      back.addEventListener("click", () => card.replaceChildren(main) || input.focus());
      card.replaceChildren(h("div", h("h2", "Forgot your passphrase?"), h("p", "The passphrase cannot be recovered or reset: that is what keeps the data private. You can delete the encrypted autosaved session, recent files, stored AI keys and chats and remove the lock. Documents you saved as files are not affected, and open documents stay open."), h("div.of-lock__row", del, back)));
      back.focus();
    });
    input.focus();
  });
}

async function removeLockAndProtectedData(app) {
  for (const { key } of await kvEntries()) if (isProtectedKey(key)) await kvDelete(key);
  await kvDelete(RECORD);
  setFlag(false);
  setStorageCodec(null);
  atrest.forget();
  app.setPref("appLock", false);
  log.warn("security", "App lock removed after a reset; protected data deleted");
}

// ------------------------------------------------------------------ public API

/** Called once at start-up (boot.js): installs the storage hook and waits for the passphrase if a lock exists. */
export async function gate(app) {
  const record = await kvGetRaw(RECORD);
  if (!record) {
    if (app.prefs.appLock) app.setPref("appLock", false);
    return false;
  }
  installCodec();
  setFlag(true);
  if (!app.prefs.appLock) app.setPref("appLock", true);
  startWatchers(app);
  await showLockScreen(app, record);
  return true;
}

/** Locks now: saves the autosave copy, forgets the key and covers the app until the passphrase is entered. */
export async function lockNow(app) {
  if (locked) return;
  const record = await kvGetRaw(RECORD);
  if (!record) {
    app.toast("The app lock is not set up yet. Turn it on under Settings ▸ Security and privacy.", "warning", 4500, { label: "Open", run: () => app.emit("dialog", { id: "preferences", section: "security" }) });
    return;
  }
  try {
    if (app.prefs.autosave && atrest.unlocked) await app.autosaveNow?.();
  } catch (err) {
    log.warn("security", "Autosave before locking failed", err);
  }
  atrest.forget();
  log.info("security", "App locked");
  await showLockScreen(app, record);
}

/** Turns the lock on: asks for a passphrase, then encrypts the stored session, recents, AI keys and chats. */
export async function enableLock(app) {
  if (await hasLock()) return changePassphrase(app);
  const pass = await passphraseDialog({ title: "Turn on app lock", lead: "Choose a passphrase. OpenFini will ask for it on start, after the idle time you choose, and when you lock. If you forget it, the protected data (autosaved session, recent files, stored AI keys and chats) cannot be recovered. Documents saved as files are not encrypted.", ok: "Turn on", confirm: true });
  if (!pass) return false;
  app.status("Encrypting stored data…");
  try {
    const { record, key } = await createLock(pass);
    await kvSetRaw(RECORD, record); // record first: a half-finished migration stays readable
    atrest.key = key;
    installCodec();
    setFlag(true);
    let n = 0;
    for (const [k, v] of await protectedEntries()) {
      if (v === undefined || isSealed(v)) continue;
      await kvSetRaw(k, await atrest.seal(v));
      n++;
    }
    app.setPref("appLock", true);
    startWatchers(app);
    log.info("security", `App lock turned on; ${n} stored item${n === 1 ? "" : "s"} encrypted`);
    app.toast("App lock is on. Stored session, recent files and AI keys are now encrypted.", "success", 4000);
    return true;
  } catch (err) {
    log.error("security", "Turning on the app lock failed", err);
    app.toast(`The app lock could not be turned on: ${err.message}`, "danger", 6000);
    return false;
  } finally {
    app.status("");
  }
}

async function askCurrent(title) {
  const record = await kvGetRaw(RECORD);
  const pass = await passphraseDialog({ title, lead: "Enter your current passphrase.", ok: "Continue" });
  if (!pass) return null;
  try {
    return { key: await verifyLock(record, pass), record };
  } catch {
    return { error: true };
  }
}

/** Changes the passphrase and re-encrypts the protected data. */
export async function changePassphrase(app) {
  const cur = await askCurrent("Change passphrase");
  if (!cur) return false;
  if (cur.error) return app.toast("That passphrase is not correct.", "danger", 3000), false;
  const pass = await passphraseDialog({ title: "New passphrase", ok: "Change", confirm: true });
  if (!pass) return false;
  const old = new AtRest();
  old.key = cur.key;
  app.status("Re-encrypting stored data…");
  try {
    const plain = [];
    for (const [k, v] of await protectedEntries()) if (isSealed(v)) plain.push([k, await old.open(v)]);
    const { record, key } = await createLock(pass);
    atrest.key = key;
    for (const [k, v] of plain) await kvSetRaw(k, await atrest.seal(v));
    await kvSetRaw(RECORD, record);
    app.toast("Passphrase changed.", "success", 2500);
    return true;
  } catch (err) {
    log.error("security", "Changing the passphrase failed", err);
    app.toast(`The passphrase could not be changed: ${err.message}`, "danger", 6000);
    return false;
  } finally {
    app.status("");
  }
}

/** Turns the lock off after checking the passphrase and writes the protected data back unencrypted. */
export async function disableLock(app) {
  const cur = await askCurrent("Turn off app lock");
  if (!cur) return false;
  if (cur.error) return app.toast("That passphrase is not correct.", "danger", 3000), false;
  const old = new AtRest();
  old.key = cur.key;
  try {
    const plain = [];
    for (const [k, v] of await protectedEntries()) if (isSealed(v)) plain.push([k, await old.open(v)]);
    for (const [k, v] of plain) await kvSetRaw(k, v);
    await kvDelete(RECORD);
    setFlag(false);
    setStorageCodec(null);
    atrest.forget();
    app.setPref("appLock", false);
    app.toast("App lock is off. Stored data is no longer encrypted.", "success", 3500);
    return true;
  } catch (err) {
    log.error("security", "Turning off the app lock failed", err);
    app.toast(`The app lock could not be turned off: ${err.message}`, "danger", 6000);
    return false;
  }
}

// ------------------------------------------------------------------ idle and hidden triggers

function startWatchers(app) {
  if (watching) return;
  watching = true;
  const touch = () => {
    if (!locked) lastActive = Date.now();
  };
  for (const ev of ["pointerdown", "keydown", "wheel", "pointermove", "touchstart"]) addEventListener(ev, touch, { passive: true, capture: true });
  setInterval(() => {
    const min = Number(app.prefs.appLockIdleMinutes) || 0;
    if (!locked && app.prefs.appLock && min > 0 && Date.now() - lastActive >= min * 60000) lockNow(app);
  }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && app.prefs.appLock && app.prefs.appLockOnHide && !locked) lockNow(app);
  });
}
