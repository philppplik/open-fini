// Print preflight: inspects the display lists that the PDF writer receives (after effects were flattened) plus the
// font report of a dry-run PDF and lists issues for PDF/X-1a, PDF/X-4 or plain PDF output. Pure, lazily loaded.
// This is OpenFini's own check list (CHECKS below), not a PDF/X validator: the output is not certified.
// Messages are English templates with {placeholders}; the UI translates them with t(message, params).

const N_ = (s) => s; // marks text for the i18n extractor (engine code does not import the i18n runtime)

export const CHECKS = [
  N_("RGB objects (solid colors, gradients, images without native CMYK values)"),
  N_("Spot colors in use"),
  N_("Total area coverage of native CMYK colors above the limit"),
  N_("Image resolution below the minimum (effective ppi at the placed size)"),
  N_("Transparency (alpha, opacity, blend modes, soft masks, translucent images)"),
  N_("Pages without bleed"),
  N_("Fonts that are not embedded (base-14 fallback), CFF fonts in PDF/X-1a"),
  N_("Output intent: a real CMYK ICC profile or the built-in approximation"),
];

const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const ID = [1, 0, 0, 1, 0, 0];
const isMat = (m) => Array.isArray(m) && m.length >= 6 && m.every(Number.isFinite);
const hasCmyk = (p) => Array.isArray(p?.cmyk) && p.cmyk.length === 4;

function imageAlpha(img) {
  if (img._alpha !== undefined) return img._alpha;
  let a = false;
  const d = img.rgba;
  if (d) for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) { a = true; break; }
  return (img._alpha = a);
}

const paintAlpha = (p) => !!p && ((p.alpha ?? 1) < 0.9999 || (Array.isArray(p.stops) && p.stops.some((s) => (s.alpha ?? 1) < 0.9999)));

/** True when a display list (items) uses any transparency a PDF/X-1a file cannot contain. */
export function hasTransparency(items) {
  for (const it of items || []) {
    if (!it) continue;
    if (it.t === "group") {
      if ((it.opacity ?? 1) < 0.9999 || (it.blend && it.blend !== "normal") || hasTransparency(it.items)) return true;
    } else if (it.t === "path") {
      if (paintAlpha(it.fill) || paintAlpha(it.stroke?.paint)) return true;
    } else if (it.t === "text") {
      if ((it.runs || []).some((r) => paintAlpha(r.fill) || paintAlpha(r.stroke?.paint))) return true;
    } else if (it.t === "image" && it.img && imageAlpha(it.img)) return true;
  }
  return false;
}

/**
 * @param {{width:number,height:number,items:any[]}[]} lists display lists as given to the PDF writer
 * @param {{standard?:'x1a'|'x4'|null, pages?:{bleed?:number}[], dpi?:number, fonts?:any[], approximate?:boolean,
 *   minPpi?:number, tac?:number, flattened?:number[]}} o
 * @returns {{issues:{severity:'error'|'warning'|'info', code:string, page?:number, message:string, params:object}[], checked:string[]}}
 */
export function preflight(lists, o = {}) {
  const std = o.standard || null;
  const dpi = o.dpi || 96;
  const minPpi = o.minPpi || 300;
  const tac = o.tac || 320;
  const issues = [];
  const add = (severity, code, message, params = {}, page = 0) => issues.push({ severity, code, message, params, ...(page ? { page } : {}) });
  const spots = new Set();
  lists.forEach((dl, pi) => {
    const page = pi + 1;
    let rgb = 0;
    let over = 0;
    const lowRes = [];
    const paint = (p) => {
      if (!p) return;
      if (p.spot) spots.add(p.spot);
      if (p.type === "solid" || !p.type) {
        if (!hasCmyk(p)) rgb++;
        else if (p.cmyk.reduce((a, v) => a + (Number(v) || 0), 0) > tac) over++;
      } else if (!(p.stops || []).every(hasCmyk)) rgb++;
    };
    const walk = (items, m) => {
      for (const it of items || []) {
        if (!it) continue;
        const mm = isMat(it.m) ? mul(m, it.m) : m;
        if (it.t === "group") walk(it.items, mm);
        else if (it.t === "path") {
          if (!it.pageBg) paint(it.fill); // the page color is paper, converted with everything else
          paint(it.stroke?.paint);
        } else if (it.t === "text") for (const r of it.runs || []) {
          paint(r.fill);
          paint(r.stroke?.paint);
        } else if (it.t === "image" && it.img) {
          rgb++;
          if (it.img.flat) continue; // effects rasterized by OpenFini at the chosen resolution
          const scale = Math.max(Math.hypot(mm[0], mm[1]), Math.hypot(mm[2], mm[3]));
          const ppi = scale > 0 ? dpi / scale : Infinity;
          if (ppi < minPpi) lowRes.push(Math.round(ppi));
        }
      }
    };
    walk(dl.items, ID);
    const n = rgb;
    if (n) add(std ? "warning" : "info", "rgb", std ? N_("{n} RGB object(s): converted to CMYK on export.") : N_("{n} RGB object(s): exported as RGB."), { n }, page);
    if (over) add("warning", "tac", N_("{n} CMYK color(s) above {tac} % total ink."), { n: over, tac }, page);
    if (lowRes.length) add("warning", "lowres", N_("{n} image(s) below {min} ppi (lowest {low} ppi)."), { n: lowRes.length, min: minPpi, low: Math.min(...lowRes) }, page);
    if ((o.flattened || []).includes(pi)) add("warning", "flattened", N_("Transparency flattened: the page was rasterized to one CMYK image (text is no longer vector)."), {}, page);
    else if (hasTransparency(dl.items)) add(std === "x1a" ? "error" : "info", "transparency", std === "x1a" ? N_("Transparency is not allowed in PDF/X-1a.") : N_("Uses transparency (allowed in PDF/X-4 and plain PDF)."), {}, page);
    if (!(o.pages?.[pi]?.bleed > 0)) add(std ? "warning" : "info", "bleed", N_("No bleed: objects that touch the page edge may show a white edge after trimming."), {}, page);
  });
  if (spots.size) add("info", "spot", N_("Spot colors: {names}."), { names: [...spots].join(", ") });
  for (const f of o.fonts || []) {
    if (!f.embedded) add(std ? "error" : "warning", "font", N_("Font “{font}” is not embedded (a standard PDF font is used instead)."), { font: f.family });
    else if (std === "x1a" && f.kind === "cff") add("error", "font", N_("Font “{font}” is an OpenType/CFF font, embedded in a way PDF/X-1a (PDF 1.4) does not allow."), { font: f.family });
  }
  if (std && o.approximate) add("warning", "profile", N_("No CMYK ICC profile: colors use OpenFini's approximation and the output intent has no profile. The file is PDF/X-ish and will not pass a validator; load the profile of your printing condition in Color Settings."));
  return { issues, checked: CHECKS };
}
