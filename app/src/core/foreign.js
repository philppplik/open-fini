// Files of other applications that OpenFini cannot read directly, with exact steps to export them to an open
// interchange format instead. OpenFini only reads formats that have a public specification (PSD, IDML, PDF, SVG, PNG,
// JPEG, WebP, ...) and, as a best effort, Sketch; proprietary containers are never reverse engineered (see
// docs/clean-room.md).

const PROPRIETARY = {
  title: "This file format cannot be opened",
};

const AFFINITY = {
  title: "Affinity files cannot be opened directly",
  message: "Affinity's native formats (.afdesign, .afphoto, .afpub) are proprietary and have no public specification, so OpenFini does not read them. Export a copy from Affinity in an open format and open that file instead:",
  steps: [
    "In Affinity choose File ▸ Export… (Affinity Photo / Designer / Publisher).",
    "Photos and layered pixel work: choose PSD (layers are kept). Vector artwork: choose SVG (shapes and text as curves) or PDF (the best choice for pages and text; Publisher documents export well as PDF).",
    "Open the exported file here: PSD opens in the Pixel studio, PDF in the Layout studio with editable text, SVG in the Vector studio.",
  ],
  preview: true,
};

const INFO = [
  { ext: /\.(afdesign|afphoto|afpub|aftemplate|afpackage)$/i, ...AFFINITY },
  {
    ext: /\.indd$/i,
    title: "InDesign documents cannot be opened directly",
    message: "The native .indd format is proprietary and has no public specification. Export a copy from InDesign and open that file instead:",
    steps: [
      "Layout and text: File ▸ Save a Copy As… ▸ choose InDesign Markup (IDML). OpenFini reads pages, shapes, text frames and colors.",
      "Exact appearance: File ▸ Export… ▸ Adobe PDF (Print) and open the PDF; text stays editable, images and vector shapes are kept.",
      "Open the exported file here.",
    ],
  },
  {
    ext: /\.indt$/i,
    title: "InDesign templates cannot be opened directly",
    message: "Open the template in InDesign, save a copy as IDML (File ▸ Save a Copy As…) or export a PDF, then open that file here.",
    steps: [],
  },
  {
    ext: /\.ai$/i,
    title: "This Illustrator file has no PDF content",
    message: "OpenFini opens Illustrator files that were saved with \"Create PDF Compatible File\" (the default since Illustrator CS). This file has no such content (it is very old or PostScript-only). In Illustrator open it and use:",
    steps: ["File ▸ Save As… ▸ Adobe PDF, or File ▸ Export ▸ Export As… ▸ SVG.", "Open the exported file here."],
  },
  {
    ext: /\.eps$/i,
    title: "EPS files are not supported",
    message: "PostScript-based EPS files cannot be rendered by OpenFini (only EPS files that contain a PDF are opened). Export the artwork from the source application as PDF, SVG or PNG and open that file instead.",
    steps: [],
  },
  {
    ext: /\.fig$/i,
    title: "Figma files cannot be opened directly",
    message: "The .fig format is proprietary. Export your frames from Figma and open the result here:",
    steps: ["In Figma select the frames and choose File ▸ Export frames to PDF, or use the Export panel to get SVG or PNG.", "Open the PDF, SVG or PNG here (PDF keeps text editable)."],
  },
  {
    ext: /\.xd$/i,
    title: "Adobe XD files cannot be opened directly",
    message: "The .xd format is proprietary. Export your artboards from Adobe XD and open the result here:",
    steps: ["In XD choose File ▸ Export ▸ Batch… and pick SVG or PDF.", "Open the exported files here."],
  },
  {
    ext: /\.(cdr|pxd|kra|xcf)$/i,
    title: "This file format is not supported",
    message: "OpenFini reads OpenFini documents (.ofini), PDF, Illustrator files saved with PDF content, Photoshop PSD / PSB, InDesign IDML, Sketch, SVG, PNG, JPEG, WebP, GIF, BMP and AVIF. Export your artwork from the source application in one of those formats.",
    steps: [],
  },
];

/** @returns {{title: string, message: string, steps: string[], preview: boolean} | null} */
export function foreignFormatInfo(name = "") {
  for (const i of INFO) if (i.ext.test(name)) return { title: i.title, message: i.message, steps: i.steps || [], preview: !!i.preview };
  return null;
}

export { PROPRIETARY };
