// Tab-to-studio memory (core/tab-studio.js) and its integration in App (activateDoc / setStudio), docs/studios.md.
import test from "node:test";
import assert from "node:assert/strict";
import { Doc } from "../../app/src/core/doc.js";
import { App } from "../../app/src/core/app.js";
import { hasStudio, registerStudio } from "../../app/src/studios/registry.js";
import { naturalStudio, editableStudios, canEditIn, tabStudio, rememberStudio, studioToFollow, restoreTabStudio } from "../../app/src/core/tab-studio.js";

for (const id of ["vector", "pixel", "layout", "code", "vibe", "office", "scene"]) if (!hasStudio(id)) registerStudio({ id, label: id });

const canvasDoc = (studio = "vector") => new Doc({ name: studio, width: 100, height: 100, studio });
const webDoc = () => Object.assign(new Doc({ name: "site", width: 1280, height: 800, studio: "code" }), { web: { paths: ["index.html"] } });
const officeDoc = (kind = "document") => Object.assign(new Doc({ name: "o", studio: "office" }), { office: { kind } });

test("natural studio follows the document kind", () => {
  assert.equal(naturalStudio(canvasDoc("pixel")), "pixel");
  assert.equal(naturalStudio(canvasDoc("layout")), "layout");
  assert.equal(naturalStudio(canvasDoc("something-else")), "vector");
  assert.equal(naturalStudio(webDoc()), "code");
  assert.equal(naturalStudio(officeDoc()), "office");
  assert.equal(naturalStudio(officeDoc("scene")), "scene");
  assert.equal(naturalStudio(null), null);
});

test("only studios that can edit a document are remembered for its tab", () => {
  const photo = canvasDoc("pixel");
  assert.deepEqual(editableStudios(photo), ["vector", "pixel", "layout"]);
  assert.ok(canEditIn("layout", photo), "an image opens in Pixel or Layout");
  assert.ok(!canEditIn("code", photo), "a photo has no website project");
  assert.ok(!canEditIn("vibe", photo), "Vibe is never remembered");
  assert.ok(canEditIn("code", webDoc()) && canEditIn("vector", webDoc()), "a website project opens in Code or a canvas studio");
  assert.deepEqual(editableStudios(officeDoc()), ["office"]);
  assert.equal(rememberStudio(photo, "code"), false);
  assert.equal(photo.tabStudio, undefined);
  assert.equal(rememberStudio(photo, "layout"), true);
  assert.equal(rememberStudio(photo, "layout"), false, "unchanged");
  assert.equal(tabStudio(photo), "layout");
});

test("a stale or foreign memory falls back to the natural studio", () => {
  const svg = canvasDoc("vector");
  svg.tabStudio = "code"; // e.g. written by an older session
  assert.equal(tabStudio(svg), "vector");
  restoreTabStudio(svg, "nope");
  assert.equal(svg.tabStudio, "code", "unknown values are ignored");
  restoreTabStudio(svg, "pixel");
  assert.equal(svg.tabStudio, "pixel");
});

test("studioToFollow: off, same studio, Vibe and unknown studios stay", () => {
  const d = canvasDoc("pixel");
  assert.equal(studioToFollow({ doc: d, current: "code" }), "pixel");
  assert.equal(studioToFollow({ doc: d, current: "pixel" }), null);
  assert.equal(studioToFollow({ doc: d, current: "code", enabled: false }), null);
  assert.equal(studioToFollow({ doc: d, current: "vibe" }), null, "Vibe Studio works across tabs");
  assert.equal(studioToFollow({ doc: d, current: "code", known: () => false }), null);
  assert.equal(studioToFollow({ doc: null, current: "code" }), null, "start page");
});

test("App: activating a tab switches to the studio it was last used in", async () => {
  const app = new App();
  await app.tabStudioReady;
  app.prefs.studioFollowsTab = true;
  const site = webDoc();
  const photo = canvasDoc("pixel");
  app.setStudio("code");
  app.openDoc(site);
  assert.equal(app.studio, "code");
  app.setStudio("pixel"); // programmatic, as file openers do before openDoc: must not touch the site's memory
  app.openDoc(photo);
  assert.equal(app.studio, "pixel");
  assert.equal(site.tabStudio, undefined);
  const seen = [];
  app.on("studio", (id) => seen.push([id, app.doc === site]));
  app.activateDoc(site);
  assert.equal(app.studio, "code", "back to the landing page: Code studio");
  assert.deepEqual(seen, [["code", true]], "one studio event, already with the new document");
  app.activateDoc(photo);
  assert.equal(app.studio, "pixel");
});

test("App: a studio chosen by hand is remembered when it can edit the tab", async () => {
  const app = new App();
  await app.tabStudioReady;
  app.prefs.studioFollowsTab = true;
  const photo = canvasDoc("pixel");
  const site = webDoc();
  app.openDoc(photo);
  app.openDoc(site);
  app.activateDoc(photo);
  assert.equal(app.studio, "pixel");
  app.setStudio("layout", { user: true });
  assert.equal(photo.tabStudio, "layout");
  app.setStudio("code", { user: true }); // the Code studio cannot edit a photo: the memory stays
  assert.equal(photo.tabStudio, "layout");
  app.activateDoc(site);
  assert.equal(app.studio, "code");
  app.activateDoc(photo);
  assert.equal(app.studio, "layout");
  app.setStudio("vibe", { user: true });
  app.activateDoc(site);
  assert.equal(app.studio, "vibe", "Vibe Studio stays while tabs change");
});

test("App: setting off, temporary activations and closing tabs", async () => {
  const app = new App();
  await app.tabStudioReady;
  const a = canvasDoc("pixel");
  const b = webDoc();
  app.openDoc(a);
  app.openDoc(b);
  assert.equal(app.studio, "code");
  app.activateDoc(a, { followStudio: false });
  assert.equal(app.studio, "code", "Save All visits tabs without switching");
  app.activateDoc(b, { followStudio: false });
  app.prefs.studioFollowsTab = false;
  app.activateDoc(a);
  assert.equal(app.studio, "code", "setting off");
  app.prefs.studioFollowsTab = true;
  app.activateDoc(b);
  app.closeDoc(b); // the last Code tab: the neighbor's studio comes back
  assert.equal(app.doc, a);
  assert.equal(app.studio, "pixel");
  app.closeDoc(a); // last tab: the studio stays for the start page
  assert.equal(app.doc, null);
  assert.equal(app.studio, "pixel");
  assert.equal(app.docStudio(null), null);
});
