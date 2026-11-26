// proto_write_html (task T8): HTML → design as one undo step through the assistant's tool, in Node (static path).
import test from "node:test";
import assert from "node:assert/strict";
import { Doc } from "../../../app/src/core/doc.js";
import { OfficeProject } from "../../../app/src/core/office.js";
import { starterModel } from "../../../app/src/proto/host.js";
import { validate } from "../../../app/src/engine/proto/validate.js";
import { createOpenFiniTools, TOOL_GROUPS } from "../../../app/src/vibe/tools/index.js";
import { TOOLSETS } from "../../../app/src/vibe/agents.js";

function protoApp() {
  const doc = new Doc({ name: "Design", studio: "proto", width: 1440, height: 1024, pages: 1 });
  doc.office = new OfficeProject(starterModel({ starter: "phone", title: "Design" }), "proto");
  doc.history.clear();
  const app = { doc, docs: [doc], prefs: { labsProto: true }, studio: "proto", protoUI: null, on() {}, emit() {}, toast() {} };
  const tools = new Map(createOpenFiniTools(app, {}).map((t) => [t.name, t]));
  return { doc, model: () => app.doc.office.model, run: (name, args = {}) => tools.get(name).run(args, {}) };
}

test("proto_write_html builds auto layout from HTML in one undo step, inside a frame or on the page", async () => {
  assert.ok(TOOL_GROUPS.Proto.includes("proto_write_html"));
  assert.ok(TOOLSETS.proto.includes("proto_write_html"));
  const { doc, model, run } = protoApp();
  await run("proto_describe");
  const frame = Object.values(model().nodes).find((n) => n.type === "frame" && n.parent == null);
  const steps = doc.history.entries.length;
  const html = `<style>.bar{display:flex;gap:12px;padding:16px;background:#111827;color:#fff;align-items:center}.bar b{font-size:20px}</style>
    <div class="bar"><b>Brand</b><span style="flex:1"></span><a>Docs</a><a>Blog</a></div><script>alert(1)</script>`;
  const r = await run("proto_write_html", { html, parent: frame.id });
  assert.equal(r.ok, true);
  assert.equal(r.exact, false, "Node uses the static path");
  assert.equal(doc.history.entries.length, steps + 1, "one undo step");
  assert.match(doc.history.entries.at(-1).label, /^Vibe: Write HTML/);
  const m = model();
  assert.deepEqual(validate(m).errors, []);
  const root = m.nodes[r.roots[0]];
  assert.equal(root.parent, frame.id);
  const bar = Object.values(m.nodes).find((n) => n.name === "Bar");
  assert.deepEqual([bar.layout.type, bar.layout.dir, bar.layout.gap, bar.fills[0].color], ["flex", "row", 12, "#111827"]);
  assert.ok(r.report.items.some((i) => /Scripts/.test(i.text)));
  // on the page, to the right of the existing frames
  const r2 = await run("proto_write_html", { html: "<p>Hello</p>" });
  assert.equal(model().nodes[r2.roots[0]].parent, null);
  assert.ok(model().nodes[r2.roots[0]].x > frame.x);
  await assert.rejects(run("proto_write_html", { html: "<p>x</p>", parent: "nope" }), /no layer/);
});
