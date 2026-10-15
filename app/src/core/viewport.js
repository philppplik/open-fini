// Viewport: maps between document ("page") space and screen space.
import { clamp } from "./util.js";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export class Viewport {
  constructor() {
    this.zoom = 1;
    this.panX = 0; // screen CSS px of the document origin
    this.panY = 0;
    this.w = 1; // viewport size in CSS px
    this.h = 1;
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.dpr = dpr || 1;
  }

  toScreen(x, y) {
    return [x * this.zoom + this.panX, y * this.zoom + this.panY];
  }
  toDoc(sx, sy) {
    return [(sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom];
  }

  /** Document → device-pixel matrix (what the canvas backend uses as `base`). */
  matrix() {
    const s = this.zoom * this.dpr;
    return [s, 0, 0, s, this.panX * this.dpr, this.panY * this.dpr];
  }

  visibleRect() {
    const [x0, y0] = this.toDoc(0, 0);
    const [x1, y1] = this.toDoc(this.w, this.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Zooms keeping the document point under (sx, sy) fixed. */
  zoomAt(sx, sy, newZoom) {
    newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
    const [dx, dy] = this.toDoc(sx, sy);
    this.zoom = newZoom;
    this.panX = sx - dx * newZoom;
    this.panY = sy - dy * newZoom;
  }

  zoomBy(factor, sx = this.w / 2, sy = this.h / 2) {
    this.zoomAt(sx, sy, this.zoom * factor);
  }

  panBy(dx, dy) {
    this.panX += dx;
    this.panY += dy;
  }

  /** Fits a document-space rectangle into the viewport with padding (CSS px). */
  fit(rect, padding = 48, maxZoom = 8) {
    const aw = Math.max(1, this.w - padding * 2);
    const ah = Math.max(1, this.h - padding * 2);
    const z = clamp(Math.min(aw / Math.max(1, rect.w), ah / Math.max(1, rect.h)), MIN_ZOOM, maxZoom);
    this.zoom = z;
    this.panX = (this.w - rect.w * z) / 2 - rect.x * z;
    this.panY = (this.h - rect.h * z) / 2 - rect.y * z;
  }

  centerOn(x, y) {
    this.panX = this.w / 2 - x * this.zoom;
    this.panY = this.h / 2 - y * this.zoom;
  }

  /** Pixel-snapped zoom steps similar to design tools. */
  static STEPS = [0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
  nextStep(dir) {
    const s = Viewport.STEPS;
    if (dir > 0) return s.find((v) => v > this.zoom * 1.001) ?? s[s.length - 1];
    for (let i = s.length - 1; i >= 0; i--) if (s[i] < this.zoom / 1.001) return s[i];
    return s[0];
  }
}
