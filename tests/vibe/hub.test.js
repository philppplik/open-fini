// Engine-level tests: real VibeHub + VibeSession + tools + the offline Demo provider against real Doc objects.
import test from "node:test";
import assert from "node:assert/strict";
import { VibeHub } from "../../app/src/vibe/hub.js";
import { vibeStore } from "../../app/src/vibe/store.js";
import { fakeApp, layers } from "./helpers.js";

const toolCalls = (s) => s.chat.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_use");
const results = (s) => s.chat.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");

test("two chats run at the same time on one document; edits are serialized and undo is per run", async () => {
  const app = fakeApp();
  const hub = new VibeHub(app);
  const a = hub.active;
  const b = hub.create();
  const order = [];
  hub.lock.on(({ holder }) => holder && order.push(holder.owner));
  await Promise.all([a.send("draw a blue rectangle"), b.send('add a headline "Hello"')]);
  const kinds = layers(app).map((n) => n.type).sort();
  assert.ok(kinds.includes("rect"), "chat A drew its rectangle");
  assert.ok(kinds.includes("text"), "chat B added its text");
  assert.ok(order.includes(a.id) && order.includes(b.id), "both chats went through the write lock");
  assert.equal(a.runs.length, 1);
  assert.equal(b.runs.length, 1);
  const h = app.doc.history;
  const top = h.entries[h.index - 1].tag.chat;
  const [first, second] = top === a.id ? [a, b] : [b, a];
  // the older run is blocked by the newer one of the other chat
  assert.equal(second.undoLastRun(), 0);
  assert.match(second.lastUndoError, /Another chat/);
  assert.ok(first.undoLastRun() >= 1);
  assert.ok(second.undoLastRun() >= 1);
  assert.equal(layers(app).length, 0, "both runs undone");
});

test("background approvals queue in the session and never block other chats", async () => {
  const app = fakeApp();
  const hub = new VibeHub(app);
  const a = hub.active;
  a.setOverrides({ approval: "careful" });
  const asked = [];
  a.on("approval", (r) => asked.push(r));
  const run = a.send("draw a blue rectangle");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(a.status, "approval");
  assert.equal(hub.statusOf(a.chat.id).pending, 1);
  const b = hub.create();
  await b.send("hello");
  assert.equal(b.status, "done", "another chat finished while A waits for approval");
  asked[0].resolve(true);
  await run;
  assert.equal(a.status, "done");
  assert.ok(layers(app).some((n) => n.type === "rect"));
});

test("the chat limit, the kill switch and the view's replay", async () => {
  const app = fakeApp();
  const hub = new VibeHub(app);
  hub.demoDelay = 15;
  const old = vibeStore.settings.maxChats;
  vibeStore.settings.maxChats = 1;
  try {
    const a = hub.active;
    const run = a.send("draw a blue rectangle and a circle");
    await new Promise((r) => setTimeout(r, 40));
    const b = hub.create();
    await assert.rejects(b.send("hi"), /already running \(limit 1/);
    // switching the view to the running chat replays its live events
    const seen = [];
    hub.activate(b.id);
    hub.view.on("event", (ev) => seen.push(ev.type));
    hub.activate(a.id);
    assert.ok(seen.length > 0, "live events were replayed");
    assert.equal(hub.stopAll(), 1);
    await run;
    assert.equal(a.running, false);
    assert.equal(hub.running.length, 0);
  } finally {
    vibeStore.settings.maxChats = old;
  }
});

test("a brand kit with three sub-agents: parallel children, structured results, one undoable run", async () => {
  const app = fakeApp({ doc: false });
  const hub = new VibeHub(app);
  const s = hub.active;
  const statuses = [];
  s.on("event", (ev) => ev.type === "agent_status" && statuses.push(`${ev.agent.role}:${ev.agent.status}`));
  await s.send("build a brand kit with three agents");
  const names = toolCalls(s).map((c) => c.name);
  assert.deepEqual(names.filter((n) => n === "spawn_agent").length, 3);
  assert.ok(names.includes("wait_agent"));
  const wait = results(s).find((r) => /"results"/.test(typeof r.content === "string" ? r.content : ""));
  const parsed = JSON.parse(wait.content);
  assert.deepEqual(parsed.results.map((r) => r.status), ["done", "done", "done"]);
  assert.ok(parsed.results.every((r) => r.artifacts.layers.length >= 1), "each agent reports the layer it made");
  for (const role of ["palette", "mark", "type"]) assert.ok(statuses.includes(`${role}:done`), role);
  const kinds = layers(app).map((n) => n.type).sort();
  assert.deepEqual(kinds, ["ellipse", "rect", "text"]);
  assert.equal(s.runs.length, 1);
  assert.equal(s.undoLastRun(), 3, "the parent run undoes the children's edits too");
});

test("run_plan through the session: refs, one approval list, one undo step", async () => {
  const app = fakeApp();
  const hub = new VibeHub(app);
  const s = hub.active;
  const tools = await s.toolList();
  const plan = tools.find((t) => t.name === "run_plan");
  s.runId = "r-test";
  const res = await plan.run({ label: "Cards", steps: [{ id: "bg", tool: "add_shape", args: { type: "rect", w: 100, h: 50, name: "Bg" } }, { tool: "set_style", args: { ids: [{ $ref: "bg.id" }], opacity: 0.5 } }, { tool: "nope", args: {} }, { tool: "add_shape", args: { type: "ellipse" } }] });
  assert.equal(res.completed, 2);
  assert.match(res.steps[2].error, /Unknown tool “nope”/);
  assert.equal(res.of, 4, "stopped at the first error");
  const h = app.doc.history;
  assert.equal(h.index, 1, "both edits are one history step");
  assert.equal(h.entries[0].label, "Cards");
  assert.equal(h.entries[0].tag.run, "r-test");
  assert.equal(layers(app)[0].opacity, 0.5);
  // approval text lists the steps when any step needs approval
  s.setOverrides({ approval: "careful" });
  const careful = (await s.toolList()).find((t) => t.name === "run_plan");
  assert.match(careful.needsApproval({ steps: [{ tool: "add_shape" }, { tool: "list_layers" }] }), /plan of 2 steps[\s\S]*1\. add_shape\n2\. list_layers/);
});

test("query_layers, apply_to_many and describe_page via the demo prompt", async () => {
  const app = fakeApp();
  const hub = new VibeHub(app);
  const s = hub.active;
  await s.send("draw a red rectangle and a circle");
  await s.send("query the rectangles and recolor them");
  const q = results(s).find((r) => /"total"/.test(String(r.content)));
  assert.equal(JSON.parse(q.content).total, 1);
  const rect = layers(app).find((n) => n.type === "rect");
  assert.equal(rect.fill.color, "#4f46e5");
  const d = results(s).find((r) => /"scene"/.test(String(r.content)));
  const desc = JSON.parse(d.content);
  assert.match(desc.summary, /1 rect, 1 ellipse|1 ellipse, 1 rect/);
  assert.match(desc.scene, /rect "Rectangle"/);
  const describe = (await s.toolList()).find((t) => t.name === "describe_page");
  assert.deepEqual(Object.keys(await describe.run({ since: desc.revision })), ["unchanged", "revision", "note"]);
});

test("skills: arguments reach the model and enforce-tools restricts the chat", async () => {
  const app = fakeApp();
  const hub = new VibeHub(app);
  const old = vibeStore.skills;
  vibeStore.skills = [{ name: "tiny", description: "Only adds text to a page, nothing else at all.", allowedTools: ["add_text"], body: "Write {{word}}.\n\n## Verify\nscreenshot", meta: { "enforce-tools": "true", params: ["word: The word"] }, enabled: true }];
  try {
    const s = hub.active;
    await s.send('Use the “tiny” skill with args {"word":"Hi"}. draw a blue rectangle');
    const r = results(s);
    const skillText = r.find((x) => /Write Hi\./.test(String(x.content)));
    assert.ok(skillText, "the parameter was substituted");
    const blocked = r.find((x) => x.isError && /not allowed while the active skill restricts tools/.test(String(x.content)));
    assert.ok(blocked, "add_shape was blocked by the skill");
    assert.equal(layers(app).filter((n) => n.type === "rect").length, 0);
    await s.send("draw a blue rectangle");
    assert.equal(layers(app).filter((n) => n.type === "rect").length, 1, "the restriction ends with the request");
    const missing = await s.send("Use the “tiny” skill.");
    void missing;
    assert.ok(results(s).some((x) => x.isError && /needs arguments: word/.test(String(x.content))));
  } finally {
    vibeStore.skills = old;
  }
});

test("attachments are listed and offered to the model", async () => {
  const app = fakeApp();
  let opened = null;
  app.openFile = async (f) => (opened = f) && null;
  const hub = new VibeHub(app);
  const s = hub.active;
  const file = { name: "notes.md", type: "text/markdown", size: 5, text: async () => "# Hi", arrayBuffer: async () => new TextEncoder().encode("# Hi").buffer };
  await s.send("hello", [file]);
  const tools = await s.toolList();
  const list = await tools.find((t) => t.name === "list_attachments").run({});
  assert.deepEqual(list.attachments.map((a) => [a.name, a.studio, a.opened]), [["notes.md", "code", false]]);
  const r = await tools.find((t) => t.name === "open_attachment").run({ name: "notes" });
  assert.equal(opened.name, "notes.md");
  assert.equal(opened.importOptions.mode, "objects");
  assert.equal(r.opened, false, "honest result when no document was opened");
  await assert.rejects(tools.find((t) => t.name === "open_attachment").run({ name: "zzz" }), /No attachment matches. Attached: 1\. notes\.md/);
});
