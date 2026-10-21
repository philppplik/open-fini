// Presence helpers: send throttling, receive rate limiting and viewport math for "follow". Pure (no DOM).
//
// Public API
//   createThrottle(send, { perSecond, now, setTimer, clearTimer }) → { push(value), flush(), cancel() }
//       sends at most `perSecond` values per second; the latest value always gets through (trailing edge).
//   class TokenBucket(rate, burst, now)  .take(n=1) → boolean          receive-side rate limiting per member
//   samePresence(a, b)                  true when two presence payloads would draw the same picture
//   followTarget(remoteView, localSize) → { cx, cy, zoom }               viewport that shows the remote rect

export function createThrottle(send, { perSecond = 20, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h) } = {}) {
  const gap = 1000 / perSecond;
  let last = -Infinity;
  let pending;
  let has = false;
  let timer = null;
  const fire = () => {
    timer = null;
    if (!has) return;
    has = false;
    last = now();
    send(pending);
  };
  return {
    push(value) {
      pending = value;
      has = true;
      const wait = last + gap - now();
      if (wait <= 0 && !timer) fire();
      else if (!timer) timer = setTimer(fire, Math.max(0, wait));
    },
    flush() {
      if (timer) clearTimer(timer);
      timer = null;
      fire();
    },
    cancel() {
      if (timer) clearTimer(timer);
      timer = null;
      has = false;
    },
  };
}

export class TokenBucket {
  /** @param {number} rate tokens per second @param {number} burst capacity */
  constructor(rate, burst, now = () => Date.now()) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.now = now;
    this.t = now();
  }
  take(n = 1) {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.t) / 1000) * this.rate);
    this.t = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

const round = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v);

export function samePresence(a, b) {
  if (!a || !b) return false;
  return a.doc === b.doc && a.studio === b.studio && a.page === b.page && round(a.x) === round(b.x) && round(a.y) === round(b.y) && a.tool === b.tool && JSON.stringify(a.sel || []) === JSON.stringify(b.sel || []) && JSON.stringify(a.view || null) === JSON.stringify(b.view || null) && JSON.stringify(a.caret || null) === JSON.stringify(b.caret || null) && !!a.away === !!b.away;
}

/** Center and zoom that show the remote visible rect (document coordinates) in a local viewport of `size` CSS px. */
export function followTarget(view, size, { minZoom = 0.02, maxZoom = 64 } = {}) {
  if (!view || !(view.w > 0) || !(view.h > 0) || !(size.w > 0) || !(size.h > 0)) return null;
  const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(size.w / view.w, size.h / view.h)));
  return { cx: view.x + view.w / 2, cy: view.y + view.h / 2, zoom };
}
