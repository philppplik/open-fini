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
          if (e) return { kind, id: e.id, label: e.label, defaults: e.defaults, controls: e.controls.map((c) => ({ key: c.key, label: c.label, type: c.type, min: c.min, max: c.max, default: c.default, options: c.options?.map((o) => o.value) })) };
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

    tool("apply_adjustment", "Adds a non-destructive adjustment or live filter layer (e.g. kind 'adjustment' id 'hsl', kind 'filter' id 'gaussian-blur'). It affects everything below it, or only the layer when nested is true.", {
      kind: S.str("Effect registry", { enum: ["adjustment", "filter", "develop"] }), id: S.str("Effect id from list_effects"),
      params: { type: "object", description: "Parameter overrides, keys as in list_effects" },
      targetId: S.str("Layer to put it above / inside (default: active layer)"), nested: S.bool("Apply only to the target layer"),
    }, ["kind", "id"], (a) => {
      requireDoc(app);
      const eff = getEffect(a.kind, a.id);
      if (!eff) throw new Error(`Unknown effect ${a.kind}/${a.id}. Call list_effects.`);
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
