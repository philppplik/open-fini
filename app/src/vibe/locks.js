// Write lock with fair (FIFO) queueing for the Vibe hub. Pure: no DOM, no app.
//
// Public API
//   const lock = new WriteLock();
//   const release = await lock.acquire(owner, { signal, label });   // waits its turn; rejects on abort
//   release();                                                      // idempotent
//   lock.holder / lock.queue / lock.busy / lock.waitingFor(owner)
//   lock.on(fn) -> unsubscribe; fn({ holder, queue }) after every change (UI badges)
//
// Invariants
//   - At most one holder at a time; waiters are granted strictly in arrival order (no starvation, no barging).
//   - An aborted waiter leaves the queue without being granted; an aborted holder must still call release().
//   - The lock is NOT re-entrant: a holder that acquires again would deadlock, so composite tools (batch) call the
//     inner tools' run() directly while they hold the lock.

export class WriteLock {
  constructor() {
    /** @type {{owner:string,label?:string,since:number}|null} */
    this.holder = null;
    /** @type {{owner:string,label?:string,grant:Function,reject:Function,signal?:AbortSignal,onAbort?:Function}[]} */
    this.queue = [];
    this.listeners = new Set();
  }

  get busy() {
    return !!this.holder;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #changed() {
    for (const fn of [...this.listeners]) {
      try {
        fn({ holder: this.holder, queue: this.queue.map((w) => ({ owner: w.owner, label: w.label })) });
      } catch {
        /* listeners must not break the lock */
      }
    }
  }

  /** True when `owner` is waiting in the queue. */
  waitingFor(owner) {
    return this.queue.some((w) => w.owner === owner);
  }

  /**
   * @param {string} owner who asks (chat or agent id), for diagnostics and UI
   * @param {{signal?:AbortSignal,label?:string}} [o]
   * @returns {Promise<() => void>} release function
   */
  acquire(owner, { signal, label } = {}) {
    if (signal?.aborted) return Promise.reject(abortErr());
    return new Promise((resolve, reject) => {
      const w = { owner, label, signal, grant: null, reject };
      w.grant = () => {
        if (w.onAbort) signal.removeEventListener("abort", w.onAbort);
        this.holder = { owner, label, since: Date.now() };
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.holder = null;
          this.#next();
        });
      };
      if (signal) {
        w.onAbort = () => {
          const i = this.queue.indexOf(w);
          if (i >= 0) {
            this.queue.splice(i, 1);
            this.#changed();
            reject(abortErr());
          }
        };
        signal.addEventListener("abort", w.onAbort, { once: true });
      }
      this.queue.push(w);
      if (!this.holder) this.#next();
      else this.#changed();
    });
  }

  #next() {
    const w = this.queue.shift();
    if (w) w.grant();
    this.#changed();
  }

  /** Runs `fn` while holding the lock. */
  async run(owner, fn, o = {}) {
    const release = await this.acquire(owner, o);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

function abortErr() {
  const e = new Error("Aborted while waiting for the document lock.");
  e.name = "AbortError";
  return e;
}
