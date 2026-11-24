// Camera of the Proto canvas (docs/concepts/proto-studio.md §4.2). Pure: no DOM, unit tested.
//
// A camera is a plain value { x, y, zoom }: a world point p appears on the stage at (p.x * zoom + x, p.y * zoom + y)
// (stage pixels, origin at the stage's top-left corner). The renderer applies it as the world element's
// `transform: translate(x, y) scale(zoom)`; every conversion between stage and world coordinates goes through here.
//
// Public API
//   MIN_ZOOM, MAX_ZOOM, clampZoom(z)
//   toWorld(cam, sx, sy) / toScreen(cam, wx, wy)      point conversions
//   zoomAt(cam, sx, sy, zoom)                        zoom around a stage point (it stays under the pointer)
//   panBy(cam, dx, dy)                               move the view by stage pixels
//   fitRect(rect, viewW, viewH, { padding, maxZoom }) the camera that shows a world rect centered
//   worldViewport(cam, viewW, viewH, margin?)        the world rect the stage shows (grown by `margin` stage pixels)
//   stepZoom(zoom, dir)                              the next preset zoom level in or out
//   wheelZoom(cam, sx, sy, deltaY, deltaMode)        Ctrl/Cmd + wheel and pinch zoom
//   sameCamera(a, b)

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;
/** Preset zoom levels for zoom in / zoom out. */
export const ZOOM_STEPS = Object.freeze([0.02, 0.03, 0.05, 0.0625, 0.1, 0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 32, 64, 128, 256]);

export const clampZoom = (z) => (Number.isFinite(z) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) : 1);

/** A world point from a stage point. */
export const toWorld = (cam, sx, sy) => ({ x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom });
/** A stage point from a world point. */
export const toScreen = (cam, wx, wy) => ({ x: wx * cam.zoom + cam.x, y: wy * cam.zoom + cam.y });

/** The camera zoomed to `zoom` around the stage point (sx, sy), which keeps showing the same world point. */
export function zoomAt(cam, sx, sy, zoom) {
  const z = clampZoom(zoom);
  const w = toWorld(cam, sx, sy);
  return { x: sx - w.x * z, y: sy - w.y * z, zoom: z };
}

export const panBy = (cam, dx, dy) => ({ x: cam.x + dx, y: cam.y + dy, zoom: cam.zoom });

/**
 * The camera that shows `rect` ({ x, y, w, h } in world units) centered in a view of viewW × viewH stage pixels.
 * @param {{ x: number, y: number, w: number, h: number }|null} rect
 */
export function fitRect(rect, viewW, viewH, { padding = 48, maxZoom = 1 } = {}) {
  if (!rect || !(viewW > 0) || !(viewH > 0)) return { x: 0, y: 0, zoom: 1 };
  const w = Math.max(1, rect.w);
  const h = Math.max(1, rect.h);
  const availW = Math.max(1, viewW - padding * 2);
  const availH = Math.max(1, viewH - padding * 2);
  const zoom = clampZoom(Math.min(maxZoom, availW / w, availH / h));
  return { x: viewW / 2 - (rect.x + w / 2) * zoom, y: viewH / 2 - (rect.y + h / 2) * zoom, zoom };
}

/** The world rect visible in a view of viewW × viewH stage pixels, grown by `margin` stage pixels on every side. */
export function worldViewport(cam, viewW, viewH, margin = 0) {
  const a = toWorld(cam, -margin, -margin);
  return { x: a.x, y: a.y, w: (viewW + margin * 2) / cam.zoom, h: (viewH + margin * 2) / cam.zoom };
}

/** The next preset zoom level in (`dir` > 0) or out (`dir` < 0) from `zoom`. */
export function stepZoom(zoom, dir) {
  const eps = 1e-6;
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom + eps) ?? MAX_ZOOM;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < zoom - eps) return ZOOM_STEPS[i];
  return MIN_ZOOM;
}

/** Ctrl/Cmd + wheel (and trackpad pinch, which browsers report as Ctrl + wheel): smooth zoom around the pointer. */
export function wheelZoom(cam, sx, sy, deltaY, deltaMode = 0) {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const factor = Math.exp(-Math.max(-100, Math.min(100, px)) * 0.01);
  return zoomAt(cam, sx, sy, cam.zoom * factor);
}

export const sameCamera = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.zoom === b.zoom;
