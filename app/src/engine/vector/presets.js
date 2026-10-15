// Preset vector shapes (arrows, heart, gear, ...). Each builder returns a VPath that exactly
// fills a w×h box so the shape can be created by dragging a box, like any other shape.
import { polylineSubpath, svgDToPath, ellipsePath, transformPath, pathBBox, reverseSubpath } from "./path.js";
import { scale as scaleM, translate, mulAll } from "../../core/math.js";

const poly = (w, h, pts) => ({ subpaths: [polylineSubpath(pts.map(([x, y]) => [x * w, y * h]), true)] });

function fromSvg(d, vw, vh) {
  const p = svgDToPath(d);
  const b = pathBBox(p);
  // normalize to the actual outline so the shape fills its box tightly
  return (w, h) => transformPath(p, mulAll(scaleM(w / (b.w || vw), h / (b.h || vh)), translate(-b.x, -b.y)));
}

const heart = fromSvg("M50 90 C10 60 0 35 15 18 C28 4 46 8 50 24 C54 8 72 4 85 18 C100 35 90 60 50 90Z", 100, 90);
const crescent = fromSvg("M50 0 A50 50 0 1 0 50 100 A40 40 0 1 1 50 0Z", 100, 100);
const cloud = fromSvg("M25 70 A20 20 0 0 1 25 30 A25 25 0 0 1 70 25 A22 22 0 0 1 90 50 A20 20 0 0 1 80 75Z", 100, 60);
const bubble = fromSvg("M10 0 H90 A10 10 0 0 1 100 10 V60 A10 10 0 0 1 90 70 H45 L25 90 L28 70 H10 A10 10 0 0 1 0 60 V10 A10 10 0 0 1 10 0Z", 100, 90);
const drop = fromSvg("M50 0 C50 0 90 45 90 70 A40 40 0 0 1 10 70 C10 45 50 0 50 0Z", 80, 100);
const check = fromSvg("M5 55 L20 40 L40 60 L80 10 L95 25 L40 90Z", 100, 100);

function gear(w, h, teeth = 10) {
  const pts = [];
  const rOut = 0.5;
  const rIn = 0.38;
  const n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
    const r = [rIn, rOut, rOut, rIn][i % 4];
    pts.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
  }
  return poly(w, h, pts);
}

function ring(w, h) {
  const outer = ellipsePath(w, h);
  const inner = transformPath(ellipsePath(w * 0.6, h * 0.6), translate(w * 0.2, h * 0.2));
  reverseSubpath(inner.subpaths[0]);
  return { subpaths: [outer.subpaths[0], inner.subpaths[0]] };
}

export const SHAPE_PRESETS = [
  { id: "right-triangle", label: "Right Triangle", build: (w, h) => poly(w, h, [[0, 0], [1, 1], [0, 1]]) },
  { id: "diamond", label: "Diamond", build: (w, h) => poly(w, h, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) },
  { id: "parallelogram", label: "Parallelogram", build: (w, h) => poly(w, h, [[0.2, 0], [1, 0], [0.8, 1], [0, 1]]) },
  { id: "trapezoid", label: "Trapezoid", build: (w, h) => poly(w, h, [[0.2, 0], [0.8, 0], [1, 1], [0, 1]]) },
  { id: "arrow-right", label: "Right Arrow", build: (w, h) => poly(w, h, [[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]]) },
  { id: "arrow-left", label: "Left Arrow", build: (w, h) => poly(w, h, [[1, 0.3], [0.4, 0.3], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.7], [1, 0.7]]) },
  { id: "arrow-double", label: "Double Arrow", build: (w, h) => poly(w, h, [[0, 0.5], [0.25, 0], [0.25, 0.3], [0.75, 0.3], [0.75, 0], [1, 0.5], [0.75, 1], [0.75, 0.7], [0.25, 0.7], [0.25, 1]]) },
  { id: "plus", label: "Plus", build: (w, h) => poly(w, h, [[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]]) },
  { id: "lightning", label: "Lightning Bolt", build: (w, h) => poly(w, h, [[0.6, 0], [0.1, 0.55], [0.45, 0.55], [0.3, 1], [0.9, 0.4], [0.55, 0.4]]) },
  { id: "heart", label: "Heart", build: heart },
  { id: "crescent", label: "Crescent", build: crescent },
  { id: "cloud", label: "Cloud", build: cloud },
  { id: "bubble", label: "Speech Bubble", build: bubble },
  { id: "drop", label: "Droplet", build: drop },
  { id: "check", label: "Check Mark", build: check },
  { id: "gear", label: "Gear", build: (w, h) => gear(w, h, 10) },
  { id: "ring", label: "Ring", build: ring, rule: "evenodd" },
];

export const getPreset = (id) => SHAPE_PRESETS.find((p) => p.id === id);
