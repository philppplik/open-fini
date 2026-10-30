// Entry point of the worker pool: `runJob(name, args, {transfer, signal, onProgress})` → Promise of the job's result.
// Everything is lazy: the pool module, the workers and the job code load on the first job. Without Worker support
// (Node tests, very old engines) or when a worker cannot start, jobs run in this thread with the same code.
let poolPromise = null;

function getPool() {
  poolPromise ||= import("./pool.js").then(({ createPool, defaultPoolSize }) => {
    const canWork = typeof Worker === "function" && typeof location !== "undefined" && /^(https?|tauri|asset):$/.test(location.protocol);
    return createPool({
      size: defaultPoolSize(globalThis.navigator?.hardwareConcurrency),
      create: canWork ? () => new Worker(new URL("./worker.js", import.meta.url), { type: "module", name: "openfini-pool" }) : null,
      runLocal: (job, args, o) => import("./jobs.js").then((m) => m.runJob(job, args, { progress: o.onProgress })).then((x) => x.r),
    });
  });
  return poolPromise;
}

/**
 * Runs a pure job from jobs.js off the UI thread when possible.
 * @param {string} name  @param {any} args  @param {{transfer?: ArrayBuffer[], signal?: AbortSignal, onProgress?: (p:any)=>void}} [o]
 */
export async function runJob(name, args, o) {
  return (await getPool()).run(name, args, o);
}
