// Idempotency helpers for user actions that open a prompt (save dialog, confirmation, export popup).
//
// A prompt must appear once per user request. Duplicate triggers happen in real life (key auto-repeat,
// a shortcut plus a click, a slow async handler that is started a second time before the first finished),
// so the commands that prompt are wrapped with these helpers instead of relying on every caller.

/**
 * Wraps a function so that a call with the same key while a previous one is still running
 * returns the running promise instead of starting a second run.
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @param {(...args: Parameters<F>) => unknown} [keyOf] identity of the request (default: one global slot)
 */
export function singleFlight(fn, keyOf = () => "") {
  const running = new Map();
  return (...args) => {
    const key = keyOf(...args);
    if (running.has(key)) return running.get(key);
    let result;
    try {
      result = fn(...args); // started synchronously: keeps the browser's user activation for file pickers
    } catch (err) {
      return Promise.reject(err);
    }
    const p = Promise.resolve(result).finally(() => running.delete(key));
    running.set(key, p);
    return p;
  };
}

/**
 * Registry of open singletons (dialogs): `open(key, create)` runs `create(release)` only when no instance
 * for `key` is open and returns the existing instance otherwise. `create` must call `release()` when the
 * instance goes away.
 */
export function createOnceRegistry() {
  const open = new Map();
  return {
    open(key, create) {
      if (open.has(key)) return open.get(key);
      let instance;
      // releasing is a no-op once a newer instance owns the key
      const release = () => {
        if (open.get(key) === instance) open.delete(key);
      };
      instance = create(release);
      open.set(key, instance);
      return instance;
    },
    has: (key) => open.has(key),
    get size() {
      return open.size;
    },
  };
}
