// The jobs the worker pool can run. Each job is pure (plain data in, plain data out, no DOM) and runs either in a
// worker (worker.js) or, as the fallback, in the calling thread: the same code either way. A job returns
// `{ r, transfer? }`: `transfer` lists buffers of `r` that move back to the caller without a copy.
// Chosen by measurement (docs/performance.md, "Worker pool"): only work that blocks the UI thread for 100 ms or more.

/** A transferred {width, height, data} as an image with a Uint8ClampedArray view (the data may arrive as any byte array). */
const asImage = (img) => ({ width: img.width, height: img.height, data: img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length) });

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
  /** args: { name, img, params } → the image after a WORKER_EDITS edit, or for name "subject_mask" the subject mask (Uint8Array) (engine/pixel/native-edit.js applyEdit) */
  async "pixel.edit"({ name, img, params }) {
    if (name === "subject_mask") {
      const r = (await import("../../engine/pixel/native-edit.js")).subjectMask(img, params);
      return { r, transfer: [r.buffer] };
    }
    const [{ applyEdit }, { resizeImage }] = await Promise.all([import("../../engine/pixel/native-edit.js"), import("../../engine/pixel/transform.js")]);
    const r = applyEdit(name, { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length) }, params, { resizeImage });
    return { r, transfer: [r.data.buffer] };
  },
  /** args: { img, n, points, filter } → { img, x, y }: the mesh warp of engine/pixel/transform3d.js (3D Transform) */
  async "pixel.warpMesh"({ img, n, points, filter }) {
    const { warpMesh } = await import("../../engine/pixel/transform3d.js");
    const r = warpMesh(img, n, points, { filter });
    return { r, transfer: [r.img.data.buffer] };
  },
  /** args: { img, mask: Uint8Array (0..255), opts } → the image with the masked area filled from its surroundings (inpaint.js inpaintMask: Content-Aware Fill, Object Eraser, crop corners) */
  async "pixel.inpaint"({ img, mask, opts }) {
    const { inpaintMask } = await import("../../engine/pixel/inpaint.js");
    const im = asImage(img);
    inpaintMask(im, { width: im.width, height: im.height, data: mask }, opts || {});
    return { r: im, transfer: [im.data.buffer] };
  },
  /** args: { img, mask, dx, dy, mode } → the image after the Patch tool's transfer (heal.js patchTransfer) */
  async "pixel.patch"({ img, mask, dx, dy, mode }) {
    const { patchTransfer } = await import("../../engine/pixel/heal.js");
    const im = asImage(img);
    patchTransfer(im, mask, dx, dy, { mode });
    return { r: im, transfer: [im.data.buffer] };
  },
  /** args: { img, opts } → detectHorizon() result or null (Straighten Horizon) */
  async "pixel.horizon"({ img, opts }) {
    const { detectHorizon } = await import("../../engine/pixel/heal.js");
    return { r: detectHorizon(asImage(img), opts) };
  },
  /** args: { img, inv, width, height } → edge-extended fill for the empty corners of a rotated crop (heal.js extendEdges) */
  async "pixel.extend"({ img, inv, width, height }) {
    const { extendEdges } = await import("../../engine/pixel/heal.js");
    const r = extendEdges(asImage(img), inv, width, height);
    return { r, transfer: [r.data.buffer] };
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
