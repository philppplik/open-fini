// Code export of the Proto Studio (docs/concepts/proto-studio.md §10.1, task T7; docs/proto-studio.md ▸ Code export).
// Pure: no DOM. The entry point for the Code panel, the Design panel's Export section, the `proto_to_code` Vibe tool,
// `ofini proto export`, and later the MCP server (T12) and the Code studio live link (T14).
//
//   FORMATS                                   the export formats
//   exportCode(model, opts) → Promise<{ format, files, entry, warnings, ir }>
//       opts: { format = "html", ids?, page?, modes?, ts = true, dataIds = false, collapse = true, title? }
//       files: [{ path, text } | { path, bytes, mime }] sorted, byte-identical for the same model and options
//   lower(model, opts) → IR                   (lower.js) the one intermediate representation all emitters print
//   emitters: emitHtml, emitReact, emitTailwind, emitSwiftUI (html.js, react.js, tailwind.js, swiftui.js), loaded on
//   demand by exportCode so the panel and the CLI only pay for the format in use
//   textFiles(result) / zipEntries(result)    helpers for display and ZIP downloads
import { lower } from "./lower.js";

export { lower };

export const FORMATS = Object.freeze(["html", "react", "react-tailwind", "tailwind", "swiftui"]);
export const FORMAT_LABELS = Object.freeze({ html: "HTML + CSS", react: "React (CSS Modules)", "react-tailwind": "React (Tailwind)", tailwind: "HTML + Tailwind", swiftui: "SwiftUI" });

/**
 * Exports layers of a design as code.
 * @param {object} model
 * @param {{ format?: string, ids?: string[], page?: string, modes?: object, ts?: boolean, dataIds?: boolean, collapse?: boolean, title?: string }} [opts]
 */
export async function exportCode(model, opts = {}) {
  const format = opts.format || "html";
  if (!FORMATS.includes(format)) throw new Error(`Unknown export format “${format}”. Formats: ${FORMATS.join(", ")}.`);
  const react = format === "react" || format === "react-tailwind";
  const ir = lower(model, { ids: opts.ids, page: opts.page, modes: opts.modes, dataIds: !!opts.dataIds, collapse: opts.collapse !== false, assetUrl: react ? (f) => `/assets/${f}` : format === "swiftui" ? (f) => f : (f) => `assets/${f}` });
  const title = opts.title || model.meta?.title || "Design";
  let out;
  if (format === "html") out = (await import("./html.js")).emitHtml(ir, { title });
  else if (format === "tailwind") out = (await import("./tailwind.js")).emitTailwind(ir, { title, model });
  else if (react) out = (await import("./react.js")).emitReact(ir, { styling: format === "react" ? "modules" : "tailwind", ts: opts.ts !== false, model });
  else out = (await import("./swiftui.js")).emitSwiftUI(ir, { model });
  return { format, files: out.files, entry: out.entry, warnings: ir.warnings, ir };
}

/** The text files of a result (assets left out). */
export const textFiles = (res) => res.files.filter((f) => typeof f.text === "string");

/** ZIP entries { path: Uint8Array } of a result (fflate's zipSync input). */
export function zipEntries(res) {
  const enc = new TextEncoder();
  const out = {};
  for (const f of res.files) out[f.path] = typeof f.text === "string" ? enc.encode(f.text) : f.bytes;
  return out;
}
