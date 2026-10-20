// Crash-loop guard and safe-mode switch. Pure: takes a Storage-like object (localStorage) so it is testable.
//
//   start of the page:  const r = beginBoot(localStorage);   // r.offerSafeMode after two failed starts in a row
//   boot finished:      markBootOk(localStorage);
//
// A start counts as failed when the previous start never reached markBootOk() (the page crashed, was stuck or was
// closed while loading). Safe mode (`?safe=1`) skips session restore, extensions and AI and does not apply saved settings.

export const BOOT_KEY = "openfini.boot";
export const BOOT_FAILURE_LIMIT = 2;

/** True when the URL query asks for safe mode (`?safe=1`, `?safe`, `?safe=true`). */
export function isSafeMode(search = "") {
  const v = new URLSearchParams(String(search)).get("safe");
  return v !== null && !/^(0|false|no|off)$/i.test(v);
}

/** URL (path + query) that restarts the app in safe mode, keeping the current path. */
export function safeModeUrl(pathname = "/") {
  return `${pathname}?safe=1`;
}

function read(store) {
  try {
    const v = JSON.parse(store.getItem(BOOT_KEY) || "null");
    return v && typeof v === "object" ? { pending: !!v.pending, failures: Math.max(0, Number(v.failures) || 0), t: Number(v.t) || 0 } : { pending: false, failures: 0, t: 0 };
  } catch {
    return { pending: false, failures: 0, t: 0 };
  }
}
function write(store, state) {
  try {
    store.setItem(BOOT_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the guard simply does nothing */
  }
}

/**
 * Call once at the start of every page load.
 * @returns {{failures:number, offerSafeMode:boolean}}
 */
export function beginBoot(store, now = Date.now(), { limit = BOOT_FAILURE_LIMIT } = {}) {
  const prev = read(store);
  const failures = prev.pending ? prev.failures + 1 : 0;
  write(store, { pending: true, failures, t: now });
  return { failures, offerSafeMode: failures >= limit };
}

/** The app started fine: forget earlier failures. */
export function markBootOk(store) {
  write(store, { pending: false, failures: 0, t: 0 });
}

/** The user chose to continue normally after the warning: count from zero again. */
export function resetBootFailures(store, now = Date.now()) {
  write(store, { pending: true, failures: 0, t: now });
}
