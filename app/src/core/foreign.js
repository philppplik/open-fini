// Files of other applications that OpenFini cannot read, with a helpful explanation of what to do instead.
// OpenFini reads only formats that have a public specification (PSD, IDML, SVG, PNG, JPEG, WebP, …).

const PROPRIETARY = {
  title: "This file format cannot be opened",
};

const INFO = [
  {
    ext: /\.(afdesign|afphoto|afpub|aftemplate|afpackage)$/i,
    title: "Affinity files cannot be opened directly",
    message:
      "Affinity's native formats (.afdesign, .afphoto, .afpub) are proprietary and have no public specification, so OpenFini does not read them. In Affinity use File ▸ Export and choose PSD (layers are kept), SVG (vector shapes), PDF or PNG — then drop that file onto OpenFini.",
  },
  {
    ext: /\.indd$/i,
    title: "InDesign documents cannot be opened directly",
    message: "The native .indd format is proprietary. In InDesign use File ▸ Save a Copy As… or Export and choose IDML — OpenFini opens IDML (pages, shapes, text frames and colors).",
  },
  {
    ext: /\.ai$/i,
    title: "Illustrator files cannot be opened directly",
    message: "OpenFini does not import Illustrator (.ai) or PDF artwork yet. In Illustrator use File ▸ Export ▸ Export As… and choose SVG (editable vector shapes) or PSD, then open that file.",
  },
  {
    ext: /\.pdf$/i,
    title: "PDF import is not available yet",
    message: "OpenFini can export PDF but cannot import it yet. Export the pages as SVG or PNG from the source application and open those instead.",
  },
  {
    ext: /\.(eps|sketch|fig|xd|cdr|pxd|kra|xcf)$/i,
    title: "This file format is not supported",
    message: "OpenFini reads OpenFini documents (.ofini), Photoshop PSD / PSB, InDesign IDML, SVG, PNG, JPEG, WebP, GIF, BMP and AVIF. Export your artwork from the source application in one of those formats.",
  },
];

/** @returns {{title: string, message: string} | null} */
export function foreignFormatInfo(name = "") {
  for (const i of INFO) if (i.ext.test(name)) return { title: i.title, message: i.message };
  return null;
}

export { PROPRIETARY };
