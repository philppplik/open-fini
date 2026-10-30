// Watchdog for extension sandboxes: a heartbeat that notices a frame or worker that stopped answering, a flood
// guard for raw message volume, and the policy that turns repeated hangs into "disabled". Pure: the timers and the
// clock are injected, so the state machines are unit-tested with fake timers (tests/extensions/watchdog.test.js).
//
// Heartbeat states:  idle ─start()→ running ─(no pong for `misses` ticks)→ hung   (stop() → idle from any state)
// A tick sends a ping when none is outstanding; a tick that finds the previous ping still unanswered counts a miss.
// With intervalMs 5000 and misses 3 an extension that blocks its thread is declared hung after 15–20 s.

export const WATCHDOG = Object.freeze({
  intervalMs: 5000, // ping period
  misses: 3, // unanswered ticks in a row before the sandbox is declared hung
  maxHangs: 3, // hangs within hangWindowMs that disable the extension
  hangWindowMs: 30 * 60_000,
  floodBurst: 2000, // raw messages that may arrive at once (every kind: calls, logs, replies)
  floodPerSecond: 1000, // sustained raw messages per second
  floodKillAfter: 2000, // dropped messages in a row before the sandbox is stopped
  maxReplyBytes: 8 * 1024 * 1024, // largest answer of an extension to a host call
});

/**
 * @param {{ping: () => Promise<any>, onHang: (info: {misses: number}) => void, intervalMs?: number, misses?: number,
 *   timers?: {setInterval: Function, clearInterval: Function}}} o  `ping` resolves when the sandbox answered
 */
export function createHeartbeat({ ping, onHang, intervalMs = WATCHDOG.intervalMs, misses = WATCHDOG.misses, timers = globalThis }) {
  let state = "idle";
  let timer = null;
  let outstanding = 0; // id of the unanswered ping, 0 = none
  let seq = 0;
  let missed = 0;

  const tick = () => {
    if (state !== "running") return;
    if (outstanding) {
      if (++missed >= misses) {
        const n = missed;
        stop();
        state = "hung";
        onHang({ misses: n });
      }
      return;
    }
    const id = (outstanding = ++seq);
    Promise.resolve()
      .then(ping)
      .then(
        () => {
          if (outstanding === id) {
            outstanding = 0;
            missed = 0;
          }
        },
        () => {}, // a rejected ping stays outstanding: the next ticks count it as missed
      );
  };

  function stop() {
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
    outstanding = 0;
    missed = 0;
    if (state === "running") state = "idle";
  }

  return {
    start() {
      stop();
      state = "running";
      timer = timers.setInterval(tick, intervalMs);
    },
    stop() {
      stop();
      state = "idle";
    },
    get state() {
      return state;
    },
    get missed() {
      return missed;
    },
  };
}

/**
 * Token bucket over every raw message of one sandbox. `hit()` → "ok" | "drop" | "kill" ("kill" once, when `killAfter`
 * messages were dropped within one second: a sender that keeps flooding, not one that briefly overshoots).
 */
export function createFloodGuard({ burst = WATCHDOG.floodBurst, perSecond = WATCHDOG.floodPerSecond, killAfter = WATCHDOG.floodKillAfter, now = Date.now } = {}) {
  let tokens = burst;
  let last = now();
  let dropped = 0;
  let windowStart = last;
  let killed = false;
  return {
    hit() {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond);
      last = t;
      if (tokens >= 1) {
        tokens -= 1;
        return "ok";
      }
      if (t - windowStart >= 1000) {
        windowStart = t;
        dropped = 0;
      }
      if (++dropped >= killAfter && !killed) {
        killed = true;
        return "kill";
      }
      return "drop";
    },
  };
}

/**
 * Records one hang. Pure. `times` are earlier hang timestamps; returns the kept list (inside the window) and whether
 * the extension should now be disabled.
 * @returns {{times: number[], count: number, disable: boolean}}
 */
export function recordHang(times, now, { maxHangs = WATCHDOG.maxHangs, windowMs = WATCHDOG.hangWindowMs } = {}) {
  const kept = (times || []).filter((t) => now - t < windowMs).concat(now);
  return { times: kept, count: kept.length, disable: kept.length >= maxHangs };
}
