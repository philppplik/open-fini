// OpenFini tools for the Pixel studio: pixel layers, adjustment and filter layers, selections, AI image generation.
import { tool, S, nodesById, requireDoc } from "./helpers.js";
import { Mask, listEffects, getEffect } from "../../engine/pixel/index.js";
import { newPixelLayer, setMask } from "../../core/pixel.js";
import { addEffectLayer } from "../../core/raster.js";
import { placeFile } from "../../core/io.js";
import { createCanvas, ctx2d } from "../../core/doc.js";

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Parameter shapes that the generic control list cannot express. */
const PARAM_SHAPES = {
  levels: "params: { inBlack 0-254, inWhite 1-255, gamma 0.1-5 (>1 lightens midtones), outBlack 0-255, outWhite 0-255 } for all channels, plus optional channels: { red|green|blue: { inBlack, inWhite, gamma, outBlack, outWhite } } for per-channel correction (color casts). Example: { inBlack: 12, inWhite: 238, gamma: 1.15 }. get_histogram / auto_correct_suggestion compute good values.",
  curves: "params: master, red, green, blue = lists of [x, y] points with x and y in 0..1 (input to output, sorted by x, include the end points). Example S-curve: { master: [[0,0],[0.25,0.2],[0.75,0.8],[1,1]] }. Omitted channels stay linear.",
};

function checkParams(id, p) {
  const num = (v, lo, hi, name) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} must be a number from ${lo} to ${hi}.`);
  };
  if (id === "curves") {
    for (const k of ["master", "red", "green", "blue"]) {
      if (p[k] === undefined) continue;
      if (!Array.isArray(p[k]) || p[k].length < 2 || p[k].some((q) => !Array.isArray(q) || q.length !== 2)) throw new Error(`curves.${k} must be a list of at least two [x, y] points, e.g. [[0,0],[0.5,0.6],[1,1]].`);
      for (const [x, y] of p[k]) {
        num(x, 0, 1, `curves.${k} x`);
        num(y, 0, 1, `curves.${k} y`);
      }
    }
  } else if (id === "levels") {
    const ranges = { inBlack: [0, 254], inWhite: [1, 255], gamma: [0.1, 5], outBlack: [0, 255], outWhite: [0, 255] };
    for (const [k, [lo, hi]] of Object.entries(ranges)) if (p[k] !== undefined) num(p[k], lo, hi, `levels.${k}`);
    if ((p.inBlack ?? 0) >= (p.inWhite ?? 255)) throw new Error("levels.inBlack must be smaller than levels.inWhite.");
    if (p.channels) for (const [c, v] of Object.entries(p.channels)) if (!["red", "green", "blue"].includes(c) || typeof v !== "object") throw new Error("levels.channels takes red, green and blue objects.");
  }
}

export function pixelTools(app, ctx) {
  const T = [];

  T.push(
    tool("list_effects", "Lists the adjustments (levels, curves, HSL, …), live filters (blur, sharpen, noise, …) and Develop effects with their parameters. Call before apply_adjustment.", {
      kind: S.str("Filter the list", { enum: ["adjustment", "filter", "develop"] }),
      id: S.str("Return the full parameter list of this effect id"),
    }, [], (a) => {
      if (a.id) {
        for (const kind of ["adjustment", "filter", "develop"]) {
          const e = getEffect(kind, a.id);
          if (e) return { kind, id: e.id, label: e.label, usage: PARAM_SHAPES[e.id], defaults: e.defaults, controls: e.controls.map((c) => ({ key: c.key, label: c.label, type: c.type, min: c.min, max: c.max, default: c.default, options: c.options?.map((o) => o.value) })) };
        }
        throw new Error(`Unknown effect “${a.id}”. Call list_effects without id to see all.`);
      }
      return listEffects().filter((e) => !a.kind || e.kind === a.kind).map((e) => ({ kind: e.kind, id: e.id, label: e.label, category: e.category }));
    }, { readOnly: true }),

    tool("add_pixel_layer", "Adds an empty pixel layer (optionally filled with a color) above the active layer.", {
      name: S.str("Layer name"), width: S.num("Width px (default page width)"), height: S.num("Height px (default page height)"), fill: S.str("Fill color, e.g. #ffffff"),
    }, [], (a) => {
      requireDoc(app);
      const n = newPixelLayer(app, { name: a.name || "Pixel Layer", w: a.width && Math.round(a.width), h: a.height && Math.round(a.height) });
      if (a.fill) {
        const c = app.doc.pixels.get(n.id);
        const g = ctx2d(c);
        g.fillStyle = a.fill;
        g.fillRect(0, 0, c.width, c.height);
        app.doc.touch(n);
        app.requestRender();
      }
      return { id: n.id, width: n.w, height: n.h };
    }),

    tool("apply_adjustment", "Adds a non-destructive adjustment or live filter layer (e.g. kind 'adjustment' id 'hsl', kind 'filter' id 'gaussian-blur'). It affects everything below it, or only the layer when nested is true. Parameter shapes: levels = { inBlack, inWhite, gamma, outBlack, outWhite, channels?: { red|green|blue: {inBlack,inWhite,gamma} } }; curves = { master|red|green|blue: [[x,y],...] } with x,y in 0..1; exposure = { exposure (EV), offset, gamma }. Use get_histogram or auto_correct_suggestion to choose values; list_effects with id shows the usage.", {
      kind: S.str("Effect registry", { enum: ["adjustment", "filter", "develop"] }), id: S.str("Effect id from list_effects"),
      params: { type: "object", description: "Parameter overrides, keys as in list_effects" },
      targetId: S.str("Layer to put it above / inside (default: active layer)"), nested: S.bool("Apply only to the target layer"),
    }, ["kind", "id"], (a) => {
      requireDoc(app);
      const eff = getEffect(a.kind, a.id);
      if (!eff) throw new Error(`Unknown effect ${a.kind}/${a.id}. Call list_effects.`);
      if (a.params) checkParams(a.id, a.params);
      if (a.targetId) app.select(nodesById(app, [a.targetId]));
      const node = addEffectLayer(app, a.kind, a.id, { nested: !!a.nested });
      if (!node) throw new Error("Could not add the effect layer.");
      if (a.params) {
        const clean = {};
        for (const [k, v] of Object.entries(a.params)) if (k in eff.defaults) clean[k] = v;
        app.doc.set(node, { params: { ...node.params, ...clean } }, "AI: Effect parameters");
      }
      return { id: node.id, effect: `${a.kind}/${a.id}`, params: node.params };
    }),

    tool("crop_image", "Crops the active page to a rectangle in page pixels, or to an aspect ratio around the center, optionally rotated by an angle (straighten). All layers move together as one undoable step. Without deleteCropped nothing is destroyed: content outside the new page can be brought back with trim/reveal.", {
      x: S.num("Left"), y: S.num("Top"), w: S.num("Width"), h: S.num("Height"),
      ratio: S.str("Aspect ratio such as 16:9, 1:1, 4:3 (used instead of w/h: the largest centered box)"), angle: S.num("Rotation of the crop box in degrees, clockwise, -45..45 (straighten)", { minimum: -45, maximum: 45 }),
      corners: S.str("Empty corners after a rotation", { enum: ["transparent", "background", "fit"] }), deleteCropped: S.bool("Delete the pixels outside the crop (default false)"),
    }, [], async (a) => {
      requireDoc(app);
      const { cropPage } = await import("../../studios/tools/pixel-crop.js");
      const { ratioValue, largestInscribed, applyRatio } = await import("../../engine/pixel/crop.js");
      const p = app.page;
      let r;
      const ratio = a.ratio ? ratioValue(a.ratio, p) : null;
      if (a.w && a.h) r = { x: a.x ?? 0, y: a.y ?? 0, w: a.w, h: a.h };
      else if (ratio && a.angle) r = largestInscribed(p.w, p.h, a.angle, ratio);
      else if (ratio) r = applyRatio({ x: 0, y: 0, w: p.w, h: p.h }, ratio, p);
      else if (a.angle) r = largestInscribed(p.w, p.h, a.angle, p.w / p.h);
      else return { ok: false, error: "Give w and h, or a ratio, or an angle." };
      cropPage(app, r, { angle: a.angle || 0, corners: a.corners || (a.angle ? "fit" : "transparent"), deletePixels: !!a.deleteCropped });
      return { ok: true, page: { w: app.page.w, h: app.page.h } };
    }),

    tool("resize_image", "Resizes the whole document (Image Size). resample 'scale' only scales the layers; a filter (lanczos3, bicubic, bilinear, nearest) also resamples the bitmaps of pixel layers.", {
      width: S.num("New width px"), height: S.num("New height px (omit to keep the aspect ratio)"), resample: S.str("Resampling", { enum: ["scale", "lanczos3", "bicubic", "bilinear", "nearest"] }), dpi: S.num("Resolution metadata", { minimum: 1 }),
    }, ["width"], async (a) => {
      requireDoc(app);
      const { resizeDocument } = await import("../../studios/tools/image-ops.js");
      const p = app.page;
      const r = resizeDocument(app, a.width, a.height ?? (a.width * p.h) / p.w, { resample: a.resample || "scale", dpi: a.dpi });
      return r === true ? { ok: true, page: { w: app.page.w, h: app.page.h } } : { ok: false, error: r };
    }),

    tool("rotate_image", "Rotates the whole document clockwise by an angle (90, 180, -90 or any angle; the canvas grows to fit unless expand is false).", {
      degrees: S.num("Clockwise degrees"), expand: S.bool("Grow the canvas to hold the rotated content (default true)"),
    }, ["degrees"], async (a) => {
      requireDoc(app);
      const { rotateDocument } = await import("../../studios/tools/image-ops.js");
      const r = rotateDocument(app, a.degrees, { expand: a.expand !== false });
      return r === true ? { ok: true, page: { w: app.page.w, h: app.page.h } } : { ok: false, error: r };
    }),

    tool("trim_edges", "Removes transparent or solid-colored margins around the content (mode transparent, topleft or bottomright color) or crops to the current pixel selection (mode selection). Mode reveal enlarges the page to show content outside it.", {
      mode: S.str("What to trim", { enum: ["transparent", "topleft", "bottomright", "selection", "reveal"] }), tolerance: S.num("Color tolerance 0-255", { minimum: 0, maximum: 255 }),
    }, [], async (a) => {
      requireDoc(app);
      const m = await import("../../studios/tools/image-ops.js");
      const mode = a.mode || "transparent";
      const r = mode === "selection" ? m.cropToSelection(app) : mode === "reveal" ? m.revealAll(app) : m.trimEdges(app, { mode, tolerance: a.tolerance ?? 0 });
      return r === true ? { ok: true, page: { w: app.page.w, h: app.page.h } } : { ok: false, error: r };
    }),

    tool("select_area", "Creates a pixel selection (rectangle, ellipse or everything) in page coordinates, or clears it. Pixel tools and fills respect it.", {
      shape: S.str("Selection shape", { enum: ["rect", "ellipse", "all", "none"] }), x: S.num("Left"), y: S.num("Top"), w: S.num("Width"), h: S.num("Height"), feather: S.num("Feather radius px", { minimum: 0 }),
    }, ["shape"], (a) => {
      const doc = requireDoc(app);
      const W = Math.round(app.page.w);
      const H = Math.round(app.page.h);
      if (a.shape === "none") {
        setMask(app, null, "AI: Deselect");
        return { ok: true };
      }
      let m = a.shape === "all" ? Mask.full(W, H) : a.shape === "ellipse" ? Mask.ellipse(W, H, a.x ?? 0, a.y ?? 0, a.w ?? W, a.h ?? H) : Mask.rect(W, H, a.x ?? 0, a.y ?? 0, a.w ?? W, a.h ?? H);
      if (a.feather) m.feather(a.feather);
      setMask(app, m, "AI: Select");
      void doc;
      return { ok: true, bounds: m.bounds() };
    }),

    tool("generate_image", "Generates a new image from a text prompt with the configured image model and places it on the page as a layer. Costs money with most providers.", {
      prompt: S.str("Detailed description of the image"), width: S.num("Placed width in px (default 60% of the page)"), x: S.num("Center x"), y: S.num("Center y"),
      size: S.str("Provider size, e.g. 1024x1024, 1536x1024, 1024x1536"), name: S.str("Layer name"),
    }, ["prompt"], async (a) => {
      requireDoc(app);
      if (!ctx.images) throw new Error("No image model is configured. Open Vibe Studio settings and pick an image model (for example an OpenAI image model or an OpenRouter image model).");
      const [img] = await ctx.images.generate({ prompt: a.prompt, size: a.size });
      if (!img) throw new Error("The image model returned no image.");
      const node = await placeFile(app, { name: a.name || "Generated image", bytes: b64ToBytes(img.data), mime: img.mime || "image/png" }, { x: a.x, y: a.y });
      if (a.width && node?.w) {
        const k = a.width / node.w;
        app.doc.set(node, { m: [node.m[0] * k, node.m[1] * k, node.m[2] * k, node.m[3] * k, node.m[4] + (node.w * (1 - k) * node.m[0]) / 2, node.m[5] + (node.h * (1 - k) * node.m[3]) / 2] });
      }
      return { id: node?.id ?? null, note: "Placed as a layer. Take a screenshot to review it." };
    }, { needsApproval: () => "Generate an image? This uses your image model and may cost money." }),

    tool("edit_image", "Edits an existing layer with the image model (generative fill, background replacement, restyle). The layer (and the current selection as a mask, if any) is sent to the provider. The result is placed as a new layer above it.", {
      id: S.str("Layer id to edit (pixel or image layer)"), prompt: S.str("What to change"), useSelection: S.bool("Only change the selected area"),
    }, ["id", "prompt"], async (a) => {
      requireDoc(app);
      if (!ctx.images?.edit) throw new Error("The configured image model cannot edit images. Choose an editing-capable image model in Vibe Studio settings.");
      const [n] = nodesById(app, [a.id]);
      const { exportRaster } = await import("../../core/io.js");
      const page = app.page;
      const { pageBounds } = await import("../../core/transform.js");
      const b = pageBounds(n);
      app.select([n]);
      const area = { x: Math.floor(b.x), y: Math.floor(b.y), w: Math.ceil(b.w), h: Math.ceil(b.h) };
      const src = await exportRaster(app, { page, format: "png", scale: 1, area, background: null });
      let mask = null;
      if (a.useSelection && app.state?.pixelMask) {
        const m = app.state.pixelMask;
        const c = createCanvas(src.width, src.height);
        const g = ctx2d(c);
        const id = g.createImageData(src.width, src.height);
        for (let y = 0; y < src.height; y++) {
          for (let x = 0; x < src.width; x++) {
            const sel = m.get(area.x + x, area.y + y) > 127;
            const o = (y * src.width + x) * 4;
            id.data[o] = id.data[o + 1] = id.data[o + 2] = 0;
            id.data[o + 3] = sel ? 0 : 255; // transparent = edit here (OpenAI mask convention)
          }
        }
        g.putImageData(id, 0, 0);
        const blob = await (c.convertToBlob ? c.convertToBlob({ type: "image/png" }) : new Promise((r) => c.toBlob(r, "image/png")));
        mask = { mime: "image/png", data: bytesToB64(new Uint8Array(await blob.arrayBuffer())) };
      }
      const [img] = await ctx.images.edit({ prompt: a.prompt, image: { mime: "image/png", data: bytesToB64(src.bytes) }, mask });
      if (!img) throw new Error("The image model returned no image.");
      const node = await placeFile(app, { name: `${n.name} (AI edit)`, bytes: b64ToBytes(img.data), mime: img.mime || "image/png" }, { x: area.x + area.w / 2, y: area.y + area.h / 2 });
      return { id: node?.id ?? null };
    }, { needsApproval: () => "Send this layer to the image model for editing?" }),
  );
  return T;
}
