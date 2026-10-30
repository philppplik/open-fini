// The jobs the worker pool can run. Each job is pure (plain data in, plain data out, no DOM) and runs either in a
// worker (worker.js) or, as the fallback, in the calling thread: the same code either way. A job returns
// `{ r, transfer? }`: `transfer` lists buffers of `r` that move back to the caller without a copy.
// Chosen by measurement (docs/performance.md, "Worker pool"): only work that blocks the UI thread for 100 ms or more.

const JOBS = {
  /** args: { img: {width, height, data}, width, height, filter } → resized image */
  async "pixel.resize"({ img, width, height, filter }) {
    const { resizeImage } = await import("../../engine/pixel/transform.js");
    const r = resizeImage(img, width, height, { filter });
    return { r, transfer: [r.data.buffer] };
  },
  /** args: { img, maxSide, opts } → traceImage() result for the image scaled down to at most maxSide, plus its size */
  async "pixel.trace"({ img, maxSide = 900, opts }) {
    const [{ resizeImage }, { traceImage }] = await Promise.all([import("../../engine/pixel/transform.js"), import("../../engine/pixel/trace.js")]);
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const src = k < 1 ? resizeImage(img, Math.round(img.width * k), Math.round(img.height * k), { filter: "box" }) : img;
    return { r: { width: src.width, height: src.height, trace: traceImage(src, opts) } };
  },
  /** args: { files: fflate zip input, level } → zip bytes */
  async "zip.compress"({ files, level = 6 }) {
    const { zipSync } = await import("../../../vendor/fflate/fflate.js");
    const r = zipSync(files, { level });
    return { r, transfer: [r.buffer] };
  },
};

export const JOB_NAMES = Object.keys(JOBS);

/** Runs a job by name. @returns {Promise<{r: any, transfer?: ArrayBuffer[]}>} */
export async function runJob(name, args, ctx = {}) {
  const fn = Object.hasOwn(JOBS, name) ? JOBS[name] : null;
  if (!fn) throw new Error(`Unknown job: ${name}`);
  return fn(args, ctx);
}
