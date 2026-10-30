// A small generic worker pool for heavy pure jobs (jobs.js). Pure: the worker factory and the local runner are
// injected, so the queueing, cancellation and fallback logic is unit-tested in Node with fake workers.
//
// Protocol (worker.js):  host → worker { id, job, args }      worker → host { id, t: "progress", p }
//                                                              worker → host { id, t: "done", r } | { id, t: "error", e: { name, message } }
// Rules:
//   * workers are created lazily, at most `size` (default: hardwareConcurrency - 1, capped at 4), one job each at a time;
//   * `signal` cancels: a queued job is dropped, a running job's worker is terminated (true preemption) and replaced on
//     demand; the promise rejects with an AbortError;
//   * a worker that fails before it ever finished a job (no Worker support, CSP, bundling) switches the pool to local
//     mode and the job is re-run locally; a later crash only fails that job;
//   * idle workers are terminated after `idleMs` to give their memory back.

/** Default pool size for `hardwareConcurrency` (leave one core to the UI thread). */
export function defaultPoolSize(hc) {
  return Math.max(1, Math.min(4, (Number(hc) || 2) - 1));
}

export function abortError() {
  const e = new Error("The job was cancelled.");
  e.name = "AbortError";
  return e;
}

/**
 * @param {{create?: (() => any) | null, runLocal: (job: string, args: any, o: {signal?: AbortSignal, onProgress?: Function}) => Promise<any>,
 *   size?: number, idleMs?: number, timers?: {setTimeout: Function, clearTimeout: Function}}} o
 *   `create` returns a Worker-like object ({postMessage, terminate, onmessage, onerror}); null/absent = local mode.
 */
export function createPool({ create, runLocal, size = 2, idleMs = 30_000, timers = globalThis }) {
  let local = typeof create !== "function";
  const idle = []; // { w, proven, timer }
  const busy = new Set();
  const queue = []; // { job, args, transfer, signal, onProgress, resolve, reject }
  let seq = 0;

  const runLocally = (task) => {
    if (task.signal?.aborted) return task.reject(abortError());
    Promise.resolve()
      .then(() => runLocal(task.job, task.args, { signal: task.signal, onProgress: task.onProgress }))
      .then((r) => (task.signal?.aborted ? task.reject(abortError()) : task.resolve(r)), task.reject);
  };

  function spawn() {
    try {
      return { w: create(), proven: false, timer: null };
    } catch {
      local = true;
      return null;
    }
  }

  function release(slot) {
    busy.delete(slot);
    slot.w.onmessage = slot.w.onerror = null;
    if (queue.length) return start(slot, queue.shift());
    idle.push(slot);
    if (idleMs > 0) {
      slot.timer = timers.setTimeout(() => {
        const i = idle.indexOf(slot);
        if (i >= 0) idle.splice(i, 1);
        slot.w.terminate();
      }, idleMs);
    }
  }

  function kill(slot) {
    busy.delete(slot);
    slot.w.onmessage = slot.w.onerror = null;
    slot.w.terminate();
  }

  function start(slot, task) {
    if (task.signal?.aborted) {
      task.reject(abortError());
      return queue.length ? start(slot, queue.shift()) : release(slot);
    }
    timers.clearTimeout(slot.timer);
    busy.add(slot);
    const id = ++seq;
    const onAbort = () => {
      kill(slot);
      task.reject(abortError());
      pump();
    };
    task.signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => task.signal?.removeEventListener("abort", onAbort);
    slot.w.onmessage = (e) => {
      const m = e.data;
      if (!m || m.id !== id) return;
      if (m.t === "progress") return void task.onProgress?.(m.p);
      done();
      slot.proven = true;
      if (m.t === "done") task.resolve(m.r);
      else task.reject(Object.assign(new Error(m.e?.message || "The job failed."), { name: m.e?.name || "Error" }));
      release(slot);
    };
    slot.w.onerror = (e) => {
      e?.preventDefault?.();
      done();
      kill(slot);
      if (!slot.proven) {
        local = true; // workers do not work here: run this job (and every later one) in this thread
        runLocally(task);
        while (queue.length) runLocally(queue.shift());
      } else {
        task.reject(new Error(`The worker crashed: ${e?.message || "unknown error"}`));
        pump();
      }
    };
    try {
      // an unproven worker gets a copy: if it turns out not to work, the job re-runs locally with intact buffers
      slot.w.postMessage({ id, job: task.job, args: task.args }, slot.proven ? task.transfer || [] : []);
    } catch (err) {
      done();
      task.reject(err); // not cloneable
      release(slot);
    }
  }

  function pump() {
    while (queue.length) {
      if (local) return void runLocally(queue.shift());
      let slot = idle.pop();
      if (!slot && busy.size < size) slot = spawn();
      if (!slot) return;
      start(slot, queue.shift());
    }
  }

  return {
    /**
     * Runs `job` with `args`. `transfer` lists buffers to move instead of copy (they are detached afterwards).
     * @returns {Promise<any>}
     */
    run(job, args, { transfer, signal, onProgress } = {}) {
      return new Promise((resolve, reject) => {
        const task = { job, args, transfer, signal, onProgress, resolve, reject };
        if (signal?.aborted) return reject(abortError());
        if (local) return runLocally(task);
        signal?.addEventListener(
          "abort",
          () => {
            const i = queue.indexOf(task);
            if (i >= 0) {
              queue.splice(i, 1);
              reject(abortError());
            }
          },
          { once: true },
        );
        queue.push(task);
        pump();
      });
    },
    /** Terminates the idle workers (running jobs finish; new jobs start new workers). */
    close() {
      for (const s of idle.splice(0)) {
        timers.clearTimeout(s.timer);
        s.w.terminate();
      }
    },
    get stats() {
      return { local, idle: idle.length, busy: busy.size, queued: queue.length, size };
    },
  };
}
