// Entry of a pool worker (module worker, bundled in place by scripts/build.mjs). Speaks the protocol of pool.js.
import { runJob } from "./jobs.js";

self.onmessage = async (e) => {
  const { id, job, args } = e.data || {};
  try {
    const { r, transfer } = await runJob(job, args, { progress: (p) => self.postMessage({ id, t: "progress", p }) });
    self.postMessage({ id, t: "done", r }, transfer || []);
  } catch (err) {
    self.postMessage({ id, t: "error", e: { name: err?.name || "Error", message: String(err?.message || err) } });
  }
};
