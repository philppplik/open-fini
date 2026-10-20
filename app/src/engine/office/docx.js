// Microsoft Word (DOCX, Office Open XML / ECMA-376) reader and writer for the office document model.
// Clean-room implementation from the published ECMA-376 specification. Pure (no DOM).
import { readZip, text as zipText, writeZip } from "./zip.js";
import { parseXml, child, children, find, findAll, attr, textOf, esc, escAttr } from "./xml.js";
import { createDocument, defaultStyles, defaultPage, normalizeDoc, mergeRuns, tableGrid, resolveStyle, PAGE_SIZES, normColor, safeHref, isText } from "./model.js";
import { sniffImage, IMAGE_EXT, imageSize } from "./media.js";
import { createReport, plural } from "./report.js";

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
};
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const EMU = 12700; // per point

const tw = (pt) => Math.round((pt || 0) * 20);
const fromTw = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v) / 20);
const on = (el) => !!el && !["0", "false", "off", "none"].includes(String(attr(el, "val") ?? "true").toLowerCase());

// Word's 16 highlight colors
const HIGHLIGHT = { yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000", white: "#ffffff" };

// =============================================================================================== writer

const STYLE_NAMES = { Normal: "Normal", Title: "Title", Subtitle: "Subtitle", Quote: "Quote", List: "List Paragraph", Code: "Code" };
const wordStyleName = (id, s) => (/^Heading[1-9]$/.test(id) ? `heading ${id.slice(7)}` : STYLE_NAMES[id] || s.name || id);
const sid = (id) => String(id).replace(/[^\w-]/g, "") || "Normal";

function rPrXml(m, { style } = {}) {
  let x = "";
  if (style) x += `<w:rStyle w:val="${escAttr(style)}"/>`;
  if (m.font) x += `<w:rFonts w:ascii="${escAttr(m.font)}" w:hAnsi="${escAttr(m.font)}" w:eastAsia="${escAttr(m.font)}" w:cs="${escAttr(m.font)}"/>`;
  if (m.b) x += "<w:b/><w:bCs/>";
  if (m.i) x += "<w:i/><w:iCs/>";
  if (m.s) x += "<w:strike/>";
  if (m.color) x += `<w:color w:val="${m.color.slice(1).toUpperCase()}"/>`;
  if (m.size) x += `<w:sz w:val="${Math.round(m.size * 2)}"/><w:szCs w:val="${Math.round(m.size * 2)}"/>`;
  if (m.highlight) {
    const named = Object.entries(HIGHLIGHT).find(([, v]) => v === m.highlight)?.[0];
    x += named ? `<w:highlight w:val="${named}"/>` : `<w:shd w:val="clear" w:color="auto" w:fill="${m.highlight.slice(1).toUpperCase()}"/>`;
  }
  if (m.u) x += '<w:u w:val="single"/>';
  if (m.va) x += `<w:vertAlign w:val="${m.va === "sub" ? "subscript" : "superscript"}"/>`;
  return x ? `<w:rPr>${x}</w:rPr>` : "";
}

function pPrXml(p, { style, numId, level, inner = "" } = {}) {
  let x = "";
  if (style && style !== "Normal") x += `<w:pStyle w:val="${escAttr(sid(style))}"/>`;
  const pr = p || {};
  if (pr.keepWithNext) x += "<w:keepNext/>";
  if (pr.pageBreakBefore) x += "<w:pageBreakBefore/>";
  if (numId) x += `<w:numPr><w:ilvl w:val="${level || 0}"/><w:numId w:val="${numId}"/></w:numPr>`;
  x += inner;
  const sp = [];
  if (pr.spaceBefore !== undefined) sp.push(`w:before="${tw(pr.spaceBefore)}"`);
  if (pr.spaceAfter !== undefined) sp.push(`w:after="${tw(pr.spaceAfter)}"`);
  if (pr.lineHeight !== undefined) sp.push(`w:line="${Math.round(pr.lineHeight * 240)}" w:lineRule="auto"`);
  if (sp.length) x += `<w:spacing ${sp.join(" ")}/>`;
  const ind = [];
  if (pr.indentLeft !== undefined) ind.push(`w:left="${tw(pr.indentLeft)}"`);
  if (pr.indentRight !== undefined) ind.push(`w:right="${tw(pr.indentRight)}"`);
  if (pr.indentFirst !== undefined) ind.push(pr.indentFirst < 0 ? `w:hanging="${tw(-pr.indentFirst)}"` : `w:firstLine="${tw(pr.indentFirst)}"`);
  if (ind.length) x += `<w:ind ${ind.join(" ")}/>`;
  if (pr.align) x += `<w:jc w:val="${pr.align === "justify" ? "both" : pr.align}"/>`;
  return x ? `<w:pPr>${x}</w:pPr>` : "";
}

function textRunsXml(text, m, style) {
  // tabs become <w:tab/>; everything else is <w:t>
  const parts = text.split("\t");
  let body = "";
  parts.forEach((t, i) => {
    if (i) body += "<w:tab/>";
    if (t) body += `<w:t xml:space="preserve">${esc(t)}</w:t>`;
  });
  return `<w:r>${rPrXml(m, { style })}${body}</w:r>`;
}

/**
 * Writes a .docx file.
 * @param {object} input office document model
 * @param {{ svgFallbacks?: Record<string, Uint8Array> }} [o] PNG renderings of SVG media (Word needs a PNG next to an SVG)
 * @returns {Uint8Array}
 */
export function writeDocx(input, o = {}) {
  const doc = normalizeDoc(input);
  const rels = [];
  const addRel = (type, target, external = false) => {
    const id = `rId${rels.length + 10}`;
    rels.push(`<Relationship Id="${id}" Type="${REL}/${type}" Target="${escAttr(target)}"${external ? ' TargetMode="External"' : ""}/>`);
    return id;
  };
  const files = [];
  const mediaRel = new Map();
  const exts = new Set();
  let picId = 1;
  const imageXml = (r) => {
    const m = doc.media[r.media];
    if (!m?.bytes) return "";
    let rid = mediaRel.get(r.media);
    if (!rid) {
      const ext = IMAGE_EXT[m.mime] || "png";
      exts.add(ext);
      const name = `media/${r.media}.${ext}`;
      files.push([`word/${name}`, m.bytes]);
      rid = { main: addRel("image", name) };
      if (m.mime === "image/svg+xml") {
        const png = o.svgFallbacks?.[r.media];
        if (png) {
          exts.add("png");
          files.push([`word/media/${r.media}-fallback.png`, png]);
          rid = { main: addRel("image", `media/${r.media}-fallback.png`), svg: rid.main };
        }
      }
      mediaRel.set(r.media, rid);
    }
    const cx = Math.round(r.width * EMU);
    const cy = Math.round(r.height * EMU);
    const id = picId++;
    const descr = r.alt ? ` descr="${escAttr(r.alt)}"` : "";
    const blip = rid.svg
      ? `<a:blip r:embed="${rid.main}"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${rid.svg}"/></a:ext></a:extLst></a:blip>`
      : `<a:blip r:embed="${rid.main}"/>`;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Picture ${id}"${descr}/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${escAttr(r.media)}"${descr}/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };

  // lists: one w:num per list id (numbered lists restart per list)
  const numIds = new Map();
  const numFor = (list) => {
    const key = `${list.kind}:${list.id || "default"}`;
    if (!numIds.has(key)) numIds.set(key, { id: numIds.size + 1, kind: list.kind });
    return numIds.get(key).id;
  };

  const footnoteIds = new Map();
  const fieldXml = (f) => {
    const instr = f === "page" ? " PAGE " : f === "pages" ? " NUMPAGES " : ' DATE \\@ "yyyy-MM-dd" ';
    return `<w:fldSimple w:instr="${escAttr(instr)}"><w:r><w:t>${f === "date" ? "" : "1"}</w:t></w:r></w:fldSimple>`;
  };
  const inlineXml = (runs) => {
    let x = "";
    let link = null;
    let linkBody = "";
    const flush = () => {
      if (!link) return;
      x += link.startsWith("#") ? `<w:hyperlink w:anchor="${escAttr(link.slice(1))}">${linkBody}</w:hyperlink>` : `<w:hyperlink r:id="${addRel("hyperlink", link, true)}" w:history="1">${linkBody}</w:hyperlink>`;
      link = null;
      linkBody = "";
    };
    for (const r of runs) {
      let piece;
      if (isText(r)) piece = textRunsXml(r.text, r, r.link ? "Hyperlink" : undefined);
      else if (r.type === "break") piece = "<w:r><w:br/></w:r>";
      else if (r.type === "image") piece = imageXml(r);
      else if (r.type === "field") piece = fieldXml(r.field);
      else if (r.type === "footnote") {
        if (!footnoteIds.has(r.id)) footnoteIds.set(r.id, footnoteIds.size + 1);
        piece = `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${footnoteIds.get(r.id)}"/></w:r>`;
      } else piece = "";
      const l = isText(r) ? r.link || null : null;
      if (l !== link) flush();
      if (l) {
        link = l;
        linkBody += piece;
      } else x += piece;
    }
    flush();
    return x;
  };
  const paraXml = (p, extraInner = "") => {
    const numId = p.list ? numFor(p.list) : 0;
    return `<w:p>${pPrXml(p.props, { style: p.style, numId, level: p.list?.level, inner: extraInner })}${inlineXml(p.runs)}</w:p>`;
  };
  const tableXml = (t) => {
    const b = t.borders;
    const bv = b.style === "none" ? 'w:val="nil"' : `w:val="single" w:sz="${Math.max(2, Math.round(b.width * 8))}" w:space="0" w:color="${b.color.slice(1).toUpperCase()}"`;
    const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map((k) => `<w:${k} ${bv}/>`).join("");
    let x = `<w:tbl><w:tblPr><w:tblW w:w="${tw(t.cols.reduce((a, c) => a + c, 0))}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${t.cols.map((c) => `<w:gridCol w:w="${tw(c)}"/>`).join("")}</w:tblGrid>`;
    const grid = tableGrid(t);
    t.rows.forEach((row, r) => {
      x += `<w:tr>${row.header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}`;
      for (let c = 0; c < t.cols.length; ) {
        const g = grid[r][c];
        if (!g) {
          x += `<w:tc><w:tcPr><w:tcW w:w="${tw(t.cols[c])}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;
          c++;
          continue;
        }
        const width = t.cols.slice(g.col, g.col + g.colspan).reduce((a, v) => a + v, 0);
        const span = g.colspan > 1 ? `<w:gridSpan w:val="${g.colspan}"/>` : "";
        if (g.origin) {
          const cell = t.rows[r].cells[g.ci];
          const vm = g.rowspan > 1 ? '<w:vMerge w:val="restart"/>' : "";
          const shd = cell.shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shading.slice(1).toUpperCase()}"/>` : "";
          const va = cell.vAlign && cell.vAlign !== "top" ? `<w:vAlign w:val="${cell.vAlign === "middle" ? "center" : "bottom"}"/>` : "";
          x += `<w:tc><w:tcPr><w:tcW w:w="${tw(width)}" w:type="dxa"/>${span}${vm}${shd}${va}</w:tcPr>${cell.blocks.map((p) => paraXml(p)).join("") || "<w:p/>"}</w:tc>`;
        } else if (g.r < r) x += `<w:tc><w:tcPr><w:tcW w:w="${tw(width)}" w:type="dxa"/>${span}<w:vMerge/></w:tcPr><w:p/></w:tc>`;
        c += g.colspan;
      }
      x += "</w:tr>";
    });
    return `${x}</w:tbl>`;
  };

  let body = "";
  for (const b of doc.blocks) {
    if (b.type === "paragraph") body += paraXml(b);
    else if (b.type === "table") body += tableXml(b);
    else if (b.type === "pageBreak") body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    else if (b.type === "rule") body += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr></w:pPr></w:p>';
  }

  // header / footer
  const hdr = (kind, blocks) => {
    if (!blocks.length) return "";
    const tag = kind === "header" ? "hdr" : "ftr";
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} ${nsDecl()}>${blocks.map((p) => paraXml(p)).join("")}</w:${tag}>`;
    files.push([`word/${kind}1.xml`, xml]);
    return `<w:${kind}Reference w:type="default" r:id="${addRel(kind, `${kind}1.xml`)}"/>`;
  };
  const pg = doc.page;
  const sect = `<w:sectPr>${hdr("header", doc.header)}${hdr("footer", doc.footer)}<w:pgSz w:w="${tw(pg.width)}" w:h="${tw(pg.height)}"${pg.orientation === "landscape" ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${tw(pg.margins.top)}" w:right="${tw(pg.margins.right)}" w:bottom="${tw(pg.margins.bottom)}" w:left="${tw(pg.margins.left)}" w:header="${tw(pg.margins.header)}" w:footer="${tw(pg.margins.footer)}" w:gutter="0"/><w:cols w:space="${tw(pg.columnGap)}"${pg.columns > 1 ? ` w:num="${pg.columns}"` : ""}/><w:docGrid w:linePitch="360"/></w:sectPr>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${nsDecl()}><w:body>${body}${sect}</w:body></w:document>`;

  // footnotes (written after the body so the ids are known; nested references inside footnotes are not supported)
  let footnotes = "";
  if (footnoteIds.size) {
    const items = [...footnoteIds].map(([id, n]) => {
      const blocks = doc.footnotes[id] || [];
      const paras = (blocks.length ? blocks : [{ type: "paragraph", style: "FootnoteText", runs: [] }]).map((p, k) => `<w:p>${pPrXml(p.props, { style: "FootnoteText" })}${k === 0 ? '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>' : ""}${inlineXml(p.runs.filter((r) => r.type !== "footnote"))}</w:p>`).join("");
      return `<w:footnote w:id="${n}">${paras}</w:footnote>`;
    });
    footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ${nsDecl()}><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${items.join("")}</w:footnotes>`;
    files.push(["word/footnotes.xml", footnotes]);
    addRel("footnotes", "footnotes.xml");
  }

  addRel("styles", "styles.xml");
  addRel("settings", "settings.xml");
  if (numIds.size) {
    files.push(["word/numbering.xml", numberingXml(numIds)]);
    addRel("numbering", "numbering.xml");
  }

  const ct = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>',
    ...[...exts].map((e) => `<Default Extension="${e}" ContentType="${Object.entries(IMAGE_EXT).find(([, v]) => v === e)?.[0] || "image/png"}"/>`),
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    numIds.size ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : "",
    footnotes ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : "",
    doc.header.length ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : "",
    doc.footer.length ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : "",
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    "</Types>",
  ].join("");
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;
  const meta = doc.meta;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title)}</dc:title><dc:subject>${esc(meta.subject)}</dc:subject><dc:creator>${esc(meta.author)}</dc:creator><cp:keywords>${esc(meta.keywords)}</cp:keywords><dc:language>${esc(meta.lang || "en-US")}</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${esc(/^\d{4}-/.test(meta.created) ? meta.created.replace(/\.\d+Z$/, "Z") : now)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>OpenFini</Application></Properties>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="${NS.w}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>${footnotes ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ""}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

  return writeZip([
    ["[Content_Types].xml", ct],
    ["_rels/.rels", rootRels],
    ["word/document.xml", document],
    ["word/_rels/document.xml.rels", docRels],
    ["word/styles.xml", stylesXml(doc)],
    ["word/settings.xml", settings],
    ...files,
    ["docProps/core.xml", core],
    ["docProps/app.xml", app],
  ]);
}

function nsDecl() {
  return `xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}"`;
}

function stylesXml(doc) {
  const normal = resolveStyle(doc, "Normal");
  const font = normal.run.font || "Calibri";
  const size = Math.round((normal.run.size || 11) * 2);
  let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="${NS.w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${escAttr(font)}" w:hAnsi="${escAttr(font)}" w:eastAsia="${escAttr(font)}" w:cs="${escAttr(font)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="${escAttr(doc.meta.lang || "en-US")}" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`;
  x += '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>';
  x += '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>';
  for (const [id, s] of Object.entries(doc.styles)) {
    if (s.type === "character") {
      x += `<w:style w:type="character" w:customStyle="1" w:styleId="${escAttr(sid(id))}"><w:name w:val="${escAttr(s.name || id)}"/>${s.basedOn ? `<w:basedOn w:val="${escAttr(sid(s.basedOn))}"/>` : ""}${rPrXml(s.run || {})}</w:style>`;
      continue;
    }
    const builtin = id in STYLE_NAMES || /^Heading[1-9]$/.test(id);
    const outline = s.outline ? `<w:outlineLvl w:val="${s.outline - 1}"/>` : "";
    x += `<w:style w:type="paragraph"${id === "Normal" ? ' w:default="1"' : ""}${builtin ? "" : ' w:customStyle="1"'} w:styleId="${escAttr(sid(id))}"><w:name w:val="${escAttr(wordStyleName(id, s))}"/>${s.basedOn ? `<w:basedOn w:val="${escAttr(sid(s.basedOn))}"/>` : ""}${s.next ? `<w:next w:val="${escAttr(sid(s.next))}"/>` : ""}${/^Heading/.test(id) ? '<w:uiPriority w:val="9"/>' : ""}<w:qFormat/>${pPrXml(s.para || {}, { inner: outline })}${rPrXml(s.run || {})}</w:style>`;
  }
  x += '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>';
  x += '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>';
  x += '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>';
  return `${x}</w:styles>`;
}

const BULLETS = ["•", "◦", "▪"];
const NUM_FMT = ["decimal", "lowerLetter", "lowerRoman"];
function numberingXml(numIds) {
  let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${NS.w}">`;
  for (const [abs, kind] of [[1, "bullet"], [2, "number"]]) {
    x += `<w:abstractNum w:abstractNumId="${abs}"><w:multiLevelType w:val="hybridMultilevel"/>`;
    for (let l = 0; l < 9; l++) {
      const ind = `<w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr>`;
      if (kind === "bullet") x += `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${BULLETS[l % 3]}"/><w:lvlJc w:val="left"/>${ind}</w:lvl>`;
      else x += `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${NUM_FMT[l % 3]}"/><w:lvlText w:val="%${l + 1}."/><w:lvlJc w:val="left"/>${ind}</w:lvl>`;
    }
    x += "</w:abstractNum>";
  }
  for (const { id, kind } of numIds.values()) x += `<w:num w:numId="${id}"><w:abstractNumId w:val="${kind === "bullet" ? 1 : 2}"/>${kind === "number" ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ""}</w:num>`;
  return `${x}</w:numbering>`;
}

// =============================================================================================== reader

const relPath = (base, target) => {
  if (!target) return "";
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

function readRels(entries, part) {
  const dir = part.split("/").slice(0, -1).join("/");
  const name = `${dir ? `${dir}/` : ""}_rels/${part.split("/").pop()}.rels`;
  const xml = zipText(entries, name);
  const map = new Map();
  if (!xml) return map;
  for (const r of findAll(parseXml(xml), "Relationship")) {
    const type = String(r.attrs.Type || "").split("/").pop();
    const external = r.attrs.TargetMode === "External";
    map.set(r.attrs.Id, { type, target: external ? r.attrs.Target : relPath(part, r.attrs.Target), external });
  }
  return map;
}

function rPrToMarks(rPr, ctx) {
  const m = {};
  if (!rPr) return m;
  for (const c of rPr.children) {
    if (typeof c === "string") continue;
    switch (c.local) {
      case "rStyle": {
        // the Hyperlink style only paints links; the link itself carries that meaning
        const cs = attr(c, "val") === "Hyperlink" ? null : ctx.charStyles.get(attr(c, "val"));
        if (cs) Object.assign(m, cs);
        break;
      }
      case "rFonts": {
        const f = attr(c, "ascii") || attr(c, "hAnsi") || attr(c, "cs") || attr(c, "eastAsia");
        const theme = attr(c, "asciiTheme") || attr(c, "hAnsiTheme");
        if (f) m.font = f;
        else if (theme) m.font = /major/i.test(theme) ? ctx.fonts.major : ctx.fonts.minor;
        break;
      }
      case "b":
        m.b = on(c) || undefined;
        break;
      case "i":
        m.i = on(c) || undefined;
        break;
      case "strike":
      case "dstrike":
        m.s = on(c) || undefined;
        break;
      case "u":
        m.u = attr(c, "val") !== "none" || undefined;
        break;
      case "vertAlign": {
        const v = attr(c, "val");
        m.va = v === "superscript" ? "super" : v === "subscript" ? "sub" : undefined;
        break;
      }
      case "color": {
        const v = attr(c, "val");
        if (v && v !== "auto") m.color = normColor(`#${v}`);
        break;
      }
      case "highlight": {
        const v = attr(c, "val");
        if (HIGHLIGHT[v]) m.highlight = HIGHLIGHT[v];
        break;
      }
      case "shd": {
        const v = attr(c, "fill");
        if (v && v !== "auto" && !/^f{6}$/i.test(v)) m.highlight = normColor(`#${v}`);
        break;
      }
      case "sz": {
        const v = Number(attr(c, "val"));
        if (v > 0) m.size = v / 2;
        break;
      }
      case "caps":
      case "smallCaps":
        if (on(c)) ctx.report.flattened("Capitals and small capitals are shown as typed.");
        break;
    }
  }
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  return m;
}

function pPrToProps(pPr) {
  const p = {};
  if (!pPr) return p;
  const jc = attr(child(pPr, "jc"), "val");
  if (jc) p.align = jc === "both" || jc === "distribute" ? "justify" : jc === "end" ? "right" : jc === "start" ? "left" : ["left", "center", "right"].includes(jc) ? jc : undefined;
  const sp = child(pPr, "spacing");
  if (sp) {
    const b = fromTw(attr(sp, "before"));
    const a = fromTw(attr(sp, "after"));
    if (b !== undefined) p.spaceBefore = b;
    if (a !== undefined) p.spaceAfter = a;
    const line = Number(attr(sp, "line"));
    const rule = attr(sp, "lineRule") || "auto";
    if (line > 0) p.lineHeight = rule === "auto" ? line / 240 : Math.max(0.5, line / 20 / 12); // exact/atLeast: approximated for 12 pt text
  }
  const ind = child(pPr, "ind");
  if (ind) {
    const l = fromTw(attr(ind, "left") ?? attr(ind, "start"));
    const r = fromTw(attr(ind, "right") ?? attr(ind, "end"));
    const f = fromTw(attr(ind, "firstLine"));
    const h = fromTw(attr(ind, "hanging"));
    if (l !== undefined) p.indentLeft = l;
    if (r !== undefined) p.indentRight = r;
    if (h !== undefined) p.indentFirst = -h;
    else if (f !== undefined) p.indentFirst = f;
  }
  if (child(pPr, "keepNext") && on(child(pPr, "keepNext"))) p.keepWithNext = true;
  if (child(pPr, "pageBreakBefore") && on(child(pPr, "pageBreakBefore"))) p.pageBreakBefore = true;
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  return p;
}

const STYLE_MAP = { normal: "Normal", title: "Title", subtitle: "Subtitle", quote: "Quote", "intense quote": "Quote", "list paragraph": "List", "html preformatted": "Code", "plain text": "Code" };

function readStyles(xml, ctx) {
  const styles = defaultStyles();
  const idMap = new Map(); // word style id -> model id
  const charStyles = new Map();
  if (!xml) return { styles, idMap, charStyles };
  const root = parseXml(xml);
  const defaults = find(root, "docDefaults");
  const defRun = rPrToMarks(find(find(defaults, "rPrDefault"), "rPr"), { ...ctx, charStyles });
  const defPara = pPrToProps(find(find(defaults, "pPrDefault"), "pPr"));
  const list = findAll(root, "style");
  // first pass: ids
  for (const s of list) {
    const wid = attr(s, "styleId");
    if (!wid) continue;
    const type = attr(s, "type");
    const name = attr(child(s, "name"), "val") || wid;
    const lname = name.toLowerCase();
    let id;
    const hm = /^heading ([1-9])$/.exec(lname);
    if (hm) id = `Heading${Math.min(6, +hm[1])}`;
    else if (STYLE_MAP[lname]) id = STYLE_MAP[lname];
    else id = wid.replace(/[^\w -]/g, "").slice(0, 60) || `S${idMap.size}`;
    if (type === "paragraph") idMap.set(wid, id);
    else if (type === "character") idMap.set(`c:${wid}`, id);
  }
  // second pass: properties (character styles first so paragraph styles can be resolved later)
  for (const s of list) {
    if (attr(s, "type") !== "character") continue;
    const wid = attr(s, "styleId");
    if (!wid || wid === "DefaultParagraphFont") continue;
    charStyles.set(wid, rPrToMarks(child(s, "rPr"), { ...ctx, charStyles }));
  }
  for (const s of list) {
    if (attr(s, "type") !== "paragraph") continue;
    const wid = attr(s, "styleId");
    const id = idMap.get(wid);
    if (!id) continue;
    const based = attr(child(s, "basedOn"), "val");
    const next = attr(child(s, "next"), "val");
    const pPr = child(s, "pPr");
    const outline = attr(child(pPr, "outlineLvl"), "val");
    const def = styles[id] || {};
    const para = pPrToProps(pPr);
    const run = rPrToMarks(child(s, "rPr"), { ...ctx, charStyles });
    const entry = { ...def, name: attr(child(s, "name"), "val") || id, type: "paragraph", para: { ...(id === "Normal" ? defPara : {}), ...para }, run: { ...(id === "Normal" ? defRun : {}), ...run } };
    if (id === "Normal") entry.run = { font: defRun.font || "Calibri", size: defRun.size || 10, ...entry.run };
    if (based && idMap.get(based) && idMap.get(based) !== id) entry.basedOn = idMap.get(based);
    else if (id !== "Normal") entry.basedOn = def.basedOn;
    if (!entry.basedOn) delete entry.basedOn;
    if (next && idMap.get(next)) entry.next = idMap.get(next);
    if (outline !== undefined && Number(outline) < 9) entry.outline = Number(outline) + 1;
    else if (/^Heading[1-6]$/.test(id)) entry.outline = +id.slice(7);
    if (id === "Normal") delete entry.outline;
    // a list style's numbering is kept on the style for paragraphs that inherit it
    const numPr = child(pPr, "numPr");
    if (numPr) ctx.styleNum.set(id, { numId: attr(child(numPr, "numId"), "val"), ilvl: Number(attr(child(numPr, "ilvl"), "val") || 0) });
    styles[id] = entry;
  }
  if (!styles.Normal.run.font) styles.Normal.run.font = defRun.font || "Calibri";
  return { styles, idMap, charStyles };
}

function readNumbering(xml) {
  const abs = new Map();
  const nums = new Map();
  if (!xml) return nums;
  const root = parseXml(xml);
  for (const a of findAll(root, "abstractNum")) {
    const levels = [];
    for (const l of children(a, "lvl")) levels[Number(attr(l, "ilvl") || 0)] = attr(child(l, "numFmt"), "val") || "decimal";
    abs.set(attr(a, "abstractNumId"), levels);
  }
  for (const n of findAll(root, "num")) nums.set(attr(n, "numId"), abs.get(attr(child(n, "abstractNumId"), "val")) || []);
  return nums;
}

/**
 * Reads a .docx file.
 * @param {Uint8Array} bytes
 * @param {{report?: object, name?: string}} [o]
 * @returns {{ doc: object, report: object }}
 */
export function readDocx(bytes, o = {}) {
  const report = o.report || createReport("Word (DOCX)", o.name);
  const { entries, problems, ok } = readZip(bytes, { want: (n) => !/^(customXml|word\/embeddings|word\/glossary)\//.test(n) });
  for (const p of problems) report.note(p);
  if (!ok) throw new Error(problems[problems.length - 1] || "This is not a valid Word document.");
  const rootRels = readRels(entries, "");
  const mainPart = [...rootRels.values()].find((r) => r.type === "officeDocument")?.target || "word/document.xml";
  const xml = zipText(entries, mainPart);
  if (!xml) {
    if (entries["xl/workbook.xml"] || entries["ppt/presentation.xml"]) throw new Error("This is an Excel or PowerPoint file, not a Word document.");
    throw new Error("This file has no Word document content (word/document.xml is missing).");
  }
  const rels = readRels(entries, mainPart);
  const theme = zipText(entries, [...rels.values()].find((r) => r.type === "theme")?.target || "word/theme/theme1.xml");
  const fonts = { minor: "Calibri", major: "Calibri Light" };
  if (theme) {
    const t = parseXml(theme);
    fonts.minor = attr(child(find(t, "minorFont"), "latin"), "typeface") || fonts.minor;
    fonts.major = attr(child(find(t, "majorFont"), "latin"), "typeface") || fonts.major;
  }
  const ctx = { report, fonts, charStyles: new Map(), styleNum: new Map(), rels, entries, media: {}, footnotes: {}, mediaByTarget: new Map(), counts: { images: 0, tables: 0, links: 0, lists: 0, footnotes: 0 }, part: mainPart };
  const stylesPart = [...rels.values()].find((r) => r.type === "styles")?.target;
  const st = readStyles(stylesPart ? zipText(entries, stylesPart) : null, ctx);
  ctx.charStyles = st.charStyles;
  ctx.idMap = st.idMap;
  const numPart = [...rels.values()].find((r) => r.type === "numbering")?.target;
  ctx.numbering = readNumbering(numPart ? zipText(entries, numPart) : null);
  const model = createDocument();
  model.styles = st.styles;
  ctx.model = model;

  // footnotes and endnotes (endnotes become footnotes)
  for (const kind of ["footnotes", "endnotes"]) {
    const part = [...rels.values()].find((r) => r.type === kind)?.target;
    const fx = part && zipText(entries, part);
    if (!fx) continue;
    const saved = ctx.rels;
    ctx.rels = readRels(entries, part);
    for (const fn of findAll(parseXml(fx), kind === "footnotes" ? "footnote" : "endnote")) {
      const id = attr(fn, "id");
      if (attr(fn, "type") && attr(fn, "type") !== "normal") continue;
      const paras = readBlocks(fn, ctx).filter((b) => b.type === "paragraph");
      const first = paras[0]?.runs[0];
      if (first && typeof first.text === "string") paras[0].runs[0] = { ...first, text: first.text.replace(/^\s+/, "") };
      ctx.footnotes[`${kind === "footnotes" ? "fn" : "en"}${id}`] = paras.map((p) => ({ ...p, style: p.style === "FootnoteText" ? "Normal" : p.style }));
    }
    ctx.rels = saved;
    if (kind === "endnotes" && findAll(parseXml(fx), "endnote").length > 2) report.flattened("Endnotes were converted to footnotes.");
  }

  const docEl = parseXml(xml);
  const body = find(docEl, "body");
  if (!body) throw new Error("The Word document has no body.");
  model.blocks = readBlocks(body, ctx);
  model.footnotes = ctx.footnotes;
  model.media = ctx.media;

  // page setup from the last section
  const sects = findAll(body, "sectPr");
  if (sects.length > 1) report.flattened(`The document has ${sects.length} sections; one page setup is used for all of them.`);
  const sect = child(body, "sectPr") || sects[sects.length - 1];
  if (sect) {
    const pgSz = child(sect, "pgSz");
    const pgMar = child(sect, "pgMar");
    const page = defaultPage();
    const w = fromTw(attr(pgSz, "w"));
    const h = fromTw(attr(pgSz, "h"));
    if (w && h) {
      page.width = w;
      page.height = h;
      page.orientation = attr(pgSz, "orient") === "landscape" || w > h ? "landscape" : "portrait";
      const pw = Math.min(w, h);
      const ph = Math.max(w, h);
      page.size = Object.keys(PAGE_SIZES).find((k) => Math.abs(PAGE_SIZES[k].width - pw) < 3 && Math.abs(PAGE_SIZES[k].height - ph) < 3) || "custom";
    }
    for (const k of ["top", "right", "bottom", "left", "header", "footer"]) {
      const v = fromTw(attr(pgMar, k));
      if (v !== undefined) page.margins[k] = Math.abs(v);
    }
    const cols = child(sect, "cols");
    if (cols && Number(attr(cols, "num")) > 1) {
      page.columns = Math.min(4, Number(attr(cols, "num")));
      page.columnGap = fromTw(attr(cols, "space")) ?? 36;
    }
    model.page = page;
    for (const kind of ["header", "footer"]) {
      const refs = children(sect, `${kind}Reference`);
      const ref = refs.find((r) => attr(r, "type") === "default") || refs[0];
      if (refs.some((r) => attr(r, "type") === "first" || attr(r, "type") === "even")) report.flattened(`Different first-page or even-page ${kind}s were replaced by the default ${kind}.`);
      const target = ref && ctx.rels.get(attr(ref, "id"))?.target;
      const hx = target && zipText(entries, target);
      if (!hx) continue;
      const saved = ctx.rels;
      ctx.rels = readRels(entries, target);
      model[kind] = readBlocks(children(parseXml(hx))[0] || { children: [] }, ctx).filter((b) => b.type === "paragraph").slice(0, 20);
      ctx.rels = saved;
      if (model[kind].length) report.kept(`The ${kind} text${model[kind].some((p) => p.runs.some((r) => r.type === "field")) ? " with page numbers" : ""}.`);
    }
  }

  // properties
  const core = zipText(entries, "docProps/core.xml");
  if (core) {
    const c = parseXml(core);
    model.meta.title = textOf(find(c, "title")).trim();
    model.meta.author = textOf(find(c, "creator")).trim();
    model.meta.subject = textOf(find(c, "subject")).trim();
    model.meta.keywords = textOf(find(c, "keywords")).trim();
    model.meta.created = textOf(find(c, "created")).trim() || model.meta.created;
  }
  if (entries["word/comments.xml"]) report.dropped("Comments (Office Studio does not support comments yet).");
  if (Object.keys(entries).some((n) => n.startsWith("word/charts/"))) report.dropped("Charts (their cached text may remain).");
  const c = ctx.counts;
  const paras = model.blocks.filter((b) => b.type === "paragraph").length;
  report.kept(`${plural(paras, "paragraph")}, text formatting and named styles.`);
  if (c.lists) report.kept(`${plural(c.lists, "list paragraph")} (bulleted and numbered, with levels).`);
  if (c.tables) report.kept(`${plural(c.tables, "table")} with merged cells and shading.`);
  if (c.images) report.kept(`${plural(c.images, "image")}.`);
  if (c.links) report.kept(`${plural(c.links, "link")}.`);
  if (Object.keys(ctx.footnotes).length) report.kept(`${plural(Object.keys(ctx.footnotes).length, "footnote")}.`);
  const doc = normalizeDoc(model);
  return { doc, report };
}

/** Reads the block children of a body / cell / footnote / header element. */
function readBlocks(parent, ctx, depth = 0) {
  const out = [];
  for (const el of parent.children) {
    if (typeof el === "string") continue;
    switch (el.local) {
      case "p":
        out.push(...readParagraph(el, ctx));
        break;
      case "tbl":
        if (depth > 0) {
          ctx.report.flattened("Tables inside table cells were converted to paragraphs.");
          for (const tc of findAll(el, "tc")) out.push(...readBlocks(tc, ctx, depth + 1));
        } else {
          const t = readTable(el, ctx);
          if (t) out.push(t);
        }
        break;
      case "sdt":
        out.push(...readBlocks(child(el, "sdtContent") || el, ctx, depth));
        break;
      case "customXml":
      case "ins":
      case "smartTag":
        out.push(...readBlocks(el, ctx, depth));
        break;
      case "del":
        ctx.report.dropped("Tracked deletions (the text that was deleted is not shown).");
        break;
      case "AlternateContent":
        out.push(...readBlocks(child(el, "Choice") || child(el, "Fallback") || el, ctx, depth));
        break;
    }
  }
  return out;
}

function readParagraph(p, ctx) {
  const pPr = child(p, "pPr");
  const wid = attr(child(pPr, "pStyle"), "val");
  const style = (wid && ctx.idMap.get(wid)) || "Normal";
  const props = pPrToProps(pPr);
  const para = { type: "paragraph", style, runs: [] };
  if (Object.keys(props).length) para.props = props;
  // numbering (direct or through the style)
  const numPr = child(pPr, "numPr");
  let numId = attr(child(numPr, "numId"), "val");
  let ilvl = Number(attr(child(numPr, "ilvl"), "val") || 0);
  if (!numPr && ctx.styleNum.has(style)) ({ numId, ilvl } = ctx.styleNum.get(style));
  if (numId && numId !== "0") {
    const fmt = ctx.numbering.get(numId)?.[ilvl] || "decimal";
    if (fmt !== "none") {
      para.list = { kind: fmt === "bullet" ? "bullet" : "number", level: Math.min(8, ilvl), id: `n${numId}` };
      ctx.counts.lists++;
      // the list's own indent is implied; remove a duplicated hanging indent
      if (para.props) {
        delete para.props.indentLeft;
        delete para.props.indentFirst;
      }
    }
  }
  // a bottom border on an empty paragraph is a horizontal rule
  if (find(pPr, "pBdr") && !find(p, "t") && !find(p, "drawing")) return [{ type: "rule" }];

  const blocks = [];
  const state = { field: null, instr: "", link: null, skip: false };
  const push = (r) => para.runs.push(r);
  const pageBreak = () => {
    blocks.push({ ...para, runs: mergeRuns(para.runs) }, { type: "pageBreak" });
    para.runs = [];
    if (para.props) para.props = { ...para.props };
  };
  const walk = (el, link) => {
    for (const c of el.children) {
      if (typeof c === "string") continue;
      switch (c.local) {
        case "r":
          readRun(c, ctx, link, state, push, pageBreak);
          break;
        case "hyperlink": {
          const rel = ctx.rels.get(attr(c, "id"));
          const anchor = attr(c, "anchor");
          const href = rel?.external ? safeHref(rel.target) : anchor ? `#${anchor}` : null;
          if (href) ctx.counts.links++;
          walk(c, href || link);
          break;
        }
        case "fldSimple": {
          const instr = String(attr(c, "instr") || "").trim();
          const f = fieldKind(instr);
          if (f) push({ type: "field", field: f });
          else {
            const h = /^HYPERLINK\s+"([^"]+)"/i.exec(instr);
            walk(c, h ? safeHref(h[1]) || link : link);
          }
          break;
        }
        case "ins":
        case "smartTag":
        case "customXml":
        case "sdtContent":
          walk(c, link);
          break;
        case "sdt":
          walk(child(c, "sdtContent") || c, link);
          break;
        case "del":
          ctx.report.dropped("Tracked deletions (the text that was deleted is not shown).");
          break;
        case "oMath":
        case "oMathPara":
          push({ text: textOf(c) });
          ctx.report.flattened("Equations were converted to plain text.");
          break;
      }
    }
  };
  walk(p, null);
  para.runs = mergeRuns(para.runs);
  blocks.push(para);
  // a paragraph that only holds a page break becomes just the break
  if (blocks.length > 1) return blocks.filter((b) => b.type !== "paragraph" || b.runs.length);
  return blocks;
}

function fieldKind(instr) {
  const k = instr.trim().split(/\s+/)[0]?.toUpperCase();
  if (k === "PAGE") return "page";
  if (k === "NUMPAGES" || k === "SECTIONPAGES") return "pages";
  if (k === "DATE" || k === "TIME" || k === "CREATEDATE" || k === "SAVEDATE") return "date";
  return null;
}

function readRun(r, ctx, link, state, push, pageBreak) {
  const marks = rPrToMarks(child(r, "rPr"), ctx);
  if (link) marks.link = link;
  const add = (text) => {
    if (state.skip || !text || state.field === "instr") return;
    push({ text, ...marks, ...(!link && state.fieldLink ? { link: state.fieldLink } : {}) });
  };
  for (const c of r.children) {
    if (typeof c === "string") continue;
    switch (c.local) {
      case "t":
        add(textOf(c));
        break;
      case "tab":
      case "ptab":
        add("\t");
        break;
      case "br":
      case "cr":
        if (attr(c, "type") === "page") pageBreak();
        else {
          if (attr(c, "type") === "column") ctx.report.flattened("Column breaks became line breaks.");
          if (!state.skip) push({ type: "break" });
        }
        break;
      case "noBreakHyphen":
        add("‑");
        break;
      case "sym": {
        const ch = parseInt(attr(c, "char") || "", 16);
        if (ch > 0xf000) ctx.report.flattened("Symbol font characters were replaced by bullets.");
        add(ch > 0xf000 ? "•" : Number.isFinite(ch) ? String.fromCodePoint(ch) : "");
        break;
      }
      case "fldChar": {
        const t = attr(c, "fldCharType");
        if (t === "begin") {
          state.field = "instr";
          state.instr = "";
        } else if (t === "separate") {
          const f = fieldKind(state.instr);
          const h = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(state.instr);
          state.fieldLink = h ? safeHref(h[1]) : null;
          if (f) {
            push({ type: "field", field: f });
            state.skip = true;
          }
          state.field = "result";
        } else if (t === "end") {
          state.field = null;
          state.skip = false;
          state.fieldLink = null;
        }
        break;
      }
      case "instrText":
        if (state.field === "instr") state.instr += textOf(c);
        break;
      case "drawing":
      case "pict":
      case "object":
        readDrawing(c, ctx, push);
        break;
      case "AlternateContent": {
        const choice = child(c, "Choice");
        if (choice && find(choice, "blip")) readDrawing(choice, ctx, push);
        else if (choice && find(choice, "txbxContent")) {
          ctx.report.flattened("Text boxes were converted to inline text.");
          const txt = findAll(find(choice, "txbxContent"), "p").map((pp) => findAll(pp, "t").map(textOf).join("")).filter(Boolean).join(" ");
          add(txt ? ` ${txt} ` : "");
        } else if (child(c, "Fallback")) readDrawing(child(c, "Fallback"), ctx, push);
        break;
      }
      case "footnoteReference":
      case "endnoteReference": {
        const id = `${c.local === "footnoteReference" ? "fn" : "en"}${attr(c, "id")}`;
        if (ctx.footnotes[id]) push({ type: "footnote", id });
        break;
      }
    }
  }
}

function readDrawing(el, ctx, push) {
  const blip = find(el, "blip");
  const imagedata = find(el, "imagedata");
  const rid = blip ? attr(blip, "embed") || attr(blip, "link") : imagedata ? attr(imagedata, "id") : null;
  if (!rid) {
    if (find(el, "chart")) ctx.report.dropped("Charts.");
    else if (find(el, "txbxContent")) {
      ctx.report.flattened("Text boxes were converted to inline text.");
      const txt = findAll(find(el, "txbxContent"), "t").map(textOf).join("");
      if (txt) push({ text: ` ${txt} ` });
    } else ctx.report.dropped("Shapes, SmartArt and embedded objects.");
    return;
  }
  // Word 2016+ SVG: prefer the SVG extension over the PNG fallback
  const svgBlip = find(el, "svgBlip");
  const rel = ctx.rels.get((svgBlip && attr(svgBlip, "embed")) || rid);
  if (!rel || rel.external) {
    ctx.report.dropped("Linked (external) images.");
    return;
  }
  const bytes = ctx.entries[rel.target];
  const mime = bytes && sniffImage(bytes, rel.target);
  if (!mime) {
    ctx.report.dropped(`An image in a format Office Studio cannot show (${rel.target.split(".").pop().toUpperCase()}, for example EMF or WMF).`);
    return;
  }
  let id = ctx.mediaByTarget.get(rel.target);
  if (!id) {
    id = `img${Object.keys(ctx.media).length + 1}`;
    const size = imageSize(bytes, mime);
    ctx.media[id] = { id, mime, name: rel.target.split("/").pop(), bytes, ...(size ? { w: size.w, h: size.h } : {}) };
    ctx.mediaByTarget.set(rel.target, id);
  }
  const ext = find(el, "extent");
  let width = Number(attr(ext, "cx")) / EMU;
  let height = Number(attr(ext, "cy")) / EMU;
  if (!(width > 0 && height > 0)) {
    // VML: style="width:100pt;height:50pt"
    const shape = find(el, "shape");
    const style = String(attr(shape, "style") || "");
    width = parseFloat(/width:\s*([\d.]+)pt/.exec(style)?.[1]) || (ctx.media[id].w || 200) * 0.75;
    height = parseFloat(/height:\s*([\d.]+)pt/.exec(style)?.[1]) || (ctx.media[id].h || 150) * 0.75;
  }
  if (find(el, "anchor")) ctx.report.flattened("Floating images were placed inline with the text.");
  const docPr = find(el, "docPr");
  const alt = attr(docPr, "descr") || attr(docPr, "title") || "";
  ctx.counts.images++;
  push({ type: "image", media: id, width, height, ...(alt ? { alt } : {}) });
}

function readTable(tbl, ctx) {
  ctx.counts.tables++;
  const cols = children(child(tbl, "tblGrid"), "gridCol").map((g) => fromTw(attr(g, "w")) || 72);
  const tblPr = child(tbl, "tblPr");
  const tb = child(tblPr, "tblBorders");
  const top = child(tb, "top") || child(tb, "insideH");
  let borders = { style: "single", width: 0.5, color: "#808080" };
  if (tb && top && ["nil", "none"].includes(attr(top, "val"))) borders = { style: "none", width: 0.5, color: "#808080" };
  else if (top) borders = { style: "single", width: Math.max(0.25, Number(attr(top, "sz") || 4) / 8), color: normColor(`#${attr(top, "color") || "808080"}`) || "#808080" };
  else if (!child(tblPr, "tblStyle")) borders = { style: "none", width: 0.5, color: "#808080" };
  const rows = [];
  const active = []; // grid column -> origin cell of a vertical merge
  for (const tr of children(tbl, "tr")) {
    const row = { cells: [] };
    if (find(child(tr, "trPr"), "tblHeader")) row.header = true;
    let col = Number(attr(child(child(tr, "trPr"), "gridBefore"), "val") || 0);
    const tcs = [];
    for (const c of tr.children) {
      if (typeof c === "string") continue;
      if (c.local === "tc") tcs.push(c);
      else if (c.local === "sdt") tcs.push(...findAll(c, "tc"));
    }
    for (const tc of tcs) {
      const tcPr = child(tc, "tcPr");
      const span = Math.max(1, Number(attr(child(tcPr, "gridSpan"), "val") || 1));
      const vm = child(tcPr, "vMerge");
      const vmVal = vm ? attr(vm, "val") || "continue" : null;
      if (vmVal === "continue" && active[col]) {
        active[col].rowspan = (active[col].rowspan || 1) + 1;
        col += span;
        continue;
      }
      const cell = { blocks: readBlocks(tc, ctx, 1).filter((b) => b.type === "paragraph") };
      if (!cell.blocks.length) cell.blocks.push({ type: "paragraph", style: "Normal", runs: [] });
      if (span > 1) cell.colspan = span;
      const fill = attr(child(tcPr, "shd"), "fill");
      if (fill && fill !== "auto") cell.shading = normColor(`#${fill}`);
      const va = attr(child(tcPr, "vAlign"), "val");
      if (va === "center") cell.vAlign = "middle";
      else if (va === "bottom") cell.vAlign = "bottom";
      for (let k = 0; k < span; k++) active[col + k] = vmVal === "restart" ? cell : null;
      if (vmVal === "restart") active[col] = cell;
      row.cells.push(cell);
      col += span;
    }
    rows.push(row);
  }
  if (!rows.length) return null;
  const ncols = Math.max(cols.length, ...rows.map((r) => r.cells.reduce((n, c) => n + (c.colspan || 1), 0)));
  while (cols.length < ncols) cols.push(72);
  return { type: "table", cols, rows, borders };
}
