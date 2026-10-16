import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8 } from '../../app/vendor/fflate/fflate.js';
import { readIdml, parseXml, sniffFormat, writePsd } from '../../app/src/engine/formats/index.js';

// ---------------------------------------------------------------------------------------------------------------
// XML parser
// ---------------------------------------------------------------------------------------------------------------

test('parseXml: elements, attributes, entities, CDATA, comments, namespaces', () => {
  const root = parseXml(`﻿<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE doc [ <!ENTITY x "y>z"> ]>
<!-- header comment -->
<idPkg:Doc xmlns:idPkg="http://ns" a='single "quoted"' b="a &amp; b &lt;c&gt; &#65;&#x42; &quot;q&quot; &apos;s&apos; &bogus; &#xD800;" flag>
  <Child Self="c1"/><Child Self = "c2" >text &amp; more<![CDATA[ <raw> & ]]></Child>
  <!-- <Ignored/> -->
  <?pi something ?>
  <Deep><A><B x="1"/></A></Deep>
</idPkg:Doc>`);
  assert.equal(root.name, 'idPkg:Doc');
  assert.equal(root.local, 'Doc');
  assert.equal(root.attrs['xmlns:idPkg'], 'http://ns');
  assert.equal(root.attrs.a, 'single "quoted"');
  assert.equal(root.attrs.b, 'a & b <c> AB "q" \'s\' &bogus; &#xD800;');
  assert.equal(root.attrs.flag, '');
  assert.equal(root.children.length, 3);
  assert.equal(root.children[0].attrs.Self, 'c1');
  assert.equal(root.children[1].attrs.Self, 'c2');
  assert.equal(root.children[1].text, 'text & more <raw> & ');
  assert.equal(root.children[2].children[0].children[0].attrs.x, '1');
});

test('parseXml: tolerant of damage', () => {
  // unclosed tags are closed at the end
  let r = parseXml('<a><b><c x="1">');
  assert.equal(r.children[0].children[0].attrs.x, '1');
  // stray close tag ignored, mismatched close pops to the matching ancestor
  r = parseXml('<a><b></zzz><c/></b><d></a>');
  assert.deepEqual(r.children.map((c) => c.name), ['b', 'd']);
  assert.deepEqual(r.children[0].children.map((c) => c.name), ['c']);
  // lone '<' in text, unquoted attribute, truncated attribute
  r = parseXml('<a x=1 y=two>1 < 2</a>');
  assert.equal(r.attrs.x, '1');
  assert.equal(r.attrs.y, 'two');
  assert.equal(r.text, '1 < 2');
  r = parseXml('<a x="never closed');
  assert.equal(r.name, 'a');
  // duplicate attribute keeps first, whitespace in text preserved
  r = parseXml('<a k="1" k="2"> </a>');
  assert.equal(r.attrs.k, '1');
  assert.equal(r.text, ' ');
});

test('parseXml: errors and limits', () => {
  assert.throws(() => parseXml('just text'), /no root element/);
  assert.throws(() => parseXml(''), Error);
  assert.throws(() => parseXml('<a>'.repeat(2000)), /too deep/);
  assert.throws(() => parseXml(null), Error);
  // pathological garbage terminates
  const rand = '<<<>>>"\'=/ <a <b = "'.repeat(2000);
  const t0 = Date.now();
  try { parseXml('<r>' + rand); } catch (e) { assert.ok(e instanceof Error); }
  assert.ok(Date.now() - t0 < 1000);
});

// ---------------------------------------------------------------------------------------------------------------
// IDML package
// ---------------------------------------------------------------------------------------------------------------

const rectPath = (w, h) => `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
  <PathPointType Anchor="0 0" LeftDirection="0 0" RightDirection="0 0"/>
  <PathPointType Anchor="${w} 0" LeftDirection="${w} 0" RightDirection="${w} 0"/>
  <PathPointType Anchor="${w} ${h}" LeftDirection="${w} ${h}" RightDirection="${w} ${h}"/>
  <PathPointType Anchor="0 ${h}" LeftDirection="0 ${h}" RightDirection="0 ${h}"/>
  </PathPointArray></GeometryPathType></PathGeometry></Properties>`;

const designmap = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0" Self="d">
  <idPkg:Graphic src="Resources/Graphic.xml"/>
  <idPkg:Styles src="Resources/Styles.xml"/>
  <idPkg:Preferences src="Resources/Preferences.xml"/>
  <idPkg:MasterSpread src="MasterSpreads/MasterSpread_m.xml"/>
  <idPkg:Spread src="Spreads/Spread_s1.xml"/>
  <idPkg:Story src="Stories/Story_u1.xml"/>
</Document>`;

const graphic = `<idPkg:Graphic xmlns:idPkg="x" DOMVersion="8.0">
  <Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/>
  <Color Self="Color/Red" Model="Process" Space="RGB" ColorValue="255 0 0" Name="Red"/>
  <Color Self="Color/C=100 M=0 Y=0 K=0" Model="Process" Space="CMYK" ColorValue="100 0 0 0" Name="C=100 M=0 Y=0 K=0"/>
  <Color Self="Color/Gray" Space="LAB" ColorValue="100 0 0" Name="Gray"/>
  <Color Self="Color/Broken" Space="RGB" ColorValue="nope" Name="Broken"/>
  <Tint Self="Tint/x" BaseColor="Color/Red" TintValue="50"/>
  <Swatch Self="Swatch/None" Name="None"/>
  <Gradient Self="Gradient/g1" Type="Linear"><GradientStop StopColor="Color/Red" Location="0"/><GradientStop StopColor="Color/Black" Location="100"/></Gradient>
</idPkg:Graphic>`;

const styles = `<idPkg:Styles xmlns:idPkg="x">
 <RootCharacterStyleGroup Self="rc"><CharacterStyle Self="CharacterStyle/Emph" FontStyle="Italic"><Properties><BasedOn type="string">$ID/[No character style]</BasedOn></Properties></CharacterStyle></RootCharacterStyleGroup>
 <RootParagraphStyleGroup Self="rp">
  <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" PointSize="12" FontStyle="Regular" FillColor="Color/Black" Justification="LeftAlign">
    <Properties><AppliedFont type="string">Arial</AppliedFont></Properties></ParagraphStyle>
  <ParagraphStyle Self="ParagraphStyle/Center" Name="Center" Justification="CenterAlign" PointSize="18">
    <Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn></Properties></ParagraphStyle>
 </RootParagraphStyleGroup>
</idPkg:Styles>`;

const oval = `<Oval Self="o1" FillColor="Color/Red" StrokeColor="Swatch/None" ItemTransform="1 0 0 1 -50 -20">
 <Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
  <PathPointType Anchor="20 0" LeftDirection="20 -5.5" RightDirection="20 5.5"/>
  <PathPointType Anchor="0 20" LeftDirection="5.5 20" RightDirection="-5.5 20"/>
  <PathPointType Anchor="-20 0" LeftDirection="-20 5.5" RightDirection="-20 -5.5"/>
  <PathPointType Anchor="0 -20" LeftDirection="-5.5 -20" RightDirection="5.5 -20"/>
 </PathPointArray></GeometryPathType></PathGeometry></Properties></Oval>`;

const spread = `<idPkg:Spread xmlns:idPkg="x" DOMVersion="8.0">
 <Spread Self="s1" PageCount="2" ItemTransform="1 0 0 1 0 0">
  <Page Self="p1" Name="1" GeometricBounds="0 0 200 100" ItemTransform="1 0 0 1 -100 -100"/>
  <Page Self="p2" Name="2" GeometricBounds="0 0 200 100" ItemTransform="1 0 0 1 0 -100"/>
  <Rectangle Self="r1" FillColor="Color/Red" StrokeColor="Color/C=100 M=0 Y=0 K=0" StrokeWeight="2" ItemTransform="1 0 0 1 -90 -80">
    <TransparencySetting><BlendingSetting Opacity="50"/></TransparencySetting>
    ${rectPath(50, 30)}</Rectangle>
  <Rectangle Self="r2" FillColor="Color/Gray" ItemTransform="0 1 -1 0 60 -20">${rectPath(40, 20)}</Rectangle>
  ${oval}
  <Polygon Self="poly" FillColor="Gradient/g1" ItemTransform="2 0 0 2 -90 -40"><Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
    <PathPointType Anchor="0 0" LeftDirection="0 0" RightDirection="0 0"/>
    <PathPointType Anchor="10 0" LeftDirection="10 0" RightDirection="10 0"/>
    <PathPointType Anchor="5 8" LeftDirection="4 8" RightDirection="6 8"/>
  </PathPointArray></GeometryPathType></PathGeometry></Properties></Polygon>
  <GraphicLine Self="ln" StrokeColor="Color/Black" StrokeWeight="0.5" ItemTransform="1 0 0 1 -90 -10"><Properties><PathGeometry><GeometryPathType PathOpen="true"><PathPointArray>
    <PathPointType Anchor="0 0" LeftDirection="0 0" RightDirection="0 0"/>
    <PathPointType Anchor="30 10" LeftDirection="30 10" RightDirection="30 10"/>
  </PathPointArray></GeometryPathType></PathGeometry></Properties></GraphicLine>
  <Group Self="grp" ItemTransform="1 0 0 1 10 10">
    <Rectangle Self="gr" FillColor="Color/Black" ItemTransform="1 0 0 1 -105 -85">${rectPath(10, 10)}</Rectangle>
  </Group>
  <TextFrame Self="tf1" ParentStory="u1" PreviousTextFrame="n" NextTextFrame="tf2" ItemTransform="1 0 0 1 -80 20">${rectPath(60, 40)}</TextFrame>
  <TextFrame Self="tf2" ParentStory="u1" PreviousTextFrame="tf1" NextTextFrame="n" ItemTransform="1 0 0 1 10 20">${rectPath(60, 40)}</TextFrame>
  <Rectangle Self="img" ItemTransform="1 0 0 1 20 30">${rectPath(30, 30)}<Image Self="im"><Link Self="lk" LinkResourceURI="file:///pics/a.jpg"/></Image></Rectangle>
  <Rectangle Self="away" ItemTransform="1 0 0 1 900 900">${rectPath(5, 5)}</Rectangle>
  <Button Self="btn"/>
 </Spread>
</idPkg:Spread>`;

const story = `<idPkg:Story xmlns:idPkg="x"><Story Self="u1" AppliedTOCStyle="n">
 <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Center">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" FontStyle="Bold" FillColor="Color/Red"><Content>Hello </Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Emph" PointSize="20"><Content>World</Content><Br/></CharacterStyleRange>
 </ParagraphStyleRange>
 <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
  <CharacterStyleRange><Content>Second &amp; last</Content></CharacterStyleRange>
 </ParagraphStyleRange>
</Story></idPkg:Story>`;

function packageEntries(over = {}) {
  return {
    mimetype: strToU8('application/vnd.adobe.indesign-idml-package'),
    'designmap.xml': strToU8(designmap),
    'Resources/Graphic.xml': strToU8(graphic),
    'Resources/Styles.xml': strToU8(styles),
    'Spreads/Spread_s1.xml': strToU8(spread),
    'Stories/Story_u1.xml': strToU8(story),
    ...over,
  };
}


test('readIdml: pages, spread positions and colors', () => {
  const zip = zipSync(packageEntries());
  const doc = readIdml(unzipSync(zip), { name: 'demo' });
  assert.equal(doc.name, 'demo');
  assert.equal(doc.pages.length, 2);
  const [p1, p2] = doc.pages;
  assert.deepEqual([p1.name, p1.width, p1.height, p1.x, p1.y], ['1', 100, 200, 0, 0]);
  assert.deepEqual([p2.name, p2.width, p2.height, p2.x, p2.y], ['2', 100, 200, 100, 0]);
  assert.equal(doc.colors.Red, '#ff0000');
  assert.equal(doc.colors.Black, '#000000');
  assert.equal(doc.colors['C=100 M=0 Y=0 K=0'], '#00ffff');
  assert.equal(doc.colors.Gray, '#ffffff');
  assert.equal(doc.colors.Broken, undefined);
  assert.ok(doc.warnings.some((w) => /Broken/.test(w)));
  assert.ok(doc.warnings.some((w) => /Master spreads/.test(w)));
  assert.ok(doc.warnings.some((w) => /pasteboard/.test(w)));
  assert.ok(doc.warnings.some((w) => /'Button'/.test(w)));
});

test('readIdml: shapes, transforms, fills, strokes, opacity, groups, images', () => {
  const doc = readIdml(unzipSync(zipSync(packageEntries())));
  const [p1, p2] = doc.pages;
  const kinds = (p) => p.items.map((i) => i.kind);
  assert.deepEqual(kinds(p1), ['rect', 'ellipse', 'polygon', 'line', 'group', 'text']);
  assert.deepEqual(kinds(p2), ['rect', 'text', 'image']);

  const r1 = p1.items[0];
  assert.deepEqual([r1.x, r1.y, r1.width, r1.height], [10, 20, 50, 30]);
  assert.equal(r1.fill, '#ff0000');
  assert.equal(r1.stroke, '#00ffff');
  assert.equal(r1.strokeWidth, 2);
  assert.equal(r1.opacity, 0.5);
  assert.equal(r1.rotation, undefined);

  // 90 degree rotation about the box center on page 2
  const r2 = p2.items[0];
  assert.deepEqual([r2.x, r2.y, r2.width, r2.height], [30, 90, 40, 20]);
  assert.equal(r2.rotation, 90);
  assert.equal(r2.fill, '#ffffff');

  const el = p1.items[1];
  assert.equal(el.fill, '#ff0000');
  assert.equal(el.stroke, null);
  // oval anchors span (-20..20) around local origin, translated by (-50,-20) in spread, page origin (-100,-100)
  assert.deepEqual([el.x, el.y, el.width, el.height], [30, 60, 40, 40]);

  const poly = p1.items[2];
  assert.equal(poly.fill, '#ff0000'); // first gradient stop
  const pts = poly.path[0].points;
  assert.equal(poly.path[0].closed, true);
  assert.deepEqual(pts[0], [10, 60]);
  assert.deepEqual(pts[1], [30, 60]);
  assert.deepEqual(pts[2], { x: 20, y: 76, hx1: 18, hy1: 76, hx2: 22, hy2: 76 });
  assert.deepEqual([poly.x, poly.y, poly.width, poly.height], [10, 60, 20, 16]);

  const line = p1.items[3];
  assert.equal(line.path[0].closed, false);
  assert.deepEqual(line.path[0].points, [[10, 90], [40, 100]]);
  assert.equal(line.stroke, '#000000');
  assert.equal(line.strokeWidth, 0.5);
  assert.equal(line.fill, null);

  const grp = p1.items[4];
  assert.equal(grp.children.length, 1);
  // group (10,10) + child (-105,-85) -> spread (-95,-75) -> page (5,25)
  assert.deepEqual([grp.children[0].x, grp.children[0].y], [5, 25]);
  assert.deepEqual([grp.x, grp.y, grp.width, grp.height], [5, 25, 10, 10]);

  const img = p2.items[2];
  assert.equal(img.link, 'file:///pics/a.jpg');
  assert.deepEqual([img.x, img.y, img.width, img.height], [20, 130, 30, 30]);
});

test('readIdml: stories, styles, linked frames', () => {
  const doc = readIdml(unzipSync(zipSync(packageEntries())));
  const [p1, p2] = doc.pages;
  const tf1 = p1.items[5];
  const tf2 = p2.items[1];
  assert.equal(tf1.kind, 'text');
  assert.deepEqual(tf2.text.paragraphs, []);
  const paras = tf1.text.paragraphs;
  assert.equal(paras.length, 2);
  assert.equal(paras[0].align, 'center');
  assert.deepEqual(paras[0].runs[0], { text: 'Hello ', fontFamily: 'Arial', fontSize: 18, fontWeight: 700, fontStyle: 'normal', color: '#ff0000' });
  assert.deepEqual(paras[0].runs[1], { text: 'World', fontFamily: 'Arial', fontSize: 20, fontWeight: 400, fontStyle: 'italic', color: '#000000' });
  assert.equal(paras[1].align, 'left');
  assert.equal(paras[1].runs[0].text, 'Second & last');
  assert.equal(paras[1].runs[0].fontSize, 12);
  assert.ok(doc.warnings.some((w) => /linked frames/.test(w)));
  // frame positions on their pages
  assert.deepEqual([tf1.x, tf1.y, tf1.width, tf1.height], [20, 120, 60, 40]);
  assert.deepEqual([tf2.x, tf2.y], [10, 120]);
});

test('readIdml: accepts a zip, reports errors and missing parts', () => {
  const zip = zipSync(packageEntries());
  assert.equal(readIdml(zip).pages.length, 2);
  assert.throws(() => readIdml({ 'foo.xml': new Uint8Array(1) }), /designmap\.xml/);
  assert.throws(() => readIdml({ 'designmap.xml': strToU8('not xml') }), /valid XML/);
  assert.throws(() => readIdml(null), Error);
  const e = packageEntries();
  delete e['Spreads/Spread_s1.xml'];
  delete e['Resources/Graphic.xml'];
  const doc = readIdml(e);
  assert.equal(doc.pages.length, 0);
  assert.ok(doc.warnings.some((w) => /Spread_s1\.xml/.test(w)));
  assert.equal(doc.colors.Black, undefined);
  // damaged story keeps the rest working
  const broken = readIdml(packageEntries({ 'Stories/Story_u1.xml': strToU8('plain') }));
  assert.equal(broken.pages.length, 2);
  assert.ok(broken.warnings.some((w) => /Story/.test(w)));
});

test('readIdml: non-rectangular rectangle becomes polygon, open oval too', () => {
  const sp = `<idPkg:Spread xmlns:idPkg="x"><Spread Self="s"><Page Self="p" GeometricBounds="0 0 100 100" ItemTransform="1 0 0 1 0 0"/>
   <Rectangle Self="a"><Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
    <PathPointType Anchor="0 0" LeftDirection="0 0" RightDirection="0 0"/><PathPointType Anchor="10 0" LeftDirection="10 0" RightDirection="10 0"/>
    <PathPointType Anchor="10 10" LeftDirection="10 10" RightDirection="10 10"/><PathPointType Anchor="5 20" LeftDirection="5 20" RightDirection="5 20"/>
    <PathPointType Anchor="0 10" LeftDirection="0 10" RightDirection="0 10"/></PathPointArray></GeometryPathType></PathGeometry></Properties></Rectangle>
  </Spread></idPkg:Spread>`;
  const doc = readIdml({
    'designmap.xml': strToU8('<Document xmlns:idPkg="x"><idPkg:Spread src="Spreads/S.xml"/></Document>'),
    'Spreads/S.xml': strToU8(sp),
  });
  assert.equal(doc.pages[0].items[0].kind, 'polygon');
  assert.equal(doc.pages[0].items[0].path[0].points.length, 5);
  assert.equal(doc.pages[0].items[0].fill, null);
});

// ---------------------------------------------------------------------------------------------------------------
// sniffFormat
// ---------------------------------------------------------------------------------------------------------------

test('sniffFormat', () => {
  const psd = writePsd({ width: 1, height: 1, layers: [] });
  assert.equal(sniffFormat(psd, 'x.bin'), 'psd');
  const psb = psd.slice();
  psb[5] = 2;
  assert.equal(sniffFormat(psb), 'psb');
  const idml = zipSync(packageEntries());
  assert.equal(sniffFormat(idml, 'a.zip'), 'idml');
  assert.equal(sniffFormat(idml, 'a.idml'), 'idml');
  const plainZip = zipSync({ 'hello.txt': strToU8('hi') });
  assert.equal(sniffFormat(plainZip, 'a.zip'), 'unknown');
  assert.equal(sniffFormat(plainZip, 'a.idml'), 'idml');
  assert.equal(sniffFormat(zipSync({ 'designmap.xml': strToU8('<Document/>') }), ''), 'idml');
  assert.equal(sniffFormat(strToU8('%PDF-1.5\n1 0 obj'), 'a.pdf'), 'pdf');
  assert.equal(sniffFormat(strToU8('%PDF-1.5\n1 0 obj'), 'logo.ai'), 'ai');
  assert.equal(sniffFormat(strToU8('%PDF-1.6\n<</Creator (Adobe Illustrator 27)>>'), 'x'), 'ai');
  assert.equal(sniffFormat(strToU8('%!PS-Adobe-3.0 %%Creator: Adobe Illustrator(R) 8.0'), 'x.ai'), 'ai');
  assert.equal(sniffFormat(strToU8('%!PS-Adobe-3.0 EPSF-3.0'), 'x.eps'), 'unknown');
  const indd = new Uint8Array(32);
  indd.set([0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5, 0xbd, 0x31, 0xef, 0xe7, 0xfe, 0x74, 0xb7, 0x1d]);
  assert.equal(sniffFormat(indd, 'doc.indd'), 'indd');
  assert.equal(sniffFormat(indd, ''), 'indd');
  assert.equal(sniffFormat(new Uint8Array([1, 2, 3, 4, 5]), 'a.afdesign'), 'afdesign');
  assert.equal(sniffFormat(new Uint8Array([1, 2, 3, 4, 5]), 'A.AFPHOTO'), 'afphoto');
  assert.equal(sniffFormat(new Uint8Array([1, 2, 3, 4, 5]), 'a.afpub'), 'afpub');
  assert.equal(sniffFormat(strToU8('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'), 'x'), 'svg');
  assert.equal(sniffFormat(strToU8('<svg width="1"/>'), 'x.svg'), 'svg');
  assert.equal(sniffFormat(new Uint8Array(0), ''), 'unknown');
  assert.equal(sniffFormat(new Uint8Array([0, 1, 2]), 'x.png'), 'unknown');
});

test('fuzz: damaged IDML packages only ever throw Error', () => {
  let s = 12345;
  const rand = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const base = packageEntries();
  const t0 = Date.now();
  for (const key of Object.keys(base)) {
    const src = base[key];
    const variants = [];
    for (let n = 0; n < src.length; n += Math.max(1, Math.floor(src.length / 40))) variants.push(src.subarray(0, n));
    for (let k = 0; k < 40; k++) {
      const c = src.slice();
      for (let f = 0; f < 4; f++) c[Math.floor(rand() * c.length)] = Math.floor(rand() * 256);
      variants.push(c);
    }
    for (const v of variants) {
      try {
        const doc = readIdml({ ...base, [key]: v });
        assert.ok(Array.isArray(doc.pages));
      } catch (e) {
        assert.ok(e instanceof Error, 'must be an Error: ' + e);
      }
    }
  }
  assert.ok(Date.now() - t0 < 3000);
});
