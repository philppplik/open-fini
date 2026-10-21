// `openfini.document.export(options)`: renders pages or layers of the open design document to image bytes for
// extensions that hold the "export" permission. The handler validates every argument (see rpc.js `v`) and never
// writes anything itself: saving still goes through `files.save` (system dialog).
//
// Public API: exportForExtension(app, params) -> { mime, ext, width, height, data, isolated }
// Invariants: top-level layers are rendered ALONE (a temporary page root holds just them); nested layers cannot be
// lifted out without breaking their transform chain, so for those the page region is rendered (isolated: false).
import { RpcError, v } from "./rpc.js";

const FORMATS = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp" };

export async function exportForExtension(app, p) {
  const o = v.obj(p, "options");
  const format = v.oneOf(o.format ?? "png", "format", ["png", "jpg", "jpeg", "webp", "svg"]);
  const scale = v.num(o.scale ?? 1, "scale", { min: 0.05, max: 8 });
  const quality = v.num(o.quality ?? 0.92, "quality", { min: 0.1, max: 1 });
  const ids = o.ids === undefined ? null : v.arr(o.ids, "ids", { max: 200 }).map((x) => v.str(x, "id", { max: 80 }));
  const background = o.background === undefined ? undefined : o.background === null ? null : v.str(o.background, "background", { max: 40 });
  const doc = app.doc;
  if (!doc || !doc.pages) throw new RpcError("BAD_REQUEST", "No design document is open.");
  if (doc.web) throw new RpcError("BAD_REQUEST", "Exporting images needs a design document (Vector, Pixel or Layout), not a website project.");
  const io = await import("../core/io.js");
  const { pageBoundsOf } = await import("../core/transform.js");

  let page = o.page === undefined ? app.page : doc.pages[v.num(o.page, "page", { min: 0, max: 9999, int: true })];
  let area = null;
  let renderPage = page;
  let isolated = true;
  if (ids) {
    const nodes = ids.map((id) => doc.find(id));
    if (!ids.length || nodes.some((n) => !n)) throw new RpcError("BAD_REQUEST", "Unknown layer id in ids.");
    page = doc.pages.find((pg) => pg.root.children.includes(nodes[0]) || pg === app.page) || app.page;
    renderPage = page;
    const top = nodes.every((n) => page.root.children.includes(n));
    const b = pageBoundsOf(nodes);
    if (!b || !(b.w > 0) || !(b.h > 0)) throw new RpcError("BAD_REQUEST", "These layers have no visible bounds.");
    area = { x: b.x, y: b.y, w: b.w, h: b.h };
    if (top) renderPage = { ...page, root: { ...page.root, children: page.root.children.filter((n) => nodes.includes(n)) } };
    else isolated = false;
  }
  if (!page) throw new RpcError("BAD_REQUEST", "That page does not exist.");
  const bgOpt = background === undefined ? (ids ? null : undefined) : background;
  try {
    if (format === "svg") {
      let { svg } = io.exportSvg(app, renderPage, { background: !ids });
      if (area) svg = svg.replace(/<svg ([^>]*)>/, (m, attrs) => `<svg ${attrs.replace(/width="[^"]*"/, `width="${Math.round(area.w * scale)}"`).replace(/height="[^"]*"/, `height="${Math.round(area.h * scale)}"`).replace(/viewBox="[^"]*"/, `viewBox="${area.x} ${area.y} ${area.w} ${area.h}"`)}>`);
      return { mime: "image/svg+xml", ext: "svg", width: Math.round((area?.w ?? page.w) * scale), height: Math.round((area?.h ?? page.h) * scale), data: new TextEncoder().encode(svg), isolated };
    }
    const r = await io.exportRaster(app, { page: renderPage, format: FORMATS[format], scale, quality, area: area || undefined, background: bgOpt });
    return { mime: r.mime, ext: r.ext, width: r.width, height: r.height, data: r.bytes, isolated };
  } catch (err) {
    if (err instanceof RpcError) throw err;
    throw new RpcError("BAD_REQUEST", err.message || "The export failed.");
  }
}
